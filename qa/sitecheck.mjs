// npm run sitecheck: real sites over the real network in the built app, hidden, muted, on a temp profile.
// Rows: YouTube plays for 60 s, Google search results load, Reddit loads, Google Docs reaches the editor or the
// normal sign-in page without a "browser may not be secure" block. Results: qa/out/sitecheck-results.json.
// Exits 0 only if every row passes.
import { ensureBuilt, launch, sleep, tempProfile, writeJson } from './lib.mjs'

ensureBuilt()
const rows = []
const record = (name, pass, detail) => {
  rows.push({ name, pass: Boolean(pass), detail: String(detail ?? '') })
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}: ${detail ?? ''}`)
}

const t = await launch({ userData: tempProfile('sitecheck'), log: process.env.SWYR_QA_LOG === '1' })

// every page is muted, now and as it is created
await t.app.evaluate(({ app, webContents }) => {
  for (const wc of webContents.getAllWebContents()) wc.setAudioMuted(true)
  app.on('web-contents-created', (_e, wc) => wc.setAudioMuted(true))
})

/** run JS in the page whose URL matches, retried while it is between documents */
async function pageJs(match, code) {
  for (let i = 0; i < 6; i++) {
    try {
      return await t.app.evaluate(async ({ webContents }, [m, c]) => {
        const wc = webContents.getAllWebContents().find((w) => !w.isDestroyed() && new RegExp(m).test(w.getURL()))
        return wc ? await wc.executeJavaScript(c, true) : '__no_contents__'
      }, [match, code])
    } catch (err) {
      if (!/destroyed|disposed|Script failed|navigat/i.test(String(err?.message))) throw err
      await sleep(500)
    }
  }
  return null
}
async function until(match, code, ms) {
  const t0 = Date.now()
  let last = null
  while (Date.now() - t0 < ms) {
    last = await pageJs(match, code).catch((e) => 'error: ' + e.message)
    if (last && last !== '__no_contents__' && !(typeof last === 'string' && last.startsWith('error:')) && last.ok) return last
    await sleep(500)
  }
  return last
}
async function open(url) {
  await t.dispatch('tab.new', { url })
  await sleep(500)
}

async function row(name, fn) {
  try {
    const r = await fn()
    record(name, r.pass, r.detail)
  } catch (err) {
    record(name, false, 'threw: ' + String(err?.message ?? err).slice(0, 300))
  }
}

try {
  await t.waitFor((s) => s.windows?.length === 1, 'first window')

  await row('youtube video plays for 60 s', async () => {
    // Big Buck Bunny on the Blender channel: ten minutes long, so 60 s of playback never reaches the end
    await open('https://www.youtube.com/watch?v=aqz-KE-bpKQ')
    const start = await until(
      'youtube\\.com/watch',
      `(() => { const v = document.querySelector('video'); if (!v) return { ok: false, why: 'no video' }; v.muted = true; if (v.paused) v.play().catch(() => {}); return { ok: !v.paused && v.currentTime > 0, t: v.currentTime, paused: v.paused, ad: Boolean(document.querySelector('.ad-showing')) } })()`,
      45000
    )
    if (!start?.ok) return { pass: false, detail: 'did not start: ' + JSON.stringify(start) }
    const samples = [start.t]
    const errors = new Set()
    let stalls = 0
    for (let i = 0; i < 12; i++) {
      await sleep(5000)
      const s = await pageJs('youtube\\.com/watch', `(() => { const v = document.querySelector('video'); const e = document.querySelector('.ytp-error'); return v ? { t: v.currentTime, paused: v.paused, ad: Boolean(document.querySelector('.ad-showing')), error: e ? e.innerText.split('\\n')[0] : '' } : null })()`)
      if (s?.error) errors.add(s.error)
      const tNow = s?.t ?? -1
      if (!(tNow > samples[samples.length - 1]) && !s?.ad) stalls++
      samples.push(tNow)
    }
    const advanced = samples[samples.length - 1] - samples[0]
    const pass = stalls === 0 && advanced >= 40
    const webdriver = await pageJs('youtube\\.com/watch', 'navigator.webdriver')
    return { pass, detail: `currentTime ${samples.map((x) => x.toFixed(1)).join(' > ')}; stalled samples ${stalls}; player error: ${[...errors].join(' / ') || 'none'}; navigator.webdriver ${webdriver}` }
  })

  await row('google search results load', async () => {
    await open('https://www.google.com/search?q=open+source+web+browser&hl=en')
    const r = await until(
      'google\\.[a-z.]+/(search|sorry)',
      `(() => { const n = document.querySelectorAll('#search a h3, #rso a h3').length; return { ok: n >= 3, results: n, url: location.href.slice(0, 80), sorry: location.pathname.startsWith('/sorry'), webdriver: navigator.webdriver } })()`,
      30000
    )
    return { pass: Boolean(r?.ok), detail: JSON.stringify(r) }
  })

  await row('reddit loads', async () => {
    await open('https://www.reddit.com/r/AskReddit/')
    const r = await until(
      'reddit\\.com',
      `(() => { const body = document.body ? document.body.innerText : ''; const blocked = /blocked by network security|whoa there, pardner/i.test(body); const posts = document.querySelectorAll('shreddit-post, article, [data-testid="post-container"]').length; return { ok: !blocked && posts >= 3, posts, blocked, title: document.title.slice(0, 60) } })()`,
      30000
    )
    return { pass: Boolean(r?.ok), detail: JSON.stringify(r) }
  })

  await row('google docs reaches the editor or the sign-in page', async () => {
    await open('https://docs.google.com/document/u/0/')
    const r = await until(
      '(docs|accounts)\\.google\\.com',
      `(() => { const body = document.body ? document.body.innerText : ''; const insecure = /browser or app may not be secure|couldn.t sign you in/i.test(body); const signin = location.hostname === 'accounts.google.com' && Boolean(document.querySelector('input[type=email], #identifierId')); const editor = location.hostname === 'docs.google.com' && Boolean(document.querySelector('.docs-homescreen, .kix-appview-editor, #docs-editor')); return { ok: !insecure && (signin || editor), insecure, signin, editor, host: location.hostname } })()`,
      30000
    )
    return { pass: Boolean(r?.ok), detail: JSON.stringify(r) }
  })
} finally {
  await t.close()
}

const file = writeJson('sitecheck-results.json', { rows })
const passed = rows.filter((r) => r.pass).length
console.log(`sitecheck: ${passed}/${rows.length} passed -> ${file}`)
process.exit(passed === rows.length ? 0 : 1)

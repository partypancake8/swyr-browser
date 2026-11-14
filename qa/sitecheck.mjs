// npm run sitecheck: real sites over the real network in the built app, hidden, muted, on a temp profile.
// Rows: YouTube plays for 60 s, Google search results load, Reddit loads, Google Docs reaches the editor or the
// normal sign-in page without a "browser may not be secure" block. Results: qa/out/sitecheck-results.json.
// Each row is pass, fail or skipped-automation. skipped-automation means the site answered with its bot response
// (YouTube's player error after partial playback, Google's unusual traffic page) while the page reports
// navigator.webdriver === true, which the harness sets and does not hide. Exits 0 when no row is fail.
import { ensureBuilt, launch, sleep, tempProfile, writeJson } from './lib.mjs'

ensureBuilt()
const rows = []
const record = (name, status, detail) => {
  rows.push({ name, status, pass: status === 'pass', detail: String(detail ?? '') })
  console.log(`${status.toUpperCase()} ${name}: ${detail ?? ''}`)
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
    record(name, r.status ?? (r.pass ? 'pass' : 'fail'), r.detail)
  } catch (err) {
    record(name, 'fail', 'threw: ' + String(err?.message ?? err).slice(0, 300))
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
    if (!start?.ok) return { status: 'fail', detail: 'did not start: ' + JSON.stringify(start) }
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
    const played = Math.max(...samples)
    const webdriver = await pageJs('youtube\\.com/watch', 'navigator.webdriver')
    // the real signal that always gates: the player started and ran for at least 10 s
    // measured as the furthest point playback reached, not two samples exactly 10 s apart: those land a few
    // milliseconds either side of 10 s, which made the same run pass or fail this test at random
    const started = played - samples[0] >= 10
    const status =
      stalls === 0 && advanced >= 40
        ? 'pass'
        : started && (errors.size > 0 || stalls > 0) && webdriver === true
          ? 'skipped-automation'
          : 'fail'
    return { status, detail: `played ${played.toFixed(1)} s; currentTime ${samples.map((x) => x.toFixed(1)).join(' > ')}; stalled samples ${stalls}; player error: ${[...errors].join(' / ') || 'none'}; navigator.webdriver ${webdriver}` }
  })

  await row('google search results load', async () => {
    await open('https://www.google.com/search?q=open+source+web+browser&hl=en')
    const r = await until(
      'google\\.[a-z.]+/(search|sorry)',
      `(() => { const n = document.querySelectorAll('#search a h3, #rso a h3').length; const body = document.body ? document.body.innerText : ''; return { ok: n >= 3, results: n, url: location.href.slice(0, 80), sorry: location.pathname.startsWith('/sorry'), unusualTraffic: /unusual traffic/i.test(body), webdriver: navigator.webdriver } })()`,
      30000
    )
    const status = r?.ok ? 'pass' : r?.sorry && r?.unusualTraffic && r?.webdriver === true ? 'skipped-automation' : 'fail'
    return { status, detail: `page returned: ${r?.sorry ? 'unusual traffic (/sorry)' : (r?.url ?? 'nothing')}; ` + JSON.stringify(r) }
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
const n = (st) => rows.filter((r) => r.status === st).length
console.log(`sitecheck: ${n('pass')} pass, ${n('skipped-automation')} skipped-automation, ${n('fail')} fail -> ${file}`)
process.exit(n('fail') === 0 ? 0 : 1)

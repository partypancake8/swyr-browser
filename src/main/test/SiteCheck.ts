// In-process site check (SWYR_TEST=1 and SWYR_SITECHECK=<output file> only): the main process opens real sites in
// normal tabs, samples them with executeJavaScript, writes the rows as JSON and quits. Nothing drives the app from
// outside, so the pages see the browser as a person would: no remote debugging, no automation switches.
// The output path comes from the environment, which web content cannot set.
import { app, type WebContents } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { Core } from '../windows/WindowManager'

type Status = 'pass' | 'fail' | 'skipped-automation'
interface Row {
  name: string
  status: Status
  pass: boolean
  driver: 'in-process'
  webdriver: unknown
  detail: string
  data?: unknown
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function js(wc: WebContents, code: string): Promise<unknown> {
  for (let i = 0; i < 6; i++) {
    try {
      if (wc.isDestroyed()) return null
      return await wc.executeJavaScript(code, true)
    } catch {
      await sleep(500)
    }
  }
  return null
}

async function until<T extends { ok?: boolean }>(wc: WebContents, code: string, ms: number): Promise<T | null> {
  const t0 = Date.now()
  let last: T | null = null
  while (Date.now() - t0 < ms) {
    last = (await js(wc, code)) as T | null
    if (last?.ok) return last
    await sleep(500)
  }
  return last
}

/** open a URL in a new tab of the first window and return its contents */
async function open(core: Core, url: string): Promise<{ wc: WebContents; console: string[] }> {
  const w = core.first()
  if (!w) throw new Error('no window')
  await core.commands.run('tab.new', { url }, w)
  await sleep(500)
  const wc = w.activeContents()
  if (!wc) throw new Error('no tab contents')
  const log: string[] = []
  wc.on('console-message', (e) => {
    const level = String((e as unknown as { level?: unknown }).level ?? '')
    if (level === 'error' || level === 'warning') log.push(`${level}: ${String((e as unknown as { message?: unknown }).message ?? '').slice(0, 200)}`)
  })
  return { wc, console: log }
}

async function youtube(core: Core): Promise<Row> {
  const name = 'youtube video plays for 60 s'
  // Big Buck Bunny on the Blender channel: ten minutes long, so 75 s of sampling never reaches the end
  const { wc, console: log } = await open(core, 'https://www.youtube.com/watch?v=aqz-KE-bpKQ')
  const webdriver = await until<{ ok: boolean; wd: unknown }>(wc, `({ ok: document.readyState !== 'loading', wd: navigator.webdriver })`, 20000).then((r) => r?.wd)
  const start = await until<{ ok: boolean; t: number }>(
    wc,
    `(() => { const v = document.querySelector('video'); if (!v) return { ok: false, why: 'no video' }; v.muted = true; if (v.paused) v.play().catch(() => {}); return { ok: !v.paused && v.currentTime > 0, t: v.currentTime } })()`,
    45000
  )
  if (!start?.ok) return { name, status: 'fail', pass: false, driver: 'in-process', webdriver, detail: 'playback did not start: ' + JSON.stringify(start) }
  const samples: number[] = [start.t]
  const errors = new Set<string>()
  let ads = 0
  let errorAt: number | null = null
  for (let i = 0; i < 15; i++) {
    await sleep(5000)
    const s = (await js(
      wc,
      `(() => { const v = document.querySelector('video'); const e = document.querySelector('.ytp-error'); return { t: v ? v.currentTime : -1, ad: Boolean(document.querySelector('.ad-showing')), error: e && e.offsetParent !== null ? e.innerText.split('\\n')[0] : '' } })()`
    )) as { t: number; ad: boolean; error: string } | null
    if (s?.ad) ads++
    if (s?.error) {
      errors.add(s.error)
      if (errorAt === null) errorAt = Math.max(...samples)
    }
    samples.push(s?.t ?? -1)
  }
  // seconds of playback before the first reset or error, not counting ad time
  let played = 0
  for (let i = 1; i < samples.length && samples[i] > samples[i - 1]; i++) played = samples[i] - samples[0]
  const ok = played >= 60 && errors.size === 0
  const status: Status = ok ? 'pass' : webdriver === true ? 'skipped-automation' : 'fail'
  const detail =
    `played ${played.toFixed(1)} s; currentTime ${samples.map((x) => x.toFixed(1)).join(' > ')}; ` +
    `player error: ${[...errors].join(' / ') || 'none'}${errorAt !== null ? ` (after ${errorAt.toFixed(0)} s)` : ''}; ads seen ${ads}; ` +
    `navigator.webdriver ${String(webdriver)}; console: ${log.slice(-6).join(' | ') || 'none'}`
  return { name, status, pass: ok, driver: 'in-process', webdriver, detail, data: { samples, played } }
}

async function google(core: Core): Promise<Row> {
  const name = 'google search results load'
  const { wc } = await open(core, 'https://www.google.com/search?q=open+source+web+browser&hl=en')
  const r = await until<{ ok: boolean; results: number; url: string; sorry: boolean; wd: unknown }>(
    wc,
    `(() => { const n = document.querySelectorAll('#search a h3, #rso a h3').length; return { ok: n >= 3, results: n, url: location.href.slice(0, 100), sorry: location.pathname.startsWith('/sorry'), wd: navigator.webdriver } })()`,
    30000
  )
  const webdriver = r?.wd
  const status: Status = r?.ok ? 'pass' : webdriver === true ? 'skipped-automation' : 'fail'
  return {
    name,
    status,
    pass: Boolean(r?.ok),
    driver: 'in-process',
    webdriver,
    detail: `page returned: ${r?.sorry ? 'unusual traffic (/sorry)' : (r?.url ?? 'nothing')}; ${r?.results ?? 0} results; navigator.webdriver ${String(webdriver)}`
  }
}

/** a page check: one script that returns { ok, wd, ... } once the page is in the state the row wants */
function pageRow(name: string, url: string, code: string, describe: (r: Record<string, unknown> | null) => string) {
  const fn = async (core: Core): Promise<Row> => {
    const { wc } = await open(core, url)
    const r = await until<{ ok: boolean; wd: unknown }>(wc, code, 30000)
    const webdriver = r?.wd
    const status: Status = r?.ok ? 'pass' : webdriver === true ? 'skipped-automation' : 'fail'
    return { name, status, pass: Boolean(r?.ok), driver: 'in-process', webdriver, detail: `${describe(r as Record<string, unknown> | null)}; navigator.webdriver ${String(webdriver)}` }
  }
  Object.defineProperty(fn, 'name', { value: name })
  return fn
}

const reddit = pageRow(
  'reddit loads',
  'https://www.reddit.com/r/AskReddit/',
  `(() => { const body = document.body ? document.body.innerText : ''; const blocked = /blocked by network security|whoa there, pardner/i.test(body); const posts = document.querySelectorAll('shreddit-post, article, [data-testid="post-container"]').length; return { ok: !blocked && posts >= 3, posts, blocked, title: document.title.slice(0, 60), wd: navigator.webdriver } })()`,
  (r) => `${r?.posts ?? 0} posts; blocked ${String(r?.blocked)}; title "${String(r?.title ?? '')}"`
)

const docs = pageRow(
  'google docs reaches the editor or the sign-in page',
  'https://docs.google.com/document/u/0/',
  `(() => { const body = document.body ? document.body.innerText : ''; const insecure = /browser or app may not be secure|couldn.t sign you in/i.test(body); const signin = location.hostname === 'accounts.google.com' && Boolean(document.querySelector('input[type=email], #identifierId')); const editor = location.hostname === 'docs.google.com' && Boolean(document.querySelector('.docs-homescreen, .kix-appview-editor, #docs-editor')); return { ok: !insecure && (signin || editor), insecure, signin, editor, host: location.hostname, wd: navigator.webdriver } })()`,
  (r) => `host ${String(r?.host)}; sign-in page ${String(r?.signin)}; editor ${String(r?.editor)}; insecure-browser block ${String(r?.insecure)}`
)

export async function runSiteCheck(ready: Promise<Core>, out: string): Promise<void> {
  const rows: Row[] = []
  const write = (): void => {
    fs.mkdirSync(path.dirname(out), { recursive: true })
    fs.writeFileSync(out, JSON.stringify({ rows }, null, 2) + '\n')
  }
  try {
    const core = await ready
    await core.waitIdle().catch(() => undefined)
    for (const fn of [youtube, google, reddit, docs]) {
      try {
        rows.push(await fn(core))
      } catch (err) {
        rows.push({ name: fn.name, status: 'fail', pass: false, driver: 'in-process', webdriver: null, detail: 'threw: ' + String(err) })
      }
      write()
    }
  } finally {
    write()
    app.quit()
  }
}

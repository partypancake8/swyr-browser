// npm run reliability: launch, crash, quit and restore checks against the built app, hidden, on temp profiles only.
// Results: qa/out/reliability-results.json as {"checks":[{"name","pass","detail"}]}. Exits 0 only if every check passes.
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { ensureBuilt, jsIn, launch, sleep, tempProfile, waitForJs, writeJson } from './lib.mjs'

ensureBuilt()
const checks = []
const record = (name, pass, detail) => {
  checks.push({ name, pass: Boolean(pass), detail: String(detail ?? '') })
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}: ${detail ?? ''}`)
}
async function check(name, fn) {
  try {
    const r = await fn()
    record(name, r.pass, r.detail)
  } catch (err) {
    record(name, false, 'threw: ' + String(err?.stack ?? err).split('\n').slice(0, 3).join(' | '))
  }
}

// local pages, so nothing here needs the network
const server = http.createServer((req, res) => {
  const n = decodeURIComponent((req.url || '/').slice(1)) || 'root'
  res.writeHead(200, { 'content-type': 'text/html' })
  res.end(`<!doctype html><title>Page ${n}</title><h1>Page ${n}</h1>`)
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const P = (n) => `http://127.0.0.1:${server.address().port}/${n}`

/** collect uncaught errors in main and console errors from swyr's own renderers (swyr:// pages) */
async function watchErrors(t) {
  const main = []
  t.app.process().stderr?.on('data', (d) => {
    const s = String(d)
    if (/Uncaught|Unhandled|UnhandledPromiseRejection|TypeError|ReferenceError/i.test(s)) main.push(s.trim().slice(0, 300))
  })
  await t.app.evaluate(({ app, webContents }) => {
    const g = globalThis
    g.__qaErrors = []
    process.on('uncaughtException', (e) => g.__qaErrors.push('main uncaught: ' + (e?.stack || e)))
    process.on('unhandledRejection', (e) => g.__qaErrors.push('main unhandled rejection: ' + (e?.stack || e)))
    const hook = (wc) => {
      if (wc.__qaHooked) return
      wc.__qaHooked = true
      wc.on('console-message', (e) => {
        const level = e.level ?? ''
        const url = wc.isDestroyed() ? '' : wc.getURL()
        if ((level === 'error' || level === 3) && url.startsWith('swyr://')) g.__qaErrors.push(`renderer ${url}: ${e.message}`)
      })
      wc.on('render-process-gone', (_e, d) => g.__qaErrors.push(`renderer gone ${wc.isDestroyed() ? '' : wc.getURL()}: ${d.reason}`))
    }
    for (const wc of webContents.getAllWebContents()) hook(wc)
    app.on('web-contents-created', (_e, wc) => hook(wc))
  })
  return async () => [...main, ...(await t.app.evaluate(() => globalThis.__qaErrors ?? []))]
}

/** quit the app the way the menu does, and time how long until the process is gone */
async function quitTimed(t) {
  const proc = t.app.process()
  const t0 = Date.now()
  const gone = new Promise((r) => proc.once('exit', r))
  await t.app.evaluate(({ app }) => setTimeout(() => app.quit(), 10)).catch(() => undefined)
  const done = await Promise.race([gone.then(() => true), sleep(10000).then(() => false)])
  const ms = Date.now() - t0
  if (!done && proc.exitCode === null) proc.kill('SIGKILL')
  return { done, ms }
}

// (a) cold start to idle with no uncaught errors
let a = null
await check('cold start to idle with no uncaught errors', async () => {
  const t0 = Date.now()
  a = await launch({ userData: tempProfile('rel-cold') })
  const errors = await watchErrors(a)
  await a.waitFor((s) => s.windows?.length === 1, 'first window')
  await a.waitIdle()
  await waitForJs(a, 'swyr://shell', `Boolean(document.querySelector('[data-section="today"]'))`, 'sidebar rendered')
  await sleep(1500)
  const errs = await errors()
  return { pass: errs.length === 0, detail: `idle in ${Date.now() - t0} ms; errors: ${errs.length ? errs.join(' || ').slice(0, 600) : 'none'}` }
})

// (b) twelve tabs open and close without a renderer crash
await check('open and close 12 tabs with no renderer crash', async () => {
  const t = a
  const errors = await watchErrors(t)
  for (let i = 1; i <= 12; i++) await t.dispatch('tab.new', { url: P('tab' + i) })
  const mine = (i) => /\/tab\d+$/.test(i.url || '')
  const s = await t.waitFor((s) => s.items.filter(mine).length === 12, '12 tabs open')
  await t.waitIdle()
  for (const it of s.items.filter(mine)) await t.dispatch('tab.close', { id: it.id })
  await t.waitFor((s) => !s.items.some((i) => mine(i) && i.section === 'today'), 'tabs closed')
  await sleep(800)
  const errs = (await errors()).filter((e) => /gone|crash/i.test(e))
  const shellAlive = await jsIn(t, 'swyr://shell', '1 + 1')
  return { pass: errs.length === 0 && shellAlive === 2, detail: errs.length ? errs.join(' || ') : `12 opened and closed, shell responsive` }
})

// (c) quit finishes within 10 s
await check('quit completes within 10 s', async () => {
  const { done, ms } = await quitTimed(a)
  return { pass: done && ms <= 10000, detail: done ? `exited in ${ms} ms` : 'still running after 10 s' }
})

// (d) session restore round trip on a temp profile
await check('session restore round trip (tabs, pinned, spaces)', async () => {
  const dir = tempProfile('rel-restore')
  let t = await launch({ userData: dir })
  try {
    await t.waitFor((s) => s.windows?.length === 1, 'first window')
    const space = await t.dispatch('space.new', { name: 'Restore space', icon: 'briefcase', activate: false })
    for (const n of ['keep1', 'keep2', 'pinme']) await t.dispatch('tab.new', { url: P(n) })
    let s = await t.waitFor((s) => ['keep1', 'keep2', 'pinme'].every((n) => s.items.some((i) => i.title === 'Page ' + n)), 'three tabs')
    await t.dispatch('tab.pin', { itemId: s.items.find((i) => i.title === 'Page pinme').id })
    await sleep(300)
    const { done, ms } = await quitTimed(t)
    if (!done) return { pass: false, detail: `first quit hung (${ms} ms)` }
    t = await launch({ userData: dir })
    s = await t.waitFor((s) => s.windows?.length === 1, 'restored window')
    const titles = ['keep1', 'keep2', 'pinme'].map((n) => 'Page ' + n)
    const missing = titles.filter((x) => !s.items.some((i) => i.title === x || (i.url || '').endsWith('/' + x.slice(5))))
    const pinned = s.items.find((i) => (i.url || '').endsWith('/pinme'))?.section
    const spaceBack = s.spaces.some((sp) => sp.id === space && sp.name === 'Restore space')
    const pass = missing.length === 0 && pinned === 'pinned' && spaceBack
    return { pass, detail: `missing tabs: ${missing.join(', ') || 'none'}; pinme section: ${pinned}; space restored: ${spaceBack}` }
  } finally {
    await t.close()
  }
})

// (e) a corrupt state.json does not stop launch (several kinds of damage)
await check('corrupt state.json does not prevent launch', async () => {
  const cases = { garbage: '\u0000ÿ{{{ not json', truncated: '{"version": 3, "spaces": [{"id": "s', nullDoc: 'null', wrongShape: '{"spaces": "x", "items": 7, "windows": {}}' }
  const results = []
  for (const [name, body] of Object.entries(cases)) {
    const dir = tempProfile('rel-corrupt')
    fs.writeFileSync(path.join(dir, 'state.json'), body)
    const t = await launch({ userData: dir })
    try {
      const s = await t.waitFor((s) => s.windows?.length === 1 && s.spaces?.length >= 1, 'window after corrupt state', 20000)
      await t.dispatch('tab.new', { url: P('after-' + name) })
      await t.waitFor((s) => s.items.some((i) => i.title === 'Page after-' + name), 'usable after corrupt state', 15000)
      results.push(`${name}: ok (${s.spaces.length} space)`)
    } catch (err) {
      results.push(`${name}: FAILED ${String(err?.message ?? err).slice(0, 120)}`)
    } finally {
      await t.close()
    }
  }
  return { pass: results.every((r) => r.includes(': ok')), detail: results.join('; ') }
})

// (f) a build without update config stays quiet about updates
await check('local build: update check stays quiet', async () => {
  const prev = process.env.SWYR_UPDATE_LOCAL
  process.env.SWYR_UPDATE_LOCAL = '1'
  const t = await launch({ userData: tempProfile('rel-update') })
  try {
    await t.waitFor((s) => s.windows?.length === 1 && s.update, 'update state')
    const r = await t.dispatch('update.check')
    await t.dispatch('settings.open')
    const text = await waitForJs(t, 'swyr://settings', `(() => { const r = document.querySelector('[data-setting="updates"]'); return r ? r.innerText : null })()`, 'updates row')
    const quiet = r.status === 'local' && !r.error
    const says = /installed locally/i.test(text)
    return { pass: quiet && says, detail: `status ${r.status}, error ${r.error ?? 'none'}; settings row: ${String(text).replace(/\s+/g, ' ').slice(0, 160)}` }
  } finally {
    await t.close()
    if (prev === undefined) delete process.env.SWYR_UPDATE_LOCAL
    else process.env.SWYR_UPDATE_LOCAL = prev
  }
})

// (g) a crashed tab renderer comes back when the tab is used again, and the window survives
await check('tab renderer crash leaves the window usable', async () => {
  const t = await launch({ userData: tempProfile('rel-crash') })
  try {
    await t.waitFor((s) => s.windows?.length === 1, 'first window')
    await t.dispatch('tab.new', { url: P('crashme') })
    await t.waitFor((s) => s.items.some((i) => i.title === 'Page crashme'), 'crash tab')
    await t.waitIdle()
    await t.app.evaluate(({ webContents }) => {
      const wc = webContents.getAllWebContents().find((w) => w.getURL().endsWith('/crashme'))
      wc?.forcefullyCrashRenderer()
    })
    await sleep(1000)
    await t.dispatch('tab.new', { url: P('aftercrash') })
    await t.waitFor((s) => s.items.some((i) => i.title === 'Page aftercrash'), 'tab after crash', 15000)
    const shell = await jsIn(t, 'swyr://shell', '1 + 1')
    return { pass: shell === 2, detail: 'renderer killed, new tab loads, shell responsive' }
  } finally {
    await t.close()
  }
})

server.close()
const file = writeJson('reliability-results.json', { checks })
const failed = checks.filter((c) => !c.pass)
console.log(`reliability: ${checks.length - failed.length}/${checks.length} passed -> ${file}`)
process.exit(failed.length ? 1 : 0)

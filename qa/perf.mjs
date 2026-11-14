// npm run perf: headless performance measurements of the built app (out/) through the SWYR_TEST hook.
// Writes qa/out/perf-results.json. With --compare, exits 1 when a metric is more than 25 percent worse
// than qa/perf-baseline.json (its "after" block when present, else its "metrics").
// Options: --runs N (default 3), --compare, --save-baseline before|after (writes the medians into the baseline file).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { launch, repo, sleep } from '../tests/harness.mjs'

const argv = process.argv.slice(2)
const flag = (name) => argv.includes(name)
const opt = (name, def) => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def
}
const RUNS = Math.max(1, Number(opt('--runs', '3')) || 3)
const outDir = path.join(repo, 'qa/out')
const baselineFile = path.join(repo, 'qa/perf-baseline.json')
fs.mkdirSync(outDir, { recursive: true })

// production-like settings: the default warm cache (no SWYR_WARM_TABS) and no tight renderer process cap
delete process.env.SWYR_WARM_TABS
process.env.SWYR_RENDERER_LIMIT = process.env.SWYR_PERF_RENDERER_LIMIT || '64'
const SETTINGS = {
  build: 'production (electron-vite build, out/)',
  window: 'hidden (SWYR_TEST=1)',
  warmTabs: 'app default (SWYR_WARM_TABS unset)',
  rendererProcessLimit: process.env.SWYR_RENDERER_LIMIT,
  userData: 'fresh temp dir per run',
  pages: 'qa/fixtures/perf/page.html over 127.0.0.1 (timers + CSS animation)'
}

// fixture server: local files only, no network
const fixture = fs.readFileSync(path.join(repo, 'qa/fixtures/perf/page.html'))
const server = http.createServer((req, res) => {
  if (req.url?.startsWith('/page')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    res.end(fixture)
  } else {
    res.writeHead(404)
    res.end()
  }
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const port = server.address().port
const pageUrl = (n) => `http://127.0.0.1:${port}/page?n=${n}`

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const round = (v, d = 1) => Math.round(v * 10 ** d) / 10 ** d

async function metrics(t) {
  return t.app.evaluate(({ app }) =>
    app.getAppMetrics().map((m) => ({ pid: m.pid, type: m.type, kb: m.memory.workingSetSize, cpu: m.cpu.cumulativeCPUUsage ?? 0 }))
  )
}
const totalMB = (ms) => ms.reduce((a, m) => a + m.kb, 0) / 1024

async function waitLoaded(t, ms = 30000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    const busy = await t.app.evaluate(({ webContents }) => webContents.getAllWebContents().some((w) => !w.isDestroyed() && w.isLoading()))
    if (!busy) return
    await sleep(100)
  }
}

async function openTabs(t, from, to) {
  for (let i = from; i < to; i++) await t.dispatch('tab.new', { url: pageUrl(i) })
  await t.waitFor((s) => s.items.filter((i) => /Perf fixture/.test(i.title)).length >= Math.min(to, 8) || s.items.length >= to, 'titles')
  await waitLoaded(t)
}

async function oneRun(run) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'swyr-perf-'))
  const r = {}
  const t0 = performance.now()
  const t = await launch({ userData })
  try {
    // cold start: process spawn until the window's shell and overlay finished loading and nothing is loading
    for (;;) {
      const ready = await t.app.evaluate(({ webContents }) => {
        const all = webContents.getAllWebContents()
        const shell = all.find((w) => w.getURL().startsWith('swyr://shell'))
        return Boolean(globalThis.__swyr?.getState()?.windows?.length && shell && !all.some((w) => w.isLoading()))
      })
      if (ready) break
      await sleep(10)
    }
    r.coldStart = performance.now() - t0
    await sleep(2000)

    await openTabs(t, 0, 1)
    await sleep(3000)
    r.rss1 = totalMB(await metrics(t))

    await openTabs(t, 1, 10)
    await sleep(3000)
    r.rss10 = totalMB(await metrics(t))

    // one more active tab, so 10 tabs sit in the background; idle CPU over 30 s and state writes over 60 s
    await openTabs(t, 10, 11)
    await sleep(3000)
    const stateFile = path.join(userData, 'state.json')
    const sig = () => {
      try {
        const st = fs.statSync(stateFile)
        return `${st.ino}:${st.mtimeMs}:${st.size}`
      } catch {
        return ''
      }
    }
    let last = sig()
    let writes = 0
    let size = 0
    const poll = setInterval(() => {
      const s = sig()
      if (s !== last) {
        writes++
        last = s
        size = Number(s.split(':')[2]) || size
      }
    }, 20)
    const m0 = await metrics(t)
    const w0 = performance.now()
    await sleep(30000)
    const m1 = await metrics(t)
    const elapsed = (performance.now() - w0) / 1000
    const byPid = new Map(m0.map((m) => [m.pid, m.cpu]))
    // cumulative CPU seconds used by processes alive at both samples, as a percent of one core
    const cpuSec = m1.reduce((a, m) => (byPid.has(m.pid) ? a + Math.max(0, m.cpu - byPid.get(m.pid)) : a), 0)
    r.idleCpu = (cpuSec / elapsed) * 100
    r.loadedAtIdle = (await t.state()).windows[0].loaded.length
    await sleep(30000)
    clearInterval(poll)
    r.stateWrites = writes
    try {
      r.stateSize = fs.statSync(stateFile).size / 1024
    } catch {
      r.stateSize = size / 1024
    }

    await openTabs(t, 11, 20)
    await sleep(3000)
    r.rss20 = totalMB(await metrics(t))
    r.loadedAt20 = (await t.state()).windows[0].loaded.length

    // tab switch latency: command until the sidebar shows the new active row, over the 4 most recent (warm) tabs
    const s = await t.state()
    const ids = s.windows[0].loaded.slice(0, 4)
    const switches = []
    for (let i = 0; i < 20; i++) {
      const id = ids[(i + 1) % ids.length]
      switches.push(
        await t.app.evaluate(async ({ webContents }, id) => {
          const shell = webContents.getAllWebContents().find((w) => w.getURL().startsWith('swyr://shell'))
          const start = performance.now()
          await globalThis.__swyr.dispatch('tab.activate', { id })
          const probe = `(() => { const el = document.querySelector('[data-item-id="${id}"]'); return Boolean(el && el.className.includes('row-active')) })()`
          while (!(await shell.executeJavaScript(probe))) await new Promise((r) => setTimeout(r, 1))
          return performance.now() - start
        }, id)
      )
      await sleep(150)
    }
    r.tabSwitch = median(switches)

    // command bar open latency: command until the overlay renders a focused command input
    const opens = []
    for (let i = 0; i < 10; i++) {
      opens.push(
        await t.app.evaluate(async ({ webContents }) => {
          const ov = webContents.getAllWebContents().find((w) => w.getURL().startsWith('swyr://overlay'))
          const start = performance.now()
          await globalThis.__swyr.dispatch('commandbar.open', {})
          const probe = `(() => { const el = document.querySelector('[cmdk-input]'); return Boolean(el && document.activeElement === el) })()`
          while (!(await ov.executeJavaScript(probe))) await new Promise((r) => setTimeout(r, 1))
          return performance.now() - start
        })
      )
      await t.dispatch('commandbar.close', {})
      await sleep(250)
    }
    r.commandBar = median(opens)

    // quit time: app.quit() until the main process exits
    const proc = t.app.process()
    const exited = new Promise((res) => proc.once('exit', res))
    const q0 = performance.now()
    await t.app.evaluate(({ app }) => setTimeout(() => app.quit(), 0)).catch(() => undefined)
    await Promise.race([exited, sleep(20000)])
    r.quit = performance.now() - q0
    if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGKILL')
  } catch (err) {
    try {
      t.app.process().kill('SIGKILL')
    } catch {
      /* already gone */
    }
    throw err
  } finally {
    fs.rmSync(userData, { recursive: true, force: true })
  }
  console.log(`run ${run}:`, JSON.stringify(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, round(v)]))))
  return r
}

const DEFS = [
  ['cold_start_ms', 'coldStart', 'ms', 'spawn until shell and overlay loaded and idle'],
  ['rss_1_tab_mb', 'rss1', 'MB', 'sum of working set over app.getAppMetrics(), 1 fixture tab'],
  ['rss_10_tabs_mb', 'rss10', 'MB', 'same, 10 fixture tabs opened'],
  ['rss_20_tabs_mb', 'rss20', 'MB', 'same, 20 fixture tabs opened'],
  ['idle_cpu_10_bg_tabs_pct', 'idleCpu', '% of one core', '30 s idle, 1 active + 10 background fixture tabs'],
  ['tab_switch_ms', 'tabSwitch', 'ms', 'median of 20 switches among 4 warm tabs, until the sidebar row is active'],
  ['command_bar_open_ms', 'commandBar', 'ms', 'median of 10 opens, until the command input has focus'],
  ['quit_ms', 'quit', 'ms', 'app.quit() until the main process exits, 20 tabs open'],
  ['state_writes_60s_idle', 'stateWrites', 'writes', 'state.json replacements during 60 s idle, 11 tabs'],
  ['state_json_kb', 'stateSize', 'KB', 'state.json size after the idle window, 11 tabs'],
  ['loaded_views_at_idle', 'loadedAtIdle', 'views', 'tab views kept loaded during the idle window (of 11 tabs)'],
  ['loaded_views_at_20', 'loadedAt20', 'views', 'tab views kept loaded with 20 tabs open']
]

const runs = []
try {
  for (let i = 1; i <= RUNS; i++) runs.push(await oneRun(i))
} finally {
  server.close()
}

const result = {
  date: new Date().toISOString(),
  runs: RUNS,
  aggregate: 'median of runs',
  metrics: DEFS.map(([name, key, unit, how]) => ({
    name,
    value: round(median(runs.map((r) => r[key]))),
    unit,
    settings: { ...SETTINGS, how },
    samples: runs.map((r) => round(r[key]))
  }))
}
fs.writeFileSync(path.join(outDir, 'perf-results.json'), JSON.stringify(result, null, 2) + '\n')
for (const m of result.metrics) console.log(`${m.name.padEnd(26)} ${String(m.value).padStart(9)} ${m.unit}   [${m.samples.join(', ')}]`)

const save = opt('--save-baseline', '')
if (save === 'before' || save === 'after') {
  const base = fs.existsSync(baselineFile) ? JSON.parse(fs.readFileSync(baselineFile, 'utf8')) : {}
  const block = { date: result.date, runs: RUNS, metrics: result.metrics.map(({ name, value, unit, settings }) => ({ name, value, unit, settings })) }
  if (save === 'before') {
    base.note = 'medians of npm run perf; "metrics" is the code before the performance fixes, "after" once they landed'
    base.date = block.date
    base.runs = RUNS
    base.metrics = block.metrics
  } else base.after = block
  fs.writeFileSync(baselineFile, JSON.stringify(base, null, 2) + '\n')
  console.log('baseline', save, 'written')
}

if (flag('--compare')) {
  const base = JSON.parse(fs.readFileSync(baselineFile, 'utf8'))
  const ref = base.after?.metrics ?? base.metrics
  // lower is better for every metric; small absolute slack keeps near-zero values from tripping on noise
  const SLACK = { ms: 15, MB: 40, '% of one core': 2, writes: 1, KB: 1, views: 0 }
  let worse = 0
  for (const m of result.metrics) {
    const b = ref.find((x) => x.name === m.name)
    if (!b) continue
    const limit = b.value * 1.25 + (SLACK[m.unit] ?? 0)
    const bad = m.value > limit
    if (bad) worse++
    console.log(`${bad ? 'WORSE' : 'ok   '} ${m.name}: ${m.value} vs ${b.value} (limit ${round(limit)})`)
  }
  if (worse) {
    console.error(`${worse} metric(s) more than 25 percent worse than the baseline`)
    process.exit(1)
  }
}

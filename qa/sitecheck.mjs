// npm run sitecheck: real sites over the real network, measured from inside the app. The built app starts hidden
// on a temp profile with SWYR_TEST=1 and SWYR_SITECHECK=<file>; its main process opens each site in a normal tab,
// samples it, writes the rows and quits (src/main/test/SiteCheck.ts). Nothing attaches to the app (no remote
// debugging, no automation switches), so the sites see what a person's copy of swyr shows them.
// Rows: YouTube plays 60 s with no player error, Google search shows results, Reddit loads, Google Docs reaches the
// editor or the normal sign-in page. Each row is pass, fail or skipped-automation (only if a page still saw
// navigator.webdriver === true). Results: qa/out/sitecheck-results.json. Exits 0 when no row is fail.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { ensureBuilt, outDir, repo, tempProfile } from './lib.mjs'

const TIMEOUT_MS = 6 * 60 * 1000

ensureBuilt()
fs.mkdirSync(outDir, { recursive: true })
const file = path.join(outDir, 'sitecheck-results.json')
fs.rmSync(file, { force: true })

const electron = path.join(repo, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
const env = { ...process.env, SWYR_TEST: '1', SWYR_SKIP_ONBOARDING: '1', SWYR_USER_DATA: tempProfile('sitecheck'), SWYR_SITECHECK: file }
delete env.SWYR_AUDIO // pages stay muted
const child = spawn(electron, [path.join(repo, 'out/main/index.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] })
const log = []
child.stdout.on('data', (d) => log.push(String(d)))
child.stderr.on('data', (d) => log.push(String(d)))
const code = await new Promise((resolve) => {
  const timer = setTimeout(() => {
    console.log(`app ${child.pid} still running after ${TIMEOUT_MS / 1000} s; stopping it`)
    child.kill('SIGKILL')
  }, TIMEOUT_MS)
  child.once('exit', (c, sig) => {
    clearTimeout(timer)
    resolve(c ?? sig)
  })
})

let rows = []
try {
  rows = JSON.parse(fs.readFileSync(file, 'utf8')).rows ?? []
} catch {
  rows = []
}
const expected = ['youtube video plays for 60 s', 'google search results load', 'reddit loads', 'google docs reaches the editor or the sign-in page']
for (const name of expected) {
  if (!rows.some((r) => r.name === name)) rows.push({ name, status: 'fail', pass: false, driver: 'in-process', webdriver: null, detail: `no result (app exit ${code})` })
}
fs.writeFileSync(file, JSON.stringify({ rows }, null, 2) + '\n')
for (const r of rows) console.log(`${r.status.toUpperCase()} ${r.name}: ${r.detail}`)
const n = (st) => rows.filter((r) => r.status === st).length
if (n('fail')) console.log('app output tail:\n' + log.join('').slice(-1500))
console.log(`sitecheck: ${n('pass')} pass, ${n('skipped-automation')} skipped-automation, ${n('fail')} fail -> ${file}`)
process.exit(n('fail') === 0 ? 0 : 1)

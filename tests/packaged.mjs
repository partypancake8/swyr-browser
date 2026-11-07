// Headless smoke test of the packaged app (run `npm run dist` first): launches dist/mac-arm64/swyr.app's binary
// with SWYR_TEST=1, waits for state, opens example.com, captures one frame and quits.
// Usage: node tests/packaged.mjs [output-dir]
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { repo, sleep } from './harness.mjs'

const require = createRequire(path.join(repo, 'package.json'))
const { _electron } = require('playwright')
const binary = path.join(repo, 'dist/mac-arm64/swyr.app/Contents/MacOS/swyr')
assert.ok(fs.existsSync(binary), 'build the app first: npm run dist')
const out = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'swyr-packaged-'))
fs.mkdirSync(out, { recursive: true })
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'swyr-packaged-data-'))

const app = await _electron.launch({
  executablePath: binary,
  args: [],
  env: { ...process.env, SWYR_TEST: '1', SWYR_USER_DATA: userData },
  timeout: 60000
})
const ev = (fn, arg) => app.evaluate(fn, arg)
const state = () => ev(() => globalThis.__swyr?.getState() ?? null)
async function waitFor(pred, label, ms = 30000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    const s = await state()
    if (s && pred(s)) return s
    await sleep(300)
  }
  throw new Error('timeout waiting for ' + label)
}
try {
  await waitFor((s) => s.windows?.length >= 1, 'first window')
  const info = await ev(({ app }) => ({ packaged: app.isPackaged, name: app.getName(), version: app.getVersion(), path: app.getAppPath() }))
  assert.equal(info.packaged, true)
  assert.equal(info.name, 'swyr')
  await waitFor((s) => /^swyr:\/\/onboarding/.test(s.items.find((i) => i.id === s.windows[0].activeItemId)?.url || ''), 'onboarding')
  await ev((_e, p) => globalThis.__swyr.dispatch('onboarding.complete', p), { adblock: true })
  await ev(() => globalThis.__swyr.dispatch('tab.new', { url: 'https://example.com' }))
  await waitFor((s) => /Example Domain/.test(s.items.find((i) => i.id === s.windows[0].activeItemId)?.title || ''), 'example.com loaded')
  await ev(() => globalThis.__swyr.waitIdle())
  await sleep(800)
  const file = path.join(out, 'packaged.png')
  assert.equal(await ev((_e, f) => globalThis.__swyr.capture(f), file), true)
  assert.ok(fs.statSync(file).size > 10000, 'capture too small')
  const table = await ev(() => globalThis.__swyr.dispatch('shortcuts.list'))
  assert.ok(table.length > 50)
  console.log('PACKAGED SMOKE PASS', JSON.stringify(info), file)
} finally {
  await app.close().catch(() => app.process().kill('SIGKILL'))
}

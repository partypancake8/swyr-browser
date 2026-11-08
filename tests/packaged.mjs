// Headless smoke test of the packaged app (run `npm run dist` first): launches dist/mac-arm64/swyr.app's binary
// with SWYR_TEST=1, waits for state, opens example.com, captures one frame and quits. The app is driven over CDP
// (see packaged-cdp.mjs) because its fuses lock out the Node inspector. It also proves two fuses hold: --inspect is
// passed and ignored, and ELECTRON_RUN_AS_NODE=1 does not turn the binary into Node.
// Usage: node tests/packaged.mjs [output-dir]
// SWYR_PACKAGED_APP=<path to swyr.app> tests another copy, such as the app inside the mounted DMG (read-only volume:
// user data and captures stay in temporary folders).
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { sleep } from './harness.mjs'
import { appPath, connect, launchPackaged, start, tempDir, until } from './packaged-cdp.mjs'

const out = process.argv[2] || tempDir('swyr-packaged-')
fs.mkdirSync(out, { recursive: true })
const infoPlist = path.join(appPath, 'Contents/Info.plist')
const plist = (key, fmt = 'raw') => execFileSync('plutil', ['-extract', key, fmt, '-o', '-', infoPlist]).toString().trim()

assert.equal(plist('CFBundleName'), 'swyr')
const version = plist('CFBundleShortVersionString')
const integrity = JSON.parse(plist('ElectronAsarIntegrity', 'json'))
assert.match(integrity['Resources/app.asar']?.hash || '', /^[0-9a-f]{64}$/, 'no asar integrity hash in Info.plist')

const app = await launchPackaged(['--inspect=0'])
try {
  await until(async () => /^swyr:\/\/onboarding/.test(app.activeItem(await app.view())?.url || ''), 'onboarding')
  const update = await app.invoke('update.state')
  assert.equal(update.current, version, 'app version matches Info.plist')
  await app.invoke('onboarding.complete', { adblock: true })
  await app.invoke('tab.new', { url: 'https://example.com' })
  await until(async () => /Example Domain/.test(app.activeItem(await app.view())?.title || ''), 'example.com loaded')
  await sleep(1500)
  // the tab's frame comes through CDP: a hidden tab view with no DevTools client attached has no display surface,
  // so page.capture (webContents.capturePage) fails in this mode
  const file = path.join(out, 'packaged.png')
  const tabTarget = await app.target((t) => t.type === 'page' && t.url.startsWith('https://example.com'), 'example.com target')
  const tab = await connect(tabTarget.webSocketDebuggerUrl)
  try {
    const shot = await tab.send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(file, Buffer.from(shot.data, 'base64'))
  } finally {
    tab.close()
  }
  assert.ok(fs.statSync(file).size > 10000, 'capture too small')
  const table = await app.invoke('shortcuts.list')
  assert.ok(table.length > 50)
  assert.doesNotMatch(app.run.output(), /Debugger listening/, 'the Node inspector started: EnableNodeCliInspectArguments is not off')
  console.log('PACKAGED SMOKE PASS', appPath, JSON.stringify({ name: 'swyr', version, inspector: 'refused' }), file)
} finally {
  await app.close()
}

// RunAsNode is off: with ELECTRON_RUN_AS_NODE=1 the binary starts swyr (hidden, test mode) instead of a Node shell
const node = start(['-e', 'process.stdout.write("RUN-AS-NODE")'], { ELECTRON_RUN_AS_NODE: '1' })
await Promise.race([node.exited, sleep(6000)])
node.proc.kill('SIGKILL')
await node.exited
assert.doesNotMatch(node.output(), /RUN-AS-NODE/, 'ELECTRON_RUN_AS_NODE ran code: RunAsNode is not off')
console.log('PACKAGED FUSES PASS run-as-node refused, inspector refused')

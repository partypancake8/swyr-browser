// Headless platform check of the packaged app (run `npm run dist` first). The signed app runs with library validation
// on and its fuses locked; this proves an unpacked extension loads, its service worker reaches a native messaging
// host (a separate process, so library validation does not apply to it), and the ad blocker cancels ad requests.
// Usage: node tests/packaged-platform.mjs (SWYR_PACKAGED_APP=<path to swyr.app> tests another copy)
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { repo, sleep } from './harness.mjs'
import { connect, launchPackaged, tempDir, until } from './packaged-cdp.mjs'

const HOST = 'com.swyr.packaged_test'
const work = tempDir('swyr-packaged-platform-')
const extDir = path.join(work, 'ext')
fs.mkdirSync(extDir)
fs.writeFileSync(
  path.join(extDir, 'manifest.json'),
  JSON.stringify({ manifest_version: 3, name: 'swyr native test', version: '1.0', permissions: ['nativeMessaging'], background: { service_worker: 'bg.js' } })
)
fs.writeFileSync(path.join(extDir, 'bg.js'), "chrome.runtime.onInstalled.addListener(() => {})\n")
// the host echoes one length-prefixed message back with pong: true
const hostScript = path.join(work, 'host.mjs')
fs.writeFileSync(
  hostScript,
  `#!${process.execPath}
let buf = Buffer.alloc(0)
process.stdin.on('data', (d) => {
  buf = Buffer.concat([buf, d])
  if (buf.length < 4) return
  const len = buf.readUInt32LE(0)
  if (buf.length < 4 + len) return
  const msg = JSON.parse(buf.subarray(4, 4 + len).toString())
  const out = Buffer.from(JSON.stringify({ ...msg, pong: true }))
  const head = Buffer.alloc(4)
  head.writeUInt32LE(out.length, 0)
  process.stdout.write(Buffer.concat([head, out]), () => process.exit(0))
})
`,
  { mode: 0o755 }
)
const hostDir = path.join(work, 'hosts')
fs.mkdirSync(hostDir)

const app = await launchPackaged([], { SWYR_NATIVE_HOST_DIRS: hostDir })
try {
  await until(async () => /^swyr:\/\/onboarding/.test(app.activeItem(await app.view())?.url || ''), 'onboarding')
  await app.invoke('onboarding.complete', { adblock: true })

  // 1. unpacked extension loads
  await app.invoke('extensions.loadUnpacked', { path: extDir })
  const ext = await until(async () => (await app.view()).state.settings.extensions?.find((e) => e.path === extDir || e.name === 'swyr native test'), 'extension in settings')
  const extId = ext.id
  assert.match(extId, /^[a-p]{32}$/)
  console.log('PACKAGED PLATFORM extension loaded', extId)

  // 2. native messaging from the extension's service worker
  fs.writeFileSync(
    path.join(hostDir, `${HOST}.json`),
    JSON.stringify({ name: HOST, description: 'swyr packaged test host', path: hostScript, type: 'stdio', allowed_origins: [`chrome-extension://${extId}/`] })
  )
  const swTarget = await app.target((t) => t.type === 'service_worker' && t.url.startsWith(`chrome-extension://${extId}/`), 'extension service worker')
  const sw = await connect(swTarget.webSocketDebuggerUrl)
  try {
    const reply = await sw.evaluate(
      `new Promise((resolve) => chrome.runtime.sendNativeMessage(${JSON.stringify(HOST)}, { ping: 1 }, (res) => resolve({ res, err: chrome.runtime.lastError?.message ?? null })))`
    )
    assert.deepEqual(reply, { res: { ping: 1, pong: true }, err: null }, 'native host reply: ' + JSON.stringify(reply))
  } finally {
    sw.close()
  }
  console.log('PACKAGED PLATFORM native messaging ok')

  // 3. ad blocker: requests to ad hosts fail as blocked by the client
  await app.invoke('tab.new', { url: 'about:blank' })
  await sleep(500)
  const blank = await app.target((t) => t.type === 'page' && t.url === 'about:blank', 'blank tab')
  const page = await connect(blank.webSocketDebuggerUrl)
  const blocked = []
  page.on((method, params) => {
    if (method === 'Network.loadingFailed' && /BLOCKED_BY_CLIENT/.test(params.errorText || '')) blocked.push(params.requestId)
  })
  try {
    await page.send('Network.enable')
    await page.send('Page.navigate', { url: pathToFileURL(path.join(repo, 'tests/fixtures/adtest.html')).href })
    await until(() => blocked.length >= 1, 'blocked ad request', 20000)
  } finally {
    page.close()
  }
  console.log('PACKAGED PLATFORM adblock ok', blocked.length, 'requests blocked')
  console.log('PACKAGED PLATFORM PASS')
} finally {
  await app.close()
}

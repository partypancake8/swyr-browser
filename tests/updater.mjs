// Round 7 updater smoke: a local generic feed advertises swyr 9.9.9; the built app (SWYR_TEST=1, SWYR_UPDATE_FEED,
// SWYR_UPDATE_NO_DOWNLOAD=1) runs update.check, reports the update as available in state, and the sidebar shows
// the update row. Nothing is downloaded and the app never quits to install.
// Usage: node tests/updater.mjs [repo]   (SWYR_TEST_OUT=<dir> keeps the captures)
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { launch, sleep } from './harness.mjs'

const out = process.env.SWYR_TEST_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'swyr-updater-'))
fs.mkdirSync(out, { recursive: true })

const fakeZip = Buffer.from('not a real zip: the test never downloads it')
const sha512 = crypto.createHash('sha512').update(fakeZip).digest('base64')
const yml = [
  'version: 9.9.9',
  'files:',
  '  - url: swyr-9.9.9-arm64.zip',
  `    sha512: ${sha512}`,
  `    size: ${fakeZip.length}`,
  'path: swyr-9.9.9-arm64.zip',
  `sha512: ${sha512}`,
  `releaseDate: '${new Date().toISOString()}'`,
  ''
].join('\n')

const requests = []
const server = http.createServer((req, res) => {
  requests.push(req.url)
  const url = (req.url || '').split('?')[0]
  if (url.endsWith('/latest-mac.yml')) {
    res.writeHead(200, { 'content-type': 'text/yaml' })
    res.end(yml)
  } else if (url.endsWith('.zip')) {
    res.writeHead(200, { 'content-type': 'application/zip', 'content-length': fakeZip.length })
    res.end(fakeZip)
  } else {
    res.writeHead(404)
    res.end()
  }
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const feed = `http://127.0.0.1:${server.address().port}/feed`
process.env.SWYR_UPDATE_FEED = feed
process.env.SWYR_UPDATE_NO_DOWNLOAD = '1'

const t = await launch({ log: process.env.SWYR_LOG === '1' })
try {
  await t.waitFor((s) => s.windows?.length >= 1 && s.update, 'first window with update state')
  const before = (await t.state()).update
  assert.equal(before.status, 'idle', 'no check before update.check: ' + JSON.stringify(before))

  const r = await t.dispatch('update.check')
  console.log('update.check ->', JSON.stringify(r))
  const s = await t.waitFor((s) => s.update?.status === 'available' && s.update?.version === '9.9.9', 'update 9.9.9 available', 20000)
  assert.ok(s.update.checkedAt > 0, 'checkedAt set')
  assert.ok(requests.some((u) => u.includes('latest-mac.yml')), 'feed was asked for latest-mac.yml: ' + requests.join(','))
  assert.ok(!requests.some((u) => u.endsWith('.zip')), 'no download with SWYR_UPDATE_NO_DOWNLOAD=1')

  // the sidebar row
  const shellJs = (code) =>
    t.app.evaluate(async ({ webContents }, c) => {
      const wc = webContents.getAllWebContents().find((w) => !w.isDestroyed() && w.getURL().startsWith('swyr://shell'))
      return wc ? wc.executeJavaScript(c, true) : null
    }, code)
  let row = null
  for (let i = 0; i < 40 && !row; i++) {
    row = await shellJs(`(() => { const r = document.querySelector('[data-update]'); if (!r) return null; const b = r.getBoundingClientRect(); return { status: r.getAttribute('data-update'), text: r.innerText, x: b.x, y: b.y, w: b.width, h: b.height } })()`)
    if (!row) await sleep(250)
  }
  assert.ok(row, 'sidebar update row rendered')
  assert.equal(row.status, 'available')
  assert.match(row.text, /swyr 9\.9\.9 is available/)
  console.log('sidebar row:', JSON.stringify(row))

  await sleep(400)
  const full = path.join(out, 'updater-window.png')
  assert.equal(await t.capture(full), true)
  const crop = path.join(out, 'updater-row.png')
  const png = await t.app.evaluate(({ nativeImage }, a) => {
    const img = nativeImage.createFromPath(a.full)
    const { width } = img.getSize()
    const scale = width / a.winWidth
    const pad = 8
    const rect = { x: Math.max(0, Math.round((a.row.x - pad) * scale)), y: Math.max(0, Math.round((a.row.y - pad) * scale)), width: Math.round((a.row.w + pad * 2) * scale), height: Math.round((a.row.h + pad * 2) * scale) }
    return img.crop(rect).toPNG().toString('base64')
  }, { full, row, winWidth: s.windows[0].bounds.width })
  fs.writeFileSync(crop, Buffer.from(png, 'base64'))
  assert.ok(fs.statSync(crop).size > 500, 'row crop too small')
  assert.ok(fs.statSync(full).size > 10000, 'capture too small')

  // release notes open the GitHub release page of the offered version in a tab
  await t.dispatch('update.openReleaseNotes')
  await t.waitFor((s) => s.items.some((i) => (i.url || '').includes('/swyr-browser/releases/tag/v9.9.9') || (i.title || '').includes('v9.9.9')), 'release notes tab', 15000)
  // update.install refuses until a download is ready
  assert.equal(await t.dispatch('update.install'), false)

  console.log('UPDATER SMOKE PASS', feed, full, crop)
} finally {
  await t.close()
  server.close()
}

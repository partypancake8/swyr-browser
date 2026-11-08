// Round 8 security: the URL policy and permission mapping as pure checks, then the running app headless:
// renderer isolation, internal page CSP, internal pages and files unreachable from web content, dangerous URLs
// refused, no bridge on web pages, IPC sender checks, secrets kept out of renderers and state.json, and the
// permission prompt.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { launch, sleep } from './harness.mjs'
import { externalOpenKind, isScriptUrl, refusedInput, webContentMayNavigate, webContentMayOpen } from '../src/main/security/urlPolicy.ts'
import { permissionsFor, requestPolicy, remembered } from '../src/main/sitesettings/SiteSettings.ts'

const out = process.env.SWYR_TEST_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'swyr-security-'))
fs.mkdirSync(out, { recursive: true })
const step = (name) => console.log('step', name)

// ----- pure checks
step('url policy')
for (const u of ['javascript:alert(1)', ' JavaScript:alert(1)', 'java\tscript:alert(1)', 'vbscript:x', 'data:text/html,<script>1</script>', 'data:image/svg+xml,<svg/>', 'view-source:javascript:1']) {
  assert.equal(isScriptUrl(u), true, u)
}
for (const u of ['https://example.com', 'data:image/png;base64,AAAA', 'swyr://settings', 'file:///tmp/a']) assert.equal(isScriptUrl(u), false, u)
assert.ok(refusedInput('file:///etc/passwd', true))
assert.equal(refusedInput('file:///etc/passwd', false), null)
assert.ok(refusedInput('javascript:1', false))
assert.equal(refusedInput('https://example.com', true), null)
assert.equal(webContentMayOpen('swyr://settings', 'https://evil.test/'), false)
assert.equal(webContentMayOpen('file:///etc/hosts', 'https://evil.test/'), false)
assert.equal(webContentMayOpen('https://example.com/', 'https://evil.test/'), true)
assert.equal(webContentMayOpen('swyr://library', 'swyr://newtab'), true)
assert.equal(webContentMayNavigate('swyr://library', 'https://evil.test/'), false)
assert.equal(webContentMayNavigate('file:///etc/hosts', 'https://evil.test/'), false)
assert.equal(webContentMayNavigate('swyr://library', 'swyr://newtab/'), true)
assert.equal(externalOpenKind('https://example.com/'), 'web')
assert.equal(externalOpenKind('mailto:a@b.c'), 'app')
assert.equal(externalOpenKind('zoommtg://zoom.us/join'), 'app')
for (const u of ['file:///etc/passwd', 'javascript:1', 'smb://server/share', 'x-man-page://ls', 42]) assert.equal(externalOpenKind(u), null, String(u))

step('permission policy')
assert.deepEqual(permissionsFor('midiSysex'), ['midi'])
assert.equal(requestPolicy('notifications', 'https://a.test'), 'ask')
assert.equal(requestPolicy('media', 'swyr://note', ['audio']), 'allow')
assert.equal(requestPolicy('notifications', 'swyr://settings'), 'allow')
assert.equal(requestPolicy('geolocation', 'swyr://settings'), 'deny')
assert.equal(requestPolicy('openExternal', 'https://a.test'), 'deny')
assert.equal(requestPolicy('fullscreen', 'https://a.test'), 'allow')
assert.equal(requestPolicy('hid', 'https://a.test'), 'deny')
assert.equal(remembered({ camera: 'allow' }, ['camera', 'microphone']), null)
assert.equal(remembered({ camera: 'allow', microphone: 'deny' }, ['camera', 'microphone']), false)
assert.equal(remembered({ notifications: 'allow' }, ['notifications']), true)

// ----- the running app
const server = http.createServer((req, res) => {
  res.setHeader('content-type', 'text/html')
  res.end('<!doctype html><title>web</title><h1>web page</h1>')
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const port = server.address().port
const webA = `http://127.0.0.1:${port}/a`
const webB = `http://localhost:${port}/b`

const t = await launch({ log: process.env.SWYR_TEST_LOG === '1' })
const activeUrl = (s) => s.items.find((i) => i.id === s.windows[0].activeItemId)?.url || ''
const inTab = (js) => t.app.evaluate((_e, code) => globalThis.__swyr.evalInActiveTab(code), js)
const open = async (url, label) => {
  await t.dispatch('tab.new', { url })
  await t.waitFor((s) => activeUrl(s).startsWith(url.replace(/\/$/, '')), label)
  await t.waitIdle()
}
try {
  await t.waitFor((s) => s.windows?.length === 1, 'window')

  step('1. every webContents sandboxed and isolated')
  await open(webA, 'web tab')
  await open('swyr://settings', 'settings tab')
  await sleep(800)
  const prefs = await t.app.evaluate(({ webContents }) =>
    webContents.getAllWebContents().map((w) => ({ url: w.getURL(), type: w.getType(), p: w.getLastWebPreferences() }))
  )
  assert.ok(prefs.length >= 4)
  for (const { url, type, p } of prefs) {
    if (type === 'remote') continue
    const where = `${type} ${url}`
    assert.equal(p.sandbox, true, 'sandbox ' + where)
    assert.equal(p.contextIsolation, true, 'contextIsolation ' + where)
    assert.ok(!p.nodeIntegration && !p.nodeIntegrationInWorker && !p.nodeIntegrationInSubFrames, 'node ' + where)
    assert.ok(p.webSecurity !== false && !p.allowRunningInsecureContent && !p.experimentalFeatures && !p.webviewTag, 'web ' + where)
  }

  step('2. internal pages carry a strict CSP')
  const csp = await inTab(`fetch('swyr://settings').then((r) => r.headers.get('content-security-policy') || 'none')`)
  assert.match(csp, /default-src 'self'/)
  assert.match(csp, /frame-ancestors 'none'/)
  assert.doesNotMatch(csp, /unsafe-eval/)
  assert.doesNotMatch(csp, /script-src[^;]*(https?:|unsafe-inline)/)

  step('3. web content cannot reach swyr:// pages or local files')
  await open(webA, 'web tab 2')
  const before = (await t.state()).items.length
  assert.equal(await inTab(`fetch('swyr://settings').then((r) => r.status).catch(() => 'blocked')`) !== 200, true)
  await inTab(`window.open('swyr://settings'); window.open('file:///etc/hosts'); location.href = 'swyr://library'`)
  await sleep(1200)
  let s = await t.state()
  assert.ok(activeUrl(s).startsWith(webA), 'stayed on the web page: ' + activeUrl(s))
  assert.equal(s.items.length, before, 'no tab opened')
  await inTab(`location.href = 'file:///etc/hosts'`)
  await sleep(1000)
  assert.ok(!/^file:/.test(activeUrl(await t.state())))

  step('4. dangerous URLs refused by the command layer')
  assert.equal(await t.dispatch('tab.navigate', { url: 'javascript:document.title="pwned"' }), false)
  assert.equal(await t.dispatch('tab.navigate', { url: 'vbscript:msgbox(1)' }), false)
  await sleep(500)
  assert.notEqual(await inTab('document.title'), 'pwned')
  assert.equal(await t.dispatch('link.openExternal', { url: 'file:///etc/passwd' }), false)
  assert.equal(await t.dispatch('link.openExternal', { url: 'javascript:1' }), false)
  assert.equal(await t.dispatch('link.openExternal', { url: 'mailto:someone@example.com' }), true)

  step('5. no bridge on web pages; internal pages are limited')
  const bridge = JSON.parse(await inTab(`JSON.stringify({ swyr: typeof window.swyr, ipc: typeof window.ipcRenderer, req: typeof window.require, proc: typeof window.process })`))
  assert.deepEqual(bridge, { swyr: 'undefined', ipc: 'undefined', req: 'undefined', proc: 'undefined' })
  await open('swyr://settings', 'settings tab 2')
  await sleep(600)
  const limited = await inTab(`Promise.all([
    window.swyr.invoke('page.runJs', { js: '1' }).then(() => 'ran', () => 'refused'),
    window.swyr.invoke('window.newIncognito').then(() => 'ran', () => 'refused'),
    window.swyr.invoke('tab.new', { url: 'file:///etc/hosts' }).then(() => 'ran', () => 'refused'),
    window.swyr.invoke('tab.new', { url: 'javascript:1' }).then(() => 'ran', () => 'refused'),
    window.swyr.invoke('tab.navigate', { url: 'data:text/html,<script>1</script>' }).then(() => 'ran', () => 'refused')
  ]).then((r) => r.join(','))`)
  assert.equal(limited, 'refused,refused,refused,refused,refused')

  step('6. secrets stay out of renderers and state.json')
  await assert.rejects(t.dispatch('settings.set', { githubToken: 'ghp_SECURITY_TEST_TOKEN_123' }))
  await assert.rejects(t.dispatch('settings.set', { key: 'githubToken', value: 'ghp_SECURITY_TEST_TOKEN_123' }))
  assert.equal(await t.dispatch('liveFolder.setToken', { token: 'ghp_SECURITY_TEST_TOKEN_123' }), true)
  assert.equal(await t.dispatch('liveFolder.hasToken'), true)
  await sleep(800)
  const rendererState = await inTab(`window.swyr.getState().then((st) => JSON.stringify({ leak: JSON.stringify(st).includes('ghp_SECURITY'), has: st.secrets && st.secrets.githubToken }))`)
  assert.deepEqual(JSON.parse(rendererState), { leak: false, has: true })
  assert.ok(!fs.readFileSync(path.join(t.userData, 'state.json'), 'utf8').includes('ghp_SECURITY'))
  const secretsFile = path.join(t.userData, 'secrets.bin')
  assert.ok(fs.existsSync(secretsFile), 'secrets.bin written')
  assert.ok(!fs.readFileSync(secretsFile, 'utf8').includes('ghp_SECURITY'), 'secrets.bin is not plaintext')

  step('7. permission requests prompt in the overlay and are remembered')
  await open(webA, 'web tab 3')
  const ask = `Notification.requestPermission().then((p) => { document.title = 'perm:' + p })`
  await inTab(ask)
  s = await t.waitFor((s) => s.windows[0].overlay?.kind === 'permission', 'permission prompt', 8000)
  assert.equal(s.windows[0].overlay.permission, 'notifications')
  assert.equal(s.windows[0].overlay.origin, `http://127.0.0.1:${port}`)
  await t.capture(path.join(out, 'security-permission-prompt.png'))
  assert.equal(await t.dispatch('permission.respond', { allow: false }), true)
  await sleep(600)
  assert.equal(await inTab('document.title'), 'perm:denied')
  assert.equal((await t.state()).windows[0].overlay, null)
  assert.equal((await t.state()).settings.sitePermissions[`http://127.0.0.1:${port}`].notifications, 'deny')
  // remembered: the second request is answered without a prompt
  await inTab(`document.title = 'again'`)
  await inTab(ask)
  await sleep(600)
  assert.equal(await inTab('document.title'), 'perm:denied')
  assert.notEqual((await t.state()).windows[0].overlay?.kind, 'permission')
  // another origin: Allow grants it
  await open(webB, 'second origin')
  await inTab(ask)
  await t.waitFor((s) => s.windows[0].overlay?.kind === 'permission', 'second prompt', 8000)
  await t.dispatch('permission.respond', { allow: true })
  await sleep(600)
  assert.equal(await inTab('document.title'), 'perm:granted')
  // Site Settings reset forgets the decision
  await t.dispatch('siteSettings.setPermission', { origin: `http://localhost:${port}`, permission: 'notifications', value: null })
  assert.equal((await t.state()).settings.sitePermissions?.[`http://localhost:${port}`], undefined)
  console.log('security ok')
} finally {
  await t.close()
  server.close()
}

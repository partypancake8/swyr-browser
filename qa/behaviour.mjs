// Behaviour suite: end-to-end checks of what a person does in swyr, through the real input path where possible
// (key and mouse events sent into the shell, overlay and page contents, so before-input-event and the renderers see
// them as they would from the keyboard). One hidden launch against a temporary profile and a local HTTP server.
// Writes qa/out/behaviour-results.json as {"checks":[{"name","pass","detail"}]} and exits 0 whenever the suite ran.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { launch, repo, sleep } from '../tests/harness.mjs'

process.env.SWYR_WARM_TABS ??= '2'
const outDir = path.join(repo, 'qa/out')
fs.mkdirSync(outDir, { recursive: true })
const resultsFile = path.join(outDir, 'behaviour-results.json')

// ----- local pages
const html = (title, body = '') => `<!doctype html><title>${title}</title><h1>${title}</h1>${body}`
const pages = {
  '/find': html('Find', '<p>apple one</p><p>apple two</p><p>apple three</p>'),
  '/blank': html('Blank links', '<a id="nw" href="/p/Opened" target="_blank">open in new</a>'),
  '/download': html('Download', '<a id="dl" href="/file.txt">get the file</a>'),
  '/perm': html('Permission')
}
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x')
  if (u.pathname === '/file.txt') {
    res.writeHead(200, { 'content-type': 'text/plain', 'content-disposition': 'attachment; filename="behaviour-file.txt"' })
    return res.end('hello from the behaviour suite')
  }
  if (u.pathname.startsWith('/p/')) {
    const name = decodeURIComponent(u.pathname.slice(3))
    res.writeHead(200, { 'content-type': 'text/html' })
    return res.end(html(name, `<p>page ${name}</p>`))
  }
  const body = pages[u.pathname]
  res.writeHead(body ? 200 : 404, { 'content-type': 'text/html' })
  res.end(body ?? 'no')
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const PORT = server.address().port
const A = (p) => `http://127.0.0.1:${PORT}${p}`
const B = (p) => `http://localhost:${PORT}${p}`

const checks = []
function save() {
  fs.writeFileSync(resultsFile, JSON.stringify({ checks }, null, 2) + '\n')
}

let t
try {
  t = await launch({ log: process.env.SWYR_TEST_LOG === '1' })
} catch (err) {
  checks.push({ name: 'app launches', pass: false, detail: String(err?.message ?? err).slice(0, 400) })
  save()
  server.close()
  console.log('behaviour: the app did not launch')
  process.exit(0)
}

const ev = (fn, arg) => t.app.evaluate(fn, arg)
const win = (s) => s.windows[0]
const active = (s) => s.items.find((i) => i.id === win(s).activeItemId)
const itemByUrl = (s, part) => s.items.find((i) => i.kind === 'tab' && (i.url || '').includes(part))

/** send input events to 'page' (the active tab or focused pane), 'shell' or 'overlay' of the first window */
const send = (target, events) => ev((_e, [target, evs]) => globalThis.__swyr.sendInput(target, evs), [target, events])

const key = (keyCode, modifiers = []) => [
  { type: 'keyDown', keyCode, modifiers },
  { type: 'keyUp', keyCode, modifiers }
]
const typeText = (text) => [...text].map((ch) => ({ type: 'char', keyCode: ch }))
const enter = (modifiers = []) => [{ type: 'keyDown', keyCode: 'Return', modifiers }, { type: 'char', keyCode: '\r', modifiers }, { type: 'keyUp', keyCode: 'Return', modifiers }]
const escape = () => [{ type: 'keyDown', keyCode: 'Escape' }, { type: 'keyUp', keyCode: 'Escape' }]

/** press a key on the page until the state shows its effect (a key sent while a page swaps documents is lost) */
async function press(target, keyCode, modifiers, pred, label, ms = 4000) {
  for (let attempt = 1; ; attempt++) {
    assert.ok(await send(target, key(keyCode, modifiers)), target + ' ready for ' + label)
    try {
      return await t.waitFor(pred, label, ms)
    } catch (err) {
      if (attempt >= 2) throw err
    }
  }
}

const wcJs = (prefix, code) =>
  ev(async ({ webContents }, [p, c]) => {
    const wc = webContents.getAllWebContents().find((w) => !w.isDestroyed() && w.getURL().startsWith(p))
    return wc ? wc.executeJavaScript(c, true) : '__no_contents__'
  }, [prefix, code])
const shellJs = (code) => wcJs('swyr://shell', code)
const overlayJs = (code) => wcJs('swyr://overlay', code)
async function tabEval(code) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await ev((_e, c) => globalThis.__swyr.evalInActiveTab(c), code)
    } catch (err) {
      if (attempt >= 4 || !/disposed|Script failed|destroyed/i.test(String(err?.message))) throw err
      await sleep(500)
    }
  }
}
/** which contents has keyboard focus: 'page', 'overlay', 'shell' or null */
const focusOf = () => ev(() => globalThis.__swyr.focusedTarget())

async function open(url) {
  const id = await t.dispatch('tab.new', { url })
  await t.waitFor((s) => {
    const it = s.items.find((i) => i.id === id)
    return it && it.title && !win(s).tabs[id]?.loading
  }, 'loaded ' + url)
  await t.waitIdle()
  return id
}
const loadedActive = (part) => (s) => active(s)?.url?.includes(part) && !win(s).tabs[win(s).activeItemId]?.loading

async function check(name, fn) {
  const t0 = Date.now()
  try {
    const detail = await fn()
    checks.push({ name, pass: true, detail: (detail ? String(detail) + '; ' : '') + `${Date.now() - t0} ms` })
    console.log(`PASS ${name}`)
  } catch (err) {
    const detail = String(err?.message ?? err).replace(/\s+/g, ' ').slice(0, 500)
    checks.push({ name, pass: false, detail })
    console.log(`FAIL ${name}: ${detail}`)
    // leave the window in a known state for the next check
    await t.dispatch('overlay.close').catch(() => null)
  }
  save()
}

try {
  let s = await t.waitFor((s) => s.windows?.length === 1 && s.spaces.length === 1, 'initial state')
  await t.dispatch('space.edit', { theme: { appearance: 'light' } })
  const home = s.spaces[0].id
  await open(A('/p/Start'))

  await check('new tab: Cmd+T, type a URL, Enter opens it in a new tab', async () => {
    s = await t.state()
    const before = s.items.filter((i) => i.kind === 'tab').length
    await press('page', 'T', ['meta'], (s) => win(s).overlay?.kind === 'commandbar' && win(s).overlay.mode === 'new', 'cmd+t opens the bar in new-tab mode')
    await sleep(400)
    assert.ok(await send('overlay', typeText(A('/p/Typed'))), 'overlay ready')
    await sleep(500)
    assert.ok(await send('overlay', enter()), 'overlay ready for Enter')
    s = await t.waitFor(loadedActive('/p/Typed'), 'typed URL loaded in the active tab', 8000)
    assert.equal(s.items.filter((i) => i.kind === 'tab').length, before + 1, 'one more tab')
    assert.equal(win(s).overlay, null, 'bar closed')
  })

  await check('close tab: Cmd+W closes the active tab', async () => {
    s = await t.state()
    const id = win(s).activeItemId
    await press('page', 'W', ['meta'], (s) => !s.items.some((i) => i.id === id), 'cmd+w closed it')
  })

  await check('reopen closed tab: Cmd+Shift+T brings it back', async () => {
    await press('page', 'T', ['meta', 'shift'], (s) => active(s)?.url?.includes('/p/Typed'), 'cmd+shift+t reopened the closed tab')
  })

  await check('reopen closed tab: the tab returns to its place in the list', async () => {
    const order = (s) => s.items.filter((i) => i.kind === 'tab' && i.section === 'today' && i.spaceId === home && !i.parentId).sort((a, b) => a.order - b.order).map((i) => i.url)
    const ids = [await open(A('/p/RA')), await open(A('/p/RB')), await open(A('/p/RC'))]
    await t.dispatch('tab.activate', { id: ids[1] })
    await t.waitFor(loadedActive('/p/RB'), 'middle tab active')
    s = await t.state()
    const before = order(s)
    await press('page', 'W', ['meta'], (s) => !s.items.some((i) => i.id === ids[1]), 'closed the middle tab')
    s = await press('page', 'T', ['meta', 'shift'], (s) => active(s)?.url?.includes('/p/RB'), 'reopened it')
    assert.deepEqual(order(s), before, 'same order as before the close')
  })

  await check('new tab: Cmd+T then Esc leaves the tabs as they were', async () => {
    s = await t.state()
    const before = s.items.filter((i) => i.kind === 'tab').length
    const was = win(s).activeItemId
    await press('page', 'T', ['meta'], (s) => win(s).overlay?.kind === 'commandbar', 'cmd+t opens the bar')
    await sleep(300)
    await send('overlay', typeText('abc'))
    await sleep(200)
    await send('overlay', escape())
    s = await t.waitFor((s) => win(s).overlay === null, 'esc closed the bar', 4000)
    assert.equal(s.items.filter((i) => i.kind === 'tab').length, before, 'no tab added')
    assert.equal(win(s).activeItemId, was, 'same tab active')
    await sleep(300)
    assert.equal(await focusOf(), 'page', 'focus back on the page')
  })

  let tabs
  await check('tab switching: Cmd+Alt+Down/Up and Cmd+N move between tabs', async () => {
    await open(A('/p/Two'))
    await open(A('/p/Three'))
    s = await t.state()
    const today = s.items.filter((i) => i.section === 'today' && i.spaceId === home && !i.parentId).sort((a, b) => a.order - b.order)
    tabs = today.map((i) => i.id)
    const cur = win(s).activeItemId
    const idx = tabs.indexOf(cur)
    assert.ok(idx >= 0, 'active tab is in Today')
    // previous then next
    s = await press('page', 'Up', ['meta', 'alt'], (s) => win(s).activeItemId !== cur, 'cmd+alt+up moved')
    const prev = win(s).activeItemId
    await press('page', 'Down', ['meta', 'alt'], (s) => win(s).activeItemId === cur, 'cmd+alt+down came back')
    // Cmd+1 goes to the first sidebar item
    s = await press('page', '1', ['meta'], (s) => win(s).activeItemId !== cur, 'cmd+1 moved')
    return `prev ${prev.slice(0, 6)}, cmd+1 ${win(s).activeItemId.slice(0, 6)}`
  })

  await check('command bar: Cmd+L, type, Esc closes it and the page has focus again', async () => {
    const id = await open(A('/p/Focus'))
    await t.dispatch('tab.activate', { id })
    await t.waitIdle()
    // put focus in the page first, the way a click would
    await send('page', [{ type: 'mouseDown', x: 200, y: 200, button: 'left', clickCount: 1 }, { type: 'mouseUp', x: 200, y: 200, button: 'left', clickCount: 1 }])
    await sleep(200)
    await press('page', 'L', ['meta'], (s) => win(s).overlay?.kind === 'commandbar' && win(s).overlay.mode === 'current', 'cmd+l opens the bar on this tab')
    await sleep(400)
    assert.equal(await focusOf(), 'overlay', 'the bar has focus while open')
    await send('overlay', typeText('zzz'))
    await sleep(300)
    const typed = await overlayJs(`document.activeElement?.value ?? ''`)
    assert.ok(String(typed).includes('zzz'), 'typed text is in the bar: ' + typed)
    await send('overlay', escape())
    s = await t.waitFor((s) => win(s).overlay === null, 'esc closed the bar', 4000)
    assert.ok(active(s).url.includes('/p/Focus'), 'still on the same page')
    await sleep(300)
    const f = await focusOf()
    assert.equal(f, 'page', 'focus returned to the page')
    // and keys typed now reach the page
    await tabEval(`window.__keys = ''; document.addEventListener('keydown', (e) => (window.__keys += e.key)); true`)
    await send('page', key('X'))
    await sleep(300)
    assert.equal(await tabEval('window.__keys'), 'x', 'the page receives the next key')
  })

  await check('find bar: typing keeps the text and Enter cycles matches', async () => {
    await open(A('/find'))
    await press('page', 'F', ['meta'], (s) => win(s).overlay?.kind === 'find', 'cmd+f opens find')
    await sleep(400)
    // type one key at a time, like a person, with state pushes coming back between keys
    for (const ch of 'apple') {
      await send('overlay', typeText(ch))
      await sleep(120)
    }
    s = await t.waitFor((s) => win(s).overlay?.kind === 'find' && win(s).overlay.matches === 3, 'three matches', 5000)
    const value = await overlayJs(`document.querySelector('input[aria-label="Find"]').value`)
    assert.equal(value, 'apple', 'the field keeps every typed letter')
    const first = win(s).overlay.active
    await send('overlay', enter())
    s = await t.waitFor((s) => win(s).overlay?.active === (first % 3) + 1, 'enter goes to the next match', 4000)
    await send('overlay', enter())
    s = await t.waitFor((s) => win(s).overlay?.active === ((first + 1) % 3) + 1, 'enter again', 4000)
    await send('overlay', enter(['shift']))
    s = await t.waitFor((s) => win(s).overlay?.active === (first % 3) + 1, 'shift+enter goes back', 4000)
    assert.equal(await overlayJs(`document.querySelector('input[aria-label="Find"]').value`), 'apple', 'text kept after cycling')
    await send('overlay', escape())
    await t.waitFor((s) => win(s).overlay === null, 'esc closes find', 4000)
    await sleep(300)
    assert.equal(await focusOf(), 'page', 'focus back on the page after find')
  })

  await check('back and forward: Cmd+[ and Cmd+] walk the history', async () => {
    const id = await open(A('/p/HistOne'))
    await t.dispatch('tab.navigate', { itemId: id, url: A('/p/HistTwo') })
    await t.waitFor(loadedActive('/p/HistTwo'), 'second page')
    await t.waitIdle()
    await press('page', '[', ['meta'], loadedActive('/p/HistOne'), 'cmd+[ goes back', 6000)
    await t.waitIdle()
    await press('page', ']', ['meta'], loadedActive('/p/HistTwo'), 'cmd+] goes forward', 6000)
  })

  await check('pin and unpin: Cmd+D toggles the active tab into Pinned and back', async () => {
    const id = await open(A('/p/PinMe'))
    s = await press('page', 'D', ['meta'], (s) => s.items.find((i) => i.id === id)?.section === 'pinned', 'cmd+d pins')
    assert.ok(s.items.find((i) => i.id === id).pinnedUrl?.includes('/p/PinMe'), 'pinned URL recorded')
    await sleep(300)
    assert.equal(await shellJs(`Boolean(document.querySelector('[data-section="pinned"] [data-item="${id}"]'))`), true, 'row under Pinned')
    s = await press('page', 'D', ['meta'], (s) => s.items.find((i) => i.id === id)?.section === 'today', 'cmd+d again unpins')
    assert.equal(s.items.find((i) => i.id === id).pinnedUrl, null)
  })

  // drag helpers (real mouse events on the shell)
  const rectOf = async (selector) => {
    const r = await shellJs(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height } })()`)
    assert.ok(r && r !== '__no_contents__', 'no element for ' + selector)
    return r
  }
  async function drag(fromSel, toSel) {
    const a = await rectOf(fromSel)
    const sx = Math.round(a.x + a.w / 2)
    const sy = Math.round(a.y + a.h / 2)
    await send('shell', [
      { type: 'mouseMove', x: sx, y: sy },
      { type: 'mouseDown', x: sx, y: sy, button: 'left', clickCount: 1 },
      { wait: 60 },
      { type: 'mouseMove', x: sx + 3, y: sy + 3, modifiers: ['leftButtonDown'] },
      { wait: 30 },
      { type: 'mouseMove', x: sx + 8, y: sy + 8, modifiers: ['leftButtonDown'] },
      { wait: 120 }
    ])
    const b = await rectOf(toSel)
    const tx = Math.round(b.x + b.w / 2)
    const ty = Math.round(b.y + b.h / 2)
    const moves = []
    for (let i = 1; i <= 8; i++) moves.push({ type: 'mouseMove', x: Math.round(sx + ((tx - sx) * i) / 8), y: Math.round(sy + ((ty - sy) * i) / 8), modifiers: ['leftButtonDown'] }, { wait: 25 })
    await send('shell', [...moves, { wait: 120 }, { type: 'mouseMove', x: tx, y: ty, modifiers: ['leftButtonDown'] }, { wait: 120 }, { type: 'mouseUp', x: tx, y: ty, button: 'left', clickCount: 1 }])
    await sleep(400)
  }

  await check('move tab: drag a Today tab onto a folder, then move it to another space', async () => {
    const id = await open(A('/p/Mover'))
    const folder = await t.dispatch('folder.new', { name: 'Box', section: 'pinned' })
    await sleep(500)
    await drag(`[data-item="${id}"]`, `[data-item="${folder}"]`)
    s = await t.waitFor((s) => s.items.find((i) => i.id === id)?.parentId === folder, 'dropped into the folder', 5000)
    assert.equal(s.items.find((i) => i.id === id).section, 'pinned')
    const other = await t.dispatch('space.new', { name: 'Other', icon: 'leaf', activate: false })
    await sleep(400)
    await drag(`[data-item="${id}"]`, `[data-space="${other}"]`)
    s = await t.waitFor((s) => s.items.find((i) => i.id === id)?.spaceId === other, 'moved to the other space by drag', 5000)
    await t.dispatch('space.switch', { id: home })
    await t.waitFor((s) => win(s).activeSpaceId === home, 'home again')
  })

  await check('split view: Ctrl+Shift+= opens, Ctrl+Shift+] moves focus, Ctrl+Shift+- closes', async () => {
    const left = await open(A('/p/LeftPane'))
    await t.dispatch('tab.activate', { id: left })
    await t.waitIdle()
    s = await press('page', '=', ['control', 'shift'], (s) => active(s)?.kind === 'split', 'ctrl+shift+= made a split', 6000)
    const split = active(s)
    assert.equal(split.panes.itemIds.length, 2, 'two panes')
    await t.waitIdle()
    await sleep(500)
    const pane0 = win(s).focusedPane
    s = await press('page', ']', ['control', 'shift'], (s) => win(s).focusedPane !== pane0, 'ctrl+shift+] moved focus')
    await sleep(300)
    assert.equal(await focusOf(), 'page', 'keyboard focus is in the focused pane')
    const p1 = win(s).focusedPane
    s = await press('page', '[', ['control', 'shift'], (s) => win(s).focusedPane !== p1, 'ctrl+shift+[ moved focus back')
    s = await press('page', '-', ['control', 'shift'], (s) => active(s)?.kind !== 'split', 'ctrl+shift+- closed the split', 6000)
    assert.equal(win(s).paneRects.length, 1, 'one pane left')
  })

  await check('download: clicking a download link saves the file and lists it in Downloads', async () => {
    await t.dispatch('downloads.setDirectory', { path: path.join(t.userData, 'dl') })
    await open(A('/download'))
    const r = await tabEval(`(() => { const a = document.getElementById('dl').getBoundingClientRect(); return { x: a.x + a.width / 2, y: a.y + a.height / 2 } })()`)
    await send('page', [
      { type: 'mouseMove', x: Math.round(r.x), y: Math.round(r.y) },
      { type: 'mouseDown', x: Math.round(r.x), y: Math.round(r.y), button: 'left', clickCount: 1 },
      { type: 'mouseUp', x: Math.round(r.x), y: Math.round(r.y), button: 'left', clickCount: 1 }
    ])
    s = await t.waitFor((s) => (s.downloads || []).some((d) => d.filename === 'behaviour-file.txt' && d.state === 'completed'), 'download completed', 10000)
    assert.equal(fs.readFileSync(path.join(t.userData, 'dl', 'behaviour-file.txt'), 'utf8'), 'hello from the behaviour suite')
    await t.dispatch('downloads.open', { show: true })
    await sleep(600)
    const shown = await shellJs(`document.body.innerText.includes('behaviour-file.txt')`)
    await t.dispatch('downloads.open', { show: false })
    assert.equal(shown, true, 'the downloads panel lists the file')
  })

  await check('rebound shortcut: a new key runs the command and the old key no longer does', async () => {
    const r = await t.dispatch('shortcuts.set', { id: 'tab.togglePin', accelerator: 'Cmd+Shift+Y' })
    assert.equal(r?.ok, true, 'rebound: ' + JSON.stringify(r))
    const id = await open(A('/p/Rebound'))
    await send('page', key('D', ['meta']))
    await sleep(800)
    assert.equal((await t.state()).items.find((i) => i.id === id).section, 'today', 'the old key does nothing')
    await press('page', 'Y', ['meta', 'shift'], (s) => s.items.find((i) => i.id === id)?.section === 'pinned', 'the new key pins')
    const menu = await ev(({ Menu }) => {
      const find = (items) => {
        for (const m of items) {
          if (m.label === 'Unpin Tab' || m.label === 'Pin Tab') return m.accelerator ?? null
          if (m.submenu) {
            const f = find(m.submenu.items)
            if (f !== undefined) return f
          }
        }
        return undefined
      }
      return find(Menu.getApplicationMenu().items)
    })
    await t.dispatch('shortcuts.reset', { id: 'tab.togglePin' })
    assert.equal(menu, 'Cmd+Shift+Y', 'the menu bar shows the new key')
    // a key another command owns is refused
    const clash = await t.dispatch('shortcuts.set', { id: 'tab.togglePin', accelerator: 'Cmd+W' })
    assert.equal(clash?.ok, false, 'a taken key is refused: ' + JSON.stringify(clash))
  })

  await check('target=_blank: clicking the link opens the page in a new foreground tab', async () => {
    const from = await open(A('/blank'))
    s = await t.state()
    const before = s.items.filter((i) => i.kind === 'tab').length
    const r = await tabEval(`(() => { const a = document.getElementById('nw').getBoundingClientRect(); return { x: a.x + a.width / 2, y: a.y + a.height / 2 } })()`)
    await send('page', [
      { type: 'mouseMove', x: Math.round(r.x), y: Math.round(r.y) },
      { type: 'mouseDown', x: Math.round(r.x), y: Math.round(r.y), button: 'left', clickCount: 1 },
      { type: 'mouseUp', x: Math.round(r.x), y: Math.round(r.y), button: 'left', clickCount: 1 }
    ])
    s = await t.waitFor((s) => itemByUrl(s, '/p/Opened'), 'a tab for the link', 6000)
    assert.equal(s.items.filter((i) => i.kind === 'tab').length, before + 1, 'exactly one new tab')
    s = await t.waitFor(loadedActive('/p/Opened'), 'the new tab is active and loaded', 6000)
    assert.ok(s.items.some((i) => i.id === from), 'the source tab stays')
  })

  await check('Cmd+click on a link opens it in a background tab', async () => {
    const from = await open(A('/blank'))
    await tabEval(`document.getElementById('nw').removeAttribute('target'); document.getElementById('nw').href = '/p/Background'; true`)
    const r = await tabEval(`(() => { const a = document.getElementById('nw').getBoundingClientRect(); return { x: a.x + a.width / 2, y: a.y + a.height / 2 } })()`)
    const x = Math.round(r.x)
    const y = Math.round(r.y)
    await send('page', [
      { type: 'mouseMove', x, y },
      { type: 'mouseDown', x, y, button: 'left', clickCount: 1, modifiers: ['meta'] },
      { type: 'mouseUp', x, y, button: 'left', clickCount: 1, modifiers: ['meta'] }
    ])
    s = await t.waitFor((s) => itemByUrl(s, '/p/Background'), 'a tab for the link', 6000)
    await sleep(500)
    s = await t.state()
    assert.equal(win(s).activeItemId, from, 'the source tab stays in front')
    assert.ok(active(s).url.includes('/blank'), 'the source page did not navigate')
  })

  await check('permission prompt: clicking Allow grants it and the answer sticks', async () => {
    await open(B('/perm'))
    const ask = `Notification.requestPermission().then((p) => { document.title = 'perm:' + p })`
    await tabEval(ask)
    s = await t.waitFor((s) => win(s).overlay?.kind === 'permission', 'permission prompt', 8000)
    assert.equal(win(s).overlay.permission, 'notifications')
    await sleep(500)
    const clicked = await overlayJs(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.innerText.trim() === 'Allow'); if (!b) return false; b.click(); return true })()`)
    assert.equal(clicked, true, 'an Allow button')
    await t.waitFor((s) => win(s).overlay === null, 'prompt closed', 4000)
    await sleep(400)
    assert.equal(await tabEval('document.title'), 'perm:granted')
    s = await t.state()
    assert.equal(s.settings.sitePermissions?.[B('')]?.notifications, 'allow', 'remembered for the site')
    // asked again after a reload: no prompt, still granted
    await t.dispatch('tab.reload')
    await t.waitFor((s) => !win(s).tabs[win(s).activeItemId]?.loading, 'reloaded')
    await t.waitIdle()
    await tabEval(`document.title = 'again'; ${ask}`)
    await sleep(800)
    assert.notEqual((await t.state()).windows[0].overlay?.kind, 'permission', 'no second prompt')
    assert.equal(await tabEval('document.title'), 'perm:granted')
  })

  await check('favorites: Opt+1 and Opt+2 open the first and second favorite', async () => {
    const f1 = await open(A('/p/FavOne'))
    await t.dispatch('tab.favorite', { id: f1 })
    const f2 = await open(A('/p/FavTwo'))
    await t.dispatch('tab.favorite', { id: f2 })
    s = await t.waitFor((s) => [f1, f2].every((id) => s.items.find((i) => i.id === id)?.section === 'favorites'), 'two favorites')
    const favs = s.items.filter((i) => i.section === 'favorites').sort((a, b) => a.order - b.order).map((i) => i.id)
    await open(A('/p/NotFav'))
    await press('page', '1', ['alt'], (s) => win(s).activeItemId === favs[0], 'opt+1 opens the first favorite')
    await t.waitIdle()
    await press('page', '2', ['alt'], (s) => win(s).activeItemId === favs[1], 'opt+2 opens the second favorite')
  })

  await check('sidebar: a long Today list scrolls so the last tab can be reached', async () => {
    for (let i = 0; i < 12; i++) await t.dispatch('tab.new', { url: A('/p/Filler' + i), background: true })
    s = await t.waitFor((s) => s.items.filter((i) => (i.url || '').includes('/p/Filler')).length === 12, 'twelve more tabs')
    const last = s.items.filter((i) => i.section === 'today' && i.spaceId === home && !i.parentId).sort((a, b) => a.order - b.order).at(-1).id
    await sleep(500)
    const probe = await shellJs(`(() => {
      const row = document.querySelector('[data-item="${last}"]')
      row.scrollIntoView({ block: 'center' })
      const b = row.getBoundingClientRect()
      const e = document.elementFromPoint(b.x + 24, b.y + b.height / 2)
      return { y: Math.round(b.y), h: innerHeight, reached: Boolean(e && row.contains(e)) }
    })()`)
    assert.ok(probe.reached, 'the last row is on screen and takes the pointer: ' + JSON.stringify(probe))
  })

  await check('close tab: the close button on a sidebar row closes that tab', async () => {
    const id = await open(A('/p/CloseByMouse'))
    await sleep(400)
    // a long Today list scrolls; bring the row on screen the way a person would scroll to it
    await shellJs(`document.querySelector('[data-item="${id}"]')?.scrollIntoView({ block: 'center' }); true`)
    // the overlay scrollbar shown by the scroll sits over the row's right edge until it fades
    await sleep(2000)
    const r = await rectOf(`[data-item="${id}"]`)
    const cx = Math.round(r.x + r.w / 2)
    const cy = Math.round(r.y + r.h / 2)
    await send('shell', [{ type: 'mouseMove', x: cx, y: cy }])
    await sleep(300)
    const btn = await shellJs(`(() => { const b = document.querySelector('[data-item="${id}"] button[aria-label="Archive tab"]'); if (!b) return null; const x = b.getBoundingClientRect(); return { x: x.x + x.width / 2, y: x.y + x.height / 2 } })()`)
    assert.ok(btn, 'a close button on the hovered row')
    await send('shell', [
      { type: 'mouseMove', x: Math.round(btn.x), y: Math.round(btn.y) },
      { type: 'mouseDown', x: Math.round(btn.x), y: Math.round(btn.y), button: 'left', clickCount: 1 },
      { type: 'mouseUp', x: Math.round(btn.x), y: Math.round(btn.y), button: 'left', clickCount: 1 }
    ])
    const hit = await shellJs(`(() => { try { const e = document.elementFromPoint(${Math.round(btn.x)}, ${Math.round(btn.y)}); let n = document.querySelector('[data-item="${id}"]'); const row = n.getBoundingClientRect(); while (n && !(n.scrollHeight > n.clientHeight + 1)) n = n.parentElement; const cls = (x) => (x && x.getAttribute && x.getAttribute('class') || '').slice(0, 70); return 'H=' + innerHeight + ' rowY=' + Math.round(row.y) + ' scroller=' + (n ? cls(n) + ' sbw=' + (n.offsetWidth - n.clientWidth) + ' rowR=' + Math.round(row.right) + ' st=' + n.scrollTop + ' sh=' + n.scrollHeight + ' ch=' + n.clientHeight + ' ov=' + getComputedStyle(n).overflowY : 'none') + ' | hit=' + (e ? e.tagName + ' ' + cls(e) + ' / ' + cls(e.parentElement) : 'none') } catch (err) { return 'probe error ' + err.message } })()`)
    await t.waitFor((s) => !s.items.some((i) => i.id === id), `tab closed by its button (button at ${Math.round(btn.x)},${Math.round(btn.y)}: ${hit})`, 4000)
  })
} catch (err) {
  checks.push({ name: 'suite ran to the end', pass: false, detail: String(err?.stack ?? err).slice(0, 500) })
  save()
} finally {
  await t.close()
  server.close()
}
save()
const failing = checks.filter((c) => !c.pass)
console.log(`behaviour: ${checks.length} checks, ${checks.length - failing.length} passed, ${failing.length} failed; results in ${path.relative(repo, resultsFile)}`)
process.exit(0)

// Feature parity proof: one headless launch that exercises every feature-table row marked "done" in the parity audit
// and prints `PARITY <row> ok` (or `PARITY <row> FAIL <reason>`). Pages come from a local HTTP server on two host names
// (127.0.0.1 and localhost are different sites), so nothing here needs the network.
// Usage: node tests/parity.mjs [repo]   (captures land in SWYR_TEST_OUT or a temporary folder)
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { launch, repo, sleep } from './harness.mjs'

const out = process.env.SWYR_TEST_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'swyr-parity-'))
fs.mkdirSync(out, { recursive: true })
const frame = (name) => path.join(out, name + '.png')
const fixtures = path.join(repo, 'tests/fixtures')

// ----- local pages
const pages = {
  '/article': `<!doctype html><title>Reader test article</title><nav>SIDEBAR NOISE menu menu</nav><article><h1>Reader test article</h1>
<p>First paragraph of the article body. It has enough words to count as content for a readability parser, so the parser keeps it.</p>
<p>Second paragraph of the article body. It also has plenty of words, with sentences that continue for a while so the scoring prefers it.</p>
<p>Third paragraph of the article body with more sentences to pad the length and make sure the article element wins.</p></article><aside>SIDEBAR NOISE related</aside>`,
  '/form': `<!doctype html><title>Form</title><h1>Form page</h1><textarea id="ta">the cat sat with another cat</textarea><input id="in" value="cat"><p>cat in text</p>`,
  '/links': `<!doctype html><title>Links</title><h1>Links</h1><a id="a" href="/p/Linked">a link</a>`,
  '/download': `<!doctype html><title>Download</title><a id="dl" href="/file.txt">get the file</a>`,
  '/styled': `<!doctype html><title>Styled</title><h1 id="zap" style="margin:40px;padding:20px;font-size:40px">Zap me</h1><p id="box">box</p><p>body text</p>`,
  '/media': `<!doctype html><title>Media</title><h1>Media</h1>`,
  '/feed.xml': `<?xml version="1.0"?><rss version="2.0"><channel><title>Feed</title>
<item><title>Feed one</title><link>http://127.0.0.1/p/one</link></item><item><title>Feed two</title><link>http://127.0.0.1/p/two</link></item></channel></rss>`
}
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x')
  if (u.pathname === '/file.txt') {
    res.writeHead(200, { 'content-type': 'text/plain', 'content-disposition': 'attachment; filename="parity-file.txt"' })
    return res.end('hello from swyr parity')
  }
  if (u.pathname.startsWith('/p/') || u.pathname === '/search') {
    const name = decodeURIComponent(u.pathname.slice(3)) || 'Search ' + (u.searchParams.get('q') ?? '')
    res.writeHead(200, { 'content-type': 'text/html' })
    return res.end(`<!doctype html><title>${name}</title><h1>${name}</h1><p>page ${name} text</p>`)
  }
  const body = pages[u.pathname]
  if (!body) {
    res.writeHead(404)
    return res.end('no')
  }
  res.writeHead(200, { 'content-type': u.pathname.endsWith('.xml') ? 'application/rss+xml' : 'text/html' })
  res.end(body)
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const PORT = server.address().port
const A = (p) => `http://127.0.0.1:${PORT}${p}`
const B = (p) => `http://localhost:${PORT}${p}`

// ----- the app
// a small warm cache keeps the renderer process count low (some machines cap helper processes per app)
process.env.SWYR_WARM_TABS ??= '2'
const t = await launch({ log: process.env.SWYR_TEST_LOG === '1' })
const ev = (fn, arg) => t.app.evaluate(fn, arg)
const failed = []
const passed = []
async function row(n, fn) {
  try {
    await fn()
    passed.push(n)
    console.log(`PARITY ${n} ok`)
  } catch (err) {
    failed.push(n)
    console.log(`PARITY ${n} FAIL ${String(err?.message ?? err).replace(/\s+/g, ' ').slice(0, 400)}`)
  }
}
const win = (s) => s.windows[0]
const active = (s, w = win(s)) => s.items.find((i) => i.id === w.activeItemId)
const byUrl = (s, part) => s.items.find((i) => (i.url || '').includes(part))
const wcJs = (prefix, code) =>
  ev(async ({ webContents }, [p, c]) => {
    const wc = webContents.getAllWebContents().find((w) => !w.isDestroyed() && w.getURL().startsWith(p))
    return wc ? wc.executeJavaScript(c, true) : '__no_contents__'
  }, [prefix, code])
const shellJs = (code) => wcJs('swyr://shell', code)
const overlayJs = (code) => wcJs('swyr://overlay', code)
/** run JS in the active tab; retried while a page is between documents */
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
const dispatchIn = (id, command, payload) => ev((_e, a) => globalThis.__swyr.dispatchIn(a.id, a.command, a.payload), { id, command, payload })
const send = (prefix, events) =>
  ev(async ({ webContents }, [p, evs]) => {
    for (let i = 0; i < 100; i++) {
      const wc = webContents.getAllWebContents().find((w) => !w.isDestroyed() && w.getURL().startsWith(p))
      if (wc && !wc.isLoading()) {
        for (const e of evs) {
          if (e.wait) await new Promise((r) => setTimeout(r, e.wait))
          else wc.sendInputEvent(e)
        }
        return true
      }
      await new Promise((r) => setTimeout(r, 100))
    }
    return false
  }, [prefix, events])
const keyEvents = (keyCode, modifiers = []) => [
  { type: 'keyDown', keyCode, modifiers },
  { type: 'keyUp', keyCode, modifiers }
]
/** press a key on the shell until the state shows its effect (a key sent while the shell reloads is lost) */
async function press(keyCode, modifiers, pred, label) {
  for (let attempt = 1; ; attempt++) {
    assert.ok(await send('swyr://shell', keyEvents(keyCode, modifiers)), 'shell ready for ' + label)
    try {
      return await t.waitFor(pred, label, 4000)
    } catch (err) {
      if (attempt >= 3) throw err
    }
  }
}
/** a non-raw shortcut is a menu accelerator; hidden windows get no key equivalents, so click the menu item it is bound to */
async function menuKey(accel, pred, label) {
  const ok = await ev(({ Menu }, a) => {
    const find = (items) => {
      for (const m of items) {
        if (m.accelerator === a && m.enabled) return m
        if (m.submenu) {
          const f = find(m.submenu.items)
          if (f) return f
        }
      }
      return null
    }
    const m = find(Menu.getApplicationMenu().items)
    if (!m) return false
    m.click()
    return true
  }, accel)
  assert.ok(ok, 'a menu item carries ' + accel)
  return t.waitFor(pred, label, 5000)
}
async function open(url, extra = {}) {
  const id = await t.dispatch('tab.new', { url, ...extra })
  await t.waitFor((s) => {
    const it = s.items.find((i) => i.id === id)
    return it && it.title && !win(s).tabs[id]?.loading
  }, 'loaded ' + url)
  return id
}
const clip = () => ev(async ({ clipboard }) => await clipboard.readText())

try {
  let s = await t.waitFor((s) => s.windows?.length === 1 && s.spaces.length === 1, 'initial state')
  await t.dispatch('space.edit', { theme: { appearance: 'light' } })
  const home = s.spaces[0].id
  const personal = s.profiles[0]
  const alpha = await open(A('/p/Alpha'))

  await row(1, async () => {
    s = await t.state()
    assert.equal(await shellJs(`Boolean(document.querySelector('[data-sidebar-root] [data-section="today"] [data-item="${alpha}"]'))`), true, 'tab row in the sidebar')
    assert.ok(win(s).paneRects[0].x >= s.settings.sidebarWidth, 'page starts right of the sidebar')
    assert.equal(await shellJs(`Boolean(document.querySelector('[data-space]'))`), true, 'space switcher')
    await sleep(400)
    assert.ok(await t.capture(frame('r01-sidebar')))
  })

  await row(26, async () => {
    const shown = await shellJs(`[...document.querySelectorAll('[data-sidebar-root] button')].find((b) => b.title === ${JSON.stringify(A('/p/Alpha'))})?.innerText ?? ''`)
    assert.match(shown, /127\.0\.0\.1/, 'URL field shows the host: ' + shown)
    await shellJs(`[...document.querySelectorAll('[data-sidebar-root] button')].find((b) => b.title === ${JSON.stringify(A('/p/Alpha'))}).click()`)
    s = await t.waitFor((s) => win(s).overlay?.kind === 'commandbar' && win(s).overlay.mode === 'current', 'clicking the URL field opens the bar on this tab')
    assert.equal(win(s).overlay.query, A('/p/Alpha'))
    await t.dispatch('commandbar.close')
  })

  await row(2, async () => {
    assert.equal(await menuKey('Cmd+S', (s) => !win(s).sidebarVisible, 'cmd+s hides').then((s) => win(s).sidebarVisible), false)
    s = await t.state()
    assert.ok(win(s).paneRects[0].x < 20, 'page fills the window: x=' + win(s).paneRects[0].x)
    await sleep(300)
    assert.ok(await t.capture(frame('r02-sidebar-hidden')))
  })

  await row(3, async () => {
    // a synthetic pointer move over the 6 px hot zone at the left edge reveals the sidebar as an overlay
    await send('swyr://shell', [{ type: 'mouseMove', x: 40, y: 300 }, { wait: 50 }, { type: 'mouseMove', x: 2, y: 300 }])
    s = await t.waitFor((s) => win(s).overlay?.kind === 'sidebar', 'hover reveal')
    await sleep(400)
    assert.ok(await t.capture(frame('r03-hover-reveal')))
    await t.dispatch('sidebar.peek', { show: false })
    s = await t.waitFor((s) => !win(s).overlay, 'hides again')
    await t.dispatch('sidebar.toggle')
    await t.waitFor((s) => win(s).sidebarVisible, 'sidebar back')
  })

  let work
  await row(4, async () => {
    work = await t.dispatch('space.new', { name: 'Work', emoji: '💼' })
    s = await t.waitFor((s) => win(s).activeSpaceId === work, 'work active')
    const wt = await open(A('/p/WorkTab'))
    await t.dispatch('tab.pin', { id: wt })
    await press('1', ['control'], (s) => win(s).activeSpaceId === home, 'ctrl+1')
    await sleep(300)
    assert.equal(await shellJs(`Boolean(document.querySelector('[data-item="${wt}"]'))`), false, 'other space tabs hidden')
    await press('2', ['control'], (s) => win(s).activeSpaceId === work, 'ctrl+2')
    s = await t.state()
    assert.equal(s.items.find((i) => i.id === wt).spaceId, work)
  })

  await row(6, async () => {
    await sleep(300)
    const txt = await shellJs(`document.querySelector('[data-space="${work}"]')?.innerText ?? ''`)
    assert.ok(txt.includes('💼'), 'switcher shows the emoji: ' + txt)
  })

  await row(5, async () => {
    await t.dispatch('space.edit', { id: work, theme: { colors: ['#ff8a65', '#ba68c8', '#4fc3f7'], angle: 135, noise: 0.2, appearance: 'light' } })
    await sleep(500)
    const bg = await shellJs(`getComputedStyle(document.querySelector('.space-bg')).backgroundImage`)
    assert.match(bg, /linear-gradient\(135deg/, bg)
    assert.equal((bg.match(/rgb\(/g) || []).length, 3, 'three colour stops: ' + bg)
    assert.ok(await t.capture(frame('r05-gradient')))
  })

  await row(65, async () => {
    const op = () => shellJs(`[...document.querySelectorAll('[data-noise], .noise')].map((e) => getComputedStyle(e).opacity).join()`)
    await t.dispatch('space.edit', { id: work, theme: { noise: 0 } })
    await sleep(400)
    const none = await op()
    await t.dispatch('space.edit', { id: work, theme: { noise: 0.8 } })
    await sleep(400)
    const lots = await op()
    assert.ok(Number(lots) > Number(none || 0), `noise opacity follows the slider: ${none} -> ${lots}`)
  })

  await row(63, async () => {
    await t.dispatch('space.edit', { id: work, theme: { appearance: 'dark' } })
    await sleep(400)
    assert.match(await shellJs(`document.documentElement.className`), /dark/)
    await t.dispatch('space.edit', { id: work, theme: { appearance: 'light' } })
    await sleep(400)
    assert.doesNotMatch(await shellJs(`document.documentElement.className`), /dark/)
  })

  await row(64, async () => {
    await t.dispatch('space.edit', { id: work, theme: { appearance: 'auto' } })
    await ev(({ nativeTheme }) => (nativeTheme.themeSource = 'dark'))
    await sleep(600)
    assert.match(await shellJs(`document.documentElement.className`), /dark/, 'follows a dark system')
    await ev(({ nativeTheme }) => (nativeTheme.themeSource = 'light'))
    await sleep(600)
    assert.doesNotMatch(await shellJs(`document.documentElement.className`), /dark/, 'follows a light system')
    await ev(({ nativeTheme }) => (nativeTheme.themeSource = 'system'))
    await t.dispatch('space.edit', { id: work, theme: { appearance: 'light' } })
  })

  await row(7, async () => {
    s = await t.state()
    const before = win(s).activeSpaceId
    const r = await shellJs(`(() => { const b = document.querySelector('[data-sidebar-root]').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 } })()`)
    const wheel = []
    for (let i = 0; i < 12; i++) wheel.push({ type: 'mouseWheel', x: Math.round(r.x), y: Math.round(r.y), deltaX: -30, deltaY: 0, hasPreciseScrollingDeltas: true }, { wait: 16 })
    await send('swyr://shell', wheel)
    await t.waitFor((s) => win(s).activeSpaceId !== before, 'swiped to the other space')
  })

  await row(8, async () => {
    s = await t.state()
    const before = win(s).activeSpaceId
    await press('Right', ['meta', 'alt'], (s) => win(s).activeSpaceId !== before, 'cmd+opt+right')
    await press('Left', ['meta', 'alt'], (s) => win(s).activeSpaceId === before, 'cmd+opt+left')
  })

  let alt
  await row(10, async () => {
    await t.dispatch('profile.new', { name: 'Alt' })
    s = await t.waitFor((s) => s.profiles.length === 2, 'second profile')
    alt = s.profiles[1]
    assert.notEqual(alt.partition, personal.partition)
    const seen = await ev(async ({ session }, [p1, p2, url]) => {
      await session.fromPartition(p1).cookies.set({ url, name: 'swyrparity', value: '1' })
      const a = await session.fromPartition(p1).cookies.get({ name: 'swyrparity' })
      const b = await session.fromPartition(p2).cookies.get({ name: 'swyrparity' })
      return [a.length, b.length]
    }, [personal.partition, alt.partition, A('/')])
    assert.deepEqual(seen, [1, 0], 'cookies stay in their profile')
  })

  await row(9, async () => {
    await t.dispatch('space.edit', { id: work, profileId: alt.id })
    await t.dispatch('space.switch', { id: work })
    await open(A('/p/AltTab'))
    const part = await ev(() => globalThis.__swyr.activePartition())
    assert.ok(part.includes(alt.id), 'tab runs in the Alt profile: ' + part)
  })

  let side
  await row(11, async () => {
    await t.dispatch('space.switch', { id: home })
    await t.dispatch('tab.favorite', { id: alpha })
    s = await t.waitFor((s) => s.items.find((i) => i.id === alpha).section === 'favorites', 'favorited')
    assert.equal(s.items.find((i) => i.id === alpha).spaceId, null)
    await open(A('/p/Other'))
    await menuKey('Cmd+1', (s) => win(s).activeItemId === alpha, 'cmd+1 opens the first favorite')
    side = await t.dispatch('space.new', { name: 'Side', emoji: '🌿' })
    await sleep(500)
    assert.equal(await shellJs(`Boolean(document.querySelector('[data-section="favorites"] [data-item="${alpha}"]'))`), true, 'favorite shared with another space of the profile')
    await t.dispatch('space.switch', { id: work })
    await sleep(500)
    assert.equal(await shellJs(`Boolean(document.querySelector('[data-item="${alpha}"]'))`), false, 'not shown in a space of another profile')
    await t.dispatch('space.switch', { id: home })
  })

  let pinned
  await row(12, async () => {
    pinned = await open(A('/p/Pinned'))
    await menuKey('Cmd+D', (s) => s.items.find((i) => i.id === pinned).section === 'pinned', 'cmd+d pins')
    s = await t.state()
    const it = s.items.find((i) => i.id === pinned)
    assert.equal(it.pinnedUrl, A('/p/Pinned'))
    assert.equal(it.spaceId, home)
    await sleep(300)
    assert.equal(await shellJs(`Boolean(document.querySelector('[data-section="pinned"] [data-item="${pinned}"]'))`), true)
  })

  await row(13, async () => {
    const id = await open(A('/p/TodayTab'))
    s = await t.state()
    assert.equal(s.items.find((i) => i.id === id).section, 'today')
    await sleep(300)
    assert.equal(await shellJs(`Boolean(document.querySelector('[data-section="today"] [data-item="${id}"]'))`), true)
  })

  await row(17, async () => {
    await t.dispatch('folder.new', { name: 'Research', section: 'pinned' })
    s = await t.waitFor((s) => s.items.some((i) => i.kind === 'folder' && i.title === 'Research'), 'folder')
    const folder = s.items.find((i) => i.kind === 'folder' && i.title === 'Research')
    await t.dispatch('folder.new', { name: 'Inner', section: 'pinned', parentId: folder.id })
    s = await t.waitFor((s) => s.items.some((i) => i.kind === 'folder' && i.title === 'Inner' && i.parentId === folder.id), 'nested folder')
    const tab = await open(A('/p/InFolder'))
    await t.dispatch('tab.move', { itemId: tab, section: 'pinned', parentId: folder.id, index: 0 })
    s = await t.waitFor((s) => s.items.find((i) => i.id === tab).parentId === folder.id, 'tab in folder')
    await t.dispatch('folder.toggle', { itemId: folder.id })
    s = await t.waitFor((s) => s.items.find((i) => i.id === folder.id).collapsed === true, 'collapsed')
    await sleep(300)
    assert.equal(await shellJs(`Boolean(document.querySelector('[data-item="${tab}"]'))`), false, 'collapsed folder hides its tabs')
    await t.dispatch('folder.toggle', { itemId: folder.id })
  })

  await row(18, async () => {
    const x = await open(A('/p/OrderX'))
    const y = await open(A('/p/OrderY'))
    await t.dispatch('tab.move', { itemId: y, section: 'today', index: 0 })
    s = await t.state()
    const today = s.items.filter((i) => i.section === 'today' && i.spaceId === home && !i.parentId).sort((a, b) => a.order - b.order)
    assert.equal(today[0].id, y, 'moved to the top of Today')
    await t.dispatch('tab.move', { itemId: x, section: 'pinned', index: 0 })
    s = await t.waitFor((s) => s.items.find((i) => i.id === x).section === 'pinned', 'moved across the divider')
    assert.ok(s.items.find((i) => i.id === x).pinnedUrl)
    await t.dispatch('tab.move', { itemId: x, section: 'today', index: 0 })
    s = await t.waitFor((s) => s.items.find((i) => i.id === x).section === 'today', 'back below the divider')
    assert.equal(s.items.find((i) => i.id === x).pinnedUrl, null)
  })

  await row(19, async () => {
    await t.dispatch('tab.rename', { id: pinned, title: 'My Docs' })
    s = await t.waitFor((s) => s.items.find((i) => i.id === pinned).customTitle === 'My Docs', 'renamed')
    await sleep(300)
    assert.match(await shellJs(`document.querySelector('[data-item="${pinned}"]').innerText`), /My Docs/)
  })

  await row(20, async () => {
    await t.dispatch('tab.activate', { id: pinned })
    await t.dispatch('tab.navigate', { itemId: pinned, url: A('/p/Elsewhere') })
    await t.waitFor((s) => s.items.find((i) => i.id === pinned).url.includes('Elsewhere'), 'navigated away')
    await sleep(500)
    assert.ok(await shellJs(`Boolean(document.querySelector('[data-item="${pinned}"] button[aria-label="Back to pinned URL"]'))`), 'back-to-pinned control')
    await shellJs(`document.querySelector('[data-item="${pinned}"] button[aria-label="Back to pinned URL"]').click()`)
    await t.waitFor((s) => s.items.find((i) => i.id === pinned).url === A('/p/Pinned'), 'reset to the pinned URL')
  })

  const split = (s) => s.items.find((i) => i.kind === 'split' && i.spaceId === win(s).activeSpaceId)
  await row(21, async () => {
    await open(A('/p/SplitOne'))
    await press('=', ['control', 'shift'], (s) => split(s)?.panes.itemIds.length === 2, 'ctrl+shift+= splits')
    assert.ok(await t.dispatch('split.add'))
    assert.ok(await t.dispatch('split.add'))
    assert.equal(await t.dispatch('split.add'), false, 'four panes at most')
    s = await t.state()
    assert.equal(split(s).panes.itemIds.length, 4)
    assert.equal(win(s).paneRects.length, 4)
    await t.dispatch('split.setLayout', { layout: 'vertical' })
    s = await t.waitFor((s) => split(s).panes.layout === 'vertical', 'vertical')
    await sleep(400)
    assert.equal(await shellJs(`document.querySelector('[data-item="${split(s).id}"]')?.dataset.split`), '4', 'one combined sidebar row')
    assert.ok(await t.capture(frame('r21-split4')))
    await t.dispatch('split.setLayout', { layout: 'horizontal' })
  })

  await row(23, async () => {
    await press('1', ['control', 'shift'], (s) => win(s).focusedPane === 0, 'ctrl+shift+1')
    await press(']', ['control', 'shift'], (s) => win(s).focusedPane === 1, 'ctrl+shift+]')
    await press('[', ['control', 'shift'], (s) => win(s).focusedPane === 0, 'ctrl+shift+[')
    await press('-', ['control', 'shift'], (s) => split(s)?.panes.itemIds.length === 3, 'ctrl+shift+- closes the focused pane')
    await t.dispatch('split.remove')
    await t.dispatch('split.remove', { keep: true })
    s = await t.waitFor((s) => !split(s), 'split dissolved')
  })

  await row(22, async () => {
    const left = await open(A('/p/DropBase'))
    const other = await open(A('/p/Dropped'))
    await t.dispatch('tab.activate', { id: left })
    await t.dispatch('split.dropZones', { show: true })
    s = await t.waitFor((s) => win(s).overlay?.kind === 'splitDrop', 'drop zones')
    await sleep(300)
    assert.ok(await t.capture(frame('r22-drop-zones')))
    await t.dispatch('split.drop', { itemId: other, edge: 'left' })
    s = await t.waitFor((s) => split(s)?.panes.itemIds[0] === other, 'dropped on the left edge')
    const r = await t.dispatch('split.setRatios', { divider: 0, pos: 700 })
    assert.ok(Math.abs(r[0] - 0.5) > 0.02 && r[0] >= 0.2 && r[0] <= 0.8, 'divider drag moves the ratio: ' + r)
    await t.dispatch('split.swap', { from: 1, to: 2 })
    s = await t.state()
    assert.equal(split(s).panes.itemIds[1], other, 'panes swapped')
    await t.dispatch('tab.close', { id: split(s).id })
    await t.waitFor((s) => !split(s), 'split archived')
  })

  await row(24, async () => {
    await t.dispatch('commandbar.open', { mode: 'new', query: B('/p/FromBar') })
    await t.waitFor((s) => win(s).overlay?.kind === 'commandbar', 'bar open')
    await sleep(600)
    assert.ok(await t.capture(frame('r24-commandbar')))
    const n = (await t.state()).items.length
    const clicked = await overlayJs(`(() => { const el = [...document.querySelectorAll('[cmdk-item]')].find((e) => e.innerText.includes('FromBar')); if (!el) return false; el.click(); return true })()`)
    assert.equal(clicked, true, 'URL suggestion listed')
    s = await t.waitFor((s) => byUrl(s, 'localhost:' + PORT + '/p/FromBar') && !win(s).overlay, 'opened a new tab')
    assert.equal(s.items.length, n + 1)
    await t.dispatch('commandbar.open', { mode: 'new', query: 'archive all' })
    await sleep(500)
    assert.match(await overlayJs('document.body.innerText'), /Archive All Today Tabs/, 'commands are listed')
    await t.dispatch('commandbar.close')
  })

  await row(25, async () => {
    s = await t.state()
    const id = win(s).activeItemId
    const n = s.items.length
    await t.dispatch('commandbar.open', { mode: 'current' })
    s = await t.waitFor((s) => win(s).overlay?.kind === 'commandbar', 'bar open')
    assert.equal(win(s).overlay.mode, 'current')
    assert.match(win(s).overlay.query, /FromBar/, 'prefilled with the current URL')
    await t.dispatch('commandbar.close')
    await t.dispatch('commandbar.open', { mode: 'current', query: B('/p/InPlace') })
    await sleep(500)
    await overlayJs(`[...document.querySelectorAll('[cmdk-item]')].find((e) => e.innerText.includes('InPlace')).click()`)
    s = await t.waitFor((s) => s.items.find((i) => i.id === id)?.url.includes('InPlace'), 'navigated in place')
    assert.equal(s.items.length, n, 'no new tab')
  })

  await row(66, async () => {
    const z = await open(A('/p/Zebrafish'))
    await t.dispatch('tab.close', { id: z })
    await open(A('/p/Zebra'))
    await t.dispatch('tab.activate', { id: alpha })
    await t.dispatch('commandbar.open', { mode: 'new', query: 'zebr' })
    await sleep(700)
    const txt = await overlayJs('document.body.innerText')
    assert.match(txt, /Open tabs[\s\S]*Zebra/i, 'open tab found')
    assert.match(txt, /Archive[\s\S]*Zebrafish/i, 'archived tab found')
    assert.ok(await t.capture(frame('r66-search')))
    await t.dispatch('commandbar.close')
  })

  await row(15, async () => {
    s = await t.state()
    const entry = s.archive.find((a) => a.item.url.includes('Zebrafish'))
    assert.ok(entry, 'archive entry')
    await t.dispatch('archive.open')
    await t.waitFor((s) => active(s)?.url.startsWith('swyr://archive'), 'archive page')
    await t.waitIdle()
    await sleep(800)
    assert.match(await tabEval('document.body.innerText'), /Zebrafish/)
    assert.ok(await t.capture(frame('r15-archive')))
    await t.dispatch('archive.restore', { id: entry.id })
    await t.waitFor((s) => byUrl(s, 'Zebrafish'), 'restored')
  })

  await row(16, async () => {
    await open(A('/p/Clear1'))
    await open(A('/p/Clear2'))
    const n = await t.dispatch('tab.archiveAllToday')
    assert.ok(n >= 2, 'archived ' + n)
    s = await t.state()
    assert.equal(s.items.filter((i) => i.section === 'today' && i.spaceId === home).length, 0)
    assert.ok(s.items.some((i) => i.id === pinned), 'pinned survives')
  })

  await row(69, async () => {
    const id = await open(A('/p/CloseMe'))
    await menuKey('Cmd+W', (s) => !s.items.some((i) => i.id === id), 'cmd+w archives')
    s = await t.state()
    assert.equal(s.archive.at(-1).item.id, id)
    assert.equal(s.archive.at(-1).reason, 'closed')
    // a window with no tab left closes on Cmd+W
    const empty = await t.dispatch('space.new', { name: 'Empty', activate: false })
    const wid = await t.dispatch('window.new')
    await t.waitFor((s) => s.windows.filter((w) => w.kind === 'main').length === 2, 'second window')
    await dispatchIn(wid, 'space.switch', { id: empty })
    assert.equal(await dispatchIn(wid, 'tab.close'), 'window')
    await t.waitFor((s) => s.windows.filter((w) => w.kind === 'main').length === 1, 'empty window closed')
    await t.dispatch('space.delete', { id: empty })
  })

  await row(70, async () => {
    await menuKey('Cmd+Shift+T', (s) => byUrl(s, 'CloseMe'), 'cmd+shift+t reopens')
  })

  await row(67, async () => {
    await t.dispatch('tab.activate', { id: alpha })
    const order = await t.dispatch('debug.titles')
    assert.ok(order.length >= 2)
    s = await menuKey('Cmd+2', (s) => active(s) && active(s).id !== alpha, 'cmd+2 goes to the second item')
    assert.equal(active(s).customTitle ?? active(s).title, order[1])
  })

  await row(68, async () => {
    const x = await open(A('/p/RecentX'))
    await open(A('/p/RecentY'))
    await press('Tab', ['control'], (s) => win(s).activeItemId === x, 'ctrl+tab returns to the previous tab')
  })

  await row(27, async () => {
    s = await t.state()
    const url = active(s).url
    assert.equal(await t.dispatch('page.copyUrl'), url)
    assert.equal(await clip(), url)
  })

  await row(28, async () => {
    assert.equal(await t.dispatch('page.copyUrlMarkdown'), `[RecentX](${A('/p/RecentX')})`)
    assert.equal(await clip(), `[RecentX](${A('/p/RecentX')})`)
  })

  let miniUrl
  await row(29, async () => {
    const id = await t.dispatch('mini.new', { url: B('/p/Mini') })
    s = await t.waitFor((s) => s.windows.find((w) => w.kind === 'mini')?.url.includes('/p/Mini'), 'mini window')
    const mini = s.windows.find((w) => w.kind === 'mini')
    assert.equal(mini.id, id)
    assert.ok(mini.bounds.width <= 600, 'small window')
    await sleep(1000)
    assert.ok(await ev((_e, f) => globalThis.__swyr.captureMini(f), frame('r29-mini')))
    miniUrl = mini.url
  })

  await row(30, async () => {
    await t.dispatch('mini.openInMain', { spaceId: side })
    s = await t.waitFor((s) => !s.windows.some((w) => w.kind === 'mini') && byUrl(s, '/p/Mini'), 'moved to the main window')
    assert.equal(byUrl(s, '/p/Mini').spaceId, side, 'landed in the chosen space')
    assert.equal(win(s).activeSpaceId, side)
    assert.ok(miniUrl)
    await t.dispatch('space.switch', { id: home })
  })

  await row(31, async () => {
    await open(A('/links'))
    // the native context menu never pops up headless: emit the page's context-menu event, read the menu, click an entry
    await ev(({ webContents }, url) => {
      const wc = webContents.getAllWebContents().find((w) => w.getURL() === url)
      wc.emit('context-menu', { preventDefault() {} }, { linkURL: url.replace('/links', '/p/Linked'), x: 10, y: 10, isEditable: false, selectionText: '', editFlags: {} })
    }, A('/links'))
    const labels = await t.dispatch('contextMenu.last')
    assert.ok(labels.includes('Open Link in Mini Window'), labels.join('|'))
    assert.equal(await t.dispatch('contextMenu.click', { label: 'Open Link in Mini Window' }), true)
    await t.waitFor((s) => s.windows.some((w) => w.kind === 'mini' && w.url.includes('/p/Linked')), 'link opened in a Mini Window')
    await t.dispatch('mini.close')
    await t.waitFor((s) => !s.windows.some((w) => w.kind === 'mini'), 'mini closed')
    // and external links can default to a Mini Window
    await t.dispatch('settings.set', { openExternalLinksInMiniWindow: true })
    assert.equal(await t.dispatch('link.openExternal', { url: B('/p/External') }), 'mini')
    await t.waitFor((s) => s.windows.some((w) => w.kind === 'mini' && w.url.includes('/p/External')), 'external link in a Mini Window')
    await t.dispatch('mini.close')
    await t.dispatch('settings.set', { openExternalLinksInMiniWindow: false })
    await t.waitFor((s) => !s.windows.some((w) => w.kind === 'mini'), 'mini closed')
  })

  await row(32, async () => {
    await t.dispatch('tab.activate', { id: pinned })
    await t.waitIdle()
    await wcJs(A('/p/Pinned'), `location.href = ${JSON.stringify(B('/p/Peek'))}; 1`)
    s = await t.waitFor((s) => win(s).preview?.url.includes('/p/Peek'), 'cross-site link from a pinned tab opens Preview')
    assert.equal(s.items.find((i) => i.id === pinned).url, A('/p/Pinned'), 'pinned tab stays')
    await t.waitFor((s) => win(s).preview?.title === 'Peek', 'preview loaded')
    await sleep(500)
    assert.ok(await t.capture(frame('r32-preview')))
    const id = await t.dispatch('preview.expand')
    s = await t.waitFor((s) => !win(s).preview && s.items.find((i) => i.id === id)?.section === 'today', 'expanded into a tab')
  })

  await row(33, async () => {
    await t.dispatch('linkRules.add', { pattern: 'localhost', spaceId: side })
    // the same path macOS uses for links from other apps
    await ev(({ app }, url) => app.emit('open-url', { preventDefault() {} }, url), B('/p/Routed'))
    s = await t.waitFor((s) => byUrl(s, '/p/Routed')?.spaceId === side, 'routed to the Side space')
    assert.equal(win(s).activeSpaceId, side)
    await t.dispatch('linkRules.remove', { id: s.settings.linkRules[0].id })
    await t.dispatch('space.switch', { id: home })
    // round 5: rules by source app. macOS does not say who sent a link, so swyr records the frontmost app when it
    // arrives; the test hook stands in for that app. The same site goes to Side from Slack and to Home from Mail.
    const probe = await ev(() => globalThis.__swyr.probeSourceApp())
    assert.ok(probe.ms < 1500, 'frontmost-app probe is fast: ' + probe.ms + ' ms')
    assert.ok(probe.app === null || typeof probe.app.name === 'string', 'probe result ' + JSON.stringify(probe))
    const slackRule = await t.dispatch('linkRules.add', { pattern: 'localhost', sourceApp: 'Slack', spaceId: side })
    const mailRule = await t.dispatch('linkRules.add', { pattern: 'localhost', sourceApp: 'com.apple.mail', spaceId: home })
    assert.ok(slackRule && mailRule, 'two source-app rules')
    const arrive = async (source, url) => {
      await ev((_e, a) => globalThis.__swyr.setSourceApp(a), source)
      await ev(({ app }, u) => app.emit('open-url', { preventDefault() {} }, u), url)
    }
    await t.dispatch('space.switch', { id: home })
    await arrive({ name: 'Slack', bundleId: 'com.tinyspeck.slackmacgap' }, B('/p/FromSlack'))
    s = await t.waitFor((s) => byUrl(s, '/p/FromSlack'), 'link from Slack opened')
    assert.equal(byUrl(s, '/p/FromSlack').spaceId, side, 'from Slack: the Side space')
    assert.equal(win(s).activeSpaceId, side)
    await arrive({ name: 'Mail', bundleId: 'com.apple.mail' }, B('/p/FromMail'))
    s = await t.waitFor((s) => byUrl(s, '/p/FromMail'), 'link from Mail opened')
    assert.equal(byUrl(s, '/p/FromMail').spaceId, home, 'from Mail (matched by bundle id): the Home space')
    assert.equal(win(s).activeSpaceId, home)
    // an app no rule names falls back to the space the window is in
    await t.dispatch('space.switch', { id: side })
    await arrive({ name: 'Notes', bundleId: 'com.apple.Notes' }, B('/p/FromNotes'))
    s = await t.waitFor((s) => byUrl(s, '/p/FromNotes'), 'link from Notes opened')
    assert.equal(byUrl(s, '/p/FromNotes').spaceId, side, 'no rule for Notes: current space')
    // a rule by source app alone (no site), edited through linkRules.update
    assert.equal(await t.dispatch('linkRules.update', { id: mailRule, pattern: '', sourceApp: 'Mail' }), true)
    await t.dispatch('space.switch', { id: side })
    await arrive({ name: 'Mail', bundleId: 'com.apple.mail' }, A('/p/AnyFromMail'))
    s = await t.waitFor((s) => byUrl(s, '/p/AnyFromMail'), 'any link from Mail')
    assert.equal(byUrl(s, '/p/AnyFromMail').spaceId, home, 'source-only rule routes every site')
    // the Link Rules pane lists the source app and the editor has its field
    const pane = await t.dispatch('tab.new', { url: 'swyr://settings#linkrules' })
    await t.waitFor((s) => active(s)?.id === pane, 'settings tab')
    await t.waitIdle()
    let txt = ''
    for (let i = 0; i < 20 && !/from Slack/.test(txt); i++) {
      await sleep(300)
      txt = String(await tabEval(`document.body.innerText + (document.querySelector('[data-testid="rule-source-app"]') ? ' [field]' : '')`))
    }
    assert.match(txt, /localhost from Slack/, 'pane lists the Slack rule')
    assert.match(txt, /Any link from Mail/, 'pane lists the Mail rule')
    assert.match(txt, /\[field\]/, 'rule editor has a source app field')
    assert.ok(await t.capture(frame('r33-link-rules-source-app')))
    await ev(() => globalThis.__swyr.setSourceApp(undefined))
    await t.dispatch('tab.close', { id: pane, remove: true })
    for (const id of [slackRule, mailRule]) await t.dispatch('linkRules.remove', { id })
    await t.dispatch('space.switch', { id: home })
  })

  await row(81, async () => {
    assert.equal(typeof (await t.dispatch('browser.makeDefault')), 'boolean')
    const pkg = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8'))
    assert.deepEqual(pkg.build.mac.extendInfo.CFBundleURLTypes[0].CFBundleURLSchemes, ['http', 'https'])
    await ev(({ app }, url) => app.emit('open-url', { preventDefault() {} }, url), A('/p/FromOtherApp'))
    await t.waitFor((s) => byUrl(s, '/p/FromOtherApp'), 'open-url opens a tab')
  })

  let styled
  let pattern
  await row(34, async () => {
    styled = await open(A('/styled'))
    pattern = (await t.dispatch('style.siteDefaults')).hostPattern
    const a = await t.dispatch('style.save', { hostPattern: pattern, css: '#box { color: rgb(1, 2, 3) !important; }' })
    const b = await t.dispatch('style.save', { hostPattern: pattern, css: 'body { border-top: 7px solid rgb(9, 9, 9) !important; }' })
    await sleep(800)
    assert.equal(await tabEval(`getComputedStyle(document.getElementById('box')).color + '|' + getComputedStyle(document.body).borderTopWidth`), 'rgb(1, 2, 3)|7px', 'two styles on one site')
    await t.dispatch('style.toggle', { id: b.id, enabled: false })
    await sleep(800)
    assert.equal(await tabEval(`getComputedStyle(document.body).borderTopWidth`), '0px', 'toggled off')
    await t.dispatch('style.delete', { id: b.id })
    await t.dispatch('library.open', { section: 'styles' })
    await t.waitFor((s) => active(s)?.url.startsWith('swyr://library'), 'library')
    await t.waitIdle()
    await sleep(900)
    assert.ok((await tabEval('document.body.innerText')).includes(pattern), 'Library lists the style')
    await t.dispatch('style.delete', { id: a.id })
    await t.dispatch('tab.activate', { id: styled })
  })

  await row(35, async () => {
    await t.dispatch('style.save', { hostPattern: pattern, colors: { bg: '#102030', fg: '#f0e0d0' }, font: 'Georgia', fontScale: 1.5 })
    await sleep(900)
    const r = await tabEval(`[getComputedStyle(document.body).backgroundColor, getComputedStyle(document.body).color, getComputedStyle(document.body).fontFamily].join('|')`)
    assert.match(r, /^rgb\(16, 32, 48\)\|rgb\(240, 224, 208\)\|.*Georgia/, r)
    await t.dispatch('style.panel', { show: true })
    await sleep(700)
    assert.ok(await t.capture(frame('r35-style-panel')))
    await t.dispatch('overlay.close')
  })

  await row(36, async () => {
    await t.waitIdle()
    const picking = ev(() => globalThis.__swyr.dispatch('style.pickElement'))
    await sleep(700)
    const r = await tabEval(`(() => { const b = document.getElementById('zap').getBoundingClientRect(); return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) } })()`)
    await send(A('/styled'), [
      { type: 'mouseMove', x: r.x, y: r.y },
      { wait: 150 },
      { type: 'mouseDown', x: r.x, y: r.y, button: 'left', clickCount: 1 },
      { type: 'mouseUp', x: r.x, y: r.y, button: 'left', clickCount: 1 }
    ])
    const selector = await picking
    assert.ok(typeof selector === 'string' && selector.length > 0, 'picked ' + selector)
    await sleep(600)
    assert.equal(await tabEval(`getComputedStyle(document.getElementById('zap')).display`), 'none')
    s = await t.state()
    assert.ok(s.styles.some((st) => st.hiddenSelectors.includes(selector)), 'persisted per site')
  })

  await row(37, async () => {
    const st = await t.dispatch('style.save', { hostPattern: pattern, css: '#box { text-decoration: underline !important; }', js: "document.body.dataset.swyrJs = 'ran'" })
    await t.dispatch('tab.reload')
    await t.waitIdle()
    await sleep(900)
    assert.equal(await tabEval(`getComputedStyle(document.getElementById('box')).textDecorationLine + '|' + document.body.dataset.swyrJs`), 'underline|ran')
    await t.dispatch('style.open', { id: st.id })
    await t.waitFor((s) => active(s)?.url.startsWith('swyr://styles/'), 'code editor page')
    await t.waitIdle()
    await sleep(900)
    assert.ok(await t.capture(frame('r37-style-code')))
  })

  await row(38, async () => {
    s = await t.state()
    const st = s.styles.find((x) => x.js.includes('swyrJs'))
    const code = await t.dispatch('style.export', { id: st.id })
    assert.match(code, /^swyr-style:/)
    assert.equal(await clip(), code)
    for (const x of s.styles) await t.dispatch('style.delete', { id: x.id })
    const installed = await t.dispatch('style.import', {})
    assert.equal(installed.hostPattern, pattern)
    assert.equal(installed.js, st.js)
    await t.dispatch('tab.activate', { id: styled })
    await t.dispatch('tab.reload')
    await t.waitIdle()
    await sleep(900)
    assert.equal(await tabEval(`document.body.dataset.swyrJs`), 'ran', 'installed style applies')
    for (const x of (await t.state()).styles) await t.dispatch('style.delete', { id: x.id })
  })

  await row(39, async () => {
    await t.dispatch('extensions.loadUnpacked', { path: path.join(fixtures, 'ext-hello') })
    s = await t.waitFor((s) => (s.extensions || []).some((e) => e.name === 'swyr hello test' && e.enabled), 'extension loaded')
    assert.equal(s.extensions.find((e) => e.name === 'swyr hello test').actionTitle, 'hello')
    const id = await t.dispatch('extensions.openStore')
    s = await t.state()
    assert.match(s.items.find((i) => i.id === id).url, /chromewebstore\.google\.com/)
    await t.dispatch('tab.close', { id })
    await t.dispatch('extensions.open')
    await t.waitFor((s) => active(s)?.url.startsWith('swyr://extensions'), 'extensions page')
  })

  await row(82, async () => {
    const v = await ev(() => process.versions)
    assert.ok(Number(v.chrome.split('.')[0]) >= 130, 'Chromium ' + v.chrome)
    const ua = await ev(({ session }, part) => session.fromPartition(part).getUserAgent(), personal.partition)
    assert.ok(/Chrome\//.test(ua) && !/Electron|swyr/i.test(ua), ua)
  })

  await row(40, async () => {
    const id = await t.dispatch('canvas.new', { title: 'Ideas board' })
    s = await t.waitFor((s) => s.items.some((i) => i.kind === 'canvas' && i.title === 'Ideas board'), 'canvas item')
    const item = s.items.find((i) => i.kind === 'canvas')
    await t.waitIdle()
    let mounted = false
    for (let i = 0; i < 20 && !mounted; i++) {
      await sleep(400)
      mounted = (await tabEval(`Boolean(document.querySelector('canvas'))`)) === true
    }
    assert.ok(mounted, 'board mounted')
    await t.dispatch('canvas.addText', { itemId: item.id, text: 'hello board', x: 100, y: 100 })
    await t.dispatch('canvas.addLink', { itemId: item.id, url: A('/p/Alpha'), title: 'Alpha' })
    await sleep(800)
    const els = await t.dispatch('canvas.getElements', { itemId: item.id })
    assert.ok(Array.isArray(els) && els.length >= 2, 'elements saved')
    assert.ok(await t.capture(frame('r40-canvas')))
    await t.dispatch('tab.pin', { id: id ?? item.id })
    const table = await t.dispatch('shortcuts.list')
    assert.equal(table.find((b) => b.id === 'canvas.new').accelerator, 'Ctrl+Shift+E')
  })

  await row(41, async () => {
    await t.dispatch('note.new', { title: 'Grocery list' })
    s = await t.waitFor((s) => s.items.some((i) => i.kind === 'note' && i.title === 'Grocery list'), 'note item')
    const note = s.items.find((i) => i.kind === 'note')
    await t.waitIdle()
    await sleep(1200)
    await t.dispatch('note.setContent', { itemId: note.id, markdown: '# Grocery list\n\n- eggs\n- milk\n\nSee https://example.com' })
    await sleep(800)
    const txt = await tabEval('document.body.innerText')
    assert.ok(/eggs/.test(txt) && /milk/.test(txt), 'editor shows the note')
    assert.ok(fs.readdirSync(path.join(t.userData, 'documents')).some((f) => f.endsWith('.json')), 'document saved')
    await t.dispatch('tab.pin', { id: note.id })
    await t.waitFor((s) => s.items.find((i) => i.id === note.id).section === 'pinned', 'note pinned')
    assert.ok(await t.capture(frame('r41-note')))
    assert.equal((await t.dispatch('shortcuts.list')).find((b) => b.id === 'note.new').accelerator, 'Ctrl+N')
  })

  await row(42, async () => {
    await t.dispatch('tab.activate', { id: alpha })
    await t.waitIdle()
    const splitId = await t.dispatch('note.new', { split: true })
    s = await t.waitFor((s) => s.items.find((i) => i.id === splitId)?.kind === 'split', 'note split')
    const panes = split(s).panes.itemIds.map((id) => s.items.find((i) => i.id === id))
    assert.ok(panes.some((p) => p.url.startsWith('swyr://note/')), 'a note pane')
    await sleep(800)
    assert.ok(await t.capture(frame('r42-note-split')))
    await t.dispatch('split.remove')
    await t.dispatch('split.remove', { keep: true })
    await t.waitFor((s) => !split(s), 'dissolved')
  })

  await row(43, async () => {
    await t.dispatch('liveFolder.new', { name: 'Feed', source: 'rss', sourceConfig: { url: A('/feed.xml') } })
    s = await t.waitFor((s) => s.items.some((i) => i.kind === 'liveFolder' && i.title === 'Feed'), 'live folder')
    const lf = s.items.find((i) => i.kind === 'liveFolder')
    await t.dispatch('liveFolder.refresh', { itemId: lf.id })
    s = await t.waitFor((s) => s.items.filter((i) => i.parentId === lf.id).length === 2, 'filled from the feed')
    assert.ok(s.items.some((i) => i.parentId === lf.id && i.title === 'Feed one'))
    await sleep(400)
    assert.ok(await t.capture(frame('r43-live-folder')))
  })

  await row(44, async () => {
    await t.dispatch('tab.activate', { id: styled })
    await t.waitIdle()
    const info = await t.dispatch('siteSettings.info')
    for (const k of ['permissions', 'adblockEnabled', 'blocked', 'styles', 'extensions', 'zoom']) assert.ok(k in info, 'site info has ' + k)
    const d = await t.dispatch('siteSettings.setPermission', { permission: 'notifications', value: 'deny' })
    assert.equal(d.notifications, 'deny')
    await t.dispatch('siteSettings.open')
    s = await t.waitFor((s) => win(s).overlay?.kind === 'siteSettings', 'popover open')
    await sleep(700)
    assert.ok(await t.capture(frame('r44-site-settings')))
    await t.dispatch('overlay.close')
  })

  await row(45, async () => {
    s = await t.state()
    await t.dispatch('settings.set', { siteSearch: [...s.settings.siteSearch, { keyword: 'lo', name: 'Local', urlTemplate: A('/search?q=%s') }] })
    const id = await t.dispatch('tab.new', { input: 'lo kittens' })
    s = await t.state()
    assert.equal(s.items.find((i) => i.id === id).url, A('/search?q=kittens'))
    assert.equal(s.settings.siteSearch.find((x) => x.keyword === 'yt').name, 'YouTube', 'built-in shortcuts')
  })

  let mediaTab
  const MEDIA_JS = `(() => {
      const rate = 8000, n = rate * 3, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf)
      const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)))
      w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true)
      v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true)
      v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true)
      for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.sin(i / 4) * 300, true)
      const a = document.createElement('audio')
      a.src = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }))
      a.loop = true
      document.body.appendChild(a)
      // a video for picture-in-picture: frames from a canvas
      const c = document.createElement('canvas'); c.width = 160; c.height = 90
      const g = c.getContext('2d'); let k = 0
      setInterval(() => { g.fillStyle = 'hsl(' + (k++ % 360) + ',70%,50%)'; g.fillRect(0, 0, 160, 90) }, 50)
      const vid = document.createElement('video'); vid.muted = true; vid.srcObject = c.captureStream(20)
      document.body.appendChild(vid)
      // picture-in-picture opens an on-screen window, so the request is recorded instead of granted
      window.__pip = 0
      HTMLVideoElement.prototype.requestPictureInPicture = function () { window.__pip++; document.title = 'PiP requested'; return Promise.resolve({}) }
      return Promise.all([a.play(), vid.play()]).then(() => 'playing', (e) => String(e))
    })()`
  await row(47, async () => {
    mediaTab = await open(A('/media'))
    const played = await tabEval(MEDIA_JS)
    assert.equal(played, 'playing')
    s = await t.waitFor((s) => win(s).media?.playing && win(s).media.itemId === mediaTab, 'media runtime')
    await t.dispatch('space.switch', { id: side })
    await sleep(600)
    assert.equal(await shellJs(`Boolean(document.querySelector('[data-media="${mediaTab}"]'))`), true, 'controls shown in another space')
    assert.ok(await t.capture(frame('r47-media-bar')))
    assert.equal(await t.dispatch('media.toggle'), 'paused')
    await t.waitFor((s) => win(s).media && !win(s).media.playing, 'paused from the sidebar')
    assert.equal(await t.dispatch('media.toggle'), 'playing')
    await t.waitFor((s) => win(s).media?.playing, 'playing again')
    await t.dispatch('space.switch', { id: home })
  })

  await row(48, async () => {
    await t.dispatch('tab.activate', { id: alpha })
    await sleep(500)
    const r = await shellJs(`(() => { const el = document.querySelector('[data-media="${mediaTab}"]'); if (!el) return null; return { h: el.getBoundingClientRect().height, buttons: [...el.querySelectorAll('button')].map((b) => b.title) } })()`)
    assert.ok(r && r.h <= 48, 'compact bar ' + JSON.stringify(r))
    assert.ok(r.buttons.some((b) => /Pause|Play/.test(b)), JSON.stringify(r))
  })

  await row(46, async () => {
    await t.dispatch('media.close', { itemId: mediaTab })
    await t.dispatch('settings.set', { pipAuto: true })
    mediaTab = await open(A('/media?pip'))
    assert.equal(await tabEval(MEDIA_JS), 'playing')
    await t.waitFor((s) => win(s).media?.playing && win(s).media.itemId === mediaTab, 'video playing')
    await sleep(600)
    const ready = await tabEval(`[document.pictureInPictureEnabled, !document.querySelector('video').paused, document.querySelector('video').readyState].join()`)
    assert.match(ready, /^true,true,[34]$/, 'video playing and picture-in-picture available: ' + ready)
    await t.dispatch('tab.activate', { id: alpha })
    // the stub renames the page, so the request shows in the sidebar state even if the hidden page is reclaimed
    await t.waitFor((s) => s.items.find((i) => i.id === mediaTab)?.title === 'PiP requested', 'switching away asked for picture-in-picture', 8000)
    await t.dispatch('media.close', { itemId: mediaTab })
    await t.dispatch('settings.set', { pipAuto: false })
  })

  await row(49, async () => {
    await t.dispatch('downloads.setDirectory', { path: path.join(t.userData, 'dl') })
    await open(A('/download'))
    await t.dispatch('page.runJs', { js: "document.getElementById('dl').click()" })
    s = await t.waitFor((s) => (s.downloads || []).some((d) => d.filename === 'parity-file.txt' && d.state === 'completed'), 'download completed')
    assert.equal(fs.readFileSync(path.join(t.userData, 'dl', 'parity-file.txt'), 'utf8'), 'hello from swyr parity')
    assert.equal(await t.dispatch('downloads.open', { show: true }), true)
    await sleep(500)
    assert.ok(await t.capture(frame('r49-downloads-panel')))
    await t.dispatch('downloads.open', { show: false })
    await t.dispatch('library.open', { section: 'downloads' })
    await t.waitIdle()
    await sleep(900)
    assert.match(await tabEval('document.body.innerText'), /parity-file\.txt/)
  })

  await row(50, async () => {
    await t.dispatch('library.open')
    await t.waitIdle()
    await sleep(700)
    const txt = await tabEval('document.body.innerText')
    for (const k of ['Archive', 'Spaces', 'Downloads', 'Notes', 'Canvases', 'Styles', 'Media']) assert.ok(txt.includes(k), 'Library has ' + k)
    assert.ok(await t.capture(frame('r50-library')))
  })

  await row(51, async () => {
    await t.dispatch('tab.activate', { id: alpha })
    await t.waitIdle()
    // DevTools opens its own on-screen window, so test mode stops right before it
    assert.equal(await t.dispatch('page.devtools'), 'skipped in test mode')
    assert.equal(await t.dispatch('page.console'), 'skipped in test mode')
    const id = await t.dispatch('page.viewSource')
    s = await t.state()
    assert.equal(s.items.find((i) => i.id === id).url, 'view-source:' + A('/p/Alpha'))
    const keys = Object.fromEntries((await t.dispatch('shortcuts.list')).map((b) => [b.id, b.accelerator]))
    assert.deepEqual([keys['page.devtools'], keys['page.console'], keys['page.viewSource']], ['Cmd+Alt+I', 'Cmd+Alt+J', 'Cmd+Alt+U'])
    await t.dispatch('tab.close', { id })
  })

  await row(52, async () => {
    await open(A('/article'))
    await t.dispatch('page.readerMode')
    s = await t.waitFor((s) => win(s).tabs?.[win(s).activeItemId]?.reader === true, 'reader on')
    let clean = false
    for (let i = 0; i < 12 && !clean; i++) {
      await sleep(500)
      clean = (await tabEval("document.body.innerText.includes('Second paragraph') && !document.body.innerText.includes('SIDEBAR NOISE')")) === true
    }
    assert.ok(clean, 'reader view keeps the article and drops the noise')
    assert.ok(await t.capture(frame('r52-reader')))
    await t.dispatch('page.readerMode')
    await t.waitFor((s) => win(s).tabs?.[win(s).activeItemId]?.reader !== true, 'reader off')
  })

  await row(60, async () => {
    const file = path.join(t.userData, 'capture.png')
    await t.waitIdle()
    await sleep(500)
    let r = await t.dispatch('page.capture', { path: file }).catch(() => null)
    if (r !== file) {
      await sleep(1000)
      r = await t.dispatch('page.capture', { path: file })
    }
    assert.equal(r, file)
    assert.ok(fs.statSync(file).size > 3000, 'capture written')
    assert.equal((await t.dispatch('shortcuts.list')).find((b) => b.command === 'page.capture').accelerator, 'Cmd+Shift+2')
  })

  await row(83, async () => {
    await open(A('/form'))
    await t.dispatch('find.open')
    let matches = 0
    for (let i = 0; i < 5 && !matches; i++) {
      await t.dispatch('find.update', { query: 'cat' })
      matches = await t.waitFor((s) => win(s).overlay?.kind === 'find' && win(s).overlay.matches > 0, 'matches', 4000).then((s) => win(s).overlay.matches).catch(() => 0)
    }
    assert.ok(matches >= 2, 'matches ' + matches)
    await t.dispatch('find.next')
    s = await t.waitFor((s) => win(s).overlay?.active === 2, 'find next')
    await t.dispatch('find.prev')
    s = await t.waitFor((s) => win(s).overlay?.active === 1, 'find previous')
    await t.dispatch('find.close')
    await t.dispatch('find.open', { replace: true })
    s = await t.waitFor((s) => win(s).overlay?.kind === 'find' && win(s).overlay.replace === true, 'find and replace')
    await sleep(500)
    assert.equal(await overlayJs(`Boolean(document.querySelector('input[aria-label="Replace with"]'))`), true)
    assert.ok(await t.capture(frame('r83-find-replace')))
    assert.equal(await t.dispatch('find.replace', { query: 'cat', replacement: 'dog', all: false }), 1)
    assert.equal(await t.dispatch('find.replace', { query: 'cat', replacement: 'dog', all: true }), 2)
    assert.equal(await tabEval(`document.getElementById('ta').value + '|' + document.getElementById('in').value`), 'the dog sat with another dog|dog')
    await t.dispatch('find.close')
    assert.equal((await t.dispatch('shortcuts.list')).find((b) => b.id === 'find.replace').accelerator, 'Cmd+Alt+F')
  })

  await row(84, async () => {
    await t.dispatch('zoom.reset')
    await press('=', ['meta'], (s) => win(s).tabs[win(s).activeItemId]?.zoom === 0.5, 'cmd+= zooms in')
    assert.equal(await t.dispatch('zoom.out'), 0)
    assert.equal(await t.dispatch('zoom.out'), -0.5)
    assert.equal(await t.dispatch('zoom.reset'), 0)
  })

  await row(78, async () => {
    s = await t.state()
    assert.equal(s.settings.adblock, true)
    const tab = await t.dispatch('tab.new', { url: 'file://' + path.join(fixtures, 'adtest.html') })
    await t.waitFor((s) => (s.adblockStats?.perTab?.[tab] ?? 0) >= 1, 'trackers blocked')
  })

  await row(14, async () => {
    await t.dispatch('settings.set', { archiveAfter: '24h' })
    const old = await open(A('/p/Stale'))
    await open(A('/p/Fresh'))
    const hour = 3600000
    await t.dispatch('archive.runAuto', { now: Date.now() + 23 * hour })
    s = await t.state()
    assert.ok(s.items.some((i) => i.id === old), 'kept before 24 h')
    await t.dispatch('archive.runAuto', { now: Date.now() + 25 * hour })
    s = await t.state()
    assert.ok(!s.items.some((i) => i.id === old), 'archived after 24 h')
    assert.equal(s.archive.find((a) => a.item.id === old)?.reason, 'auto')
    assert.ok(s.items.some((i) => i.id === pinned), 'pinned tabs never archive')
    await t.dispatch('settings.set', { archiveAfter: 'never' })
    await open(A('/p/Forever'))
    await t.dispatch('tab.activate', { id: alpha })
    assert.equal(await t.dispatch('archive.runAuto', { now: Date.now() + 400 * 24 * hour }), 0)
    await t.dispatch('settings.set', { archiveAfter: '12h' })
  })

  await row(71, async () => {
    const id = await t.dispatch('window.new')
    s = await t.waitFor((s) => s.windows.filter((w) => w.kind === 'main').length === 2, 'two windows')
    await ev(({ BaseWindow }, id) => BaseWindow.fromId(id)?.close(), id)
    await t.waitFor((s) => s.windows.filter((w) => w.kind === 'main').length === 1, 'closed')
  })

  await row(72, async () => {
    // Ctrl+Cmd+N: a window with no spaces (no switcher, no Favorites or Pinned), a neutral theme, a Today list and a New Tab
    s = await t.state()
    const spacesBefore = JSON.stringify(s.spaces.map((x) => x.id))
    const main = win(s)
    const mainBefore = { activeSpaceId: main.activeSpaceId, activeItemId: main.activeItemId }
    const mainItems = s.items.filter((i) => i.blankWindow === undefined).length
    const shortcut = (await t.dispatch('shortcuts.list')).find((b) => b.command === 'window.newBlank')
    assert.equal(shortcut?.accelerator, 'Ctrl+Cmd+N')
    const id = await t.dispatch('window.newBlank')
    s = await t.waitFor((s) => s.windows.some((w) => w.id === id && w.kind === 'main'), 'blank window')
    const bw = s.windows.find((w) => w.id === id)
    assert.equal(bw.blank, true, 'runtime flags the window blank')
    assert.equal(JSON.stringify(s.spaces.map((x) => x.id)), spacesBefore, 'no space created')
    const own = s.items.filter((i) => i.blankWindow === id)
    assert.equal(own.length, 1, 'one New Tab')
    assert.equal(own[0].section, 'today')
    assert.ok(own[0].url.startsWith('swyr://newtab'), own[0].url)
    const shell = (js) => ev((_e, a) => globalThis.__swyr.shellEvalIn(a.id, a.js), { id, js })
    let dom = null
    for (let i = 0; i < 40; i++) {
      dom = await shell(`(() => { const r = document.querySelector('[data-sidebar-root]'); return r ? { blank: r.hasAttribute('data-blank-window'), spaces: document.querySelectorAll('[data-space]').length, pinned: document.querySelectorAll('[data-section="pinned"]').length, favorites: document.querySelectorAll('[data-section="favorites"]').length, today: document.querySelectorAll('[data-section="today"]').length, text: r.innerText, bg: getComputedStyle(document.querySelector('.space-bg')).backgroundImage } : null })()`).catch(() => null)
      if (dom && dom.today) break
      await sleep(250)
    }
    assert.ok(dom, 'blank shell rendered')
    assert.equal(dom.blank, true)
    assert.equal(dom.spaces, 0, 'no [data-space] switcher buttons')
    assert.equal(dom.pinned, 0, 'no Pinned section')
    assert.equal(dom.favorites, 0, 'no Favorites section')
    assert.ok(dom.today >= 1, 'a Today list')
    assert.match(dom.text, /New Tab/)
    assert.ok(!/gradient/.test(dom.bg), 'neutral theme, no space gradient: ' + dom.bg)
    // the main window still has its switcher
    const mainSwitcher = await ev((_e, a) => globalThis.__swyr.shellEvalIn(a.id, a.js), { id: main.id, js: `document.querySelectorAll('[data-space]').length` })
    assert.ok(Number(mainSwitcher) >= 2, 'main window keeps the switcher: ' + mainSwitcher)
    // tabs opened here stay in this window; space switching does nothing
    await dispatchIn(id, 'tab.new', { url: A('/p/BlankTab') })
    s = await t.waitFor((s) => s.items.some((i) => i.url.includes('/p/BlankTab') && i.blankWindow === id), 'blank window tab')
    assert.equal(await dispatchIn(id, 'space.next'), true)
    s = await t.state()
    assert.equal(s.windows.find((w) => w.id === id).activeSpaceId, bw.activeSpaceId, 'no space switch in a blank window')
    assert.ok(!(await t.dispatch('debug.titles')).includes('BlankTab'), 'the other window does not list blank tabs')
    // closing it leaves spaces and the other window untouched
    await ev(({ BaseWindow }, id) => BaseWindow.fromId(id)?.close(), id)
    s = await t.waitFor((s) => !s.windows.some((w) => w.id === id), 'blank window closed')
    assert.equal(JSON.stringify(s.spaces.map((x) => x.id)), spacesBefore, 'no space deleted')
    assert.equal(s.items.filter((i) => i.blankWindow !== undefined).length, 0, 'blank tabs went with the window')
    assert.equal(s.items.length, mainItems, 'other items untouched')
    assert.deepEqual({ activeSpaceId: win(s).activeSpaceId, activeItemId: win(s).activeItemId }, mainBefore, 'main window untouched')
  })

  await row(73, async () => {
    await t.dispatch('window.newIncognito')
    s = await t.waitFor((s) => s.windows.some((w) => w.incognito === true), 'private window')
    const inc = s.windows.find((w) => w.incognito)
    await dispatchIn(inc.id, 'tab.new', { url: A('/p/Secret') })
    await t.waitFor((s) => s.items.some((i) => i.url.includes('/p/Secret')), 'private tab')
    await sleep(1200)
    assert.match(await ev((_e, id) => globalThis.__swyr.partitionOf(id), inc.id), /^incognito/)
    const hist = await t.dispatch('history.query', { query: 'Secret' })
    assert.equal(hist.length, 0, 'private visits are not recorded')
    await ev(({ BaseWindow }, id) => BaseWindow.fromId(id)?.close(), inc.id)
    await t.waitFor((s) => !s.windows.some((w) => w.incognito), 'private window closed')
  })

  await row(74, async () => {
    // real full screen would take over the display, so the command stops in test mode and the window events are emitted
    assert.equal(await t.dispatch('window.fullscreen'), 'skipped in test mode')
    s = await t.state()
    const id = win(s).id
    await ev(({ BaseWindow }, id) => BaseWindow.fromId(id).emit('enter-full-screen'), id)
    s = await t.waitFor((s) => win(s).fullscreen && !win(s).sidebarVisible, 'sidebar hides in full screen')
    await t.dispatch('sidebar.peek', { show: true })
    s = await t.waitFor((s) => win(s).overlay?.kind === 'sidebar', 'reveals on hover in full screen')
    await t.dispatch('sidebar.peek', { show: false })
    await ev(({ BaseWindow }, id) => BaseWindow.fromId(id).emit('leave-full-screen'), id)
    await t.waitFor((s) => !win(s).fullscreen && win(s).sidebarVisible, 'left full screen')
  })

  await row(75, async () => {
    const r = await ev(({ BaseWindow }) => {
      const w = BaseWindow.getAllWindows()[0]
      return { pos: w.getWindowButtonPosition(), size: w.getSize(), content: w.getContentSize() }
    })
    assert.deepEqual(r.pos, { x: 14, y: 14 }, 'traffic lights inside the sidebar top row')
    assert.deepEqual(r.content, r.size, 'no title bar')
    assert.match(await shellJs(`document.querySelector('[data-sidebar-root] > div').style.paddingLeft`), /72px/, 'sidebar top row leaves room for the traffic lights')
  })

  await row(76, async () => {
    const menu = await ev(({ Menu }) => Menu.getApplicationMenu().items.map((m) => [m.label, m.submenu?.items.map((x) => x.label) ?? []]))
    assert.deepEqual(menu.map((m) => m[0]), ['swyr', 'File', 'Edit', 'View', 'Spaces', 'Archive', 'Tabs', 'Window', 'Help'])
    assert.ok(menu[0][1].includes('Settings…'))
    assert.ok(menu[2][1].includes('Find and Replace…'))
  })

  await row(77, async () => {
    await t.dispatch('settings.open')
    await t.waitFor((s) => active(s)?.url.startsWith('swyr://settings'), 'settings')
    await t.waitIdle()
    await sleep(900)
    const txt = await tabEval('document.body.innerText')
    for (const k of ['General', 'Profiles', 'Link Rules', 'Shortcuts', 'Extensions', 'Advanced', 'Block ads and trackers']) assert.ok(txt.includes(k), 'settings has ' + k)
    assert.ok(await t.capture(frame('r77-settings')))
    assert.equal((await t.dispatch('shortcuts.list')).find((b) => b.id === 'settings.open').accelerator, 'Cmd+,')
  })

  await row(80, async () => {
    // bookmarks from Chrome, the sidebar file from the old browser, and history from Chrome, Firefox and Safari databases
    const imp = await t.dispatch('import.chrome', { path: path.join(fixtures, 'chrome/Bookmarks') })
    assert.equal(imp.bookmarks, 3, JSON.stringify(imp))
    const dry = await t.dispatch('import.arc', { path: path.join(fixtures, 'sidebar-sample.json'), dryRun: true })
    assert.equal(dry.spaces, 2)
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swyr-hist-'))
    const make = (name, sql) => {
      const f = path.join(dir, name)
      const db = new DatabaseSync(f)
      db.exec(sql)
      db.close()
      return f
    }
    const nowUs = Date.now() * 1000
    const chrome = make('History', `CREATE TABLE urls (id INTEGER PRIMARY KEY, url TEXT, title TEXT, visit_count INTEGER, last_visit_time INTEGER);
      INSERT INTO urls (url, title, visit_count, last_visit_time) VALUES ('https://chrome.example/a', 'Chrome page', 3, ${nowUs + 11644473600000000});`)
    const firefox = make('places.sqlite', `CREATE TABLE moz_places (id INTEGER PRIMARY KEY, url TEXT, title TEXT, last_visit_date INTEGER);
      INSERT INTO moz_places (url, title, last_visit_date) VALUES ('https://firefox.example/b', 'Firefox page', ${nowUs});`)
    const safari = make('History.db', `CREATE TABLE history_items (id INTEGER PRIMARY KEY, url TEXT, visit_count INTEGER);
      CREATE TABLE history_visits (id INTEGER PRIMARY KEY, history_item INTEGER, visit_time REAL, title TEXT);
      INSERT INTO history_items (id, url, visit_count) VALUES (1, 'https://safari.example/c', 1);
      INSERT INTO history_visits (history_item, visit_time, title) VALUES (1, ${Date.now() / 1000 - 978307200}, 'Safari page');`)
    for (const [browser, file, title] of [['chrome', chrome, 'Chrome page'], ['firefox', firefox, 'Firefox page'], ['safari', safari, 'Safari page']]) {
      const r = await t.dispatch('import.history', { browser, path: file })
      assert.equal(r.added, 1, browser + ' ' + JSON.stringify(r))
      const hist = await t.dispatch('history.query', { query: title })
      assert.ok(hist.some((h) => h.title === title), browser + ' history searchable')
    }
    // round 5: Safari and Firefox bookmarks (fixtures only; tests never read ~/Library), as folders in Pinned
    s = await t.state()
    const tree = (st, folderId) => {
      const kids = st.items.filter((i) => i.parentId === folderId).sort((a, b) => a.order - b.order)
      return kids.map((k) => (k.kind === 'folder' ? { folder: k.title, children: tree(st, k.id) } : k.title))
    }
    const saf = await t.dispatch('import.safari', { path: path.join(fixtures, 'safari/Bookmarks.plist') })
    assert.equal(saf.bookmarks, 4, 'safari ' + JSON.stringify(saf))
    assert.equal(saf.folders, 3)
    s = await t.state()
    const sf = s.items.find((i) => i.id === saf.folderId)
    assert.equal(sf.title, 'Safari Bookmarks')
    assert.equal(sf.section, 'pinned')
    assert.equal(sf.spaceId, win(s).activeSpaceId, 'into the current space')
    assert.deepEqual(tree(s, sf.id), [
      'Safari Bar Page',
      { folder: 'Safari Work', children: ['Safari Work Page & Notes'] },
      { folder: 'Bookmarks Menu', children: ['Safari Menu Page'] },
      { folder: 'Reading List', children: ['Safari Reading Item'] }
    ])
    // the same tree from a plist plutil can turn into JSON (the first path the importer tries)
    const plainDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swyr-safari-'))
    const plainJson = path.join(plainDir, 'b.json')
    fs.writeFileSync(plainJson, JSON.stringify({ WebBookmarkType: 'WebBookmarkTypeList', Children: [{ WebBookmarkType: 'WebBookmarkTypeList', Title: 'BookmarksBar', Children: [{ WebBookmarkType: 'WebBookmarkTypeLeaf', URLString: 'https://safari-fixture.example/json', URIDictionary: { title: 'Safari Json Page' } }] }] }))
    const { execFileSync } = await import('node:child_process')
    execFileSync('/usr/bin/plutil', ['-convert', 'binary1', '-o', path.join(plainDir, 'Bookmarks.plist'), plainJson])
    const saf2 = await t.dispatch('import.safari', { path: path.join(plainDir, 'Bookmarks.plist'), title: 'Safari Json' })
    assert.equal(saf2.bookmarks, 1, JSON.stringify(saf2))
    const ff = await t.dispatch('import.firefox', { path: path.join(fixtures, 'firefox/places.sqlite') })
    assert.equal(ff.bookmarks, 4, 'firefox ' + JSON.stringify(ff))
    assert.equal(ff.folders, 3)
    s = await t.state()
    const ffFolder = s.items.find((i) => i.id === ff.folderId)
    assert.equal(ffFolder.title, 'Firefox Bookmarks')
    assert.equal(ffFolder.section, 'pinned')
    assert.deepEqual(tree(s, ffFolder.id), [
      'Firefox Toolbar Page',
      { folder: 'Firefox Dev', children: ['Firefox Dev Page'] },
      { folder: 'Bookmarks Menu', children: ['Firefox Menu Page'] },
      { folder: 'Other Bookmarks', children: ['Firefox Unfiled Page'] }
    ])
    assert.ok(s.items.some((i) => i.parentId && i.url === 'https://firefox-fixture.example/dev' && i.pinnedUrl === i.url), 'bookmarks are pinned tabs')
    // without a path, test mode never falls back to the real ~/Library files
    assert.ok((await t.dispatch('import.safari')).error)
    assert.ok((await t.dispatch('import.firefox')).error)
    // the File menu and the onboarding Import step offer all three
    const fileMenu = await ev(({ Menu }) => Menu.getApplicationMenu().items.find((m) => m.label === 'File').submenu.items.find((x) => x.label === 'Import Bookmarks')?.submenu.items.map((x) => x.label))
    assert.deepEqual(fileMenu, ['From Chrome…', 'From Safari…', 'From Firefox…'])
  })

  await row(86, async () => {
    await t.dispatch('onboarding.open')
    await t.waitFor((s) => active(s)?.url.startsWith('swyr://onboarding'), 'onboarding page')
    await t.waitIdle()
    await sleep(900)
    const txt = await tabEval('document.body.innerText')
    for (const k of ['Welcome', 'Import', 'Make it yours', 'Defaults']) assert.ok(txt.includes(k), 'step ' + k)
    await t.dispatch('tab.navigate', { url: 'swyr://onboarding?step=1' })
    await t.waitIdle()
    await sleep(800)
    assert.match(await tabEval('document.body.innerText'), /From Chrome[\s\S]*From Safari[\s\S]*From Firefox/, 'Import step offers Chrome, Safari and Firefox bookmarks')
    await t.dispatch('tab.navigate', { url: 'swyr://onboarding' })
    await t.waitIdle()
    await sleep(600)
    assert.ok(await t.capture(frame('r86-onboarding')))
    await t.dispatch('tab.navigate', { url: 'swyr://onboarding?step=3' })
    await t.waitIdle()
    await sleep(800)
    assert.match(await tabEval('document.body.innerText'), /Pick your web apps[\s\S]*Gmail/, 'web app picker')
    assert.ok(await t.capture(frame('r86-onboarding-defaults')))
    await t.dispatch('onboarding.complete', { themeColors: ['#4f8cff', '#8a5cff'], adblock: true, archiveAfter: '24h', favorites: [{ url: 'https://github.com/', title: 'GitHub' }] })
    s = await t.waitFor((s) => s.settings.onboarded === true, 'onboarded')
    assert.equal(s.spaces[0].theme.colors[0], '#4f8cff', 'colour applied')
    assert.equal(s.settings.archiveAfter, '24h')
    assert.ok(s.items.some((i) => i.section === 'favorites' && i.url === 'https://github.com/'), 'picked web app is a Favorite')
  })

  await t.dispatch('debug.titles').catch(() => null)
} finally {
  await t.close()
  server.close()
}
console.log(`parity: ${passed.length} rows proven, ${failed.length} failed${failed.length ? ' (' + failed.join(', ') + ')' : ''}; frames in ${out}`)
process.exit(failed.length ? 1 : 0)

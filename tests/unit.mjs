// Pure-function checks (Node strips TypeScript types natively).
import assert from 'node:assert/strict'
import { computeLayout, normalizeRatios, splitRect, clampSidebar } from '../src/main/layout/Layout.ts'
import { resolveInput, resolveWithSettings, looksLikeUrl, displayUrl } from '../src/shared/url.ts'
import { acceleratorLabel, resolveBindings, DEFAULT_BINDINGS } from '../src/shared/commands.ts'
import { sidebarOrder, sameUrl, awayFromPinned, isWithin, depthOf, descendantsOf, windowSpaces } from '../src/shared/ops.ts'

let n = 0
const test = (name, fn) => {
  fn()
  n++
  console.log('ok', name)
}

test('ops: a private space is listed only in its own window', () => {
  const sp = (id, order, incognito) => ({ id, name: id, emoji: '', profileId: 'p', order, theme: { colors: ['#fff'], angle: 0, noise: 0, appearance: 'light' }, ...(incognito ? { incognito: true } : {}) })
  const st = { spaces: [sp('a', 0), sp('priv', 1, true), sp('b', 2)] }
  assert.deepEqual(windowSpaces(st, 'a').map((x) => x.id), ['a', 'b'])
  assert.deepEqual(windowSpaces(st, null).map((x) => x.id), ['a', 'b'])
  assert.deepEqual(windowSpaces(st, 'priv').map((x) => x.id), ['priv'])
})

test('layout: sidebar visible, one pane', () => {
  const L = computeLayout({ width: 1280, height: 800, sidebarVisible: true, sidebarWidth: 260, panes: 1, overlay: 'none' })
  assert.deepEqual(L.shell, { x: 0, y: 0, width: 1280, height: 800 })
  assert.deepEqual(L.content, { x: 260, y: 8, width: 1012, height: 784 })
  assert.deepEqual(L.panes, [L.content])
  assert.equal(L.overlay, null)
})

test('layout: sidebar hidden uses the 8 px inset', () => {
  const L = computeLayout({ width: 1000, height: 600, sidebarVisible: false, sidebarWidth: 260, panes: 1, overlay: 'full' })
  assert.deepEqual(L.content, { x: 8, y: 8, width: 984, height: 584 })
  assert.deepEqual(L.overlay, L.shell)
})

test('layout: 2 to 4 panes tile the content area without overlap', () => {
  for (const layout of ['horizontal', 'vertical']) {
    for (let k = 2; k <= 4; k++) {
      const area = { x: 260, y: 8, width: 1012, height: 784 }
      const rects = splitRect(area, k, { layout, ratios: [] })
      assert.equal(rects.length, k)
      const key = layout === 'horizontal' ? ['x', 'width'] : ['y', 'height']
      const end = rects[k - 1][key[0]] + rects[k - 1][key[1]]
      assert.equal(end, area[key[0]] + area[key[1]])
      for (let i = 1; i < k; i++) assert.ok(rects[i][key[0]] >= rects[i - 1][key[0]] + rects[i - 1][key[1]])
    }
  }
})

test('layout: ratios clamp to 20..80 % for two panes', () => {
  const r = normalizeRatios(2, [0.95, 0.05])
  assert.ok(r[1] >= 0.17 && r[0] <= 0.83)
  assert.equal(clampSidebar(50), 200)
  assert.equal(clampSidebar(900), 400)
})

test('layout: find and sidebar overlays', () => {
  const find = computeLayout({ width: 1200, height: 800, sidebarVisible: true, sidebarWidth: 260, panes: 1, overlay: 'find' }).overlay
  assert.ok(find && find.x + find.width <= 1200 - 8 && find.height === 52)
  const side = computeLayout({ width: 1200, height: 800, sidebarVisible: false, sidebarWidth: 300, panes: 1, overlay: 'sidebar' }).overlay
  assert.deepEqual(side, { x: 0, y: 0, width: 308, height: 800 })
})

test('url resolution', () => {
  assert.equal(resolveInput('example.com'), 'https://example.com')
  assert.equal(resolveInput('localhost:3000'), 'http://localhost:3000')
  assert.equal(resolveInput('https://a.b/c'), 'https://a.b/c')
  assert.match(resolveInput('how tall is a giraffe'), /^https:\/\/www\.google\.com\/search\?q=how%20tall/)
  assert.equal(looksLikeUrl('hello world'), false)
  assert.equal(displayUrl('https://example.com/'), 'example.com')
  const s = { searchEngine: 'https://duckduckgo.com/?q=%s', siteSearch: [{ keyword: 'yt', name: 'YouTube', urlTemplate: 'https://www.youtube.com/results?search_query=%s' }] }
  assert.equal(resolveWithSettings('yt cats', s).url, 'https://www.youtube.com/results?search_query=cats')
  assert.equal(resolveWithSettings('cats', s).url, 'https://duckduckgo.com/?q=cats')
})

test('shortcuts: defaults, overrides, labels', () => {
  const ids = new Set(DEFAULT_BINDINGS.map((b) => b.id))
  assert.equal(ids.size, DEFAULT_BINDINGS.length)
  const accel = (id) => DEFAULT_BINDINGS.find((b) => b.id === id).accelerator
  assert.equal(accel('commandbar.new'), 'Cmd+T')
  assert.equal(accel('commandbar.current'), 'Cmd+L')
  assert.equal(accel('tab.togglePin'), 'Cmd+D')
  assert.equal(accel('sidebar.toggle'), 'Cmd+S')
  assert.equal(accel('tab.archiveAllToday'), 'Cmd+Shift+K')
  assert.equal(accel('space.switch:3'), 'Ctrl+3')
  assert.equal(accel('tab.goTo:9'), 'Cmd+9')
  assert.equal(acceleratorLabel('Cmd+Shift+T'), '⇧⌘T')
  assert.equal(acceleratorLabel('Cmd+Alt+Down'), '⌥⌘↓')
  assert.equal(resolveBindings({ 'tab.close': 'Cmd+Shift+X' }).find((b) => b.id === 'tab.close').accelerator, 'Cmd+Shift+X')
})

test('ops: sidebar order is favorites, pinned, today', () => {
  const space = { id: 's1', profileId: 'p1' }
  const it = (id, section, order, extra = {}) => ({ id, section, order, kind: 'tab', spaceId: section === 'favorites' ? null : 's1', profileId: 'p1', parentId: null, ...extra })
  const state = { items: [it('t2', 'today', 1), it('p1', 'pinned', 0), it('f1', 'favorites', 0), it('t1', 'today', 0), it('x', 'today', 0, { spaceId: 's2' })] }
  assert.deepEqual(sidebarOrder(state, space).map((i) => i.id), ['f1', 'p1', 't1', 't2'])
})

test('ops: pinned url, nesting helpers', () => {
  assert.ok(sameUrl('https://example.com/', 'https://example.com'))
  assert.ok(!sameUrl('https://example.com/other', 'https://example.com/'))
  const tab = { kind: 'tab', section: 'pinned', url: 'https://a.b/x', pinnedUrl: 'https://a.b/' }
  assert.ok(awayFromPinned(tab))
  assert.ok(!awayFromPinned({ ...tab, section: 'today' }))
  const f = (id, parentId, kind = 'folder') => ({ id, parentId, kind, order: 0 })
  const state = { items: [f('r', null), f('i', 'r'), f('t', 'i', 'tab')] }
  assert.ok(isWithin(state, 't', 'r'))
  assert.ok(!isWithin(state, 'r', 'i'))
  assert.equal(depthOf(state, state.items[2]), 2)
  assert.deepEqual(descendantsOf(state, 'r').map((x) => x.id), ['i', 't'])
})

console.log(`unit: ${n} passed`)

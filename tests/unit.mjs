// Pure-function checks (Node strips TypeScript types natively).
import assert from 'node:assert/strict'
import { computeLayout, normalizeRatios, splitRect, clampSidebar } from '../src/main/layout/Layout.ts'
import { resolveInput, resolveWithSettings, looksLikeUrl, displayUrl } from '../src/shared/url.ts'
import { acceleratorLabel, resolveBindings, DEFAULT_BINDINGS, bindingAction, normalizeAccelerator } from '../src/shared/commands.ts'
import { sectionOrder, strongTabMatch, suggestionRows, suggestEndpoint, parseSuggestions, queryTokens } from '../src/shared/commandbarRank.ts'
import { sidebarOrder, sameUrl, awayFromPinned, isWithin, depthOf, descendantsOf, windowSpaces } from '../src/shared/ops.ts'

let n = 0
const test = (name, fn) => {
  fn()
  n++
  console.log('ok', name)
}

test('ops: a private space is listed only in its own window', () => {
  const sp = (id, order, incognito) => ({ id, name: id, icon: 'home', profileId: 'p', order, theme: { colors: ['#fff'], angle: 0, noise: 0, appearance: 'light' }, ...(incognito ? { incognito: true } : {}) })
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
  assert.equal(accel('tab.new'), 'Cmd+T')
  // round 3c: Cmd+T is listed as tab.new and opens the command bar in new tab mode
  assert.deepEqual(bindingAction(DEFAULT_BINDINGS.find((b) => b.id === 'tab.new')), { command: 'commandbar.open', payload: { mode: 'new' } })
  // no two bindings of one scope share a key unless they run the same action
  const seen = new Map()
  for (const b of DEFAULT_BINDINGS) {
    const key = (b.scope ?? 'main') + ' ' + normalizeAccelerator(b.accelerator)
    const action = JSON.stringify(bindingAction(b))
    if (seen.has(key)) assert.equal(seen.get(key), action, 'shortcut conflict on ' + key)
    seen.set(key, action)
  }
  assert.equal(normalizeAccelerator('Shift+Command+t'), 'shift+cmd+t')
  assert.equal(normalizeAccelerator('Cmd+Plus'), normalizeAccelerator('Cmd+='))
  assert.equal(accel('commandbar.current'), 'Cmd+L')
  assert.equal(accel('tab.togglePin'), 'Cmd+D')
  assert.equal(accel('sidebar.toggle'), 'Cmd+S')
  assert.equal(accel('tab.archiveAllToday'), 'Cmd+Shift+K')
  assert.equal(accel('space.switch:3'), 'Ctrl+3')
  assert.equal(accel('tab.goTo:9'), 'Cmd+9')
  assert.equal(acceleratorLabel('Cmd+Shift+T'), '⇧⌘T')
  assert.equal(acceleratorLabel('Cmd+Alt+Down'), '⌥⌘↓')
  assert.equal(resolveBindings({ 'tab.close': 'Cmd+Shift+X' }).find((b) => b.id === 'tab.close').accelerator, 'Cmd+Shift+X')
  // Opt+1..9 jump to the Nth favorite, separate from Cmd+1..9
  assert.equal(accel('favorite.goTo.1'), 'Alt+1')
  assert.deepEqual(bindingAction(DEFAULT_BINDINGS.find((b) => b.id === 'favorite.goTo.9')), { command: 'favorite.goTo', payload: { index: 8 } })
})

test('shortcuts: resolveBindings applies an override by binding id', () => {
  const resolved = resolveBindings({ 'commandbar.current': 'Cmd+K' })
  assert.equal(resolved.length, DEFAULT_BINDINGS.length)
  const row = resolved.find((b) => b.id === 'commandbar.current')
  assert.equal(row.accelerator, 'Cmd+K')
  // the action and the rest of the table stay as they were
  assert.deepEqual(bindingAction(row), { command: 'commandbar.open', payload: { mode: 'current' } })
  assert.equal(resolved.find((b) => b.id === 'tab.new').accelerator, 'Cmd+T')
  assert.ok(!resolved.some((b) => b.scope !== 'mini' && normalizeAccelerator(b.accelerator) === 'cmd+l'), 'Cmd+L is free in the main scope after the rebind')
  // empty and unknown overrides are ignored
  assert.deepEqual(resolveBindings({ 'commandbar.current': '', nope: 'Cmd+Q' }), DEFAULT_BINDINGS)
  assert.deepEqual(resolveBindings(undefined), DEFAULT_BINDINGS)
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


test('command bar: search and suggestions rank above weakly matching tabs', () => {
  const decoy = { title: 'fine ill do it myself - Google Search', url: 'https://www.google.com/search?q=fine' }
  assert.deepEqual(queryTokens('what is pumpking'), ['what', 'pumpking'])
  assert.equal(strongTabMatch('what is pumpking', decoy.title, decoy.url), false)
  assert.equal(strongTabMatch('what are jolly ranchers made of search', decoy.title, decoy.url), false)
  assert.equal(strongTabMatch('pumpkin carving', 'Pumpkin carving guide', 'http://127.0.0.1:1/x'), true)
  assert.equal(strongTabMatch('github', 'Pull requests', 'https://github.com/pulls'), true, 'host counts')
  assert.equal(strongTabMatch('go', 'Go docs', 'https://go.dev'), false, 'no token of 3+ characters')
  assert.equal(strongTabMatch('example.com/path', 'x', 'https://example.com/path?a=1', true), true)
  assert.deepEqual(sectionOrder('what is pumpking', 'search', false).slice(0, 3), ['search', 'suggestion', 'tab'])
  assert.deepEqual(sectionOrder('what are jolly ranchers made', 'search', true).slice(0, 3), ['search', 'suggestion', 'tab'], 'long query keeps search first even with a strong tab')
  assert.deepEqual(sectionOrder('pumpkin carving', 'search', true).slice(0, 2), ['tab', 'search'])
  assert.equal(sectionOrder('example.com/path', 'url', true)[0], 'url')
  assert.equal(sectionOrder('yt cats', 'siteSearch', false)[0], 'sitesearch')
  assert.deepEqual(sectionOrder('', 'search', false), ['tab', 'command'])
  assert.deepEqual(suggestionRows('cats', ['cats', 'cats memes', 'Cats Memes', 'cat videos', '', 'a', 'b', 'c', 'd']), ['cats memes', 'cat videos', 'a', 'b', 'c', 'd'])
  assert.match(suggestEndpoint('https://www.google.com/search?q=%s'), /suggestqueries\.google\.com.*client=chrome/)
  assert.match(suggestEndpoint('https://duckduckgo.com/?q=%s'), /ac\.duckduckgo\.com\/ac\/\?type=list/)
  assert.match(suggestEndpoint('https://www.bing.com/search?q=%s'), /api\.bing\.com\/osjson/)
  assert.equal(suggestEndpoint('https://kagi.com/search?q=%s'), null)
  assert.deepEqual(parseSuggestions(['q', ['a', 'b', 3], [], { x: 1 }]), ['a', 'b'])
  assert.deepEqual(parseSuggestions({ q: 1 }), [])
})

console.log(`unit: ${n} passed`)

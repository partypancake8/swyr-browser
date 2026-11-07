// Headless end-to-end flows through the __swyr test hook. Captures land in SWYR_TEST_OUT.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launch, sleep } from './harness.mjs'

const out = process.env.SWYR_TEST_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'swyr-e2e-'))
fs.mkdirSync(out, { recursive: true })
const frame = (name) => path.join(out, name + '.png')

const t = await launch({ log: process.env.SWYR_TEST_LOG === '1' })
const step = (name) => console.log('step', name)
try {
  let s = await t.waitFor((s) => s.windows?.length === 1 && s.spaces.length === 1, 'initial state')
  assert.equal(s.profiles[0].name, 'Personal')
  assert.equal(s.spaces[0].name, 'Personal')
  assert.equal(s.settings.archiveAfter, '12h')
  assert.equal(s.settings.sidebarWidth, 260)
  assert.ok(s.spaces[0].theme.colors.length === 2)

  step('light appearance + new tab page')
  await t.dispatch('space.edit', { theme: { appearance: 'light' } })
  await t.dispatch('tab.new')
  s = await t.waitFor((s) => s.items.some((i) => i.url.startsWith('swyr://newtab') && i.title === 'New Tab'), 'newtab page')
  await t.waitIdle()
  await sleep(600)
  await t.capture(frame('01-newtab-light'))

  step('navigate the new tab in place')
  await t.dispatch('tab.navigate', { input: 'example.com' })
  s = await t.waitFor((s) => s.items.length === 1 && /Example Domain/.test(s.items[0].title), 'navigated in place')
  const first = s.items[0]

  step('favorite + pinned + today')
  await t.dispatch('tab.favorite', { id: first.id })
  await t.dispatch('tab.new', { url: 'https://example.org' })
  await t.dispatch('tab.pin')
  await t.dispatch('tab.new', { url: 'https://example.net' })
  s = await t.waitFor((s) => s.items.filter((i) => /Example Domain/.test(i.title)).length === 3, 'three loaded')
  assert.deepEqual(s.items.map((i) => i.section).sort(), ['favorites', 'pinned', 'today'])
  await t.dispatch('tab.rename', { id: s.items.find((i) => i.section === 'pinned').id, title: 'Docs' })
  await sleep(500)
  await t.capture(frame('02-sections-light'))

  step('tab.next / tab.prev / goTo')
  await t.dispatch('tab.goTo', { index: 0 })
  s = await t.state()
  assert.equal(s.windows[0].activeItemId, first.id)
  await t.dispatch('tab.next')
  s = await t.state()
  assert.equal(s.items.find((i) => i.id === s.windows[0].activeItemId).section, 'pinned')
  await t.dispatch('tab.prev')
  s = await t.state()
  assert.equal(s.windows[0].activeItemId, first.id)

  step('find overlay')
  await t.dispatch('find.open')
  await sleep(300)
  await t.dispatch('find.update', { query: 'domain' })
  s = await t.waitFor((s) => s.windows[0].overlay?.kind === 'find' && s.windows[0].overlay.matches > 0, 'find matches')
  await sleep(300)
  await t.capture(frame('03-find'))
  await t.dispatch('find.close')

  step('zoom')
  assert.equal(await t.dispatch('zoom.in'), 0.5)
  assert.equal(await t.dispatch('zoom.reset'), 0)

  step('command bar in current mode with a query')
  await t.dispatch('commandbar.open', { mode: 'current', query: 'exam' })
  await sleep(800)
  await t.capture(frame('04-commandbar-query'))
  await t.dispatch('commandbar.close')
  s = await t.state()
  assert.equal(s.windows[0].overlay, null)

  step('space editor')
  await t.dispatch('space.edit')
  await sleep(700)
  await t.capture(frame('05-space-editor'))
  await t.dispatch('overlay.close')

  step('sidebar width + hidden + peek')
  assert.equal(await t.dispatch('sidebar.setWidth', { width: 999 }), 400)
  assert.equal(await t.dispatch('sidebar.setWidth', { width: 300 }), 300)
  await t.dispatch('sidebar.toggle')
  s = await t.waitFor((s) => !s.windows[0].sidebarVisible, 'hidden')
  await sleep(300)
  await t.capture(frame('06-sidebar-hidden'))
  await t.dispatch('sidebar.peek', { show: true })
  await sleep(600)
  await t.capture(frame('07-sidebar-peek'))
  await t.dispatch('sidebar.peek', { show: false })
  await t.dispatch('sidebar.toggle')

  step('archive all today + archive page + restore')
  const before = (await t.state()).archive.length
  await t.dispatch('tab.archiveAllToday')
  s = await t.waitFor((s) => s.archive.length === before + 1 && !s.items.some((i) => i.section === 'today'), 'today archived')
  assert.equal(s.archive.at(-1).reason, 'manual')
  await t.dispatch('archive.open')
  s = await t.waitFor((s) => s.items.some((i) => i.url.startsWith('swyr://archive')), 'archive page')
  await t.waitIdle()
  await sleep(700)
  await t.capture(frame('08-archive-page'))
  await t.dispatch('archive.restore', { id: s.archive.at(-1).id })
  s = await t.waitFor((s) => s.items.some((i) => i.url.includes('example.net')), 'restored')

  step('close unloads pinned, archives today')
  const pinned = s.items.find((i) => i.section === 'pinned')
  await t.dispatch('tab.close', { id: pinned.id })
  s = await t.state()
  assert.ok(s.items.some((i) => i.id === pinned.id), 'pinned tab stays in the sidebar')
  assert.ok(!s.windows[0].loaded.includes(pinned.id), 'pinned tab unloaded')

  step('spaces by index, next, prev, dark space')
  await t.dispatch('space.new', { name: 'Work', emoji: '💼' })
  await t.dispatch('space.edit', { theme: { appearance: 'dark' } })
  await t.dispatch('tab.new', { url: 'https://example.com' })
  await t.waitFor((s) => s.items.filter((i) => i.spaceId === s.windows[0].activeSpaceId).length === 1, 'work tab')
  await t.waitIdle()
  await sleep(500)
  await t.capture(frame('09-work-dark'))
  s = await t.state()
  await t.dispatch('space.switch', { index: 0 })
  s = await t.waitFor((s) => s.windows[0].activeSpaceId === s.spaces[0].id, 'space 1')
  await t.dispatch('space.prev')
  s = await t.waitFor((s) => s.windows[0].activeSpaceId === s.spaces[1].id, 'space prev wraps')

  step('raw shortcuts through before-input-event')
  const key = (keyCode, modifiers) =>
    t.app.evaluate(({ webContents }, [k, m]) => {
      const wc = webContents.getAllWebContents().find((w) => w.getURL().startsWith('swyr://shell'))
      wc.sendInputEvent({ type: 'keyDown', keyCode: k, modifiers: m })
      wc.sendInputEvent({ type: 'keyUp', keyCode: k, modifiers: m })
    }, [keyCode, modifiers])
  await key('2', ['control'])
  await t.waitFor((s) => s.windows[0].activeSpaceId === s.spaces[1].id, 'ctrl+2')
  await key('Left', ['meta', 'alt'])
  await t.waitFor((s) => s.windows[0].activeSpaceId === s.spaces[0].id, 'cmd+opt+left')

  step('profile session user agent has no Electron or swyr token')
  const ua = await t.app.evaluate(({ session }, part) => session.fromPartition(part).getUserAgent(), s.profiles[0].partition)
  assert.ok(/Chrome\//.test(ua) && !/Electron|swyr/i.test(ua), ua)

  step('second window')
  await t.dispatch('window.new')
  s = await t.waitFor((s) => s.windows.length === 2, 'two windows')
  await t.app.evaluate(({ BaseWindow }, id) => BaseWindow.fromId(id)?.close(), s.windows[1].id)
  await t.waitFor((s) => s.windows.length === 1, 'back to one window')

  step('warm cache keeps at most 8 views')
  for (let i = 0; i < 10; i++) await t.dispatch('tab.new', { url: `swyr://newtab/?n=${i}` })
  s = await t.state()
  assert.ok(s.windows[0].loaded.length <= 8, 'loaded ' + s.windows[0].loaded.length)

  step('auto archive honours archiveAfter')
  const n0 = (await t.state()).archive.length
  await t.dispatch('settings.set', { archiveAfter: '12h' })
  assert.equal(await t.dispatch('archive.runAuto'), 0)
  assert.equal((await t.state()).archive.length, n0)

  step('persistence')
  await sleep(800)
  const persisted = JSON.parse(fs.readFileSync(path.join(t.userData, 'state.json'), 'utf8'))
  assert.equal(persisted.schemaVersion, 1)
  assert.equal(persisted.spaces.length, 2)
  console.log(`e2e: passed, frames in ${out}`)
} finally {
  await t.close()
}

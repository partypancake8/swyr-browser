// Headless sidebar flows: nested folders, drag and drop with real mouse input, inline rename, space editor, dialogs, swipe.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launch, sleep } from './harness.mjs'

const out = process.env.SWYR_TEST_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'swyr-sidebar-'))
fs.mkdirSync(out, { recursive: true })
const frame = (name) => path.join(out, name + '.png')
const page = (title) => `data:text/html,<title>${title}</title><h1>${title}</h1>`

const t = await launch({ log: process.env.SWYR_TEST_LOG === '1' })
const step = (name) => console.log('step', name)

/** run JS in the shell renderer */
const shellJs = (code) =>
  t.app.evaluate(({ webContents }, c) => webContents.getAllWebContents().find((w) => w.getURL().startsWith('swyr://shell')).executeJavaScript(c), code)
const input = (events) =>
  t.app.evaluate(async ({ webContents }, evs) => {
    const wc = webContents.getAllWebContents().find((w) => w.getURL().startsWith('swyr://shell'))
    for (const e of evs) {
      if (e.wait) await new Promise((r) => setTimeout(r, e.wait))
      else wc.sendInputEvent(e)
    }
  }, events)
const rectOf = async (selector) => {
  const r = await shellJs(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height } })()`)
  assert.ok(r, 'no element for ' + selector)
  return r
}
/** press on one element, move in steps, release at a point computed after the drag started */
async function drag(fromSel, toTarget, beforeUp) {
  const a = await rectOf(fromSel)
  const sx = Math.round(a.x + a.w / 2)
  const sy = Math.round(a.y + a.h / 2)
  await input([
    { type: 'mouseMove', x: sx, y: sy },
    { type: 'mouseDown', x: sx, y: sy, button: 'left', clickCount: 1 },
    { wait: 60 },
    { type: 'mouseMove', x: sx + 3, y: sy + 3, modifiers: ['leftButtonDown'] },
    { wait: 30 },
    { type: 'mouseMove', x: sx + 8, y: sy + 8, modifiers: ['leftButtonDown'] },
    { wait: 120 }
  ])
  const [tx, ty] = await toTarget()
  const moves = []
  for (let i = 1; i <= 8; i++) {
    moves.push({ type: 'mouseMove', x: Math.round(sx + ((tx - sx) * i) / 8), y: Math.round(sy + ((ty - sy) * i) / 8), modifiers: ['leftButtonDown'] }, { wait: 25 })
  }
  await input([...moves, { wait: 120 }, { type: 'mouseMove', x: tx, y: ty, modifiers: ['leftButtonDown'] }, { wait: 120 }])
  if (beforeUp) await beforeUp()
  await input([{ type: 'mouseUp', x: tx, y: ty, button: 'left', clickCount: 1 }])
  await sleep(400)
}
const center = (sel, fy = 0.5) => async () => {
  const r = await rectOf(sel)
  return [Math.round(r.x + r.w / 2), Math.round(r.y + r.h * fy)]
}

try {
  let s = await t.waitFor((s) => s.windows?.length === 1, 'initial state')
  await t.dispatch('space.edit', { theme: { appearance: 'light' } })

  step('tabs, folders and a nested folder with a tab inside')
  for (const name of ['Alpha', 'Beta', 'Gamma', 'Delta']) await t.dispatch('tab.new', { url: page(name) })
  s = await t.waitFor((s) => s.items.filter((i) => i.kind === 'tab' && /^(Alpha|Beta|Gamma|Delta)$/.test(i.title)).length === 4, 'four titled tabs')
  const id = (title) => s.items.find((i) => i.title === title).id
  const [A, B, C, D] = ['Alpha', 'Beta', 'Gamma', 'Delta'].map(id)
  const research = await t.dispatch('folder.new', { name: 'Research', section: 'pinned' })
  const inner = await t.dispatch('folder.new', { name: 'Inner', section: 'pinned', parentId: research })
  await t.dispatch('tab.move', { itemId: A, section: 'pinned', parentId: inner, index: 0 })
  await t.dispatch('tab.move', { itemId: B, section: 'pinned', parentId: research })
  s = await t.state()
  assert.equal(s.items.find((i) => i.id === A).parentId, inner)
  assert.ok(s.items.find((i) => i.id === A).pinnedUrl, 'pinned url set')
  assert.equal(s.items.find((i) => i.id === research).customTitle, null)
  await t.dispatch('tab.activate', { id: A })
  await sleep(700)
  await t.capture(frame('s01-nested-folder'))
  const depthA = await shellJs(`document.querySelector('[data-item="${A}"]').dataset.depth`)
  assert.equal(depthA, '2', 'tab inside Inner is indented two levels')

  step('folder.toggle hides children, folder.rename keeps customTitle null')
  await t.dispatch('folder.toggle', { itemId: research })
  await sleep(200)
  assert.equal(await shellJs(`Boolean(document.querySelector('[data-item="${A}"]'))`), false)
  await t.dispatch('folder.toggle', { itemId: research })
  await t.dispatch('folder.rename', { itemId: inner, title: 'Deep' })
  s = await t.state()
  assert.equal(s.items.find((i) => i.id === inner).title, 'Deep')

  step('drag a Today tab onto a folder nests and pins it')
  await sleep(300)
  await drag(`[data-item="${C}"]`, center(`[data-item="${research}"]`))
  s = await t.waitFor((s) => s.items.find((i) => i.id === C).parentId === research, 'dropped into folder')
  assert.equal(s.items.find((i) => i.id === C).section, 'pinned')

  step('drag a pinned tab below the divider unpins it')
  await drag(`[data-item="${A}"]`, center(`[data-section="today"] [data-item="${D}"]`, 0.8))
  s = await t.waitFor((s) => s.items.find((i) => i.id === A).section === 'today', 'unpinned by drag')
  assert.equal(s.items.find((i) => i.id === A).pinnedUrl, null)
  assert.equal(s.items.find((i) => i.id === A).parentId, null)
  const today = s.items.filter((i) => i.section === 'today' && i.spaceId === s.spaces[0].id).sort((a, b) => a.order - b.order).map((i) => i.id)
  assert.deepEqual(today.slice(-2), [D, A], 'dropped after Delta')

  step('drag a tab onto the favorites zone favorites it')
  await drag(`[data-item="${D}"]`, center('[data-section="favorites"]'))
  s = await t.waitFor((s) => s.items.find((i) => i.id === D).section === 'favorites', 'favorited by drag')
  assert.equal(s.items.find((i) => i.id === D).spaceId, null)

  step('inline rename by typing')
  await t.dispatch('tab.rename', { itemId: B })
  await sleep(300)
  await shellJs(`(() => { const el = document.querySelector('input[aria-label="Name"]'); el.focus(); el.select(); return true })()`)
  await input([...'Reading'].map((ch) => ({ type: 'char', keyCode: ch })).concat([{ type: 'keyDown', keyCode: 'Return' }, { type: 'char', keyCode: '\r' }, { type: 'keyUp', keyCode: 'Return' }]))
  s = await t.waitFor((s) => s.items.find((i) => i.id === B).customTitle === 'Reading', 'renamed inline')
  await t.dispatch('tab.rename', { itemId: B, title: '' })
  s = await t.state()
  assert.equal(s.items.find((i) => i.id === B).customTitle, null, 'empty title resets')

  step('back to pinned affordance')
  await t.dispatch('tab.navigate', { itemId: B, url: page('Elsewhere') })
  await sleep(500)
  assert.ok(await shellJs(`Boolean(document.querySelector('[data-item="${B}"] button[aria-label="Back to pinned URL"]'))`))
  await t.capture(frame('s02-dragged-and-away'))
  await shellJs(`document.querySelector('[data-item="${B}"] button[aria-label="Back to pinned URL"]').click()`)
  s = await t.waitFor((s) => s.items.find((i) => i.id === B).url.includes('Beta'), 'reset by button')

  step('spaces: create, drag a tab onto a space button, drag to reorder')
  const second = await t.dispatch('space.new', { name: 'Work', emoji: '💼', theme: { colors: ['#9ad0ec', '#c8b6ff'], angle: 90, noise: 0.1, appearance: 'light' }, activate: false })
  await sleep(300)
  await drag(`[data-item="${A}"]`, center(`[data-space="${second}"]`))

  s = await t.waitFor((s) => s.items.find((i) => i.id === A).spaceId === second, 'moved to space by drag')
  const home = s.spaces[0].id
  await drag(`[data-space="${second}"]`, center(`[data-space="${home}"]`))
  s = await t.waitFor((s) => s.spaces[0].id === second, 'reordered by drag')

  step('swipe between spaces')
  const before = s.windows[0].activeSpaceId
  const side = await rectOf('[data-section="pinned"]')
  const wheel = []
  for (let i = 0; i < 12; i++) wheel.push({ type: 'mouseWheel', x: Math.round(side.x + 40), y: Math.round(side.y + 10), deltaX: -30, deltaY: 0, hasPreciseScrollingDeltas: true }, { wait: 16 })
  await input(wheel)
  s = await t.waitFor((s) => s.windows[0].activeSpaceId !== before, 'swiped to another space')
  await sleep(500)
  await t.capture(frame('s03-after-swipe'))

  step('space editor and dialogs')
  await t.dispatch('space.edit', { id: home })
  await sleep(700)
  await t.capture(frame('s04-space-editor'))
  await t.dispatch('overlay.close')
  await t.dispatch('dialog.open', { dialog: 'confirmDeleteSpace', spaceId: second })
  await sleep(600)
  await t.capture(frame('s05-confirm-delete'))
  await t.dispatch('overlay.close')
  assert.equal(await t.dispatch('menu.popup', { entries: [{ label: 'One', command: 'tab.new' }, { type: 'separator' }] }).then((r) => r.length), 2)

  step('folder.delete moves children up; space.delete never removes the last space')
  await t.dispatch('space.switch', { id: home })
  await t.dispatch('folder.delete', { itemId: research })
  s = await t.state()
  assert.ok(!s.items.some((i) => i.id === research))
  assert.equal(s.items.find((i) => i.id === inner).parentId, null)
  assert.equal(s.items.find((i) => i.id === B).parentId, null)
  await t.dispatch('space.delete', { id: second })
  s = await t.waitFor((s) => s.spaces.length === 1, 'space deleted')
  assert.ok(s.archive.some((a) => a.item.id === A && a.reason === 'closed'), 'today tab of the deleted space closed into the archive')
  assert.equal(await t.dispatch('space.delete', { id: s.spaces[0].id }), false)

  step('library spaces section')
  await t.dispatch('library.open', { section: 'spaces' })
  await t.waitFor((s) => s.items.some((i) => i.url.startsWith('swyr://library')), 'library tab')
  await sleep(1000)
  await t.capture(frame('s06-library-spaces'))
  const n = (await t.state()).items.length
  await t.dispatch('library.open')
  assert.equal((await t.state()).items.length, n, 'library tab reused')
  step('drag a Today tab out of the sidebar onto the page edge splits the view')
  await t.dispatch('tab.new', { url: page('Echo') })
  await t.dispatch('tab.new', { url: page('Foxtrot') })
  s = await t.waitFor((s) => ['Echo', 'Foxtrot'].every((n) => s.items.some((i) => i.title === n)), 'two more tabs')
  const E = s.items.find((i) => i.title === 'Echo').id
  const F = s.items.find((i) => i.title === 'Foxtrot').id
  await t.dispatch('tab.activate', { id: E })
  await t.waitIdle()
  await sleep(300)
  const wb = s.windows[0].bounds
  const edgePoint = async () => [Math.round(wb.width - 40), Math.round(wb.height / 2)]
  let zones = null
  await drag(`[data-item="${F}"]`, edgePoint, async () => {
    zones = await t.waitFor((s) => s.windows[0].overlay?.kind === 'splitDrop' && s.windows[0].overlay.edge === 'right', 'drop zones with the right edge highlighted')
    await t.capture(frame('s07-drag-to-split'))
  })
  assert.ok(zones)
  s = await t.waitFor((s) => s.items.some((i) => i.kind === 'split' && i.panes?.itemIds.join() === [E, F].join()), 'split made by the sidebar drag')
  assert.equal(s.windows[0].overlay, null, 'drop zones closed after the drop')
  const splitItem = s.items.find((i) => i.kind === 'split')
  assert.equal(await shellJs(`document.querySelector('[data-item="${splitItem.id}"]')?.dataset.split`), '2', 'one sidebar row for the split')
  await sleep(500)
  await t.capture(frame('s08-split-from-drag'))

  console.log(`sidebar e2e: passed, frames in ${out}`)
} finally {
  await t.close()
}

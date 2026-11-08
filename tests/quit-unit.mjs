// Quit path and canvas thumbnails (pure parts, no Electron): src/main/util/QuitGuard.ts, src/main/documents/BoardThumb.ts
import assert from 'node:assert/strict'
import zlib from 'node:zlib'
import { installQuitGuard, QUIT_WATCHDOG_MS, QUIT_GRACE_MS } from '../src/main/util/QuitGuard.ts'
import { blankBoardPng, blankBoardDataUrl, BOARD_W, BOARD_H } from '../src/main/documents/BoardThumb.ts'

let n = 0
const test = (name, fn) => {
  fn()
  n++
  console.log('ok', name)
}

function fakeApp() {
  const handlers = {}
  const timers = []
  const calls = { exit: 0, quit: 0 }
  return {
    handlers,
    timers,
    calls,
    app: {
      on: (ev, fn) => (handlers[ev] ??= []).push(fn),
      exit: () => calls.exit++,
      quit: () => calls.quit++
    },
    emit: (ev) => (handlers[ev] ?? []).forEach((fn) => fn()),
    setTimer: (fn, ms) => timers.push({ fn, ms }),
    fire: (ms) => timers.filter((t) => t.ms === ms).forEach((t) => t.fn())
  }
}

test('quit guard: before-quit arms an exit watchdog and a teardown after the grace period', () => {
  const f = fakeApp()
  let torn = 0
  const g = installQuitGuard(f.app, { teardown: () => (torn++, 0), setTimer: f.setTimer })
  assert.equal(g.quitting, false)
  f.emit('before-quit')
  assert.equal(g.quitting, true)
  assert.deepEqual(f.timers.map((t) => t.ms).sort((a, b) => a - b), [QUIT_GRACE_MS, QUIT_WATCHDOG_MS])
  assert.ok(QUIT_WATCHDOG_MS <= 5000 && QUIT_GRACE_MS < QUIT_WATCHDOG_MS)
  f.fire(QUIT_GRACE_MS)
  assert.equal(torn, 1)
  assert.equal(f.calls.quit, 0, 'no windows were left, so the quit is not restarted')
  f.fire(QUIT_WATCHDOG_MS)
  assert.equal(f.calls.exit, 1)
})

test('quit guard: a window that vetoed its close is destroyed and the quit restarted', () => {
  const f = fakeApp()
  installQuitGuard(f.app, { teardown: () => 2, setTimer: f.setTimer })
  f.emit('before-quit')
  f.fire(QUIT_GRACE_MS)
  assert.equal(f.calls.quit, 1)
})

test('quit guard: a second before-quit does not arm a second watchdog; teardown runs once', () => {
  const f = fakeApp()
  let torn = 0
  installQuitGuard(f.app, { teardown: () => (torn++, 0), setTimer: f.setTimer })
  f.emit('before-quit')
  f.emit('before-quit')
  assert.equal(f.timers.length, 2)
  f.emit('will-quit')
  f.fire(QUIT_GRACE_MS)
  assert.equal(torn, 1)
})

test('quit guard: a throwing teardown still leaves the watchdog in place', () => {
  const f = fakeApp()
  const logs = []
  installQuitGuard(f.app, { teardown: () => { throw new Error('boom') }, setTimer: f.setTimer, log: (m) => logs.push(m) })
  f.emit('will-quit')
  assert.ok(logs.some((m) => /boom/.test(m)))
  f.fire(QUIT_WATCHDOG_MS)
  assert.equal(f.calls.exit, 1)
})

test('board thumbnail: a valid RGB PNG of the board size, big enough to be real image data', () => {
  const png = blankBoardPng()
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  assert.equal(png.toString('ascii', 12, 16), 'IHDR')
  assert.equal(png.readUInt32BE(16), BOARD_W)
  assert.equal(png.readUInt32BE(20), BOARD_H)
  const idatLen = png.readUInt32BE(33)
  assert.equal(png.toString('ascii', 37, 41), 'IDAT')
  const raw = zlib.inflateSync(png.subarray(41, 41 + idatLen))
  assert.equal(raw.length, (BOARD_W * 3 + 1) * BOARD_H)
  const url = blankBoardDataUrl()
  assert.match(url, /^data:image\/png;base64,[A-Za-z0-9+/=]+$/)
  assert.ok(url.length > 200 && url.length < 1_500_000)
  assert.equal(blankBoardDataUrl(), url)
})

console.log(`quit-unit: ${n} checks passed`)

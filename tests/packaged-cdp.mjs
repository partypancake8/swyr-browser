// Drives the packaged app without the Node inspector. Its Electron fuses are locked (no --inspect, no
// ELECTRON_RUN_AS_NODE), so Playwright's _electron.launch, which needs the inspector, cannot attach. These helpers
// start the binary with --remote-debugging-port (a Chromium switch, not a fuse), talk Chrome DevTools Protocol to
// its pages, and run commands through the same window.swyr bridge the sidebar uses.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { repo, sleep } from './harness.mjs'

export const appPath = path.resolve(process.env.SWYR_PACKAGED_APP || path.join(repo, 'dist/mac-arm64/swyr.app'))
export const binary = path.join(appPath, 'Contents/MacOS/swyr')
assert.ok(fs.existsSync(binary), `no app at ${appPath}: build it first with npm run dist`)

export const tempDir = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix))

/** start the packaged binary headless (SWYR_TEST=1 never shows a window) in a fresh profile */
export function start(args, env = {}) {
  const userData = env.SWYR_USER_DATA ?? tempDir('swyr-packaged-data-')
  const proc = spawn(binary, args, { env: { ...process.env, SWYR_TEST: '1', SWYR_USER_DATA: userData, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  proc.stdout.on('data', (d) => (output += d))
  proc.stderr.on('data', (d) => (output += d))
  const exited = new Promise((r) => proc.once('exit', r))
  return { proc, exited, userData, output: () => output }
}

export async function until(fn, label, ms = 30000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    const v = await fn()
    if (v) return v
    await sleep(300)
  }
  throw new Error('timeout waiting for ' + label)
}

/** a minimal CDP client over Node's WebSocket */
export async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = () => reject(new Error('CDP connect failed'))
  })
  let next = 0
  const pending = new Map()
  const listeners = []
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data)
    if (msg.method) for (const fn of listeners) fn(msg.method, msg.params)
    const p = pending.get(msg.id)
    if (!p) return
    pending.delete(msg.id)
    if (msg.error) p.reject(new Error(msg.error.message))
    else p.resolve(msg.result)
  }
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++next
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => pending.has(id) && (pending.delete(id), reject(new Error('CDP timeout: ' + method))), 30000)
    })
  async function evaluate(expression) {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
    return r.result.value
  }
  return { send, evaluate, on: (fn) => listeners.push(fn), close: () => ws.close() }
}

/** launch, attach to the first window's sidebar renderer, and return helpers bound to it */
export async function launchPackaged(extraArgs = [], env = {}) {
  const run = start(['--remote-debugging-port=0', ...extraArgs], env)
  const port = await until(() => run.output().match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//)?.[1], 'DevTools endpoint')
  const targets = () => fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json()).catch(() => [])
  const target = (pred, label, ms) => until(async () => (await targets()).find(pred), label, ms)
  const shellTarget = await target((t) => t.type === 'page' && t.url.startsWith('swyr://shell'), 'sidebar renderer')
  const shell = await connect(shellTarget.webSocketDebuggerUrl)
  await until(() => shell.evaluate('typeof window.swyr?.getState === "function"'), 'window.swyr bridge')
  const view = () => shell.evaluate('window.swyr.getState()')
  const invoke = (command, payload) => shell.evaluate(`window.swyr.invoke(${JSON.stringify(command)}, ${JSON.stringify(payload ?? null)})`)
  const activeItem = (v) => v?.state.items.find((i) => i.id === v.window.activeItemId)
  async function close() {
    await invoke('app.quit').catch(() => undefined)
    shell.close()
    const done = await Promise.race([run.exited.then(() => true), sleep(15000).then(() => false)])
    if (!done) run.proc.kill('SIGKILL')
  }
  return { run, port, targets, target, shell, view, invoke, activeItem, close }
}

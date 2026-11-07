// Shared launcher for headless checks: starts the built app through the __swyr test hook.
import { createRequire } from 'node:module'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

export const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(path.join(repo, 'package.json'))
const { _electron } = require('playwright')

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function launch({ userData, log } = {}) {
  const dir = userData ?? fs.mkdtempSync(path.join(os.tmpdir(), 'swyr-test-'))
  const app = await _electron.launch({
    args: [path.join(repo, 'out/main/index.js')],
    env: { ...process.env, SWYR_TEST: '1', SWYR_USER_DATA: dir },
    timeout: 60000
  })
  if (log) {
    app.process().stdout?.on('data', (d) => process.stdout.write('[main] ' + d))
    app.process().stderr?.on('data', (d) => process.stdout.write('[main:err] ' + d))
  }
  const withTimeout = (p, ms, label) =>
    Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout: ' + label)), ms))])
  const api = {
    app,
    userData: dir,
    state: () => withTimeout(app.evaluate(() => globalThis.__swyr?.getState() ?? null), 10000, 'getState'),
    dispatch: (command, payload) =>
      withTimeout(app.evaluate((_e, [c, p]) => globalThis.__swyr.dispatch(c, p), [command, payload]), 15000, command),
    capture: (file) => withTimeout(app.evaluate((_e, f) => globalThis.__swyr.capture(f), file), 20000, 'capture'),
    waitIdle: () => withTimeout(app.evaluate(() => globalThis.__swyr.waitIdle()), 35000, 'waitIdle'),
    async waitFor(pred, label, ms = 30000) {
      const t0 = Date.now()
      while (Date.now() - t0 < ms) {
        const s = await api.state()
        if (s && pred(s)) return s
        await sleep(250)
      }
      throw new Error('timeout waiting for ' + label)
    },
    close: () => withTimeout(app.close(), 15000, 'close').catch(() => app.process().kill('SIGKILL'))
  }
  return api
}

// Test hook (SWYR_TEST=1 only): globalThis.__swyr drives the app headlessly.
import { nativeImage, type NativeImage, type WebContentsView } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { Rect, TestState } from '@shared/types'
import { TAB_RADIUS } from '../views/TabViews'
import { PREVIEW_RADIUS } from '../layout/Layout'
import { MINI_RADIUS } from '../windows/MiniWindow'
import type { Core } from '../windows/WindowManager'
import { activePartition, platformRuntime } from '../commands/platform'
import { partitionOf } from '../profiles/Profiles'
import { probe as probeFrontmost, setSourceAppOverride } from '../linkrules/SourceApp'

export interface SwyrTestHook {
  getState(): TestState | null
  dispatch(command: string, payload?: unknown): Promise<unknown>
  waitIdle(): Promise<void>
  capture(filePath: string): Promise<boolean>
  // round 2a
  /** composite of a Mini Window (chrome + page); the main capture never includes mini windows */
  captureMini(filePath: string, id?: number): Promise<boolean>
  /** round 2c: partition of the active tab's session in the first window */
  activePartition(): string
  // round 3c
  /** run a command in a given window (main windows by id) */
  dispatchIn?(windowId: number, command: string, payload?: unknown): Promise<unknown>
  /** the session partition of a window's active tab */
  partitionOf?(windowId: number): string
  /** run JavaScript in the first window's active tab or focused pane and return its result */
  evalInActiveTab?(js: string): Promise<unknown>
  // round 5
  /** run JavaScript in a main window's shell (the sidebar renderer) and return its result */
  shellEvalIn?(windowId: number, js: string): Promise<unknown>
  /** pretend this app is frontmost when links arrive (Link Rules by source app); null for none, undefined for the real probe */
  setSourceApp?(app: { name: string; bundleId?: string } | null | undefined): void
  /** run the real frontmost-app probe once and report what it saw and how long it took */
  probeSourceApp?(): Promise<{ app: { name: string; bundleId: string } | null; ms: number }>
}

declare global {
  var __swyr: SwyrTestHook | undefined
}

interface Layer {
  image: NativeImage
  bounds: Rect
  radius: number
}

async function grab(view: Pick<WebContentsView, 'webContents'>): Promise<NativeImage | null> {
  try {
    if (view.webContents.isDestroyed()) return null
    const img = await view.webContents.capturePage(undefined, { stayHidden: true })
    return img.isEmpty() ? null : img
  } catch {
    return null
  }
}

/** source-over composite of BGRA layers (premultiplied) onto an opaque canvas */
export function composite(width: number, height: number, scale: number, layers: Layer[]): NativeImage {
  const W = Math.max(1, Math.round(width * scale))
  const H = Math.max(1, Math.round(height * scale))
  const out = Buffer.alloc(W * H * 4)
  for (let i = 0; i < out.length; i += 4) out[i + 3] = 255
  for (const layer of layers) {
    const bw = Math.max(1, Math.round(layer.bounds.width * scale))
    const bh = Math.max(1, Math.round(layer.bounds.height * scale))
    const size = layer.image.getSize()
    const img = size.width === bw && size.height === bh ? layer.image : layer.image.resize({ width: bw, height: bh, quality: 'best' })
    const src = img.toBitmap()
    const sw = img.getSize().width
    const sh = img.getSize().height
    const ox = Math.round(layer.bounds.x * scale)
    const oy = Math.round(layer.bounds.y * scale)
    const r = layer.radius * scale
    for (let y = 0; y < sh; y++) {
      const ty = oy + y
      if (ty < 0 || ty >= H) continue
      for (let x = 0; x < sw; x++) {
        const tx = ox + x
        if (tx < 0 || tx >= W) continue
        if (r > 0) {
          const cx = x < r ? r : x > sw - r ? sw - r : x
          const cy = y < r ? r : y > sh - r ? sh - r : y
          const dx = x - cx
          const dy = y - cy
          if (dx * dx + dy * dy > r * r) continue
        }
        const si = (y * sw + x) * 4
        const di = (ty * W + tx) * 4
        const a = src[si + 3]
        if (a === 255) {
          out[di] = src[si]
          out[di + 1] = src[si + 1]
          out[di + 2] = src[si + 2]
        } else if (a > 0) {
          const k = 1 - a / 255
          out[di] = Math.min(255, src[si] + out[di] * k)
          out[di + 1] = Math.min(255, src[si + 1] + out[di + 1] * k)
          out[di + 2] = Math.min(255, src[si + 2] + out[di + 2] * k)
        }
      }
    }
  }
  return nativeImage.createFromBitmap(out, { width: W, height: H })
}

/**
 * Installed synchronously at startup so the hook exists as soon as the app process does;
 * calls made before the app is ready return null (getState) or wait for readiness.
 */
export function installTestHook(ready: Promise<Core>, current: () => Core | null): void {
  globalThis.__swyr = {
    getState(): TestState | null {
      const core = current()
      if (!core) return null
      const { extensions, downloads, adblockStats, update } = platformRuntime()
      const windows = [
        ...core.windows.map((w) => ({ ...w.runtime(), kind: 'main' as const })),
        ...core.minis.filter((m) => !m.closed).map((m) => m.runtime())
      ]
      return JSON.parse(JSON.stringify({ ...core.store.state, windows, extensions, downloads, adblockStats, update }))
    },
    activePartition(): string {
      const core = current()
      return core ? activePartition(core) : ''
    },
    async dispatch(command: string, payload?: unknown): Promise<unknown> {
      const core = await ready
      const result = await core.commands.run(command, payload, core.first())
      try {
        return JSON.parse(JSON.stringify(result ?? null))
      } catch {
        return null
      }
    },
    waitIdle: async () => (await ready).waitIdle(),
    async capture(filePath: string): Promise<boolean> {
      const core = await ready
      const w = core.first()
      if (!w) return false
      const [width, height] = w.win.getContentSize()
      const shellImg = await grab(w.shell)
      if (!shellImg) return false
      const scale = shellImg.getSize().width / Math.max(1, w.shell.getBounds().width)
      const layers: Layer[] = [{ image: shellImg, bounds: w.shell.getBounds(), radius: 0 }]
      for (const id of w.tabs.visible()) {
        const v = w.tabs.get(id)
        const img = v ? await grab(v) : null
        if (v && img) layers.push({ image: img, bounds: v.getBounds(), radius: TAB_RADIUS })
      }
      if (w.isOverlayAttached()) {
        const img = await grab(w.overlay)
        if (img) layers.push({ image: img, bounds: w.overlay.getBounds(), radius: 0 })
      }
      // round 2a: the preview card's page sits above the overlay
      const pv = w.preview.view
      if (pv && w.preview.isAttached()) {
        const img = await grab(pv)
        if (img) layers.push({ image: img, bounds: pv.getBounds(), radius: PREVIEW_RADIUS })
      }
      const png = composite(width, height, scale, layers).toPNG()
      fs.mkdirSync(path.dirname(filePath), { recursive: true })
      fs.writeFileSync(filePath, png)
      return true
    },
    async captureMini(filePath: string, id?: number): Promise<boolean> {
      const core = await ready
      const m = core.minis.find((x) => !x.closed && (id === undefined || x.id === id))
      if (!m) return false
      const [width, height] = m.win.getContentSize()
      const chrome = await grab(m.win)
      if (!chrome) return false
      const scale = chrome.getSize().width / Math.max(1, width)
      const layers: Layer[] = [{ image: chrome, bounds: { x: 0, y: 0, width, height }, radius: 0 }]
      if (m.page) {
        const img = await grab(m.page)
        if (img) layers.push({ image: img, bounds: m.page.getBounds(), radius: MINI_RADIUS })
      }
      fs.mkdirSync(path.dirname(filePath), { recursive: true })
      fs.writeFileSync(filePath, composite(width, height, scale, layers).toPNG())
      return true
    }
  }
  // round 3c: per-window dispatch and partitions (private windows); round 3: page evaluation in the active tab (focused pane of a split)
  const hook = globalThis.__swyr
  if (!hook) return
  const json = (v: unknown): unknown => {
    try {
      return JSON.parse(JSON.stringify(v ?? null))
    } catch {
      return null
    }
  }
  hook.dispatchIn = async (windowId: number, command: string, payload?: unknown): Promise<unknown> => {
    const core = await ready
    const w = core.windows.find((x) => x.id === windowId && !x.closed)
    if (!w) throw new Error(`no window ${windowId}`)
    return json(await core.commands.run(command, payload, w))
  }
  hook.partitionOf = (windowId: number): string => {
    const w = current()?.windows.find((x) => x.id === windowId && !x.closed)
    return partitionOf(w?.activeContents()?.session)
  }
  hook.setSourceApp = (app) => setSourceAppOverride(app ? { name: app.name ?? '', bundleId: app.bundleId ?? '' } : app)
  hook.probeSourceApp = async () => {
    const t0 = Date.now()
    const app = await probeFrontmost().catch(() => null)
    return { app, ms: Date.now() - t0 }
  }
  hook.shellEvalIn = async (windowId: number, js: string): Promise<unknown> => {
    const core = await ready
    const w = core.windows.find((x) => x.id === windowId && !x.closed)
    if (!w || w.shell.webContents.isDestroyed()) throw new Error(`no window ${windowId}`)
    return json(await w.shell.webContents.executeJavaScript(js, true))
  }
  if (!hook.evalInActiveTab) {
    hook.evalInActiveTab = async (js: string): Promise<unknown> => {
      const core = await ready
      const wc = core.first()?.activeContents()
      if (!wc || wc.isDestroyed()) return null
      // a promise the page keeps pending (Notification.requestPermission while its prompt is on screen) returns
      // null after a few seconds and keeps running in the page, so the check can answer the prompt
      const result = wc.executeJavaScript(js, true)
      let timer: NodeJS.Timeout | undefined
      const pending = new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), Number(process.env.SWYR_EVAL_WAIT_MS) || 5000)))
      result.catch(() => undefined)
      try {
        return json(await Promise.race([result, pending]))
      } finally {
        clearTimeout(timer)
      }
    }
  }
}

/**
 * The packaged app's fuses refuse --inspect, so a test that launches the signed binary cannot reach globalThis.__swyr
 * through the Node inspector. With SWYR_TEST=1 and SWYR_TEST_STDIO=1 the hook also answers on the process's own stdin:
 * one JSON line {"id", "method", "args"} per call, answered on stdout as "SWYR-TEST-REPLY {"id", "value" | "error"}".
 * Only the process that started swyr holds that pipe; renderers and web pages never see it.
 */
export function installTestStdio(): void {
  if (process.env.SWYR_TEST !== '1' || process.env.SWYR_TEST_STDIO !== '1') return
  const reply = (msg: unknown): void => void process.stdout.write('SWYR-TEST-REPLY ' + JSON.stringify(msg) + '\n')
  let buf = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk: string) => {
    buf += chunk
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line) continue
      let req: { id?: unknown; method?: unknown; args?: unknown }
      try {
        req = JSON.parse(line)
      } catch {
        continue
      }
      const id = req.id
      const hook = globalThis.__swyr as unknown as Record<string, unknown> | undefined
      const fn = hook && typeof req.method === 'string' ? hook[req.method] : undefined
      if (typeof fn !== 'function') {
        reply({ id, error: `no test hook method ${String(req.method)}` })
        continue
      }
      const args = Array.isArray(req.args) ? req.args : []
      Promise.resolve()
        .then(() => (fn as (...a: unknown[]) => unknown).apply(hook, args))
        .then(
          (value) => reply({ id, value: value === undefined ? null : value }),
          (err: unknown) => reply({ id, error: err instanceof Error ? err.message : String(err) })
        )
    }
  })
  process.stdin.resume()
}

// The app core: owns the store, the windows and the shared services.
import { nativeTheme, screen, type WebContents } from 'electron'
import type { Rect } from '@shared/types'
import { Store } from '../state/Store'
import { Commands } from '../commands/Commands'
import { registerBuiltins } from '../commands/builtins'
import { Shortcuts } from '../shortcuts/Shortcuts'
import { ContextMenus } from '../menu/ContextMenus'
import { AppMenu } from '../menu/Menu'
import { SwyrWindow, type WindowOptions } from './SwyrWindow'
// round 2a
import { reconcileSplits, registerSplitCommands } from '../commands/split'
import { registerPreviewCommands } from '../commands/preview'
import { registerMiniCommands } from '../commands/mini'
import { registerMediaCommands } from '../media/Media'
import type { MiniWindow } from './MiniWindow'

export class Core {
  readonly store: Store
  readonly commands: Commands
  readonly shortcuts: Shortcuts
  readonly contextMenus: ContextMenus
  readonly menu: AppMenu
  readonly windows: SwyrWindow[] = []
  /** Mini Windows (single tab, own chrome); not part of `windows` */
  readonly minis: MiniWindow[] = []
  lastMini: MiniWindow | null = null
  readonly test = process.env.SWYR_TEST === '1'
  private focused: SwyrWindow | null = null
  private broadcastQueued = false
  private idleWaiters: Array<() => void> = []

  constructor() {
    this.store = new Store()
    this.commands = new Commands(this)
    registerBuiltins(this.commands)
    registerSplitCommands(this.commands)
    registerPreviewCommands(this.commands)
    registerMiniCommands(this.commands, this)
    registerMediaCommands(this.commands)
    this.shortcuts = new Shortcuts(this)
    this.contextMenus = new ContextMenus(this)
    this.menu = new AppMenu(this)
    this.store.onChange(() => {
      reconcileSplits(this)
      this.scheduleBroadcast()
    })
    nativeTheme.on('updated', () => this.scheduleBroadcast())
  }

  systemDark(): boolean {
    return nativeTheme.shouldUseDarkColors
  }

  createWindow(opts: WindowOptions = {}): SwyrWindow {
    // round 3c: the first window reopens where the last one was
    if (!opts.bounds && !this.windows.length) {
      const saved = validBounds(this.store.state.settings.windowBounds)
      if (saved) opts = { ...opts, bounds: saved }
    }
    const w = new SwyrWindow(this, opts)
    this.windows.push(w)
    this.focused = w
    this.scheduleBroadcast()
    return w
  }

  /** round 3c: remember a main window's bounds (debounced by the window; `now` writes at once) */
  saveWindowBounds(w: SwyrWindow, now = false): void {
    if (w.closed || w.incognito || w.win.isFullScreen() || w.win.isMinimized()) return
    const b = w.win.getBounds()
    const prev = this.store.state.settings.windowBounds
    if (prev && prev.x === b.x && prev.y === b.y && prev.width === b.width && prev.height === b.height) return
    this.store.update((s) => (s.settings.windowBounds = { x: b.x, y: b.y, width: b.width, height: b.height }))
    if (now) this.store.flush()
  }

  first(): SwyrWindow | undefined {
    return this.windows.find((w) => !w.closed)
  }

  current(): SwyrWindow | undefined {
    if (this.focused && !this.focused.closed) return this.focused
    return this.first()
  }

  onWindowFocus(w: SwyrWindow): void {
    this.focused = w
    this.menu.refresh()
  }

  onWindowClosed(w: SwyrWindow): void {
    const i = this.windows.indexOf(w)
    if (i >= 0) this.windows.splice(i, 1)
    if (this.focused === w) this.focused = this.first() ?? null
    this.store.flush()
  }

  windowFor(wc: WebContents): { w: SwyrWindow; role: 'shell' | 'overlay' | 'tab' } | undefined {
    for (const w of this.windows) {
      const role = w.ownsContents(wc)
      if (role) return { w, role }
    }
    return undefined
  }

  scheduleBroadcast(): void {
    if (this.broadcastQueued) return
    this.broadcastQueued = true
    setImmediate(() => {
      this.broadcastQueued = false
      for (const w of this.windows) w.sendState()
      for (const m of this.minis) m.sendState()
      this.menu.refresh()
    })
  }

  registerMini(m: MiniWindow): void {
    this.minis.push(m)
    this.lastMini = m
    this.scheduleBroadcast()
  }

  onMiniClosed(m: MiniWindow): void {
    const i = this.minis.indexOf(m)
    if (i >= 0) this.minis.splice(i, 1)
    if (this.lastMini === m) this.lastMini = this.minis[this.minis.length - 1] ?? null
    this.scheduleBroadcast()
  }

  /** tab views of every window for an item (a tab may be loaded in more than one window) */
  destroyItemViews(itemId: string): void {
    for (const w of this.windows) w.tabs.destroy(itemId)
  }

  emitIdle(): void {
    const waiters = this.idleWaiters
    this.idleWaiters = []
    for (const fn of waiters) fn()
  }

  /** resolves once the first window's active tab is not loading */
  async waitIdle(timeoutMs = 30000): Promise<void> {
    const t0 = Date.now()
    while (Date.now() - t0 < timeoutMs) {
      const wc = this.first()?.activeContents()
      if (!wc || !wc.isLoading()) return
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 250)
        this.idleWaiters.push(() => {
          clearTimeout(timer)
          resolve()
        })
      })
    }
  }
}

/** saved bounds that still fit on a connected display (shrunk to it), or null when they would be off screen */
export function validBounds(b: Rect | undefined): Rect | null {
  if (!b || ![b.x, b.y, b.width, b.height].every((v) => typeof v === 'number' && Number.isFinite(v))) return null
  if (b.width < 200 || b.height < 150) return null
  let displays: Electron.Display[]
  try {
    displays = screen.getAllDisplays()
  } catch {
    return null
  }
  for (const d of displays) {
    const a = d.workArea
    const overlapW = Math.min(b.x + b.width, a.x + a.width) - Math.max(b.x, a.x)
    const overlapH = Math.min(b.y + b.height, a.y + a.height) - Math.max(b.y, a.y)
    // enough of the window (including its top edge) must be on this display to grab and move it
    if (overlapW >= 120 && overlapH >= 80 && b.y >= a.y - 10 && b.y < a.y + a.height - 40) {
      const width = Math.max(600, Math.min(b.width, a.width))
      const height = Math.max(400, Math.min(b.height, a.height))
      const x = Math.min(Math.max(b.x, a.x), a.x + a.width - width)
      const y = Math.min(Math.max(b.y, a.y), a.y + a.height - height)
      return { x, y, width, height }
    }
  }
  return null
}

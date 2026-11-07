// The app core: owns the store, the windows and the shared services.
import { nativeTheme, type WebContents } from 'electron'
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
    const w = new SwyrWindow(this, opts)
    this.windows.push(w)
    this.focused = w
    this.scheduleBroadcast()
    return w
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

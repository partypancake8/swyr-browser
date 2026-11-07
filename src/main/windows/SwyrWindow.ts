// One browser window: BaseWindow + shell view + tab views + overlay view.
import { BaseWindow, type WebContents, type WebContentsView } from 'electron'
import type { Item, OverlayInput, OverlayState, Space, ViewState, WindowRuntime } from '@shared/types'
import { baseColor, isDark } from '@shared/theme'
import { itemVisibleInSpace, sidebarOrder, sortedSpaces, spaceById } from '@shared/ops'
import { computeLayout, type OverlayLayout } from '../layout/Layout'
import { createShellView } from '../views/ShellView'
import { createOverlayView } from '../views/OverlayView'
import { TabViews } from '../views/TabViews'
import type { Core } from './WindowManager'

export const TRAFFIC_LIGHTS = { x: 14, y: 14 }

export interface WindowOptions {
  spaceId?: string
  bounds?: { x?: number; y?: number; width: number; height: number }
}

export class SwyrWindow {
  readonly win: BaseWindow
  readonly id: number
  readonly shell: WebContentsView
  readonly overlay: WebContentsView
  readonly tabs: TabViews
  activeSpaceId: string
  activeItemId: string | null = null
  overlayState: OverlayState | null = null
  renamingItemId: string | null = null
  peeking = false
  fullscreen = false
  readonly lastActiveBySpace = new Map<string, string>()
  private overlayAttached = false
  private overlaySeq = 0
  private shown = false
  private toastTimer: NodeJS.Timeout | null = null
  closed = false

  constructor(
    readonly core: Core,
    opts: WindowOptions = {}
  ) {
    const s = core.store.state
    const space = spaceById(s, opts.spaceId) ?? sortedSpaces(s)[0]
    this.activeSpaceId = space.id
    const dark = isDark(space.theme, core.systemDark())
    this.win = new BaseWindow({
      width: opts.bounds?.width ?? 1280,
      height: opts.bounds?.height ?? 820,
      x: opts.bounds?.x,
      y: opts.bounds?.y,
      minWidth: 600,
      minHeight: 400,
      show: false,
      title: 'swyr',
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: TRAFFIC_LIGHTS,
      backgroundColor: baseColor(space, dark)
    })
    this.id = this.win.id
    this.shell = createShellView(baseColor(space, dark))
    this.overlay = createOverlayView()
    this.tabs = new TabViews(this)
    this.win.contentView.addChildView(this.shell)

    for (const wc of [this.shell.webContents, this.overlay.webContents]) {
      wc.on('before-input-event', (e, input) => core.shortcuts.handleInput(e, input, this))
    }
    this.shell.webContents.on('did-finish-load', () => {
      this.sendState()
      if (!core.test && !this.shown) {
        this.shown = true
        this.win.show()
      }
    })
    this.overlay.webContents.on('did-finish-load', () => this.sendState())
    this.win.on('resize', () => this.layout())
    this.win.on('enter-full-screen', () => {
      this.fullscreen = true
      this.layout()
      core.scheduleBroadcast()
    })
    this.win.on('leave-full-screen', () => {
      this.fullscreen = false
      this.layout()
      core.scheduleBroadcast()
    })
    this.win.on('focus', () => core.onWindowFocus(this))
    this.win.on('closed', () => {
      this.closed = true
      try {
        this.tabs.releaseAll()
        for (const v of [this.shell, this.overlay]) if (!v.webContents.isDestroyed()) v.webContents.close()
      } catch (err) {
        console.error('[swyr] window cleanup failed', err)
      }
      core.onWindowClosed(this)
    })

    const initial = this.pickItemForSpace(space)
    if (initial) this.activate(initial.id, { focus: false })
    this.layout()
  }

  space(): Space {
    const s = this.core.store.state
    return spaceById(s, this.activeSpaceId) ?? sortedSpaces(s)[0]
  }

  activeItem(): Item | undefined {
    return this.core.store.state.items.find((i) => i.id === this.activeItemId)
  }

  activeContents(): WebContents | undefined {
    const v = this.tabs.get(this.activeItemId)
    return v && !v.webContents.isDestroyed() ? v.webContents : undefined
  }

  sidebarVisible(): boolean {
    return this.core.store.state.settings.sidebarVisible && !this.fullscreen
  }

  /** the most recently active item of a space, or its first sidebar item */
  pickItemForSpace(space: Space): Item | undefined {
    const s = this.core.store.state
    const remembered = s.items.find((i) => i.id === this.lastActiveBySpace.get(space.id))
    if (remembered && itemVisibleInSpace(remembered, space)) return remembered
    const own = s.items
      .filter((i) => i.spaceId === space.id && i.kind === 'tab')
      .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
    return own[0] ?? sidebarOrder(s, space).find((i) => i.section !== 'favorites')
  }

  activate(itemId: string | null, opts: { focus?: boolean } = {}): void {
    const s = this.core.store.state
    const item = s.items.find((i) => i.id === itemId)
    if (!item || item.kind === 'folder') {
      this.activeItemId = null
    } else {
      if (item.spaceId && item.spaceId !== this.activeSpaceId) this.activeSpaceId = item.spaceId
      this.activeItemId = item.id
      item.lastActiveAt = Date.now()
      this.lastActiveBySpace.set(this.activeSpaceId, item.id)
      this.tabs.ensure(item)
      this.core.store.changed()
    }
    if (this.overlayState?.kind === 'find') this.closeOverlay(false)
    this.layout()
    if (opts.focus !== false && !this.overlayState) this.focusContent()
    this.core.scheduleBroadcast()
  }

  switchSpace(spaceId: string): void {
    const space = spaceById(this.core.store.state, spaceId)
    if (!space) return
    this.activeSpaceId = space.id
    const pick = this.pickItemForSpace(space)
    this.activeItemId = null
    this.win.setBackgroundColor(baseColor(space, isDark(space.theme, this.core.systemDark())))
    this.activate(pick?.id ?? null)
  }

  focusContent(): void {
    const wc = this.activeContents()
    if (wc) wc.focus()
    else if (!this.shell.webContents.isDestroyed()) this.shell.webContents.focus()
  }

  overlayLayout(): OverlayLayout {
    const o = this.overlayState
    if (!o) return 'none'
    if (o.kind === 'find') return 'find'
    if (o.kind === 'sidebar') return 'sidebar'
    if (o.kind === 'toast') return 'toast'
    return 'full'
  }

  layout(): void {
    if (this.closed) return
    const [width, height] = this.win.getContentSize()
    const settings = this.core.store.state.settings
    const visible = this.sidebarVisible()
    const active = this.activeItemId && this.tabs.get(this.activeItemId) ? [this.activeItemId] : []
    const L = computeLayout({
      width,
      height,
      sidebarVisible: visible,
      sidebarWidth: settings.sidebarWidth,
      panes: active.length,
      overlay: this.overlayLayout()
    })
    this.shell.setBounds(L.shell)
    this.tabs.show(active, L.panes)
    const content = this.win.contentView
    if (L.overlay) {
      // adding an existing child moves it to the top of the z-order
      content.addChildView(this.overlay)
      this.overlay.setBounds(L.overlay)
      this.overlayAttached = true
    } else if (this.overlayAttached) {
      content.removeChildView(this.overlay)
      this.overlayAttached = false
    }
    this.win.setWindowButtonVisibility(visible || this.overlayState?.kind === 'sidebar' || this.fullscreen)
  }

  isOverlayAttached(): boolean {
    return this.overlayAttached
  }

  openOverlay(state: OverlayInput, focus = true): void {
    if (this.toastTimer && state.kind !== 'toast') {
      clearTimeout(this.toastTimer)
      this.toastTimer = null
    }
    this.overlayState = { ...state, seq: ++this.overlaySeq } as OverlayState
    this.layout()
    if (focus) this.overlay.webContents.focus()
    this.core.scheduleBroadcast()
  }

  closeOverlay(refocus = true): void {
    if (!this.overlayState) return
    if (this.overlayState.kind === 'find') this.activeContents()?.stopFindInPage('clearSelection')
    this.overlayState = null
    this.layout()
    if (refocus) this.focusContent()
    this.core.scheduleBroadcast()
  }

  toast(message: string): void {
    if (this.overlayState && this.overlayState.kind !== 'toast') return
    this.openOverlay({ kind: 'toast', message }, false)
    if (this.toastTimer) clearTimeout(this.toastTimer)
    this.toastTimer = setTimeout(() => {
      this.toastTimer = null
      if (this.overlayState?.kind === 'toast') this.closeOverlay(false)
    }, 1600)
  }

  onFindResult(itemId: string, active: number, matches: number): void {
    const o = this.overlayState
    if (itemId !== this.activeItemId || o?.kind !== 'find') return
    o.active = active
    o.matches = matches
    this.core.scheduleBroadcast()
  }

  runtime(): WindowRuntime {
    const b = this.win.getBounds()
    return {
      id: this.id,
      activeSpaceId: this.activeSpaceId,
      activeItemId: this.activeItemId,
      sidebarVisible: this.sidebarVisible(),
      bounds: { x: b.x, y: b.y, width: b.width, height: b.height },
      loaded: [...this.tabs.mru],
      tabs: Object.fromEntries(this.tabs.runtime),
      overlay: this.overlayState,
      renamingItemId: this.renamingItemId,
      fullscreen: this.fullscreen
    }
  }

  viewState(): ViewState {
    return { state: this.core.store.state, window: this.runtime(), systemDark: this.core.systemDark() }
  }

  sendState(): void {
    if (this.closed) return
    const vs = this.viewState()
    for (const wc of [this.shell.webContents, this.overlay.webContents]) {
      if (!wc.isDestroyed()) wc.send('swyr:state', vs)
    }
    for (const [, v] of this.tabs.views) {
      const wc = v.webContents
      if (!wc.isDestroyed() && wc.getURL().startsWith('swyr:')) wc.send('swyr:state', vs)
    }
  }

  sendEvent(event: unknown): void {
    if (!this.shell.webContents.isDestroyed()) this.shell.webContents.send('swyr:event', event)
  }

  ownsContents(wc: WebContents): 'shell' | 'overlay' | 'tab' | null {
    if (wc === this.shell.webContents) return 'shell'
    if (wc === this.overlay.webContents) return 'overlay'
    return this.tabs.idOf(wc) ? 'tab' : null
  }
}

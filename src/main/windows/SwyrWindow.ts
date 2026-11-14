// One browser window: BaseWindow + shell view + tab views + overlay view.
import { BaseWindow, type WebContents, type WebContentsView } from 'electron'
import { secretsView } from '../secrets/Secrets'
import type { Item, OverlayInput, OverlayState, Rect, Space, ViewState, WindowRuntime } from '@shared/types'
import { baseColor, isDark } from '@shared/theme'
import { blankItems, itemVisibleInSpace, sidebarOrder, sortedSpaces, spaceById, regularSpaces } from '@shared/ops'
import { computeLayout, type OverlayLayout } from '../layout/Layout'
import { createShellView } from '../views/ShellView'
import { createOverlayView } from '../views/OverlayView'
import { TabViews } from '../views/TabViews'
import type { Core } from './WindowManager'
import { PreviewController } from '../views/PreviewView'
import { MediaTracker } from '../media/Media'
import { focusedPaneId, isSplit, resolveActivation, visiblePanes } from '../commands/split'
import { forgetWindow as forgetPermissionPrompts, onOverlayClosed as onPermissionOverlayClosed } from '../sitesettings/PermissionPrompts'

export const TRAFFIC_LIGHTS = { x: 14, y: 14 }

export interface WindowOptions {
  spaceId?: string
  /** round 5: a blank window (no spaces, neutral theme, its own Today list) */
  blank?: boolean
  bounds?: { x?: number; y?: number; width: number; height: number }
}

export class SwyrWindow {
  readonly win: BaseWindow
  readonly id: number
  readonly shell: WebContentsView
  readonly overlay: WebContentsView
  readonly tabs: TabViews
  // round 2a
  readonly preview: PreviewController
  readonly media: MediaTracker
  private paneRects: WindowRuntime['paneRects'] = []
  private dividers: WindowRuntime['dividers'] = []
  private previewBounds: WindowRuntime['previewBounds'] = null
  activeSpaceId: string
  activeItemId: string | null = null
  overlayState: OverlayState | null = null
  renamingItemId: string | null = null
  peeking = false
  fullscreen = false
  readonly lastActiveBySpace = new Map<string, string>()
  private overlayAttached = false
  /** whether the overlay was attached when it was last sent the state */
  private overlaySynced = false
  private overlaySeq = 0
  private shown = false
  private toastTimer: NodeJS.Timeout | null = null
  closed = false
  // round 3c
  /** a private window (its space belongs to an in-memory incognito profile) */
  readonly incognito: boolean
  // round 5
  readonly blank: boolean
  private boundsTimer: NodeJS.Timeout | null = null

  constructor(
    readonly core: Core,
    opts: WindowOptions = {}
  ) {
    const s = core.store.state
    const space = spaceById(s, opts.spaceId) ?? regularSpaces(s)[0] ?? sortedSpaces(s)[0]
    this.activeSpaceId = space.id
    this.incognito = space.incognito === true
    this.blank = opts.blank === true && !this.incognito
    const dark = this.blank ? core.systemDark() : isDark(space.theme, core.systemDark())
    const bg = this.blank ? baseColor(undefined, dark) : baseColor(space, dark)
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
      backgroundColor: bg
    })
    this.id = this.win.id
    this.shell = createShellView(bg)
    this.overlay = createOverlayView()
    this.media = new MediaTracker(this)
    this.preview = new PreviewController(this)
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
    this.win.on('resize', () => {
      this.layout()
      this.queueSaveBounds()
    })
    this.win.on('move', () => this.queueSaveBounds())
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
    // mouse back/forward buttons on Windows and Linux arrive as app commands
    this.win.on('app-command', (_e, cmd) => {
      if (cmd === 'browser-backward') void core.commands.run('tab.back', {}, this)
      if (cmd === 'browser-forward') void core.commands.run('tab.forward', {}, this)
    })
    this.win.on('closed', () => {
      this.closed = true
      forgetPermissionPrompts(this)
      if (this.boundsTimer) clearTimeout(this.boundsTimer)
      try {
        this.preview.dispose()
        this.tabs.releaseAll()
        for (const v of [this.shell, this.overlay]) if (!v.webContents.isDestroyed()) v.webContents.close()
      } catch (err) {
        console.error('[swyr] window cleanup failed', err)
      }
      // round 5: a blank window's Today tabs go with it; spaces and other windows stay as they were
      if (this.blank && core.store.state.items.some((i) => i.blankWindow === this.id)) {
        core.store.update((st) => (st.items = st.items.filter((i) => i.blankWindow !== this.id)))
      }
      core.onWindowClosed(this)
    })

    const initial = this.blank ? undefined : this.pickItemForSpace(space)
    if (initial) this.activate(initial.id, { focus: false })
    this.layout()
  }

  /** round 3c: persist bounds shortly after the last move or resize */
  private queueSaveBounds(): void {
    if (this.incognito || this.blank) return
    if (this.boundsTimer) clearTimeout(this.boundsTimer)
    this.boundsTimer = setTimeout(() => {
      this.boundsTimer = null
      this.core.saveWindowBounds(this)
    }, 400)
  }

  space(): Space {
    const s = this.core.store.state
    return spaceById(s, this.activeSpaceId) ?? regularSpaces(s)[0] ?? sortedSpaces(s)[0]
  }

  activeItem(): Item | undefined {
    return this.core.store.state.items.find((i) => i.id === this.activeItemId)
  }

  /** the item whose page has focus: the focused pane when a split is active */
  focusedItemId(): string | null {
    return focusedPaneId(this.core.store.state, this.activeItem()) ?? this.activeItemId
  }

  activeContents(): WebContents | undefined {
    const v = this.tabs.get(this.focusedItemId())
    return v && !v.webContents.isDestroyed() ? v.webContents : undefined
  }

  sidebarVisible(): boolean {
    return this.core.store.state.settings.sidebarVisible && !this.fullscreen
  }

  /** the most recently active item of a space, or its first sidebar item */
  pickItemForSpace(space: Space): Item | undefined {
    const s = this.core.store.state
    if (this.blank) return blankItems(s, this.id).sort((a, b) => b.lastActiveAt - a.lastActiveAt)[0]
    const remembered = s.items.find((i) => i.id === this.lastActiveBySpace.get(space.id))
    if (remembered && itemVisibleInSpace(remembered, space)) return remembered
    const own = s.items
      .filter((i) => i.spaceId === space.id && i.kind === 'tab')
      .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
    return own[0] ?? sidebarOrder(s, space).find((i) => i.section !== 'favorites')
  }

  activate(itemId: string | null, opts: { focus?: boolean } = {}): void {
    const s = this.core.store.state
    const found = s.items.find((i) => i.id === itemId)
    // a pane activates its split, focused on that pane
    const resolved = found ? resolveActivation(this.core, found) : undefined
    const item = resolved?.item
    if (!item || item.kind === 'folder') {
      this.activeItemId = null
    } else {
      if (item.spaceId && item.spaceId !== this.activeSpaceId) this.activeSpaceId = item.spaceId
      this.activeItemId = item.id
      const now = Date.now()
      item.lastActiveAt = now
      this.lastActiveBySpace.set(this.activeSpaceId, item.id)
      if (isSplit(item)) {
        if (resolved?.focus !== undefined && resolved.focus >= 0) item.panes.focused = resolved.focus
        for (const id of item.panes.itemIds) {
          const pane = s.items.find((i) => i.id === id)
          if (!pane) continue
          pane.lastActiveAt = now
          this.tabs.ensure(pane)
        }
      } else {
        this.tabs.ensure(item)
      }
      this.core.store.changed()
    }
    if (this.overlayState?.kind === 'find') this.closeOverlay(false)
    this.layout()
    if (opts.focus !== false && !this.overlayState) this.focusContent()
    this.core.scheduleBroadcast()
  }

  /** round 5: the activatable items of this window in sidebar order (a blank window has only its own Today tabs) */
  order(): Item[] {
    const s = this.core.store.state
    return this.blank ? blankItems(s, this.id) : sidebarOrder(s, this.space())
  }

  switchSpace(spaceId: string): void {
    if (this.blank) return // a blank window has no spaces to switch between
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
    if (o.kind === 'find') return o.replace ? 'findReplace' : 'find'
    if (o.kind === 'sidebar') return 'sidebar'
    if (o.kind === 'toast') return 'toast'
    if (o.kind === 'preview') return this.preview.isOpen() ? 'preview' : 'full'
    if (o.kind === 'splitDrop') return 'content'
    return 'full'
  }

  layout(): void {
    if (this.closed) return
    const [width, height] = this.win.getContentSize()
    const settings = this.core.store.state.settings
    const visible = this.sidebarVisible()
    const { ids: active, split } = visiblePanes(this)
    const L = computeLayout({
      width,
      height,
      sidebarVisible: visible,
      sidebarWidth: settings.sidebarWidth,
      panes: active.length,
      split,
      overlay: this.overlayLayout()
    })
    this.shell.setBounds(L.shell)
    this.tabs.show(active, L.panes)
    this.paneRects = L.panes
    this.dividers = L.dividers.map((d) => ({ ...d, layout: split?.layout ?? 'horizontal' }))
    this.previewBounds = L.preview
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
    if (L.preview && this.preview.isOpen()) this.preview.attach(L.preview.page)
    else this.preview.detach()
    this.win.setWindowButtonVisibility(visible || this.overlayState?.kind === 'sidebar' || this.fullscreen)
  }

  /** the content area (the region drop zones cover), window coordinates */
  contentRect(): Rect {
    const [width, height] = this.win.getContentSize()
    const settings = this.core.store.state.settings
    const L = computeLayout({ width, height, sidebarVisible: this.sidebarVisible(), sidebarWidth: settings.sidebarWidth, panes: 1, overlay: 'content' })
    return L.overlay ?? { x: 0, y: 0, width, height }
  }

  isOverlayAttached(): boolean {
    return this.overlayAttached
  }

  openOverlay(state: OverlayInput, focus = true): void {
    if (this.toastTimer && state.kind !== 'toast') {
      clearTimeout(this.toastTimer)
      this.toastTimer = null
    }
    // another overlay replaces an open preview
    if (state.kind !== 'preview' && state.kind !== 'toast' && this.preview.isOpen()) this.preview.dispose()
    this.overlayState = { ...state, seq: ++this.overlaySeq } as OverlayState
    this.layout()
    if (focus) this.overlay.webContents.focus()
    this.core.scheduleBroadcast()
  }

  closeOverlay(refocus = true): void {
    if (!this.overlayState) return
    if (this.overlayState.kind === 'find') this.activeContents()?.stopFindInPage('clearSelection')
    if (this.overlayState.kind === 'preview') this.preview.dispose()
    const closed = this.overlayState
    this.overlayState = null
    this.layout()
    if (refocus) this.focusContent()
    this.core.scheduleBroadcast()
    // a dismissed permission prompt denies once; one hidden behind another overlay comes back
    onPermissionOverlayClosed(this, closed.kind === 'permission' ? { kind: closed.kind, promptId: closed.promptId } : { kind: closed.kind })
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
    if (itemId !== this.focusedItemId() || o?.kind !== 'find') return
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
      fullscreen: this.fullscreen,
      // round 2a
      kind: 'main',
      focusedPane: this.focusedPane(),
      paneRects: this.paneRects,
      dividers: this.dividers,
      preview: this.preview.isOpen() && this.preview.state ? { ...this.preview.state } : null,
      previewBounds: this.preview.isOpen() ? this.previewBounds : null,
      media: this.media.runtime(),
      // round 3c
      incognito: this.incognito,
      // round 5
      blank: this.blank
    }
  }

  /** 0-based focused pane of the active split */
  focusedPane(): number {
    const item = this.activeItem()
    if (!isSplit(item)) return 0
    return Math.max(0, Math.min(item.panes.itemIds.length - 1, item.panes.focused ?? 0))
  }

  /** a tab page got keyboard focus: if it is a pane of the active split, focus that pane */
  onTabFocus(itemId: string): void {
    const item = this.activeItem()
    if (!isSplit(item)) return
    const idx = item.panes.itemIds.indexOf(itemId)
    if (idx < 0 || idx === (item.panes.focused ?? 0)) return
    this.core.store.update(() => (item.panes.focused = idx))
  }

  viewState(): ViewState {
    return { state: this.core.store.state, window: this.runtime(), systemDark: this.core.systemDark(), secrets: secretsView() }
  }

  sendState(): void {
    if (this.closed) return
    const vs = this.viewState()
    // every send is a structured clone of the whole state, and the archive (up to 2000 entries) is most of it in a
    // long-used profile: the sidebar never shows the archive, so it gets the state without it
    const shell = this.shell.webContents
    if (!shell.isDestroyed()) shell.send('swyr:state', { ...vs, state: { ...vs.state, archive: [] } })
    // the overlay is off screen unless it is attached: it gets the state while attached, plus one last time after it
    // detaches so it never shows a stale overlay when it is attached again (it reads the state itself when it loads)
    const overlay = this.overlay.webContents
    if (!overlay.isDestroyed() && (this.overlayAttached || this.overlaySynced)) overlay.send('swyr:state', vs)
    this.overlaySynced = this.overlayAttached
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
    if (this.preview.view && wc === this.preview.view.webContents) return null
    return this.tabs.idOf(wc) ? 'tab' : null
  }
}

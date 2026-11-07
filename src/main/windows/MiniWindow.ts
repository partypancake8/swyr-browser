// Mini Window: a small single-tab window with its own compact chrome, for quick links.
import { BrowserWindow, WebContentsView, type Input, type Event as ElectronEvent } from 'electron'
import type { MiniViewState, MiniWindowRuntime, Profile } from '@shared/types'
import { resolveBindings } from '@shared/commands'
import { baseColor, isDark } from '@shared/theme'
import { sortedSpaces, spaceById, regularSpaces } from '@shared/ops'
import { preloadPath, rendererUrl } from '../views/ShellView'
import { profileSession } from '../profiles/Profiles'
import { isInternalUrl } from '../protocol/Protocol'
import { parseAccelerator } from '../shortcuts/Shortcuts'
import { newId } from '../util/id'
import type { Core } from './WindowManager'

export const MINI_SIZE = { width: 560, height: 720 }
export const MINI_CHROME = 38
export const MINI_INSET = 6
export const MINI_RADIUS = 8

type Listener = (...a: never[]) => void
type Emitter = { on(ev: string, fn: Listener): unknown; off(ev: string, fn: Listener): unknown }

export class MiniWindow {
  readonly win: BrowserWindow
  readonly id: number
  /** a runtime id for the single tab (not an item until it moves to the main window) */
  readonly tabId = newId('mini')
  page: WebContentsView | null
  closed = false
  private unwire: Array<() => void> = []
  private title = ''
  private favicon: string | null = null

  constructor(
    readonly core: Core,
    url: string,
    readonly profile: Profile
  ) {
    const s = core.store.state
    const space = spaceById(s, core.current()?.activeSpaceId) ?? regularSpaces(s)[0] ?? sortedSpaces(s)[0]
    const dark = isDark(space.theme, core.systemDark())
    const last = core.lastMini && !core.lastMini.closed ? core.lastMini.win.getBounds() : null
    this.win = new BrowserWindow({
      width: MINI_SIZE.width,
      height: MINI_SIZE.height,
      x: last ? last.x + 24 : undefined,
      y: last ? last.y + 24 : undefined,
      minWidth: 360,
      minHeight: 320,
      show: false,
      title: 'swyr',
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 12, y: 12 },
      backgroundColor: baseColor(space, dark),
      webPreferences: {
        preload: preloadPath('mini'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false
      }
    })
    this.id = this.win.id
    const view = new WebContentsView({
      webPreferences: {
        session: profileSession(profile),
        preload: preloadPath('page'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        scrollBounce: true
      }
    })
    view.setBackgroundColor('#ffffff')
    view.setBorderRadius(MINI_RADIUS)
    this.page = view
    this.win.contentView.addChildView(view)
    this.wirePage(view)

    const chrome = this.win.webContents
    chrome.on('before-input-event', (e, input) => this.handleInput(e, input))
    chrome.on('did-finish-load', () => {
      this.sendState()
      if (!core.test) this.win.show()
    })
    this.win.on('resize', () => this.layout())
    this.win.on('focus', () => (core.lastMini = this))
    this.win.on('closed', () => {
      this.closed = true
      this.releasePage(true)
      core.onMiniClosed(this)
    })
    void this.win.loadURL(rendererUrl('mini'))
    this.layout()
    void view.webContents.loadURL(url || 'about:blank').catch(() => undefined)
  }

  private wirePage(view: WebContentsView): void {
    const wc = view.webContents
    const on = (ev: string, fn: Listener): void => {
      ;(wc as unknown as Emitter).on(ev, fn)
      this.unwire.push(() => (wc as unknown as Emitter).off(ev, fn))
    }
    const changed = (): void => this.core.scheduleBroadcast()
    on('did-start-loading', changed)
    on('did-stop-loading', changed)
    on('did-navigate', changed)
    on('did-navigate-in-page', changed)
    on('page-title-updated', ((_e: unknown, title: string) => {
      this.title = title
      changed()
    }) as Listener)
    on('page-favicon-updated', ((_e: unknown, icons: string[]) => {
      this.favicon = icons.find((f) => /^(https?|data):/.test(f)) ?? null
      changed()
    }) as Listener)
    on('will-navigate', ((e: Electron.Event<Electron.WebContentsWillNavigateEventParams>) => {
      if (isInternalUrl(e.url)) e.preventDefault()
    }) as Listener)
    on('before-input-event', ((e: ElectronEvent, input: Input) => this.handleInput(e, input)) as Listener)
    // a mini window holds one page: links that ask for a new window load in place
    wc.setWindowOpenHandler(({ url }) => {
      if (!isInternalUrl(url)) void wc.loadURL(url).catch(() => undefined)
      return { action: 'deny' }
    })
  }

  /** mini-scope shortcuts (Cmd+O open in main window, Cmd+W close, Cmd+L address, ...) */
  private handleInput(e: ElectronEvent, input: Input): void {
    if (input.type !== 'keyDown') return
    for (const b of resolveBindings(this.core.store.state.settings.shortcuts)) {
      if (b.scope !== 'mini' && b.command !== 'mini.new') continue
      const m = parseAccelerator(b.accelerator, b)
      if (m.code === input.code && m.meta === input.meta && m.ctrl === input.control && m.alt === input.alt && m.shift === input.shift) {
        e.preventDefault()
        const payload = { ...((b.payload as Record<string, unknown> | undefined) ?? {}), miniId: this.id }
        void this.core.commands.run(b.command, payload, this.core.current()).catch((err) => console.error('[swyr]', err))
        return
      }
    }
  }

  layout(): void {
    if (this.closed || !this.page) return
    const [width, height] = this.win.getContentSize()
    this.page.setBounds({
      x: MINI_INSET,
      y: MINI_CHROME,
      width: Math.max(0, width - MINI_INSET * 2),
      height: Math.max(0, height - MINI_CHROME - MINI_INSET)
    })
  }

  contents(): Electron.WebContents | null {
    const wc = this.page?.webContents
    return wc && !wc.isDestroyed() ? wc : null
  }

  url(): string {
    return this.contents()?.getURL() || ''
  }

  pageTitle(): string {
    return this.title || this.contents()?.getTitle() || ''
  }

  pageFavicon(): string | null {
    return this.favicon
  }

  runtime(): MiniWindowRuntime {
    const b = this.win.isDestroyed() ? { x: 0, y: 0, width: 0, height: 0 } : this.win.getBounds()
    return { id: this.id, kind: 'mini', activeItemId: this.tabId, url: this.url(), bounds: { x: b.x, y: b.y, width: b.width, height: b.height } }
  }

  viewState(): MiniViewState {
    const wc = this.contents()
    const s = this.core.store.state
    const main = this.core.current()
    return {
      mini: {
        ...this.runtime(),
        title: this.pageTitle(),
        favicon: this.favicon,
        loading: Boolean(wc?.isLoading()),
        canGoBack: Boolean(wc?.navigationHistory.canGoBack()),
        canGoForward: Boolean(wc?.navigationHistory.canGoForward())
      },
      spaces: regularSpaces(s),
      activeSpaceId: main?.activeSpaceId ?? null,
      systemDark: this.core.systemDark()
    }
  }

  sendState(): void {
    if (this.closed || this.win.isDestroyed()) return
    const wc = this.win.webContents
    if (!wc.isDestroyed()) wc.send('swyr:mini:state', this.viewState())
  }

  /** hand the page view to the main window: listeners come off, the view leaves this window */
  detachPage(): WebContentsView | null {
    const v = this.page
    if (!v) return null
    for (const fn of this.unwire.splice(0)) fn()
    if (!this.win.isDestroyed()) this.win.contentView.removeChildView(v)
    this.page = null
    return v
  }

  private releasePage(destroy: boolean): void {
    for (const fn of this.unwire.splice(0)) fn()
    const v = this.page
    this.page = null
    if (destroy && v && !v.webContents.isDestroyed()) v.webContents.close()
  }

  close(): void {
    if (!this.closed && !this.win.isDestroyed()) this.win.close()
  }
}

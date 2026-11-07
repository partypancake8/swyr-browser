// Preview: a floating page card over the content area, opened from links in pinned tabs and favorites.
import { WebContentsView } from 'electron'
import type { PreviewRuntime, Rect } from '@shared/types'
import { preloadPath } from './ShellView'
import { profileSession } from '../profiles/Profiles'
import { isInternalUrl } from '../protocol/Protocol'
import { PREVIEW_RADIUS } from '../layout/Layout'
import type { SwyrWindow } from '../windows/SwyrWindow'

type Listener = (...a: never[]) => void
type Emitter = { on(ev: string, fn: Listener): unknown; off(ev: string, fn: Listener): unknown }

export class PreviewController {
  view: WebContentsView | null = null
  state: PreviewRuntime | null = null
  profileId: string | null = null
  private unwire: Array<() => void> = []
  private attached = false

  constructor(private readonly w: SwyrWindow) {}

  isOpen(): boolean {
    return Boolean(this.state && this.view)
  }

  isAttached(): boolean {
    return this.attached
  }

  show(url: string, fromItemId: string | null): void {
    const core = this.w.core
    const s = core.store.state
    const from = fromItemId ? s.items.find((i) => i.id === fromItemId) : undefined
    const profileId = from?.profileId ?? this.w.space().profileId
    if (this.view && this.profileId !== profileId) this.dispose()
    if (!this.view) this.create(profileId)
    this.state = { url, title: '', fromItemId: from?.id ?? null }
    void this.view!.webContents.loadURL(url).catch(() => undefined)
  }

  private create(profileId: string): void {
    const core = this.w.core
    const profile = core.store.state.profiles.find((p) => p.id === profileId) ?? core.store.state.profiles[0]
    this.profileId = profile.id
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
    view.setBorderRadius(PREVIEW_RADIUS)
    this.view = view
    const wc = view.webContents
    const on = (ev: string, fn: Listener): void => {
      ;(wc as unknown as Emitter).on(ev, fn)
      this.unwire.push(() => (wc as unknown as Emitter).off(ev, fn))
    }
    const set = (patch: Partial<PreviewRuntime>): void => {
      if (!this.state) return
      Object.assign(this.state, patch)
      core.scheduleBroadcast()
    }
    on('page-title-updated', ((_e: unknown, title: string) => set({ title })) as Listener)
    on('did-navigate', ((_e: unknown, u: string) => set({ url: u })) as Listener)
    on('did-navigate-in-page', ((_e: unknown, u: string, main: boolean) => main && set({ url: u })) as Listener)
    on('will-navigate', ((e: Electron.Event<Electron.WebContentsWillNavigateEventParams>) => {
      if (isInternalUrl(e.url)) e.preventDefault()
    }) as Listener)
    on('before-input-event', ((e: Electron.Event, input: Electron.Input) => {
      if (input.type === 'keyDown' && input.key === 'Escape' && !input.meta && !input.control && !input.alt) {
        e.preventDefault()
        void core.commands.run('preview.close', {}, this.w)
        return
      }
      core.shortcuts.handleInput(e, input, this.w)
    }) as Listener)
    // links that open new windows stay inside the preview
    wc.setWindowOpenHandler(({ url }) => {
      if (!isInternalUrl(url)) void wc.loadURL(url).catch(() => undefined)
      return { action: 'deny' }
    })
  }

  attach(rect: Rect): void {
    if (!this.view) return
    // adding an existing child moves it to the top of the z-order
    this.w.win.contentView.addChildView(this.view)
    this.view.setBounds(rect)
    this.attached = true
  }

  detach(): void {
    if (this.view && this.attached && !this.w.win.isDestroyed()) this.w.win.contentView.removeChildView(this.view)
    this.attached = false
  }

  /** hand the live page over (Open as tab); the caller owns the view afterwards */
  take(): { view: WebContentsView; profileId: string | null; state: PreviewRuntime } | null {
    if (!this.view || !this.state) return null
    this.detach()
    for (const fn of this.unwire.splice(0)) fn()
    const out = { view: this.view, profileId: this.profileId, state: this.state }
    this.view = null
    this.state = null
    this.profileId = null
    return out
  }

  dispose(): void {
    this.detach()
    for (const fn of this.unwire.splice(0)) fn()
    const v = this.view
    this.view = null
    this.state = null
    this.profileId = null
    if (v && !v.webContents.isDestroyed()) v.webContents.close()
  }
}

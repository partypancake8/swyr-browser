// One lazily created WebContentsView per loaded tab, with a warm cache of the 8 most recent.
import { WebContentsView, type WebContents } from 'electron'
import type { Item, Rect, TabRuntime } from '@shared/types'
import { preloadPath } from './ShellView'
import { profileSession } from '../profiles/Profiles'
import { isInternalUrl } from '../protocol/Protocol'
import { extensionsService } from '../extensions/Extensions'
import type { SwyrWindow } from '../windows/SwyrWindow'
import { leavesSite, previewSource } from '../commands/preview'

export const WARM_CACHE = 8
export const TAB_RADIUS = 10

export class TabViews {
  readonly views = new Map<string, WebContentsView>()
  readonly runtime = new Map<string, TabRuntime>()
  /** loaded ids, most recent first */
  mru: string[] = []
  private attached: string[] = []
  /** the tab last reported to the extensions host as selected (the focused pane of a split) */
  private selected: string | null = null

  constructor(private readonly w: SwyrWindow) {}

  get(id: string | null | undefined): WebContentsView | undefined {
    return id ? this.views.get(id) : undefined
  }

  idOf(wc: WebContents): string | undefined {
    for (const [id, v] of this.views) if (v.webContents === wc) return id
    return undefined
  }

  /** visible tab ids in z-order */
  visible(): string[] {
    return [...this.attached]
  }

  ensure(item: Item): WebContentsView {
    const existing = this.views.get(item.id)
    if (existing) {
      this.touch(item.id)
      return existing
    }
    const core = this.w.core
    const profile = core.store.state.profiles.find((p) => p.id === item.profileId) ?? core.store.state.profiles[0]
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
    view.setBorderRadius(TAB_RADIUS)
    this.views.set(item.id, view)
    this.runtime.set(item.id, { loading: true, canGoBack: false, canGoForward: false, zoom: 0 })
    this.wire(item.id, view)
    extensionsService()?.tabAdded(view.webContents, this.w.win) // round 2c
    void view.webContents.loadURL(item.url || 'swyr://newtab').catch(() => undefined)
    this.touch(item.id)
    return view
  }

  /**
   * take over a live view (from Preview or a Mini Window) as the view of `item`;
   * the previous owner must have removed its listeners already
   */
  adopt(item: Item, view: WebContentsView): WebContentsView {
    const existing = this.views.get(item.id)
    if (existing) return existing
    view.setBorderRadius(TAB_RADIUS)
    this.views.set(item.id, view)
    const wc = view.webContents
    this.runtime.set(item.id, {
      loading: wc.isLoading(),
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
      zoom: wc.getZoomLevel()
    })
    this.wire(item.id, view)
    this.touch(item.id)
    return view
  }

  /** ids that must stay loaded besides the attached ones (panes being shown, playing media) */
  private protectedIds(): Set<string> {
    const out = new Set<string>()
    const s = this.w.core.store.state
    const active = s.items.find((i) => i.id === this.w.activeItemId)
    if (active?.panes) for (const id of active.panes.itemIds) out.add(id)
    for (const id of this.views.keys()) if (this.w.media.protects(id)) out.add(id)
    return out
  }

  private touch(id: string): void {
    this.mru = [id, ...this.mru.filter((x) => x !== id)]
    const keep = this.protectedIds()
    keep.add(id)
    while (this.mru.length > WARM_CACHE) {
      const victim = [...this.mru].reverse().find((x) => !this.attached.includes(x) && !keep.has(x))
      if (!victim) break
      this.destroy(victim)
    }
  }

  private wire(id: string, view: WebContentsView): void {
    const wc = view.webContents
    const core = this.w.core
    const item = (): Item | undefined => core.store.state.items.find((i) => i.id === id)
    const rt = (): TabRuntime | undefined => this.runtime.get(id)
    const syncNav = (): void => {
      const r = rt()
      if (!r || wc.isDestroyed()) return
      r.canGoBack = wc.navigationHistory.canGoBack()
      r.canGoForward = wc.navigationHistory.canGoForward()
      r.loading = wc.isLoading()
      core.scheduleBroadcast()
    }
    const setUrl = (url: string): void => {
      const it = item()
      if (it && it.url !== url) {
        it.url = url
        core.store.changed()
      }
      syncNav()
    }
    wc.on('did-start-loading', syncNav)
    wc.on('did-stop-loading', () => {
      syncNav()
      core.emitIdle()
    })
    wc.on('did-navigate', (_e, url) => setUrl(url))
    wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
      if (isMainFrame) setUrl(url)
    })
    wc.on('page-title-updated', (_e, title) => {
      const it = item()
      if (it && title && it.title !== title) {
        it.title = title
        core.store.changed()
      }
    })
    wc.on('page-favicon-updated', (_e, favicons) => {
      const it = item()
      const icon = favicons.find((f) => /^(https?|data):/.test(f)) ?? null
      if (it && icon && it.favicon !== icon) {
        it.favicon = icon
        core.store.changed()
      }
    })
    wc.on('will-navigate', (e) => {
      // web pages may not navigate a tab into the privileged swyr:// pages
      if (isInternalUrl(e.url) && !isInternalUrl(wc.getURL())) e.preventDefault()
      // pinned tabs and favorites keep their site: links that leave it open in Preview
      else if (e.isMainFrame && previewSource(item()) && leavesSite(wc.getURL(), e.url)) {
        e.preventDefault()
        void core.commands.run('preview.open', { url: e.url, fromItemId: id }, this.w)
      }
    })
    wc.setWindowOpenHandler(({ url, disposition }) => {
      if (isInternalUrl(url) && !isInternalUrl(wc.getURL())) return { action: 'deny' }
      if (disposition !== 'background-tab' && /^https?:/i.test(url) && previewSource(item())) {
        void core.commands.run('preview.open', { url, fromItemId: id }, this.w)
        return { action: 'deny' }
      }
      void core.commands.run('tab.new', { url, background: disposition === 'background-tab' }, this.w)
      return { action: 'deny' }
    })
    this.w.media.wire(id, wc)
    // clicking into a pane of the active split focuses that pane
    wc.on('focus', () => this.w.onTabFocus(id))
    wc.on('before-input-event', (e, input) => core.shortcuts.handleInput(e, input, this.w))
    wc.on('context-menu', (_e, params) => core.contextMenus.page(this.w, id, params))
    wc.on('found-in-page', (_e, result) => this.w.onFindResult(id, result.activeMatchOrdinal, result.matches))
    wc.on('zoom-changed', () => {
      const r = rt()
      if (r) r.zoom = wc.getZoomLevel()
    })
    wc.on('render-process-gone', () => {
      const r = rt()
      if (r) r.loading = false
      core.scheduleBroadcast()
    })
    wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
      if (!isMainFrame || code === -3) return
      void wc.executeJavaScript(
        `document.documentElement.innerHTML = ${JSON.stringify(failPage(url, desc))}`
      ).catch(() => undefined)
    })
  }

  /** attach the given ids at the given rects, detach every other tab view */
  show(ids: string[], rects: Rect[]): void {
    const content = this.w.win.contentView
    const hidden: string[] = []
    for (const id of this.attached) {
      if (!ids.includes(id)) {
        const v = this.views.get(id)
        if (v) content.removeChildView(v)
        hidden.push(id)
      }
    }
    const shown = ids.filter((id) => !this.attached.includes(id) && this.views.has(id))
    const next: string[] = []
    ids.forEach((id, i) => {
      const v = this.views.get(id)
      if (!v) return
      if (!this.attached.includes(id)) content.addChildView(v)
      v.setBounds(rects[i])
      next.push(id)
    })
    this.attached = next
    // round 2c: tell the extensions host which tab has focus (the focused pane when a split is shown)
    const focused = this.w.focusedItemId()
    const selected = focused && next.includes(focused) ? focused : (next[0] ?? null)
    if (selected && selected !== this.selected) {
      this.selected = selected
      const v = this.views.get(selected)
      if (v) extensionsService()?.tabSelected(v.webContents)
    }
    if (hidden.length || shown.length) this.w.media.onVisibility(hidden, shown)
  }

  destroy(id: string): void {
    const v = this.views.get(id)
    if (!v) return
    if (this.attached.includes(id)) {
      if (!this.w.win.isDestroyed()) this.w.win.contentView.removeChildView(v)
      this.attached = this.attached.filter((x) => x !== id)
    }
    this.views.delete(id)
    this.runtime.delete(id)
    this.mru = this.mru.filter((x) => x !== id)
    this.w.media.forget(id)
    extensionsService()?.tabRemoved(v.webContents) // round 2c
    if (!v.webContents.isDestroyed()) v.webContents.close()
    this.w.core.scheduleBroadcast()
  }

  /** close every view without touching the (already destroyed) window */
  releaseAll(): void {
    for (const [, v] of this.views) {
      extensionsService()?.tabRemoved(v.webContents) // round 2c
      if (!v.webContents.isDestroyed()) v.webContents.close()
    }
    this.views.clear()
    this.runtime.clear()
    this.mru = []
    this.attached = []
  }

  destroyAll(): void {
    for (const id of [...this.views.keys()]) this.destroy(id)
  }
}

function failPage(url: string, desc: string): string {
  const esc = (s: string): string => s.replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`)
  return `<head><meta charset="utf-8"><title>${esc(url)}</title><style>body{font:15px/1.5 -apple-system,system-ui;margin:0;display:grid;place-items:center;height:100vh;color:#15171c;background:#fff}@media (prefers-color-scheme:dark){body{color:#f2f3f5;background:#18191d}}h1{font-size:20px;margin:0 0 6px}</style></head><body><div><h1>This page could not be loaded</h1><div>${esc(url)}</div><div>${esc(desc)}</div></div></body>`
}

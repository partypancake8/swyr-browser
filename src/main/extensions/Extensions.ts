// Chrome extensions: electron-chrome-extensions (MIT) on every profile session, the Chrome Web Store
// through electron-chrome-web-store (MIT), and unpacked extensions loaded from settings.
import { BaseWindow, BrowserWindow, dialog, nativeImage, type Session, type WebContents } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { ElectronChromeExtensions } from 'electron-chrome-extensions'
import { installChromeWebStore, uninstallExtension } from 'electron-chrome-web-store'
import type { ExtensionRuntime, ExtensionSetting, Profile } from '@shared/types'
import { installNativeMessaging } from './NativeMessaging'
import { securePrefs } from '../security/Hardening'

export const WEB_STORE_URL = 'https://chromewebstore.google.com/'

export interface ExtensionsHost {
  test: boolean
  extensionsDir(profileId: string): string
  settings(): ExtensionSetting[]
  saveSettings(list: ExtensionSetting[]): void
  /** open a tab for an extension (chrome.tabs.create); returns its contents and window */
  createTab(url: string | undefined, active: boolean): Promise<[WebContents, BaseWindow]>
  selectTab(wc: WebContents): void
  closeTab(wc: WebContents): void
  createWindow(url: string | undefined): Promise<BaseWindow>
  changed(): void
}

interface Anchor {
  x: number
  y: number
  width: number
  height: number
}

interface PopupLike {
  browserWindow?: Electron.BrowserWindow
  extensionId: string
  setSize(size: { width: number; height: number }): void
  updatePosition(): void
  show(): void
  isDestroyed(): boolean
  hidden: boolean
}

/** Chrome's action popup limits */
const POPUP_MIN = 25
const POPUP_MAX = { width: 800, height: 600 }

/** the swyr preload for extension service workers and pages (built next to the other preloads) */
const EXTENSION_PRELOAD = path.join(__dirname, '../preload/extension.js')

interface BrowserActionInternals {
  activateClick(details: { eventType: string; extensionId: string; tabId: number; anchorRect: Anchor; alignment?: string }): void
  getState(): { actions: { id: string; title?: string; popup?: string }[] }
}

type Manifest = {
  name?: string
  version?: string
  description?: string
  default_locale?: string
  icons?: Record<string, string>
  action?: { default_title?: string; default_icon?: string | Record<string, string>; default_popup?: string }
  browser_action?: { default_title?: string; default_icon?: string | Record<string, string>; default_popup?: string }
}

function localize(ext: { path: string }, manifest: Manifest, value: string | undefined): string | undefined {
  const m = value ? /^__MSG_(\w+)__$/.exec(value) : null
  if (!m) return value
  for (const locale of [manifest.default_locale, 'en', 'en_US'].filter(Boolean) as string[]) {
    try {
      const messages = JSON.parse(fs.readFileSync(path.join(ext.path, '_locales', locale, 'messages.json'), 'utf8'))
      const key = Object.keys(messages).find((k) => k.toLowerCase() === m[1].toLowerCase())
      if (key && typeof messages[key]?.message === 'string') return messages[key].message
    } catch {
      /* try the next locale */
    }
  }
  return value
}

function iconDataUrl(dir: string, manifest: Manifest): string | undefined {
  const action = manifest.action ?? manifest.browser_action
  const pick = (icons: string | Record<string, string> | undefined): string | undefined => {
    if (!icons) return undefined
    if (typeof icons === 'string') return icons
    const sizes = Object.keys(icons)
      .map(Number)
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => Math.abs(a - 32) - Math.abs(b - 32))
    return sizes.length ? icons[String(sizes[0])] : undefined
  }
  const rel = pick(action?.default_icon) ?? pick(manifest.icons)
  if (!rel) return undefined
  try {
    const file = path.resolve(dir, rel.replace(/^\//, ''))
    if (!file.startsWith(path.resolve(dir))) return undefined
    const img = nativeImage.createFromPath(file)
    if (img.isEmpty()) return undefined
    return img.resize({ width: 32, height: 32, quality: 'best' }).toDataURL()
  } catch {
    return undefined
  }
}

function readManifest(dir: string): Manifest | undefined {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as Manifest
  } catch {
    return undefined
  }
}

export class Extensions {
  private readonly bySession = new Map<Session, { profile: Profile; ece: ElectronChromeExtensions; ready: Promise<void> }>()
  private readonly iconCache = new Map<string, string | undefined>()
  /** true while swyr itself reports a selection, so the host callback does not echo it back */
  private selecting = false

  constructor(private readonly host: ExtensionsHost) {}

  /** session hook: called once for every profile session */
  attach(ses: Session, profile: Profile): void {
    if (this.bySession.has(ses)) return
    const host = this.host
    const ece = new ElectronChromeExtensions({
      session: ses,
      createTab: async (details) => host.createTab(details.url, details.active !== false),
      selectTab: (wc) => {
        // ignore the echo of our own tabSelected call
        if (!this.selecting) host.selectTab(wc)
      },
      removeTab: (wc) => host.closeTab(wc),
      createWindow: async (details) => host.createWindow(Array.isArray(details.url) ? details.url[0] : details.url)
    })
    ece.on('browser-action-popup-created', (popup: PopupLike) => this.popupCreated(popup))
    const ctx = (ece as unknown as { ctx: { router: Parameters<typeof installNativeMessaging>[0] } }).ctx
    installNativeMessaging(ctx.router)
    try {
      ses.registerPreloadScript({ id: 'swyr-extension-preload', type: 'service-worker', filePath: EXTENSION_PRELOAD })
      ses.registerPreloadScript({ id: 'swyr-extension-page-preload', type: 'frame', filePath: EXTENSION_PRELOAD })
    } catch (err) {
      console.warn('[swyr] extension preload failed', (err as Error).message)
    }
    const exts = ses.extensions
    exts.on('extension-loaded', (_e, ext) => this.onLoaded(profile, ext))
    exts.on('extension-unloaded', () => host.changed())
    const ready = this.init(ses, profile)
    this.bySession.set(ses, { profile, ece, ready })
  }

  /** sizes an action popup to its document like Chrome: preferred size from Chromium, the page's scroll size as a fallback */
  private popupCreated(popup: PopupLike): void {
    const win = popup.browserWindow
    if (!win) return
    if (this.host.test) {
      // headless: the popup renders but is never shown
      win.show = () => undefined
      win.showInactive = () => undefined
    }
    const wc = win.webContents
    let preferred = false
    wc.on('preferred-size-changed', (_e, size: { width: number; height: number }) => {
      if (size.width > 0 && size.height > 0) preferred = true
    })
    const onSize = (_e: Electron.IpcMainEvent, size: { width?: unknown; height?: unknown }): void => {
      if (popup.isDestroyed() || win.isDestroyed() || preferred) return
      const n = (v: unknown, max: number): number => Math.min(max, Math.max(POPUP_MIN, typeof v === 'number' && Number.isFinite(v) ? Math.ceil(v) : POPUP_MIN))
      popup.setSize({ width: n(size?.width, POPUP_MAX.width), height: n(size?.height, POPUP_MAX.height) })
      popup.updatePosition()
      if (popup.hidden) popup.show()
    }
    wc.ipc.on('swyr:extension-page-size', onSize)
  }

  private async init(ses: Session, profile: Profile): Promise<void> {
    const dir = this.host.extensionsDir(profile.id)
    try {
      fs.mkdirSync(dir, { recursive: true })
      await installChromeWebStore({
        session: ses,
        extensionsPath: dir,
        loadExtensions: !profile.incognito,
        allowUnpackedExtensions: false,
        autoUpdate: !this.host.test && !profile.incognito,
        beforeInstall: async (details) => {
          if (this.host.test) return { action: 'allow' }
          const { response } = await dialog.showMessageBox({
            type: 'question',
            buttons: ['Add Extension', 'Cancel'],
            defaultId: 0,
            cancelId: 1,
            message: `Add "${details.localizedName}" to swyr?`,
            detail: 'It can read and change data on the sites it asks for. You can remove it any time in Extensions.'
          })
          return { action: response === 0 ? 'allow' : 'deny' }
        }
      })
    } catch (err) {
      console.warn('[swyr] web store setup failed', (err as Error).message)
    }
    if (profile.incognito) return
    // unpacked extensions from settings, and store installs the user turned off
    for (const s of this.host.settings().filter((x) => x.profileId === profile.id)) {
      const loaded = ses.extensions.getExtension(s.id)
      if (!s.enabled && loaded) ses.extensions.removeExtension(s.id)
      else if (s.enabled && !loaded && s.path && s.source !== 'store') {
        await ses.extensions.loadExtension(s.path, { allowFileAccess: true }).catch((err: Error) => console.warn('[swyr] extension load failed', s.path, err.message))
      }
    }
    this.host.changed()
  }

  private onLoaded(profile: Profile, ext: Electron.Extension): void {
    if (profile.incognito) return this.host.changed()
    const list = this.host.settings()
    const storeDir = path.resolve(this.host.extensionsDir(profile.id))
    const source: 'store' | 'unpacked' = path.resolve(ext.path).startsWith(storeDir + path.sep) ? 'store' : 'unpacked'
    const existing = list.find((x) => x.id === ext.id && x.profileId === profile.id)
    if (!existing) this.host.saveSettings([...list, { id: ext.id, path: ext.path, enabled: true, profileId: profile.id, source }])
    else if (existing.path !== ext.path || !existing.enabled) this.host.saveSettings(list.map((x) => (x === existing ? { ...x, path: ext.path, enabled: true, source } : x)))
    this.iconCache.delete(ext.id)
    this.host.changed()
  }

  private entry(ses: Session): { profile: Profile; ece: ElectronChromeExtensions; ready: Promise<void> } | undefined {
    return this.bySession.get(ses)
  }

  async whenReady(ses: Session): Promise<void> {
    await this.entry(ses)?.ready
  }

  async loadUnpacked(ses: Session, dir: string): Promise<Electron.Extension> {
    await this.whenReady(ses)
    const resolved = path.resolve(dir)
    if (!readManifest(resolved)) throw new Error('No readable manifest.json in that folder.')
    const already = ses.extensions.getAllExtensions().find((e) => path.resolve(e.path) === resolved)
    if (already) return already
    return ses.extensions.loadExtension(resolved, { allowFileAccess: true })
  }

  async setEnabled(ses: Session, profileId: string, id: string, enabled: boolean): Promise<boolean> {
    await this.whenReady(ses)
    const list = this.host.settings()
    const s = list.find((x) => x.id === id && x.profileId === profileId)
    const loaded = ses.extensions.getExtension(id)
    if (!s && !loaded) return false
    const path_ = s?.path ?? loaded?.path
    if (enabled && !loaded && path_) await ses.extensions.loadExtension(path_, { allowFileAccess: true })
    if (!enabled && loaded) ses.extensions.removeExtension(id)
    const base: ExtensionSetting = s ?? { id, path: path_, enabled, profileId, source: 'unpacked' }
    this.host.saveSettings([...list.filter((x) => x !== s), { ...base, enabled }])
    this.host.changed()
    return true
  }

  async remove(ses: Session, profileId: string, id: string): Promise<boolean> {
    await this.whenReady(ses)
    const list = this.host.settings()
    const s = list.find((x) => x.id === id && x.profileId === profileId)
    const loaded = ses.extensions.getExtension(id)
    if (!s && !loaded) return false
    if (loaded) ses.extensions.removeExtension(id)
    if (s?.source === 'store' || (loaded && loaded.path.startsWith(path.resolve(this.host.extensionsDir(profileId))))) {
      await uninstallExtension(id, { session: ses, extensionsPath: this.host.extensionsDir(profileId) }).catch(() => undefined)
    }
    this.host.saveSettings(list.filter((x) => x !== s))
    this.host.changed()
    return true
  }

  /** test support: writes values into an extension's chrome.storage.local through a hidden page of that extension */
  async setStorageLocal(ses: Session, id: string, values: Record<string, unknown>): Promise<boolean> {
    await this.whenReady(ses)
    const ext = ses.extensions.getExtension(id)
    if (!ext) throw new Error('extension not loaded: ' + id)
    const manifest = (ext.manifest ?? {}) as Manifest & { options_page?: string; options_ui?: { page?: string } }
    const action = manifest.action ?? manifest.browser_action
    let page = action?.default_popup ?? manifest.options_ui?.page ?? manifest.options_page
    if (!page) page = fs.readdirSync(ext.path).find((f) => f.endsWith('.html')) ?? 'manifest.json'
    const win = new BrowserWindow({ show: false, width: 100, height: 100, webPreferences: securePrefs({ session: ses }) })
    try {
      await win.webContents.loadURL(`chrome-extension://${id}/${page.replace(/^\//, '')}`)
      return Boolean(await win.webContents.executeJavaScript(`chrome.storage.local.set(${JSON.stringify(values)}).then(() => true)`, true))
    } finally {
      win.destroy()
    }
  }

  /** opens the extension's action popup anchored to a rect in window content coordinates */
  openPopup(tab: WebContents, id: string, anchor: Anchor): boolean {
    const e = this.entry(tab.session)
    if (!e || !tab.session.extensions.getExtension(id)) return false
    const api = (e.ece as unknown as { api: { browserAction: BrowserActionInternals } }).api.browserAction
    try {
      api.activateClick({ eventType: 'click', extensionId: id, tabId: tab.id, anchorRect: anchor, alignment: 'bottom right' })
      return true
    } catch (err) {
      console.warn('[swyr] extension popup failed', (err as Error).message)
      return false
    }
  }

  /** runtime list: loaded extensions of every live profile session plus the disabled ones from settings */
  list(sessions: Map<string, Session>): ExtensionRuntime[] {
    const out: ExtensionRuntime[] = []
    const seen = new Set<string>()
    for (const [profileId, ses] of sessions) {
      const e = this.entry(ses)
      if (!e || e.profile.incognito) continue
      let titles = new Map<string, { title?: string; popup?: string }>()
      try {
        const api = (e.ece as unknown as { api: { browserAction: BrowserActionInternals } }).api.browserAction
        titles = new Map(api.getState().actions.map((a) => [a.id, a]))
      } catch {
        /* no action state yet */
      }
      for (const ext of ses.extensions.getAllExtensions()) {
        const manifest = (ext.manifest ?? {}) as Manifest
        const action = manifest.action ?? manifest.browser_action
        if (!this.iconCache.has(ext.id)) this.iconCache.set(ext.id, iconDataUrl(ext.path, manifest))
        const setting = this.host.settings().find((x) => x.id === ext.id && x.profileId === profileId)
        out.push({
          id: ext.id,
          name: localize(ext, manifest, ext.name) ?? ext.id,
          version: ext.version,
          enabled: true,
          profileId,
          hasAction: Boolean(action),
          actionTitle: action ? (titles.get(ext.id)?.title ?? localize(ext, manifest, action.default_title) ?? ext.name) : undefined,
          iconDataUrl: this.iconCache.get(ext.id),
          description: localize(ext, manifest, manifest.description),
          source: setting?.source ?? 'unpacked'
        })
        seen.add(`${profileId}:${ext.id}`)
      }
    }
    for (const s of this.host.settings()) {
      if (seen.has(`${s.profileId}:${s.id}`)) continue
      const manifest = s.path ? readManifest(s.path) : undefined
      const fake = { path: s.path ?? '' }
      out.push({
        id: s.id,
        name: (manifest && localize(fake, manifest, manifest.name)) ?? s.id,
        version: manifest?.version ?? '',
        enabled: false,
        profileId: s.profileId,
        hasAction: Boolean(manifest?.action ?? manifest?.browser_action),
        description: manifest ? localize(fake, manifest, manifest.description) : undefined,
        iconDataUrl: s.path && manifest ? iconDataUrl(s.path, manifest) : undefined,
        source: s.source ?? 'unpacked'
      })
    }
    return out
  }

  // ----- tab tracking (called by TabViews)
  tabAdded(wc: WebContents, win: BaseWindow): void {
    try {
      ElectronChromeExtensions.fromSession(wc.session)?.addTab(wc, win)
    } catch {
      /* the tab's session has no extension support */
    }
    wc.on('dom-ready', () => relabelStore(wc))
  }

  tabRemoved(wc: WebContents): void {
    try {
      if (!wc.isDestroyed()) ElectronChromeExtensions.fromSession(wc.session)?.removeTab(wc)
    } catch {
      /* not tracked */
    }
  }

  tabSelected(wc: WebContents): void {
    this.selecting = true
    try {
      if (!wc.isDestroyed()) ElectronChromeExtensions.fromSession(wc.session)?.selectTab(wc)
    } catch {
      /* not tracked */
    } finally {
      this.selecting = false
    }
  }
}

/** on the Chrome Web Store, the install button reads "Add to swyr" */
function relabelStore(wc: WebContents): void {
  if (wc.isDestroyed() || !/^https:\/\/chromewebstore\.google\.com\//.test(wc.getURL())) return
  const js = `(() => {
    const fix = () => {
      for (const el of document.querySelectorAll('button span, button')) {
        for (const n of el.childNodes) {
          if (n.nodeType === 3 && /Add to Chrome/.test(n.nodeValue)) n.nodeValue = n.nodeValue.replace('Add to Chrome', 'Add to swyr')
          if (n.nodeType === 3 && /Remove from Chrome/.test(n.nodeValue)) n.nodeValue = n.nodeValue.replace('Remove from Chrome', 'Remove from swyr')
        }
      }
    }
    fix()
    if (!window.__swyrStoreObserver) {
      window.__swyrStoreObserver = new MutationObserver(fix)
      window.__swyrStoreObserver.observe(document.documentElement, { subtree: true, childList: true, characterData: true })
    }
  })()`
  // an isolated world: the store page's own scripts cannot see or replace the observer
  void wc.executeJavaScriptInIsolatedWorld(STORE_WORLD, [{ code: js }], false).catch(() => undefined)
}
const STORE_WORLD = 1041

// single instance shared with TabViews
let current: Extensions | null = null
export function setExtensions(e: Extensions): void {
  current = e
}
export function extensionsService(): Extensions | null {
  return current
}

// Ad and tracker blocking with @ghostery/adblocker-electron (MPL-2.0, see THIRD_PARTY_LICENSES.md).
// A small bundled list is active immediately; the prebuilt EasyList + EasyPrivacy engine replaces it once
// fetched (cached under userData/adblock). Blocking is per session, with a per-site allow list.
import { net, type Session } from 'electron'
import { handleEvent } from '../security/IpcGuard'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { ElectronBlocker } from '@ghostery/adblocker-electron'
import type { AdblockStats } from '@shared/types'
import { BUNDLED_FILTERS } from './bundled'

const DEBUG = process.env.SWYR_DEBUG === '1'
const COSMETIC_CHANNELS = ['@ghostery/adblocker/inject-cosmetic-filters', '@ghostery/adblocker/is-mutation-observer-enabled'] as const

export interface AdblockHost {
  enabled(): boolean
  allowList(): string[]
  /** sidebar item id of a tab's webContents, if it is a tab */
  itemIdFor(webContentsId: number | undefined): string | undefined
  changed(): void
}

export function hostAllowed(host: string, allow: string[]): boolean {
  const h = host.toLowerCase().replace(/^www\./, '')
  return allow.some((a) => {
    const p = a.toLowerCase().trim().replace(/^www\./, '')
    return p !== '' && (h === p || h.endsWith('.' + p))
  })
}

const MEDIA_HOSTS = /(^|\.)(googlevideo\.com|ytimg\.com|ggpht\.com)$/i
const YOUTUBE_HOSTS = /(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be)$/i

/** the last two labels of a host: enough to tell a site's own media from a third party's */
function siteOf(host: string): string {
  return host.toLowerCase().split('.').slice(-2).join('.')
}

/**
 * requests the blocker never touches, whatever the lists say: YouTube's video and image CDNs, YouTube's own
 * player, API and playback reporting on YouTube pages (blocking those stalls or blacks out the player), and
 * media a site serves from its own domain
 */
export function neverBlock(url: string, pageUrl: string | undefined, resourceType?: string): boolean {
  const host = hostOfUrl(url)
  if (!host) return false
  if (MEDIA_HOSTS.test(host)) return true
  const page = hostOfUrl(pageUrl)
  if (YOUTUBE_HOSTS.test(host) && YOUTUBE_HOSTS.test(page)) return true
  return resourceType === 'media' && Boolean(page) && siteOf(host) === siteOf(page)
}

function hostOfUrl(url: string | undefined): string {
  if (!url) return ''
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

export class Adblock {
  private engine: ElectronBlocker
  readonly stats: AdblockStats = { blocked: 0, perTab: {} }
  lists: 'bundled' | 'full' = 'bundled'
  private readonly sessions = new Set<Session>()
  private ipcReady = false
  private preloadPath: string | null = null

  constructor(
    private readonly host: AdblockHost,
    private readonly cacheDir: string
  ) {
    this.engine = ElectronBlocker.parse(BUNDLED_FILTERS)
    try {
      this.preloadPath = createRequire(__filename).resolve('@ghostery/adblocker-electron-preload')
    } catch {
      this.preloadPath = null
    }
  }

  /** fetch (or read from cache) the prebuilt EasyList + EasyPrivacy engine; stays on the bundled list when offline */
  async loadFullLists(): Promise<void> {
    try {
      fs.mkdirSync(this.cacheDir, { recursive: true })
      const cachePath = path.join(this.cacheDir, 'engine-ads-tracking.bin')
      const fetchImpl = (url: string) => net.fetch(url)
      const full = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetchImpl, {
        path: cachePath,
        read: async (p: string) => new Uint8Array(await fs.promises.readFile(p)),
        write: async (p: string, buf: Uint8Array) => fs.promises.writeFile(p, buf)
      })
      this.engine = full
      this.lists = 'full'
      this.host.changed()
    } catch (err) {
      console.warn('[swyr] ad blocker: using the bundled list (prebuilt lists unavailable)', (err as Error).message)
    }
  }

  private pageAllowed(pageUrl: string | undefined): boolean {
    const allow = this.host.allowList()
    if (!allow.length) return false
    const h = hostOfUrl(pageUrl)
    return Boolean(h) && hostAllowed(h, allow)
  }

  private active(pageUrl: string | undefined): boolean {
    return this.host.enabled() && !this.pageAllowed(pageUrl)
  }

  private count(webContentsId: number | undefined): void {
    this.stats.blocked += 1
    const item = this.host.itemIdFor(webContentsId)
    if (item) this.stats.perTab[item] = (this.stats.perTab[item] ?? 0) + 1
    this.host.changed()
  }

  attach(ses: Session): void {
    if (this.sessions.has(ses)) return
    this.sessions.add(ses)
    ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
      const wc = details.webContents
      if (details.resourceType === 'mainFrame') {
        const item = this.host.itemIdFor(details.webContentsId)
        if (item && this.stats.perTab[item]) {
          this.stats.perTab[item] = 0
          this.host.changed()
        }
        callback({})
        return
      }
      const pageUrl = wc && !wc.isDestroyed() ? wc.getURL() : undefined
      if (!/^(https?|wss?):/i.test(details.url) || !this.active(pageUrl) || neverBlock(details.url, pageUrl, details.resourceType)) {
        callback({})
        return
      }
      try {
        this.engine.onBeforeRequest(details, (res) => {
          if (res.cancel || res.redirectURL) {
            this.count(details.webContentsId)
            if (DEBUG) console.log('[swyr:adblock] blocked', details.resourceType, details.url.slice(0, 200), 'on', pageUrl?.slice(0, 80))
          }
          callback(res)
        })
      } catch {
        callback({})
      }
    })
    ses.webRequest.onHeadersReceived({ urls: ['<all_urls>'] }, (details, callback) => {
      const wc = details.webContents
      const pageUrl = details.resourceType === 'mainFrame' ? details.url : wc && !wc.isDestroyed() ? wc.getURL() : undefined
      if (!this.active(pageUrl)) {
        callback({})
        return
      }
      try {
        this.engine.onHeadersReceived(details, callback)
      } catch {
        callback({})
      }
    })
    if (this.preloadPath) {
      try {
        ses.registerPreloadScript({ id: 'swyr-adblock-cosmetics', type: 'frame', filePath: this.preloadPath })
      } catch (err) {
        console.warn('[swyr] ad blocker cosmetic preload failed', (err as Error).message)
      }
      this.ensureIpc()
    }
  }

  /** the cosmetic-filter IPC is global; register it once and route to the current engine */
  private ensureIpc(): void {
    if (this.ipcReady) return
    this.ipcReady = true
    // web pages in tabs, mini windows and the preview, in every frame (the cosmetic preload runs in sub-frames too)
    const roles = ['webPage', 'miniPage', 'previewPage'] as const
    handleEvent(
      COSMETIC_CHANNELS[0],
      roles,
      async (event, _sender, url, msg) => {
        if (typeof url !== 'string' || url.length > 8192 || !this.sessions.has(event.sender.session) || !this.active(url)) return undefined
        return this.engine.onInjectCosmeticFilters(event, url, (msg && typeof msg === 'object' ? msg : undefined) as never)
      },
      { subframes: true }
    )
    handleEvent(COSMETIC_CHANNELS[1], roles, async (event) => this.engine.onIsMutationObserverEnabled(event), { subframes: true })
  }

  forgetTab(itemId: string): void {
    delete this.stats.perTab[itemId]
  }
}

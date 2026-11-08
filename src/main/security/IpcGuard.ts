// The one place IPC from renderers enters the main process. Every channel is registered through handle() or on()
// with the sender roles it accepts; a message from any other webContents, or from a sub-frame unless the channel
// allows sub-frames, is refused before the handler runs. Payload helpers below do the explicit type checks.
import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent, type WebContents, type WebFrameMain } from 'electron'
import type { Core } from '../windows/WindowManager'
import type { SwyrWindow } from '../windows/SwyrWindow'
import type { MiniWindow } from '../windows/MiniWindow'
import { refusedInput, schemeOf } from './urlPolicy'

/**
 * shell, overlay: swyr's own UI views. internalPage: a tab showing a swyr:// page. webPage: a tab showing anything else.
 * miniChrome / miniPage: a Mini Window's bar and its page. previewPage: the Preview card's page.
 * extensionPage: a chrome-extension:// page anywhere.
 */
export type SenderRole = 'shell' | 'overlay' | 'internalPage' | 'webPage' | 'miniChrome' | 'miniPage' | 'previewPage' | 'extensionPage'

export interface Sender {
  role: SenderRole
  wc: WebContents
  url: string
  w?: SwyrWindow
  mini?: MiniWindow
}

let coreRef: Core | null = null

export function setGuardCore(core: Core): void {
  coreRef = core
}

const devUrl = (): string => process.env.ELECTRON_RENDERER_URL || ''

/** the URL a swyr UI view (shell, overlay, mini chrome) must be showing for its messages to count */
function isUiUrl(url: string, host: 'shell' | 'overlay' | 'mini'): boolean {
  if (url.startsWith(`swyr://${host}/`)) return true
  const dev = devUrl()
  return Boolean(dev) && url.startsWith(`${dev}/${host}/`)
}

/** who a webContents is, or null when it is none of swyr's views */
export function classify(wc: WebContents, url = wc.getURL()): Sender | null {
  const core = coreRef
  if (!core || wc.isDestroyed()) return null
  for (const w of core.windows) {
    if (w.closed) continue
    if (wc === w.shell.webContents) return isUiUrl(url, 'shell') ? { role: 'shell', wc, url, w } : null
    if (wc === w.overlay.webContents) return isUiUrl(url, 'overlay') ? { role: 'overlay', wc, url, w } : null
    if (w.preview.view && wc === w.preview.view.webContents) return { role: 'previewPage', wc, url, w }
    if (w.tabs.idOf(wc)) {
      const scheme = schemeOf(url)
      return { role: scheme === 'swyr' ? 'internalPage' : scheme === 'chrome-extension' ? 'extensionPage' : 'webPage', wc, url, w }
    }
  }
  for (const m of core.minis) {
    if (m.closed) continue
    if (wc === m.win.webContents) return isUiUrl(url, 'mini') ? { role: 'miniChrome', wc, url, mini: m } : null
    if (m.page && wc === m.page.webContents) return { role: 'miniPage', wc, url, mini: m }
  }
  if (schemeOf(url) === 'chrome-extension') return { role: 'extensionPage', wc, url }
  return null
}

interface GuardOptions {
  /** accept messages from sub-frames too (the ad blocker's cosmetic filters run in every frame) */
  subframes?: boolean
}

type GuardEvent = IpcMainEvent | IpcMainInvokeEvent

/** the sender of an IPC message when it passes the role and frame checks, else null */
export function senderOf(event: GuardEvent, roles: readonly SenderRole[], opts: GuardOptions = {}): Sender | null {
  const wc = event.sender
  if (!wc || wc.isDestroyed()) return null
  const frame = event.senderFrame as WebFrameMain | null
  if (!frame) return null
  const isMain = frame === wc.mainFrame || frame.parent === null
  if (!isMain && !opts.subframes) return null
  // the main frame's URL decides the role: a sub-frame inside a web page is still a web page
  const s = classify(wc, isMain ? frame.url || wc.getURL() : wc.getURL())
  if (!s || !roles.includes(s.role)) return null
  return s
}

const refused = new Map<string, number>()
function logRefusal(channel: string, wc: WebContents): void {
  const key = `${channel} ${wc.id}`
  const n = (refused.get(key) ?? 0) + 1
  refused.set(key, n)
  if (n === 1 && process.env.SWYR_TEST !== '1') console.warn(`[swyr] refused IPC on ${channel} from ${wc.getURL().slice(0, 80)}`)
}

/** ipcMain.handle with a sender check: a refused sender gets an error and the handler never runs */
export function handle(channel: string, roles: readonly SenderRole[], fn: (sender: Sender, ...args: unknown[]) => unknown, opts: GuardOptions = {}): void {
  ipcMain.removeHandler(channel)
  ipcMain.handle(channel, (event, ...args: unknown[]) => {
    const s = senderOf(event, roles, opts)
    if (!s) {
      logRefusal(channel, event.sender)
      throw new Error('not allowed')
    }
    return fn(s, ...args)
  })
}

/** handle() for channels whose handler needs the raw event (the ad blocker hands it to its engine) */
export function handleEvent(channel: string, roles: readonly SenderRole[], fn: (event: IpcMainInvokeEvent, sender: Sender, ...args: unknown[]) => unknown, opts: GuardOptions = {}): void {
  ipcMain.removeHandler(channel)
  ipcMain.handle(channel, (event, ...args: unknown[]) => {
    const s = senderOf(event, roles, opts)
    if (!s) {
      logRefusal(channel, event.sender)
      throw new Error('not allowed')
    }
    return fn(event, s, ...args)
  })
}

/** ipcMain.on with a sender check: messages from refused senders are dropped */
export function on(channel: string, roles: readonly SenderRole[], fn: (sender: Sender, ...args: unknown[]) => void, opts: GuardOptions = {}): void {
  ipcMain.on(channel, (event, ...args: unknown[]) => {
    const s = senderOf(event, roles, opts)
    if (!s) return logRefusal(channel, event.sender)
    fn(s, ...args)
  })
}

// ----- payload checks

export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

const COMMAND_RE = /^[a-z][A-Za-z0-9]*(\.[A-Za-z][A-Za-z0-9]*){1,3}$/

/** a command name as sent over IPC: dotted identifiers, short */
export function isCommandName(v: unknown): v is string {
  return typeof v === 'string' && v.length <= 64 && COMMAND_RE.test(v)
}

/** payload fields that carry a URL to load or open */
const URL_KEYS = ['url', 'input', 'pinnedUrl', 'href'] as const
/** payload fields renderers never send: local paths are picked in a dialog the main process opens */
const PATH_KEYS = ['path', 'file', 'filePath', 'dir', 'directory', 'fixture'] as const

/**
 * the payload of a command a renderer sent, checked and cleaned: a plain object (or nothing), no local paths, and
 * no URL that a renderer may not load (script URLs, local files). Throws on a refused URL.
 */
export function rendererPayload(command: string, payload: unknown): Record<string, unknown> {
  if (payload === undefined || payload === null) return {}
  if (!isRecord(payload)) throw new Error(`bad payload for ${command}`)
  const p: Record<string, unknown> = { ...payload }
  for (const k of PATH_KEYS) delete p[k]
  if (isRecord(p.sourceConfig)) {
    const cfg = { ...p.sourceConfig }
    delete cfg.fixture
    p.sourceConfig = cfg
  }
  for (const k of URL_KEYS) {
    const v = p[k]
    if (v === undefined) continue
    if (typeof v !== 'string') {
      delete p[k]
      continue
    }
    const why = refusedInput(v, true)
    if (why) throw new Error(`blocked url: ${why}`)
  }
  if (Array.isArray(p.urls)) p.urls = p.urls.filter((u): u is string => typeof u === 'string' && !refusedInput(u, true))
  return p
}

/** commands no renderer may run, whatever its role */
export const MAIN_ONLY_COMMANDS = new Set(['page.runJs', 'archive.runAuto'])

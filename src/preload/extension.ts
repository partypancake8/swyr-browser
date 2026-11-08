// Preload for extension contexts (service workers and chrome-extension:// pages), registered on every profile session
// after the electron-chrome-extensions preload. It turns swyr's native messaging error replies into
// chrome.runtime.lastError like Chrome, and reports the document size of extension pages so action popups fit it.
import { contextBridge, ipcRenderer } from 'electron'

// runs in the main world: wraps the chrome.runtime native messaging calls that the library preload defined
function patchNativeMessaging(): void {
  const ERR = '__swyrNativeError'
  const DISC = '__swyrNativeDisconnect'
  type Rt = Record<string, unknown> & { lastError?: { message: string } }
  const chromeObj = (globalThis as unknown as { chrome?: { runtime?: Rt } }).chrome
  const rt = chromeObj?.runtime
  if (!rt || (rt as { __swyrNative?: boolean }).__swyrNative) return
  // Chromium's native `browser` namespace is a separate object that lacks the APIs the library preload added to
  // `chrome` (windows, tabs events, contextMenus...); extensions that use `browser.*` (1Password) crash without them
  const g = globalThis as unknown as { browser?: unknown }
  if (g.browser !== chromeObj) {
    try {
      Object.defineProperty(globalThis, 'browser', { value: chromeObj, writable: true, enumerable: true, configurable: true })
    } catch {
      try {
        g.browser = chromeObj
      } catch {
        /* leave the native namespace */
      }
    }
  }
  const withLastError = (message: string, fn: () => void): void => {
    Object.defineProperty(rt, 'lastError', { value: { message }, configurable: true, writable: true, enumerable: true })
    try {
      fn()
    } finally {
      Object.defineProperty(rt, 'lastError', { value: undefined, configurable: true, writable: true, enumerable: true })
    }
  }
  const errOf = (r: unknown): string | undefined => (r && typeof r === 'object' && typeof (r as Record<string, unknown>)[ERR] === 'string' ? ((r as Record<string, unknown>)[ERR] as string) : undefined)
  const send = rt.sendNativeMessage as ((app: string, msg: unknown) => Promise<unknown>) | undefined
  if (typeof send === 'function') {
    rt.sendNativeMessage = function (app: string, msg: unknown, cb?: (r?: unknown) => void): Promise<unknown> | undefined {
      const p = Promise.resolve(send(app, msg))
      if (typeof cb === 'function') {
        void p.then(
          (r) => {
            const e = errOf(r)
            if (e) withLastError(e, () => cb())
            else cb(r)
          },
          (err: unknown) => withLastError(String((err as Error)?.message ?? err), () => cb())
        )
        return undefined
      }
      return p.then((r) => {
        const e = errOf(r)
        if (e) throw new Error(e)
        return r
      })
    }
  }
  type Ev = { _emit: (...a: unknown[]) => void }
  const connect = rt.connectNative as ((app: string) => { onMessage: Ev; onDisconnect: Ev }) | undefined
  if (typeof connect === 'function') {
    rt.connectNative = function (app: string) {
      const port = connect(app)
      let reason: string | undefined
      const emitMessage = port.onMessage._emit.bind(port.onMessage)
      port.onMessage._emit = (m: unknown): void => {
        if (m && typeof m === 'object' && typeof (m as Record<string, unknown>)[DISC] === 'string') {
          reason = (m as Record<string, string>)[DISC]
          return
        }
        emitMessage(m, port)
      }
      const emitDisconnect = port.onDisconnect._emit.bind(port.onDisconnect)
      port.onDisconnect._emit = (): void => {
        if (reason) withLastError(reason, () => emitDisconnect(port))
        else emitDisconnect(port)
      }
      return port
    }
  }
  Object.defineProperty(rt, '__swyrNative', { value: true })
}

const isWorker = process.type === 'service-worker'
const href = String((globalThis as unknown as { location?: { href?: string } }).location?.href ?? '')
if (isWorker || href.startsWith('chrome-extension://')) {
  try {
    contextBridge.executeInMainWorld({ func: patchNativeMessaging })
  } catch {
    /* no main world access here */
  }
}

// action popups: report the document's natural size (scroll size) whenever it changes; main applies it only to popups
interface El {
  scrollWidth: number
  scrollHeight: number
  getBoundingClientRect(): { width: number; height: number }
}
interface PageGlobals {
  top: unknown
  document: { documentElement: El | null; body: El | null }
  addEventListener(type: string, fn: () => void): void
  ResizeObserver?: new (cb: () => void) => { observe(el: El): void }
}
const g = globalThis as unknown as PageGlobals
if (!isWorker && href.startsWith('chrome-extension://') && g.top === globalThis) {
  let last = ''
  const report = (): void => {
    const d = g.document.documentElement
    const b = g.document.body
    if (!d || !b) return
    const width = Math.ceil(Math.max(d.scrollWidth, b.scrollWidth, b.getBoundingClientRect().width))
    const height = Math.ceil(Math.max(d.scrollHeight, b.scrollHeight, b.getBoundingClientRect().height))
    const key = width + 'x' + height
    if (key === last) return
    last = key
    ipcRenderer.send('swyr:extension-page-size', { width, height })
  }
  let ro: { observe(el: El): void } | undefined
  const watch = (): void => {
    report()
    const RO = g.ResizeObserver
    if (ro || typeof RO !== 'function') return
    ro = new RO(() => report())
    if (g.document.documentElement) ro.observe(g.document.documentElement)
    if (g.document.body) ro.observe(g.document.body)
  }
  g.addEventListener('DOMContentLoaded', watch)
  g.addEventListener('load', watch)
  // content that grows without resizing body (late scripts, fonts) is caught by a slow poll for the first seconds
  let polls = 0
  const timer = setInterval(() => {
    report()
    if (++polls > 20) clearInterval(timer)
  }, 250)
}

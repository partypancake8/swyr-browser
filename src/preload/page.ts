// Preload for tab, mini window and preview pages. Only swyr:// internal pages get an API (window.swyr, checked
// again by main on every call). Web pages get no API and no Node or Electron objects: only Chrome's look
// (navigator.userAgentData brands and window.chrome, see chromeLook.ts), set before page scripts run, and the mouse
// back/forward channel. Reader, Styles and the hide-element picker run from main in isolated worlds.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { chromeLook } from './chromeLook'

const loc = (globalThis as unknown as { location?: { protocol: string } }).location
if (loc?.protocol === 'swyr:') {
  contextBridge.exposeInMainWorld('swyr', {
    invoke: (command: string, payload?: unknown): Promise<unknown> => ipcRenderer.invoke('swyr:invoke', command, payload),
    getState: (): Promise<unknown> => ipcRenderer.invoke('swyr:getState'),
    onState(cb: (state: unknown) => void): () => void {
      const fn = (_e: IpcRendererEvent, s: unknown): void => cb(s)
      ipcRenderer.on('swyr:state', fn)
      return () => ipcRenderer.off('swyr:state', fn)
    },
    onEvent(): () => void {
      return () => undefined
    }
  })
  // a note or canvas changed outside the page (sidebar rename, a command): main sends the change as data and the
  // page sees it as a 'doc-updated' event on window
  ipcRenderer.on('swyr:doc-updated', (_e: IpcRendererEvent, detail: unknown) => {
    if (!detail || typeof detail !== 'object') return
    try {
      contextBridge.executeInMainWorld({
        func: (d: unknown) => {
          const g = globalThis as unknown as { dispatchEvent(e: unknown): void; CustomEvent: new (type: string, init: { detail: unknown }) => unknown }
          g.dispatchEvent(new g.CustomEvent('doc-updated', { detail: d }))
        },
        args: [detail]
      })
    } catch {
      /* the page is going away */
    }
  })
} else if (loc && /^(https?|file):$/.test(loc.protocol)) {
  try {
    contextBridge.executeInMainWorld({ func: chromeLook })
  } catch {
    /* the page keeps the stock objects */
  }
}

// Mouse thumb buttons (DOM button 3 = back, 4 = forward) on every page. Listening on window runs after the page's
// own document handlers, so a page that handles the button itself and calls preventDefault keeps it.
type MouseUp = { button: number; defaultPrevented: boolean; preventDefault(): void }
const target = globalThis as unknown as { addEventListener?: (type: string, fn: (e: MouseUp) => void) => void }
target.addEventListener?.('mouseup', (m) => {
  if (m.defaultPrevented || (m.button !== 3 && m.button !== 4)) return
  m.preventDefault()
  ipcRenderer.send('swyr:mouseNav', m.button === 3 ? 'back' : 'forward')
})

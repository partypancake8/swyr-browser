// Preload for tab views. Only swyr:// internal pages get an API; web pages get nothing.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

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
}

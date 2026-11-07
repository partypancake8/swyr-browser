// Preload for the shell and overlay views.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

const api = {
  invoke: (command: string, payload?: unknown): Promise<unknown> => ipcRenderer.invoke('swyr:invoke', command, payload),
  getState: (): Promise<unknown> => ipcRenderer.invoke('swyr:getState'),
  onState(cb: (state: unknown) => void): () => void {
    const fn = (_e: IpcRendererEvent, s: unknown): void => cb(s)
    ipcRenderer.on('swyr:state', fn)
    return () => ipcRenderer.off('swyr:state', fn)
  },
  onEvent(cb: (event: unknown) => void): () => void {
    const fn = (_e: IpcRendererEvent, s: unknown): void => cb(s)
    ipcRenderer.on('swyr:event', fn)
    return () => ipcRenderer.off('swyr:event', fn)
  }
}

contextBridge.exposeInMainWorld('swyr', api)

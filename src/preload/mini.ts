// Preload for a Mini Window's chrome: its own narrow channel, only mini.* commands.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

const api = {
  invoke: (command: string, payload?: unknown): Promise<unknown> => ipcRenderer.invoke('swyr:mini:invoke', command, payload),
  getState: (): Promise<unknown> => ipcRenderer.invoke('swyr:mini:getState'),
  onState(cb: (state: unknown) => void): () => void {
    const fn = (_e: IpcRendererEvent, s: unknown): void => cb(s)
    ipcRenderer.on('swyr:mini:state', fn)
    return () => ipcRenderer.off('swyr:mini:state', fn)
  },
  onEvent(cb: (event: unknown) => void): () => void {
    const fn = (_e: IpcRendererEvent, s: unknown): void => cb(s)
    ipcRenderer.on('swyr:mini:event', fn)
    return () => ipcRenderer.off('swyr:mini:event', fn)
  }
}

contextBridge.exposeInMainWorld('swyrMini', api)

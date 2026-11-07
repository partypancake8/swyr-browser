// Renderer-side view state, pushed by the main process.
import { create } from 'zustand'
import type { ViewState } from '@shared/types'

interface ViewStore {
  vs: ViewState | null
}

export const useView = create<ViewStore>(() => ({ vs: null }))

let started = false
export function startViewSync(): void {
  if (started || !window.swyr) return
  started = true
  window.swyr.onState((vs) => useView.setState({ vs }))
  void window.swyr.getState().then((vs) => {
    if (vs && !useView.getState().vs) useView.setState({ vs })
  })
}

export const invoke = (command: string, payload?: unknown): Promise<unknown> =>
  window.swyr ? window.swyr.invoke(command, payload).catch((err) => console.error('[swyr]', command, err)) : Promise.resolve(undefined)

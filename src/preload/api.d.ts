// The API the preloads expose to renderers.
import type { MiniViewState, ShellEvent, ViewState } from '../shared/types'

export interface SwyrApi {
  invoke(command: string, payload?: unknown): Promise<unknown>
  getState(): Promise<ViewState | null>
  onState(cb: (state: ViewState) => void): () => void
  onEvent(cb: (event: ShellEvent) => void): () => void
}

// round 2a: the Mini Window chrome's API (src/preload/mini.ts)
export interface SwyrMiniApi {
  invoke(command: string, payload?: unknown): Promise<unknown>
  getState(): Promise<MiniViewState | null>
  onState(cb: (state: MiniViewState) => void): () => void
  onEvent(cb: (event: { type: 'focusUrl' }) => void): () => void
}

declare global {
  interface Window {
    swyr: SwyrApi
    swyrMini?: SwyrMiniApi
  }
}

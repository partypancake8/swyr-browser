// The API the preloads expose to renderers.
import type { ShellEvent, ViewState } from '../shared/types'

export interface SwyrApi {
  invoke(command: string, payload?: unknown): Promise<unknown>
  getState(): Promise<ViewState | null>
  onState(cb: (state: ViewState) => void): () => void
  onEvent(cb: (event: ShellEvent) => void): () => void
}

declare global {
  interface Window {
    swyr: SwyrApi
  }
}

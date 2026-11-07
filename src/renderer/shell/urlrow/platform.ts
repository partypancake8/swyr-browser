// Runtime platform state (extensions, downloads, ad blocker counts) for the shell, pushed by main as
// a { type: 'platform' } event on the shell's event channel.
import { create } from 'zustand'
import type { PlatformRuntime } from '@shared/types'

export const usePlatform = create<{ p: PlatformRuntime | null }>(() => ({ p: null }))

let started = false
export function startPlatformSync(): void {
  if (started || !window.swyr) return
  started = true
  window.swyr.onEvent((e) => {
    const ev = e as unknown as { type?: string; platform?: PlatformRuntime }
    if (ev.type === 'platform' && ev.platform) usePlatform.setState({ p: ev.platform })
  })
  void window.swyr
    .invoke('platform.state')
    .then((p) => {
      if (p && typeof p === 'object') usePlatform.setState({ p: p as PlatformRuntime })
    })
    .catch(() => undefined)
}

// Platform runtime for internal pages: fetched on mount, after every state broadcast, and on demand.
import { useCallback, useEffect, useState } from 'react'
import type { PlatformRuntime, ViewState } from '@shared/types'
import { invoke } from '../../common/store'

export function usePlatformPage(vs: ViewState | null): [PlatformRuntime | null, () => void] {
  const [p, setP] = useState<PlatformRuntime | null>(null)
  const refresh = useCallback(() => {
    void invoke('platform.state').then((r) => {
      if (r && typeof r === 'object') setP(r as PlatformRuntime)
    })
  }, [])
  useEffect(() => {
    refresh()
  }, [vs, refresh])
  return [p, refresh]
}

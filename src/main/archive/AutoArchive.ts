// Moves Today tabs that have not been active for settings.archiveAfter into the Archive.
import { powerMonitor } from 'electron'
import type { ArchiveAfter } from '@shared/types'
import { archiveItems } from '../commands/builtins'
import type { Core } from '../windows/WindowManager'

const HOUR = 3600_000

export function archiveAfterMs(v: ArchiveAfter): number | null {
  switch (v) {
    case '12h':
      return 12 * HOUR
    case '24h':
      return 24 * HOUR
    case '7d':
      return 7 * 24 * HOUR
    case '30d':
      return 30 * 24 * HOUR
    default:
      return null
  }
}

export function runAutoArchive(core: Core, now = Date.now()): number {
  const limit = archiveAfterMs(core.store.state.settings.archiveAfter)
  if (limit === null) return 0
  const active = new Set(core.windows.map((w) => w.activeItemId).filter(Boolean))
  const stale = core.store.state.items.filter(
    (i) => i.section === 'today' && (i.kind === 'tab' || i.kind === 'split') && !i.parentId && !active.has(i.id) && now - i.lastActiveAt > limit
  )
  archiveItems(core, stale, 'auto')
  return stale.length
}

export function startAutoArchive(core: Core): () => void {
  const tick = (): void => {
    try {
      runAutoArchive(core)
    } catch (err) {
      console.error('[swyr] auto archive failed', err)
    }
  }
  tick()
  const timer = setInterval(tick, 60_000)
  powerMonitor.on('resume', tick)
  return () => {
    clearInterval(timer)
    powerMonitor.off('resume', tick)
  }
}

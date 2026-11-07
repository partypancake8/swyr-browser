// URL row extras: one action button per extension of the active profile, and the blocked-ads counter.
import { useEffect, type ReactNode } from 'react'
import { ShieldCheck } from 'lucide-react'
import type { ExtensionRuntime, ViewState } from '@shared/types'
import { invoke } from '../../common/store'
import { activeSpace } from '../../common/theme'
import { startPlatformSync, usePlatform } from './platform'

function ActionButton({ ext }: { ext: ExtensionRuntime }): ReactNode {
  const label = ext.actionTitle || ext.name
  return (
    <button
      className="icon-btn !h-7 !w-7 shrink-0"
      title={label}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        void invoke('extensions.openPopup', { id: ext.id, anchor: { x: r.left, y: r.top, width: r.width, height: r.height } })
      }}
    >
      {ext.iconDataUrl ? (
        <img src={ext.iconDataUrl} alt="" width={16} height={16} draggable={false} className="h-4 w-4 rounded-[3px]" />
      ) : (
        <span className="flex h-[18px] w-[18px] items-center justify-center rounded-[5px] bg-[var(--fg)] text-[11px] font-bold leading-none text-[var(--content)]">
          {(ext.name || '?').trim().charAt(0).toUpperCase()}
        </span>
      )}
    </button>
  )
}

export function ExtensionActions({ vs }: { vs: ViewState }): ReactNode {
  useEffect(() => startPlatformSync(), [])
  const p = usePlatform((s) => s.p)
  const space = activeSpace(vs)
  const itemId = vs.window.activeItemId
  const blocked = itemId && p ? (p.adblockStats.perTab[itemId] ?? 0) : 0
  const actions = (p?.extensions ?? []).filter((e) => e.enabled && e.hasAction && e.profileId === space?.profileId)
  const adblockOn = vs.state.settings.adblock !== false
  if (!actions.length && !(adblockOn && blocked > 0)) return null
  return (
    <div className="no-drag mt-1 flex h-7 shrink-0 items-center gap-0.5 px-0.5">
      {actions.map((ext) => (
        <ActionButton key={`${ext.profileId}:${ext.id}`} ext={ext} />
      ))}
      <div className="flex-1" />
      {adblockOn && blocked > 0 && (
        <span
          className="flex h-6 items-center gap-1 rounded-md px-1.5 text-[12px] font-semibold"
          title={`${blocked} ads and trackers blocked on this page`}
          data-testid="adblock-count"
        >
          <ShieldCheck size={14} strokeWidth={2} />
          {blocked} blocked
        </span>
      )}
    </div>
  )
}

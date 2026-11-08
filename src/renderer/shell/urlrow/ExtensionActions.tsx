// URL row extras: one action button per extension of the active profile. The blocked count lives in Site Settings.
import { useEffect, type ReactNode } from 'react'
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
  const actions = (p?.extensions ?? []).filter((e) => e.enabled && e.hasAction && e.profileId === space?.profileId)
  if (!actions.length) return null
  return (
    <div className="no-drag mt-1 flex h-7 shrink-0 items-center gap-0.5 px-0.5">
      {actions.map((ext) => (
        <ActionButton key={`${ext.profileId}:${ext.id}`} ext={ext} />
      ))}
    </div>
  )
}

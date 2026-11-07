// The Pinned section: a tree of tabs and (nested, collapsible) folders, plus the divider below it.
import type { ReactNode } from 'react'
import { useDroppable } from '@dnd-kit/core'
import type { Item, Space, ViewState } from '@shared/types'
import { childrenOf, sectionItems } from '@shared/ops'
import { invoke } from '../../common/store'
import { useDndUi, zoneDndId, type DragData } from './dnd'
import { FolderRow } from './FolderRow'
import { TabRow } from './TabRow'

interface Row {
  item: Item
  depth: number
}

/** visible pinned rows, depth first, children of collapsed folders hidden */
export function pinnedRows(vs: ViewState, space: Space): Row[] {
  const out: Row[] = []
  const walk = (list: Item[], depth: number): void => {
    for (const it of list) {
      out.push({ item: it, depth })
      if (it.kind === 'folder' && !it.collapsed && depth < 16) walk(childrenOf(vs.state, it.id), depth + 1)
    }
  }
  walk(sectionItems(vs.state, space.id, 'pinned'), 0)
  return out
}

export function PinnedList({ vs, space }: { vs: ViewState; space: Space }): ReactNode {
  const data: DragData = { kind: 'zone', zone: 'pinned' }
  const zone = useDroppable({ id: zoneDndId('pinned'), data })
  const dragging = useDndUi((s) => s.activeId !== null && s.activeId.startsWith('item:'))
  const zoneOn = useDndUi((s) => s.indicator?.overId === zoneDndId('pinned'))
  const rows = pinnedRows(vs, space)
  return (
    <div ref={zone.setNodeRef} className="flex flex-col" data-section="pinned" role="tree" aria-label="Pinned">
      {rows.map(({ item, depth }) =>
        item.kind === 'folder' ? (
          <FolderRow key={item.id} folder={item} depth={depth} vs={vs} space={space} />
        ) : (
          <TabRow key={item.id} item={item} depth={depth} vs={vs} space={space} />
        )
      )}
      {rows.length === 0 && dragging && (
        <div className={`drop-zone flex h-8 items-center justify-center text-[12px] font-semibold ${zoneOn ? 'drop-zone-on' : ''}`}>Drop here to pin</div>
      )}
    </div>
  )
}

export function Divider({ hasToday }: { hasToday: boolean }): ReactNode {
  const data: DragData = { kind: 'zone', zone: 'divider' }
  const zone = useDroppable({ id: zoneDndId('divider'), data })
  const ind = useDndUi((s) => (s.indicator?.overId === zoneDndId('divider') ? s.indicator : null))
  return (
    <div ref={zone.setNodeRef} className="group relative my-1 flex h-5 shrink-0 items-center px-2">
      <div className={`h-px flex-1 ${ind ? 'bg-[var(--accent)]' : 'bg-[var(--divider)]'}`} />
      {hasToday && (
        <button
          data-no-dnd
          className="no-drag absolute right-1 rounded-md px-1.5 text-[11px] font-semibold leading-[18px] opacity-0 transition-opacity hover:bg-[var(--row-hover)] group-hover:opacity-100 focus:opacity-100"
          style={{ background: 'var(--field)' }}
          title="Archive all Today tabs (⇧⌘K)"
          onClick={() => invoke('tab.archiveAllToday')}
        >
          ↓ Clear
        </button>
      )}
    </div>
  )
}

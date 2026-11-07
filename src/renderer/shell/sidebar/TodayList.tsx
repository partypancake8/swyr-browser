// The Today section: unpinned tabs and the New Tab row; the whole area below the divider is a drop zone.
import type { ReactNode } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { Plus } from 'lucide-react'
import type { Space, ViewState } from '@shared/types'
import { blankItems, sectionItems } from '@shared/ops'
import { invoke } from '../../common/store'
import { useDndUi, zoneDndId, type DragData } from './dnd'
import { TabRow } from './TabRow'

export function TodayList({ vs, space }: { vs: ViewState; space: Space }): ReactNode {
  const data: DragData = { kind: 'zone', zone: 'today' }
  const zone = useDroppable({ id: zoneDndId('today'), data })
  const zoneOn = useDndUi((s) => s.indicator?.overId === zoneDndId('today'))
  // round 5: a blank window lists only the tabs it owns
  const today = vs.window.blank ? blankItems(vs.state, vs.window.id) : sectionItems(vs.state, space.id, 'today')
  return (
    <div ref={zone.setNodeRef} className={`flex min-h-16 flex-1 flex-col rounded-lg ${zoneOn ? 'bg-[var(--row-hover)]' : ''}`} data-section="today">
      {today.map((it) => (
        <TabRow key={it.id} item={it} depth={0} vs={vs} space={space} />
      ))}
      <button
        data-no-dnd
        className="no-drag flex h-8 shrink-0 items-center gap-2 rounded-lg px-2 text-left hover:bg-[var(--row-hover)]"
        onClick={() => invoke('commandbar.open', { mode: 'new' })}
      >
        <Plus size={16} strokeWidth={1.9} />
        <span className="text-[13px] font-medium">New Tab</span>
      </button>
      <div className="flex-1" />
    </div>
  )
}

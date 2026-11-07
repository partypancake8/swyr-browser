// The space switcher in the sidebar's bottom bar: one button per space, drag to reorder, drop tabs to move them.
import type { ReactNode } from 'react'
import { SortableContext, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Plus } from 'lucide-react'
import type { MenuEntry, Space, ViewState } from '@shared/types'
import { sortedSpaces } from '@shared/ops'
import { gradientCss } from '@shared/theme'
import { SEP, showMenu } from '../../common/menu'
import { invoke } from '../../common/store'
import { justDragged, spaceDndId, useDndUi, type DragData } from './dnd'

export function spaceMenu(space: Space, index: number, count: number): MenuEntry[] {
  return [
    { label: 'Edit Space…', command: 'space.edit', payload: { id: space.id } },
    { label: 'New Space', command: 'space.new' },
    SEP,
    { label: 'Move Left', command: 'space.reorder', payload: { id: space.id, index: index - 1 }, enabled: index > 0 },
    { label: 'Move Right', command: 'space.reorder', payload: { id: space.id, index: index + 1 }, enabled: index < count - 1 },
    SEP,
    { label: 'Delete Space…', command: 'dialog.open', payload: { dialog: 'confirmDeleteSpace', spaceId: space.id }, enabled: count > 1 }
  ]
}

function SpaceButton({ space, index, count, active, dark }: { space: Space; index: number; count: number; active: boolean; dark: boolean }): ReactNode {
  const data: DragData = { kind: 'space', spaceId: space.id }
  const id = spaceDndId(space.id)
  const sortable = useSortable({ id, data })
  const target = useDndUi((s) => s.indicator?.overId === id && s.activeId?.startsWith('item:'))
  const style = { transform: CSS.Translate.toString(sortable.transform), transition: sortable.transition }
  return (
    <button
      ref={sortable.setNodeRef}
      {...sortable.attributes}
      {...sortable.listeners}
      style={style}
      title={`${space.name}${index < 9 ? ` (⌃${index + 1})` : ''}`}
      aria-label={space.name}
      aria-pressed={active}
      className={`no-drag relative flex h-7 min-w-7 shrink-0 items-center justify-center rounded-full px-1 outline-none transition-colors ${
        active ? 'bg-[var(--tile-active)] shadow-sm' : 'hover:bg-[var(--row-hover)]'
      } ${target ? 'ring-2 ring-[var(--accent)]' : ''} ${sortable.isDragging ? 'z-10 opacity-60' : ''}`}
      onClick={() => !justDragged() && invoke('space.switch', { id: space.id })}
      onDoubleClick={() => invoke('space.edit', { id: space.id })}
      onContextMenu={(e) => showMenu(spaceMenu(space, index, count), e)}
      data-space={space.id}
    >
      {space.emoji ? (
        <span className="text-[14px] leading-none" style={{ opacity: active ? 1 : 0.85 }}>
          {space.emoji}
        </span>
      ) : (
        <span
          className="block rounded-full border border-[var(--card-border)]"
          style={{ width: active ? 12 : 9, height: active ? 12 : 9, background: gradientCss({ ...space.theme, angle: 135 }, dark) }}
        />
      )}
      {active && <span className="absolute -bottom-[3px] h-[3px] w-3 rounded-full bg-[var(--fg)]" />}
    </button>
  )
}

export function SpaceSwitcher({ vs, dark }: { vs: ViewState; dark: boolean }): ReactNode {
  const spaces = sortedSpaces(vs.state)
  return (
    <div className="flex min-w-0 flex-1 items-center justify-center gap-1 overflow-x-auto overflow-y-hidden [scrollbar-width:none]" role="tablist" aria-label="Spaces">
      <SortableContext items={spaces.map((s) => spaceDndId(s.id))} strategy={horizontalListSortingStrategy}>
        {spaces.map((s, i) => (
          <SpaceButton key={s.id} space={s} index={i} count={spaces.length} active={s.id === vs.window.activeSpaceId} dark={dark} />
        ))}
      </SortableContext>
      <button
        className="icon-btn !h-7 !w-7 shrink-0"
        title="New space"
        aria-label="New space"
        onClick={async () => {
          const id = await invoke('space.new')
          if (typeof id === 'string') void invoke('space.edit', { id })
        }}
      >
        <Plus size={14} strokeWidth={2} />
      </button>
    </div>
  )
}

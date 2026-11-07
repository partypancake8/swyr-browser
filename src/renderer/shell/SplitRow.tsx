// Split View in the sidebar: one combined row with every pane's favicon and the focused pane's title.
import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import type { Item, ViewState } from '@shared/types'
import { itemTitle } from '@shared/ops'
import { Favicon } from '../common/Favicon'
import { invoke } from '../common/store'
import { splitDragSource } from './SplitDropZones'

/** the item whose page has focus: the focused pane when the active item is a split */
export function focusedItem(vs: ViewState): Item | undefined {
  const { state, window: win } = vs
  const active = state.items.find((i) => i.id === win.activeItemId)
  if (active?.kind === 'split' && active.panes?.itemIds.length) {
    const id = active.panes.itemIds[Math.min(active.panes.itemIds.length - 1, win.focusedPane ?? 0)]
    return state.items.find((i) => i.id === id) ?? active
  }
  return active
}

export function SplitRow({ item, vs }: { item: Item; vs: ViewState }): ReactNode {
  const { state, window: win } = vs
  const ids = item.panes?.itemIds ?? []
  const panes = ids.map((id) => state.items.find((i) => i.id === id)).filter((x): x is Item => Boolean(x))
  const active = item.id === win.activeItemId
  const focusedIdx = Math.min(panes.length - 1, Math.max(0, item.panes?.focused ?? 0))
  const focused = panes[focusedIdx]
  const depth = item.parentId ? 1 : 0
  const title = item.customTitle || (focused ? itemTitle(focused) : itemTitle(item))
  return (
    <div
      className={`group relative flex h-8 shrink-0 items-center gap-2 rounded-lg pr-1 ${active ? 'bg-[var(--row-active)] shadow-sm' : 'hover:bg-[var(--row-hover)]'}`}
      style={{ paddingLeft: 8 + depth * 14 }}
      title={panes.map((p) => itemTitle(p)).join('  |  ')}
      onMouseDown={(e) => {
        if (e.button === 0) void invoke('tab.activate', { id: item.id })
        if (e.button === 1) void invoke('tab.close', { id: item.id })
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        void invoke('tab.contextMenu', { id: item.id })
      }}
      onDoubleClick={() => item.section !== 'today' && invoke('tab.rename', { id: item.id })}
      data-item={item.id}
      data-split={ids.length}
      {...splitDragSource(item.id)}
    >
      <div className="flex shrink-0 items-center gap-[3px] rounded-md bg-[var(--field)] px-[3px] py-[2px]">
        {panes.map((p, i) => (
          <button
            key={p.id}
            className="flex h-5 w-5 items-center justify-center rounded-[5px]"
            style={{ background: active && i === focusedIdx ? 'var(--tile-active)' : 'transparent' }}
            title={itemTitle(p)}
            onMouseDown={(e) => {
              if (e.button !== 0) return
              e.stopPropagation()
              void invoke('split.focus', { itemId: p.id })
            }}
          >
            <Favicon item={p} size={14} />
          </button>
        ))}
      </div>
      <span className="min-w-0 flex-1 truncate text-[13px]" style={{ fontWeight: active ? 600 : 500 }}>
        {title}
      </span>
      <button
        className="hidden h-6 w-6 shrink-0 items-center justify-center rounded-md hover:bg-[var(--row-hover)] group-hover:flex"
        title={item.section === 'today' ? 'Close split (⌘W closes the focused pane)' : 'Unload split'}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          void invoke('tab.close', { id: item.id })
        }}
      >
        <X size={14} strokeWidth={2} />
      </button>
    </div>
  )
}

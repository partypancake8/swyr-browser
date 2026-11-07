// Split View in the sidebar: a split is one row (the sidebar's TabRow) showing every pane's favicon and the focused pane's title.
import type { ReactNode } from 'react'
import type { Item, ViewState } from '@shared/types'
import { itemTitle } from '@shared/ops'
import { Favicon } from '../common/Favicon'
import { invoke } from '../common/store'

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

function splitPanes(item: Item, vs: ViewState): { panes: Item[]; focusedIdx: number } {
  const ids = item.panes?.itemIds ?? []
  const panes = ids.map((id) => vs.state.items.find((i) => i.id === id)).filter((x): x is Item => Boolean(x))
  const focusedIdx = Math.min(panes.length - 1, Math.max(0, item.panes?.focused ?? 0))
  return { panes, focusedIdx }
}

/** the row title of a split: its custom title, else the focused pane's title */
export function splitTitle(item: Item, vs: ViewState): string {
  const { panes, focusedIdx } = splitPanes(item, vs)
  const focused = panes[focusedIdx]
  return item.customTitle || (focused ? itemTitle(focused) : itemTitle(item))
}

/** tooltip of a split row: every pane title */
export function splitTooltip(item: Item, vs: ViewState): string {
  return splitPanes(item, vs)
    .panes.map((p) => itemTitle(p))
    .join('  |  ')
}

/** the favicon cluster of a split row; clicking a favicon focuses that pane */
export function SplitIcons({ item, vs }: { item: Item; vs: ViewState }): ReactNode {
  const { panes, focusedIdx } = splitPanes(item, vs)
  const active = item.id === vs.window.activeItemId
  return (
    <div className="flex shrink-0 items-center gap-[3px] rounded-md bg-[var(--field)] px-[3px] py-[2px]">
      {panes.map((p, i) => (
        <button
          key={p.id}
          data-no-dnd
          className="flex h-5 w-5 items-center justify-center rounded-[5px]"
          style={{ background: active && i === focusedIdx ? 'var(--tile-active)' : 'transparent' }}
          title={itemTitle(p)}
          onPointerDown={(e) => e.stopPropagation()}
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
  )
}

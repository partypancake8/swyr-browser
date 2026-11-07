// Sidebar drag and drop: droppable ids, collision rules, and the drop target computed from the pointer.
import { pointerWithin, closestCenter, type CollisionDetection } from '@dnd-kit/core'
import { create } from 'zustand'
import type { Item, PersistedState, Section, Space } from '@shared/types'
import { childrenOf, isWithin, siblingsOf } from '@shared/ops'

/** the type a native drag carries (for drop zones outside the sidebar, such as split view) */
export const ITEM_MIME = 'application/x-swyr-item'

export type DragData =
  | { kind: 'item'; itemId: string }
  | { kind: 'space'; spaceId: string }
  | { kind: 'zone'; zone: 'favorites' | 'pinned' | 'today' | 'divider' }

export const itemDndId = (id: string): string => `item:${id}`
export const spaceDndId = (id: string): string => `space:${id}`
export const zoneDndId = (zone: string): string => `zone:${zone}`

export type DropPosition = 'before' | 'after' | 'inside'

export interface Indicator {
  /** dnd id of the row, tile, space or zone under the pointer */
  overId: string
  position: DropPosition
  /** indent of the drop line, in nesting levels */
  depth: number
}

export interface MoveDrop {
  type: 'move'
  section: Section
  parentId: string | null
  index?: number
  spaceId?: string
}

export interface SpaceDrop {
  type: 'space'
  spaceId: string
}

export type Drop = MoveDrop | SpaceDrop

interface DndUi {
  indicator: Indicator | null
  /** dnd id of the dragged row, tile or space */
  activeId: string | null
  /** when the last drag ended, so the click that follows a drop can be ignored */
  endedAt: number
}

/** sidebar-local drag state (rows subscribe to their own indicator) */
export const useDndUi = create<DndUi>(() => ({ indicator: null, activeId: null, endedAt: 0 }))

export const justDragged = (): boolean => Date.now() - useDndUi.getState().endedAt < 250

const dataOf = (x: { data: { current?: unknown } }): DragData | undefined => x.data.current as DragData | undefined

/**
 * Pointer-based collisions. A space drag only sees other spaces. An item drag prefers, in order:
 * space buttons, rows and tiles (never itself), then section zones.
 */
export const sidebarCollision: CollisionDetection = (args) => {
  const active = dataOf(args.active)
  if (active?.kind === 'space') {
    const spaces = args.droppableContainers.filter((c) => dataOf(c)?.kind === 'space')
    return closestCenter({ ...args, droppableContainers: spaces })
  }
  const hits = pointerWithin(args)
  if (!hits.length) return []
  const rank = (id: string | number): number => {
    const c = args.droppableContainers.find((x) => x.id === id)
    const d = c ? dataOf(c) : undefined
    if (!d) return 9
    if (d.kind === 'space') return 0
    if (d.kind === 'item') return active?.kind === 'item' && d.itemId === active.itemId ? 9 : 1
    if (d.kind === 'zone') return d.zone === 'divider' ? 2 : d.zone === 'favorites' ? 3 : 4
    return 9
  }
  const ranked = hits.filter((h) => rank(h.id) < 9).sort((a, b) => rank(a.id) - rank(b.id))
  return ranked.slice(0, 1)
}

export interface OverInfo {
  data: DragData
  /** pointer position inside the hovered rect, 0..1 */
  fx: number
  fy: number
}

function indexAmong(s: PersistedState, target: Item, movingId: string): number {
  const sibs = siblingsOf(s, target).filter((i) => i.id !== movingId)
  const i = sibs.findIndex((x) => x.id === target.id)
  return i < 0 ? sibs.length : i
}

function depth(s: PersistedState, item: Item): number {
  let d = 0
  let pid = item.parentId
  while (pid && d < 32) {
    const p = s.items.find((i) => i.id === pid)
    if (!p) break
    d++
    pid = p.parentId
  }
  return d
}

/** where a dragged item lands for a given hover, plus the indicator to draw; null when the drop is not allowed */
export function computeDrop(s: PersistedState, space: Space, moving: Item, over: OverInfo, overDndId: string): { drop: Drop; indicator: Indicator } | null {
  const d = over.data
  const isFolder = moving.kind === 'folder'
  if (d.kind === 'space') {
    if (d.spaceId === space.id && moving.section !== 'favorites') return null
    return { drop: { type: 'space', spaceId: d.spaceId }, indicator: { overId: overDndId, position: 'inside', depth: 0 } }
  }
  if (d.kind === 'zone') {
    if (d.zone === 'favorites') {
      if (isFolder) return null
      return { drop: { type: 'move', section: 'favorites', parentId: null }, indicator: { overId: overDndId, position: 'inside', depth: 0 } }
    }
    if (d.zone === 'pinned') return { drop: { type: 'move', section: 'pinned', parentId: null }, indicator: { overId: overDndId, position: 'inside', depth: 0 } }
    if (d.zone === 'divider') {
      if (over.fy < 0.5 || isFolder) return { drop: { type: 'move', section: 'pinned', parentId: null }, indicator: { overId: overDndId, position: 'before', depth: 0 } }
      return { drop: { type: 'move', section: 'today', parentId: null, index: 0 }, indicator: { overId: overDndId, position: 'after', depth: 0 } }
    }
    if (isFolder) return null
    return { drop: { type: 'move', section: 'today', parentId: null }, indicator: { overId: overDndId, position: 'inside', depth: 0 } }
  }
  const target = s.items.find((i) => i.id === d.itemId)
  if (!target || target.id === moving.id) return null
  if (isFolder && isWithin(s, target.id, moving.id)) return null
  if (target.section === 'favorites') {
    if (isFolder) return null
    const after = over.fx > 0.5
    const index = indexAmong(s, target, moving.id) + (after ? 1 : 0)
    return { drop: { type: 'move', section: 'favorites', parentId: null, index }, indicator: { overId: overDndId, position: after ? 'after' : 'before', depth: 0 } }
  }
  if (target.kind === 'folder') {
    const open = !target.collapsed && childrenOf(s, target.id).length > 0
    if (over.fy > 0.28 && over.fy < 0.72) {
      return { drop: { type: 'move', section: 'pinned', parentId: target.id }, indicator: { overId: overDndId, position: 'inside', depth: depth(s, target) } }
    }
    if (over.fy >= 0.72 && open) {
      return { drop: { type: 'move', section: 'pinned', parentId: target.id, index: 0 }, indicator: { overId: overDndId, position: 'after', depth: depth(s, target) + 1 } }
    }
  }
  if (isFolder && target.section === 'today') return null
  const after = over.fy >= 0.5
  const index = indexAmong(s, target, moving.id) + (after ? 1 : 0)
  return {
    drop: { type: 'move', section: target.section, parentId: target.parentId, index },
    indicator: { overId: overDndId, position: after ? 'after' : 'before', depth: depth(s, target) }
  }
}

/** the command payload for a drop */
export function dropCommand(moving: Item, drop: Drop, space: Space): { command: string; payload: Record<string, unknown> } | null {
  if (drop.type === 'space') {
    const section: Section = moving.section === 'favorites' || moving.kind === 'folder' ? 'pinned' : moving.section
    return { command: 'tab.move', payload: { itemId: moving.id, section, parentId: null, spaceId: drop.spaceId } }
  }
  const payload: Record<string, unknown> = { itemId: moving.id, section: drop.section, parentId: drop.parentId }
  if (drop.index !== undefined) payload.index = drop.index
  if (drop.section !== 'favorites') payload.spaceId = space.id
  return { command: 'tab.move', payload }
}

// The sidebar: window controls row, URL field, Favorites, Pinned, Today, bottom bar with the space switcher.
import { useEffect, useRef, useState, type ReactNode, type WheelEvent } from 'react'
import {
  DndContext,
  DragOverlay,
  MeasuringStrategy,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  type DragStartEvent,
  type PointerSensorOptions
} from '@dnd-kit/core'
import { ArrowLeft, ArrowRight, Download, Folder, History, Paintbrush, PanelLeft, RotateCw, SlidersHorizontal, X } from 'lucide-react'
import type { Item, ViewState } from '@shared/types'
import { itemTitle, windowSpaces } from '@shared/ops'
import { displayUrl } from '@shared/url'
import { isDark } from '@shared/theme'
import { Favicon } from '../common/Favicon'
import { SEP, showMenu } from '../common/menu'
import { invoke, useView } from '../common/store'
import { activeSpace } from '../common/theme'
import { computeDrop, dropCommand, sidebarCollision, useDndUi, type Drop, type DragData } from './sidebar/dnd'
import { FavoritesGrid } from './sidebar/FavoritesGrid'
import { Divider, PinnedList } from './sidebar/PinnedList'
import { TodayList } from './sidebar/TodayList'
import { SpaceSwitcher } from './sidebar/SpaceSwitcher'
import { focusedItem } from './SplitRow'
import { MediaBar } from './MediaBar'
import { ExtensionActions } from './urlrow/ExtensionActions'

/** pointer drags start after 5 px; Option-drags and drags from inputs or buttons marked data-no-dnd are left alone */
class SidebarPointerSensor extends PointerSensor {
  static activators = [
    {
      eventName: 'onPointerDown' as const,
      handler: ({ nativeEvent: e }: { nativeEvent: PointerEvent }, { onActivation }: PointerSensorOptions): boolean => {
        if (!e.isPrimary || e.button !== 0 || e.altKey) return false
        const el = e.target as HTMLElement | null
        if (el?.closest('input, textarea, select, [data-no-dnd]')) return false
        onActivation?.({ event: e })
        return true
      }
    }
  ]
}

const SWIPE_THRESHOLD = 110
const SWIPE_QUIET_MS = 220
const SWIPE_MIN_GAP_MS = 380

export function Sidebar({ vs, peek = false }: { vs: ViewState; peek?: boolean }): ReactNode {
  const { state, window: win } = vs
  const space = activeSpace(vs)
  const active = focusedItem(vs)
  const rt = active ? win.tabs[active.id] : undefined
  const dark = space ? isDark(space.theme, vs.systemDark) : vs.systemDark
  const spaces = windowSpaces(state, win.activeSpaceId)
  const spaceIndex = spaces.findIndex((s) => s.id === space?.id)

  // ----- space switch animation: slide from the side the new space sits on
  const [anim, setAnim] = useState({ spaceId: space?.id ?? '', index: spaceIndex, dir: 0 })
  if (space && anim.spaceId !== space.id) {
    setAnim({ spaceId: space.id, index: spaceIndex, dir: spaceIndex >= anim.index ? 1 : -1 })
  }

  // ----- two-finger horizontal swipe: accumulate deltaX, one switch per gesture, follow the fingers a little
  const swipe = useRef({ acc: 0, last: 0, locked: false, lockedAt: 0 })
  const [offset, setOffset] = useState(0)
  const settle = useRef<number | null>(null)
  useEffect(() => () => {
    if (settle.current) window.clearTimeout(settle.current)
  }, [])
  const onWheel = (e: WheelEvent): void => {
    const now = performance.now()
    const g = swipe.current
    if (now - g.last > SWIPE_QUIET_MS) {
      g.acc = 0
      if (now - g.lockedAt > SWIPE_MIN_GAP_MS) g.locked = false
    }
    g.last = now
    if (settle.current) window.clearTimeout(settle.current)
    settle.current = window.setTimeout(() => {
      swipe.current.acc = 0
      setOffset(0)
    }, SWIPE_QUIET_MS)
    if (g.locked) return
    if (Math.abs(e.deltaX) < 1.2 * Math.abs(e.deltaY)) return
    if (spaces.length < 2) return
    g.acc += e.deltaX
    setOffset(Math.max(-28, Math.min(28, -g.acc * 0.22)))
    if (Math.abs(g.acc) >= SWIPE_THRESHOLD) {
      void invoke(g.acc > 0 ? 'space.next' : 'space.prev')
      g.locked = true
      g.lockedAt = now
      g.acc = 0
      setOffset(0)
    }
  }

  // ----- drag and drop
  const sensors = useSensors(useSensor(SidebarPointerSensor, { activationConstraint: { distance: 5 } }))
  const start = useRef({ x: 0, y: 0 })
  const lastDrop = useRef<Drop | null>(null)
  const pointer = useRef({ x: 0, y: 0 })
  const expandTimer = useRef<{ id: string; timer: number } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState<DragData | null>(null)

  const clearExpand = (): void => {
    if (expandTimer.current) window.clearTimeout(expandTimer.current.timer)
    expandTimer.current = null
  }
  const resetDrag = (): void => {
    clearExpand()
    lastDrop.current = null
    setDragging(null)
    useDndUi.setState({ indicator: null, activeId: null, endedAt: Date.now() })
    useView.setState({ draggingItemId: null })
  }

  const onDragStart = (e: DragStartEvent): void => {
    const ev = e.activatorEvent as PointerEvent
    start.current = { x: ev.clientX, y: ev.clientY }
    pointer.current = { ...start.current }
    const data = e.active.data.current as DragData | undefined
    setDragging(data ?? null)
    useDndUi.setState({ activeId: String(e.active.id), indicator: null })
    if (data?.kind === 'item') {
      useView.setState({ draggingItemId: data.itemId })
      window.dispatchEvent(new CustomEvent('swyr:item-drag', { detail: { itemId: data.itemId } }))
    }
  }

  /** recompute the drop target and indicator; `over` from dnd-kit can lag one move behind, so onDragOver and onDragEnd also call this */
  const track = (e: DragMoveEvent | DragOverEvent | DragEndEvent): Drop | null => {
    const data = e.active.data.current as DragData | undefined
    if (data?.kind !== 'item' || !space) return null
    const moving = state.items.find((i) => i.id === data.itemId)
    const over = e.over
    if (!moving || !over || !over.data.current) {
      lastDrop.current = null
      clearExpand()
      if (useDndUi.getState().indicator) useDndUi.setState({ indicator: null })
      return null
    }
    const r = over.rect
    const fx = r.width ? (pointer.current.x - r.left) / r.width : 0.5
    const fy = r.height ? (pointer.current.y - r.top) / r.height : 0.5
    const res = computeDrop(state, space, moving, { data: over.data.current as DragData, fx, fy }, String(over.id))
    lastDrop.current = res?.drop ?? null
    const prev = useDndUi.getState().indicator
    const next = res?.indicator ?? null
    if (prev?.overId !== next?.overId || prev?.position !== next?.position || prev?.depth !== next?.depth) useDndUi.setState({ indicator: next })
    // hovering a collapsed folder opens it
    const target = res?.drop.type === 'move' && res.indicator.position === 'inside' ? res.drop.parentId : null
    const folder = target ? state.items.find((i) => i.id === target) : undefined
    if (folder?.collapsed) {
      if (expandTimer.current?.id !== folder.id) {
        clearExpand()
        expandTimer.current = { id: folder.id, timer: window.setTimeout(() => void invoke('folder.toggle', { itemId: folder.id, collapsed: false }), 650) }
      }
    } else clearExpand()
    return lastDrop.current
  }

  const onDragMove = (e: DragMoveEvent): void => {
    pointer.current = { x: start.current.x + e.delta.x, y: start.current.y + e.delta.y }
    track(e)
  }

  const onDragEnd = (e: DragEndEvent): void => {
    const data = e.active.data.current as DragData | undefined
    pointer.current = { x: start.current.x + e.delta.x, y: start.current.y + e.delta.y }
    const drop = data?.kind === 'item' ? track(e) : null
    if (data?.kind === 'space') {
      const overData = e.over?.data.current as DragData | undefined
      if (overData?.kind === 'space' && overData.spaceId !== data.spaceId) {
        const index = spaces.findIndex((s) => s.id === overData.spaceId)
        if (index >= 0) void invoke('space.reorder', { id: data.spaceId, index })
      }
    } else if (data?.kind === 'item' && space) {
      const moving = state.items.find((i) => i.id === data.itemId)
      const cmd = moving && drop ? dropCommand(moving, drop, space) : null
      if (cmd) void invoke(cmd.command, cmd.payload)
      else if (!e.over) {
        // dropped outside the sidebar, e.g. on the page: drop zones elsewhere (split view) can take it
        const width = rootRef.current?.getBoundingClientRect().right ?? 0
        if (pointer.current.x > width) {
          window.dispatchEvent(new CustomEvent('swyr:item-drop', { detail: { itemId: data.itemId, clientX: pointer.current.x, clientY: pointer.current.y } }))
        }
      }
    }
    resetDrag()
  }

  const dragItem = dragging?.kind === 'item' ? state.items.find((i) => i.id === dragging.itemId) : undefined
  const dragSpace = dragging?.kind === 'space' ? state.spaces.find((s) => s.id === dragging.spaceId) : undefined

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={sidebarCollision}
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragOver={track}
      onDragEnd={onDragEnd}
      onDragCancel={resetDrag}
    >
      <div ref={rootRef} data-sidebar-root className="flex h-full flex-col px-2 pb-2" onWheel={onWheel}>
        <div className="drag flex h-10 shrink-0 items-center gap-0.5" style={{ paddingLeft: win.fullscreen ? 2 : 72 }}>
          <button className="icon-btn" title="Hide sidebar (⌘S)" onClick={() => invoke('sidebar.toggle')}>
            <PanelLeft size={16} strokeWidth={1.9} />
          </button>
          <div className="flex-1" />
          {space?.incognito && <span className="rounded-md bg-[#17181c] px-1.5 py-0.5 text-[11px] font-bold text-white">Private</span>}
          <button className="icon-btn" title="Back (⌘[)" disabled={!rt?.canGoBack} onClick={() => invoke('tab.back')}>
            <ArrowLeft size={16} strokeWidth={1.9} />
          </button>
          <button className="icon-btn" title="Forward (⌘])" disabled={!rt?.canGoForward} onClick={() => invoke('tab.forward')}>
            <ArrowRight size={16} strokeWidth={1.9} />
          </button>
          <button
            className="icon-btn"
            title={rt?.loading ? 'Stop (⌘.)' : 'Reload (⌘R)'}
            disabled={!active}
            onClick={() => invoke(rt?.loading ? 'tab.stop' : 'tab.reload')}
          >
            {rt?.loading ? <X size={16} strokeWidth={1.9} /> : <RotateCw size={15} strokeWidth={1.9} />}
          </button>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <UrlField item={active} loading={Boolean(rt?.loading)} />
          {/* round 3a: Styles and Site Settings for the active site */}
          {active && /^(https?|file):/i.test(active.url) && (
            <>
              <button className="icon-btn no-drag !h-9 !w-8 shrink-0" title="Styles for this site" data-testid="url-styles" onClick={() => invoke('style.panel')}>
                <Paintbrush size={15} strokeWidth={1.9} />
              </button>
              <button className="icon-btn no-drag !h-9 !w-8 shrink-0" title="Site Settings" data-testid="url-site-settings" onClick={() => invoke('siteSettings.open')}>
                <SlidersHorizontal size={15} strokeWidth={1.9} />
              </button>
            </>
          )}
        </div>
        <ExtensionActions vs={vs} />

        <div
          className="mt-2 flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden"
          onContextMenu={(e) =>
            showMenu(
              [
                { label: 'New Tab', command: 'commandbar.open', payload: { mode: 'new' } },
                { label: 'New Folder', command: 'folder.new', payload: { name: 'New Folder', rename: true } },
                SEP,
                { label: 'New Space', command: 'space.new' },
                { label: 'Edit Space…', command: 'space.edit', payload: { id: space?.id } },
                SEP,
                { label: 'Archive All Today Tabs', command: 'tab.archiveAllToday' },
                { label: 'Open Library', command: 'library.open' }
              ],
              e
            )
          }
        >
          {space && (
            <div
              key={anim.spaceId}
              className={`flex min-h-full flex-col ${anim.dir > 0 ? 'space-in-next' : anim.dir < 0 ? 'space-in-prev' : ''}`}
              style={{ transform: offset ? `translateX(${offset}px)` : undefined, transition: offset ? 'none' : 'transform 0.2s ease-out' }}
            >
              <FavoritesGrid vs={vs} space={space} />
              <PinnedList vs={vs} space={space} />
              <Divider hasToday={vs.state.items.some((i) => i.spaceId === space.id && i.section === 'today')} />
              <TodayList vs={vs} space={space} />
            </div>
          )}
        </div>

        <MediaBar vs={vs} />
        <div className="flex h-10 shrink-0 items-center gap-1 pt-1">
          <button className="icon-btn" title="Archive" onClick={() => invoke('archive.open')} onContextMenu={(e) => showMenu([{ label: 'Open Library', command: 'library.open' }], e)}>
            <History size={16} strokeWidth={1.9} />
          </button>
          <SpaceSwitcher vs={vs} dark={dark} />
          <button className="icon-btn" title="Downloads" onClick={() => invoke('downloads.open')}>
            <Download size={16} strokeWidth={1.9} />
          </button>
        </div>
        {peek && <div className="sr-only">sidebar preview</div>}
      </div>
      <DragOverlay dropAnimation={null}>
        {dragItem ? <DragGhost item={dragItem} /> : dragSpace ? <div className="flex h-7 min-w-7 items-center justify-center rounded-full bg-[var(--tile-active)] px-1 text-[14px] shadow-lg">{dragSpace.emoji || '•'}</div> : null}
      </DragOverlay>
    </DndContext>
  )
}

function DragGhost({ item }: { item: Item }): ReactNode {
  if (item.section === 'favorites') {
    return (
      <div className="flex h-11 w-14 items-center justify-center rounded-[10px] bg-[var(--card)] shadow-lg ring-1 ring-[var(--card-border)]">
        <Favicon item={item} size={20} />
      </div>
    )
  }
  return (
    <div className="flex h-8 w-[220px] items-center gap-2 rounded-lg bg-[var(--card)] px-2 shadow-lg ring-1 ring-[var(--card-border)]">
      {item.kind === 'folder' ? <Folder size={16} strokeWidth={1.9} /> : <Favicon item={item} size={16} />}
      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{itemTitle(item)}</span>
    </div>
  )
}

function UrlField({ item, loading }: { item: Item | undefined; loading: boolean }): ReactNode {
  const text = item ? (item.url.startsWith('swyr://newtab') ? 'Search or enter URL' : displayUrl(item.url)) : 'Search or enter URL'
  return (
    <button
      className="no-drag relative flex h-9 w-full min-w-0 flex-1 items-center gap-2 overflow-hidden rounded-[10px] bg-[var(--field)] px-2.5 text-left hover:brightness-[1.02]"
      title={item?.url}
      onClick={() => invoke('commandbar.open', { mode: 'current' })}
    >
      {item && !item.url.startsWith('swyr://newtab') ? <Favicon item={item} size={14} /> : null}
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{text}</span>
      {loading && (
        <span className="absolute inset-x-0 bottom-0 h-[2px] overflow-hidden">
          <span className="loading-bar block h-full w-2/5 rounded-full bg-[var(--accent)]" />
        </span>
      )}
    </button>
  )
}

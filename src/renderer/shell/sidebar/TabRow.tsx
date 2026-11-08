// One tab row in the Pinned or Today list: favicon, title, back-to-pinned, close, loading bar, drop line.
import { useCallback, useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { CornerUpLeft, X } from 'lucide-react'
import type { Item, MenuEntry, Space, ViewState } from '@shared/types'
import { awayFromPinned, itemTitle, windowSpaces } from '@shared/ops'
import { Favicon } from '../../common/Favicon'
import { SEP, showMenu } from '../../common/menu'
import { invoke } from '../../common/store'
import { ITEM_MIME, itemDndId, useDndUi, type DragData, type Indicator } from './dnd'
import { SplitIcons, splitTitle, splitTooltip } from '../SplitRow'

export const ROW_INDENT = 16

/** draggable + droppable wiring shared by tab rows, folder rows and favorite tiles */
export function useItemDnd(item: Item): {
  ref: (el: HTMLElement | null) => void
  attributes: Record<string, unknown>
  listeners: Record<string, unknown> | undefined
  isDragging: boolean
  indicator: Indicator | null
  nativeDrag: { draggable: true; onDragStart: (e: DragEvent) => void }
} {
  const id = itemDndId(item.id)
  const data: DragData = { kind: 'item', itemId: item.id }
  const drag = useDraggable({ id, data })
  const drop = useDroppable({ id, data })
  const { setNodeRef: setDragRef } = drag
  const { setNodeRef: setDropRef } = drop
  const ref = useCallback(
    (el: HTMLElement | null) => {
      setDragRef(el)
      setDropRef(el)
    },
    [setDragRef, setDropRef]
  )
  const indicator = useDndUi((s) => (s.indicator?.overId === id ? s.indicator : null))
  const url = item.url
  const itemId = item.id
  const onDragStart = useCallback(
    (e: DragEvent) => {
      // plain drags belong to dnd-kit; an Option-drag is a native drag other drop zones (split view, other apps) can read
      if (!e.altKey) {
        e.preventDefault()
        return
      }
      e.dataTransfer.setData(ITEM_MIME, itemId)
      if (url && !url.startsWith('swyr:')) {
        e.dataTransfer.setData('text/uri-list', url)
        e.dataTransfer.setData('text/plain', url)
      }
      e.dataTransfer.effectAllowed = 'copyMove'
    },
    [itemId, url]
  )
  return {
    ref,
    attributes: drag.attributes as unknown as Record<string, unknown>,
    listeners: drag.listeners as Record<string, unknown> | undefined,
    isDragging: drag.isDragging,
    indicator,
    nativeDrag: { draggable: true, onDragStart }
  }
}

export function DropLine({ indicator, depth }: { indicator: Indicator | null; depth: number }): ReactNode {
  if (!indicator || indicator.position === 'inside') return null
  const left = 8 + (indicator.depth ?? depth) * ROW_INDENT
  return <span className="drop-line" style={indicator.position === 'before' ? { top: -1, left } : { bottom: -1, left }} />
}

/** the shared right-click menu for a tab (rows and favorite tiles) */
export function tabMenu(item: Item, vs: ViewState, space: Space | undefined): MenuEntry[] {
  const s = vs.state
  const others = windowSpaces(s, vs.window.activeSpaceId).filter((x) => x.id !== (item.spaceId ?? space?.id))
  const folders = space ? s.items.filter((i) => i.kind === 'folder' && i.spaceId === space.id && i.id !== item.parentId) : []
  const fav = item.section === 'favorites'
  const entries: (MenuEntry | false)[] = [
    fav && { label: 'Open', command: 'tab.activate', payload: { id: item.id } },
    { label: 'Rename…', command: 'tab.rename', payload: { itemId: item.id } },
    awayFromPinned(item) && { label: 'Go Back to Pinned URL', command: 'tab.resetToPinnedUrl', payload: { itemId: item.id } },
    SEP,
    item.section === 'today' && { label: 'Pin', command: 'tab.pin', payload: { itemId: item.id } },
    item.section === 'pinned' && { label: 'Unpin', command: 'tab.unpin', payload: { itemId: item.id } },
    fav
      ? { label: 'Remove from Favorites', command: 'tab.unfavorite', payload: { itemId: item.id } }
      : { label: 'Add to Favorites', command: 'tab.favorite', payload: { itemId: item.id } },
    !fav && {
      label: 'Move to Folder',
      submenu: [
        ...folders.map((f) => ({ label: itemTitle(f), command: 'tab.move', payload: { itemId: item.id, section: 'pinned', parentId: f.id } })),
        ...(folders.length ? [SEP] : []),
        { label: 'New Folder', command: 'folder.new', payload: { name: 'New Folder', itemIds: [item.id], rename: true } },
        ...(item.parentId ? [{ label: 'Out of Folder', command: 'tab.move', payload: { itemId: item.id, section: 'pinned', parentId: null } }] : [])
      ]
    },
    !fav &&
      others.length > 0 && {
        label: 'Move to Space',
        submenu: others.map((x) => ({
          label: `${x.emoji ? x.emoji + '  ' : ''}${x.name}`,
          command: 'tab.move',
          payload: { itemId: item.id, section: item.section, parentId: null, spaceId: x.id }
        }))
      },
    SEP,
    { label: 'Duplicate', command: 'tab.duplicate', payload: { id: item.id } },
    { label: 'Copy URL', command: 'item.copyUrl', payload: { itemId: item.id } },
    SEP,
    item.section === 'today'
      ? { label: 'Archive Tab', command: 'tab.close', payload: { id: item.id } }
      : { label: 'Archive', command: 'tab.close', payload: { id: item.id, remove: true } }
  ]
  return entries.filter((x): x is MenuEntry => Boolean(x))
}

export function TabRow({ item, depth, vs, space }: { item: Item; depth: number; vs: ViewState; space: Space | undefined }): ReactNode {
  const win = vs.window
  const active = item.id === win.activeItemId
  const renaming = win.renamingItemId === item.id
  const loaded = win.loaded.includes(item.id)
  const loading = Boolean(win.tabs[item.id]?.loading) && loaded
  const away = awayFromPinned(item)
  const dnd = useItemDnd(item)
  const split = item.kind === 'split'
  const showClose = item.section === 'today' || loaded || split
  const title = split ? splitTitle(item, vs) : itemTitle(item)
  return (
    <div
      ref={dnd.ref}
      {...dnd.attributes}
      {...dnd.listeners}
      {...(renaming ? {} : dnd.nativeDrag)}
      role="button"
      tabIndex={-1}
      className={`group no-drag relative flex h-8 shrink-0 items-center gap-2 rounded-lg pr-1 outline-none ${
        active ? 'bg-[var(--row-active)] shadow-sm' : 'hover:bg-[var(--row-hover)]'
      } ${dnd.isDragging ? 'opacity-40' : ''}`}
      style={{ paddingLeft: 8 + depth * ROW_INDENT }}
      onMouseDown={(e) => {
        if (e.button === 0 && !renaming) void invoke('tab.activate', { id: item.id })
        if (e.button === 1) void invoke('tab.close', { id: item.id })
      }}
      onContextMenu={(e) => showMenu(tabMenu(item, vs, space), e)}
      onDoubleClick={() => !renaming && invoke('tab.rename', { itemId: item.id })}
      data-item={item.id}
      data-item-id={item.id}
      data-section={item.section}
      data-depth={depth}
      data-split={split ? (item.panes?.itemIds.length ?? 0) : undefined}
      title={renaming ? undefined : split ? splitTooltip(item, vs) : title}
    >
      {split ? (
        <SplitIcons item={item} vs={vs} />
      ) : (
        <span className="relative flex shrink-0" style={{ opacity: loaded || active ? 1 : 0.8 }}>
          <Favicon item={item} size={16} />
        </span>
      )}
      {renaming ? (
        <RenameInput item={item} />
      ) : (
        <span className="min-w-0 flex-1 truncate text-[13px] leading-none" style={{ fontWeight: active ? 600 : 500 }}>
          {title}
        </span>
      )}
      {!renaming && away && (
        <button
          data-no-dnd
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md hover:bg-[var(--row-hover)]"
          title="Back to pinned URL"
          aria-label="Back to pinned URL"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            void invoke('tab.resetToPinnedUrl', { itemId: item.id })
          }}
        >
          <CornerUpLeft size={14} strokeWidth={2} />
        </button>
      )}
      {!renaming && showClose && (
        <button
          data-no-dnd
          className="hidden h-6 w-6 shrink-0 items-center justify-center rounded-md hover:bg-[var(--row-hover)] group-hover:flex"
          title={split ? (item.section === 'today' ? 'Close split (⌘W closes the focused pane)' : 'Unload split') : item.section === 'today' ? 'Archive tab (⌘W)' : 'Unload tab'}
          aria-label={item.section === 'today' ? 'Archive tab' : 'Unload tab'}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            void invoke('tab.close', { id: item.id })
          }}
        >
          <X size={14} strokeWidth={2} />
        </button>
      )}
      {loading && (
        <span className="pointer-events-none absolute inset-x-2 bottom-[2px] h-[2px] overflow-hidden rounded-full">
          <span className="loading-bar block h-full w-2/5 rounded-full bg-[var(--accent)]" />
        </span>
      )}
      <DropLine indicator={dnd.indicator} depth={depth} />
    </div>
  )
}

export function RenameInput({ item }: { item: Item }): ReactNode {
  const ref = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState(itemTitle(item))
  const done = useRef(false)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])
  const finish = (title: string | null): void => {
    if (done.current) return
    done.current = true
    void invoke('tab.rename', title === null ? { itemId: item.id, cancel: true } : { itemId: item.id, title })
  }
  return (
    <input
      ref={ref}
      data-no-dnd
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') finish(value)
        if (e.key === 'Escape') finish(null)
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={() => finish(value)}
      aria-label="Name"
      className="min-w-0 flex-1 rounded-md bg-[var(--card)] px-1.5 py-0.5 text-[13px] outline-none ring-1 ring-[var(--accent)]"
    />
  )
}

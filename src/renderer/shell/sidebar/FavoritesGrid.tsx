// Favorites: a grid of icon tiles (4 per row), shared by every space of a profile.
import type { ReactNode } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { CornerUpLeft } from 'lucide-react'
import type { Item, MenuEntry, Space, ViewState } from '@shared/types'
import { awayFromPinned, favoritesFor, itemTitle } from '@shared/ops'
import { Favicon } from '../../common/Favicon'
import { SEP, showMenu } from '../../common/menu'
import { invoke } from '../../common/store'
import { useDndUi, zoneDndId, type DragData } from './dnd'
import { useItemDnd } from './TabRow'

function favoriteMenu(item: Item): MenuEntry[] {
  return [
    { label: 'Open', command: 'tab.activate', payload: { id: item.id } },
    { label: 'Rename…', command: 'tab.rename', payload: { itemId: item.id } },
    ...(awayFromPinned(item) ? [{ label: 'Go Back to Pinned URL', command: 'tab.resetToPinnedUrl', payload: { itemId: item.id } }] : []),
    SEP,
    { label: 'Remove from Favorites', command: 'tab.unfavorite', payload: { itemId: item.id } },
    { label: 'Copy URL', command: 'item.copyUrl', payload: { itemId: item.id } },
    SEP,
    { label: 'Unload', command: 'tab.close', payload: { id: item.id }, enabled: true }
  ]
}

function Tile({ item, vs }: { item: Item; vs: ViewState }): ReactNode {
  const win = vs.window
  const active = item.id === win.activeItemId
  const loaded = win.loaded.includes(item.id)
  const loading = loaded && Boolean(win.tabs[item.id]?.loading)
  const away = awayFromPinned(item)
  const dnd = useItemDnd(item)
  const ind = dnd.indicator
  return (
    <div
      ref={dnd.ref}
      {...dnd.attributes}
      {...dnd.listeners}
      {...dnd.nativeDrag}
      role="button"
      tabIndex={-1}
      title={itemTitle(item)}
      aria-label={itemTitle(item)}
      className={`no-drag relative flex h-11 items-center justify-center rounded-[10px] outline-none ${
        active ? 'bg-[var(--tile-active)] shadow-sm' : 'bg-[var(--tile)] hover:bg-[var(--row-active)]'
      } ${dnd.isDragging ? 'opacity-40' : ''}`}
      onMouseDown={(e) => {
        if (e.button === 0) void invoke('tab.activate', { id: item.id })
      }}
      onContextMenu={(e) => showMenu(favoriteMenu(item), e)}
      data-item={item.id} data-item-id={item.id}
      data-section="favorites"
    >
      <span style={{ opacity: loaded || active ? 1 : 0.8 }}>
        <Favicon item={item} size={20} />
      </span>
      {away && (
        <button
          data-no-dnd
          className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--card)] shadow-sm"
          title="Back to pinned URL"
          aria-label="Back to pinned URL"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            void invoke('tab.resetToPinnedUrl', { itemId: item.id })
          }}
        >
          <CornerUpLeft size={10} strokeWidth={2.4} />
        </button>
      )}
      {loading && (
        <span className="pointer-events-none absolute inset-x-2 bottom-1 h-[2px] overflow-hidden rounded-full">
          <span className="loading-bar block h-full w-2/5 rounded-full bg-[var(--accent)]" />
        </span>
      )}
      {ind && ind.position !== 'inside' && (
        <span className="pointer-events-none absolute inset-y-1 w-[2px] rounded-full bg-[var(--accent)]" style={ind.position === 'before' ? { left: -4 } : { right: -4 }} />
      )}
    </div>
  )
}

export function FavoritesGrid({ vs, space }: { vs: ViewState; space: Space }): ReactNode {
  const data: DragData = { kind: 'zone', zone: 'favorites' }
  const zone = useDroppable({ id: zoneDndId('favorites'), data })
  const dragging = useDndUi((s) => s.activeId !== null && s.activeId.startsWith('item:'))
  const zoneOn = useDndUi((s) => s.indicator?.overId === zoneDndId('favorites'))
  const favorites = favoritesFor(vs.state, space.profileId)
  if (!favorites.length && !dragging) return <div ref={zone.setNodeRef} />
  return (
    <div ref={zone.setNodeRef} className={`mb-2 rounded-xl ${zoneOn && favorites.length ? 'bg-[var(--row-hover)]' : ''}`} data-section="favorites">
      {favorites.length ? (
        <div className="grid grid-cols-4 gap-1.5">
          {favorites.map((f) => (
            <Tile key={f.id} item={f} vs={vs} />
          ))}
        </div>
      ) : (
        <div className={`drop-zone flex h-11 items-center justify-center text-[12px] font-semibold ${zoneOn ? 'drop-zone-on' : ''}`}>Drop here to add to Favorites</div>
      )}
    </div>
  )
}

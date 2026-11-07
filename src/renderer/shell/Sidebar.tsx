// The sidebar: window controls row, URL field, Favorites, Pinned, Today, bottom bar.
import { useEffect, useRef, useState, type ReactNode, type WheelEvent } from 'react'
import { ArrowLeft, ArrowRight, Download, History, PanelLeft, Plus, RotateCw, X } from 'lucide-react'
import type { Item, ViewState } from '@shared/types'
import { favoritesFor, flatten, itemTitle, sectionItems, sortedSpaces } from '@shared/ops'
import { displayUrl } from '@shared/url'
import { Favicon } from '../common/Favicon'
import { invoke } from '../common/store'
import { activeSpace } from '../common/theme'
import { ExtensionActions } from './urlrow/ExtensionActions'

export function Sidebar({ vs, peek = false }: { vs: ViewState; peek?: boolean }): ReactNode {
  const { state, window: win } = vs
  const space = activeSpace(vs)
  const active = state.items.find((i) => i.id === win.activeItemId)
  const rt = active ? win.tabs[active.id] : undefined
  const favorites = space ? favoritesFor(state, space.profileId) : []
  const pinned = space ? flatten(state, sectionItems(state, space.id, 'pinned'), true) : []
  const today = space ? sectionItems(state, space.id, 'today') : []
  const swipe = useRef({ acc: 0, until: 0 })

  const onWheel = (e: WheelEvent): void => {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return
    const now = Date.now()
    if (now < swipe.current.until) return
    swipe.current.acc += e.deltaX
    if (Math.abs(swipe.current.acc) > 120) {
      void invoke(swipe.current.acc > 0 ? 'space.next' : 'space.prev')
      swipe.current = { acc: 0, until: now + 450 }
    }
  }

  return (
    <div className="flex h-full flex-col px-2 pb-2" onWheel={onWheel}>
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

      <UrlField item={active} loading={Boolean(rt?.loading)} />
      <ExtensionActions vs={vs} />

      <div className="mt-2 flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden">
        {favorites.length > 0 && (
          <div className="mb-2 grid grid-cols-4 gap-1.5">
            {favorites.map((f) => (
              <FavoriteTile key={f.id} item={f} active={f.id === win.activeItemId} loaded={win.loaded.includes(f.id)} />
            ))}
          </div>
        )}

        {pinned.map((it) => (
          <TabRow key={it.id} item={it} vs={vs} />
        ))}

        <Divider hasToday={today.length > 0} />

        {today.map((it) => (
          <TabRow key={it.id} item={it} vs={vs} />
        ))}
        <button
          className="flex h-8 shrink-0 items-center gap-2 rounded-lg px-2 text-left hover:bg-[var(--row-hover)]"
          onClick={() => invoke('commandbar.open', { mode: 'new' })}
        >
          <Plus size={16} strokeWidth={1.9} />
          <span className="text-[13px] font-medium">New Tab</span>
        </button>
        <div className="flex-1" />
      </div>

      <div className="flex h-9 shrink-0 items-center gap-1 pt-1">
        <button className="icon-btn" title="Archive" onClick={() => invoke('archive.open')}>
          <History size={16} strokeWidth={1.9} />
        </button>
        <div className="flex min-w-0 flex-1 items-center justify-center gap-1 overflow-hidden">
          {sortedSpaces(state).map((s, i) => {
            const on = s.id === win.activeSpaceId
            return (
              <button
                key={s.id}
                title={`${s.name} (⌃${i + 1})`}
                className={`no-drag flex h-6 min-w-6 items-center justify-center rounded-full px-1 ${on ? 'bg-[var(--tile-active)] shadow-sm' : 'hover:bg-[var(--row-hover)]'}`}
                onClick={() => invoke('space.switch', { id: s.id })}
                onContextMenu={(e) => {
                  e.preventDefault()
                  void invoke('space.contextMenu', { id: s.id })
                }}
                onDoubleClick={() => invoke('space.edit', { id: s.id })}
              >
                {s.emoji ? (
                  <span className="text-[13px] leading-none">{s.emoji}</span>
                ) : (
                  <span
                    className="block rounded-full"
                    style={{ width: on ? 9 : 7, height: on ? 9 : 7, background: 'var(--fg)', opacity: on ? 1 : 0.55 }}
                  />
                )}
              </button>
            )
          })}
          <button className="icon-btn !h-6 !w-6" title="New space" onClick={() => invoke('space.new')}>
            <Plus size={14} strokeWidth={2} />
          </button>
        </div>
        <button className="icon-btn" title="Downloads" onClick={() => invoke('downloads.open')}>
          <Download size={16} strokeWidth={1.9} />
        </button>
      </div>
      {peek && <div className="sr-only">sidebar preview</div>}
    </div>
  )
}

function UrlField({ item, loading }: { item: Item | undefined; loading: boolean }): ReactNode {
  const text = item ? (item.url.startsWith('swyr://newtab') ? 'Search or enter URL' : displayUrl(item.url)) : 'Search or enter URL'
  return (
    <button
      className="no-drag relative flex h-9 w-full shrink-0 items-center gap-2 overflow-hidden rounded-[10px] bg-[var(--field)] px-2.5 text-left hover:brightness-[1.02]"
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

function FavoriteTile({ item, active, loaded }: { item: Item; active: boolean; loaded: boolean }): ReactNode {
  return (
    <button
      title={itemTitle(item)}
      className={`flex h-11 items-center justify-center rounded-[10px] ${active ? 'bg-[var(--tile-active)] shadow-sm' : 'bg-[var(--tile)] hover:bg-[var(--row-active)]'}`}
      onClick={() => invoke('tab.activate', { id: item.id })}
      onContextMenu={(e) => {
        e.preventDefault()
        void invoke('tab.contextMenu', { id: item.id })
      }}
    >
      <span style={{ opacity: loaded || active ? 1 : 0.75 }}>
        <Favicon item={item} size={18} />
      </span>
    </button>
  )
}

function Divider({ hasToday }: { hasToday: boolean }): ReactNode {
  return (
    <div className="group relative my-1.5 flex h-4 shrink-0 items-center px-2">
      <div className="h-px flex-1 bg-[var(--divider)]" />
      {hasToday && (
        <button
          className="absolute right-1 hidden rounded-md bg-[var(--field)] px-1.5 text-[11px] font-semibold group-hover:block"
          title="Archive all Today tabs (⇧⌘K)"
          onClick={() => invoke('tab.archiveAllToday')}
        >
          Clear
        </button>
      )}
    </div>
  )
}

function TabRow({ item, vs }: { item: Item; vs: ViewState }): ReactNode {
  const win = vs.window
  const active = item.id === win.activeItemId
  const renaming = win.renamingItemId === item.id
  const depth = item.parentId ? 1 : 0
  return (
    <div
      className={`group relative flex h-8 shrink-0 items-center gap-2 rounded-lg pr-1 ${active ? 'bg-[var(--row-active)] shadow-sm' : 'hover:bg-[var(--row-hover)]'}`}
      style={{ paddingLeft: 8 + depth * 14 }}
      onMouseDown={(e) => {
        if (e.button === 0 && !renaming) void invoke('tab.activate', { id: item.id })
        if (e.button === 1) void invoke('tab.close', { id: item.id })
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        void invoke('tab.contextMenu', { id: item.id })
      }}
      onDoubleClick={() => item.section !== 'today' && invoke('tab.rename', { id: item.id })}
      data-item={item.id}
    >
      <Favicon item={item} />
      {renaming ? (
        <RenameInput item={item} />
      ) : (
        <span className="min-w-0 flex-1 truncate text-[13px]" style={{ fontWeight: active ? 600 : 500 }}>
          {itemTitle(item)}
        </span>
      )}
      {!renaming && (
        <button
          className="hidden h-6 w-6 shrink-0 items-center justify-center rounded-md hover:bg-[var(--row-hover)] group-hover:flex"
          title={item.section === 'today' ? 'Close tab (⌘W)' : 'Unload tab'}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            void invoke('tab.close', { id: item.id })
          }}
        >
          <X size={14} strokeWidth={2} />
        </button>
      )}
    </div>
  )
}

function RenameInput({ item }: { item: Item }): ReactNode {
  const ref = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState(itemTitle(item))
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])
  const done = (title: string | null): void => {
    void invoke('tab.rename', title === null ? { id: item.id, cancel: true } : { id: item.id, title })
  }
  return (
    <input
      ref={ref}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') done(value)
        if (e.key === 'Escape') done(null)
      }}
      onBlur={() => done(value)}
      className="min-w-0 flex-1 rounded-md bg-[var(--card)] px-1.5 py-0.5 text-[13px] outline-none ring-1 ring-[var(--card-border)]"
    />
  )
}

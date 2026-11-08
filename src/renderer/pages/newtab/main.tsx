// swyr://newtab: the space gradient with a large search field, the profile's Favorites, recently archived tabs
// and quick links. Typing hands off to the command bar (current tab); a pasted address opens on Enter.
import { SpaceIcon } from '../../common/SpaceIcon'
import { createRoot } from 'react-dom/client'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Archive, Library, Search, Settings } from 'lucide-react'
import '../../common/base.css'
import { invoke, startViewSync, useView } from '../../common/store'
import { SpaceBackground, activeSpace, useSpaceTheme } from '../../common/theme'
import { favoritesFor, itemTitle } from '@shared/ops'
import { displayUrl } from '@shared/url'
import type { ArchiveEntry } from '@shared/types'
import { Favicon } from '../../common/Favicon'

function ago(ts: number): string {
  const m = Math.max(0, Math.round((Date.now() - ts) / 60000))
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.round(h / 24)
  return d === 1 ? 'yesterday' : `${d} days ago`
}

function SearchField(): ReactNode {
  const [value, setValue] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => ref.current?.focus(), [])
  return (
    <label
      className="flex h-[60px] w-full cursor-text items-center gap-3 rounded-2xl bg-[var(--card)] px-5"
      style={{ boxShadow: 'var(--shadow)' }}
    >
      <Search size={21} strokeWidth={2.1} />
      <input
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="min-w-0 flex-1 bg-transparent text-[18px] font-medium outline-none placeholder:text-(color:--fg)"
        placeholder="Search or enter an address"
        aria-label="Search or enter an address"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && value.trim()) {
            e.preventDefault()
            void invoke('tab.navigate', { input: value.trim() })
            return
          }
          // with nothing typed yet, the first key opens the command bar for this tab with that key
          if (!value && e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
            e.preventDefault()
            void invoke('commandbar.open', { mode: 'current', query: e.key })
          }
        }}
      />
      <kbd className="rounded-md bg-[var(--select)] px-1.5 py-0.5 text-[12px] font-semibold">⌘L</kbd>
    </label>
  )
}

function NewTab(): ReactNode {
  const vs = useView((s) => s.vs)
  const space = vs ? activeSpace(vs) : undefined
  const { dark } = useSpaceTheme(space, vs?.systemDark ?? window.matchMedia('(prefers-color-scheme: dark)').matches)
  const favorites = vs && space ? favoritesFor(vs.state, space.profileId).filter((f) => f.kind === 'tab').slice(0, 12) : []
  const archived: ArchiveEntry[] =
    vs && space
      ? [...vs.state.archive]
          .filter((a) => a.item.kind === 'tab' && a.item.profileId === space.profileId && /^https?:/.test(a.item.url))
          .sort((a, b) => b.archivedAt - a.archivedAt)
          .slice(0, 6)
      : []
  return (
    <SpaceBackground space={space} dark={dark} className="flex h-full flex-col items-center overflow-y-auto px-4">
      <div className="relative flex w-full max-w-[640px] flex-1 flex-col justify-center py-12">
        <div className="mb-7 text-center">
          <div className="text-[40px] font-bold leading-none tracking-tight">swyr</div>
          {space && (
            <div className="mt-2 flex items-center justify-center gap-1.5 text-[14px] font-semibold">
              <SpaceIcon name={space.icon} size={15} />
              {space.name}
            </div>
          )}
        </div>
        <SearchField />

        {favorites.length > 0 && (
          <section className="mt-8">
            <div className="flex flex-wrap justify-center gap-x-3 gap-y-4">
              {favorites.map((f) => (
                <button
                  key={f.id}
                  title={itemTitle(f)}
                  className="group flex w-[76px] flex-col items-center gap-1.5"
                  onClick={() => invoke('tab.navigate', { url: f.pinnedUrl ?? f.url })}
                >
                  <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--tile)] group-hover:bg-[var(--tile-active)]">
                    <Favicon item={f} size={24} />
                  </span>
                  <span className="w-full truncate text-center text-[12px] font-semibold">{itemTitle(f)}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {archived.length > 0 && (
          <section className="mt-9">
            <h2 className="mb-2 flex items-center gap-1.5 px-1 text-[12.5px] font-bold uppercase tracking-wide">
              <Archive size={14} strokeWidth={2.2} /> Recently archived
            </h2>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {archived.map((a) => (
                <button
                  key={a.id}
                  title={`Restore ${itemTitle(a.item)}`}
                  className="flex h-12 min-w-0 items-center gap-2.5 rounded-xl bg-[var(--tile)] px-3 text-left hover:bg-[var(--tile-active)]"
                  onClick={() => invoke('archive.restore', { id: a.id })}
                >
                  <Favicon item={a.item} size={16} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold">{itemTitle(a.item)}</span>
                    <span className="block truncate text-[11.5px] font-medium">
                      {displayUrl(a.item.url)} · {ago(a.archivedAt)}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        <nav className="mt-9 flex justify-center gap-2">
          <button className="flex h-9 items-center gap-2 rounded-full bg-[var(--tile)] px-4 text-[13px] font-semibold hover:bg-[var(--tile-active)]" onClick={() => invoke('library.open')}>
            <Library size={15} strokeWidth={2.1} /> Library
          </button>
          <button className="flex h-9 items-center gap-2 rounded-full bg-[var(--tile)] px-4 text-[13px] font-semibold hover:bg-[var(--tile-active)]" onClick={() => invoke('settings.open')}>
            <Settings size={15} strokeWidth={2.1} /> Settings
          </button>
        </nav>
      </div>
    </SpaceBackground>
  )
}

startViewSync()
createRoot(document.getElementById('root')!).render(<NewTab />)

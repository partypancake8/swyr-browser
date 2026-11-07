// swyr://newtab: the space gradient with a search box that opens the command bar.
import { createRoot } from 'react-dom/client'
import type { ReactNode } from 'react'
import { Search } from 'lucide-react'
import '../../common/base.css'
import { invoke, startViewSync, useView } from '../../common/store'
import { SpaceBackground, activeSpace, useSpaceTheme } from '../../common/theme'
import { favoritesFor, itemTitle } from '@shared/ops'
import { Favicon } from '../../common/Favicon'

function NewTab(): ReactNode {
  const vs = useView((s) => s.vs)
  const space = vs ? activeSpace(vs) : undefined
  const { dark } = useSpaceTheme(space, vs?.systemDark ?? window.matchMedia('(prefers-color-scheme: dark)').matches)
  const favorites = vs && space ? favoritesFor(vs.state, space.profileId).slice(0, 8) : []
  const open = (query = ''): void => void invoke('commandbar.open', { mode: 'current', query })
  return (
    <SpaceBackground space={space} dark={dark} className="flex h-full flex-col items-center justify-center px-4">
      <div className="relative w-full max-w-[560px]">
        <div className="mb-6 text-center text-[34px] font-bold tracking-tight">swyr</div>
        <label
          className="flex h-14 w-full cursor-text items-center gap-3 rounded-2xl bg-[var(--card)] px-5"
          style={{ boxShadow: 'var(--shadow)' }}
          onMouseDown={(e) => {
            e.preventDefault()
            open()
          }}
        >
          <Search size={20} strokeWidth={2} />
          <input
            className="min-w-0 flex-1 bg-transparent text-[17px] font-medium outline-none placeholder:text-(color:--fg) placeholder:opacity-75"
            placeholder="Search or enter URL"
            onKeyDown={(e) => {
              if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
                e.preventDefault()
                open(e.key)
              }
            }}
            aria-label="Search or enter URL"
          />
          <kbd className="rounded-md bg-[var(--select)] px-1.5 py-0.5 text-[12px] font-semibold">⌘L</kbd>
        </label>
        {favorites.length > 0 && (
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            {favorites.map((f) => (
              <button
                key={f.id}
                title={itemTitle(f)}
                className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--tile)] hover:bg-[var(--tile-active)]"
                onClick={() => invoke('tab.navigate', { url: f.url })}
              >
                <Favicon item={f} size={20} />
              </button>
            ))}
          </div>
        )}
      </div>
    </SpaceBackground>
  )
}

startViewSync()
createRoot(document.getElementById('root')!).render(<NewTab />)

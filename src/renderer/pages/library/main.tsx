// swyr://library: Archive, Spaces, Downloads, Notes, Canvases, Styles and Media in one place.
import { SpaceIcon } from '../../common/SpaceIcon'
import { createRoot } from 'react-dom/client'
import { useEffect, useState, type ReactNode } from 'react'
import { Archive, Clapperboard, Download, LayoutGrid, Paintbrush, Pencil, Shapes, StickyNote, Trash2, type LucideIcon } from 'lucide-react'
import '../../common/base.css'
import '../page.css'
import type { LibrarySection, Space, ViewState } from '@shared/types'
import { spaceCounts, regularSpaces } from '@shared/ops'
import { NOISE_URL, gradientCss, isDark } from '@shared/theme'
import { invoke, startViewSync, useView } from '../../common/store'
import { activeSpace, useSpaceTheme } from '../../common/theme'
import { ArchiveView } from '../archive/ArchiveView'
import { DocumentsView, MediaView } from './DocumentsView' // round 3b
import { DownloadsView, StylesView } from './LibraryLists'

interface SectionDef {
  id: LibrarySection
  label: string
  icon: LucideIcon
  /** empty state for sections other workers fill in */
  empty?: { title: string; body: string }
}

const SECTIONS: SectionDef[] = [
  { id: 'archive', label: 'Archive', icon: Archive },
  { id: 'spaces', label: 'Spaces', icon: LayoutGrid },
  { id: 'downloads', label: 'Downloads', icon: Download, empty: { title: 'No downloads yet', body: 'Files you download in swyr show up here, newest first, with buttons to open them or show them in Finder.' } },
  { id: 'notes', label: 'Notes', icon: StickyNote, empty: { title: 'No notes yet', body: 'Notes are quick pages for text and links that you can pin in the sidebar like a tab.' } },
  { id: 'canvases', label: 'Canvases', icon: Shapes, empty: { title: 'No canvases yet', body: 'Canvases are freeform boards for links, images, text and drawings.' } },
  { id: 'styles', label: 'Styles', icon: Paintbrush, empty: { title: 'No styles yet', body: 'Styles change how a site looks: colours, fonts, custom CSS and hidden elements. Each site you style is listed here.' } },
  { id: 'media', label: 'Media', icon: Clapperboard, empty: { title: 'Nothing playing', body: 'Audio and video playing in your tabs show up here with playback controls.' } }
]

const isSection = (v: string): v is LibrarySection => SECTIONS.some((s) => s.id === v)
const fromHash = (): LibrarySection => {
  const h = window.location.hash.replace('#', '')
  return isSection(h) ? h : 'archive'
}

function Swatch({ space, dark, size = 44 }: { space: Space; dark: boolean; size?: number }): ReactNode {
  return (
    <div className="relative shrink-0 overflow-hidden rounded-xl border border-[var(--card-border)]" style={{ width: size, height: size, background: gradientCss(space.theme, dark) }}>
      {space.theme.noise > 0 && <div className="noise" style={{ backgroundImage: NOISE_URL, opacity: Math.min(1, space.theme.noise * 1.2) }} />}
      <div className="relative flex h-full items-center justify-center">
        <SpaceIcon name={space.icon} size={Math.round(size * 0.45)} />
      </div>
    </div>
  )
}

function SpacesView({ vs }: { vs: ViewState }): ReactNode {
  const [confirm, setConfirm] = useState<string | null>(null)
  const spaces = regularSpaces(vs.state)
  const profiles = new Map(vs.state.profiles.map((p) => [p.id, p.name]))
  return (
    <div>
      <h1 className="mb-1 text-[26px] font-bold">Spaces</h1>
      <p className="mb-6 text-[14px]">Every space with its theme and tabs. Edit a space to change its name, icon, colours or profile.</p>
      <div className="overflow-hidden rounded-xl border border-[var(--card-border)]">
        {spaces.map((s) => {
          const c = spaceCounts(vs.state, s.id)
          const current = s.id === vs.window.activeSpaceId
          return (
            <div key={s.id} className="flex items-center gap-4 border-b border-[var(--card-border)] px-4 py-3 last:border-b-0" data-space={s.id}>
              <Swatch space={s} dark={isDark(s.theme, vs.systemDark)} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 truncate text-[15px] font-semibold">
                  {s.name}
                  {current && <span className="rounded-md bg-[var(--select)] px-1.5 text-[11px] font-semibold leading-[18px]">Current</span>}
                </div>
                <div className="truncate text-[12px]">
                  {c.pinned} pinned · {c.today} today · {c.folders} {c.folders === 1 ? 'folder' : 'folders'} · {profiles.get(s.profileId) ?? 'Profile'} · {s.theme.appearance}
                </div>
              </div>
              {confirm === s.id ? (
                <>
                  <button
                    className="rounded-lg bg-[#b42318] px-2.5 py-1 text-[12px] font-semibold text-white"
                    onClick={() => {
                      setConfirm(null)
                      void invoke('space.delete', { id: s.id })
                    }}
                  >
                    Delete space
                  </button>
                  <button className="rounded-lg px-2.5 py-1 text-[12px] font-semibold hover:bg-[var(--select)]" onClick={() => setConfirm(null)}>
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  {!current && (
                    <button className="rounded-lg px-2.5 py-1 text-[12px] font-semibold hover:bg-[var(--select)]" onClick={() => invoke('space.switch', { id: s.id })}>
                      Switch
                    </button>
                  )}
                  <button className="flex items-center gap-1.5 rounded-lg bg-[var(--select)] px-2.5 py-1 text-[12px] font-semibold hover:brightness-95" onClick={() => invoke('space.edit', { id: s.id })}>
                    <Pencil size={13} /> Edit
                  </button>
                  <button
                    className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12px] font-semibold hover:bg-[var(--select)] disabled:opacity-50"
                    disabled={spaces.length < 2}
                    title={spaces.length < 2 ? 'Your only space cannot be deleted' : 'Delete space'}
                    onClick={() => setConfirm(s.id)}
                  >
                    <Trash2 size={13} /> Delete
                  </button>
                </>
              )}
            </div>
          )
        })}
      </div>
      {confirm && <p className="mt-3 text-[13px]">Deleting a space moves its pinned tabs and folders to the Archive and closes its Today tabs into the Archive.</p>}
    </div>
  )
}

function Empty({ def }: { def: SectionDef }): ReactNode {
  const Icon = def.icon
  return (
    <div className="flex flex-col items-center px-6 py-20 text-center" data-empty={def.id}>
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--select)]">
        <Icon size={26} strokeWidth={1.8} />
      </div>
      <h1 className="mb-2 text-[20px] font-bold">{def.empty?.title}</h1>
      <p className="max-w-[420px] text-[14px] leading-6">{def.empty?.body}</p>
    </div>
  )
}

function LibraryPage(): ReactNode {
  const vs = useView((s) => s.vs)
  const space = vs ? activeSpace(vs) : undefined
  useSpaceTheme(space, vs?.systemDark ?? false)
  const [section, setSection] = useState<LibrarySection>(fromHash)
  useEffect(() => {
    const on = (): void => setSection(fromHash())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  const def = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0]
  const counts: Partial<Record<LibrarySection, number>> = { archive: vs?.state.archive.length ?? 0, spaces: vs?.state.spaces.length ?? 0 }
  return (
    <div className="flex min-h-screen">
      <nav className="sticky top-0 flex h-screen w-[220px] shrink-0 flex-col gap-0.5 border-r border-[var(--card-border)] px-3 py-8" aria-label="Library sections">
        <div className="mb-4 px-2 text-[20px] font-bold">Library</div>
        {SECTIONS.map((s) => {
          const Icon = s.icon
          const on = s.id === section
          return (
            <button
              key={s.id}
              className={`flex h-9 items-center gap-2.5 rounded-lg px-2 text-left text-[14px] ${on ? 'bg-[var(--select)] font-semibold' : 'font-medium hover:bg-[var(--select)]'}`}
              aria-current={on ? 'page' : undefined}
              onClick={() => {
                window.location.hash = s.id
                setSection(s.id)
              }}
            >
              <Icon size={16} strokeWidth={1.9} />
              <span className="flex-1">{s.label}</span>
              {counts[s.id] ? <span className="text-[12px] font-semibold tabular-nums">{counts[s.id]}</span> : null}
            </button>
          )
        })}
      </nav>
      <main className="min-w-0 flex-1">
        <div className="mx-auto max-w-[760px] px-8 py-10">
          {section === 'archive' ? (
            <ArchiveView vs={vs} />
          ) : section === 'spaces' ? (
            vs ? <SpacesView vs={vs} /> : null
          ) : section === 'notes' ? ( // round 3b
            <DocumentsView vs={vs} kind="note" />
          ) : section === 'canvases' ? (
            <DocumentsView vs={vs} kind="canvas" />
          ) : section === 'media' ? (
            <MediaView vs={vs} />
          ) : section === 'styles' ? (
            <StylesView vs={vs} />
          ) : section === 'downloads' ? (
            <DownloadsView />
          ) : (
            <Empty def={def} />
          )}
        </div>
      </main>
    </div>
  )
}

startViewSync()
createRoot(document.getElementById('root')!).render(<LibraryPage />)

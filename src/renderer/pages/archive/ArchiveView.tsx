// The archive list (used by swyr://archive and the Library): grouped by day, searchable, restore and delete.
import { useMemo, useState, type ReactNode } from 'react'
import { Folder, RotateCcw, Search, Trash2 } from 'lucide-react'
import type { ArchiveEntry, ViewState } from '@shared/types'
import { itemTitle } from '@shared/ops'
import { displayUrl } from '@shared/url'
import { Favicon } from '../../common/Favicon'
import { fuzzyScore } from '../../common/fuzzy'
import { invoke } from '../../common/store'

const REASONS = { auto: 'Auto-archived', manual: 'Archived', closed: 'Closed' } as const

export function dayLabel(ts: number, now = Date.now()): string {
  const d = new Date(ts)
  const today = new Date(now)
  const y = new Date(now - 86400000)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === y.toDateString()) return 'Yesterday'
  const sameYear = d.getFullYear() === today.getFullYear()
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })
}

const btn = 'flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12px] font-semibold'

function Row({ entry, spaceName }: { entry: ArchiveEntry; spaceName: string }): ReactNode {
  const it = entry.item
  const time = new Date(entry.archivedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  return (
    <div className="group flex items-center gap-3 border-b border-[var(--card-border)] px-4 py-2.5 last:border-b-0 hover:bg-[var(--select)]" data-archive={entry.id}>
      {it.kind === 'folder' ? <Folder size={16} strokeWidth={1.9} className="shrink-0" /> : <Favicon item={it} />}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-semibold">{itemTitle(it)}</div>
        <div className="truncate text-[12px]">
          {it.kind === 'folder' ? 'Folder' : displayUrl(it.url)}
          {' · '}
          {spaceName}
          {' · '}
          {REASONS[entry.reason] ?? entry.reason}
          {' · '}
          {time}
        </div>
      </div>
      <button className={`${btn} bg-[var(--select)] hover:brightness-95`} onClick={() => invoke('archive.restore', { id: entry.id })} title="Restore to Today">
        <RotateCcw size={13} /> Restore
      </button>
      <button
        className={`${btn} hover:bg-[var(--select)]`}
        onClick={() => invoke('archive.delete', { id: entry.id })}
        title="Delete from the Archive"
        aria-label={`Delete ${itemTitle(it)} from the Archive`}
      >
        <Trash2 size={13} /> Delete
      </button>
    </div>
  )
}

export function ArchiveView({ vs, heading = true }: { vs: ViewState | null; heading?: boolean }): ReactNode {
  const [q, setQ] = useState('')
  const [confirming, setConfirming] = useState(false)
  const archive = vs?.state.archive
  const spaces = vs?.state.spaces
  const groups = useMemo(() => {
    const names = new Map((spaces ?? []).map((s) => [s.id, `${s.emoji ? s.emoji + ' ' : ''}${s.name}`]))
    const list = [...(archive ?? [])]
      .filter((a) => fuzzyScore(q, itemTitle(a.item), a.item.url, names.get(a.item.spaceId ?? '') ?? '') > 0)
      .sort((a, b) => b.archivedAt - a.archivedAt)
    const out: { label: string; entries: { entry: ArchiveEntry; spaceName: string }[] }[] = []
    for (const a of list) {
      const label = dayLabel(a.archivedAt)
      const spaceName = a.item.spaceId ? (names.get(a.item.spaceId) ?? 'Deleted space') : 'Favorites'
      const g = out[out.length - 1]
      if (g && g.label === label) g.entries.push({ entry: a, spaceName })
      else out.push({ label, entries: [{ entry: a, spaceName }] })
    }
    return out
  }, [archive, spaces, q])
  const total = archive?.length ?? 0
  return (
    <div>
      {heading && (
        <>
          <h1 className="mb-1 text-[26px] font-bold">Archive</h1>
          <p className="mb-6 text-[14px]">Tabs you closed and Today tabs swyr archived for you. Restore any of them to Today.</p>
        </>
      )}
      <div className="mb-6 flex items-center gap-2">
        <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-xl bg-[var(--select)] px-3">
          <Search size={16} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search the archive"
            aria-label="Search the archive"
            className="flex-1 bg-transparent text-[14px] outline-none placeholder:text-(color:--fg) placeholder:opacity-75"
          />
        </label>
        {total > 0 &&
          (confirming ? (
            <div className="flex items-center gap-1">
              <button className={`${btn} h-10 rounded-xl bg-[#b42318] px-3 text-white`} onClick={() => invoke('archive.clear').then(() => setConfirming(false))}>
                Clear {total} {total === 1 ? 'tab' : 'tabs'}
              </button>
              <button className={`${btn} h-10 rounded-xl px-3 hover:bg-[var(--select)]`} onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <button className={`${btn} h-10 rounded-xl px-3 hover:bg-[var(--select)]`} onClick={() => setConfirming(true)}>
              <Trash2 size={14} /> Clear archive
            </button>
          ))}
      </div>
      {groups.length === 0 && <div className="py-10 text-center text-[14px] font-medium">{q ? `Nothing in the archive matches "${q}".` : 'Nothing archived yet.'}</div>}
      {groups.map((g) => (
        <section key={g.label} className="mb-6">
          <h2 className="mb-2 text-[13px] font-bold uppercase tracking-wide">{g.label}</h2>
          <div className="overflow-hidden rounded-xl border border-[var(--card-border)]">
            {g.entries.map(({ entry, spaceName }) => (
              <Row key={entry.id} entry={entry} spaceName={spaceName} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

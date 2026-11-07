// swyr://archive: archived tabs, newest first, with restore buttons.
import { createRoot } from 'react-dom/client'
import { useMemo, useState, type ReactNode } from 'react'
import { RotateCcw, Search } from 'lucide-react'
import '../../common/base.css'
import '../page.css'
import { invoke, startViewSync, useView } from '../../common/store'
import { activeSpace, useSpaceTheme } from '../../common/theme'
import { itemTitle } from '@shared/ops'
import { displayUrl } from '@shared/url'
import { Favicon } from '../../common/Favicon'
import { fuzzyScore } from '../../common/fuzzy'

const REASONS = { auto: 'Auto-archived', manual: 'Archived', closed: 'Closed' } as const

function dayLabel(ts: number): string {
  const d = new Date(ts)
  const today = new Date()
  const y = new Date(Date.now() - 86400000)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === y.toDateString()) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
}

function ArchivePage(): ReactNode {
  const vs = useView((s) => s.vs)
  const space = vs ? activeSpace(vs) : undefined
  useSpaceTheme(space, vs?.systemDark ?? false)
  const [q, setQ] = useState('')
  const groups = useMemo(() => {
    const list = [...(vs?.state.archive ?? [])]
      .filter((a) => fuzzyScore(q, itemTitle(a.item), a.item.url) > 0)
      .sort((a, b) => b.archivedAt - a.archivedAt)
    const out: { label: string; entries: typeof list }[] = []
    for (const a of list) {
      const label = dayLabel(a.archivedAt)
      const g = out[out.length - 1]
      if (g && g.label === label) g.entries.push(a)
      else out.push({ label, entries: [a] })
    }
    return out
  }, [vs?.state.archive, q])
  const spaces = new Map((vs?.state.spaces ?? []).map((s) => [s.id, s]))
  return (
    <div className="mx-auto max-w-[760px] px-6 py-10">
      <h1 className="mb-1 text-[26px] font-bold">Archive</h1>
      <p className="mb-6 text-[14px]">Tabs you closed and Today tabs swyr archived for you. Restore any of them.</p>
      <label className="mb-6 flex h-10 items-center gap-2 rounded-xl bg-[var(--select)] px-3">
        <Search size={16} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the archive" className="flex-1 bg-transparent text-[14px] outline-none placeholder:text-(color:--fg) placeholder:opacity-75" />
      </label>
      {groups.length === 0 && <div className="py-10 text-center text-[14px] font-medium">Nothing archived yet.</div>}
      {groups.map((g) => (
        <section key={g.label} className="mb-6">
          <h2 className="mb-2 text-[13px] font-bold uppercase tracking-wide">{g.label}</h2>
          <div className="overflow-hidden rounded-xl border border-[var(--card-border)]">
            {g.entries.map((a) => (
              <div key={a.id} className="flex items-center gap-3 border-b border-[var(--card-border)] px-4 py-2.5 last:border-b-0 hover:bg-[var(--select)]">
                <Favicon item={a.item} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-semibold">{itemTitle(a.item)}</div>
                  <div className="truncate text-[12px]">
                    {displayUrl(a.item.url)} · {REASONS[a.reason]}
                    {a.item.spaceId && spaces.get(a.item.spaceId) ? ` · ${spaces.get(a.item.spaceId)!.name}` : ''} ·{' '}
                    {new Date(a.archivedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                  </div>
                </div>
                <button
                  className="flex shrink-0 items-center gap-1.5 rounded-lg bg-[var(--select)] px-2.5 py-1 text-[12px] font-semibold hover:brightness-95"
                  onClick={() => invoke('archive.restore', { id: a.id })}
                >
                  <RotateCcw size={13} /> Restore
                </button>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

startViewSync()
createRoot(document.getElementById('root')!).render(<ArchivePage />)

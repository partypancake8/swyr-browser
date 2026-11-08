// swyr://history: visits grouped by day, a search box, and Clear History. Clicking a visit opens it in a new Today tab
// (history.visit: local files reopen too, because the main process checks the URL against history).
import { createRoot } from 'react-dom/client'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Clock, FileText, Globe, Search, Trash2, X } from 'lucide-react'
import '../../common/base.css'
import '../page.css'
import '../settings/settings.css'
import { invoke, startViewSync, useView } from '../../common/store'
import { activeSpace, useSpaceTheme } from '../../common/theme'
import type { HistoryEntry } from '@shared/types'
import { displayUrl } from '@shared/url'
import { Button, Card, inputClass } from '../settings/ui'

const DAY = 24 * 60 * 60 * 1000

function dayLabel(t: number, now = Date.now()): string {
  const d = new Date(t)
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  if (t >= start.getTime()) return 'Today'
  if (t >= start.getTime() - DAY) return 'Yesterday'
  const sameYear = d.getFullYear() === new Date(now).getFullYear()
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })
}

const timeLabel = (t: number): string => new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

/** one row per URL per day, newest first */
function groupByDay(rows: HistoryEntry[]): Array<{ day: string; rows: HistoryEntry[] }> {
  const groups: Array<{ day: string; rows: HistoryEntry[]; seen: Set<string> }> = []
  for (const r of rows) {
    const day = dayLabel(r.visitedAt)
    let g = groups[groups.length - 1]
    if (!g || g.day !== day) {
      g = { day, rows: [], seen: new Set() }
      groups.push(g)
    }
    if (g.seen.has(r.url)) continue
    g.seen.add(r.url)
    g.rows.push(r)
  }
  return groups
}

function HistoryPage(): ReactNode {
  const vs = useView((s) => s.vs)
  const space = vs ? activeSpace(vs) : undefined
  useSpaceTheme(space, vs?.systemDark ?? false)
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<HistoryEntry[] | null>(null)
  const [confirm, setConfirm] = useState(false)

  const load = useCallback((q: string) => {
    void invoke('history.query', { query: q, limit: 3000, dedupe: false }).then((r) => setRows(Array.isArray(r) ? (r as HistoryEntry[]) : []))
  }, [])
  useEffect(() => {
    const t = window.setTimeout(() => load(query), query ? 120 : 0)
    return () => window.clearTimeout(t)
  }, [query, load])

  const groups = useMemo(() => groupByDay(rows ?? []), [rows])
  const profiles = vs?.state.profiles.filter((p) => !p.incognito) ?? []
  const profileName = (id: string): string => profiles.find((p) => p.id === id)?.name ?? ''

  return (
    <div className="mx-auto max-w-[820px] px-6 py-10">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h1 className="flex-1 text-[26px] font-bold">History</h1>
        {confirm ? (
          <>
            <span className="text-[13px] font-semibold">Clear all browsing history?</span>
            <Button onClick={() => setConfirm(false)}>Keep</Button>
            <Button
              kind="danger"
              onClick={() => {
                setConfirm(false)
                void invoke('history.clear').then(() => load(query))
              }}
            >
              Clear History
            </Button>
          </>
        ) : (
          <Button kind="danger" disabled={!rows?.length} onClick={() => setConfirm(true)}>
            <span className="flex items-center gap-1.5">
              <Trash2 size={14} /> Clear History…
            </span>
          </Button>
        )}
      </div>
      <label className="mb-6 flex items-center gap-2 rounded-xl border border-[var(--card-border)] bg-[var(--card)] px-3 py-2.5">
        <Search size={17} strokeWidth={2} className="shrink-0" />
        <input
          autoFocus
          aria-label="Search history"
          className={`${inputClass} !border-0 !bg-transparent !p-0 flex-1 !text-[15px]`}
          placeholder="Search history"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button className="icon-btn !h-6 !w-6" title="Clear search" onClick={() => setQuery('')}>
            <X size={14} strokeWidth={2.2} />
          </button>
        )}
      </label>
      {rows && groups.length === 0 && (
        <Card>
          <div className="px-4 py-10 text-center">
            <Clock size={22} className="mx-auto mb-2" />
            <div className="text-[15px] font-semibold">{query ? `Nothing in your history matches "${query}"` : 'No history yet'}</div>
            <div className="mt-1 text-[13px]">Pages you visit show up here. Private windows are never recorded.</div>
          </div>
        </Card>
      )}
      {groups.map((g) => (
        <section key={g.day} className="mb-6">
          <h2 className="mb-2 text-[13px] font-bold uppercase tracking-wide">{g.day}</h2>
          <Card>
            {g.rows.map((r) => (
              <div
                key={`${r.profileId}:${r.url}:${r.visitedAt}`}
                className="group flex cursor-default items-center gap-3 border-b border-[var(--card-border)] px-4 py-2.5 last:border-b-0 hover:bg-[var(--select)]"
                onClick={() => void invoke('history.visit', { url: r.url, profileId: r.profileId })}
                title={r.url}
                data-history-entry=""
                data-url={r.url}
              >
                <span className="w-[64px] shrink-0 text-[12.5px] font-semibold tabular-nums">{timeLabel(r.visitedAt)}</span>
                {r.url.startsWith('file:') ? <FileText size={16} strokeWidth={1.8} className="shrink-0" /> : <Globe size={16} strokeWidth={1.8} className="shrink-0" />}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-semibold">{r.title || displayUrl(r.url)}</div>
                  <div className="truncate text-[12.5px] font-medium">
                    {displayUrl(r.url)}
                    {profiles.length > 1 && profileName(r.profileId) ? ` · ${profileName(r.profileId)}` : ''}
                  </div>
                </div>
                <button
                  className="icon-btn !h-7 !w-7 opacity-0 group-hover:opacity-100"
                  title="Remove from history"
                  onClick={(e) => {
                    e.stopPropagation()
                    void invoke('history.remove', { url: r.url, profileId: r.profileId }).then(() => load(query))
                  }}
                >
                  <X size={14} strokeWidth={2.2} />
                </button>
              </div>
            ))}
          </Card>
        </section>
      ))}
    </div>
  )
}

startViewSync()
createRoot(document.getElementById('root')!).render(<HistoryPage />)

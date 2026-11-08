// The command bar: a URL or the web search first, live suggestions, open tabs that clearly match, history, archive
// and commands, in the order src/shared/commandbarRank.ts decides.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Command } from 'cmdk'
import { ArrowRight, Clock, Globe, History, Search, TerminalSquare } from 'lucide-react'
import type { HistoryEntry, Item, ViewState } from '@shared/types'
import { COMMANDS, shortcutLabels } from '@shared/commands'
import { itemTitle } from '@shared/ops'
import { displayUrl, resolveWithSettings, searchUrl } from '@shared/url'
import { sectionOrder, strongTabMatch, suggestionRows, type RowKind } from '@shared/commandbarRank'
import { Favicon } from '../common/Favicon'
import { fuzzyScore } from '../common/fuzzy'
import { invoke } from '../common/store'

interface Props {
  vs: ViewState
  mode: 'new' | 'current'
  initialQuery: string
}

const close = (): Promise<unknown> => invoke('commandbar.close')

const HEADINGS: Record<RowKind, string> = {
  url: 'Go to',
  sitesearch: 'Site search',
  search: 'Search',
  suggestion: 'Suggestions',
  tab: 'Open tabs',
  history: 'History',
  archive: 'Archive',
  command: 'Commands'
}

/** one row: what it shows, what Enter runs, and the URL Cmd+Enter opens in a new tab */
interface Row {
  value: string
  kind: RowKind
  body: ReactNode
  run: () => Promise<unknown>
  url?: string
}

export function CommandBar({ vs, mode, initialQuery }: Props): ReactNode {
  const [query, setQuery] = useState(initialQuery)
  const input = useRef<HTMLInputElement>(null)
  const { state, window: win } = vs
  const labels = useMemo(() => shortcutLabels(state.settings.shortcuts), [state.settings.shortcuts])
  const q = query.trim()

  useEffect(() => {
    const el = input.current
    if (!el) return
    el.focus()
    el.select()
  }, [])

  const spacesById = useMemo(() => new Map(state.spaces.map((s) => [s.id, s])), [state.spaces])
  const resolved = useMemo(() => (q ? resolveWithSettings(q, state.settings) : null), [q, state.settings])

  // open tabs: the most recent ones on an empty query, otherwise only strong matches (every word in title or host)
  const tabs = useMemo(() => {
    const all = state.items.filter((i) => i.kind === 'tab' && i.id !== (mode === 'current' ? win.activeItemId : ''))
    if (!q) return [...all].sort((a, b) => b.lastActiveAt - a.lastActiveAt).slice(0, 6)
    const isUrl = resolved?.kind === 'url'
    return all
      .filter((i) => strongTabMatch(q, itemTitle(i), i.url, isUrl))
      .map((i) => ({ i, s: fuzzyScore(q, itemTitle(i), i.url) }))
      .sort((a, b) => b.s - a.s || b.i.lastActiveAt - a.i.lastActiveAt)
      .slice(0, 5)
      .map((x) => x.i)
  }, [state.items, q, mode, win.activeItemId, resolved])

  // live suggestions: main fetches them (the overlay never touches the network), debounced 120 ms
  const [suggestRaw, setSuggestRaw] = useState<{ q: string; list: string[] }>({ q: '', list: [] })
  useEffect(() => {
    if (!q || resolved?.kind !== 'search') return
    let live = true
    const t = window.setTimeout(
      () =>
        void invoke('search.suggest', { query: q }).then((r) => {
          if (live) setSuggestRaw({ q, list: Array.isArray(r) ? r.filter((s): s is string => typeof s === 'string') : [] })
        }),
      120
    )
    return () => {
      live = false
      window.clearTimeout(t)
    }
  }, [q, resolved?.kind])
  const suggestions = useMemo(() => (suggestRaw.q === q && resolved?.kind === 'search' ? suggestionRows(q, suggestRaw.list, 6) : []), [suggestRaw, q, resolved])

  const commands = useMemo(() => {
    const list = COMMANDS.filter((c) => c.palette)
    if (!q) return list.slice(0, 5)
    return list
      .map((c) => ({ c, s: fuzzyScore(q, c.title, c.name) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 6)
      .map((x) => x.c)
  }, [q])

  const archived = useMemo(() => {
    if (!q) return []
    return [...state.archive]
      .sort((a, b) => b.archivedAt - a.archivedAt)
      .map((a) => ({ a, s: fuzzyScore(q, itemTitle(a.item), a.item.url) }))
      .filter((x) => x.s > 0)
      .sort((x, y) => y.s - x.s)
      .slice(0, 5)
      .map((x) => x.a)
  }, [state.archive, q])

  // round 3a: history matches for the typed query, minus pages already open as tabs
  const [historyRows, setHistoryRows] = useState<HistoryEntry[]>([])
  useEffect(() => {
    let live = true
    const t = window.setTimeout(
      () =>
        void invoke('history.query', { query: q, limit: 20 }).then((r) => {
          if (live) setHistoryRows(q && Array.isArray(r) ? (r as HistoryEntry[]) : [])
        }),
      q ? 60 : 0
    )
    return () => {
      live = false
      window.clearTimeout(t)
    }
  }, [q])
  const history = useMemo(() => {
    const open = new Set(state.items.filter((i) => i.kind === 'tab').map((i) => i.url))
    return historyRows.filter((h) => !open.has(h.url)).slice(0, 5)
  }, [historyRows, state.items])

  const go = async (url: string, newTab = mode !== 'current'): Promise<void> => {
    await close()
    await invoke(newTab ? 'tab.new' : 'tab.navigate', { url })
  }

  const where = (i: Item): string => {
    if (i.section === 'favorites') return 'Favorite'
    const sp = i.spaceId ? spacesById.get(i.spaceId) : undefined
    return sp && sp.id !== win.activeSpaceId ? sp.name : i.section === 'pinned' ? 'Pinned' : ''
  }

  const openHint = (
    <span className="cb-hint">
      {mode === 'current' ? 'Open here' : 'Open'} <ArrowRight size={12} className="inline" />
    </span>
  )

  // every row of every section, in display order
  const sections = useMemo(() => {
    const rows: Record<RowKind, Row[]> = { url: [], sitesearch: [], search: [], suggestion: [], tab: [], history: [], archive: [], command: [] }
    if (resolved?.kind === 'url') {
      rows.url.push({
        value: 'url',
        kind: 'url',
        url: resolved.url,
        run: () => go(resolved.url),
        body: (
          <>
            <Globe size={16} strokeWidth={1.9} />
            <span className="min-w-0 flex-1 truncate font-medium">{displayUrl(resolved.url)}</span>
            {openHint}
          </>
        )
      })
    }
    if (resolved?.kind === 'siteSearch') {
      rows.sitesearch.push({
        value: 'sitesearch',
        kind: 'sitesearch',
        url: resolved.url,
        run: () => go(resolved.url),
        body: (
          <>
            <Search size={16} strokeWidth={1.9} />
            <span className="min-w-0 flex-1 truncate font-medium">{resolved.label}</span>
            {openHint}
          </>
        )
      })
    }
    if (q) {
      const url = searchUrl(q, state.settings.searchEngine)
      rows.search.push({
        value: 'search',
        kind: 'search',
        url,
        run: () => go(url),
        body: (
          <>
            <Search size={16} strokeWidth={1.9} />
            <span className="min-w-0 flex-1 truncate font-medium">{`Search for "${q}"`}</span>
            {openHint}
          </>
        )
      })
    }
    suggestions.forEach((s, n) => {
      const url = searchUrl(s, state.settings.searchEngine)
      rows.suggestion.push({
        value: `sugg:${n}:${s}`,
        kind: 'suggestion',
        url,
        run: () => go(url),
        body: (
          <>
            <Search size={16} strokeWidth={1.9} />
            <span className="min-w-0 flex-1 truncate font-medium">{s}</span>
          </>
        )
      })
    })
    for (const i of tabs) {
      rows.tab.push({
        value: `tab:${i.id}`,
        kind: 'tab',
        url: i.url,
        run: async () => {
          await close()
          await invoke('tab.activate', { id: i.id })
        },
        body: (
          <>
            <Favicon item={i} />
            <span className="min-w-0 flex-1 truncate font-medium">{itemTitle(i)}</span>
            <span className="max-w-[40%] shrink-0 truncate text-[12px]">{where(i) || displayUrl(i.url)}</span>
            <span className="cb-hint">Switch</span>
          </>
        )
      })
    }
    if (q) {
      for (const h of history) {
        rows.history.push({
          value: `hist:${h.profileId}:${h.url}`,
          kind: 'history',
          url: h.url,
          run: () => go(h.url),
          body: (
            <>
              <Clock size={16} strokeWidth={1.9} />
              <span className="min-w-0 flex-1 truncate font-medium">{h.title || displayUrl(h.url)}</span>
              <span className="max-w-[40%] shrink-0 truncate text-[12px]">{displayUrl(h.url)}</span>
            </>
          )
        })
      }
    }
    for (const a of archived) {
      rows.archive.push({
        value: `arch:${a.id}`,
        kind: 'archive',
        url: a.item.url,
        run: async () => {
          await close()
          await invoke('archive.restore', { id: a.id })
        },
        body: (
          <>
            <History size={16} strokeWidth={1.9} />
            <span className="min-w-0 flex-1 truncate font-medium">{itemTitle(a.item)}</span>
            <span className="max-w-[40%] shrink-0 truncate text-[12px]">{displayUrl(a.item.url)}</span>
          </>
        )
      })
    }
    for (const c of commands) {
      rows.command.push({
        value: `cmd:${c.name}`,
        kind: 'command',
        run: async () => {
          await close()
          await invoke(c.name)
        },
        body: (
          <>
            <TerminalSquare size={16} strokeWidth={1.9} />
            <span className="min-w-0 flex-1 truncate font-medium">{c.title}</span>
            {labels[c.name] && <kbd className="cb-kbd">{labels[c.name]}</kbd>}
          </>
        )
      })
    }
    const order = sectionOrder(q, resolved?.kind ?? 'search', rows.tab.length > 0)
    return order.map((kind) => ({ kind, rows: rows[kind] })).filter((s) => s.rows.length > 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, resolved, suggestions, tabs, history, archived, commands, labels, mode, state.settings.searchEngine, spacesById, win.activeSpaceId])

  const flat = useMemo(() => sections.flatMap((s) => s.rows), [sections])
  const first = flat[0]?.value ?? ''

  // the selected row: the first row whenever the query or the top row changes, then wherever the arrows move it
  const [selected, setSelected] = useState(first)
  useEffect(() => setSelected(first), [first, q])
  const selectedRow = flat.find((r) => r.value === selected) ?? flat[0]

  return (
    <Command
      shouldFilter={false}
      loop
      label="Command bar"
      value={selectedRow?.value ?? ''}
      onValueChange={setSelected}
      className="w-[600px] max-w-[calc(100vw-32px)] overflow-hidden rounded-2xl border border-[var(--card-border)] bg-[var(--card)]"
      style={{ boxShadow: '0 24px 48px rgba(0,0,0,0.22), 0 0 0 1px rgba(0,0,0,0.04)' }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          void close()
        } else if (e.key === 'Enter' && e.metaKey && selectedRow) {
          // Cmd+Enter: open the selected row in a new tab, whatever the mode
          e.preventDefault()
          void (selectedRow.url && selectedRow.kind !== 'tab' && selectedRow.kind !== 'archive' ? go(selectedRow.url, true) : selectedRow.run())
        }
      }}
    >
      <div className="flex items-center gap-3 px-5 py-4">
        <Search size={18} strokeWidth={2} className="shrink-0" />
        <Command.Input
          ref={input}
          value={query}
          onValueChange={setQuery}
          placeholder={mode === 'current' ? 'Search or enter URL to open here' : 'Search or enter URL'}
          className="min-w-0 flex-1 bg-transparent text-[18px] font-medium outline-none placeholder:text-(color:--fg) placeholder:opacity-75"
        />
        <span className="shrink-0 rounded-md bg-[var(--select)] px-1.5 py-0.5 text-[11px] font-semibold">
          {mode === 'current' ? 'Current tab' : 'New tab'}
        </span>
      </div>
      <Command.List className="max-h-[420px] overflow-y-auto border-t border-[var(--card-border)] px-2 py-2">
        <Command.Empty className="px-3 py-3 text-[13px]">Type to search the web or your tabs.</Command.Empty>
        {sections.map((s) => (
          <Command.Group key={s.kind} heading={HEADINGS[s.kind]} className="cb-group">
            {s.rows.map((r) => (
              <Command.Item key={r.value} value={r.value} data-cmd-row="" data-kind={r.kind} className="cb-item" onSelect={() => void r.run()}>
                {r.body}
              </Command.Item>
            ))}
          </Command.Group>
        ))}
      </Command.List>
    </Command>
  )
}

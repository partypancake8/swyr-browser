// The command bar: open tabs, suggestions, commands and archive in one list.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Command } from 'cmdk'
import { ArrowRight, Globe, History, Search, TerminalSquare } from 'lucide-react'
import type { Item, ViewState } from '@shared/types'
import { COMMANDS, shortcutLabels } from '@shared/commands'
import { itemTitle } from '@shared/ops'
import { displayUrl, resolveWithSettings, searchUrl } from '@shared/url'
import { Favicon } from '../common/Favicon'
import { fuzzyScore } from '../common/fuzzy'
import { invoke } from '../common/store'

interface Props {
  vs: ViewState
  mode: 'new' | 'current'
  initialQuery: string
}

const close = (): Promise<unknown> => invoke('commandbar.close')

export function CommandBar({ vs, mode, initialQuery }: Props): ReactNode {
  const [query, setQuery] = useState(initialQuery)
  const input = useRef<HTMLInputElement>(null)
  const { state, window: win } = vs
  const labels = useMemo(() => shortcutLabels(state.settings.shortcuts), [state.settings.shortcuts])

  useEffect(() => {
    const el = input.current
    if (!el) return
    el.focus()
    el.select()
  }, [])

  const spacesById = useMemo(() => new Map(state.spaces.map((s) => [s.id, s])), [state.spaces])

  const tabs = useMemo(() => {
    const all = state.items.filter((i) => i.kind === 'tab' && i.id !== (mode === 'current' ? win.activeItemId : ''))
    if (!query.trim()) return [...all].sort((a, b) => b.lastActiveAt - a.lastActiveAt).slice(0, 6)
    return all
      .map((i) => ({ i, s: fuzzyScore(query, itemTitle(i), i.url) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 5)
      .map((x) => x.i)
  }, [state.items, query, mode, win.activeItemId])

  const suggestions = useMemo(() => {
    const q = query.trim()
    if (!q) return []
    const first = resolveWithSettings(q, state.settings)
    const out = [first]
    if (first.kind === 'url') out.push({ url: searchUrl(q, state.settings.searchEngine), kind: 'search', label: `Search for "${q}"` })
    return out
  }, [query, state.settings])

  const commands = useMemo(() => {
    const list = COMMANDS.filter((c) => c.palette)
    if (!query.trim()) return list.slice(0, 5)
    return list
      .map((c) => ({ c, s: fuzzyScore(query, c.title, c.name) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 6)
      .map((x) => x.c)
  }, [query])

  const archived = useMemo(() => {
    if (!query.trim()) return []
    return [...state.archive]
      .sort((a, b) => b.archivedAt - a.archivedAt)
      .map((a) => ({ a, s: fuzzyScore(query, itemTitle(a.item), a.item.url) }))
      .filter((x) => x.s > 0)
      .sort((x, y) => y.s - x.s)
      .slice(0, 5)
      .map((x) => x.a)
  }, [state.archive, query])

  const go = async (url: string): Promise<void> => {
    await close()
    await invoke(mode === 'current' ? 'tab.navigate' : 'tab.new', { url })
  }

  const where = (i: Item): string => {
    if (i.section === 'favorites') return 'Favorite'
    const sp = i.spaceId ? spacesById.get(i.spaceId) : undefined
    return sp && sp.id !== win.activeSpaceId ? sp.name : i.section === 'pinned' ? 'Pinned' : ''
  }

  return (
    <Command
      shouldFilter={false}
      loop
      label="Command bar"
      className="w-[600px] max-w-[calc(100vw-32px)] overflow-hidden rounded-2xl border border-[var(--card-border)] bg-[var(--card)]"
      style={{ boxShadow: '0 24px 48px rgba(0,0,0,0.22), 0 0 0 1px rgba(0,0,0,0.04)' }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          void close()
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
        {tabs.length > 0 && (
          <Command.Group heading="Open tabs" className="cb-group">
            {tabs.map((i) => (
              <Command.Item
                key={i.id}
                value={`tab:${i.id}`}
                className="cb-item"
                onSelect={async () => {
                  await close()
                  await invoke('tab.activate', { id: i.id })
                }}
              >
                <Favicon item={i} />
                <span className="min-w-0 flex-1 truncate font-medium">{itemTitle(i)}</span>
                <span className="max-w-[40%] shrink-0 truncate text-[12px]">{where(i) || displayUrl(i.url)}</span>
                <span className="cb-hint">Switch</span>
              </Command.Item>
            ))}
          </Command.Group>
        )}
        {suggestions.length > 0 && (
          <Command.Group heading="Suggestions" className="cb-group">
            {suggestions.map((s, n) => (
              <Command.Item key={`${s.url}:${n}`} value={`suggest:${n}`} className="cb-item" onSelect={() => go(s.url)}>
                {s.kind === 'url' ? <Globe size={16} strokeWidth={1.9} /> : <Search size={16} strokeWidth={1.9} />}
                <span className="min-w-0 flex-1 truncate font-medium">{s.kind === 'url' ? displayUrl(s.url) : s.label}</span>
                <span className="cb-hint">
                  {mode === 'current' ? 'Open here' : 'Open'} <ArrowRight size={12} className="inline" />
                </span>
              </Command.Item>
            ))}
          </Command.Group>
        )}
        {commands.length > 0 && (
          <Command.Group heading="Commands" className="cb-group">
            {commands.map((c) => (
              <Command.Item
                key={c.name}
                value={`cmd:${c.name}`}
                className="cb-item"
                onSelect={async () => {
                  await close()
                  await invoke(c.name)
                }}
              >
                <TerminalSquare size={16} strokeWidth={1.9} />
                <span className="min-w-0 flex-1 truncate font-medium">{c.title}</span>
                {labels[c.name] && <kbd className="cb-kbd">{labels[c.name]}</kbd>}
              </Command.Item>
            ))}
          </Command.Group>
        )}
        {archived.length > 0 && (
          <Command.Group heading="Archive" className="cb-group">
            {archived.map((a) => (
              <Command.Item
                key={a.id}
                value={`arch:${a.id}`}
                className="cb-item"
                onSelect={async () => {
                  await close()
                  await invoke('archive.restore', { id: a.id })
                }}
              >
                <History size={16} strokeWidth={1.9} />
                <span className="min-w-0 flex-1 truncate font-medium">{itemTitle(a.item)}</span>
                <span className="max-w-[40%] shrink-0 truncate text-[12px]">{displayUrl(a.item.url)}</span>
              </Command.Item>
            ))}
          </Command.Group>
        )}
      </Command.List>
    </Command>
  )
}

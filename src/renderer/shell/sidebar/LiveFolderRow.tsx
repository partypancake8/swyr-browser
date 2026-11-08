// A Live Folder row in the Pinned list (chevron, name, "live" badge, refresh button) and its editor dialog for the overlay.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AlertCircle, ChevronRight, FolderSync, RefreshCw } from 'lucide-react'
import type { Item, LiveFolderSource, MenuEntry, Space, ViewState } from '@shared/types'
import { childrenOf, itemTitle } from '@shared/ops'
import { SEP, showMenu } from '../../common/menu'
import { invoke } from '../../common/store'
import { justDragged } from './dnd'
import { DropLine, ROW_INDENT, useItemDnd } from './TabRow'

const SOURCE_LABELS: Record<LiveFolderSource, string> = {
  'github-prs': 'GitHub pull requests',
  'github-issues': 'GitHub issues',
  rss: 'RSS or Atom feed',
  test: 'Test fixture'
}

function liveMenu(folder: Item): MenuEntry[] {
  return [
    { label: 'Refresh', command: 'liveFolder.refresh', payload: { itemId: folder.id } },
    { label: 'Edit Live Folder…', command: 'liveFolder.editor', payload: { itemId: folder.id } },
    { label: folder.collapsed ? 'Expand' : 'Collapse', command: 'liveFolder.toggle', payload: { itemId: folder.id } },
    SEP,
    { label: 'Delete Live Folder', command: 'liveFolder.delete', payload: { itemId: folder.id } }
  ]
}

function ago(t: number | undefined): string {
  if (!t) return 'not refreshed yet'
  const m = Math.round((Date.now() - t) / 60000)
  return m < 1 ? 'refreshed just now' : m < 60 ? `refreshed ${m} min ago` : `refreshed ${Math.round(m / 60)} h ago`
}

export function LiveFolderRow({ folder, depth, vs, space: _space }: { folder: Item; depth: number; vs: ViewState; space: Space | undefined }): ReactNode {
  const [busy, setBusy] = useState(false)
  const open = !folder.collapsed
  const count = childrenOf(vs.state, folder.id).length
  const dnd = useItemDnd(folder)
  const live = folder.live
  const error = live?.error
  const refresh = (): void => {
    if (busy) return
    setBusy(true)
    void invoke('liveFolder.refresh', { itemId: folder.id }).finally(() => setBusy(false))
  }
  const tip = `${itemTitle(folder)}: ${live ? SOURCE_LABELS[live.source] : 'Live Folder'}, ${ago(live?.lastRefreshedAt)}${error ? `\n${error}` : ''}`
  return (
    <div
      ref={dnd.ref}
      {...dnd.attributes}
      {...dnd.listeners}
      role="treeitem"
      aria-expanded={open}
      tabIndex={-1}
      className={`group no-drag relative flex h-8 shrink-0 items-center gap-1.5 rounded-lg pr-1 outline-none hover:bg-[var(--row-hover)] ${dnd.isDragging ? 'opacity-40' : ''}`}
      style={{ paddingLeft: 4 + depth * ROW_INDENT }}
      onClick={() => {
        if (!justDragged()) void invoke('liveFolder.toggle', { itemId: folder.id })
      }}
      onDoubleClick={(e) => {
        e.stopPropagation()
        void invoke('liveFolder.editor', { itemId: folder.id })
      }}
      onContextMenu={(e) => showMenu(liveMenu(folder), e)}
      data-item={folder.id} data-item-id={folder.id}
      data-kind="liveFolder"
      data-depth={depth}
      title={tip}
    >
      <ChevronRight size={14} strokeWidth={2.2} className="shrink-0 transition-transform duration-150" style={{ transform: open ? 'rotate(90deg)' : 'none' }} />
      <FolderSync size={16} strokeWidth={1.9} className="shrink-0" />
      <span className="ml-0.5 min-w-0 flex-1 truncate text-[13px] font-semibold leading-none">{itemTitle(folder)}</span>
      {error ? (
        <AlertCircle size={14} strokeWidth={2.2} className="shrink-0 text-[var(--danger)]" aria-label="Refresh failed" />
      ) : (
        <span className="shrink-0 rounded-md bg-[color-mix(in_srgb,var(--accent)_16%,transparent)] text-[var(--accent)] px-1.5 text-[10px] font-bold uppercase leading-[16px] tracking-wide" aria-label="Live Folder">
          live
        </span>
      )}
      {!open && count > 0 && <span className="shrink-0 rounded-md bg-[var(--select)] px-1.5 text-[11px] font-semibold leading-[18px]">{count}</span>}
      <button
        data-no-dnd
        className={`${busy ? 'flex' : 'hidden group-hover:flex'} h-6 w-6 shrink-0 items-center justify-center rounded-md hover:bg-[var(--row-hover)]`}
        title="Refresh"
        aria-label="Refresh Live Folder"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          refresh()
        }}
      >
        <RefreshCw size={13} strokeWidth={2.2} className={busy ? 'animate-spin' : ''} />
      </button>
      <DropLine indicator={dnd.indicator} depth={depth} />
    </div>
  )
}

// ----- the editor dialog (drawn by the overlay view)

const field = 'h-9 w-full rounded-lg border border-[var(--card-border)] bg-[var(--content)] px-2.5 text-[14px] outline-none focus:border-[var(--accent)]'
const btn = 'rounded-lg px-3 py-1.5 text-[13px] font-semibold hover:bg-[var(--select)]'
const primary = 'rounded-lg bg-[var(--fg)] px-3 py-1.5 text-[13px] font-semibold text-(color:--card) disabled:opacity-50'

export function LiveFolderEditor({ vs, itemId }: { vs: ViewState; itemId?: string }): ReactNode {
  const folder = itemId ? vs.state.items.find((i) => i.id === itemId && i.kind === 'liveFolder') : undefined
  const live = folder?.live
  const [name, setName] = useState(folder ? itemTitle(folder) : 'My pull requests')
  const [source, setSource] = useState<LiveFolderSource>(live?.source ?? 'github-prs')
  const [query, setQuery] = useState(live?.sourceConfig.query ?? 'is:pr is:open author:@me')
  const [feed, setFeed] = useState(live?.sourceConfig.url ?? '')
  const [token, setToken] = useState('')
  const hasToken = Boolean(vs.secrets?.githubToken)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])
  const close = (): void => void invoke('overlay.close')
  const github = source === 'github-prs' || source === 'github-issues'
  const valid = name.trim() && (github ? query.trim() : source === 'rss' ? /^https?:\/\//i.test(feed.trim()) : true)
  const save = async (): Promise<void> => {
    if (!valid) return
    const sourceConfig: Record<string, string> = github ? { query: query.trim() } : source === 'rss' ? { url: feed.trim() } : { fixture: live?.sourceConfig.fixture ?? '' }
    if (github && token.trim()) sourceConfig.token = token.trim()
    if (folder) await invoke('liveFolder.edit', { itemId: folder.id, name: name.trim(), source, sourceConfig })
    else await invoke('liveFolder.new', { name: name.trim(), source, sourceConfig })
    close()
  }
  const sources: LiveFolderSource[] = source === 'test' ? ['github-prs', 'github-issues', 'rss', 'test'] : ['github-prs', 'github-issues', 'rss']
  return (
    <div
      className="fixed inset-0 flex items-start justify-center bg-[var(--backdrop)]"
      style={{ paddingTop: '16vh' }}
      onMouseDown={(e) => e.target === e.currentTarget && close()}
      onKeyDown={(e) => {
        if (e.key === 'Escape') close()
        if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') void save()
      }}
    >
      <div className="w-[420px] rounded-2xl border border-[var(--card-border)] bg-[var(--card)] p-5" style={{ boxShadow: '0 24px 48px rgba(0,0,0,0.22)' }} role="dialog" aria-label="Live Folder">
        <div className="mb-1 flex items-center gap-2 text-[15px] font-semibold">
          <FolderSync size={17} strokeWidth={2} /> {folder ? 'Edit Live Folder' : 'New Live Folder'}
        </div>
        <p className="mb-4 text-[13px] leading-5">A pinned folder that fills itself from a source and refreshes every 10 minutes.</p>
        <label className="mb-3 block">
          <span className="mb-1 block text-[12px] font-semibold">Name</span>
          <input ref={ref} className={field} value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" />
        </label>
        <label className="mb-3 block">
          <span className="mb-1 block text-[12px] font-semibold">Source</span>
          <select className={field} value={source} onChange={(e) => setSource(e.target.value as LiveFolderSource)} aria-label="Source">
            {sources.map((s) => (
              <option key={s} value={s}>
                {SOURCE_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        {github && (
          <>
            <label className="mb-3 block">
              <span className="mb-1 block text-[12px] font-semibold">Search query</span>
              <input className={field} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="is:pr is:open author:@me" aria-label="Search query" />
              <span className="mt-1 block text-[12px] leading-4">GitHub search syntax, for example repo:owner/name or review-requested:@me.</span>
            </label>
            <label className="mb-4 block">
              <span className="mb-1 block text-[12px] font-semibold">GitHub token</span>
              <input
                className={field}
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder={hasToken ? 'Saved. Type a new token to replace it' : 'A personal access token with read access'}
                aria-label="GitHub token"
                autoComplete="off"
              />
              <span className="mt-1 block text-[12px] leading-4">Stored on this Mac in swyr's settings and sent only to api.github.com.</span>
            </label>
          </>
        )}
        {source === 'rss' && (
          <label className="mb-4 block">
            <span className="mb-1 block text-[12px] font-semibold">Feed URL</span>
            <input className={field} value={feed} onChange={(e) => setFeed(e.target.value)} placeholder="https://example.com/feed.xml" aria-label="Feed URL" />
          </label>
        )}
        {live?.error && <p className="mb-3 text-[12px] font-semibold text-[var(--danger)]">Last refresh failed: {live.error}</p>}
        <div className="flex justify-end gap-2">
          <button className={btn} onClick={close}>
            Cancel
          </button>
          <button className={primary} disabled={!valid} onClick={() => void save()}>
            {folder ? 'Save' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}

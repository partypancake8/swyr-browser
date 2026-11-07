// Live Folders: pinned folders that fill themselves from a source (GitHub pull requests or issues, an RSS or Atom feed).
import fs from 'node:fs'
import type { Item, LiveFolderConfig, LiveFolderInfo, LiveFolderSource } from '@shared/types'
import { childrenOf, sameUrl } from '@shared/ops'
import { newId } from '../util/id'
import type { Core } from '../windows/WindowManager'
import { githubQuery, parseFeed, parseFixture, type LiveEntry } from './feed'

export const LIVE_SOURCES: LiveFolderSource[] = ['github-prs', 'github-issues', 'rss', 'test']
export const AUTO_REFRESH_MS = 10 * 60 * 1000
const FETCH_TIMEOUT_MS = 20000
const MAX_ENTRIES = 50

export const isLiveSource = (v: unknown): v is LiveFolderSource => typeof v === 'string' && (LIVE_SOURCES as string[]).includes(v)

/** keep only the config fields a source uses; the GitHub token never lives on the item (it goes to settings.githubToken) */
export function cleanConfig(source: LiveFolderSource, raw: unknown): LiveFolderConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const s = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 2000) : undefined)
  if (source === 'rss') return { url: s(r.url) }
  if (source === 'test') return { fixture: s(r.fixture) }
  return { query: s(r.query) }
}

async function fetchText(url: string, headers: Record<string, string>): Promise<string> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, { headers, signal: ctl.signal, redirect: 'follow' })
    const body = await res.text()
    if (!res.ok) {
      let msg = `${res.status} ${res.statusText}`
      try {
        const j = JSON.parse(body) as { message?: string }
        if (j.message) msg += `: ${j.message}`
      } catch {
        /* not JSON */
      }
      throw new Error(msg)
    }
    return body
  } finally {
    clearTimeout(timer)
  }
}

/** the entries a folder's source lists right now */
export async function fetchEntries(core: Core, live: LiveFolderInfo): Promise<LiveEntry[]> {
  const cfg = live.sourceConfig ?? {}
  switch (live.source) {
    case 'test': {
      // reads a local JSON file, so only headless test runs may use it
      if (!core.test) throw new Error('the test source only works in test mode')
      if (!cfg.fixture) throw new Error('no fixture file set')
      return parseFixture(JSON.parse(fs.readFileSync(cfg.fixture, 'utf8')), MAX_ENTRIES)
    }
    case 'rss': {
      if (!cfg.url || !/^https?:\/\//i.test(cfg.url)) throw new Error('set a feed URL that starts with http:// or https://')
      const xml = await fetchText(cfg.url, { accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.5', 'user-agent': 'swyr' })
      return parseFeed(xml, MAX_ENTRIES)
    }
    case 'github-prs':
    case 'github-issues': {
      const token = core.store.state.settings.githubToken
      const q = githubQuery(live.source, cfg.query)
      if (!token && /@me\b/.test(q)) throw new Error('add a GitHub token to use @me in the query')
      const headers: Record<string, string> = { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'swyr' }
      if (token) headers.authorization = `Bearer ${token}`
      const url = `https://api.github.com/search/issues?q=${encodeURIComponent(q)}&per_page=${MAX_ENTRIES}&sort=updated&order=desc`
      const json = JSON.parse(await fetchText(url, headers)) as { items?: Array<{ title?: string; html_url?: string; number?: number; repository_url?: string }> }
      return (json.items ?? [])
        .filter((i) => typeof i.html_url === 'string')
        .map((i) => {
          const repo = (i.repository_url ?? '').split('/').slice(-1)[0]
          const prefix = repo && i.number ? `${repo}#${i.number} ` : ''
          return { title: `${prefix}${i.title ?? ''}`.trim() || String(i.html_url), url: String(i.html_url) }
        })
    }
    default:
      throw new Error('unknown source')
  }
}

/** children the user is using right now: loaded in some window, or navigated away from the source's link */
function userOpened(core: Core, child: Item): boolean {
  if (core.windows.some((w) => w.tabs.get(child.id) || w.activeItemId === child.id)) return true
  return Boolean(child.pinnedUrl) && !sameUrl(child.url, child.pinnedUrl)
}

/**
 * Replace the folder's children with the entries, in source order. Children that match an entry keep their id;
 * children the user opened stay (after the source's entries) even when the source no longer lists them.
 */
export function applyEntries(core: Core, folder: Item, entries: LiveEntry[]): number {
  const now = Date.now()
  const seen = new Set<string>()
  const unique = entries.filter((e) => {
    const key = e.url.replace(/#.*$/, '').replace(/\/$/, '')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  core.store.update((st) => {
    const current = st.items.find((i) => i.id === folder.id)
    if (!current) return
    const kids = childrenOf(st, folder.id)
    const used = new Set<string>()
    const next: Item[] = []
    for (const e of unique) {
      const match = kids.find((k) => !used.has(k.id) && sameUrl(k.pinnedUrl ?? k.url, e.url))
      if (match) {
        used.add(match.id)
        match.title = e.title
        match.pinnedUrl = e.url
        if (!userOpened(core, match)) match.url = e.url
        next.push(match)
        continue
      }
      const child: Item = {
        id: newId('tab'),
        spaceId: current.spaceId,
        profileId: current.profileId,
        parentId: current.id,
        section: 'pinned',
        kind: 'tab',
        order: 0,
        customTitle: null,
        pinnedUrl: e.url,
        url: e.url,
        title: e.title,
        favicon: null,
        createdAt: now,
        lastActiveAt: 0
      }
      st.items.push(child)
      next.push(child)
    }
    const keep = kids.filter((k) => !used.has(k.id) && userOpened(core, k))
    const drop = new Set(kids.filter((k) => !used.has(k.id) && !keep.includes(k)).map((k) => k.id))
    st.items = st.items.filter((i) => !drop.has(i.id))
    ;[...next, ...keep].forEach((k, i) => (k.order = i))
    if (current.live) {
      current.live.lastRefreshedAt = now
      current.live.error = null
    }
  })
  return unique.length
}

const running = new Map<string, Promise<number>>()

/** fetch and apply one folder's source; calls for the same folder run one after another */
export function refreshFolder(core: Core, folderId: string): Promise<number> {
  const prev = running.get(folderId) ?? Promise.resolve(0)
  const job = prev
    .catch(() => 0)
    .then(async () => {
      const folder = core.store.state.items.find((i) => i.id === folderId && i.kind === 'liveFolder')
      if (!folder?.live) throw new Error('not a live folder')
      try {
        const entries = await fetchEntries(core, folder.live)
        return applyEntries(core, folder, entries)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        core.store.update(() => {
          if (folder.live) folder.live.error = message.slice(0, 300)
        })
        throw err
      }
    })
  running.set(folderId, job)
  void job.finally(() => {
    if (running.get(folderId) === job) running.delete(folderId)
  }).catch(() => undefined)
  return job
}

export function liveFolders(core: Core): Item[] {
  return core.store.state.items.filter((i) => i.kind === 'liveFolder' && i.live)
}

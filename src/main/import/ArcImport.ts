// Importer for the user's own Arc sidebar file (StorableSidebar.json).
// Read locally and only on a user action; nothing is uploaded. The format is undocumented, so every
// access is defensive. Shape (from public open-source exporters):
//   sidebar.containers: [ { global: {} }, { spaces: [...], items: [...], topAppsContainerIDs?: [...] } ]
//   spaces: alternating id strings and dicts { id, title, newContainerIDs: [{pinned:{}}, id, {unpinned:{}}, id] }
//   items:  alternating id strings and dicts { id, parentID, title, childrenIds, data: { tab: { savedTitle, savedURL } } | { list: {} } }
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import type { ImportSummary } from '@shared/types'

export const ARC_SIDEBAR_PATH = path.join(os.homedir(), 'Library', 'Application Support', 'Arc', 'StorableSidebar.json')

type Dict = Record<string, unknown>

const isDict = (v: unknown): v is Dict => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length ? v : undefined)

export interface ImportedTab {
  kind: 'tab'
  url: string
  title: string
  customTitle: string | null
}

export interface ImportedFolder {
  kind: 'folder'
  title: string
  children: ImportedNode[]
}

export type ImportedNode = ImportedTab | ImportedFolder

export interface ImportedSpace {
  title: string
  /** the exported space emoji or icon name as found; the import command maps it to a Lucide icon name (iconFromEmoji) */
  icon: string | null
  pinned: ImportedNode[]
  today: ImportedTab[]
}

export interface ImportedSidebar {
  spaces: ImportedSpace[]
  favorites: ImportedTab[]
}

/** a space's exported emoji or icon name (customInfo.iconType.emoji_v2, emoji or icon) */
function importedIcon(sp: Dict): string | null {
  const info = isDict(sp.customInfo) ? sp.customInfo : {}
  const type = isDict(info.iconType) ? info.iconType : {}
  const raw = str(type.emoji_v2) ?? str(type.emoji) ?? str(type.icon) ?? str(sp.emoji) ?? str(sp.icon)
  // symbol names may carry a suffix such as "star.fill"
  return raw ? raw.split('.')[0] : null
}

/** the dicts of a list that alternates id strings and dicts */
function dicts(list: unknown): Dict[] {
  return Array.isArray(list) ? list.filter(isDict) : []
}

function pickContainer(root: unknown): Dict | undefined {
  const sidebar = isDict(root) && isDict(root.sidebar) ? root.sidebar : undefined
  const containers = sidebar && Array.isArray(sidebar.containers) ? sidebar.containers : []
  const globalIdx = containers.findIndex((c) => isDict(c) && 'global' in c)
  const after = globalIdx >= 0 ? containers[globalIdx + 1] : undefined
  if (isDict(after) && Array.isArray(after.spaces) && Array.isArray(after.items)) return after
  return containers.find((c): c is Dict => isDict(c) && Array.isArray(c.spaces) && Array.isArray(c.items))
}

/** container ids following each marker dict ({pinned:{}} / {unpinned:{}} / {default:true}) */
function markedIds(list: unknown): { marker: string; id: string }[] {
  const out: { marker: string; id: string }[] = []
  if (!Array.isArray(list)) return out
  for (let i = 0; i < list.length; i++) {
    const m = list[i]
    const next = list[i + 1]
    if (isDict(m) && typeof next === 'string') {
      out.push({ marker: Object.keys(m)[0] ?? '', id: next })
      i++
    }
  }
  return out
}

export function parseSidebar(root: unknown): ImportedSidebar {
  const c = pickContainer(root)
  if (!c) throw new Error('This file does not look like a sidebar export (no spaces found).')
  const byId = new Map<string, Dict>()
  for (const it of dicts(c.items)) {
    const id = str(it.id)
    if (id) byId.set(id, it)
  }
  const childrenOf = (id: string): Dict[] => {
    const own = byId.get(id)
    const ids = own && Array.isArray(own.childrenIds) ? own.childrenIds.filter((x): x is string => typeof x === 'string') : null
    if (ids && ids.length) return ids.map((x) => byId.get(x)).filter(isDict)
    // fall back to parentID links, in file order
    return [...byId.values()].filter((it) => it.parentID === id)
  }
  const asTab = (it: Dict): ImportedTab | null => {
    const data = isDict(it.data) ? it.data : undefined
    const tab = data && isDict(data.tab) ? data.tab : undefined
    const url = tab ? str(tab.savedURL) : undefined
    if (!tab || !url) return null
    const saved = str(tab.savedTitle) ?? ''
    const custom = str(it.title)
    return { kind: 'tab', url, title: saved || custom || url, customTitle: custom && custom !== saved ? custom : null }
  }
  const walk = (parentId: string, depth: number, seen: Set<string>): ImportedNode[] => {
    if (depth > 12) return []
    const out: ImportedNode[] = []
    for (const it of childrenOf(parentId)) {
      const id = str(it.id)
      if (!id || seen.has(id)) continue
      seen.add(id)
      const tab = asTab(it)
      if (tab) {
        out.push(tab)
        continue
      }
      const data = isDict(it.data) ? it.data : undefined
      const kids = walk(id, depth + 1, seen)
      if (data && isDict(data.list)) out.push({ kind: 'folder', title: str(it.title) ?? 'Folder', children: kids })
      else out.push(...kids) // split views and other groupings: keep their tabs
    }
    return out
  }
  const flatTabs = (nodes: ImportedNode[]): ImportedTab[] => nodes.flatMap((n) => (n.kind === 'tab' ? [n] : flatTabs(n.children)))

  const spaces: ImportedSpace[] = []
  for (const sp of dicts(c.spaces)) {
    const marks = markedIds(sp.newContainerIDs ?? sp.containerIDs)
    const pinnedId = marks.find((m) => m.marker === 'pinned')?.id
    const unpinnedId = marks.find((m) => m.marker === 'unpinned')?.id
    const seen = new Set<string>()
    spaces.push({
      title: str(sp.title) ?? `Imported space ${spaces.length + 1}`,
      icon: importedIcon(sp),
      pinned: pinnedId ? walk(pinnedId, 0, seen) : [],
      today: unpinnedId ? flatTabs(walk(unpinnedId, 0, seen)) : []
    })
  }
  // one favorites container per source profile; swyr merges them into the importing profile
  const favorites: ImportedTab[] = []
  const favUrls = new Set<string>()
  for (const m of markedIds(c.topAppsContainerIDs)) {
    for (const t of flatTabs(walk(m.id, 0, new Set()))) {
      if (favUrls.has(t.url)) continue
      favUrls.add(t.url)
      favorites.push(t)
    }
  }
  return { spaces, favorites }
}

export function summarize(sidebar: ImportedSidebar): ImportSummary {
  let folders = 0
  let pinned = 0
  const count = (nodes: ImportedNode[]): void => {
    for (const n of nodes) {
      if (n.kind === 'folder') {
        folders++
        count(n.children)
      } else pinned++
    }
  }
  for (const s of sidebar.spaces) count(s.pinned)
  return {
    spaces: sidebar.spaces.length,
    folders,
    pinned,
    today: sidebar.spaces.reduce((n, s) => n + s.today.length, 0),
    favorites: sidebar.favorites.length
  }
}

export function readSidebarFile(file = ARC_SIDEBAR_PATH): ImportedSidebar {
  const raw = fs.readFileSync(file, 'utf8')
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    throw new Error('The sidebar file is not valid JSON.')
  }
  return parseSidebar(json)
}

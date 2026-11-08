// Pure helpers over the persisted state, used by main and renderers.
import type { Item, PersistedState, Section, Space } from './types'

export const byOrder = (a: Item, b: Item): number => a.order - b.order

export function spaceById(s: PersistedState, id: string | null | undefined): Space | undefined {
  return s.spaces.find((x) => x.id === id)
}

export function sortedSpaces(s: PersistedState): Space[] {
  return [...s.spaces].sort((a, b) => a.order - b.order)
}

/**
 * the spaces one window lists (space switcher, Ctrl+1..9, next/prev, move-to-space menus):
 * a private window lists only its own space, and private spaces never show in any other window
 */
export function windowSpaces(s: PersistedState, activeSpaceId: string | null | undefined): Space[] {
  const active = spaceById(s, activeSpaceId)
  if (active?.incognito) return [active]
  return sortedSpaces(s).filter((x) => !x.incognito)
}

/** spaces outside any private window: targets for menus and pickers that are not tied to a window */
export function regularSpaces(s: PersistedState): Space[] {
  return sortedSpaces(s).filter((x) => !x.incognito)
}

export function favoritesFor(s: PersistedState, profileId: string): Item[] {
  return s.items.filter((i) => i.section === 'favorites' && i.profileId === profileId && !i.parentId).sort(byOrder)
}

export function sectionItems(s: PersistedState, spaceId: string, section: Exclude<Section, 'favorites'>): Item[] {
  return s.items.filter((i) => i.spaceId === spaceId && i.section === section && !i.parentId && i.blankWindow === undefined).sort(byOrder)
}

/** round 5: the Today tabs a blank window owns */
export function blankItems(s: PersistedState, windowId: number): Item[] {
  return s.items.filter((i) => i.blankWindow === windowId && !i.parentId).sort(byOrder)
}

export function childrenOf(s: PersistedState, parentId: string): Item[] {
  return s.items.filter((i) => i.parentId === parentId).sort(byOrder)
}

/** depth-first flatten, skipping children of collapsed folders when visibleOnly */
export function flatten(s: PersistedState, roots: Item[], visibleOnly: boolean): Item[] {
  const out: Item[] = []
  const walk = (list: Item[]): void => {
    for (const it of list) {
      out.push(it)
      if (isContainer(it) && !(visibleOnly && it.collapsed)) walk(childrenOf(s, it.id))
    }
  }
  walk(roots)
  return out
}

/** round 3b: folders and Live Folders hold tabs but are not tabs themselves */
export function isContainer(item: Item): boolean {
  return item.kind === 'folder' || item.kind === 'liveFolder'
}

/** every activatable item in sidebar order: favorites, pinned, today */
export function sidebarOrder(s: PersistedState, space: Space, visibleOnly = true): Item[] {
  return [
    ...favoritesFor(s, space.profileId),
    ...flatten(s, sectionItems(s, space.id, 'pinned'), visibleOnly),
    ...sectionItems(s, space.id, 'today')
  ].filter((i) => !isContainer(i))
}

/** items that belong to a space for the purpose of switching (favorites of its profile included) */
export function itemVisibleInSpace(item: Item, space: Space): boolean {
  if (item.section === 'favorites') return item.profileId === space.profileId
  return item.spaceId === space.id && item.blankWindow === undefined
}

export function nextOrder(items: Item[]): number {
  return items.reduce((m, i) => Math.max(m, i.order), -1) + 1
}

export function itemTitle(item: Item): string {
  if (item.kind === 'folder') return item.customTitle || item.title || 'Folder'
  return item.customTitle || item.title || item.url || 'Untitled'
}

/** every item below a folder, depth first */
export function descendantsOf(s: PersistedState, id: string): Item[] {
  const out: Item[] = []
  const walk = (pid: string, depth: number): void => {
    if (depth > 32) return
    for (const c of childrenOf(s, pid)) {
      out.push(c)
      // folders, Live Folders and splits all hold child items
      if (c.kind !== 'tab') walk(c.id, depth + 1)
    }
  }
  walk(id, 0)
  return out
}

/** true when `id` is `ancestorId` or sits somewhere below it */
export function isWithin(s: PersistedState, id: string | null | undefined, ancestorId: string): boolean {
  let cur = s.items.find((i) => i.id === id)
  for (let guard = 0; cur && guard < 64; guard++) {
    if (cur.id === ancestorId) return true
    const pid = cur.parentId
    cur = pid ? s.items.find((i) => i.id === pid) : undefined
  }
  return false
}

/** nesting depth of an item inside pinned folders (0 at the top level) */
export function depthOf(s: PersistedState, item: Item): number {
  let d = 0
  let pid = item.parentId
  while (pid && d < 32) {
    const parent = s.items.find((i) => i.id === pid)
    if (!parent) break
    d++
    pid = parent.parentId
  }
  return d
}

/** the items an item is ordered among: same section and parent, same space (or same profile for favorites) */
export function siblingsOf(s: PersistedState, where: { section: Section; spaceId: string | null; profileId: string; parentId: string | null }): Item[] {
  if (where.section === 'favorites') return favoritesFor(s, where.profileId)
  if (where.parentId) return childrenOf(s, where.parentId)
  return sectionItems(s, where.spaceId ?? '', where.section)
}

/** URLs compare equal ignoring a trailing slash and the fragment */
export function sameUrl(a: string | null | undefined, b: string | null | undefined): boolean {
  const norm = (u: string): string => u.replace(/#.*$/, '').replace(/\/$/, '')
  return norm(a ?? '') === norm(b ?? '')
}

/** a pinned or favorite tab that navigated away from its pinned URL */
export function awayFromPinned(item: Item): boolean {
  return item.kind === 'tab' && item.section !== 'today' && Boolean(item.pinnedUrl) && !sameUrl(item.url, item.pinnedUrl)
}

export function spaceCounts(s: PersistedState, spaceId: string): { pinned: number; today: number; folders: number } {
  let pinned = 0
  let today = 0
  let folders = 0
  for (const i of s.items) {
    if (i.spaceId !== spaceId) continue
    if (i.kind === 'folder') folders++
    else if (i.section === 'pinned') pinned++
    else if (i.section === 'today') today++
  }
  return { pinned, today, folders }
}

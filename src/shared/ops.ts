// Pure helpers over the persisted state, used by main and renderers.
import type { Item, PersistedState, Section, Space } from './types'

export const byOrder = (a: Item, b: Item): number => a.order - b.order

export function spaceById(s: PersistedState, id: string | null | undefined): Space | undefined {
  return s.spaces.find((x) => x.id === id)
}

export function sortedSpaces(s: PersistedState): Space[] {
  return [...s.spaces].sort((a, b) => a.order - b.order)
}

export function favoritesFor(s: PersistedState, profileId: string): Item[] {
  return s.items.filter((i) => i.section === 'favorites' && i.profileId === profileId && !i.parentId).sort(byOrder)
}

export function sectionItems(s: PersistedState, spaceId: string, section: Exclude<Section, 'favorites'>): Item[] {
  return s.items.filter((i) => i.spaceId === spaceId && i.section === section && !i.parentId).sort(byOrder)
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
      if (it.kind === 'folder' && !(visibleOnly && it.collapsed)) walk(childrenOf(s, it.id))
    }
  }
  walk(roots)
  return out
}

/** every activatable item in sidebar order: favorites, pinned, today */
export function sidebarOrder(s: PersistedState, space: Space, visibleOnly = true): Item[] {
  return [
    ...favoritesFor(s, space.profileId),
    ...flatten(s, sectionItems(s, space.id, 'pinned'), visibleOnly),
    ...sectionItems(s, space.id, 'today')
  ].filter((i) => i.kind !== 'folder')
}

/** items that belong to a space for the purpose of switching (favorites of its profile included) */
export function itemVisibleInSpace(item: Item, space: Space): boolean {
  if (item.section === 'favorites') return item.profileId === space.profileId
  return item.spaceId === space.id
}

export function nextOrder(items: Item[]): number {
  return items.reduce((m, i) => Math.max(m, i.order), -1) + 1
}

export function itemTitle(item: Item): string {
  return item.customTitle || item.title || item.url || 'Untitled'
}

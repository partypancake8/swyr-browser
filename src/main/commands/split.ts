// Split View: an item of kind 'split' whose panes are ordinary tab items parented to it.
// Pane items keep parentId = split.id and mirror the split's section, space and profile.
import type { Item, PersistedState, SplitEdge, SplitPanes } from '@shared/types'
import { nextOrder, sectionItems, favoritesFor } from '@shared/ops'
import { resolveWithSettings } from '@shared/url'
import { MAX_PANES, normalizeRatios, ratiosForDrag, computeLayout } from '../layout/Layout'
import { newId } from '../util/id'
import { archiveItems, makeItem } from './builtins'
import type { Commands } from './Commands'
import type { Core } from '../windows/WindowManager'
import type { SwyrWindow } from '../windows/SwyrWindow'

type SplitItem = Item & { panes: SplitPanes }
type Edge = SplitEdge

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

export function isSplit(item: Item | undefined | null): item is SplitItem {
  return Boolean(item && item.kind === 'split' && item.panes)
}

export function itemById(s: PersistedState, id: string | null | undefined): Item | undefined {
  return id ? s.items.find((i) => i.id === id) : undefined
}

/** the split an item is a pane of */
export function parentSplit(s: PersistedState, item: Item | undefined): SplitItem | undefined {
  if (!item?.parentId) return undefined
  const parent = itemById(s, item.parentId)
  return isSplit(parent) ? parent : undefined
}

export function focusedIndex(split: SplitItem): number {
  const n = split.panes.itemIds.length
  return Math.max(0, Math.min(n - 1, split.panes.focused ?? 0))
}

/** the item whose page has focus: the focused pane for a split, else the item itself */
export function focusedPaneId(_s: PersistedState, item: Item | undefined): string | undefined {
  if (!item) return undefined
  if (isSplit(item)) return item.panes.itemIds[focusedIndex(item)]
  return item.id
}

/** for commands that act on a page: a split resolves to its focused pane */
export function splitTarget(core: Core, item: Item | undefined): Item | undefined {
  if (!isSplit(item)) return item
  return itemById(core.store.state, focusedPaneId(core.store.state, item)) ?? item
}

/** which tab ids a window shows and how */
export function visiblePanes(w: SwyrWindow): { ids: string[]; split?: { layout: 'horizontal' | 'vertical'; ratios: number[] } } {
  const s = w.core.store.state
  const active = itemById(s, w.activeItemId)
  if (!active) return { ids: [] }
  if (isSplit(active)) {
    const ids = active.panes.itemIds.filter((id) => w.tabs.get(id))
    return { ids, split: { layout: active.panes.layout, ratios: ids.length === active.panes.itemIds.length ? active.panes.ratios : [] } }
  }
  return { ids: w.tabs.get(active.id) ? [active.id] : [] }
}

function placeLike(target: Item, like: Item): void {
  target.section = like.section
  target.spaceId = like.spaceId
  target.profileId = like.profileId
  target.parentId = like.parentId
  target.order = like.order
}

function attachPane(core: Core, split: SplitItem, pane: Item, position: 'start' | 'end'): void {
  const old = parentSplit(core.store.state, pane)
  if (old && old.id !== split.id) old.panes.itemIds = old.panes.itemIds.filter((x) => x !== pane.id)
  if (pane.profileId !== split.profileId) core.destroyItemViews(pane.id)
  pane.parentId = split.id
  pane.section = split.section
  pane.spaceId = split.spaceId
  pane.profileId = split.profileId
  pane.pinnedUrl = split.section === 'today' ? null : (pane.pinnedUrl ?? pane.url)
  const ids = split.panes.itemIds.filter((x) => x !== pane.id)
  if (position === 'start') ids.unshift(pane.id)
  else ids.push(pane.id)
  split.panes.itemIds = ids
  split.panes.ratios = normalizeRatios(ids.length)
  split.panes.focused = ids.indexOf(pane.id)
}

/**
 * add `target` (or a new tab) to the window's active split, creating the split in place of the
 * active tab when the active item is a plain tab; returns the split id
 */
export function addToSplit(
  core: Core,
  w: SwyrWindow,
  opts: { itemId?: string; url?: string; position?: 'start' | 'end'; layout?: 'horizontal' | 'vertical' }
): string | false {
  const s = core.store.state
  const active = itemById(s, w.activeItemId)
  if (!active || active.kind === 'folder') return false
  const target = opts.itemId ? itemById(s, opts.itemId) : undefined
  if (opts.itemId && !target) return false
  if (target && (target.kind !== 'tab' || target.id === active.id)) return false
  const current = isSplit(active) ? active : undefined
  if (current && target && current.panes.itemIds.includes(target.id)) return false
  if (current && current.panes.itemIds.length >= MAX_PANES) return false
  const space = w.space()

  let splitId = ''
  core.store.update((st) => {
    const fresh = (url: string, from?: Item): Item => {
      const it = makeItem(st, {
        url,
        section: 'today',
        profileId: space.profileId,
        spaceId: space.id,
        title: from?.title ?? '',
        favicon: from?.favicon ?? null
      })
      st.items.push(it)
      return it
    }
    // favorites stay favorites: their page joins the split as a copy
    let pane = target
    if (!pane) pane = fresh(opts.url ? resolveWithSettings(opts.url, st.settings).url : 'swyr://newtab')
    else if (pane.section === 'favorites') pane = fresh(pane.url, pane)

    let split = current
    if (!split) {
      let base = active
      if (active.section === 'favorites') {
        base = fresh(active.url, active)
        base.order = nextOrder(sectionItems(st, space.id, 'today'))
      }
      const made = makeItem(st, {
        url: base.url,
        title: base.title,
        favicon: base.favicon,
        section: base.section,
        profileId: base.profileId,
        spaceId: base.spaceId,
        parentId: base.parentId
      })
      split = { ...made, id: newId('split'), kind: 'split', order: base.order, panes: { itemIds: [base.id], layout: opts.layout ?? 'horizontal', ratios: [1], focused: 0 } } as SplitItem
      st.items.push(split)
      base.parentId = split.id
      base.order = 0
      if (base.profileId !== split.profileId) core.destroyItemViews(base.id)
    }
    if (opts.layout) split.panes.layout = opts.layout
    attachPane(core, split, pane, opts.position ?? 'end')
    splitId = split.id
  })
  w.activate(splitId)
  return splitId
}

/** remove one pane; the tab is archived unless `keep`, in which case it becomes a tab after the split */
export function removePane(core: Core, pane: Item, keep = false): boolean {
  const s = core.store.state
  const split = parentSplit(s, pane)
  if (!split) return false
  const idx = split.panes.itemIds.indexOf(pane.id)
  core.store.update((st) => {
    const ids = split.panes.itemIds.filter((x) => x !== pane.id)
    const ratios = split.panes.ratios.filter((_, i) => i !== idx)
    split.panes.itemIds = ids
    split.panes.ratios = normalizeRatios(ids.length, ratios.length === ids.length ? ratios : undefined)
    split.panes.focused = Math.max(0, Math.min(ids.length - 1, idx > 0 ? idx - 1 : 0))
    if (keep) {
      placeLike(pane, split)
      if (pane.section === 'today') pane.pinnedUrl = null
      const siblings =
        split.section === 'favorites'
          ? favoritesFor(st, split.profileId)
          : st.items.filter((i) => i.spaceId === split.spaceId && i.section === split.section && (i.parentId ?? null) === (split.parentId ?? null)).sort((a, b) => a.order - b.order)
      const others = siblings.filter((i) => i.id !== pane.id)
      others.splice(others.indexOf(split) + 1, 0, pane)
      others.forEach((it, i) => (it.order = i))
    }
  })
  if (!keep) archiveItems(core, [pane], 'closed')
  dissolveIfSingle(core, split)
  for (const w of core.windows) w.layout()
  core.scheduleBroadcast()
  return true
}

/** a split with one pane left turns back into that tab, in the split's place */
function dissolveIfSingle(core: Core, split: SplitItem): void {
  const s = core.store.state
  if (!s.items.includes(split) || split.panes.itemIds.length > 1) return
  const remaining = itemById(s, split.panes.itemIds[0])
  core.store.update((st) => {
    if (remaining) placeLike(remaining, split)
    if (!remaining) {
      // nothing left: keep the row as a plain tab of the split's last page
      split.kind = 'tab'
      delete (split as Item).panes
      return
    }
    st.items = st.items.filter((i) => i.id !== split.id)
  })
  if (!remaining) return
  for (const w of core.windows) {
    for (const [space, id] of w.lastActiveBySpace) if (id === split.id) w.lastActiveBySpace.set(space, remaining.id)
    if (w.activeItemId === split.id) w.activate(remaining.id, { focus: false })
  }
}

/** keep pane items consistent with their split; runs after every state change */
export function reconcileSplits(core: Core): void {
  const s = core.store.state
  let changed = false
  const singles: SplitItem[] = []
  for (const split of s.items.filter(isSplit)) {
    const ids = split.panes.itemIds.filter((id) => {
      const it = itemById(s, id)
      return it && it.parentId === split.id && it.kind === 'tab'
    })
    for (const it of s.items) if (it.parentId === split.id && it.kind === 'tab' && !ids.includes(it.id) && ids.length < MAX_PANES) ids.push(it.id)
    if (ids.length !== split.panes.itemIds.length || ids.some((id, i) => id !== split.panes.itemIds[i])) {
      split.panes.itemIds = ids
      split.panes.ratios = normalizeRatios(ids.length)
      changed = true
    }
    if (split.panes.ratios.length !== ids.length) {
      split.panes.ratios = normalizeRatios(ids.length, split.panes.ratios)
      changed = true
    }
    for (const id of ids) {
      const pane = itemById(s, id)!
      if (pane.section !== split.section || pane.spaceId !== split.spaceId || pane.profileId !== split.profileId) {
        pane.section = split.section
        pane.spaceId = split.spaceId
        pane.profileId = split.profileId
        if (split.section !== 'today') pane.pinnedUrl = pane.pinnedUrl ?? pane.url
        else pane.pinnedUrl = null
        changed = true
      }
    }
    const focused = itemById(s, ids[Math.max(0, Math.min(ids.length - 1, split.panes.focused ?? 0))])
    if (focused && (split.url !== focused.url || split.title !== focused.title || split.favicon !== focused.favicon)) {
      split.url = focused.url
      split.title = focused.title
      split.favicon = focused.favicon
      changed = true
    }
    if (ids.length < 2) singles.push(split)
  }
  if (changed) core.store.changed()
  for (const split of singles) dissolveIfSingle(core, split)
  // views of items that no longer exist (archived splits take their panes with them)
  const live = new Set(s.items.map((i) => i.id))
  let relayout = changed || singles.length > 0
  for (const w of core.windows) {
    for (const id of [...w.tabs.views.keys()]) {
      if (!live.has(id)) {
        w.tabs.destroy(id)
        relayout = true
      }
    }
  }
  if (relayout) for (const w of core.windows) w.layout()
}

/** tab.close routing: Cmd+W in a split closes the focused pane; returns undefined to fall through */
export function routeSplitClose(core: Core, w: SwyrWindow | undefined, p: Record<string, unknown>): boolean | undefined {
  const s = core.store.state
  if (!w) return undefined
  const explicit = str(p.id) ?? str(p.itemId)
  const item = itemById(s, explicit ?? w.activeItemId)
  if (!item) return undefined
  if (!explicit && isSplit(item)) {
    const pane = itemById(s, focusedPaneId(s, item))
    return pane ? removePane(core, pane, false) : undefined
  }
  if (parentSplit(s, item)) return removePane(core, item, false)
  if (isSplit(item)) {
    // closing the whole split row unloads (pinned) or archives (today) every pane with it
    for (const id of item.panes.itemIds) core.destroyItemViews(id)
  }
  return undefined
}

function activeSplit(w: SwyrWindow | undefined): SplitItem | undefined {
  if (!w) return undefined
  const it = itemById(w.core.store.state, w.activeItemId)
  return isSplit(it) ? it : undefined
}

function setFocus(core: Core, w: SwyrWindow, split: SplitItem, index: number): boolean {
  const n = split.panes.itemIds.length
  if (!n) return false
  const i = ((index % n) + n) % n
  core.store.update(() => (split.panes.focused = i))
  if (w.activeItemId !== split.id) w.activate(split.id)
  else {
    w.layout()
    w.focusContent()
  }
  core.scheduleBroadcast()
  return true
}

/** pane number (1-based) or item id to a 0-based index */
function paneIndex(split: SplitItem, v: unknown): number {
  if (typeof v === 'string') return split.panes.itemIds.indexOf(v)
  const n = num(v)
  return n === undefined ? -1 : Math.round(n) - 1
}

export function registerSplitCommands(c: Commands): void {
  c.register('split.add', ({ core, w }, p) => {
    if (!w) return false
    return addToSplit(core, w, { itemId: str(p.itemId) ?? str(p.id), url: str(p.url) })
  })

  c.register('split.remove', ({ core, w }, p) => {
    const s = core.store.state
    const explicit = str(p.itemId) ?? str(p.id)
    const split = activeSplit(w)
    const pane = explicit ? itemById(s, explicit) : split ? itemById(s, focusedPaneId(s, split)) : undefined
    if (!pane) return false
    return removePane(core, pane, p.keep === true)
  })

  c.register('split.focus', ({ core, w }, p) => {
    if (!w) return false
    const s = core.store.state
    const itemId = str(p.itemId) ?? str(p.id)
    if (itemId) {
      const it = itemById(s, itemId)
      if (!it) return false
      const parent = parentSplit(s, it)
      if (parent) return setFocus(core, w, parent, parent.panes.itemIds.indexOf(it.id))
      w.activate(it.id)
      return true
    }
    const split = activeSplit(w)
    if (!split) return false
    const delta = num(p.delta)
    if (delta !== undefined) return setFocus(core, w, split, focusedIndex(split) + Math.round(delta))
    const idx = paneIndex(split, p.pane)
    if (idx < 0 || idx >= split.panes.itemIds.length) return false
    return setFocus(core, w, split, idx)
  })
  c.register('split.focusNext', ({ core, w }) => core.commands.run('split.focus', { delta: 1 }, w))
  c.register('split.focusPrev', ({ core, w }) => core.commands.run('split.focus', { delta: -1 }, w))

  c.register('split.swap', ({ core, w }, p) => {
    const split = activeSplit(w)
    if (!split || !w) return false
    const a = paneIndex(split, p.from)
    const b = paneIndex(split, p.to)
    const n = split.panes.itemIds.length
    if (a < 0 || b < 0 || a >= n || b >= n || a === b) return false
    core.store.update(() => {
      const ids = split.panes.itemIds.slice()
      ;[ids[a], ids[b]] = [ids[b], ids[a]]
      const f = focusedIndex(split)
      split.panes.itemIds = ids
      split.panes.focused = f === a ? b : f === b ? a : f
    })
    w.layout()
    return split.panes.itemIds
  })

  c.register('split.setLayout', ({ core, w }, p) => {
    const split = activeSplit(w)
    if (!split || !w) return false
    const layout = p.layout === 'horizontal' || p.layout === 'vertical' ? p.layout : split.panes.layout === 'horizontal' ? 'vertical' : 'horizontal'
    core.store.update(() => (split.panes.layout = layout))
    w.layout()
    return layout
  })

  c.register('split.setRatios', ({ core, w }, p) => {
    const split = activeSplit(w)
    if (!split || !w) return false
    const n = split.panes.itemIds.length
    let ratios: number[] | undefined
    if (Array.isArray(p.ratios) && p.ratios.every((x) => typeof x === 'number')) ratios = normalizeRatios(n, p.ratios as number[])
    else {
      // divider drag from the shell: { divider, pos } in window coordinates
      const divider = num(p.divider)
      const pos = num(p.pos)
      if (divider === undefined || pos === undefined) return false
      const [width, height] = w.win.getContentSize()
      const L = computeLayout({ width, height, sidebarVisible: w.sidebarVisible(), sidebarWidth: core.store.state.settings.sidebarWidth, panes: n, overlay: 'none' })
      ratios = ratiosForDrag(L.content, n, { layout: split.panes.layout, ratios: split.panes.ratios }, divider, pos)
    }
    core.store.update(() => (split.panes.ratios = ratios!))
    w.layout()
    return ratios
  })

  // payload { show } from a native drag; { show, x, y } (window coordinates) from a sidebar pointer drag also highlights the edge under the pointer
  c.register('split.dropZones', ({ core, w }, p) => {
    if (!w) return false
    if (p.show === false) {
      if (w.overlayState?.kind === 'splitDrop') w.closeOverlay(false)
      return true
    }
    const x = num(p.x)
    const y = num(p.y)
    const o = w.overlayState
    if (o?.kind === 'splitDrop') {
      if (x !== undefined && y !== undefined) {
        const edge = edgeAt(w.contentRect(), x, y)
        if (edge !== (o.edge ?? null)) {
          o.edge = edge
          core.scheduleBroadcast()
        }
      }
      return true
    }
    if (!w.activeItemId || (o && o.kind !== 'toast')) return false
    w.openOverlay({ kind: 'splitDrop', edge: x !== undefined && y !== undefined ? edgeAt(w.contentRect(), x, y) : null, baseId: str(p.baseId) ?? null }, false)
    core.scheduleBroadcast()
    return true
  })

  // payload { itemId, edge } from the drop zones, or { itemId, x, y } (window coordinates) from a sidebar pointer drag
  // baseId: the item that was on screen before the press that started the drag (pressing a sidebar row activates it)
  c.register('split.drop', ({ core, w }, p) => {
    if (!w) return false
    const o = w.overlayState
    const baseId = str(p.baseId) ?? (o?.kind === 'splitDrop' ? (o.baseId ?? undefined) : undefined)
    if (o?.kind === 'splitDrop') w.closeOverlay(false)
    const itemId = str(p.itemId) ?? str(p.id)
    const x = num(p.x)
    const y = num(p.y)
    const edge = (str(p.edge) as Edge | undefined) ?? (x !== undefined && y !== undefined ? (edgeAt(w.contentRect(), x, y) ?? undefined) : undefined)
    if (!itemId || !edge || !['left', 'right', 'top', 'bottom'].includes(edge)) return false
    if (baseId && baseId !== itemId && itemById(core.store.state, baseId) && w.activeItemId === itemId) w.activate(baseId, { focus: false })
    return addToSplit(core, w, {
      itemId,
      position: edge === 'left' || edge === 'top' ? 'start' : 'end',
      layout: edge === 'left' || edge === 'right' ? 'horizontal' : 'vertical'
    })
  })
}

/** the drop edge under a point of the content area: the outer 20 % on each side, nothing in the middle or outside */
export function edgeAt(r: { x: number; y: number; width: number; height: number }, px: number, py: number): Edge | null {
  if (px < r.x || py < r.y || px > r.x + r.width || py > r.y + r.height) return null
  const x = (px - r.x) / Math.max(1, r.width)
  const y = (py - r.y) / Math.max(1, r.height)
  if (x < 0.2) return 'left'
  if (x > 0.8) return 'right'
  if (y < 0.2) return 'top'
  if (y > 0.8) return 'bottom'
  return null
}

/** helpers the window uses when activating: pane ids resolve to their split */
export function resolveActivation(core: Core, item: Item): { item: Item; focus?: number } {
  const parent = parentSplit(core.store.state, item)
  if (parent) return { item: parent, focus: parent.panes.itemIds.indexOf(item.id) }
  return { item }
}

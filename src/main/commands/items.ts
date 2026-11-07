// Sidebar item commands: moving, pinning, favorites, rename, pinned-URL reset, folders, archive, library, menus.
import { Menu, clipboard, type MenuItemConstructorOptions } from 'electron'
import type { DialogKind, Item, MenuEntry, PersistedState, Section } from '@shared/types'
import { childrenOf, descendantsOf, isWithin, itemVisibleInSpace, nextOrder, siblingsOf, sortedSpaces, spaceById } from '@shared/ops'
import { resolveWithSettings } from '@shared/url'
import { newId } from '../util/id'
import { splitTarget } from './split'
import type { Commands } from './Commands'
import type { Core } from '../windows/WindowManager'
import type { SwyrWindow } from '../windows/SwyrWindow'

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const SECTIONS: Section[] = ['favorites', 'pinned', 'today']

/** payloads name the item `itemId` (round 2 contract) or `id` (round 1); both work, the active item is the fallback */
function itemIdOf(p: Record<string, unknown>): string | undefined {
  return str(p.itemId) ?? str(p.id)
}

function findItem(core: Core, p: Record<string, unknown>, w?: SwyrWindow): Item | undefined {
  const id = itemIdOf(p) ?? w?.activeItemId ?? undefined
  return core.store.state.items.find((i) => i.id === id)
}

function renumber(list: Item[]): void {
  list.forEach((it, i) => (it.order = i))
}

/** windows whose active item is no longer visible in their space move on to another item */
function settleWindows(core: Core, movedIds: Set<string>, reloadIds: Set<string>): void {
  for (const id of reloadIds) core.destroyItemViews(id)
  for (const w of core.windows) {
    const id = w.activeItemId
    if (!id || !movedIds.has(id)) continue
    const item = core.store.state.items.find((i) => i.id === id)
    if (item && itemVisibleInSpace(item, w.space())) {
      if (reloadIds.has(id)) w.activate(id, { focus: false })
      continue
    }
    w.activeItemId = null
    w.lastActiveBySpace.delete(w.activeSpaceId)
    const pick = w.pickItemForSpace(w.space())
    w.activate(pick?.id ?? null, { focus: false })
  }
  for (const w of core.windows) w.layout()
  core.scheduleBroadcast()
}

export interface MoveTarget {
  section: Section
  spaceId?: string | null
  parentId?: string | null
  index?: number
}

/**
 * Move an item to a section, folder, position and space.
 * pinned: pinnedUrl defaults to the current url. today: pinnedUrl and parentId cleared.
 * favorites: spaceId null, profileId from the space, pinnedUrl kept or set.
 */
export function moveItem(core: Core, w: SwyrWindow | undefined, item: Item, target: MoveTarget): boolean {
  const s = core.store.state
  const section = target.section
  if (!SECTIONS.includes(section)) return false
  if (item.kind === 'folder' && section !== 'pinned') return false
  const space = spaceById(s, target.spaceId ?? undefined) ?? spaceById(s, item.spaceId) ?? w?.space() ?? sortedSpaces(s)[0]
  let parentId: string | null = null
  if (section === 'pinned' && target.parentId) {
    const parent = s.items.find((i) => i.id === target.parentId)
    const valid = parent && parent.kind === 'folder' && parent.spaceId === space.id && !(item.kind === 'folder' && isWithin(s, parent.id, item.id))
    parentId = valid ? parent.id : null
  }
  const moved = new Set([item.id])
  const reload = new Set<string>()
  const oldProfile = item.profileId
  core.store.update((st: PersistedState) => {
    item.section = section
    item.parentId = parentId
    item.profileId = space.profileId
    item.spaceId = section === 'favorites' ? null : space.id
    if (item.kind === 'tab') {
      if (section === 'today') item.pinnedUrl = null
      else item.pinnedUrl = item.pinnedUrl ?? item.url
    }
    if (oldProfile !== space.profileId && item.kind === 'tab') reload.add(item.id)
    if (item.kind === 'split') {
      // split panes mirror their split's section, space and profile
      for (const pane of childrenOf(st, item.id)) {
        moved.add(pane.id)
        if (pane.profileId !== space.profileId && pane.kind === 'tab') {
          reload.add(pane.id)
          reload.add(item.id)
        }
        pane.section = section
        pane.spaceId = item.spaceId
        pane.profileId = space.profileId
        if (pane.kind === 'tab') pane.pinnedUrl = section === 'today' ? null : (pane.pinnedUrl ?? pane.url)
      }
    }
    if (item.kind === 'folder') {
      for (const d of descendantsOf(st, item.id)) {
        moved.add(d.id)
        if (d.profileId !== space.profileId && d.kind === 'tab') reload.add(d.id)
        d.spaceId = space.id
        d.profileId = space.profileId
        d.section = 'pinned'
      }
    }
    const others = siblingsOf(st, { section, spaceId: item.spaceId, profileId: item.profileId, parentId }).filter((i) => i.id !== item.id)
    const index = Math.max(0, Math.min(others.length, Math.round(target.index ?? others.length)))
    others.splice(index, 0, item)
    renumber(others)
  })
  settleWindows(core, moved, reload)
  return true
}

function folderIn(core: Core, id: string | undefined, spaceId: string): Item | undefined {
  const f = core.store.state.items.find((i) => i.id === id)
  return f && f.kind === 'folder' && f.spaceId === spaceId ? f : undefined
}

function startRename(core: Core, w: SwyrWindow, item: Item): void {
  if (item.section === 'favorites') {
    w.openOverlay({ kind: 'dialog', dialog: 'rename', itemId: item.id })
    return
  }
  if (!core.store.state.settings.sidebarVisible) core.store.update((s) => (s.settings.sidebarVisible = true))
  // reveal the row: open every collapsed folder above it
  let pid = item.parentId
  const s = core.store.state
  const opened: Item[] = []
  for (let guard = 0; pid && guard < 32; guard++) {
    const parent = s.items.find((i) => i.id === pid)
    if (!parent) break
    if (parent.collapsed) opened.push(parent)
    pid = parent.parentId
  }
  if (opened.length) core.store.update(() => opened.forEach((f) => (f.collapsed = false)))
  w.renamingItemId = item.id
  w.layout()
  if (!w.shell.webContents.isDestroyed()) w.shell.webContents.focus()
}

function rename(core: Core, w: SwyrWindow | undefined, item: Item, p: Record<string, unknown>): boolean {
  if (typeof p.title === 'string') {
    const title = p.title.trim()
    core.store.update(() => {
      if (item.kind === 'folder') item.title = title || item.title || 'New Folder'
      else item.customTitle = title || null
    })
    if (w && w.renamingItemId === item.id) w.renamingItemId = null
  } else if (p.cancel === true) {
    if (w) w.renamingItemId = null
  } else if (w) {
    startRename(core, w, item)
  }
  core.scheduleBroadcast()
  return true
}

function buildMenu(core: Core, w: SwyrWindow, entries: MenuEntry[]): MenuItemConstructorOptions[] {
  return entries.slice(0, 64).map((e): MenuItemConstructorOptions => {
    if (e.type === 'separator') return { type: 'separator' }
    const opt: MenuItemConstructorOptions = { label: String(e.label ?? ''), enabled: e.enabled !== false }
    if (e.type === 'checkbox') {
      opt.type = 'checkbox'
      opt.checked = Boolean(e.checked)
    }
    if (Array.isArray(e.submenu)) opt.submenu = buildMenu(core, w, e.submenu)
    else if (typeof e.command === 'string' && e.command !== 'menu.popup') {
      const command = e.command
      opt.click = () => void core.commands.run(command, e.payload, w).catch((err) => console.error('[swyr]', command, err))
    }
    return opt
  })
}

function openPage(core: Core, w: SwyrWindow, base: string, url: string): Promise<unknown> | unknown {
  const s = core.store.state
  const space = w.space()
  const match = (i: Item): boolean => i.kind === 'tab' && i.url.startsWith(base)
  const existing = s.items.find((i) => match(i) && i.spaceId === space.id) ?? s.items.find((i) => match(i) && i.section !== 'favorites')
  if (existing) {
    if (existing.url !== url && url !== base) return core.commands.run('tab.navigate', { itemId: existing.id, url }, w).then(() => existing.id)
    w.activate(existing.id)
    return existing.id
  }
  return core.commands.run('tab.new', { url }, w)
}

const LIBRARY_SECTIONS = new Set(['archive', 'spaces', 'downloads', 'notes', 'canvases', 'styles', 'media'])
const DIALOGS = new Set<DialogKind>(['rename', 'confirmDeleteSpace', 'confirmClearArchive'])

export function registerItemCommands(c: Commands): void {
  // ----- moving between sections, folders and spaces
  c.register('tab.move', ({ core, w }, p) => {
    const item = findItem(core, p, w)
    if (!item) return false
    const section = (SECTIONS as string[]).includes(String(p.section)) ? (p.section as Section) : item.section
    const parentId = p.parentId === null ? null : str(p.parentId)
    return moveItem(core, w, item, { section, spaceId: str(p.spaceId), parentId, index: num(p.index) })
  })

  c.register('tab.pin', ({ core, w }, p) => {
    const item = findItem(core, p, w)
    if (!item) return false
    if (item.section !== 'pinned') moveItem(core, w, item, { section: 'pinned', spaceId: item.spaceId ?? w?.activeSpaceId, index: num(p.index) })
    return true
  })

  c.register('tab.unpin', ({ core, w }, p) => {
    const item = findItem(core, p, w)
    if (!item || item.kind === 'folder') return false
    if (item.section !== 'today') moveItem(core, w, item, { section: 'today', spaceId: item.spaceId ?? w?.activeSpaceId, index: num(p.index) })
    return true
  })

  c.register('tab.togglePin', ({ core, w }, p) => {
    const item = findItem(core, p, w)
    if (!item) return false
    return core.commands.run(item.section === 'today' ? 'tab.pin' : 'tab.unpin', { itemId: item.id }, w)
  })

  c.register('tab.favorite', ({ core, w }, p) => {
    const item = findItem(core, p, w)
    if (!item || item.kind === 'folder') return false
    if (item.section === 'favorites') {
      // already a favorite: only an explicit toggle removes it
      if (p.toggle === true) moveItem(core, w, item, { section: 'today', spaceId: w?.activeSpaceId })
      else if (num(p.index) !== undefined) moveItem(core, w, item, { section: 'favorites', index: num(p.index) })
      return true
    }
    return moveItem(core, w, item, { section: 'favorites', spaceId: item.spaceId ?? w?.activeSpaceId, index: num(p.index) })
  })

  c.register('tab.unfavorite', ({ core, w }, p) => {
    const item = findItem(core, p, w)
    if (!item || item.section !== 'favorites') return false
    return moveItem(core, w, item, { section: str(p.section) === 'pinned' ? 'pinned' : 'today', spaceId: str(p.spaceId) ?? w?.activeSpaceId, index: num(p.index) })
  })

  // ----- rename and pinned url
  c.register('tab.rename', ({ core, w }, p) => {
    const item = findItem(core, p, w)
    if (!item) return false
    return rename(core, w, item, p)
  })

  c.register('tab.resetToPinnedUrl', ({ core, w }, p) => {
    const item = findItem(core, p, w)
    if (!item?.pinnedUrl || !w) return false
    return core.commands.run('tab.navigate', { itemId: item.id, url: item.pinnedUrl }, w)
  })

  c.register('tab.navigate', ({ core, w }, p) => {
    if (!w) return false
    const input = str(p.url) ?? str(p.input)
    if (!input) return false
    const url = resolveWithSettings(input, core.store.state.settings).url
    const item = splitTarget(core, findItem(core, p, w))
    if (!item || item.kind === 'folder') return core.commands.run('tab.new', { url }, w)
    core.store.update(() => (item.url = url))
    const view = w.tabs.get(item.id)
    if (view) void view.webContents.loadURL(url).catch(() => undefined)
    if (w.activeItemId !== item.id) w.activate(item.id)
    else w.focusContent()
    return true
  })

  c.register('item.copyUrl', ({ core, w }, p) => {
    const item = findItem(core, p, w)
    if (!item || item.kind === 'folder') return false
    clipboard.writeText(item.url)
    w?.toast('Copied URL')
    return item.url
  })

  // ----- folders
  c.register('folder.new', ({ core, w }, p) => {
    const s = core.store.state
    const space = spaceById(s, str(p.spaceId)) ?? w?.space() ?? sortedSpaces(s)[0]
    const parent = folderIn(core, str(p.parentId), space.id)
    const now = Date.now()
    const siblings = parent ? childrenOf(s, parent.id) : siblingsOf(s, { section: 'pinned', spaceId: space.id, profileId: space.profileId, parentId: null })
    const folder: Item = {
      id: newId('folder'),
      spaceId: space.id,
      profileId: space.profileId,
      parentId: parent?.id ?? null,
      section: 'pinned',
      kind: 'folder',
      order: nextOrder(siblings),
      customTitle: null,
      pinnedUrl: null,
      url: '',
      title: (str(p.name) ?? str(p.title) ?? 'New Folder').trim() || 'New Folder',
      favicon: null,
      collapsed: false,
      createdAt: now,
      lastActiveAt: now
    }
    core.store.update((st) => {
      st.items.push(folder)
      if (parent) parent.collapsed = false
    })
    if (Array.isArray(p.itemIds)) {
      for (const id of p.itemIds) {
        const it = core.store.state.items.find((i) => i.id === id)
        if (it && it.id !== folder.id) moveItem(core, w, it, { section: 'pinned', spaceId: space.id, parentId: folder.id })
      }
    }
    if (p.rename === true && w) startRename(core, w, folder)
    core.scheduleBroadcast()
    return folder.id
  })

  c.register('folder.rename', ({ core, w }, p) => {
    const item = findItem(core, p, undefined)
    if (!item || item.kind !== 'folder') return false
    return rename(core, w, item, p)
  })

  c.register('folder.toggle', ({ core }, p) => {
    const item = findItem(core, p, undefined)
    if (!item || item.kind !== 'folder') return false
    const next = typeof p.collapsed === 'boolean' ? p.collapsed : !item.collapsed
    core.store.update(() => (item.collapsed = next))
    return next
  })

  c.register('folder.delete', ({ core }, p) => {
    const folder = findItem(core, p, undefined)
    if (!folder || folder.kind !== 'folder') return false
    core.store.update((st) => {
      const kids = childrenOf(st, folder.id)
      const where = { section: 'pinned' as const, spaceId: folder.spaceId, profileId: folder.profileId, parentId: folder.parentId }
      const siblings = siblingsOf(st, where)
      const at = siblings.findIndex((i) => i.id === folder.id)
      const rest = siblings.filter((i) => i.id !== folder.id)
      for (const k of kids) k.parentId = folder.parentId
      rest.splice(at < 0 ? rest.length : at, 0, ...kids)
      renumber(rest)
      st.items = st.items.filter((i) => i.id !== folder.id)
    })
    return true
  })

  // ----- archive
  c.register('archive.restore', ({ core, w }, p) => {
    if (!w) return false
    const s = core.store.state
    const id = str(p.id) ?? str(p.itemId)
    const entry = id
      ? (s.archive.find((a) => a.id === id) ?? s.archive.find((a) => a.item.id === id))
      : [...s.archive].sort((a, b) => b.archivedAt - a.archivedAt)[0]
    if (!entry) return false
    const snap = entry.item
    const space = spaceById(s, snap.spaceId) ?? w.space()
    const isFolder = snap.kind === 'folder'
    const section: Section = isFolder ? 'pinned' : 'today'
    const siblings = siblingsOf(s, { section, spaceId: space.id, profileId: space.profileId, parentId: null })
    const now = Date.now()
    const item: Item = {
      ...snap,
      id: s.items.some((i) => i.id === snap.id) ? newId(isFolder ? 'folder' : 'tab') : snap.id,
      section,
      parentId: null,
      spaceId: space.id,
      profileId: space.profileId,
      pinnedUrl: null,
      order: nextOrder(siblings),
      lastActiveAt: now
    }
    if (item.kind === 'tab' && !item.url) item.url = 'swyr://newtab'
    core.store.update((st) => {
      st.archive = st.archive.filter((a) => a.id !== entry.id)
      st.items.push(item)
    })
    if (space.id !== w.activeSpaceId) w.switchSpace(space.id)
    if (!isFolder && p.activate !== false) w.activate(item.id)
    return item.id
  })

  c.register('archive.delete', ({ core }, p) => {
    const id = str(p.id)
    if (!id || !core.store.state.archive.some((a) => a.id === id)) return false
    core.store.update((st) => (st.archive = st.archive.filter((a) => a.id !== id)))
    return true
  })

  c.register('archive.clear', ({ core }) => {
    const n = core.store.state.archive.length
    core.store.update((st) => (st.archive = []))
    return n
  })

  // ----- library
  c.register('library.open', ({ core, w }, p) => {
    if (!w) return undefined
    const section = str(p.section)
    const url = section && LIBRARY_SECTIONS.has(section) ? `swyr://library/#${section}` : 'swyr://library/'
    return openPage(core, w, 'swyr://library', url)
  })

  // ----- dialogs and native menus built by the renderer
  c.register('dialog.open', ({ w }, p) => {
    const dialog = str(p.dialog) as DialogKind | undefined
    if (!w || !dialog || !DIALOGS.has(dialog)) return false
    w.openOverlay({ kind: 'dialog', dialog, itemId: str(p.itemId), spaceId: str(p.spaceId) })
    return true
  })

  c.register('menu.popup', ({ core, w }, p) => {
    if (!w || !Array.isArray(p.entries)) return false
    const entries = p.entries as MenuEntry[]
    if (core.test) return entries.map((e) => e.label ?? '-')
    const x = num(p.x)
    const y = num(p.y)
    Menu.buildFromTemplate(buildMenu(core, w, entries)).popup({ window: w.win, ...(x !== undefined && y !== undefined ? { x: Math.round(x), y: Math.round(y) } : {}) })
    return true
  })
}

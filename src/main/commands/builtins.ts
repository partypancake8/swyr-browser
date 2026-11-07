// Built-in commands. Menus, shortcuts, the command bar, IPC and the test hook all call these.
import { app, clipboard, shell } from 'electron'
import type { ArchiveReason, Item, PersistedState, Section, Settings } from '@shared/types'
import { nextOrder, sectionItems, sidebarOrder, spaceById, favoritesFor, itemTitle, windowSpaces } from '@shared/ops'
import { resolveWithSettings } from '@shared/url'
import { clampSidebar } from '../layout/Layout'
import { newId } from '../util/id'
import type { CommandContext, Commands } from './Commands'
import { registerItemCommands } from './items'
import { registerSpaceCommands } from './spaces'
import { registerPlatformCommands } from './platform'
import { registerPageCommands } from './pages'
import { registerDocumentCommands } from './documents' // round 3b
import type { Core } from '../windows/WindowManager'
import type { SwyrWindow } from '../windows/SwyrWindow'
import { routeSplitClose } from './split'
import { registerAppCommands } from './app'

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

function findItem(core: Core, id: unknown, w?: SwyrWindow): Item | undefined {
  const s = core.store.state
  const target = str(id) ?? w?.activeItemId
  return s.items.find((i) => i.id === target)
}

export function makeItem(s: PersistedState, p: Partial<Item> & { url: string; section: Section; profileId: string }): Item {
  const now = Date.now()
  const siblings =
    p.section === 'favorites'
      ? favoritesFor(s, p.profileId)
      : s.items.filter((i) => i.spaceId === p.spaceId && i.section === p.section && (i.parentId ?? null) === (p.parentId ?? null))
  return {
    id: newId('tab'),
    spaceId: null,
    parentId: null,
    kind: 'tab',
    order: nextOrder(siblings),
    customTitle: null,
    pinnedUrl: null,
    title: '',
    favicon: null,
    createdAt: now,
    lastActiveAt: now,
    ...p
  }
}

/** the item to show after `item` leaves the sidebar: the next one below, else the one above */
function neighbor(core: Core, w: SwyrWindow, item: Item, exclude: Set<string>): Item | undefined {
  const order = sidebarOrder(core.store.state, w.space()).filter((i) => i.section !== 'favorites')
  const idx = order.findIndex((i) => i.id === item.id)
  const rest = order.filter((i) => !exclude.has(i.id))
  if (idx < 0) return rest[0]
  const below = order.slice(idx + 1).find((i) => !exclude.has(i.id))
  const above = [...order.slice(0, idx)].reverse().find((i) => !exclude.has(i.id))
  return below ?? above
}

function archiveItems(core: Core, items: Item[], reason: ArchiveReason): void {
  if (!items.length) return
  const ids = new Set(items.map((i) => i.id))
  const now = Date.now()
  // windows that show one of these items move on to a neighbor first
  for (const w of core.windows) {
    if (w.activeItemId && ids.has(w.activeItemId)) {
      const current = core.store.state.items.find((i) => i.id === w.activeItemId)
      const next = current ? neighbor(core, w, current, ids) : undefined
      w.activeItemId = null
      w.lastActiveBySpace.delete(w.activeSpaceId)
      if (next) w.activate(next.id)
    }
  }
  core.store.update((s) => {
    for (const it of items) s.archive.push({ id: newId('arch'), item: { ...it }, archivedAt: now, reason })
    s.items = s.items.filter((i) => !ids.has(i.id) && !(i.parentId && ids.has(i.parentId)))
  })
  for (const id of ids) core.destroyItemViews(id)
  for (const w of core.windows) w.layout()
}

export { archiveItems }

function openInternal(ctx: CommandContext, url: string): unknown {
  const { core, w } = ctx
  if (!w) return undefined
  const s = core.store.state
  const space = w.space()
  const existing = s.items.find((i) => i.spaceId === space.id && i.url.startsWith(url))
  if (existing) {
    w.activate(existing.id)
    return existing.id
  }
  return core.commands.run('tab.new', { url }, w)
}

export function registerBuiltins(c: Commands): void {
  // ----- tabs
  c.register('tab.new', ({ core, w }, p) => {
    if (!w) return undefined
    const s = core.store.state
    const space = spaceById(s, str(p.spaceId)) ?? w.space()
    const input = str(p.url) ?? str(p.input)
    const url = input ? resolveWithSettings(input, s.settings).url : 'swyr://newtab'
    const section = (str(p.section) as Section | undefined) ?? 'today'
    const item = makeItem(s, {
      url,
      section,
      profileId: space.profileId,
      spaceId: section === 'favorites' ? null : space.id,
      title: str(p.title) ?? ''
    })
    if (section !== 'today') item.pinnedUrl = url
    core.store.update((st) => st.items.push(item))
    if (p.background === true) {
      w.tabs.ensure(item)
      core.scheduleBroadcast()
    } else {
      if (space.id !== w.activeSpaceId) w.activeSpaceId = space.id
      w.activate(item.id)
    }
    return item.id
  })

  c.register('tab.activate', ({ core, w }, p) => {
    const item = findItem(core, p.id, w)
    if (!w || !item) return false
    w.activate(item.id)
    return true
  })

  c.register('tab.goTo', ({ core, w }, p) => {
    if (!w) return false
    const list = sidebarOrder(core.store.state, w.space())
    const index = num(p.index) ?? 0
    const item = list[index]
    if (item) w.activate(item.id)
    return Boolean(item)
  })

  c.register('tab.close', ({ core, w }, p) => {
    const routed = routeSplitClose(core, w, p)
    if (routed !== undefined) return routed
    const item = findItem(core, p.id, w)
    if (!w || !item) return false
    if (item.section !== 'today' && p.remove !== true) {
      // pinned and favorite tabs stay in the sidebar; closing unloads them
      if (w.activeItemId === item.id) {
        const next = neighbor(core, w, item, new Set([item.id]))
        w.activeItemId = null
        w.lastActiveBySpace.delete(w.activeSpaceId)
        if (next) w.activate(next.id)
      }
      core.destroyItemViews(item.id)
      core.store.update(() => {
        if (item.pinnedUrl) item.url = item.pinnedUrl
      })
      w.layout()
      return true
    }
    archiveItems(core, [item], p.remove === true ? 'manual' : 'closed')
    return true
  })

  c.register('tab.reopen', ({ core, w }) => core.commands.run('archive.restore', {}, w))

  c.register('tab.duplicate', ({ core, w }, p) => {
    const item = findItem(core, p.id, w)
    if (!item || !w) return undefined
    return core.commands.run('tab.new', { url: item.url, spaceId: item.spaceId ?? w.activeSpaceId }, w)
  })

  const withContents = (fn: (wc: Electron.WebContents, w: SwyrWindow) => void) => ({ w }: CommandContext) => {
    const wc = w?.activeContents()
    if (!wc || !w) return false
    fn(wc, w)
    return true
  }
  c.register('tab.back', withContents((wc) => wc.navigationHistory.canGoBack() && wc.navigationHistory.goBack()))
  c.register('tab.forward', withContents((wc) => wc.navigationHistory.canGoForward() && wc.navigationHistory.goForward()))
  c.register('tab.reload', ({ w }, p) => {
    const wc = w?.activeContents()
    if (!wc) {
      const item = w?.activeItem()
      if (item && w) w.activate(item.id)
      return Boolean(item)
    }
    if (p.hard === true) wc.reloadIgnoringCache()
    else wc.reload()
    return true
  })
  c.register('tab.hardReload', ({ core, w }) => core.commands.run('tab.reload', { hard: true }, w))
  c.register('tab.stop', withContents((wc) => wc.stop()))

  const step = (dir: 1 | -1) => ({ core, w }: CommandContext) => {
    if (!w) return false
    const list = sidebarOrder(core.store.state, w.space())
    if (!list.length) return false
    const idx = list.findIndex((i) => i.id === w.activeItemId)
    const next = list[(idx + dir + list.length) % list.length] ?? list[0]
    w.activate(next.id)
    return true
  }
  c.register('tab.next', step(1))
  c.register('tab.prev', step(-1))

  let cycle: { at: number; list: string[]; pos: number; win: number } | null = null
  c.register('tab.cycleRecent', ({ core, w }) => {
    if (!w) return false
    const now = Date.now()
    if (!cycle || cycle.win !== w.id || now - cycle.at > 1500) {
      const space = w.space()
      const list = sidebarOrder(core.store.state, space)
        .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
        .slice(0, 5)
        .map((i) => i.id)
      cycle = { at: now, list, pos: 0, win: w.id }
    }
    if (cycle.list.length < 2) return false
    cycle.pos = (cycle.pos + 1) % cycle.list.length
    cycle.at = now
    w.activate(cycle.list[cycle.pos])
    return true
  })

  c.register('tab.archiveAllToday', ({ core, w }) => {
    if (!w) return 0
    const today = sectionItems(core.store.state, w.activeSpaceId, 'today')
    archiveItems(core, today, 'manual')
    return today.length
  })

  c.register('archive.open', (ctx) => openInternal(ctx, 'swyr://archive'))
  c.register('settings.open', (ctx) => openInternal(ctx, 'swyr://settings'))

  c.register('settings.set', ({ core }, p) => {
    const allowed: (keyof Settings)[] = ['archiveAfter', 'searchEngine', 'appearance', 'adblock', 'pipAuto', 'openExternalLinksInMiniWindow', 'shortcuts', 'siteSearch']
    core.store.update((s) => {
      for (const key of allowed) if (key in p) (s.settings as unknown as Record<string, unknown>)[key] = p[key]
    })
    core.shortcuts.reload()
    return core.store.state.settings
  })

  // ----- spaces
  c.register('space.switch', ({ core, w }, p) => {
    if (!w) return false
    const spaces = windowSpaces(core.store.state, w.activeSpaceId)
    const target = str(p.id) ? spaces.find((x) => x.id === p.id) : spaces[num(p.index) ?? -1]
    if (!target) return false
    if (target.id !== w.activeSpaceId) w.switchSpace(target.id)
    return true
  })

  const spaceStep = (dir: 1 | -1) => ({ core, w }: CommandContext) => {
    if (!w) return false
    const spaces = windowSpaces(core.store.state, w.activeSpaceId)
    if (spaces.length < 2) return false
    const idx = spaces.findIndex((x) => x.id === w.activeSpaceId)
    w.switchSpace(spaces[(idx + dir + spaces.length) % spaces.length].id)
    return true
  }
  c.register('space.next', spaceStep(1))
  c.register('space.prev', spaceStep(-1))

  c.register('space.contextMenu', ({ core, w }, p) => {
    if (w) core.contextMenus.space(w, str(p.id) ?? w.activeSpaceId)
    return true
  })

  // ----- sidebar
  c.register('sidebar.toggle', ({ core }) => {
    core.store.update((s) => (s.settings.sidebarVisible = !s.settings.sidebarVisible))
    for (const win of core.windows) {
      if (win.overlayState?.kind === 'sidebar') win.closeOverlay(false)
      win.layout()
    }
    return core.store.state.settings.sidebarVisible
  })

  c.register('sidebar.setWidth', ({ core }, p) => {
    const width = num(p.width)
    if (width === undefined) return false
    core.store.update((s) => (s.settings.sidebarWidth = clampSidebar(width)))
    for (const win of core.windows) win.layout()
    return core.store.state.settings.sidebarWidth
  })

  c.register('sidebar.peek', ({ w }, p) => {
    if (!w || w.sidebarVisible()) return false
    if (p.show === false) {
      if (w.overlayState?.kind === 'sidebar') w.closeOverlay(false)
    } else if (!w.overlayState || w.overlayState.kind === 'toast') {
      w.openOverlay({ kind: 'sidebar' }, false)
    }
    return true
  })

  c.register('tab.contextMenu', ({ core, w }, p) => {
    const item = findItem(core, p.id, w)
    if (w && item) core.contextMenus.tab(w, item)
    return true
  })

  // ----- overlays
  c.register('commandbar.open', ({ w }, p) => {
    if (!w) return false
    const mode = p.mode === 'current' ? 'current' : 'new'
    const current = w.activeItem()
    const query = str(p.query) ?? (mode === 'current' && current && !current.url.startsWith('swyr://newtab') ? current.url : '')
    w.openOverlay({ kind: 'commandbar', mode: mode === 'current' && !current ? 'new' : mode, query })
    return true
  })
  c.register('commandbar.close', ({ w }) => {
    if (w?.overlayState?.kind === 'commandbar') w.closeOverlay()
    return true
  })
  c.register('overlay.close', ({ w }) => {
    w?.closeOverlay()
    return true
  })

  c.register('find.open', ({ w }) => {
    if (!w || !w.activeContents()) return false
    const prev = w.overlayState?.kind === 'find' ? w.overlayState.query : lastFind
    w.openOverlay({ kind: 'find', query: prev, active: 0, matches: 0 })
    return true
  })
  let lastFind = ''
  c.register('find.update', ({ w }, p) => {
    const wc = w?.activeContents()
    const query = str(p.query) ?? ''
    if (!wc || !w) return false
    lastFind = query
    if (w.overlayState?.kind === 'find') w.overlayState.query = query
    if (query) wc.findInPage(query)
    else {
      wc.stopFindInPage('clearSelection')
      w.onFindResult(w.activeItemId ?? '', 0, 0)
    }
    return true
  })
  const findStep = (forward: boolean) => ({ core, w }: CommandContext) => {
    const wc = w?.activeContents()
    if (!wc || !w) return false
    const query = w.overlayState?.kind === 'find' ? w.overlayState.query : lastFind
    if (!query) return core.commands.run('find.open', {}, w)
    if (w.overlayState?.kind !== 'find') w.openOverlay({ kind: 'find', query, active: 0, matches: 0 }, false)
    wc.findInPage(query, { forward, findNext: true })
    return true
  }
  c.register('find.next', findStep(true))
  c.register('find.prev', findStep(false))
  c.register('find.close', ({ w }) => {
    if (w?.overlayState?.kind === 'find') w.closeOverlay()
    return true
  })

  // ----- page
  c.register('page.copyUrl', ({ w }) => {
    const item = w?.activeItem()
    if (!item || !w) return false
    clipboard.writeText(item.url)
    w.toast('Copied URL')
    return item.url
  })
  c.register('page.devtools', ({ core, w }) => {
    const wc = w?.activeContents()
    if (!wc) return false
    if (core.test) return 'skipped in test mode'
    if (wc.isDevToolsOpened()) wc.closeDevTools()
    else wc.openDevTools({ mode: 'detach' })
    return true
  })
  const zoom = (fn: (level: number) => number) => ({ w }: CommandContext) => {
    const wc = w?.activeContents()
    if (!wc || !w) return false
    const level = Math.max(-3, Math.min(5, fn(wc.getZoomLevel())))
    wc.setZoomLevel(level)
    const id = w.activeItemId
    const rt = id ? w.tabs.runtime.get(id) : undefined
    if (rt) rt.zoom = level
    w.toast(`Zoom ${Math.round(Math.pow(1.2, level) * 100)}%`)
    return level
  }
  c.register('zoom.in', zoom((l) => l + 0.5))
  c.register('zoom.out', zoom((l) => l - 0.5))
  c.register('zoom.reset', zoom(() => 0))

  // ----- windows and app
  c.register('window.new', ({ core, w }) => core.createWindow({ spaceId: w?.activeSpaceId }).id)
  c.register('window.close', ({ w }) => {
    w?.win.close()
    return true
  })
  c.register('app.quit', () => {
    app.quit()
    return true
  })

  c.register('downloads.open', ({ core }) => {
    // the downloads panel arrives with the downloads module; until then reveal the folder
    if (core.test) return 'skipped in test mode'
    void shell.openPath(app.getPath('downloads'))
    return true
  })

  registerItemCommands(c)
  registerSpaceCommands(c)
  registerPlatformCommands(c) // round 2c: extensions, ad blocker, downloads, link rules, importer, profiles
  registerPageCommands(c) // round 3a: styles, site settings, reader, history, capture
  registerDocumentCommands(c) // round 3b: notes, canvases, live folders, library
  registerAppCommands(c) // round 3c: onboarding, window bounds, shortcut table, About, page commands

  c.register('debug.titles', ({ core, w }) => (w ? sidebarOrder(core.store.state, w.space()).map(itemTitle) : []))
}

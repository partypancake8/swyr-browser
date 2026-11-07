// Platform commands and services: extensions, ad blocker, downloads, link rules, importer, profiles,
// private windows, default browser, settings. registerPlatformCommands runs after the builtins and
// replaces settings.set and downloads.open with fuller versions.
import { app, dialog, shell, webContents, type Session, type WebContents } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ExtensionSetting, Item, LinkRule, PersistedState, PlatformRuntime, Profile, Settings, Space } from '@shared/types'
import { resolveBindings } from '@shared/commands'
import { sortedSpaces, spaceById, favoritesFor } from '@shared/ops'
import { clampSidebar } from '../layout/Layout'
import { defaultSettings, makeSpace } from '../state/defaults'
import { newId } from '../util/id'
import { Adblock, hostAllowed } from '../adblock/Adblock'
import { Downloads } from '../downloads/Downloads'
import { Extensions, WEB_STORE_URL, setExtensions } from '../extensions/Extensions'
import { matchRule, normalizePattern } from '../linkrules/LinkRules'
import { openInMiniWindow } from '../linkrules/mini'
import { ARC_SIDEBAR_PATH, readSidebarFile, summarize, type ImportedNode, type ImportedSidebar } from '../import/ArcImport'
import {
  forgetProfileSession,
  liveSessions,
  makeIncognitoProfile,
  makeProfile,
  onProfileSession,
  partitionOf,
  profileSession,
  regularProfiles
} from '../profiles/Profiles'
import type { CommandContext, Commands } from './Commands'
import type { Core } from '../windows/WindowManager'
import type { SwyrWindow } from '../windows/SwyrWindow'

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined)

/** commands the internal pages (swyr://settings, swyr://extensions) may run over IPC */
export const PLATFORM_PAGE_COMMANDS = [
  'platform.state',
  'settings.reset',
  'extensions.open',
  'extensions.openStore',
  'extensions.loadUnpacked',
  'extensions.remove',
  'extensions.toggle',
  'downloads.setDirectory',
  'adblock.toggle',
  'linkRules.add',
  'linkRules.remove',
  'import.arc',
  'data.export',
  'profile.new',
  'profile.rename',
  'profile.delete',
  'browser.makeDefault',
  'shortcuts.record',
  'shortcuts.reset'
]

interface PlatformServices {
  core: Core
  extensions: Extensions
  adblock: Adblock
  downloads: Downloads
  panels: Set<number>
  defaultBrowser: boolean
}

let P: PlatformServices | null = null

// ----- runtime state

function isDefaultBrowser(): boolean {
  try {
    return app.isDefaultProtocolClient('http') && app.isDefaultProtocolClient('https')
  } catch {
    return false
  }
}

export function platformRuntime(): PlatformRuntime {
  if (!P) {
    return { extensions: [], downloads: [], adblockStats: { blocked: 0, perTab: {} }, downloadsPanel: [], defaultBrowser: false, adblockLists: 'bundled', downloadDirectory: '' }
  }
  return {
    extensions: P.extensions.list(liveSessions()),
    downloads: P.downloads.list.map((d) => ({ ...d })),
    adblockStats: { blocked: P.adblock.stats.blocked, perTab: { ...P.adblock.stats.perTab } },
    downloadsPanel: [...P.panels],
    defaultBrowser: P.defaultBrowser,
    adblockLists: P.adblock.lists,
    downloadDirectory: P.downloads.directory()
  }
}

let notifyTimer: NodeJS.Timeout | null = null
function notifyPlatform(): void {
  if (!P || notifyTimer) return
  notifyTimer = setTimeout(() => {
    notifyTimer = null
    if (!P) return
    const platform = platformRuntime()
    for (const w of P.core.windows) {
      const wc = w.shell.webContents
      if (!w.closed && !wc.isDestroyed()) wc.send('swyr:event', { type: 'platform', platform })
    }
  }, 60)
}

/** the active tab's session partition in the first window (test hook) */
export function activePartition(core: Core): string {
  return partitionOf(core.first()?.activeContents()?.session)
}

function itemIdFor(core: Core, id: number | undefined): string | undefined {
  if (id === undefined) return undefined
  const wc = webContents.fromId(id)
  if (!wc) return undefined
  for (const w of core.windows) {
    const item = w.tabs.idOf(wc)
    if (item) return item
  }
  return undefined
}

// ----- private windows never reach state.json

function privateIds(s: PersistedState): Set<string> {
  return new Set(s.profiles.filter((p) => p.incognito).map((p) => p.id))
}

function withoutPrivate(s: PersistedState): PersistedState {
  const priv = privateIds(s)
  if (!priv.size) return s
  return {
    ...s,
    profiles: s.profiles.filter((p) => !priv.has(p.id)),
    spaces: s.spaces.filter((x) => !priv.has(x.profileId) && !x.incognito),
    items: s.items.filter((i) => !priv.has(i.profileId)),
    archive: s.archive.filter((a) => !priv.has(a.item.profileId))
  }
}

function purgePrivate(core: Core, profileId?: string): void {
  const s = core.store.state
  const ids = profileId ? new Set([profileId]) : privateIds(s)
  if (!ids.size && !s.spaces.some((x) => x.incognito)) return
  const doomed = s.items.filter((i) => ids.has(i.profileId))
  for (const it of doomed) core.destroyItemViews(it.id)
  core.store.update((st) => {
    st.items = st.items.filter((i) => !ids.has(i.profileId))
    st.archive = st.archive.filter((a) => !ids.has(a.item.profileId))
    st.spaces = st.spaces.filter((x) => !ids.has(x.profileId) && !(x.incognito && !profileId))
    st.profiles = st.profiles.filter((p) => !ids.has(p.id))
  })
  for (const id of ids) void forgetProfileSession(id, true)
}

// ----- init

function normalizeSettings(core: Core): void {
  core.store.update((s) => {
    const st = s.settings
    if (!Array.isArray(st.extensions)) st.extensions = []
    if (!Array.isArray(st.adblockAllow)) st.adblockAllow = []
    if (!Array.isArray(st.linkRules)) st.linkRules = []
    st.linkRules = st.linkRules.filter((r) => r && typeof r.pattern === 'string').map((r) => ({ ...r, id: r.id || newId('rule') }))
  })
}

export function initPlatform(core: Core): void {
  if (P) return
  normalizeSettings(core)
  purgePrivate(core)
  const store = core.store
  const flush = store.flush.bind(store)
  store.flush = () => {
    const s = store.state
    if (!privateIds(s).size) return flush()
    const saved = { profiles: s.profiles, spaces: s.spaces, items: s.items, archive: s.archive }
    Object.assign(s, withoutPrivate(s))
    try {
      flush()
    } finally {
      Object.assign(s, saved)
    }
  }

  const userData = app.getPath('userData')
  const extensions = new Extensions({
    test: core.test,
    extensionsDir: (profileId) => path.join(userData, 'extensions', profileId),
    settings: () => core.store.state.settings.extensions ?? [],
    saveSettings: (list: ExtensionSetting[]) => core.store.update((s) => (s.settings.extensions = list)),
    createTab: async (url, active) => {
      const w = core.current() ?? core.createWindow()
      const external = url && /^chrome-extension:/i.test(url)
      const id = (await core.commands.run('tab.new', { url: external ? 'about:blank' : url, background: !active }, w)) as string
      const item = core.store.state.items.find((i) => i.id === id)
      const view = w.tabs.get(id) ?? (item ? w.tabs.ensure(item) : undefined)
      if (!view) throw new Error('tab not created')
      if (external && url) {
        if (item) core.store.update(() => (item.url = url))
        void view.webContents.loadURL(url).catch(() => undefined)
      }
      return [view.webContents, w.win]
    },
    selectTab: (wc) => {
      for (const w of core.windows) {
        const id = w.tabs.idOf(wc)
        if (id) return w.activate(id)
      }
    },
    closeTab: (wc) => {
      for (const w of core.windows) {
        const id = w.tabs.idOf(wc)
        if (id) return void core.commands.run('tab.close', { id }, w)
      }
    },
    createWindow: async (url) => {
      const w = core.createWindow({ spaceId: core.current()?.activeSpaceId })
      if (url) await core.commands.run('tab.new', { url }, w)
      return w.win
    },
    changed: notifyPlatform
  })
  setExtensions(extensions)
  const adblock = new Adblock(
    {
      enabled: () => core.store.state.settings.adblock !== false,
      allowList: () => core.store.state.settings.adblockAllow ?? [],
      itemIdFor: (id) => itemIdFor(core, id),
      changed: notifyPlatform
    },
    path.join(userData, 'adblock')
  )
  const downloads = new Downloads({ directory: () => core.store.state.settings.downloadDirectory, changed: notifyPlatform })
  P = { core, extensions, adblock, downloads, panels: new Set(), defaultBrowser: isDefaultBrowser() }

  onProfileSession((ses: Session, profile: Profile) => {
    adblock.attach(ses)
    downloads.attach(ses)
    extensions.attach(ses, profile)
  })
  void adblock.loadFullLists()
  core.store.onChange(() => notifyPlatform())
}

// ----- helpers

function profileById(core: Core, id: string | undefined): Profile | undefined {
  return core.store.state.profiles.find((p) => p.id === id)
}

function windowProfile(core: Core, w: SwyrWindow | undefined): Profile {
  const s = core.store.state
  return profileById(core, w?.space().profileId) ?? regularProfiles(s)[0] ?? s.profiles[0]
}

function sessionFor(core: Core, profileId: string | undefined, w: SwyrWindow | undefined): { ses: Session; profile: Profile } {
  const profile = profileById(core, profileId) ?? windowProfile(core, w)
  return { ses: profileSession(profile), profile }
}

function openInternal(ctx: CommandContext, url: string): unknown {
  const { core, w } = ctx
  if (!w) return undefined
  const space = w.space()
  const existing = core.store.state.items.find((i) => i.spaceId === space.id && i.url.startsWith(url))
  if (existing) {
    w.activate(existing.id)
    return existing.id
  }
  return core.commands.run('tab.new', { url }, w)
}

function tabContents(w: SwyrWindow | undefined, itemId?: string): WebContents | undefined {
  if (!w) return undefined
  if (itemId) {
    const v = w.tabs.get(itemId)
    return v && !v.webContents.isDestroyed() ? v.webContents : undefined
  }
  return w.activeContents()
}

/** move a space to another profile; its tabs reload in that profile's session */
export function assignSpaceProfile(core: Core, space: Space, profileId: string): boolean {
  const s = core.store.state
  if (!s.profiles.some((p) => p.id === profileId) || space.profileId === profileId) return false
  const items = s.items.filter((i) => i.spaceId === space.id)
  for (const it of items) core.destroyItemViews(it.id)
  core.store.update(() => {
    space.profileId = profileId
    for (const it of items) it.profileId = profileId
  })
  for (const w of core.windows) if (w.activeSpaceId === space.id) w.switchSpace(space.id)
  return true
}

const MODIFIER_CODES = new Set(['MetaLeft', 'MetaRight', 'ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight', 'ControlLeft', 'ControlRight', 'CapsLock', 'Fn'])
const CODE_KEYS: Record<string, string> = {
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Equal: '=',
  Minus: '-',
  BracketLeft: '[',
  BracketRight: ']',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  Tab: 'Tab',
  Enter: 'Enter',
  Space: 'Space',
  Backspace: 'Backspace',
  Delete: 'Delete'
}

export function acceleratorFromInput(input: Electron.Input): string | null {
  if (MODIFIER_CODES.has(input.code)) return null
  let key = CODE_KEYS[input.code]
  if (!key) {
    const m = /^(?:Key|Digit)(\w)$/.exec(input.code)
    if (m) key = m[1].toUpperCase()
    else if (/^F\d{1,2}$/.test(input.code)) key = input.code
  }
  if (!key) return null
  const mods: string[] = []
  if (input.control) mods.push('Ctrl')
  if (input.alt) mods.push('Alt')
  if (input.shift) mods.push('Shift')
  if (input.meta) mods.push('Cmd')
  if (!mods.length && !/^F\d/.test(key)) return null
  return [...mods, key].join('+')
}

// ----- importer

function applyImport(core: Core, w: SwyrWindow | undefined, sidebar: ImportedSidebar): string[] {
  const s = core.store.state
  const profile = windowProfile(core, w)
  const profileId = profile.incognito ? (regularProfiles(s)[0] ?? s.profiles[0]).id : profile.id
  const now = Date.now()
  const created: string[] = []
  core.store.update((st) => {
    let order = st.spaces.reduce((m, x) => Math.max(m, x.order), -1) + 1
    const base = (p: Partial<Item> & Pick<Item, 'section' | 'kind' | 'order' | 'url' | 'title'>): Item => ({
      id: newId(p.kind === 'folder' ? 'folder' : 'tab'),
      spaceId: null,
      profileId,
      parentId: null,
      customTitle: null,
      pinnedUrl: null,
      favicon: null,
      createdAt: now,
      lastActiveAt: now,
      ...p
    })
    for (const sp of sidebar.spaces) {
      const space = makeSpace(sp.title, profileId, order, '')
      order++
      st.spaces.push(space)
      created.push(space.id)
      const addNodes = (nodes: ImportedNode[], parentId: string | null): void => {
        nodes.forEach((n, i) => {
          if (n.kind === 'folder') {
            const folder = base({ kind: 'folder', section: 'pinned', order: i, url: '', title: n.title, spaceId: space.id, parentId, collapsed: false })
            st.items.push(folder)
            addNodes(n.children, folder.id)
          } else {
            st.items.push(base({ kind: 'tab', section: 'pinned', order: i, url: n.url, pinnedUrl: n.url, title: n.title, customTitle: n.customTitle, spaceId: space.id, parentId }))
          }
        })
      }
      addNodes(sp.pinned, null)
      sp.today.forEach((t, i) => st.items.push(base({ kind: 'tab', section: 'today', order: i, url: t.url, title: t.title, customTitle: t.customTitle, spaceId: space.id })))
    }
    const haveFav = new Set(favoritesFor(st, profileId).map((f) => f.pinnedUrl ?? f.url))
    let favOrder = favoritesFor(st, profileId).length
    for (const f of sidebar.favorites) {
      if (haveFav.has(f.url)) continue
      haveFav.add(f.url)
      st.items.push(base({ kind: 'tab', section: 'favorites', order: favOrder++, url: f.url, pinnedUrl: f.url, title: f.title, customTitle: f.customTitle }))
    }
  })
  return created
}

// ----- commands

export function registerPlatformCommands(c: Commands): void {
  c.register('platform.state', () => {
    if (P) P.defaultBrowser = isDefaultBrowser()
    return platformRuntime()
  })

  c.register('settings.set', ({ core }, p) => {
    const keys: (keyof Settings)[] = [
      'archiveAfter',
      'searchEngine',
      'appearance',
      'adblock',
      'pipAuto',
      'openExternalLinksInMiniWindow',
      'shortcuts',
      'siteSearch',
      'sidebarWidth',
      'adblockAllow',
      'downloadDirectory'
    ]
    core.store.update((s) => {
      const st = s.settings as unknown as Record<string, unknown>
      for (const key of keys) {
        if (!(key in p)) continue
        let v = p[key]
        if (key === 'sidebarWidth') v = typeof v === 'number' ? clampSidebar(v) : s.settings.sidebarWidth
        if (key === 'adblockAllow') v = Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string').map((x) => x.trim().toLowerCase()).filter(Boolean))] : s.settings.adblockAllow
        if (key === 'shortcuts') v = v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, a]) => typeof a === 'string' && a)) : {}
        st[key] = v
      }
    })
    core.shortcuts.reload()
    if ('sidebarWidth' in p) for (const w of core.windows) w.layout()
    return core.store.state.settings
  })

  c.register('settings.reset', ({ core }) => {
    core.store.update((s) => {
      const keep = { extensions: s.settings.extensions, linkRules: s.settings.linkRules, sidebarVisible: s.settings.sidebarVisible }
      s.settings = { ...defaultSettings(), adblockAllow: [], ...keep }
    })
    core.shortcuts.reload()
    for (const w of core.windows) w.layout()
    return core.store.state.settings
  })

  // ----- extensions
  c.register('extensions.open', (ctx) => openInternal(ctx, 'swyr://extensions'))
  c.register('extensions.openStore', ({ core, w }) => core.commands.run('tab.new', { url: WEB_STORE_URL }, w))

  c.register('extensions.loadUnpacked', async ({ core, w }, p) => {
    if (!P) return null
    let dir = str(p.path)
    if (!dir) {
      if (core.test) return { error: 'a path is required in test mode' }
      const res = await dialog.showOpenDialog({ title: 'Load Unpacked Extension', buttonLabel: 'Load', properties: ['openDirectory'] })
      if (res.canceled || !res.filePaths[0]) return null
      dir = res.filePaths[0]
    }
    const { ses, profile } = sessionFor(core, str(p.profileId), w)
    if (profile.incognito) return { error: 'Extensions cannot be added in a private window.' }
    try {
      const ext = await P.extensions.loadUnpacked(ses, dir)
      const list = core.store.state.settings.extensions ?? []
      const rest = list.filter((x) => !(x.id === ext.id && x.profileId === profile.id))
      core.store.update((s) => (s.settings.extensions = [...rest, { id: ext.id, path: ext.path, enabled: true, profileId: profile.id, source: 'unpacked' }]))
      notifyPlatform()
      return { id: ext.id, name: ext.name }
    } catch (err) {
      return { error: (err as Error).message }
    }
  })

  const extProfile = (core: Core, id: string, given: string | undefined, w: SwyrWindow | undefined): string => {
    if (given) return given
    const s = core.store.state.settings.extensions ?? []
    return s.find((x) => x.id === id)?.profileId ?? windowProfile(core, w).id
  }
  c.register('extensions.remove', async ({ core, w }, p) => {
    const id = str(p.id)
    if (!P || !id) return false
    const profileId = extProfile(core, id, str(p.profileId), w)
    return P.extensions.remove(sessionFor(core, profileId, w).ses, profileId, id)
  })
  c.register('extensions.toggle', async ({ core, w }, p) => {
    const id = str(p.id)
    if (!P || !id) return false
    const profileId = extProfile(core, id, str(p.profileId), w)
    const current = platformRuntime().extensions.find((e) => e.id === id && e.profileId === profileId)
    const enabled = typeof p.enabled === 'boolean' ? p.enabled : !current?.enabled
    return P.extensions.setEnabled(sessionFor(core, profileId, w).ses, profileId, id, enabled)
  })
  c.register('extensions.openPopup', ({ w }, p) => {
    const id = str(p.id)
    const tab = w?.activeContents()
    if (!P || !id || !tab) return false
    const a = (p.anchor ?? {}) as Partial<Record<'x' | 'y' | 'width' | 'height', number>>
    const n = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)
    return P.extensions.openPopup(tab, id, { x: n(a.x, 12), y: n(a.y, 84), width: n(a.width, 28), height: n(a.height, 28) })
  })

  // ----- ad blocker
  c.register('adblock.toggle', ({ core }, p) => {
    const enabled = typeof p.enabled === 'boolean' ? p.enabled : !core.store.state.settings.adblock
    core.store.update((s) => (s.settings.adblock = enabled))
    return enabled
  })
  c.register('adblock.allowSite', ({ core, w }, p) => {
    let host = str(p.host)
    if (!host) {
      try {
        host = new URL(w?.activeItem()?.url ?? '').hostname.replace(/^www\./, '')
      } catch {
        host = undefined
      }
    }
    if (!host) return false
    const list = core.store.state.settings.adblockAllow ?? []
    const allow = typeof p.allow === 'boolean' ? p.allow : !hostAllowed(host, list)
    const h = host.toLowerCase()
    core.store.update((s) => (s.settings.adblockAllow = allow ? [...new Set([...list, h])] : list.filter((x) => x !== h)))
    w?.toast(allow ? `Ads allowed on ${h}` : `Blocking ads on ${h}`)
    return allow
  })

  // ----- downloads
  c.register('downloads.open', ({ w }, p) => {
    if (!P || !w) return false
    const open = typeof p.show === 'boolean' ? p.show : !P.panels.has(w.id)
    if (open) P.panels.add(w.id)
    else P.panels.delete(w.id)
    notifyPlatform()
    return open
  })
  c.register('downloads.setDirectory', async ({ core }, p) => {
    let dir = str(p.path)
    if (!dir) {
      if (core.test) return false
      const res = await dialog.showOpenDialog({ title: 'Downloads Folder', buttonLabel: 'Choose', properties: ['openDirectory', 'createDirectory'], defaultPath: P?.downloads.directory() })
      if (res.canceled || !res.filePaths[0]) return false
      dir = res.filePaths[0]
    }
    const resolved = path.resolve(dir.replace(/^~(?=$|\/)/, os.homedir()))
    core.store.update((s) => (s.settings.downloadDirectory = resolved))
    return resolved
  })
  c.register('downloads.cancel', (_ctx, p) => Boolean(P && str(p.id) && P.downloads.cancel(str(p.id)!)))
  c.register('downloads.clear', () => (P ? P.downloads.clear() : 0))
  c.register('downloads.openFile', async ({ core }, p) => {
    const d = P?.downloads.get(str(p.id) ?? '')
    if (!d || d.state !== 'completed') return false
    if (core.test) return 'skipped in test mode'
    return (await shell.openPath(d.path)) === ''
  })
  c.register('downloads.reveal', ({ core }, p) => {
    const d = P?.downloads.get(str(p.id) ?? '')
    if (!d) return false
    if (core.test) return 'skipped in test mode'
    shell.showItemInFolder(d.path)
    return true
  })

  c.register('page.runJs', async ({ core, w }, p) => {
    // test-only convenience: never available outside SWYR_TEST=1
    if (!core.test || process.env.SWYR_TEST !== '1') throw new Error('page.runJs is only available in test mode')
    const wc = tabContents(w, str(p.itemId))
    const js = typeof p.js === 'string' ? p.js : ''
    if (!wc || !js) return null
    return wc.executeJavaScript(js, true)
  })

  // ----- link rules
  c.register('linkRules.add', ({ core }, p) => {
    const pattern = normalizePattern(str(p.pattern) ?? '')
    const space = spaceById(core.store.state, str(p.spaceId))
    if (!pattern || !space || space.incognito) return false
    const profileId = profileById(core, str(p.profileId))?.id ?? space.profileId
    const rule: LinkRule = { id: newId('rule'), pattern, spaceId: space.id, profileId }
    core.store.update((s) => (s.settings.linkRules = [...s.settings.linkRules.filter((r) => r.pattern !== pattern), rule]))
    return rule.id
  })
  c.register('linkRules.remove', ({ core }, p) => {
    const id = str(p.id)
    const before = core.store.state.settings.linkRules.length
    core.store.update((s) => (s.settings.linkRules = s.settings.linkRules.filter((r) => r.id !== id && r.pattern !== str(p.pattern))))
    return core.store.state.settings.linkRules.length < before
  })

  c.register('link.openExternal', async ({ core, w }, p) => {
    const url = str(p.url)
    if (!url || !/^https?:\/\//i.test(url)) return false
    const s = core.store.state
    const pick = (): SwyrWindow => {
      const regular = core.windows.filter((x) => !x.closed && !x.space().incognito)
      if (w && regular.includes(w)) return w
      return regular[0] ?? core.createWindow()
    }
    const rule = matchRule(s.settings.linkRules, url)
    const space = rule ? spaceById(s, rule.spaceId) : undefined
    let result: unknown
    if (space) {
      const target = pick()
      if (target.activeSpaceId !== space.id) target.switchSpace(space.id)
      result = await core.commands.run('tab.new', { url, spaceId: space.id }, target)
      if (!core.test) target.win.focus()
      return result
    }
    if (s.settings.openExternalLinksInMiniWindow && (await openInMiniWindow(url, core))) return 'mini'
    const target = pick()
    result = await core.commands.run('tab.new', { url }, target)
    if (!core.test) target.win.focus()
    return result
  })

  // ----- default browser
  c.register('browser.makeDefault', ({ core }) => {
    if (!core.test) {
      app.setAsDefaultProtocolClient('http')
      app.setAsDefaultProtocolClient('https')
    }
    if (P) P.defaultBrowser = isDefaultBrowser()
    notifyPlatform()
    return P?.defaultBrowser ?? false
  })

  // ----- importer and export
  c.register('import.arc', async ({ core, w }, p) => {
    let file = str(p.path)
    if (!file) {
      if (core.test) file = ARC_SIDEBAR_PATH
      else {
        const res = await dialog.showOpenDialog({
          title: 'Choose your sidebar file',
          buttonLabel: 'Import',
          defaultPath: ARC_SIDEBAR_PATH,
          properties: ['openFile', 'showHiddenFiles'],
          filters: [{ name: 'Sidebar data', extensions: ['json'] }]
        })
        if (res.canceled || !res.filePaths[0]) return null
        file = res.filePaths[0]
      }
    }
    try {
      const sidebar = readSidebarFile(file)
      const summary = summarize(sidebar)
      if (p.dryRun === true) return { ...summary, dryRun: true }
      const spaces = applyImport(core, w, sidebar)
      if (!core.test) w?.toast(`Imported ${summary.spaces} spaces`)
      return { ...summary, spaceIds: spaces }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      return { error: code === 'ENOENT' ? 'No sidebar file was found at that path.' : (err as Error).message }
    }
  })

  c.register('data.export', async ({ core }, p) => {
    let file = str(p.path)
    if (!file) {
      if (core.test) return false
      const stamp = new Date().toISOString().slice(0, 10)
      const res = await dialog.showSaveDialog({ title: 'Export swyr Data', defaultPath: path.join(app.getPath('downloads'), `swyr-data-${stamp}.json`), filters: [{ name: 'JSON', extensions: ['json'] }] })
      if (res.canceled || !res.filePath) return false
      file = res.filePath
    }
    fs.writeFileSync(file, JSON.stringify(withoutPrivate(core.store.state), null, 1))
    return file
  })

  // ----- profiles
  c.register('profile.new', ({ core }, p) => {
    const profile = makeProfile(str(p.name) ?? `Profile ${regularProfiles(core.store.state).length + 1}`)
    core.store.update((s) => s.profiles.push(profile))
    return profile.id
  })
  c.register('profile.rename', ({ core }, p) => {
    const profile = profileById(core, str(p.id))
    const name = str(p.name)
    if (!profile || !name || profile.incognito) return false
    core.store.update(() => (profile.name = name))
    return true
  })
  c.register('profile.delete', ({ core }, p) => {
    const s = core.store.state
    const profile = profileById(core, str(p.id))
    const regular = regularProfiles(s)
    if (!profile || profile.incognito || regular.length < 2) return false
    const fallback = regular.find((x) => x.id !== profile.id)!
    const items = s.items.filter((i) => i.profileId === profile.id)
    for (const it of items) core.destroyItemViews(it.id)
    const spaces = s.spaces.filter((x) => x.profileId === profile.id)
    core.store.update((st) => {
      for (const it of items) it.profileId = fallback.id
      for (const sp of spaces) sp.profileId = fallback.id
      st.settings.linkRules = st.settings.linkRules.map((r) => (r.profileId === profile.id ? { ...r, profileId: fallback.id } : r))
      st.settings.extensions = (st.settings.extensions ?? []).filter((x) => x.profileId !== profile.id)
      st.profiles = st.profiles.filter((x) => x.id !== profile.id)
    })
    void forgetProfileSession(profile.id, true)
    for (const w of core.windows) if (spaces.some((sp) => sp.id === w.activeSpaceId)) w.switchSpace(w.activeSpaceId)
    return fallback.id
  })
  c.register('profile.switch', ({ core, w }, p) => {
    const profile = profileById(core, str(p.id))
    if (!w || !profile || profile.incognito) return false
    const s = core.store.state
    let space = sortedSpaces(s).find((x) => x.profileId === profile.id)
    if (!space) {
      const order = s.spaces.reduce((m, x) => Math.max(m, x.order), -1) + 1
      space = makeSpace(profile.name, profile.id, order, '')
      const created = space
      core.store.update((st) => st.spaces.push(created))
    }
    w.switchSpace(space.id)
    return space.id
  })

  c.register('window.newIncognito', ({ core }) => {
    const profile = makeIncognitoProfile()
    const s = core.store.state
    const order = s.spaces.reduce((m, x) => Math.max(m, x.order), -1) + 1
    const space = makeSpace('Private', profile.id, order, '')
    space.incognito = true
    space.theme = { colors: ['#2c2e35', '#3b3546'], angle: 160, noise: 0.12, appearance: 'dark' }
    core.store.update((st) => {
      st.profiles.push(profile)
      st.spaces.push(space)
    })
    const w = core.createWindow({ spaceId: space.id })
    w.win.on('closed', () => purgePrivate(core, profile.id))
    return w.id
  })

  // ----- shortcuts
  c.register('shortcuts.record', ({ core, w }, p) => {
    const id = str(p.id)
    const wc = w?.activeContents()
    if (!id || !wc || !resolveBindings(undefined).some((b) => b.id === id)) return null
    return new Promise<string | null>((resolve) => {
      const shortcuts = core.shortcuts as unknown as { raw: unknown[] }
      shortcuts.raw = [] // pause the raw (non-menu) bindings while recording
      const done = (accel: string | null): void => {
        clearTimeout(timer)
        if (!wc.isDestroyed()) wc.off('before-input-event', onInput)
        if (accel) core.store.update((s) => (s.settings.shortcuts = { ...s.settings.shortcuts, [id]: accel }))
        core.shortcuts.reload()
        resolve(accel)
      }
      const onInput = (e: Electron.Event, input: Electron.Input): void => {
        if (input.type !== 'keyDown') return
        e.preventDefault() // also keeps menu accelerators from firing
        if (input.code === 'Escape' && !input.meta && !input.control && !input.alt) return done(null)
        const accel = acceleratorFromInput(input)
        if (accel) done(accel)
      }
      const timer = setTimeout(() => done(null), 15000)
      wc.prependListener('before-input-event', onInput)
    })
  })
  c.register('shortcuts.reset', ({ core }, p) => {
    const id = str(p.id)
    core.store.update((s) => {
      if (!id) s.settings.shortcuts = {}
      else {
        const next = { ...s.settings.shortcuts }
        delete next[id]
        s.settings.shortcuts = next
      }
    })
    core.shortcuts.reload()
    return true
  })
}

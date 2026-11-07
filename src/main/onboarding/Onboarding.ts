// First-run onboarding: swyr://onboarding opens as the first window's active Today tab until it is finished.
import { dialog } from 'electron'
import fs from 'node:fs'
import type { ArchiveAfter, Item, OnboardingCompletePayload } from '@shared/types'
import { regularSpaces, siblingsOf, spaceById } from '@shared/ops'
import { baseColor, isDark } from '@shared/theme'
import { newId } from '../util/id'
import { makeItem } from '../commands/builtins'
import type { Commands } from '../commands/Commands'
import type { Core } from '../windows/WindowManager'
import type { SwyrWindow } from '../windows/SwyrWindow'
import { CHROME_BOOKMARKS_PATH, readChromeBookmarks, type BookmarkNode } from './ChromeBookmarks'

export const ONBOARDING_URL = 'swyr://onboarding'
const NEWTAB_URL = 'swyr://newtab'
const ARCHIVE_CHOICES: ArchiveAfter[] = ['12h', '24h', '7d', '30d', 'never']
const HEX = /^#[0-9a-f]{6}$/i

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined)

export function needsOnboarding(core: Core): boolean {
  return core.store.state.settings.onboarded !== true && process.env.SWYR_SKIP_ONBOARDING !== '1'
}

/** called once at startup, after the first window exists */
export function startOnboarding(core: Core): void {
  if (!needsOnboarding(core)) return
  void core.commands.run('onboarding.open', {}, core.first()).catch((err) => console.error('[swyr] onboarding', err))
}

function isOnboardingItem(i: Item): boolean {
  return i.url.startsWith(ONBOARDING_URL)
}

/** the space bookmarks and onboarding choices go to: the window's space unless it is private */
function targetSpace(core: Core, w: SwyrWindow | undefined, spaceId?: string) {
  const s = core.store.state
  const explicit = spaceById(s, spaceId)
  if (explicit && !explicit.incognito) return explicit
  const current = w?.space()
  if (current && !current.incognito) return current
  return regularSpaces(s)[0]
}

function addBookmarks(core: Core, spaceId: string, profileId: string, nodes: BookmarkNode[], title: string): string {
  const s = core.store.state
  const now = Date.now()
  const rootOrder = siblingsOf(s, { section: 'pinned', spaceId, profileId, parentId: null }).reduce((m, i) => Math.max(m, i.order), -1) + 1
  const base = (p: Partial<Item> & Pick<Item, 'kind' | 'order' | 'url' | 'title'>): Item => ({
    id: newId(p.kind === 'folder' ? 'folder' : 'tab'),
    spaceId,
    profileId,
    parentId: null,
    section: 'pinned',
    customTitle: null,
    pinnedUrl: null,
    favicon: null,
    createdAt: now,
    lastActiveAt: 0,
    ...p
  })
  const root = base({ kind: 'folder', order: rootOrder, url: '', title, collapsed: false })
  core.store.update((st) => {
    st.items.push(root)
    const add = (list: BookmarkNode[], parentId: string): void => {
      list.forEach((n, i) => {
        if (n.kind === 'folder') {
          const f = base({ kind: 'folder', order: i, url: '', title: n.title, parentId, collapsed: true })
          st.items.push(f)
          add(n.children, f.id)
        } else {
          st.items.push(base({ kind: 'tab', order: i, url: n.url, pinnedUrl: n.url, title: n.title, parentId }))
        }
      })
    }
    add(nodes, root.id)
  })
  return root.id
}

export function registerOnboardingCommands(c: Commands): void {
  c.register('onboarding.open', ({ core, w }) => {
    if (!w) return null
    const space = w.space()
    const existing = core.store.state.items.find((i) => isOnboardingItem(i) && i.spaceId === space.id)
    if (existing) {
      w.activate(existing.id)
      return existing.id
    }
    return core.commands.run('tab.new', { url: ONBOARDING_URL, title: 'Welcome to swyr' }, w)
  })

  c.register('onboarding.complete', ({ core }, p) => {
    const choice = p as OnboardingCompletePayload
    const colors = Array.isArray(choice.themeColors) ? choice.themeColors.filter((x) => typeof x === 'string' && HEX.test(x)).slice(0, 3) : []
    const archiveAfter = ARCHIVE_CHOICES.includes(choice.archiveAfter as ArchiveAfter) ? (choice.archiveAfter as ArchiveAfter) : undefined
    const first = regularSpaces(core.store.state)[0]
    core.store.update((s) => {
      if (first && colors.length) first.theme = { ...first.theme, colors: colors.map((x) => x.toLowerCase()) }
      if (typeof choice.adblock === 'boolean') s.settings.adblock = choice.adblock
      if (archiveAfter) s.settings.archiveAfter = archiveAfter
      s.settings.onboarded = true
      // picked web apps become Favorites of the first space's profile (skipping ones already there)
      const picks = Array.isArray(choice.favorites) ? choice.favorites.filter((f) => f && typeof f.url === 'string' && /^https:\/\//i.test(f.url)).slice(0, 12) : []
      if (first) {
        for (const f of picks) {
          const exists = s.items.some((i) => i.section === 'favorites' && i.profileId === first.profileId && i.url === f.url)
          if (exists) continue
          const fav = makeItem(s, { url: f.url, section: 'favorites', profileId: first.profileId, title: typeof f.title === 'string' ? f.title.slice(0, 200) : '' })
          fav.pinnedUrl = f.url
          s.items.push(fav)
        }
      }
    })
    // the onboarding tab turns into a new tab page in place
    for (const item of core.store.state.items.filter(isOnboardingItem)) {
      core.store.update(() => {
        item.url = NEWTAB_URL
        item.title = 'New Tab'
      })
      for (const win of core.windows) {
        const view = win.tabs.get(item.id)
        if (view && !view.webContents.isDestroyed()) void view.webContents.loadURL(NEWTAB_URL).catch(() => undefined)
      }
    }
    for (const win of core.windows) {
      if (first && win.activeSpaceId === first.id) win.win.setBackgroundColor(baseColor(first, isDark(first.theme, core.systemDark())))
    }
    return { onboarded: true, spaceId: first?.id ?? null }
  })

  c.register('import.chrome', async ({ core, w }, p) => {
    let file = str(p.path)
    if (!file) {
      if (core.test || fs.existsSync(CHROME_BOOKMARKS_PATH)) file = CHROME_BOOKMARKS_PATH
      else {
        const res = await dialog.showOpenDialog({
          title: 'Choose a Chrome Bookmarks file',
          buttonLabel: 'Import',
          defaultPath: CHROME_BOOKMARKS_PATH,
          properties: ['openFile', 'showHiddenFiles']
        })
        if (res.canceled || !res.filePaths[0]) return null
        file = res.filePaths[0]
      }
    }
    try {
      const parsed = readChromeBookmarks(file)
      if (!parsed.links) return { error: 'That file has no bookmarks to import.' }
      const space = targetSpace(core, w, str(p.spaceId))
      if (!space) return { error: 'There is no space to import into.' }
      const folderId = addBookmarks(core, space.id, space.profileId, parsed.nodes, str(p.title) ?? 'Chrome Bookmarks')
      if (!core.test) w?.toast(`Imported ${parsed.links} bookmarks`)
      return { bookmarks: parsed.links, folders: parsed.folders, truncated: parsed.truncated, folderId, spaceId: space.id }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      return { error: code === 'ENOENT' ? 'No Chrome bookmarks file was found. Is Chrome installed with a Default profile?' : 'That file is not a Chrome bookmarks file.' }
    }
  })
}

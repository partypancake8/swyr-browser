// Mini Window commands, the chrome's IPC channel, and openInMiniWindow for external links.
import { ipcMain, Menu } from 'electron'
import { sortedSpaces, spaceById } from '@shared/ops'
import { resolveWithSettings } from '@shared/url'
import { MiniWindow } from '../windows/MiniWindow'
import { makeItem } from './builtins'
import type { Commands } from './Commands'
import type { Core } from '../windows/WindowManager'

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

let coreRef: Core | null = null

function findMini(core: Core, p: Record<string, unknown>): MiniWindow | undefined {
  const id = num(p.miniId)
  if (id !== undefined) return core.minis.find((m) => m.id === id && !m.closed)
  const last = core.lastMini
  if (last && !last.closed) return last
  return core.minis.filter((m) => !m.closed).at(-1)
}

export function createMini(core: Core, url?: string): MiniWindow {
  const s = core.store.state
  const space = spaceById(s, core.current()?.activeSpaceId) ?? sortedSpaces(s)[0]
  const profile = s.profiles.find((x) => x.id === space.profileId) ?? s.profiles[0]
  const target = url ? resolveWithSettings(url, s.settings).url : 'about:blank'
  const m = new MiniWindow(core, /^\s*(javascript|file|swyr):/i.test(target) ? 'about:blank' : target, profile)
  core.registerMini(m)
  return m
}

/**
 * Opens a URL in a new Mini Window. The open-url handler calls this when
 * settings.openExternalLinksInMiniWindow is on (see src/main/index.ts openUrl).
 */
export function openInMiniWindow(url: string): number | null {
  if (!coreRef) return null
  return createMini(coreRef, url).id
}

/** move the mini window's page into a space of the main window as a Today tab */
export function openMiniInMain(core: Core, m: MiniWindow, spaceId?: string): string | false {
  const s = core.store.state
  let w = core.current()
  const space = spaceById(s, spaceId) ?? (w ? w.space() : sortedSpaces(s)[0])
  if (!w) w = core.createWindow({ spaceId: space.id })
  const url = m.url() || 'swyr://newtab'
  const item = makeItem(s, {
    url: url === 'about:blank' ? 'swyr://newtab' : url,
    title: m.pageTitle(),
    favicon: m.pageFavicon(),
    section: 'today',
    profileId: space.profileId,
    spaceId: space.id
  })
  core.store.update((st) => st.items.push(item))
  if (m.profile.id === space.profileId && url !== 'about:blank') {
    const view = m.detachPage()
    if (view && !view.webContents.isDestroyed()) w.tabs.adopt(item, view)
  }
  if (space.id !== w.activeSpaceId) w.switchSpace(space.id)
  w.activate(item.id)
  m.close()
  if (!core.test) w.win.focus()
  return item.id
}

const MINI_IPC = new Set(['mini.openInMain', 'mini.close', 'mini.navigate', 'mini.back', 'mini.forward', 'mini.reload', 'mini.stop', 'mini.spaceMenu'])

export function registerMiniCommands(c: Commands, core: Core): void {
  coreRef = core

  ipcMain.handle('swyr:mini:invoke', async (event, command: unknown, payload: unknown) => {
    const m = core.minis.find((x) => !x.closed && x.win.webContents === event.sender)
    if (!m || typeof command !== 'string' || !MINI_IPC.has(command)) throw new Error('not allowed')
    const p = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
    const result = await core.commands.run(command, { ...p, miniId: m.id }, core.current())
    try {
      return JSON.parse(JSON.stringify(result ?? null))
    } catch {
      return null
    }
  })
  ipcMain.handle('swyr:mini:getState', (event) => core.minis.find((x) => !x.closed && x.win.webContents === event.sender)?.viewState() ?? null)

  c.register('mini.new', ({ core: k }, p) => createMini(k, str(p.url)).id)

  c.register('mini.openInMain', ({ core: k }, p) => {
    const m = findMini(k, p)
    if (!m) return false
    return openMiniInMain(k, m, str(p.spaceId))
  })

  c.register('mini.close', ({ core: k }, p) => {
    const m = findMini(k, p)
    if (!m) return false
    m.close()
    return true
  })

  c.register('mini.navigate', ({ core: k }, p) => {
    const m = findMini(k, p)
    const input = str(p.url) ?? str(p.input)
    const wc = m?.contents()
    if (!m || !wc || !input) return false
    const url = resolveWithSettings(input, k.store.state.settings).url
    if (/^\s*(javascript|file|swyr):/i.test(url)) return false
    void wc.loadURL(url).catch(() => undefined)
    return true
  })

  const nav = (fn: (wc: Electron.WebContents) => void) => ({ core: k }: { core: Core }, p: Record<string, unknown>) => {
    const wc = findMini(k, p)?.contents()
    if (!wc) return false
    fn(wc)
    return true
  }
  c.register('mini.back', nav((wc) => wc.navigationHistory.canGoBack() && wc.navigationHistory.goBack()))
  c.register('mini.forward', nav((wc) => wc.navigationHistory.canGoForward() && wc.navigationHistory.goForward()))
  c.register('mini.reload', nav((wc) => wc.reload()))
  c.register('mini.stop', nav((wc) => wc.stop()))

  c.register('mini.focusUrl', ({ core: k }, p) => {
    const m = findMini(k, p)
    if (!m) return false
    m.win.webContents.focus()
    m.win.webContents.send('swyr:mini:event', { type: 'focusUrl' })
    return true
  })

  /** the space picker next to "Open in main window" */
  c.register('mini.spaceMenu', ({ core: k }, p) => {
    const m = findMini(k, p)
    if (!m) return false
    if (k.test) return sortedSpaces(k.store.state).map((x) => x.id)
    const current = k.current()?.activeSpaceId
    Menu.buildFromTemplate(
      sortedSpaces(k.store.state).map((sp) => ({
        label: `${sp.emoji ? sp.emoji + '  ' : ''}${sp.name}`,
        type: 'checkbox' as const,
        checked: sp.id === current,
        click: () => void openMiniInMain(k, m, sp.id)
      }))
    ).popup({ window: m.win })
    return true
  })
}

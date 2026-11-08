// IPC between renderers and the command registry, with per-sender permissions.
import { ipcMain } from 'electron'
import type { Core } from './windows/WindowManager'
import { PLATFORM_PAGE_COMMANDS } from './commands/platform'
import { PAGE_3A_COMMANDS } from './commands/pages'
import { DOCUMENT_PAGE_COMMANDS } from './commands/documents' // round 3b
import { APP_PAGE_COMMANDS } from './commands/app'

/** commands an internal page (swyr://newtab, settings, archive) may run */
const PAGE_COMMANDS = new Set([
  'commandbar.open',
  'archive.restore',
  'archive.open',
  'settings.open',
  'settings.set',
  'tab.navigate',
  'tab.new',
  'space.edit',
  // round 2b: archive and library pages
  'archive.delete',
  'archive.clear',
  'library.open',
  'space.delete',
  'space.switch',
  ...PLATFORM_PAGE_COMMANDS, // round 2c
  ...PAGE_3A_COMMANDS, // round 3a: swyr://styles, swyr://history
  ...DOCUMENT_PAGE_COMMANDS, // round 3b
  ...APP_PAGE_COMMANDS // round 3c
])

export function registerIpc(core: Core): void {
  ipcMain.handle('swyr:invoke', async (event, command: unknown, payload: unknown) => {
    if (typeof command !== 'string') throw new Error('bad command')
    const owner = core.windowFor(event.sender)
    if (!owner) throw new Error('unknown sender')
    if (owner.role === 'tab') {
      const url = event.sender.getURL()
      if (!url.startsWith('swyr:') || !PAGE_COMMANDS.has(command)) throw new Error(`not allowed: ${command}`)
      if (command === 'tab.navigate' || command === 'tab.new') {
        const target = (payload as { url?: unknown; input?: unknown } | null)?.url ?? (payload as { input?: unknown } | null)?.input
        if (typeof target === 'string' && /^\s*(javascript|file):/i.test(target)) throw new Error('blocked url')
      }
    }
    const result = await core.commands.run(command, payload, owner.w)
    try {
      return JSON.parse(JSON.stringify(result ?? null))
    } catch {
      return null
    }
  })
  // page preload: mouse back/forward buttons. Accepted only from tab and mini window page views; the sender
  // navigates its own history, so a split pane goes back in that pane.
  ipcMain.on('swyr:mouseNav', (event, dir: unknown) => {
    if (dir !== 'back' && dir !== 'forward') return
    const wc = event.sender
    const isTab = core.windowFor(wc)?.role === 'tab'
    if (!isTab && !core.minis.some((m) => m.page?.webContents === wc)) return
    const h = wc.navigationHistory
    if (dir === 'back' && h.canGoBack()) h.goBack()
    if (dir === 'forward' && h.canGoForward()) h.goForward()
  })
  ipcMain.handle('swyr:getState', (event) => {
    const owner = core.windowFor(event.sender)
    if (!owner) return null
    if (owner.role === 'tab' && !event.sender.getURL().startsWith('swyr:')) return null
    return owner.w.viewState()
  })
}

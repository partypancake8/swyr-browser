// IPC between renderers and the command registry, with per-sender permissions.
import { ipcMain } from 'electron'
import type { Core } from './windows/WindowManager'

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
  'space.switch'
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
  ipcMain.handle('swyr:getState', (event) => {
    const owner = core.windowFor(event.sender)
    if (!owner) return null
    if (owner.role === 'tab' && !event.sender.getURL().startsWith('swyr:')) return null
    return owner.w.viewState()
  })
}

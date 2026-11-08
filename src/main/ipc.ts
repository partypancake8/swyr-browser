// IPC between renderers and the command registry. Every channel goes through the guard in security/IpcGuard.ts:
// swyr's UI views (shell, overlay) may run any command except the main-only ones, swyr:// pages in tabs run a
// short list, and web pages get only the mouse back/forward channel. Payloads are checked before any handler runs.
import type { Core } from './windows/WindowManager'
import { PLATFORM_PAGE_COMMANDS } from './commands/platform'
import { PAGE_3A_COMMANDS } from './commands/pages'
import { DOCUMENT_PAGE_COMMANDS } from './commands/documents' // round 3b
import { APP_PAGE_COMMANDS } from './commands/app'
import { UPDATE_PAGE_COMMANDS } from './updates/Updater'
import { MAIN_ONLY_COMMANDS, handle, isCommandName, on, rendererPayload, setGuardCore } from './security/IpcGuard'

/** commands an internal page (swyr://newtab, settings, archive) may run */
export const PAGE_COMMANDS = new Set([
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
  ...APP_PAGE_COMMANDS, // round 3c
  ...UPDATE_PAGE_COMMANDS // round 7
])

const clone = (result: unknown): unknown => {
  try {
    return JSON.parse(JSON.stringify(result ?? null))
  } catch {
    return null
  }
}

export function registerIpc(core: Core): void {
  setGuardCore(core)
  handle('swyr:invoke', ['shell', 'overlay', 'internalPage'], async (sender, command, payload) => {
    if (!isCommandName(command) || MAIN_ONLY_COMMANDS.has(command)) throw new Error('bad command')
    if (sender.role === 'internalPage' && !PAGE_COMMANDS.has(command)) throw new Error(`not allowed: ${command}`)
    const p = rendererPayload(command, payload)
    return clone(await core.commands.run(command, p, sender.w))
  })
  // page preload: mouse back/forward buttons, from tab and mini window pages only; the sender navigates its own
  // history, so a split pane goes back in that pane
  on('swyr:mouseNav', ['webPage', 'internalPage', 'miniPage'], (sender, dir) => {
    if (dir !== 'back' && dir !== 'forward') return
    const h = sender.wc.navigationHistory
    if (dir === 'back' && h.canGoBack()) h.goBack()
    if (dir === 'forward' && h.canGoForward()) h.goForward()
  })
  handle('swyr:getState', ['shell', 'overlay', 'internalPage'], (sender) => (sender.w ? sender.w.viewState() : null))
}


// swyr main process: lifecycle, protocol, windows, menus, test hook.
import { app } from 'electron'
import path from 'node:path'
import { registerSchemePrivileges } from './protocol/Protocol'
import { setupDefaultSession } from './profiles/Profiles'
import { Core } from './windows/WindowManager'
import { registerIpc } from './ipc'
import { startAutoArchive, runAutoArchive } from './archive/AutoArchive'
import { installTestHook } from './test/TestHook'
import { initPlatform } from './commands/platform'

const TEST = process.env.SWYR_TEST === '1'

app.setName('swyr')
if (TEST && process.env.SWYR_USER_DATA) app.setPath('userData', path.resolve(process.env.SWYR_USER_DATA))
// headless test runs keep their renderer count small: same-site pages share a process past this limit
if (TEST) app.commandLine.appendSwitch('renderer-process-limit', process.env.SWYR_RENDERER_LIMIT || '4')

registerSchemePrivileges()

let core: Core | null = null
const pendingUrls: string[] = []
let markReady: (c: Core) => void = () => undefined
const ready = new Promise<Core>((resolve) => (markReady = resolve))
if (TEST) installTestHook(ready, () => core)

/** every URL that arrives from outside (open-url, second instance, default browser) goes through Link Rules */
function openUrl(url: string): void {
  if (!core) {
    pendingUrls.push(url)
    return
  }
  void core.commands.run('link.openExternal', { url }).catch((err) => console.error('[swyr] open url failed', err))
}

// cold start as the default browser: URLs passed on the command line
for (const arg of process.argv.slice(1)) if (/^https?:\/\//i.test(arg)) pendingUrls.push(arg)

app.on('open-url', (event, url) => {
  event.preventDefault()
  if (/^https?:/i.test(url)) openUrl(url)
})

const gotLock = TEST ? true : app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    const url = argv.find((a) => /^https?:\/\//i.test(a))
    if (url) openUrl(url)
    else core?.current()?.win.focus()
  })

  app.whenReady().then(() => {
    if (TEST) app.dock?.hide()
    setupDefaultSession()
    core = new Core()
    initPlatform(core)
    core.commands.register('archive.runAuto', ({ core: c }) => runAutoArchive(c))
    registerIpc(core)
    core.menu.refresh()
    core.createWindow()
    startAutoArchive(core)
    markReady(core)
    for (const url of pendingUrls.splice(0)) openUrl(url)

    app.on('activate', () => {
      if (core && !core.windows.length && !TEST) core.createWindow()
    })
  })
}

app.on('window-all-closed', () => {
  // macOS convention: the app stays alive with no windows (except in tests)
  if (TEST) app.quit()
})

app.on('before-quit', () => core?.store.flush())

if (process.env.SWYR_DEBUG === '1') {
  for (const ev of ['before-quit', 'will-quit', 'quit', 'window-all-closed'] as const) {
    app.on(ev as 'quit', () => console.log('[swyr:debug]', ev, core?.windows.length))
  }
}

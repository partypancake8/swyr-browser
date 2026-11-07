// swyr main process: lifecycle, protocol, windows, menus, test hook.
import { app } from 'electron'
import path from 'node:path'
import { registerSchemePrivileges } from './protocol/Protocol'
import { setupDefaultSession } from './profiles/Profiles'
import { Core } from './windows/WindowManager'
import { registerIpc } from './ipc'
import { startAutoArchive, runAutoArchive } from './archive/AutoArchive'
import { installTestHook } from './test/TestHook'

const TEST = process.env.SWYR_TEST === '1'

app.setName('swyr')
if (TEST && process.env.SWYR_USER_DATA) app.setPath('userData', path.resolve(process.env.SWYR_USER_DATA))

registerSchemePrivileges()

let core: Core | null = null
const pendingUrls: string[] = []
let markReady: (c: Core) => void = () => undefined
const ready = new Promise<Core>((resolve) => (markReady = resolve))
if (TEST) installTestHook(ready, () => core)

function openUrl(url: string): void {
  if (!core) {
    pendingUrls.push(url)
    return
  }
  const w = core.current() ?? core.createWindow()
  void core.commands.run('tab.new', { url }, w)
}

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

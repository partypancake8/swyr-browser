// swyr main process: lifecycle, protocol, windows, menus, test hook.
import { app, BrowserWindow, webContents } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { registerSchemePrivileges } from './protocol/Protocol'
import { setupDefaultSession } from './profiles/Profiles'
import { installChromeIdentity } from './profiles/ChromeIdentity'
import { Core } from './windows/WindowManager'
import { registerIpc } from './ipc'
import { startAutoArchive, runAutoArchive } from './archive/AutoArchive'
import { installTestHook, installTestStdio } from './test/TestHook'
import { initPlatform } from './commands/platform'
import { setupAppIdentity } from './menu/About'
import { startOnboarding } from './onboarding/Onboarding'
import { frontmostApp, type SourceApp } from './linkrules/SourceApp'
import { registerUpdateCommands, startUpdateChecks } from './updates/Updater'
import { installHardening } from './security/Hardening'
import { installQuitGuard } from './util/QuitGuard'

const TEST = process.env.SWYR_TEST === '1'

app.setName('swyr')
// development runs (electron out/main/index.js) report swyr's version, not Electron's, so the About panel and
// the updater compare against the real one
if (!app.isPackaged) {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8')).version
    // app.setVersion exists at runtime but is missing from Electron's typings
    const setVersion = (app as unknown as { setVersion?: (v: string) => void }).setVersion
    if (typeof v === 'string' && setVersion) setVersion.call(app, v)
  } catch {
    /* keep Electron's */
  }
}
if (TEST && process.env.SWYR_USER_DATA) app.setPath('userData', path.resolve(process.env.SWYR_USER_DATA))
// headless test runs keep their renderer count small: same-site pages share a process past this limit
if (TEST) app.commandLine.appendSwitch('renderer-process-limit', process.env.SWYR_RENDERER_LIMIT || '4')

// round 8: every renderer sandboxed, secure web preferences and the navigation policy on every webContents
installHardening()
registerSchemePrivileges()
// site compatibility: every session (created anywhere) sends Chrome's user agent and client hint brands
installChromeIdentity()
// headless test runs stay silent: every webContents (tabs, panes, mini, preview, window.open children) starts muted,
// unless SWYR_AUDIO=1; muted media still fires media-started-playing, so the media bar sees it as playing
if (TEST && process.env.SWYR_AUDIO !== '1') {
  app.on('web-contents-created', (_e, wc) => {
    wc.setAudioMuted(true)
    wc.on('did-create-window', (win) => win.webContents.setAudioMuted(true))
  })
}

let core: Core | null = null
const pendingUrls: Array<{ url: string; source: Promise<SourceApp | null> }> = []
let markReady: (c: Core) => void = () => undefined
const ready = new Promise<Core>((resolve) => (markReady = resolve))
if (TEST) {
  installTestHook(ready, () => core)
  installTestStdio()
}

/**
 * every URL that arrives from outside (open-url, second instance, default browser) goes through Link Rules;
 * round 5: the frontmost app at arrival is recorded as the link's source app, for rules by source app
 */
function openUrl(url: string, source: Promise<SourceApp | null> = frontmostApp()): void {
  if (!core) {
    pendingUrls.push({ url, source })
    return
  }
  const c = core
  void source
    .catch(() => null)
    .then((app) => c.commands.run('link.openExternal', { url, sourceApp: app ? app.name || app.bundleId : undefined, sourceBundleId: app?.bundleId || undefined }))
    .catch((err) => console.error('[swyr] open url failed', err))
}

// cold start as the default browser: URLs passed on the command line (no source app: swyr was launched for them)
for (const arg of process.argv.slice(1)) if (/^https?:\/\//i.test(arg)) pendingUrls.push({ url: arg, source: Promise.resolve(null) })

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
    // round 3c: About panel and the dock icon in development (swyr never adds itself as a login item)
    setupAppIdentity(TEST)
    setupDefaultSession()
    core = new Core()
    initPlatform(core)
    core.commands.register('archive.runAuto', ({ core: c }, p) => runAutoArchive(c, typeof p.now === 'number' && Number.isFinite(p.now) ? p.now : undefined))
    const c0 = core
    registerUpdateCommands(core.commands, () => c0.store.notify()) // round 7: in-app updates
    registerIpc(core)
    core.menu.refresh()
    core.createWindow()
    app.dock?.setMenu(core.menu.dockMenu()) // round 3c
    startOnboarding(core) // round 3c: first run opens swyr://onboarding
    startAutoArchive(core)
    startUpdateChecks()
    markReady(core)
    for (const p of pendingUrls.splice(0)) openUrl(p.url, p.source)

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

// the quit path: once quitting starts, every window and view is destroyed and the process exits within seconds,
// whatever a page or view does: a vetoed close, or a view whose renderer was killed, would otherwise cancel or
// stall the quit and leave swyr running
installQuitGuard(app, {
  teardown: () => {
    core?.store.flush()
    let left = 0
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue
      left++
      win.destroy()
    }
    for (const wc of webContents.getAllWebContents()) if (!wc.isDestroyed()) wc.close()
    return left
  },
  log: (msg) => console.warn(msg)
})

if (process.env.SWYR_DEBUG === '1') {
  for (const ev of ['before-quit', 'will-quit', 'quit', 'window-all-closed'] as const) {
    app.on(ev as 'quit', () => console.log('[swyr:debug]', ev, core?.windows.length))
  }
}

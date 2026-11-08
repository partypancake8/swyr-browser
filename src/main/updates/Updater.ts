// Round 7: in-app updates from GitHub Releases through electron-updater.
// The packaged app checks 20 s after launch and every 2 hours, downloads the zip named in latest-mac.yml and
// installs it on quit (or on "Restart to update"). It also checks again whenever swyr comes to the foreground and
// the last check started more than 30 minutes ago (under SWYR_TEST, on every focus). Under SWYR_TEST only SWYR_UPDATE_FEED (a generic feed) is
// checked, and only when a test runs update.check; SWYR_UPDATE_NO_DOWNLOAD=1 stops after "available".
import { app, dialog } from 'electron'
import electronUpdater, { type AppUpdater } from 'electron-updater'
import type { UpdateRuntime } from '@shared/types'
import type { Commands } from '../commands/Commands'
import { REPO_URL } from '../menu/Menu'

const TEST = process.env.SWYR_TEST === '1'
const FIRST_CHECK_MS = 20_000
const INTERVAL_MS = 2 * 60 * 60 * 1000
/** a foreground check runs when the last one started longer ago than this */
const FOCUS_GAP_MS = TEST ? 0 : 30 * 60 * 1000

/** commands the internal pages (swyr://settings) may run over IPC */
export const UPDATE_PAGE_COMMANDS = ['update.check', 'update.install', 'update.openReleaseNotes', 'update.state']

let state: Omit<UpdateRuntime, 'current'> = { status: 'idle' }
let changed: () => void = () => undefined
let updater: AppUpdater | null = null

export function updateRuntime(): UpdateRuntime {
  return { ...state, current: app.getVersion() }
}

function set(patch: Partial<UpdateRuntime>): void {
  state = { ...state, ...patch }
  changed()
}

function message(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err)
  if (/404|HttpError: 404|Cannot find latest/i.test(text)) return 'No release is published yet.'
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|net::ERR/i.test(text)) return 'Could not reach the update server.'
  return text.split('\n')[0].slice(0, 200)
}

/** the updater, or null when this build cannot update (development builds outside tests) */
function setup(): AppUpdater | null {
  if (updater) return updater
  const feed = TEST ? process.env.SWYR_UPDATE_FEED : undefined
  if (TEST && !feed) return null
  if (!TEST && !app.isPackaged) return null
  const u = electronUpdater.autoUpdater
  u.logger = null
  u.autoDownload = !(TEST && process.env.SWYR_UPDATE_NO_DOWNLOAD === '1')
  u.autoInstallOnAppQuit = true
  if (feed) {
    u.forceDevUpdateConfig = true
    u.setFeedURL({ provider: 'generic', url: feed })
  }
  u.on('checking-for-update', () => set({ status: 'checking', error: undefined }))
  u.on('update-available', (info) => set({ status: u.autoDownload ? 'downloading' : 'available', version: info.version, percent: u.autoDownload ? 0 : undefined, checkedAt: Date.now() }))
  u.on('update-not-available', () => set({ status: 'upToDate', version: undefined, percent: undefined, checkedAt: Date.now() }))
  u.on('download-progress', (p) => {
    const percent = Math.floor(p.percent)
    if (percent !== state.percent) set({ status: 'downloading', percent })
  })
  u.on('update-downloaded', (info) => set({ status: 'ready', version: info.version, percent: 100 }))
  u.on('error', (err) => {
    // a failed download or install (Squirrel.Mac refusing the bundle) keeps the version on offer, so the
    // sidebar row and Settings still point at the release page
    if (state.version && (state.status === 'downloading' || state.status === 'available' || state.status === 'ready')) set({ status: 'available', error: message(err), checkedAt: Date.now() })
    else set({ status: 'error', error: message(err), checkedAt: Date.now() })
  })
  updater = u
  return u
}

let lastStart = 0

/**
 * check the feed. checkedAt is stamped when a check starts (and again when it finishes), so it moves on every
 * check, failed ones included. background: a check swyr started by itself; a build that cannot update only
 * records the attempt instead of showing an error.
 */
export async function checkForUpdates(opts: { background?: boolean } = {}): Promise<UpdateRuntime> {
  if (state.status === 'ready' || state.status === 'downloading' || state.status === 'checking') return updateRuntime()
  lastStart = Date.now()
  const u = setup()
  if (!u) {
    if (opts.background) set({ checkedAt: lastStart })
    else set({ status: 'error', error: 'This build does not update itself. Install a release build.', checkedAt: lastStart })
    return updateRuntime()
  }
  set({ checkedAt: lastStart })
  try {
    await u.checkForUpdates()
  } catch (err) {
    if (state.status !== 'error' && state.status !== 'available') set({ status: 'error', error: message(err), checkedAt: Date.now() })
  }
  return updateRuntime()
}

export function releaseUrl(version = state.version): string {
  return version ? `${REPO_URL}/releases/tag/v${version}` : `${REPO_URL}/releases/latest`
}

export function registerUpdateCommands(c: Commands, onChange: () => void): void {
  changed = onChange
  c.register('update.state', () => updateRuntime())
  c.register('update.check', () => checkForUpdates())
  // the app menu item: check, then say what happened (the sidebar row and Settings carry the rest)
  c.register('update.checkInteractive', async ({ core, w }) => {
    const r = await checkForUpdates()
    if (TEST) return r
    const detail =
      r.status === 'upToDate'
        ? `swyr ${r.current} is the newest version.`
        : r.status === 'ready'
          ? `swyr ${r.version} is ready. Restart swyr to update.`
          : r.status === 'downloading' || r.status === 'available'
            ? `swyr ${r.version} is available${r.status === 'downloading' ? ' and downloading' : ''}.`
            : r.error || 'The check did not finish.'
    const buttons = r.status === 'ready' ? ['Restart to Update', 'Later'] : r.version ? ['OK', 'Release Notes'] : ['OK']
    const opts = { type: 'info' as const, message: r.status === 'error' ? 'Could not check for updates' : 'Software update', detail, buttons }
    const res = w ? await dialog.showMessageBox(w.win, opts) : await dialog.showMessageBox(opts)
    if (r.status === 'ready' && res.response === 0) return core.commands.run('update.install', {}, w)
    if (r.version && r.status !== 'ready' && res.response === 1) return core.commands.run('update.openReleaseNotes', {}, w)
    return r
  })
  c.register('update.install', () => {
    if (state.status !== 'ready' || !updater) return false
    if (TEST) return 'skipped in test mode'
    // quitAndInstall closes every window first; give the menu click time to return
    setImmediate(() => updater?.quitAndInstall(false, true))
    return true
  })
  c.register('update.openReleaseNotes', ({ core, w }) => core.commands.run('tab.new', { url: releaseUrl() }, w))
}

/** a check when swyr comes to the foreground, if the last one started more than FOCUS_GAP_MS ago */
function checkOnForeground(): void {
  if (Date.now() - lastStart < FOCUS_GAP_MS && lastStart > 0) return
  void checkForUpdates({ background: true })
}

/** packaged builds: first check 20 s after launch, then every 2 hours, and on coming to the foreground after a gap */
export function startUpdateChecks(): void {
  if (TEST || app.isPackaged) {
    app.on('browser-window-focus', checkOnForeground)
    app.on('activate', checkOnForeground)
  }
  if (TEST || !app.isPackaged) return
  const run = (): void => void checkForUpdates({ background: true })
  setTimeout(run, FIRST_CHECK_MS).unref()
  setInterval(run, INTERVAL_MS).unref()
}

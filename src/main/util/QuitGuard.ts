// The quit path: once the app starts quitting (Quit in the menu, the dock, the system, or a test harness calling
// app.quit), every window and view is torn down and the process ends within a few seconds, whatever a page, a
// view or a pending prompt does. Without it a single window whose close is vetoed (a page's beforeunload, a view
// that never closes) cancels the quit silently and leaves the process running with no windows.
// No Electron import here, so the logic is unit-tested with a stand-in app (tests/unit.mjs).

export const QUIT_WATCHDOG_MS = 4000
/** how long windows get to close normally (pages flush their last edits in beforeunload) before they are destroyed */
export const QUIT_GRACE_MS = 1500

export interface QuitApp {
  on(event: 'before-quit' | 'will-quit', listener: () => void): unknown
  exit(code?: number): void
  quit(): void
}

export interface QuitGuardOptions {
  /**
   * destroy every window and view; called once, when the windows had their grace period to close on their own.
   * Returns how many windows were still open: a window still open then had vetoed its close and cancelled the quit.
   */
  teardown: () => number
  /** last resort: the process exits this long after the quit started, even if something kept it alive */
  watchdogMs?: number
  setTimer?: (fn: () => void, ms: number) => unknown
  graceMs?: number
  log?: (msg: string) => void
}

let quittingNow = false
/** true once the app has started quitting: crashed views are not revived then (a reload would hold up the quit) */
export const appQuitting = (): boolean => quittingNow

export interface QuitGuard {
  /** true once a quit has started (the watchdog is running) */
  readonly quitting: boolean
}

export function installQuitGuard(app: QuitApp, opts: QuitGuardOptions): QuitGuard {
  const ms = opts.watchdogMs ?? QUIT_WATCHDOG_MS
  const setTimer = opts.setTimer ?? ((fn, t) => setTimeout(fn, t))
  const grace = opts.graceMs ?? QUIT_GRACE_MS
  const state = { quitting: false, tornDown: false }
  const teardown = (requit: boolean): void => {
    if (state.tornDown) return
    state.tornDown = true
    let left = 0
    try {
      left = opts.teardown()
    } catch (err) {
      opts.log?.(`[swyr] quit teardown failed: ${err instanceof Error ? err.message : String(err)}`)
    }
    // a window that vetoed its close cancelled the quit; with every window gone now, quit again
    if (requit && left > 0) app.quit()
  }
  const start = (): void => {
    if (state.quitting) return
    state.quitting = true
    quittingNow = true
    // the watchdog is armed first, so nothing below (or anything that hangs later) can keep the process alive
    setTimer(() => {
      opts.log?.('[swyr] quit did not finish in time; exiting')
      app.exit(0)
    }, ms)
    // windows close normally first (beforeunload flushes, state saves); whatever is still around then is destroyed
    setTimer(() => teardown(true), grace)
  }
  app.on('before-quit', start)
  app.on('will-quit', () => {
    start()
    teardown(false)
  })
  return {
    get quitting() {
      return state.quitting
    }
  }
}

// Process-wide hardening, installed before the app is ready. Every renderer runs sandboxed (app.enableSandbox,
// so nothing can opt out), every view is created with SECURE_PREFS, and every webContents, including the ones
// the extensions library creates, gets the navigation and window.open policy from urlPolicy.ts.
import { app, session, type Session, type WebContents, type WebPreferences } from 'electron'
import { isInternal, schemeOf, webContentMayNavigate, webContentMayOpen } from './urlPolicy'

/** the web preferences every webContents in swyr runs with */
export const SECURE_PREFS = {
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  nodeIntegrationInWorker: false,
  nodeIntegrationInSubFrames: false,
  webSecurity: true,
  allowRunningInsecureContent: false,
  experimentalFeatures: false,
  webviewTag: false,
  navigateOnDragDrop: false,
  safeDialogs: true
} as const satisfies WebPreferences

/** a view's own preferences with the secure ones on top (they always win) */
export function securePrefs(prefs: WebPreferences = {}): WebPreferences {
  return { ...prefs, ...SECURE_PREFS }
}

/** Chromium's dictionary server, the one Electron uses by default */
export const SPELLCHECK_DICTIONARY_URL = 'https://redirector.gvt1.com/edgedl/chrome/dict/'

function hardenSession(ses: Session): void {
  try {
    ses.setSpellCheckerDictionaryDownloadURL(SPELLCHECK_DICTIONARY_URL)
  } catch {
    /* sessions without a spellchecker */
  }
}

function hardenContents(wc: WebContents): void {
  // no <webview>: swyr never uses one, so a page that manages to add one gets nothing
  wc.on('will-attach-webview', (e) => e.preventDefault())
  // renderer-started navigations (links, location changes, forms) never reach swyr:// pages or local files from
  // web content; loads swyr starts itself (loadURL) do not pass through here
  wc.on('will-navigate', (e) => {
    if (!webContentMayNavigate(e.url, wc.getURL())) e.preventDefault()
  })
  wc.on('will-redirect', (e) => {
    const s = schemeOf(e.url)
    if ((s === 'swyr' || s === 'file') && !isInternal(wc.getURL())) e.preventDefault()
  })
  // frames inside web pages cannot load swyr:// pages or local files either
  wc.on('will-frame-navigate', (e) => {
    if (e.isMainFrame) return
    const s = schemeOf(e.url)
    if ((s === 'swyr' || s === 'file') && !isInternal(wc.getURL())) e.preventDefault()
  })
  // the default for webContents that set no handler of their own (tabs, Preview and Mini Windows set theirs):
  // only web pages may open, and the new window gets the secure preferences
  wc.setWindowOpenHandler(({ url }) => {
    // swyr's own UI views never open windows (a popup would inherit their preload)
    if (/^swyr:\/\/(shell|overlay|mini)\//.test(wc.getURL()) || !webContentMayOpen(url, wc.getURL())) return { action: 'deny' }
    return { action: 'allow', overrideBrowserWindowOptions: { webPreferences: securePrefs() } }
  })
}

let installed = false

/** call once, before app ready */
export function installHardening(): void {
  if (installed) return
  installed = true
  app.enableSandbox()
  app.on('web-contents-created', (_e, wc) => hardenContents(wc))
  app.on('session-created', (ses) => hardenSession(ses))
  void app.whenReady().then(() => hardenSession(session.defaultSession))
}

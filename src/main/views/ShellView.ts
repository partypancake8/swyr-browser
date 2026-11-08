// The React shell: one view per window that fills the window at the bottom of the z-order.
import { WebContentsView, type WebContents } from 'electron'
import path from 'node:path'
import { securePrefs } from '../security/Hardening'

export function preloadPath(name: 'index' | 'page' | 'mini'): string {
  return path.join(__dirname, `../preload/${name}.js`)
}

export function rendererUrl(host: 'shell' | 'overlay' | 'mini'): string {
  const dev = process.env.ELECTRON_RENDERER_URL
  return dev ? `${dev}/${host}/index.html` : `swyr://${host}/`
}

/** swyr's own UI pages (shell, overlay, mini chrome) reload themselves when their renderer process dies */
export function reviveOnCrash(wc: WebContents, url: string): void {
  wc.on('render-process-gone', (_e, details) => {
    if (details.reason === 'clean-exit' || wc.isDestroyed()) return
    setTimeout(() => {
      if (!wc.isDestroyed()) void wc.loadURL(url).catch(() => undefined)
    }, 50)
  })
}

export function createShellView(background: string): WebContentsView {
  const view = new WebContentsView({
    webPreferences: securePrefs({
      preload: preloadPath('index'),
      backgroundThrottling: false,
      spellcheck: false
    })
  })
  view.setBackgroundColor(background)
  void view.webContents.loadURL(rendererUrl('shell'))
  reviveOnCrash(view.webContents, rendererUrl('shell'))
  return view
}

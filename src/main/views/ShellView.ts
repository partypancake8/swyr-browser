// The React shell: one view per window that fills the window at the bottom of the z-order.
import { WebContentsView } from 'electron'
import path from 'node:path'

export function preloadPath(name: 'index' | 'page'): string {
  return path.join(__dirname, `../preload/${name}.js`)
}

export function rendererUrl(host: 'shell' | 'overlay'): string {
  const dev = process.env.ELECTRON_RENDERER_URL
  return dev ? `${dev}/${host}/index.html` : `swyr://${host}/`
}

export function createShellView(background: string): WebContentsView {
  const view = new WebContentsView({
    webPreferences: {
      preload: preloadPath('index'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      spellcheck: false
    }
  })
  view.setBackgroundColor(background)
  void view.webContents.loadURL(rendererUrl('shell'))
  return view
}

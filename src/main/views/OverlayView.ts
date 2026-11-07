// One transparent view on top of everything, attached only while an overlay is open.
import { WebContentsView } from 'electron'
import { preloadPath, rendererUrl } from './ShellView'

export function createOverlayView(): WebContentsView {
  const view = new WebContentsView({
    webPreferences: {
      preload: preloadPath('index'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      spellcheck: false,
      transparent: true
    }
  })
  view.setBackgroundColor('#00000000')
  void view.webContents.loadURL(rendererUrl('overlay'))
  return view
}

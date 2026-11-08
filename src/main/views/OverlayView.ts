// One transparent view on top of everything, attached only while an overlay is open.
import { WebContentsView } from 'electron'
import { preloadPath, rendererUrl, reviveOnCrash } from './ShellView'
import { securePrefs } from '../security/Hardening'

export function createOverlayView(): WebContentsView {
  const view = new WebContentsView({
    webPreferences: securePrefs({
      preload: preloadPath('index'),
      backgroundThrottling: false,
      spellcheck: false,
      transparent: true
    })
  })
  view.setBackgroundColor('#00000000')
  void view.webContents.loadURL(rendererUrl('overlay'))
  reviveOnCrash(view.webContents, rendererUrl('overlay'))
  return view
}

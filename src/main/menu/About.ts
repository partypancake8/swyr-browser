// The About panel and the app icon in development (the packaged app takes its icon from icon.icns).
import { app, nativeImage, type AboutPanelOptionsOptions } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { NOT_AFFILIATED } from '@shared/importer'

/** resources/icon.png next to the app in development, or in the bundle's Resources folder when packaged */
export function appIconPath(): string | null {
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, 'icon.png')]
    : [path.join(app.getAppPath(), 'resources', 'icon.png'), path.join(__dirname, '../../resources/icon.png')]
  return candidates.find((p) => fs.existsSync(p)) ?? null
}

export function aboutPanelOptions(): AboutPanelOptionsOptions {
  const icon = appIconPath()
  return {
    applicationName: 'swyr',
    applicationVersion: app.getVersion(),
    version: `Electron ${process.versions.electron}`,
    copyright: `Copyright © ${new Date().getFullYear()} Sawyer Smith`,
    credits: `Open source under the MIT license.\n${NOT_AFFILIATED}`,
    ...(icon ? { iconPath: icon } : {})
  }
}

/** About panel options, and the dock icon while running from source */
export function setupAppIdentity(test: boolean): void {
  app.setAboutPanelOptions(aboutPanelOptions())
  if (!app.isPackaged && !test) {
    const icon = appIconPath()
    if (icon) app.dock?.setIcon(nativeImage.createFromPath(icon))
  }
}

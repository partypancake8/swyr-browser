// electron-builder afterPack hook (runs before signing).
// 1. electron-builder forces NSAllowsArbitraryLoads = true for its updater after mac.extendInfo is applied;
//    swyr keeps App Transport Security on (Chromium's network stack does not use it, so pages still load).
// 2. builds from a local Electron dist (electronDist) keep Electron's default_app.asar; it is not part of swyr.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

export default async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin' && context.electronPlatformName !== 'mas') return
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  const plist = path.join(app, 'Contents', 'Info.plist')
  execFileSync('plutil', ['-replace', 'NSAppTransportSecurity.NSAllowsArbitraryLoads', '-bool', 'NO', plist])
  fs.rmSync(path.join(app, 'Contents', 'Resources', 'default_app.asar'), { force: true })
}

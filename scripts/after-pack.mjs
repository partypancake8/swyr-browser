// electron-builder afterPack hook (runs before signing, so the signature covers every change made here).
// 1. electron-builder forces NSAllowsArbitraryLoads = true for its updater after mac.extendInfo is applied;
//    swyr keeps App Transport Security on (Chromium's network stack does not use it, so pages still load).
// 2. builds from a local Electron dist (electronDist) keep Electron's default_app.asar; it is not part of swyr.
// 3. Electron fuses are flipped in the Electron Framework binary. They turn off the ways a signed swyr could be made
//    to run other code (ELECTRON_RUN_AS_NODE, NODE_OPTIONS, --inspect, an app folder beside app.asar, an edited
//    app.asar) and encrypt cookies at rest with a key in the login keychain. See SECURITY.md.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { flipFuses, FuseV1Options, FuseVersion } from '@electron/fuses'

export const FUSES = {
  version: FuseVersion.V1,
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableCookieEncryption]: true,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
  [FuseV1Options.OnlyLoadAppFromAsar]: true,
  // internal pages use swyr://, so file:// pages need no extra privileges
  [FuseV1Options.GrantFileProtocolExtraPrivileges]: false
}

export default async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin' && context.electronPlatformName !== 'mas') return
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  const plist = path.join(app, 'Contents', 'Info.plist')
  execFileSync('plutil', ['-replace', 'NSAppTransportSecurity.NSAllowsArbitraryLoads', '-bool', 'NO', plist])
  fs.rmSync(path.join(app, 'Contents', 'Resources', 'default_app.asar'), { force: true })
  // asar integrity validation needs the header hash electron-builder writes into Info.plist
  const integrity = JSON.parse(execFileSync('plutil', ['-extract', 'ElectronAsarIntegrity', 'json', '-o', '-', plist]).toString())
  if (!integrity['Resources/app.asar']?.hash) throw new Error('Info.plist has no ElectronAsarIntegrity entry for app.asar')
  // the removed default_app.asar keeps no entry
  delete integrity['Resources/default_app.asar']
  execFileSync('plutil', ['-replace', 'ElectronAsarIntegrity', '-json', JSON.stringify(integrity), plist])
  await flipFuses(app, FUSES)
}

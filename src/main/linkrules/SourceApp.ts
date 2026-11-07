// The app a link came from. macOS hands swyr a link through open-url (or a second launch) without saying who sent it,
// so swyr uses the usual heuristic: the frontmost app at the moment the link arrives is the source (the sending app
// is still in front; macOS brings swyr forward only after delivering the link). Read with `lsappinfo` (fast), with
// System Events through osascript as the fallback; each probe is capped at 300 ms and the answer is cached briefly.
import { execFile } from 'node:child_process'

import type { SourceApp } from './LinkRules'

export type { SourceApp }

const PROBE_TIMEOUT_MS = 300
const CACHE_MS = 1000

let cache: { at: number; value: SourceApp | null } | null = null
let override: SourceApp | null | undefined

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: PROBE_TIMEOUT_MS, encoding: 'utf8' }, (err, stdout) => resolve(err ? '' : String(stdout)))
  })
}

/** read the frontmost app now (no cache, no override) */
export async function probe(): Promise<SourceApp | null> {
  const asn = (await run('/usr/bin/lsappinfo', ['front'])).trim()
  if (asn) {
    const info = await run('/usr/bin/lsappinfo', ['info', '-only', 'name', '-only', 'bundleid', asn])
    const name = /"LSDisplayName"="([^"]*)"/.exec(info)?.[1] ?? ''
    const bundleId = /"CFBundleIdentifier"="([^"]*)"/.exec(info)?.[1] ?? ''
    if (name || bundleId) return { name, bundleId }
  }
  const name = (await run('/usr/bin/osascript', ['-e', 'tell application "System Events" to get name of first process whose frontmost is true'])).trim()
  return name ? { name, bundleId: '' } : null
}

/** the frontmost app right now, or null when it is swyr itself or cannot be read */
export async function frontmostApp(selfName = 'swyr'): Promise<SourceApp | null> {
  if (override !== undefined) return override
  // headless test runs never depend on whatever app happens to be in front of the test machine
  if (process.env.SWYR_TEST === '1') return null
  const now = Date.now()
  if (!cache || now - cache.at > CACHE_MS) cache = { at: now, value: await probe().catch(() => null) }
  const v = cache.value
  if (!v) return null
  if (v.name.toLowerCase() === selfName.toLowerCase() || /^com\.swyr\./i.test(v.bundleId) || /^(Electron|com\.github\.Electron)$/i.test(v.name || v.bundleId)) return null
  return v
}

/** test mode only: pretend this app is in front when links arrive (undefined restores the real probe) */
export function setSourceAppOverride(app: SourceApp | null | undefined): void {
  override = app
  cache = null
}

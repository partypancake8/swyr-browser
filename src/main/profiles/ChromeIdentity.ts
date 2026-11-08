// Site compatibility: every session presents itself the way the matching Google Chrome build does.
// The user agent is Chrome's reduced string (Chrome/<major>.0.0.0, no Electron or swyr token), and the
// client hint brand list (Sec-CH-UA headers) carries "Google Chrome" next to "Chromium" in Chrome's order.
// The page-side half (navigator.userAgentData, window.chrome) lives in the page preload.
import { app, session, type Session } from 'electron'

/** the Chromium major version this build runs; the UA never claims another one */
export const CHROME_MAJOR = Number((process.versions.chrome || '0').split('.')[0]) || 0

/** Chrome's reduced user agent built from a session's default string (drops Electron and swyr, freezes the minor version) */
export function chromeLikeUserAgent(ua: string): string {
  const major = CHROME_MAJOR || Number(/Chrome\/(\d+)/.exec(ua)?.[1] || 0)
  return ua
    .replace(/\s(swyr|Electron)\/\S+/gi, '')
    .replace(/Chrome\/[\d.]+/, `Chrome/${major}.0.0.0`)
    .replace(/\s{2,}/g, ' ')
    .trim()
}

export interface BrandVersion {
  brand: string
  version: string
}

/**
 * Chrome's brand list from Chromium's: add "Google Chrome" with Chromium's version and order the three
 * entries the way Chrome does (a permutation picked by the major version, GREASE brand included)
 */
export function chromeBrandList<T extends BrandVersion>(list: readonly T[], major = CHROME_MAJOR): T[] {
  const clean = list.filter((b) => !/electron|swyr/i.test(b.brand))
  if (clean.some((b) => b.brand === 'Google Chrome')) return clean
  const chromium = clean.find((b) => b.brand === 'Chromium')
  const grease = clean.find((b) => b !== chromium)
  if (!chromium || !grease) return clean
  const base = [grease, chromium, { ...chromium, brand: 'Google Chrome' }]
  const orders = [
    [0, 1, 2],
    [0, 2, 1],
    [1, 0, 2],
    [1, 2, 0],
    [2, 0, 1],
    [2, 1, 0]
  ]
  const order = orders[(major || Number(chromium.version.split('.')[0]) || 0) % orders.length]
  const out: T[] = new Array(3)
  base.forEach((b, i) => (out[order[i]] = b))
  return out
}

export function parseBrandHeader(value: string): BrandVersion[] {
  const out: BrandVersion[] = []
  const re = /"((?:[^"\\]|\\.)*)"\s*;\s*v="((?:[^"\\]|\\.)*)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(value))) out.push({ brand: m[1], version: m[2] })
  return out
}

export function formatBrandHeader(list: readonly BrandVersion[]): string {
  return list.map((b) => `"${b.brand}";v="${b.version}"`).join(', ')
}

/** the low-entropy brand list Chrome sends on every secure request: GREASE plus Chromium and Google Chrome at the major version */
function defaultBrandHeader(): string {
  // Chromium's GREASE brand for this major version, as the renderer reports it (Electron computes the same one Chrome does)
  return formatBrandHeader(chromeBrandList(greaseFor(CHROME_MAJOR).concat({ brand: 'Chromium', version: String(CHROME_MAJOR) })))
}

/** Chromium's GREASE brand algorithm (components/embedder_support/user_agent_utils.cc), seeded by the major version */
export function greaseFor(major: number): BrandVersion[] {
  const chars = [' ', '(', ':', '-', '.', '/', ')', ';', '=', '?', '_']
  const versions = ['8', '99', '24']
  const brand = `Not${chars[major % chars.length]}A${chars[(major + 1) % chars.length]}Brand`
  return [{ brand, version: versions[major % versions.length] }]
}

function headerKey(headers: Record<string, string>, name: string): string | undefined {
  const lower = name.toLowerCase()
  return Object.keys(headers).find((k) => k.toLowerCase() === lower)
}

/** rewrite (or add, on secure requests) the Sec-CH-UA brand headers so they match Chrome's */
export function chromeClientHintHeaders(url: string, headers: Record<string, string>): Record<string, string> {
  const out = { ...headers }
  for (const name of ['Sec-CH-UA', 'Sec-CH-UA-Full-Version-List']) {
    const key = headerKey(out, name)
    if (!key) continue
    const list = parseBrandHeader(out[key])
    if (list.length) out[key] = formatBrandHeader(chromeBrandList(list))
  }
  if (/^(https|wss):/i.test(url) && !headerKey(out, 'Sec-CH-UA')) {
    out['sec-ch-ua'] = defaultBrandHeader()
    if (!headerKey(out, 'Sec-CH-UA-Mobile')) out['sec-ch-ua-mobile'] = '?0'
    if (!headerKey(out, 'Sec-CH-UA-Platform')) out['sec-ch-ua-platform'] = platformHint()
  }
  return out
}

function platformHint(): string {
  if (process.platform === 'darwin') return '"macOS"'
  if (process.platform === 'win32') return '"Windows"'
  return '"Linux"'
}

const applied = new WeakSet<Session>()

/** give one session the Chrome identity (idempotent) */
export function applyChromeIdentity(ses: Session): void {
  if (applied.has(ses)) return
  applied.add(ses)
  ses.setUserAgent(chromeLikeUserAgent(ses.getUserAgent()))
  ses.webRequest.onBeforeSendHeaders({ urls: ['<all_urls>'] }, (details, callback) => {
    try {
      const out = chromeClientHintHeaders(details.url, details.requestHeaders)
      callback({ requestHeaders: out })
    } catch {
      callback({})
    }
  })
}

/** every session, wherever it is created (profiles, private windows, previews, extension pages), gets the Chrome identity */
export function installChromeIdentity(): void {
  app.userAgentFallback = chromeLikeUserAgent(app.userAgentFallback)
  app.on('session-created', (ses) => applyChromeIdentity(ses))
  app.on('web-contents-created', (_e, wc) => {
    const ua = wc.getUserAgent()
    if (/electron|swyr/i.test(ua) || !/Chrome\/\d+\.0\.0\.0/.test(ua)) wc.setUserAgent(chromeLikeUserAgent(ua))
  })
  if (app.isReady()) applyChromeIdentity(session.defaultSession)
}

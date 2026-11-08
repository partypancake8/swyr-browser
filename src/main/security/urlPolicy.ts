// URL policy for navigation, window.open, the command layer and external opens. No Electron imports, so
// tests/security.mjs can load this file directly.

/** schemes link.openExternal hands to macOS besides http and https */
export const EXTERNAL_APP_SCHEMES: readonly string[] = ['mailto', 'tel', 'sms', 'facetime', 'zoommtg', 'slack', 'spotify', 'vscode', 'x-apple.systempreferences']

/** data: URLs that only ever render as an image (svg can carry script, so it is not here) */
const SAFE_DATA = /^data:image\/(png|jpe?g|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon)[;,]/

/** the URL as a browser parses it: leading and trailing control characters and spaces dropped, tabs and newlines removed */
export function cleanUrl(url: string): string {
  let start = 0
  let end = url.length
  while (start < end && url.charCodeAt(start) <= 0x20) start++
  while (end > start && url.charCodeAt(end - 1) <= 0x20) end--
  return url.slice(start, end).replace(/[\t\n\r]/g, '')
}

/** the lowercased scheme without the colon, or '' when the string has none */
export function schemeOf(url: string): string {
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(cleanUrl(url))
  return m ? m[1].toLowerCase() : ''
}

/** javascript: and vbscript: URLs (also behind view-source:): refused everywhere, whoever asks */
export function isCodeUrl(url: string): boolean {
  const scheme = schemeOf(url)
  if (scheme === 'javascript' || scheme === 'vbscript') return true
  return scheme === 'view-source' && isCodeUrl(cleanUrl(url).slice('view-source:'.length))
}

/** URLs that run code in whatever page loads them: javascript:, vbscript: and data: other than plain images */
export function isScriptUrl(url: string): boolean {
  const scheme = schemeOf(url)
  if (scheme === 'javascript' || scheme === 'vbscript') return true
  if (scheme === 'data') return !SAFE_DATA.test(cleanUrl(url).toLowerCase())
  if (scheme === 'view-source') return isScriptUrl(cleanUrl(url).slice('view-source:'.length))
  return false
}

export const isInternal = (url: string): boolean => schemeOf(url) === 'swyr'
export const isFile = (url: string): boolean => schemeOf(url) === 'file' || (schemeOf(url) === 'view-source' && isFile(cleanUrl(url).slice(12)))

/**
 * why a URL typed in a renderer (Command Bar, URL field, internal pages) or passed by a page is refused, or null
 * when it may load. fromRenderer: the request came over IPC rather than from swyr's own main process (menus,
 * Link Rules on open-url, the test hook), so local files are refused too.
 */
export function refusedInput(url: string, fromRenderer: boolean): string | null {
  if (isScriptUrl(url)) return 'script URLs never load from input'
  if (fromRenderer && isFile(url)) return 'local files cannot be opened from here'
  return null
}

/** a page at `opener` asks to open `target` in a new tab or window (window.open, target=_blank) */
export function webContentMayOpen(target: string, opener: string): boolean {
  const scheme = schemeOf(target)
  if (isScriptUrl(target)) return false
  if (scheme === 'http' || scheme === 'https') return true
  if (cleanUrl(target) === 'about:blank') return true
  // swyr's own pages may open one another; web pages and extensions never reach them
  if (scheme === 'swyr') return isInternal(opener)
  // an extension page may open its own pages
  if (scheme === 'chrome-extension') return schemeOf(opener) === 'chrome-extension' && sameOrigin(target, opener)
  return false
}

/** a page at `current` starts a navigation (link click, location change, redirect, form) to `target` */
export function webContentMayNavigate(target: string, current: string): boolean {
  const scheme = schemeOf(target)
  if (scheme === 'javascript' || scheme === 'vbscript') return false
  if (scheme === 'data') return !isScriptUrl(target) || schemeOf(current) === 'data'
  if (scheme === 'swyr') return isInternal(current)
  if (scheme === 'file') return isFile(current)
  return true
}

/** what link.openExternal does with a URL: open it as a web page, hand it to another app, or refuse it */
export function externalOpenKind(url: unknown): 'web' | 'app' | null {
  if (typeof url !== 'string' || url.length > 8192) return null
  const scheme = schemeOf(url)
  if (scheme === 'http' || scheme === 'https') {
    try {
      return new URL(cleanUrl(url)).host ? 'web' : null
    } catch {
      return null
    }
  }
  return EXTERNAL_APP_SCHEMES.includes(scheme) ? 'app' : null
}

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin
  } catch {
    return false
  }
}

/** downloads that run code when opened: the Downloads list warns about them and swyr never opens them by itself */
export const DANGEROUS_DOWNLOAD = /\.(dmg|pkg|mpkg|app|sh|command|tool|js|jar|scpt|workflow|terminal|zsh|bash|py|rb|pl)$/i
export const isDangerousDownload = (filename: string): boolean => DANGEROUS_DOWNLOAD.test(filename.trim())

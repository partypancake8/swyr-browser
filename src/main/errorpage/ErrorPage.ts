// Friendly error page: a tab whose main-frame load fails shows swyr://error?code=&name=&url= in place.
import type { WebContents } from 'electron'

export const ERROR_PAGE = 'swyr://error'

/** net error codes that are not failures worth a page (aborted by a new navigation, or by the user) */
const IGNORED = new Set([-3])

export function errorPageUrl(code: number, name: string, url: string): string {
  const q = new URLSearchParams({ code: String(code), name, url })
  return `${ERROR_PAGE}?${q.toString()}`
}

export function isErrorPageUrl(url: string | undefined): boolean {
  return Boolean(url && url.startsWith(ERROR_PAGE))
}

/** the URL that failed, when `url` is an error page */
export function failedUrlOf(url: string): string | null {
  if (!isErrorPageUrl(url)) return null
  try {
    return new URL(url).searchParams.get('url')
  } catch {
    return null
  }
}

/**
 * called from a tab's did-fail-load: replaces the failed page with the error page.
 * The failed entry is dropped from history so Back from the error page leaves the site instead of failing again.
 */
export function showErrorPage(wc: WebContents, code: number, name: string, url: string, isMainFrame: boolean): boolean {
  if (!isMainFrame || IGNORED.has(code) || wc.isDestroyed()) return false
  if (!/^(https?|ftp|file):/i.test(url)) return false
  const target = errorPageUrl(code, name || `ERR_${Math.abs(code)}`, url)
  wc.once('did-navigate', () => {
    try {
      const h = wc.navigationHistory
      const idx = h.getActiveIndex()
      const prev = idx > 0 ? h.getEntryAtIndex(idx - 1) : null
      if (prev && prev.url === url) h.removeEntryAtIndex(idx - 1)
    } catch {
      /* history cleanup is best effort */
    }
  })
  void wc.loadURL(target).catch(() => undefined)
  return true
}

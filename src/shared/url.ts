// Turn command bar input into a URL: a real URL, a bare domain, or a search.

// javascript: and vbscript: are not here (typed, they are searched for); data: and file: typed in a renderer are
// refused by the IPC guard (src/main/security/IpcGuard.ts)
const SCHEME_RE = /^(https?|swyr|file|about|data|chrome|view-source|mailto):/i
const DOMAIN_RE = /^([a-z0-9-]+\.)+[a-z]{2,}(:\d+)?(\/.*)?$/i
const HOST_PORT_RE = /^(localhost|\d{1,3}(\.\d{1,3}){3})(:\d+)?(\/.*)?$/i

export const DEFAULT_SEARCH = 'https://www.google.com/search?q=%s'

export function looksLikeUrl(input: string): boolean {
  const t = input.trim()
  if (!t || /\s/.test(t)) return false
  return SCHEME_RE.test(t) || DOMAIN_RE.test(t) || HOST_PORT_RE.test(t)
}

export function searchUrl(query: string, template = DEFAULT_SEARCH): string {
  return template.replace('%s', encodeURIComponent(query.trim()))
}

export function resolveInput(input: string, template = DEFAULT_SEARCH): string {
  const t = input.trim()
  if (!t) return 'swyr://newtab'
  if (SCHEME_RE.test(t)) return t
  if (looksLikeUrl(t)) return (HOST_PORT_RE.test(t) ? 'http://' : 'https://') + t
  return searchUrl(t, template)
}

export function displayUrl(url: string): string {
  try {
    const u = new URL(url)
    if (u.protocol === 'swyr:') return url.replace(/\/$/, '')
    return u.host + (u.pathname === '/' ? '' : u.pathname)
  } catch {
    return url
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

export interface ResolvedInput {
  url: string
  kind: 'url' | 'search' | 'siteSearch'
  label: string
}

/** resolve with site search keywords ("yt cats") and the default engine */
export function resolveWithSettings(
  input: string,
  settings: { searchEngine: string; siteSearch: { keyword: string; name: string; urlTemplate: string }[] }
): ResolvedInput {
  const t = input.trim()
  const m = /^(\S+)\s+(.+)$/.exec(t)
  if (m) {
    const site = settings.siteSearch.find((s) => s.keyword.toLowerCase() === m[1].toLowerCase())
    if (site) return { url: searchUrl(m[2], site.urlTemplate), kind: 'siteSearch', label: `Search ${site.name} for "${m[2]}"` }
  }
  if (looksLikeUrl(t) || /^(https?|swyr|file|about):/i.test(t)) return { url: resolveInput(t), kind: 'url', label: t }
  return { url: searchUrl(t, settings.searchEngine || DEFAULT_SEARCH), kind: 'search', label: `Search for "${t}"` }
}

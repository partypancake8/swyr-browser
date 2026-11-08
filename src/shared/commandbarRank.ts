// Command Bar ranking: which sections show, in which order, and when an open tab is a strong enough match to list.
// Pure functions, no Electron or DOM, so tests/unit.mjs checks them directly.

/** the row kinds the Command Bar renders, each row carries one as data-kind */
export type RowKind = 'url' | 'search' | 'suggestion' | 'tab' | 'history' | 'archive' | 'command' | 'sitesearch'

/** the lowercase words of a query that count for tab matching: 3 or more characters */
export function queryTokens(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 3)
}

const hostOf = (url: string): string => {
  try {
    return new URL(url).host.toLowerCase()
  } catch {
    return ''
  }
}

/**
 * an open tab matches strongly when every query token appears in its title or host; one shared common word is not
 * enough. A URL-looking query matches a tab whose URL contains it.
 */
export function strongTabMatch(query: string, title: string, url: string, queryIsUrl = false): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return false
  if (queryIsUrl) return url.toLowerCase().includes(q.replace(/^https?:\/\//, ''))
  const tokens = queryTokens(q)
  if (!tokens.length) return false
  const hay = `${title.toLowerCase()} ${hostOf(url)}`
  return tokens.every((t) => hay.includes(t))
}

/**
 * the section order for a query. kind is what the typed text resolves to (resolveWithSettings), strongTab says
 * whether any open tab matched strongly. A URL or a site search keyword comes first; otherwise the web search and
 * its live suggestions come first, except that a one- or two-word query naming an open tab puts that tab first.
 */
export function sectionOrder(query: string, kind: 'url' | 'search' | 'siteSearch', strongTab: boolean): RowKind[] {
  const q = query.trim()
  if (!q) return ['tab', 'command']
  if (kind === 'url') return ['url', 'search', 'tab', 'history', 'archive', 'command']
  if (kind === 'siteSearch') return ['sitesearch', 'search', 'tab', 'history', 'archive', 'command']
  const words = q.split(/\s+/).length
  if (strongTab && words <= 2) return ['tab', 'search', 'suggestion', 'history', 'archive', 'command']
  return ['search', 'suggestion', 'tab', 'history', 'archive', 'command']
}

/** the suggestion rows to show: the engine's list without the typed text itself or repeats, at most `max` */
export function suggestionRows(query: string, list: readonly string[], max = 6): string[] {
  const q = query.trim().toLowerCase()
  const seen = new Set([q])
  const out: string[] = []
  for (const s of list) {
    const t = s.trim()
    if (!t || seen.has(t.toLowerCase())) continue
    seen.add(t.toLowerCase())
    out.push(t)
    if (out.length >= max) break
  }
  return out
}

/** the suggest endpoint (with a {query} placeholder) for a search URL template, or null when the engine has none */
export function suggestEndpoint(searchTemplate: string): string | null {
  const host = hostOf(searchTemplate.replace('%s', 'x'))
  if (/(^|\.)google\.[a-z.]+$/.test(host)) return 'https://suggestqueries.google.com/complete/search?client=chrome&q={query}'
  if (/(^|\.)duckduckgo\.com$/.test(host)) return 'https://ac.duckduckgo.com/ac/?type=list&q={query}'
  if (/(^|\.)bing\.com$/.test(host)) return 'https://api.bing.com/osjson.aspx?query={query}'
  return null
}

/** the suggestions in an OpenSearch JSON answer: [query, [suggestions], ...]; anything else gives none */
export function parseSuggestions(body: unknown): string[] {
  if (!Array.isArray(body) || !Array.isArray(body[1])) return []
  return body[1].filter((s): s is string => typeof s === 'string').slice(0, 10)
}

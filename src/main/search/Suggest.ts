// Live search suggestions for the Command Bar. The overlay never talks to the network: it runs 'search.suggest'
// through the IPC guard and main fetches the engine's suggest endpoint without cookies, aborting the window's
// previous request and caching answers per query for the session. Private windows get none; failures give none.
import type { Commands } from '../commands/Commands'
import { parseSuggestions, suggestEndpoint } from '@shared/commandbarRank'
import { DEFAULT_SEARCH } from '@shared/url'

const cache = new Map<string, string[]>()
const CACHE_MAX = 500
const inflight = new Map<number, AbortController>()

/** the endpoint to ask: SWYR_SUGGEST_URL under SWYR_TEST (none at all in tests without it), else the engine's */
function endpointFor(searchTemplate: string): string | null {
  if (process.env.SWYR_TEST === '1') return process.env.SWYR_SUGGEST_URL || null
  return suggestEndpoint(searchTemplate)
}

export async function fetchSuggestions(endpoint: string, query: string, signal?: AbortSignal): Promise<string[]> {
  const url = endpoint.replace('{query}', encodeURIComponent(query))
  const key = url
  const hit = cache.get(key)
  if (hit) return hit
  const timeout = AbortSignal.timeout(3000)
  const res = await fetch(url, {
    credentials: 'omit',
    redirect: 'error',
    headers: { accept: 'application/json' },
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout
  })
  if (!res.ok) return []
  const text = await res.text()
  if (text.length > 100_000) return []
  const list = parseSuggestions(JSON.parse(text))
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string)
  cache.set(key, list)
  return list
}

export function registerSuggest(c: Commands): void {
  c.register('search.suggest', async ({ core, w }, p) => {
    const query = typeof p.query === 'string' ? p.query.trim().slice(0, 200) : ''
    if (!query || !w || w.incognito) return []
    const endpoint = endpointFor(core.store.state.settings.searchEngine || DEFAULT_SEARCH)
    if (!endpoint) return []
    const winId = w.id
    inflight.get(winId)?.abort()
    const ctrl = new AbortController()
    inflight.set(winId, ctrl)
    try {
      return await fetchSuggestions(endpoint, query, ctrl.signal)
    } catch {
      return []
    } finally {
      if (inflight.get(winId) === ctrl) inflight.delete(winId)
    }
  })
}

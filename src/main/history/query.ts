// Pure history queries (no Electron imports, so tests/unit-3a.mjs can load this file).
import type { HistoryEntry } from '@shared/types'

export interface Visit {
  url: string
  title: string
  visitedAt: number
}

/** pure: newest first, one row per URL with its visit count, substring match on url and title */
export function queryVisits(lists: Array<{ profileId: string; visits: Visit[] }>, query = '', limit = 100, dedupe = true): HistoryEntry[] {
  const q = query.trim().toLowerCase()
  const rows: HistoryEntry[] = []
  for (const { profileId, visits } of lists) {
    const counts = new Map<string, number>()
    if (dedupe) for (const v of visits) counts.set(v.url, (counts.get(v.url) ?? 0) + 1)
    const seen = new Set<string>()
    for (let i = visits.length - 1; i >= 0; i--) {
      const v = visits[i]
      if (dedupe && seen.has(v.url)) continue
      if (q && !v.url.toLowerCase().includes(q) && !v.title.toLowerCase().includes(q)) continue
      seen.add(v.url)
      rows.push({ url: v.url, title: v.title, visitedAt: v.visitedAt, visitCount: dedupe ? (counts.get(v.url) ?? 1) : 1, profileId })
    }
  }
  rows.sort((a, b) => b.visitedAt - a.visitedAt)
  return rows.slice(0, Math.max(1, limit))
}

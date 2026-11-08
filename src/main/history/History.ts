// Browsing history: every committed main-frame navigation per profile, in userData/history/<profileId>.json
// (a JSON array of visits, newest last, capped at 50k, written with debounced atomic writes).
// Private windows and swyr:// pages are never recorded.
import { app, type WebContents } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { HistoryEntry } from '@shared/types'
import { queryVisits, type Visit } from './query'
import { profileOf } from '../profiles/Profiles'

export const HISTORY_LIMIT = 50000
const WRITE_DELAY_MS = 800


const RECORDABLE = /^(https?|file):/i

export class History {
  private readonly lists = new Map<string, Visit[]>()
  private readonly dirty = new Set<string>()
  private timer: NodeJS.Timeout | null = null
  readonly dir: string

  constructor(dir = path.join(app.getPath('userData'), 'history')) {
    this.dir = dir
    app.on('before-quit', () => this.flush())
  }

  private file(profileId: string): string {
    return path.join(this.dir, `${profileId.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`)
  }

  private list(profileId: string): Visit[] {
    let l = this.lists.get(profileId)
    if (l) return l
    try {
      const raw = JSON.parse(fs.readFileSync(this.file(profileId), 'utf8'))
      l = Array.isArray(raw) ? raw.filter((v) => v && typeof v.url === 'string' && typeof v.visitedAt === 'number') : []
    } catch {
      l = []
    }
    this.lists.set(profileId, l!)
    return l!
  }

  private knownProfiles(): string[] {
    const ids = new Set(this.lists.keys())
    try {
      for (const f of fs.readdirSync(this.dir)) if (f.endsWith('.json')) ids.add(f.slice(0, -5))
    } catch {
      /* no history yet */
    }
    return [...ids]
  }

  /** record a committed main-frame navigation; returns false when it is not recordable */
  record(profileId: string, url: string, title: string, inPage = false): boolean {
    if (!RECORDABLE.test(url)) return false
    const l = this.list(profileId)
    const last = l[l.length - 1]
    const now = Date.now()
    // a reload or an in-page hop to the same URL a moment later is the same visit
    if (last && last.url === url && (inPage || now - last.visitedAt < 1500)) {
      if (title) last.title = title
      last.visitedAt = now
    } else {
      l.push({ url, title, visitedAt: now })
      if (l.length > HISTORY_LIMIT) l.splice(0, l.length - HISTORY_LIMIT)
    }
    this.touch(profileId)
    return true
  }

  /** the title arrived after the navigation: put it on the newest visit of that URL */
  title(profileId: string, url: string, title: string): void {
    if (!title) return
    const l = this.list(profileId)
    for (let i = l.length - 1; i >= Math.max(0, l.length - 20); i--) {
      if (l[i].url === url) {
        if (l[i].title !== title) {
          l[i].title = title
          this.touch(profileId)
        }
        return
      }
    }
  }

  query(opts: { query?: string; limit?: number; profileId?: string; dedupe?: boolean } = {}): HistoryEntry[] {
    const ids = opts.profileId ? [opts.profileId] : this.knownProfiles()
    return queryVisits(
      ids.map((id) => ({ profileId: id, visits: this.list(id) })),
      opts.query ?? '',
      opts.limit ?? 100,
      opts.dedupe !== false
    )
  }

  /** whether a URL was visited (in any profile, or the one named) */
  has(url: string, profileId?: string): boolean {
    for (const id of profileId ? [profileId] : this.knownProfiles()) if (this.list(id).some((v) => v.url === url)) return true
    return false
  }

  /** merge visits imported from another browser; returns how many were new */
  importVisits(profileId: string, visits: Visit[]): number {
    const l = this.list(profileId)
    const seen = new Set(l.map((v) => v.url + '\u0000' + v.visitedAt))
    const fresh = visits.filter((v) => !seen.has(v.url + '\u0000' + v.visitedAt))
    if (!fresh.length) return 0
    const merged = [...l, ...fresh].sort((a, b) => a.visitedAt - b.visitedAt)
    if (merged.length > HISTORY_LIMIT) merged.splice(0, merged.length - HISTORY_LIMIT)
    this.lists.set(profileId, merged)
    this.touch(profileId)
    this.flush()
    return fresh.length
  }

  clear(profileId?: string): number {
    let n = 0
    for (const id of profileId ? [profileId] : this.knownProfiles()) {
      n += this.list(id).length
      this.lists.set(id, [])
      this.touch(id)
    }
    this.flush()
    return n
  }

  /** remove every visit of one URL */
  remove(url: string, profileId?: string): number {
    let n = 0
    for (const id of profileId ? [profileId] : this.knownProfiles()) {
      const l = this.list(id)
      const kept = l.filter((v) => v.url !== url)
      n += l.length - kept.length
      if (kept.length !== l.length) {
        this.lists.set(id, kept)
        this.touch(id)
      }
    }
    return n
  }

  private touch(profileId: string): void {
    this.dirty.add(profileId)
    if (this.timer) return
    this.timer = setTimeout(() => this.flush(), WRITE_DELAY_MS)
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (!this.dirty.size) return
    try {
      fs.mkdirSync(this.dir, { recursive: true })
    } catch {
      return
    }
    for (const id of [...this.dirty]) {
      const file = this.file(id)
      const tmp = file + '.tmp'
      try {
        fs.writeFileSync(tmp, JSON.stringify(this.lists.get(id) ?? []))
        fs.renameSync(tmp, file)
        this.dirty.delete(id)
      } catch (err) {
        console.error('[swyr] history write failed', err)
      }
    }
  }

  /** record the navigations of a web contents, for the profile that owns its session */
  watch(wc: WebContents): void {
    const profileId = (): string | null => {
      const p = profileOf(wc.session)
      return p && !p.incognito ? p.id : null
    }
    wc.on('did-navigate', (_e, url, code) => {
      const id = profileId()
      // the title arrives with page-title-updated; getTitle() still names the previous document here
      if (id && code !== 204) this.record(id, url, '')
    })
    wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
      const id = profileId()
      if (id && isMainFrame) this.record(id, url, wc.getTitle(), true)
    })
    wc.on('page-title-updated', (_e, title) => {
      const id = profileId()
      if (id) this.title(id, wc.getURL(), title)
    })
  }
}

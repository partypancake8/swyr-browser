// History import from other browsers: Chrome, Edge, Brave (Chromium "History"), Firefox (places.sqlite) and Safari
// (History.db). The database is copied to a temporary file first (browsers keep it locked) and read with node:sqlite,
// read-only. Nothing leaves this Mac.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Visit } from '../history/query'

export type HistoryBrowser = 'chrome' | 'edge' | 'brave' | 'firefox' | 'safari'

const HOME = os.homedir()
const SUPPORT = path.join(HOME, 'Library/Application Support')

/** the usual history database of each browser's default profile */
export function defaultHistoryPath(browser: HistoryBrowser): string | null {
  switch (browser) {
    case 'chrome':
      return path.join(SUPPORT, 'Google/Chrome/Default/History')
    case 'edge':
      return path.join(SUPPORT, 'Microsoft Edge/Default/History')
    case 'brave':
      return path.join(SUPPORT, 'BraveSoftware/Brave-Browser/Default/History')
    case 'safari':
      return path.join(HOME, 'Library/Safari/History.db')
    case 'firefox': {
      const dir = path.join(SUPPORT, 'Firefox/Profiles')
      try {
        const profiles = fs.readdirSync(dir).filter((d) => fs.existsSync(path.join(dir, d, 'places.sqlite')))
        const pick = profiles.find((d) => d.endsWith('.default-release')) ?? profiles[0]
        return pick ? path.join(dir, pick, 'places.sqlite') : null
      } catch {
        return null
      }
    }
  }
}

const CHROME_EPOCH_OFFSET_MS = 11644473600000 // 1601-01-01 to 1970-01-01
const SAFARI_EPOCH_OFFSET_S = 978307200 // 1970-01-01 to 2001-01-01

type Row = Record<string, unknown>

/** read visits from a browser history database; the format is detected from its tables */
export function readBrowserHistory(file: string, limit = 50000): { format: 'chromium' | 'firefox' | 'safari'; visits: Visit[] } {
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'swyr-history-'))
  const copy = path.join(tmp, 'history.sqlite')
  fs.copyFileSync(file, copy)
  for (const ext of ['-wal', '-shm']) if (fs.existsSync(file + ext)) fs.copyFileSync(file + ext, copy + ext)
  const db = new DatabaseSync(copy, { readOnly: true })
  try {
    const tables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Row[]).map((r) => String(r.name)))
    let format: 'chromium' | 'firefox' | 'safari'
    let rows: Row[]
    if (tables.has('urls')) {
      format = 'chromium'
      // microseconds since 1601 overflow a JavaScript number, so SQLite divides first
      rows = db.prepare('SELECT url, title, last_visit_time / 1000 AS t FROM urls WHERE last_visit_time > 0 ORDER BY last_visit_time DESC LIMIT ?').all(limit) as Row[]
      rows = rows.map((r) => ({ ...r, t: Math.round(Number(r.t) - CHROME_EPOCH_OFFSET_MS) }))
    } else if (tables.has('moz_places')) {
      format = 'firefox'
      rows = db.prepare('SELECT url, title, last_visit_date / 1000 AS t FROM moz_places WHERE last_visit_date IS NOT NULL ORDER BY last_visit_date DESC LIMIT ?').all(limit) as Row[]
      rows = rows.map((r) => ({ ...r, t: Math.round(Number(r.t)) }))
    } else if (tables.has('history_items') && tables.has('history_visits')) {
      format = 'safari'
      rows = db
        .prepare(
          'SELECT i.url AS url, v.title AS title, MAX(v.visit_time) AS t FROM history_items i JOIN history_visits v ON v.history_item = i.id GROUP BY i.id ORDER BY t DESC LIMIT ?'
        )
        .all(limit) as Row[]
      rows = rows.map((r) => ({ ...r, t: Math.round((Number(r.t) + SAFARI_EPOCH_OFFSET_S) * 1000) }))
    } else {
      throw new Error('That file is not a browser history database.')
    }
    const visits = rows
      .filter((r) => typeof r.url === 'string' && /^(https?|file):/i.test(r.url as string) && Number.isFinite(r.t as number))
      .map((r) => ({ url: r.url as string, title: typeof r.title === 'string' ? r.title : '', visitedAt: r.t as number }))
      .sort((a, b) => a.visitedAt - b.visitedAt)
    return { format, visits }
  } finally {
    db.close()
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

// Safari and Firefox bookmarks into the same shape as Chrome bookmarks (one folder in Pinned, folders preserved).
// Read locally and only on a user action, from a temporary copy (the browsers keep their files open); nothing is
// uploaded. Safari: ~/Library/Safari/Bookmarks.plist (binary plist, converted with plutil). Firefox: places.sqlite
// (moz_bookmarks joined to moz_places), read-only with node:sqlite. Passwords are never read: Electron has no
// password store to put them in.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { BOOKMARK_LIMIT, type BookmarkNode } from '../onboarding/ChromeBookmarks'
import { defaultHistoryPath } from './BrowserHistory'

export const SAFARI_BOOKMARKS_PATH = path.join(os.homedir(), 'Library', 'Safari', 'Bookmarks.plist')

/** Firefox keeps bookmarks and history in the same places.sqlite of the default profile */
export function firefoxPlacesPath(): string | null {
  return defaultHistoryPath('firefox')
}

export interface ParsedBookmarks {
  nodes: BookmarkNode[]
  links: number
  folders: number
  truncated: boolean
}

type Dict = Record<string, unknown>
const isDict = (v: unknown): v is Dict => typeof v === 'object' && v !== null && !Array.isArray(v)
const WEB_URL = /^(https?|ftp):\/\//i

const countFolders = (list: BookmarkNode[]): number => list.reduce((n, x) => n + (x.kind === 'folder' ? 1 + countFolders(x.children) : 0), 0)
const countLinks = (list: BookmarkNode[]): number => list.reduce((n, x) => n + (x.kind === 'folder' ? countLinks(x.children) : 1), 0)

/** a temporary copy of a file (and its SQLite sidecars), removed by the returned cleanup */
function tempCopy(file: string, name: string): { copy: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swyr-bookmarks-'))
  const copy = path.join(dir, name)
  fs.copyFileSync(file, copy)
  for (const ext of ['-wal', '-shm']) if (fs.existsSync(file + ext)) fs.copyFileSync(file + ext, copy + ext)
  return { copy, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) }
}

// ----- Safari

const SAFARI_ROOTS: Record<string, string | null> = {
  BookmarksBar: null, // the Favorites bar: its contents sit directly in the import folder
  BookmarksMenu: 'Bookmarks Menu',
  'com.apple.ReadingList': 'Reading List'
}

/** the WebBookmarkTypeList tree of Safari's Bookmarks.plist (already parsed to plain objects) */
export function parseSafariBookmarks(root: unknown): ParsedBookmarks {
  let links = 0
  let truncated = false
  const walk = (node: unknown, depth: number): BookmarkNode | null => {
    if (!isDict(node) || depth > 24) return null
    const type = node.WebBookmarkType
    if (type === 'WebBookmarkTypeLeaf') {
      const url = typeof node.URLString === 'string' ? node.URLString : ''
      if (!WEB_URL.test(url)) return null
      if (links >= BOOKMARK_LIMIT) {
        truncated = true
        return null
      }
      links++
      const uri = isDict(node.URIDictionary) ? node.URIDictionary : {}
      const title = typeof uri.title === 'string' && uri.title ? uri.title : typeof node.Title === 'string' && node.Title ? node.Title : url
      return { kind: 'tab', url, title }
    }
    if (type === 'WebBookmarkTypeList') {
      const children = (Array.isArray(node.Children) ? node.Children : []).map((c) => walk(c, depth + 1)).filter((c): c is BookmarkNode => c !== null)
      if (!children.length) return null
      return { kind: 'folder', title: typeof node.Title === 'string' && node.Title ? node.Title : 'Folder', children }
    }
    return null // proxies (History) and anything unknown
  }
  const nodes: BookmarkNode[] = []
  const top = isDict(root) && Array.isArray(root.Children) ? root.Children : []
  for (const child of top) {
    const parsed = walk(child, 1)
    if (!parsed) continue
    const title = isDict(child) && typeof child.Title === 'string' ? child.Title : ''
    if (parsed.kind === 'folder' && title in SAFARI_ROOTS) {
      const as = SAFARI_ROOTS[title]
      if (as === null) nodes.push(...parsed.children)
      else nodes.push({ ...parsed, title: as })
    } else nodes.push(parsed)
  }
  return { nodes, links, folders: countFolders(nodes), truncated }
}

/** a minimal XML property list reader (plutil -convert json refuses plists that hold data or date values) */
export function parseXmlPlist(xml: string): unknown {
  const tokens = xml.replace(/<\?[\s\S]*?\?>|<!DOCTYPE[\s\S]*?>|<!--[\s\S]*?-->/g, '').match(/<[^>]+>|[^<]+/g) ?? []
  let i = 0
  const decode = (t: string): string =>
    t.replace(/&(lt|gt|amp|quot|apos|#x[0-9a-f]+|#\d+);/gi, (_m, e: string) => {
      const map: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }
      if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
      return map[e.toLowerCase()] ?? _m
    })
  const nextTag = (): string => {
    while (i < tokens.length && !tokens[i].startsWith('<')) i++
    return tokens[i++] ?? ''
  }
  const text = (close: string): string => {
    let out = ''
    while (i < tokens.length && tokens[i] !== close) out += tokens[i++]
    i++
    return decode(out)
  }
  const value = (tag: string): unknown => {
    const name = /^<\s*([a-zA-Z]+)/.exec(tag)?.[1] ?? ''
    const selfClosing = tag.endsWith('/>')
    switch (name) {
      case 'dict': {
        const out: Dict = {}
        if (selfClosing) return out
        for (;;) {
          const t = nextTag()
          if (!t || t === '</dict>') return out
          if (t === '<key>') {
            const k = text('</key>')
            out[k] = value(nextTag())
          }
        }
      }
      case 'array': {
        const out: unknown[] = []
        if (selfClosing) return out
        for (;;) {
          const t = nextTag()
          if (!t || t === '</array>') return out
          out.push(value(t))
        }
      }
      case 'string':
        return selfClosing ? '' : text('</string>')
      case 'integer':
      case 'real':
        return Number(text(`</${name}>`))
      case 'true':
        return true
      case 'false':
        return false
      case 'date':
      case 'data':
        return selfClosing ? '' : text(`</${name}>`).trim()
      case 'plist':
        return value(nextTag())
      default:
        return null
    }
  }
  return value(nextTag())
}

export function readSafariBookmarks(file: string): ParsedBookmarks {
  const { copy, cleanup } = tempCopy(file, 'Bookmarks.plist')
  try {
    let root: unknown
    try {
      root = JSON.parse(execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', copy], { encoding: 'utf8', timeout: 15000, maxBuffer: 256 * 1024 * 1024 }))
    } catch {
      root = parseXmlPlist(execFileSync('/usr/bin/plutil', ['-convert', 'xml1', '-o', '-', copy], { encoding: 'utf8', timeout: 15000, maxBuffer: 256 * 1024 * 1024 }))
    }
    if (!isDict(root) || root.WebBookmarkType !== 'WebBookmarkTypeList') throw new Error('not a Safari bookmarks file')
    return parseSafariBookmarks(root)
  } finally {
    cleanup()
  }
}

// ----- Firefox

const FIREFOX_ROOTS: Array<[guid: string, title: string | null]> = [
  ['toolbar_____', null], // the Bookmarks Toolbar: its contents sit directly in the import folder
  ['menu________', 'Bookmarks Menu'],
  ['unfiled_____', 'Other Bookmarks'],
  ['mobile______', 'Mobile Bookmarks']
]

type Row = Record<string, unknown>

/** bookmarks (type 1) and folders (type 2) under Firefox's toolbar, menu, unfiled and mobile roots; tags are skipped */
export function readFirefoxBookmarks(file: string): ParsedBookmarks {
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite')
  const { copy, cleanup } = tempCopy(file, 'places.sqlite')
  const db = new DatabaseSync(copy, { readOnly: true })
  try {
    const tables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Row[]).map((r) => String(r.name)))
    if (!tables.has('moz_bookmarks') || !tables.has('moz_places')) throw new Error('not a Firefox places database')
    const rows = db
      .prepare('SELECT b.id AS id, b.type AS type, b.parent AS parent, b.position AS position, b.title AS title, b.guid AS guid, p.url AS url FROM moz_bookmarks b LEFT JOIN moz_places p ON p.id = b.fk ORDER BY b.parent, b.position')
      .all() as Row[]
    const kids = new Map<number, Row[]>()
    for (const r of rows) {
      const parent = Number(r.parent)
      if (!kids.has(parent)) kids.set(parent, [])
      kids.get(parent)?.push(r)
    }
    let links = 0
    let truncated = false
    const walk = (r: Row, depth: number): BookmarkNode | null => {
      if (depth > 24) return null
      const type = Number(r.type)
      if (type === 1) {
        const url = typeof r.url === 'string' ? r.url : ''
        if (!WEB_URL.test(url)) return null // place: queries, javascript: bookmarklets and the like
        if (links >= BOOKMARK_LIMIT) {
          truncated = true
          return null
        }
        links++
        return { kind: 'tab', url, title: typeof r.title === 'string' && r.title ? r.title : url }
      }
      if (type === 2) {
        const children = (kids.get(Number(r.id)) ?? []).map((c) => walk(c, depth + 1)).filter((c): c is BookmarkNode => c !== null)
        if (!children.length) return null
        return { kind: 'folder', title: typeof r.title === 'string' && r.title ? r.title : 'Folder', children }
      }
      return null // separators
    }
    const nodes: BookmarkNode[] = []
    for (const [guid, as] of FIREFOX_ROOTS) {
      const root = rows.find((r) => r.guid === guid)
      if (!root) continue
      const parsed = walk(root, 0)
      if (!parsed || parsed.kind !== 'folder') continue
      if (as === null) nodes.push(...parsed.children)
      else nodes.push({ ...parsed, title: as })
    }
    return { nodes, links: countLinks(nodes), folders: countFolders(nodes), truncated }
  } finally {
    db.close()
    cleanup()
  }
}

// Chrome bookmarks (the profile's "Bookmarks" JSON file) into one folder in the Pinned section.
// Read locally and only on a user action; nothing is uploaded. Every access is defensive.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const CHROME_BOOKMARKS_PATH = path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome', 'Default', 'Bookmarks')

/** at most this many bookmarks come in, so a huge file cannot flood the sidebar */
export const BOOKMARK_LIMIT = 2000

export interface BookmarkLink {
  kind: 'tab'
  title: string
  url: string
}
export interface BookmarkFolder {
  kind: 'folder'
  title: string
  children: BookmarkNode[]
}
export type BookmarkNode = BookmarkLink | BookmarkFolder

type Dict = Record<string, unknown>
const isDict = (v: unknown): v is Dict => typeof v === 'object' && v !== null && !Array.isArray(v)

const ROOT_TITLES: Record<string, string> = { bookmark_bar: 'Bookmarks Bar', other: 'Other Bookmarks', synced: 'Mobile Bookmarks' }

export function parseChromeBookmarks(raw: unknown): { nodes: BookmarkNode[]; links: number; folders: number; truncated: boolean } {
  let links = 0
  let truncated = false
  const walk = (node: unknown, depth: number): BookmarkNode | null => {
    if (!isDict(node) || depth > 24) return null
    if (node.type === 'url') {
      const url = typeof node.url === 'string' ? node.url : ''
      if (!/^(https?|ftp):\/\//i.test(url)) return null
      if (links >= BOOKMARK_LIMIT) {
        truncated = true
        return null
      }
      links++
      return { kind: 'tab', url, title: typeof node.name === 'string' && node.name ? node.name : url }
    }
    if (node.type === 'folder' || Array.isArray(node.children)) {
      const children = (Array.isArray(node.children) ? node.children : []).map((c) => walk(c, depth + 1)).filter((c): c is BookmarkNode => c !== null)
      if (!children.length) return null
      return { kind: 'folder', title: typeof node.name === 'string' && node.name ? node.name : 'Folder', children }
    }
    return null
  }
  const roots = isDict(raw) && isDict(raw.roots) ? raw.roots : {}
  const nodes: BookmarkNode[] = []
  for (const key of ['bookmark_bar', 'other', 'synced']) {
    const root = roots[key]
    if (!isDict(root)) continue
    const parsed = walk({ ...root, type: 'folder' }, 0)
    if (parsed && parsed.kind === 'folder') {
      // the bookmarks bar's contents sit directly in the import folder; the other roots stay as sub-folders
      if (key === 'bookmark_bar') nodes.push(...parsed.children)
      else nodes.push({ ...parsed, title: ROOT_TITLES[key] })
    }
  }
  const countFolders = (list: BookmarkNode[]): number => list.reduce((n, x) => n + (x.kind === 'folder' ? 1 + countFolders(x.children) : 0), 0)
  return { nodes, links, folders: countFolders(nodes), truncated }
}

export function readChromeBookmarks(file: string): ReturnType<typeof parseChromeBookmarks> {
  return parseChromeBookmarks(JSON.parse(fs.readFileSync(file, 'utf8')))
}

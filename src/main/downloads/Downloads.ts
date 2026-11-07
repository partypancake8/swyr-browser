// Downloads: will-download on every profile session, saved straight into the downloads folder (no dialog),
// progress kept as runtime state for the sidebar panel.
import { app, type DownloadItem, type Session } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { DownloadEntry } from '@shared/types'
import { newId } from '../util/id'

export interface DownloadsHost {
  directory(): string | undefined
  changed(): void
}

/** a free file name in dir: "name.ext", then "name (1).ext", ... */
export function uniquePath(dir: string, filename: string, exists: (p: string) => boolean = fs.existsSync): string {
  const clean = filename.replace(/[/\\:]/g, '_').replace(/^\.+/, '') || 'download'
  const ext = path.extname(clean)
  const base = clean.slice(0, clean.length - ext.length)
  let candidate = path.join(dir, clean)
  for (let i = 1; exists(candidate) && i < 1000; i++) candidate = path.join(dir, `${base} (${i})${ext}`)
  return candidate
}

export class Downloads {
  readonly list: DownloadEntry[] = []
  private readonly items = new Map<string, DownloadItem>()
  private readonly sessions = new WeakSet<Session>()

  constructor(private readonly host: DownloadsHost) {}

  directory(): string {
    return this.host.directory() || app.getPath('downloads')
  }

  attach(ses: Session): void {
    if (this.sessions.has(ses)) return
    this.sessions.add(ses)
    ses.on('will-download', (_event, item) => this.track(item))
  }

  private track(item: DownloadItem): void {
    const dir = this.directory()
    try {
      fs.mkdirSync(dir, { recursive: true })
    } catch {
      /* setSavePath reports the failure through 'done' */
    }
    const savePath = uniquePath(dir, item.getFilename())
    item.setSavePath(savePath)
    const entry: DownloadEntry = {
      id: newId('dl'),
      filename: path.basename(savePath),
      url: item.getURL().startsWith('data:') ? item.getURL().slice(0, 64) : item.getURL(),
      path: savePath,
      state: 'progressing',
      receivedBytes: 0,
      totalBytes: item.getTotalBytes(),
      startedAt: Date.now()
    }
    this.list.unshift(entry)
    this.items.set(entry.id, item)
    item.on('updated', (_e, state) => {
      entry.receivedBytes = item.getReceivedBytes()
      entry.totalBytes = item.getTotalBytes()
      entry.state = state === 'interrupted' ? 'interrupted' : 'progressing'
      this.host.changed()
    })
    item.once('done', (_e, state) => {
      entry.receivedBytes = item.getReceivedBytes()
      entry.totalBytes = item.getTotalBytes() || entry.receivedBytes
      entry.path = item.getSavePath() || entry.path
      entry.filename = path.basename(entry.path)
      entry.state = state === 'completed' ? 'completed' : state === 'cancelled' ? 'cancelled' : 'interrupted'
      this.items.delete(entry.id)
      this.host.changed()
    })
    this.host.changed()
  }

  get(id: string): DownloadEntry | undefined {
    return this.list.find((d) => d.id === id)
  }

  cancel(id: string): boolean {
    const item = this.items.get(id)
    if (!item) return false
    item.cancel()
    return true
  }

  /** remove finished entries from the list (files stay on disk) */
  clear(): number {
    const keep = this.list.filter((d) => d.state === 'progressing')
    const removed = this.list.length - keep.length
    this.list.splice(0, this.list.length, ...keep)
    this.host.changed()
    return removed
  }
}

// Notes and canvases: one JSON file per document at userData/documents/<id>.json, with debounced atomic writes.
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { CanvasDocument, NoteDocument, SwyrDocument } from '@shared/types'

const WRITE_DELAY_MS = 300
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/

export const isDocId = (id: unknown): id is string => typeof id === 'string' && ID_RE.test(id)

/** the document a swyr://note/<id> or swyr://canvas/<id> URL points at */
export function docIdFromUrl(url: string | null | undefined): { kind: 'note' | 'canvas'; id: string } | null {
  const m = /^swyr:\/\/(note|canvas)\/([A-Za-z0-9_-]{1,64})\/?(?:[?#].*)?$/.exec(url ?? '')
  return m ? { kind: m[1] as 'note' | 'canvas', id: m[2] } : null
}

export function docUrl(kind: 'note' | 'canvas', id: string): string {
  return `swyr://${kind}/${id}`
}

function normalize(raw: Record<string, unknown>, id: string): SwyrDocument | null {
  const title = typeof raw.title === 'string' ? raw.title : ''
  const updatedAt = typeof raw.updatedAt === 'number' ? raw.updatedAt : 0
  if (raw.kind === 'note') {
    return { id, kind: 'note', title, markdown: typeof raw.markdown === 'string' ? raw.markdown : '', updatedAt }
  }
  if (raw.kind === 'canvas') {
    const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
    return {
      id,
      kind: 'canvas',
      title,
      elements: Array.isArray(raw.elements) ? (raw.elements.filter((e) => e && typeof e === 'object') as Record<string, unknown>[]) : [],
      appState: obj(raw.appState),
      files: obj(raw.files),
      updatedAt
    }
  }
  return null
}

export class DocumentStore {
  readonly dir: string
  private readonly cache = new Map<string, SwyrDocument>()
  private readonly dirty = new Set<string>()
  private timer: NodeJS.Timeout | null = null
  private scanned = false
  /** private window documents: kept in memory, never written */
  private readonly ephemeral = new Set<string>()

  markEphemeral(id: string): void {
    if (isDocId(id)) this.ephemeral.add(id)
  }

  isEphemeral(id: string): boolean {
    return this.ephemeral.has(id)
  }

  constructor(dir = path.join(app.getPath('userData'), 'documents')) {
    this.dir = dir
  }

  private file(id: string): string {
    return path.join(this.dir, `${id}.json`)
  }

  get(id: string): SwyrDocument | undefined {
    if (!isDocId(id)) return undefined
    const hit = this.cache.get(id)
    if (hit) return hit
    try {
      const doc = normalize(JSON.parse(fs.readFileSync(this.file(id), 'utf8')), id)
      if (doc) this.cache.set(id, doc)
      return doc ?? undefined
    } catch {
      return undefined
    }
  }

  note(id: string): NoteDocument | undefined {
    const d = this.get(id)
    return d?.kind === 'note' ? d : undefined
  }

  canvas(id: string): CanvasDocument | undefined {
    const d = this.get(id)
    return d?.kind === 'canvas' ? d : undefined
  }

  /** every document on disk (read once, then served from the cache) */
  list(): SwyrDocument[] {
    if (!this.scanned) {
      this.scanned = true
      try {
        for (const f of fs.readdirSync(this.dir)) {
          if (f.endsWith('.json')) this.get(f.slice(0, -5))
        }
      } catch {
        /* no documents yet */
      }
    }
    return [...this.cache.values()]
  }

  /** store a new or changed document and write it soon */
  put(doc: SwyrDocument, opts: { touch?: boolean } = {}): SwyrDocument {
    if (opts.touch !== false) doc.updatedAt = Date.now()
    this.cache.set(doc.id, doc)
    this.dirty.add(doc.id)
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), WRITE_DELAY_MS)
    return doc
  }

  remove(id: string): boolean {
    if (!isDocId(id)) return false
    const had = this.cache.delete(id)
    this.dirty.delete(id)
    try {
      fs.rmSync(this.file(id), { force: true })
    } catch {
      /* already gone */
    }
    return had
  }

  /** write every dirty document now (write a temp file, then rename over the old one) */
  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (!this.dirty.size) return
    try {
      fs.mkdirSync(this.dir, { recursive: true })
    } catch (err) {
      console.error('[swyr] documents folder', err)
      return
    }
    for (const id of [...this.dirty]) {
      const doc = this.cache.get(id)
      this.dirty.delete(id)
      if (!doc || this.ephemeral.has(id)) continue
      const target = this.file(id)
      const tmp = `${target}.tmp`
      try {
        fs.writeFileSync(tmp, JSON.stringify(doc))
        fs.renameSync(tmp, target)
      } catch (err) {
        console.error('[swyr] document write failed', id, err)
      }
    }
  }
}

let shared: DocumentStore | null = null

/** the app's document store, created on first use; flushed when the app quits */
export function documents(): DocumentStore {
  if (!shared) {
    shared = new DocumentStore()
    const store = shared
    app.on('before-quit', () => store.flush())
  }
  return shared
}

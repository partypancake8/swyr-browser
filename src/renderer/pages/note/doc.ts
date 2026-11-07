// Helpers shared by the note and canvas pages: the document id from the URL and change events from the main process.

/** swyr://note/<id> and swyr://canvas/<id>: the id is the first path segment */
export function docIdFromLocation(): string {
  const seg = window.location.pathname.replace(/^\/+/, '').split('/')[0] ?? ''
  return /^[A-Za-z0-9_-]{1,64}$/.test(seg) ? seg : ''
}

export interface DocUpdate {
  docId: string
  kind: 'note' | 'canvas'
  /** note: the new content, set from outside the page */
  markdown?: string
  title?: string
  rev?: number
  /** canvas: element skeletons main added */
  add?: Record<string, unknown>[]
}

/** the main process dispatches 'doc-updated' on window when a document changes outside its page */
export function onDocUpdated(docId: string, cb: (u: DocUpdate) => void): () => void {
  const fn = (e: Event): void => {
    const detail = (e as CustomEvent<DocUpdate>).detail
    if (detail && detail.docId === docId) cb(detail)
  }
  window.addEventListener('doc-updated', fn)
  return () => window.removeEventListener('doc-updated', fn)
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): { run: (...args: A) => void; cancel: () => void; flush: () => void } {
  let timer: number | null = null
  let last: A | null = null
  return {
    run(...args: A) {
      last = args
      if (timer !== null) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        timer = null
        const a = last
        last = null
        if (a) fn(...a)
      }, ms)
    },
    cancel() {
      if (timer !== null) window.clearTimeout(timer)
      timer = null
      last = null
    },
    flush() {
      if (timer !== null) window.clearTimeout(timer)
      timer = null
      const a = last
      last = null
      if (a) fn(...a)
    }
  }
}

export function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })
}

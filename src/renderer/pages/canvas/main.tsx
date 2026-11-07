// swyr://canvas/<id>: a freeform board (text, images, links, drawing) built on Excalidraw, autosaved as it changes.
import './assetPath'
import { createRoot } from 'react-dom/client'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { CaptureUpdateAction, Excalidraw, MainMenu, convertToExcalidrawElements, getSceneVersion, viewportCoordsToSceneCoords } from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI, BinaryFileData, BinaryFiles, AppState } from '@excalidraw/excalidraw/types'
import type { ExcalidrawElementSkeleton } from '@excalidraw/excalidraw/data/transform'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import '@excalidraw/excalidraw/index.css'
import { ImagePlus, Link2, Shapes } from 'lucide-react'
import '../../common/base.css'
import './canvas.css'
import type { CanvasDocument } from '@shared/types'
import { invoke, startViewSync, useView } from '../../common/store'
import { activeSpace, useSpaceTheme } from '../../common/theme'
import { debounce, docIdFromLocation, onDocUpdated, readAsDataUrl } from '../note/doc'

const DOC_ID = docIdFromLocation()
const UNTITLED = 'Untitled canvas'
const SAVE_MS = 400

type Raw = Record<string, unknown>

/** elements main stored as skeletons (swyrSkeleton) become full Excalidraw elements here */
function realize(raw: Raw[]): ExcalidrawElement[] {
  const out: ExcalidrawElement[] = []
  const skeletons: Raw[] = []
  for (const e of raw) {
    if (e.swyrSkeleton) {
      const { swyrSkeleton: _s, ...rest } = e
      skeletons.push(rest)
    } else out.push(e as unknown as ExcalidrawElement)
  }
  if (skeletons.length) out.push(...convertToExcalidrawElements(skeletons as unknown as ExcalidrawElementSkeleton[], { regenerateIds: false }))
  return out
}

/** text is measured when it is converted, so wait (briefly) for the board's handwriting font first */
function fontsReady(): Promise<unknown> {
  const wait = new Promise((r) => setTimeout(r, 1500))
  try {
    return Promise.race([Promise.all([document.fonts.load('20px Excalifont'), document.fonts.load('18px Excalifont')]), wait]).catch(() => undefined)
  } catch {
    return wait
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function linkCard(url: string, title: string, x: number, y: number): Raw {
  const host = hostOf(url)
  return {
    type: 'rectangle',
    x,
    y,
    width: Math.max(220, Math.min(420, 12 * Math.max(title.length, host.length) + 40)),
    height: 76,
    link: url,
    backgroundColor: '#dbe8ff',
    strokeColor: '#1d4ed8',
    fillStyle: 'solid',
    roundness: { type: 3 },
    label: { text: `${title}\n${host}`, fontSize: 18, strokeColor: '#0f172a' }
  }
}

function imageSize(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth || 320, height: img.naturalHeight || 240 })
    img.onerror = () => resolve({ width: 320, height: 240 })
    img.src = dataUrl
  })
}

function LinkPopover({ onAdd, onClose }: { onAdd: (url: string, title: string) => void; onClose: () => void }): ReactNode {
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => ref.current?.focus(), [])
  const add = (): void => {
    const v = url.trim()
    if (!v) return
    const full = /^https?:\/\//i.test(v) ? v : `https://${v}`
    onAdd(full, title.trim() || hostOf(full))
  }
  const key = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') add()
    if (e.key === 'Escape') onClose()
  }
  return (
    <div className="canvas-pop absolute right-3 top-[52px] z-20 w-[320px] rounded-xl border border-[var(--card-border)] bg-[var(--card)] p-3" role="dialog" aria-label="Add link">
      <div className="mb-2 text-[13px] font-semibold">Add a link card</div>
      <input ref={ref} value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={key} placeholder="https://…" aria-label="Link address" className="canvas-field mb-2" />
      <input value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={key} placeholder="Title (optional)" aria-label="Link title" className="canvas-field mb-3" />
      <div className="flex justify-end gap-2">
        <button className="h-8 rounded-lg px-3 text-[13px] font-semibold hover:bg-[var(--select)]" onClick={onClose}>
          Cancel
        </button>
        <button className="h-8 rounded-lg bg-[var(--fg)] px-3 text-[13px] font-semibold text-(color:--content) disabled:opacity-50" disabled={!url.trim()} onClick={add}>
          Add
        </button>
      </div>
    </div>
  )
}

function CanvasPage(): ReactNode {
  const vs = useView((s) => s.vs)
  const space = vs ? activeSpace(vs) : undefined
  const { dark } = useSpaceTheme(space, vs?.systemDark ?? false)
  const [doc, setDoc] = useState<CanvasDocument | null | undefined>(undefined)
  const [title, setTitle] = useState('')
  const [linking, setLinking] = useState(false)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const api = useRef<ExcalidrawImperativeAPI | null>(null)
  const lastSig = useRef('')
  const queued = useRef<Raw[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  const saver = useMemo(
    () =>
      debounce((elements: readonly ExcalidrawElement[], appState: AppState, files: BinaryFiles) => {
        setStatus('saving')
        const subset = { viewBackgroundColor: appState.viewBackgroundColor, scrollX: appState.scrollX, scrollY: appState.scrollY, zoom: appState.zoom, gridModeEnabled: appState.gridModeEnabled }
        void invoke('canvas.save', { docId: DOC_ID, elements, appState: subset, files }).then(() => setStatus('saved'))
      }, SAVE_MS),
    []
  )
  const titleSaver = useMemo(() => debounce((t: string) => void invoke('canvas.setTitle', { docId: DOC_ID, title: t, fromPage: true }), 300), [])

  /** add elements (skeletons) to the running board; before it mounts they wait in a queue */
  const addSkeletons = useCallback((skeletons: Raw[]) => {
    const a = api.current
    if (!a) {
      queued.current.push(...skeletons)
      return
    }
    void fontsReady().then(() => {
      const fresh = realize(skeletons.map((s) => ({ ...s, swyrSkeleton: true })))
      const have = new Set(a.getSceneElementsIncludingDeleted().map((e) => e.id))
      const add = fresh.filter((e) => !have.has(e.id))
      if (!add.length) return
      a.updateScene({ elements: [...a.getSceneElementsIncludingDeleted(), ...add], captureUpdate: CaptureUpdateAction.IMMEDIATELY })
    })
  }, [])

  useEffect(() => {
    const off = onDocUpdated(DOC_ID, (u) => {
      if (u.kind !== 'canvas') return
      if (Array.isArray(u.add)) addSkeletons(u.add.map((s) => Object.fromEntries(Object.entries(s).filter(([k]) => k !== 'swyrSkeleton'))))
      if (typeof u.title === 'string') setTitle(u.title)
    })
    void Promise.all([invoke('canvas.get', { docId: DOC_ID }), fontsReady()]).then(([d]) => {
      const cd = d as CanvasDocument | null
      setDoc(cd)
      if (cd) setTitle(cd.title)
    })
    const flush = (): void => saver.flush()
    window.addEventListener('beforeunload', flush)
    return () => {
      off()
      window.removeEventListener('beforeunload', flush)
      saver.flush()
    }
  }, [addSkeletons, saver])

  useEffect(() => {
    document.title = title.trim() || UNTITLED
  }, [title])

  const initialData = useMemo(() => {
    if (!doc) return null
    const elements = realize(doc.elements as Raw[])
    const appState = { ...(doc.appState as Partial<AppState>) }
    return { elements, appState, files: doc.files as unknown as BinaryFiles, scrollToContent: !('scrollX' in appState) }
  }, [doc])

  const center = (): { x: number; y: number } => {
    const a = api.current
    if (!a) return { x: 100, y: 100 }
    const st = a.getAppState()
    const p = viewportCoordsToSceneCoords({ clientX: st.offsetLeft + st.width / 2, clientY: st.offsetTop + st.height / 2 }, st)
    return { x: Math.round(p.x - 140), y: Math.round(p.y - 40) }
  }

  const addImages = async (files: File[]): Promise<void> => {
    const a = api.current
    if (!a) return
    let { x, y } = center()
    for (const f of files.filter((x) => x.type.startsWith('image/'))) {
      const dataURL = await readAsDataUrl(f)
      const fileId = crypto.randomUUID().replace(/-/g, '')
      const size = await imageSize(dataURL)
      const scale = Math.min(1, 480 / Math.max(size.width, size.height))
      a.addFiles([{ id: fileId, dataURL, mimeType: f.type, created: Date.now() } as unknown as BinaryFileData])
      addSkeletons([{ type: 'image', fileId, x, y, width: Math.round(size.width * scale), height: Math.round(size.height * scale) }])
      x += 24
      y += 24
    }
  }

  if (!DOC_ID || doc === null) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-[var(--content)] px-6 text-center" data-missing="canvas">
        <Shapes size={30} strokeWidth={1.8} />
        <h1 className="text-[20px] font-bold">This canvas no longer exists</h1>
        <p className="max-w-[380px] text-[14px] leading-6">It was deleted from the Library. Canvases you close or archive are kept; only Delete removes them.</p>
      </div>
    )
  }

  return (
    <div className="canvas-page flex h-screen flex-col">
      <header className="canvas-bar relative flex h-12 shrink-0 items-center gap-2 px-3">
        <Shapes size={16} strokeWidth={2} className="shrink-0" />
        <input
          className="min-w-0 flex-1 bg-transparent text-[16px] font-semibold outline-none"
          value={title}
          placeholder={UNTITLED}
          aria-label="Title"
          onChange={(e) => {
            setTitle(e.target.value)
            titleSaver.run(e.target.value)
          }}
        />
        <span className="w-14 text-right text-[12px] font-semibold tabular-nums" aria-live="polite">
          {status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : ''}
        </span>
        <button className="canvas-btn" onClick={() => setLinking((v) => !v)} aria-expanded={linking}>
          <Link2 size={15} strokeWidth={2} /> Add link
        </button>
        <button className="canvas-btn" onClick={() => fileRef.current?.click()}>
          <ImagePlus size={15} strokeWidth={2} /> Add image
        </button>
        {linking && (
          <LinkPopover
            onClose={() => setLinking(false)}
            onAdd={(url, t) => {
              const { x, y } = center()
              addSkeletons([linkCard(url, t, x, y)])
              setLinking(false)
            }}
          />
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            const files = [...(e.target.files ?? [])]
            e.target.value = ''
            void addImages(files)
          }}
        />
      </header>
      <div className="canvas-board relative min-h-0 flex-1">
        {initialData && (
          <Excalidraw
            initialData={initialData}
            theme={dark ? 'dark' : 'light'}
            excalidrawAPI={(a) => {
              api.current = a
              if (queued.current.length) {
                const q = queued.current.splice(0)
                setTimeout(() => addSkeletons(q), 0)
              }
            }}
            onChange={(elements, appState, files) => {
              const sig = `${getSceneVersion(elements)}|${Object.keys(files).length}|${Math.round(appState.scrollX)}|${Math.round(appState.scrollY)}|${appState.zoom.value}|${appState.viewBackgroundColor}`
              if (!lastSig.current) {
                lastSig.current = sig
                // the first change after load saves only when it converted stored skeletons
                if (!(doc?.elements ?? []).some((e) => (e as Raw).swyrSkeleton)) return
              }
              if (sig === lastSig.current) return
              lastSig.current = sig
              saver.run(elements, appState, files)
            }}
            onLinkOpen={(element, event) => {
              event.preventDefault()
              const link = element.link
              if (link && /^https?:\/\//i.test(link)) window.open(link, '_blank', 'noopener')
            }}
            UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, toggleTheme: null, export: { saveFileToDisk: true } } }}
          >
            <MainMenu>
              <MainMenu.DefaultItems.Export />
              <MainMenu.DefaultItems.SaveAsImage />
              <MainMenu.DefaultItems.SearchMenu />
              <MainMenu.DefaultItems.Help />
              <MainMenu.DefaultItems.ClearCanvas />
              <MainMenu.Separator />
              <MainMenu.DefaultItems.ChangeCanvasBackground />
            </MainMenu>
          </Excalidraw>
        )}
      </div>
    </div>
  )
}

startViewSync()
createRoot(document.getElementById('root')!).render(<CanvasPage />)

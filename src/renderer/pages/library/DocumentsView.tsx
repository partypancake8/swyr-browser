// Library: the Notes and Canvases sections (every document, its space, open and delete) and the Media section.
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { ExternalLink, Pause, PictureInPicture2, Play, Plus, Shapes, StickyNote, Trash2, X } from 'lucide-react'
import type { DocumentKind, DocumentSummary, MediaEntry, ViewState } from '@shared/types'
import { Favicon } from '../../common/Favicon'
import { invoke } from '../../common/store'

function when(t: number): string {
  if (!t) return 'never edited'
  const d = Date.now() - t
  if (d < 60_000) return 'just now'
  if (d < 3_600_000) return `${Math.round(d / 60_000)} min ago`
  if (d < 86_400_000) return `${Math.round(d / 3_600_000)} h ago`
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

const COPY: Record<DocumentKind, { title: string; intro: string; empty: string; emptyBody: string; add: string; command: string }> = {
  note: {
    title: 'Notes',
    intro: 'Every note, newest first. Closing or archiving a note keeps it here; Delete removes it for good.',
    empty: 'No notes yet',
    emptyBody: 'Notes are quick pages for text, checklists, links and images that you can pin in the sidebar like a tab.',
    add: 'New Note',
    command: 'note.new'
  },
  canvas: {
    title: 'Canvases',
    intro: 'Every canvas, newest first. Closing or archiving a canvas keeps it here; Delete removes it for good.',
    empty: 'No canvases yet',
    emptyBody: 'Canvases are freeform boards for links, images, text and drawings.',
    add: 'New Canvas',
    command: 'canvas.new'
  }
}

export function DocumentsView({ vs, kind }: { vs: ViewState | null; kind: DocumentKind }): ReactNode {
  const [docs, setDocs] = useState<DocumentSummary[] | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  const load = useCallback(() => {
    void invoke('documents.list', { kind }).then((r) => setDocs(Array.isArray(r) ? (r as DocumentSummary[]) : []))
  }, [kind])
  // reload when the sidebar changes (a note was added, renamed or deleted)
  const itemsKey = vs ? vs.state.items.filter((i) => i.kind === kind).map((i) => `${i.id}:${i.title}`).join('|') : ''
  useEffect(() => {
    load()
  }, [load, itemsKey])
  useEffect(() => {
    const on = (): void => {
      if (document.visibilityState === 'visible') load()
    }
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [load])
  const copy = COPY[kind]
  const Icon = kind === 'note' ? StickyNote : Shapes
  const spaces = new Map((vs?.state.spaces ?? []).map((s) => [s.id, s]))
  return (
    <div data-library={kind === 'note' ? 'notes' : 'canvases'}>
      <div className="mb-1 flex items-center gap-3">
        <h1 className="flex-1 text-[26px] font-bold">{copy.title}</h1>
        <button className="flex items-center gap-1.5 rounded-lg bg-[var(--select)] px-3 py-1.5 text-[13px] font-semibold hover:brightness-95" onClick={() => invoke(copy.command)}>
          <Plus size={14} strokeWidth={2.2} /> {copy.add}
        </button>
      </div>
      <p className="mb-6 text-[14px]">{copy.intro}</p>
      {docs && docs.length === 0 && (
        <div className="flex flex-col items-center rounded-xl border border-[var(--card-border)] px-6 py-16 text-center" data-empty={kind}>
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--select)]">
            <Icon size={26} strokeWidth={1.8} />
          </div>
          <h2 className="mb-2 text-[18px] font-bold">{copy.empty}</h2>
          <p className="max-w-[420px] text-[14px] leading-6">{copy.emptyBody}</p>
        </div>
      )}
      {docs && docs.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-[var(--card-border)]">
          {docs.map((d) => {
            const where = d.spaceIds.map((id) => spaces.get(id)).filter(Boolean)
            return (
              <div key={d.id} className="flex items-center gap-3 border-b border-[var(--card-border)] px-4 py-3 last:border-b-0" data-doc={d.id}>
                {kind === 'canvas' && d.thumbnail ? (
                  <img
                    src={d.thumbnail}
                    alt=""
                    data-canvas-thumb={d.id}
                    draggable={false}
                    className="h-14 w-20 shrink-0 cursor-pointer rounded-lg border border-[var(--card-border)] bg-white object-contain"
                    onClick={() => invoke('document.open', { docId: d.id })}
                  />
                ) : (
                  <div className={`flex shrink-0 items-center justify-center rounded-xl bg-[var(--select)] ${kind === 'canvas' ? 'h-14 w-20' : 'h-10 w-10'}`}>
                    <Icon size={19} strokeWidth={1.9} />
                  </div>
                )}
                <button className="min-w-0 flex-1 text-left" onClick={() => invoke('document.open', { docId: d.id })} title={`Open ${d.title}`}>
                  <div className="truncate text-[15px] font-semibold">{d.title}</div>
                  <div className="truncate text-[12px]">
                    {when(d.updatedAt)}
                    {' · '}
                    {where.length ? where.map((s) => `${s?.emoji ? s.emoji + ' ' : ''}${s?.name}`).join(', ') : 'not in the sidebar'}
                    {d.preview ? ` · ${d.preview}` : ''}
                  </div>
                </button>
                {confirm === d.id ? (
                  <>
                    <button
                      className="rounded-lg bg-[#b42318] px-2.5 py-1 text-[12px] font-semibold text-white"
                      onClick={() => {
                        setConfirm(null)
                        void invoke('documents.delete', { docId: d.id }).then(load)
                      }}
                    >
                      Delete for good
                    </button>
                    <button className="rounded-lg px-2.5 py-1 text-[12px] font-semibold hover:bg-[var(--select)]" onClick={() => setConfirm(null)}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button className="flex items-center gap-1.5 rounded-lg bg-[var(--select)] px-2.5 py-1 text-[12px] font-semibold hover:brightness-95" onClick={() => invoke('document.open', { docId: d.id })}>
                      <ExternalLink size={13} /> Open
                    </button>
                    <button className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12px] font-semibold hover:bg-[var(--select)]" onClick={() => setConfirm(d.id)}>
                      <Trash2 size={13} /> Delete
                    </button>
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}
      {confirm && <p className="mt-3 text-[13px]">Deleting removes the {kind} and every sidebar tab that opens it. It cannot be undone.</p>}
    </div>
  )
}

function ago(t: number): string {
  const d = Date.now() - t
  if (d < 60_000) return 'just now'
  if (d < 3_600_000) return `${Math.round(d / 60_000)} min ago`
  return `${Math.round(d / 3_600_000)} h ago`
}

export function MediaView({ vs }: { vs: ViewState | null }): ReactNode {
  const [list, setList] = useState<MediaEntry[] | null>(null)
  const [recent, setRecent] = useState<Array<MediaEntry & { playedAt: number }>>([])
  const media = vs?.window.media
  const key = media ? `${media.itemId}:${media.playing}` : ''
  useEffect(() => {
    let alive = true
    const load = (): void => {
      void invoke('library.media').then((r) => {
        if (alive) setList(Array.isArray(r) ? (r as MediaEntry[]) : [])
      })
      void invoke('library.mediaRecent').then((r) => {
        if (alive) setRecent(Array.isArray(r) ? (r as Array<MediaEntry & { playedAt: number }>) : [])
      })
    }
    load()
    const timer = window.setInterval(load, 2000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [key])
  return (
    <div data-library="media">
      <h1 className="mb-1 text-[26px] font-bold">Media</h1>
      <p className="mb-6 text-[14px]">Tabs that play audio or video, with controls that work from any tab or space.</p>
      {list && list.length === 0 && recent.length === 0 && (
        <div className="flex flex-col items-center rounded-xl border border-[var(--card-border)] px-6 py-16 text-center" data-empty="media">
          <h2 className="mb-2 text-[18px] font-bold">Nothing playing</h2>
          <p className="max-w-[420px] text-[14px] leading-6">Audio and video playing in your tabs show up here with playback controls.</p>
        </div>
      )}
      {list && list.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-[var(--card-border)]">
          {list.map((m) => (
            <div key={`${m.windowId}:${m.itemId}`} className="flex items-center gap-3 border-b border-[var(--card-border)] px-4 py-3 last:border-b-0" data-media={m.itemId}>
              <Favicon item={m} size={18} />
              <button className="min-w-0 flex-1 text-left" onClick={() => invoke('media.activate', { itemId: m.itemId })}>
                <div className="truncate text-[15px] font-semibold">{m.title}</div>
                <div className="truncate text-[12px]">{m.playing ? 'Playing' : 'Paused'}</div>
              </button>
              <button className="icon-btn" title={m.playing ? 'Pause' : 'Play'} onClick={() => invoke('media.toggle', { itemId: m.itemId })}>
                {m.playing ? <Pause size={16} strokeWidth={2} /> : <Play size={16} strokeWidth={2} />}
              </button>
              <button className="icon-btn" title="Picture in picture" onClick={() => invoke('media.pip', { itemId: m.itemId })}>
                <PictureInPicture2 size={16} strokeWidth={1.9} />
              </button>
              <button className="icon-btn" title="Stop" onClick={() => invoke('media.close', { itemId: m.itemId })}>
                <X size={16} strokeWidth={2} />
              </button>
            </div>
          ))}
        </div>
      )}
      {(() => {
        const live = new Set((list ?? []).map((m) => m.url))
        const earlier = recent.filter((r) => !live.has(r.url))
        if (!earlier.length) return null
        const items = new Set((vs?.state.items ?? []).map((i) => i.id))
        return (
          <section className="mt-8" data-media-recent>
            <h2 className="mb-1 text-[16px] font-bold">Played earlier</h2>
            <p className="mb-3 text-[13px]">What played in your tabs this session. It is not saved, and private windows are never listed.</p>
            <div className="overflow-hidden rounded-xl border border-[var(--card-border)]">
              {earlier.map((m) => (
                <button
                  key={`${m.url}:${m.playedAt}`}
                  className="flex w-full items-center gap-3 border-b border-[var(--card-border)] px-4 py-3 text-left last:border-b-0 hover:bg-[var(--select)]"
                  data-media-recent-entry={m.url}
                  onClick={() => (items.has(m.itemId) ? invoke('media.activate', { itemId: m.itemId }) : invoke('tab.new', { url: m.url }))}
                  title={m.url}
                >
                  <Favicon item={m} size={18} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] font-semibold">{m.title}</div>
                    <div className="truncate text-[12px]">Played {ago(m.playedAt)}</div>
                  </div>
                </button>
              ))}
            </div>
          </section>
        )
      })()}
    </div>
  )
}

// Preview card frame: the backdrop and the header strip above the preview page view.
import { useEffect, type ReactNode } from 'react'
import { Maximize2, X } from 'lucide-react'
import type { ViewState } from '@shared/types'
import { displayUrl } from '@shared/url'
import { Favicon } from '../common/Favicon'
import { invoke } from '../common/store'

export function Preview({ vs }: { vs: ViewState }): ReactNode {
  const p = vs.window.preview
  const b = vs.window.previewBounds
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') void invoke('preview.close')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const close = (e: React.MouseEvent): void => {
    if (e.target === e.currentTarget) void invoke('preview.close')
  }
  if (!p || !b) return <div className="fixed inset-0 bg-[var(--backdrop)]" onMouseDown={close} />
  const host = displayUrl(p.url)
  return (
    <div className="fixed inset-0 bg-[var(--backdrop)]" onMouseDown={close}>
      <div
        className="absolute overflow-hidden rounded-[14px] bg-[var(--card)]"
        style={{ left: b.card.x, top: b.card.y, width: b.card.width, height: b.card.height, boxShadow: '0 18px 48px rgba(0,0,0,0.28), 0 0 0 1px var(--card-border)' }}
        data-preview-card
      >
        <div className="flex items-center gap-2 px-3" style={{ height: b.page.y - b.card.y }}>
          <Favicon item={{ url: p.url, favicon: null }} size={15} />
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-[13px] font-semibold">{p.title || host}</div>
            <div className="truncate text-[11.5px] font-medium">{host}</div>
          </div>
          <button
            className="no-drag flex h-7 shrink-0 items-center gap-1.5 rounded-lg bg-[var(--select)] px-2.5 text-[12.5px] font-semibold hover:brightness-95"
            title="Open as tab"
            onClick={() => invoke('preview.expand')}
          >
            <Maximize2 size={13} strokeWidth={2.1} /> Open as tab
          </button>
          <button className="icon-btn shrink-0" title="Close (Esc)" onClick={() => invoke('preview.close')}>
            <X size={16} strokeWidth={2} />
          </button>
        </div>
      </div>
    </div>
  )
}

// Split View over the content area: pane frames and draggable dividers (shell), and the
// drag-to-split edge zones (rendered in the overlay, which covers the content area during a tab drag).
import { useEffect, useRef, useState, type DragEvent, type PointerEvent, type ReactNode } from 'react'
import type { ViewState } from '@shared/types'
import { invoke } from '../common/store'

/** sidebar drags carry the item id under this type (shared with the sidebar drag and drop) */
export const DRAG_TYPE = 'application/x-swyr-item'

type Edge = 'left' | 'right' | 'top' | 'bottom'

/** props that make a sidebar row a drag source for drag-to-split */
export function splitDragSource(itemId: string): { draggable: true; onDragStart: (e: DragEvent) => void } {
  return {
    draggable: true,
    onDragStart: (e: DragEvent) => {
      if (!e.dataTransfer.types.includes(DRAG_TYPE)) e.dataTransfer.setData(DRAG_TYPE, itemId)
      e.dataTransfer.effectAllowed = 'move'
    }
  }
}

/** shell: show the drop zones while a sidebar tab is dragged, hide them when the drag ends */
export function useTabDragWatcher(): void {
  useEffect(() => {
    let on = false
    const start = (e: globalThis.DragEvent): void => {
      if (!e.dataTransfer?.types.includes(DRAG_TYPE)) return
      on = true
      void invoke('split.dropZones', { show: true })
    }
    const end = (): void => {
      if (!on) return
      on = false
      void invoke('split.dropZones', { show: false })
    }
    document.addEventListener('dragstart', start)
    document.addEventListener('dragend', end)
    document.addEventListener('drop', end)
    return () => {
      document.removeEventListener('dragstart', start)
      document.removeEventListener('dragend', end)
      document.removeEventListener('drop', end)
    }
  }, [])
}

/** shell: rounded frames behind each pane, a focus ring, and draggable dividers in the gaps */
export function SplitDividers({ vs }: { vs: ViewState }): ReactNode {
  const win = vs.window
  const rects = win.paneRects ?? []
  const drag = useRef<{ raf: number; divider: number; pos: number } | null>(null)
  if (rects.length < 2) return null
  const send = (): void => {
    const d = drag.current
    if (!d || d.raf) return
    d.raf = requestAnimationFrame(() => {
      if (!drag.current) return
      drag.current.raf = 0
      void invoke('split.setRatios', { divider: drag.current.divider, pos: drag.current.pos })
    })
  }
  const onDown = (index: number, horizontal: boolean) => (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { raf: 0, divider: index, pos: horizontal ? e.clientX : e.clientY }
  }
  const onMove = (horizontal: boolean) => (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return
    drag.current.pos = horizontal ? e.clientX : e.clientY
    send()
  }
  const onUp = (): void => {
    if (drag.current?.raf) cancelAnimationFrame(drag.current.raf)
    const d = drag.current
    drag.current = null
    if (d) void invoke('split.setRatios', { divider: d.divider, pos: d.pos })
  }
  return (
    <>
      {rects.map((r, i) => (
        <div
          key={i}
          className="pointer-events-none absolute rounded-[10px] bg-[var(--content)]"
          style={{
            left: r.x,
            top: r.y,
            width: r.width,
            height: r.height,
            boxShadow: i === win.focusedPane ? '0 0 0 2px var(--accent), var(--shadow)' : 'var(--shadow)'
          }}
        />
      ))}
      {win.dividers.map((d) => {
        const horizontal = d.layout === 'horizontal'
        return (
          <div
            key={d.index}
            data-divider={d.index}
            className={`no-drag group absolute z-10 flex items-center justify-center ${horizontal ? 'cursor-col-resize' : 'cursor-row-resize'}`}
            style={{ left: d.rect.x, top: d.rect.y, width: d.rect.width, height: d.rect.height }}
            onPointerDown={onDown(d.index, horizontal)}
            onPointerMove={onMove(horizontal)}
            onPointerUp={onUp}
            onDoubleClick={() => invoke('split.setRatios', { ratios: rects.map(() => 1) })}
          >
            <div
              className="rounded-full bg-[var(--fg)] opacity-0 transition-opacity group-hover:opacity-40"
              style={horizontal ? { width: 3, height: 36 } : { width: 36, height: 3 }}
            />
          </div>
        )
      })}
    </>
  )
}

const LABEL: Record<Edge, string> = { left: 'Split left', right: 'Split right', top: 'Split top', bottom: 'Split bottom' }

/** overlay (bounds = content area): the four edge zones, highlighted under the cursor */
export function SplitDropZones(): ReactNode {
  const [edge, setEdge] = useState<Edge | null>(null)
  const pick = (e: DragEvent<HTMLDivElement>): Edge | null => {
    const r = e.currentTarget.getBoundingClientRect()
    const x = (e.clientX - r.left) / Math.max(1, r.width)
    const y = (e.clientY - r.top) / Math.max(1, r.height)
    if (x < 0.2) return 'left'
    if (x > 0.8) return 'right'
    if (y < 0.2) return 'top'
    if (y > 0.8) return 'bottom'
    return null
  }
  const target: Record<Edge, React.CSSProperties> = {
    left: { left: 0, top: 0, bottom: 0, width: '50%' },
    right: { right: 0, top: 0, bottom: 0, width: '50%' },
    top: { left: 0, right: 0, top: 0, height: '50%' },
    bottom: { left: 0, right: 0, bottom: 0, height: '50%' }
  }
  return (
    <div
      className="fixed inset-0"
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        const next = pick(e)
        if (next !== edge) setEdge(next)
      }}
      onDragLeave={() => setEdge(null)}
      onDrop={(e) => {
        e.preventDefault()
        const id = e.dataTransfer.getData(DRAG_TYPE)
        const where = pick(e)
        setEdge(null)
        if (id && where) void invoke('split.drop', { itemId: id, edge: where })
        else void invoke('split.dropZones', { show: false })
      }}
    >
      {(['left', 'right', 'top', 'bottom'] as Edge[]).map((z) => (
        <div
          key={z}
          className="pointer-events-none absolute"
          style={{
            ...(z === 'left' || z === 'right' ? { [z]: 0, top: 0, bottom: 0, width: '20%' } : { [z]: 0, left: 0, right: 0, height: '20%' }),
            outline: '1.5px dashed var(--accent)',
            outlineOffset: -6,
            borderRadius: 10,
            opacity: edge ? 0.25 : 0.55
          }}
        />
      ))}
      {edge && (
        <div
          className="pointer-events-none absolute flex items-center justify-center rounded-[10px] text-[13px] font-semibold"
          style={{ ...target[edge], margin: 6, background: 'color-mix(in srgb, var(--accent) 22%, transparent)', outline: '2px solid var(--accent)', color: 'var(--fg)' }}
        >
          <span className="rounded-full bg-[var(--card)] px-3 py-1" style={{ boxShadow: 'var(--shadow)' }}>
            {LABEL[edge]}
          </span>
        </div>
      )}
    </div>
  )
}

// Split View over the content area: pane frames and draggable dividers (shell), and the
// drag-to-split edge zones (rendered in the overlay, which covers the content area during a tab drag).
import { useEffect, useRef, useState, type DragEvent, type PointerEvent, type ReactNode } from 'react'
import type { SplitEdge, ViewState } from '@shared/types'
import { invoke, useView } from '../common/store'
import { ITEM_MIME } from './sidebar/dnd'

/** native (Option-) drags from the sidebar carry the item id under this type */
export const DRAG_TYPE = ITEM_MIME

type Edge = SplitEdge

/**
 * shell: show the drop zones while a sidebar tab is dragged and hide them when the drag ends. Two sources:
 * native drags (Option-drag, dataTransfer DRAG_TYPE; the overlay handles the drop) and the sidebar's
 * pointer drags (draggingItemId plus the swyr:item-drag / swyr:item-drop window events; the pointer stays
 * with the shell, so the shell forwards its position to highlight an edge and sends the drop to main).
 */
export function useTabDragWatcher(): void {
  useEffect(() => {
    // pressing a sidebar row activates it, so remember what was on screen before the press: the drop splits that page
    let pressActive: string | null = null
    const onPress = (): void => {
      pressActive = useView.getState().vs?.window.activeItemId ?? null
    }
    document.addEventListener('pointerdown', onPress, true)
    let native = false
    const start = (e: globalThis.DragEvent): void => {
      if (!e.dataTransfer?.types.includes(DRAG_TYPE)) return
      native = true
      void invoke('split.dropZones', { show: true, baseId: pressActive })
    }
    const end = (): void => {
      if (!native) return
      native = false
      void invoke('split.dropZones', { show: false })
    }
    document.addEventListener('dragstart', start)
    document.addEventListener('dragend', end)
    document.addEventListener('drop', end)

    // sidebar pointer drags
    let pointerDrag: string | null = null
    let raf = 0
    let last = { x: 0, y: 0 }
    const sidebarRight = (): number => document.querySelector('[data-sidebar-root]')?.getBoundingClientRect().right ?? 0
    const begin = (itemId: string): void => {
      if (pointerDrag === itemId) return
      pointerDrag = itemId
      void invoke('split.dropZones', { show: true, baseId: pressActive })
    }
    const finish = (): void => {
      if (!pointerDrag) return
      pointerDrag = null
      if (raf) cancelAnimationFrame(raf)
      raf = 0
      void invoke('split.dropZones', { show: false })
    }
    const onItemDrag = (e: Event): void => {
      const id = (e as CustomEvent<{ itemId?: string }>).detail?.itemId
      if (id) begin(id)
    }
    const onItemDrop = (e: Event): void => {
      const d = (e as CustomEvent<{ itemId?: string; clientX?: number; clientY?: number }>).detail
      if (!d?.itemId || typeof d.clientX !== 'number' || typeof d.clientY !== 'number') return
      pointerDrag = null
      if (raf) cancelAnimationFrame(raf)
      raf = 0
      void invoke('split.drop', { itemId: d.itemId, x: d.clientX, y: d.clientY, baseId: pressActive })
    }
    const onMove = (e: globalThis.PointerEvent): void => {
      if (!pointerDrag) return
      last = { x: e.clientX, y: e.clientY }
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        if (pointerDrag && last.x > sidebarRight()) void invoke('split.dropZones', { show: true, x: last.x, y: last.y })
      })
    }
    window.addEventListener('swyr:item-drag', onItemDrag)
    window.addEventListener('swyr:item-drop', onItemDrop)
    document.addEventListener('pointermove', onMove)
    const unsub = useView.subscribe((s, prev) => {
      if (s.draggingItemId === prev.draggingItemId) return
      if (s.draggingItemId) begin(s.draggingItemId)
      else finish()
    })
    return () => {
      document.removeEventListener('pointerdown', onPress, true)
      document.removeEventListener('dragstart', start)
      document.removeEventListener('dragend', end)
      document.removeEventListener('drop', end)
      window.removeEventListener('swyr:item-drag', onItemDrag)
      window.removeEventListener('swyr:item-drop', onItemDrop)
      document.removeEventListener('pointermove', onMove)
      unsub()
      if (raf) cancelAnimationFrame(raf)
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
export function SplitDropZones({ hover }: { hover?: Edge | null }): ReactNode {
  const [nativeEdge, setEdge] = useState<Edge | null>(null)
  // a sidebar pointer drag reports the hovered edge through the overlay state; a native drag tracks it here
  const edge = nativeEdge ?? hover ?? null
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
        if (next !== nativeEdge) setEdge(next)
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

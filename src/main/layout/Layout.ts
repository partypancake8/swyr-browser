// Pure layout: bounds of the shell, tab panes and overlay for one window.
import type { Rect } from '@shared/types'

export const INSET = 8
export const PANE_GAP = 6
export const SIDEBAR_MIN = 200
export const SIDEBAR_MAX = 400
export const SIDEBAR_DEFAULT = 260

export const PANE_RADIUS = 10
export const PREVIEW_RADIUS = 14
export const PREVIEW_HEADER = 44
export const PREVIEW_SCALE = 0.8
export const RATIO_MIN = 0.2
export const RATIO_MAX = 0.8
export const MAX_PANES = 4

/** 'content' covers just the content area (split drop zones); 'preview' is full window plus a preview card */
export type OverlayLayout = 'none' | 'full' | 'find' | 'findReplace' | 'sidebar' | 'toast' | 'content' | 'preview'

export interface SplitLayout {
  layout: 'horizontal' | 'vertical'
  ratios: number[]
}

export interface LayoutInput {
  width: number
  height: number
  sidebarVisible: boolean
  sidebarWidth: number
  /** number of visible panes, 1 to 4 (0 when there is no active tab) */
  panes: number
  split?: SplitLayout
  overlay: OverlayLayout
}

export interface DividerRect {
  /** divider i sits between pane i and pane i + 1 */
  index: number
  rect: Rect
}

export interface PreviewRects {
  /** the whole card: header strip on top of the page */
  card: Rect
  /** the preview page view */
  page: Rect
}

export interface LayoutOutput {
  shell: Rect
  content: Rect
  panes: Rect[]
  /** the gaps between panes, where the shell draws the draggable dividers */
  dividers: DividerRect[]
  overlay: Rect | null
  preview: PreviewRects | null
}

export const clampSidebar = (w: number): number => Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, w)))

/**
 * normalize ratios to n entries summing to 1, with every divider clamped so that
 * each of its two neighbouring panes gets 20 to 80 % of their combined size
 */
export function normalizeRatios(n: number, ratios?: number[]): number[] {
  if (n <= 1) return [1]
  let r = ratios && ratios.length === n ? ratios.slice() : Array(n).fill(1 / n)
  r = r.map((v) => (Number.isFinite(v) && v > 0 ? v : 1 / n))
  const sum = r.reduce((a, b) => a + b, 0)
  r = r.map((v) => v / sum)
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 0; i < n - 1; i++) {
      const pair = r[i] + r[i + 1]
      const frac = Math.min(RATIO_MAX, Math.max(RATIO_MIN, r[i] / pair))
      r[i] = pair * frac
      r[i + 1] = pair - r[i]
    }
  }
  return r
}

export function splitRect(area: Rect, n: number, split?: SplitLayout): Rect[] {
  const count = Math.max(1, Math.min(4, n))
  if (count === 1) return [area]
  const ratios = normalizeRatios(count, split?.ratios)
  const horizontal = (split?.layout ?? 'horizontal') === 'horizontal'
  const total = (horizontal ? area.width : area.height) - PANE_GAP * (count - 1)
  const rects: Rect[] = []
  let cursor = horizontal ? area.x : area.y
  ratios.forEach((ratio, i) => {
    const size = i === count - 1 ? (horizontal ? area.x + area.width : area.y + area.height) - cursor : Math.round(total * ratio)
    rects.push(
      horizontal
        ? { x: cursor, y: area.y, width: size, height: area.height }
        : { x: area.x, y: cursor, width: area.width, height: size }
    )
    cursor += size + PANE_GAP
  })
  return rects
}

/** the gaps between consecutive pane rects */
export function dividerRects(rects: Rect[], layout: 'horizontal' | 'vertical' = 'horizontal'): DividerRect[] {
  const out: DividerRect[] = []
  for (let i = 0; i < rects.length - 1; i++) {
    const a = rects[i]
    const b = rects[i + 1]
    out.push({
      index: i,
      rect:
        layout === 'horizontal'
          ? { x: a.x + a.width, y: a.y, width: Math.max(0, b.x - a.x - a.width), height: a.height }
          : { x: a.x, y: a.y + a.height, width: a.width, height: Math.max(0, b.y - a.y - a.height) }
    })
  }
  return out
}

/** ratios after dragging divider `index` to the window coordinate `pos` */
export function ratiosForDrag(content: Rect, n: number, split: SplitLayout, index: number, pos: number): number[] {
  const ratios = normalizeRatios(n, split.ratios)
  if (index < 0 || index >= n - 1) return ratios
  const horizontal = split.layout === 'horizontal'
  const total = (horizontal ? content.width : content.height) - PANE_GAP * (n - 1)
  if (total <= 0) return ratios
  const start = (horizontal ? content.x : content.y) + ratios.slice(0, index).reduce((a, b) => a + b, 0) * total + PANE_GAP * index
  const pair = ratios[index] + ratios[index + 1]
  const want = (pos - PANE_GAP / 2 - start) / total
  const first = Math.min(pair * RATIO_MAX, Math.max(pair * RATIO_MIN, want))
  const next = ratios.slice()
  next[index] = first
  next[index + 1] = pair - first
  return normalizeRatios(n, next)
}

/** the preview card: a page view at 80 % of the content area with a header strip above it, centred */
export function previewRects(content: Rect): PreviewRects {
  const pw = Math.round(content.width * PREVIEW_SCALE)
  const ph = Math.round(Math.min(content.height * PREVIEW_SCALE, content.height - PREVIEW_HEADER - 16))
  const ch = ph + PREVIEW_HEADER
  const x = content.x + Math.round((content.width - pw) / 2)
  const y = content.y + Math.round((content.height - ch) / 2)
  return {
    card: { x, y, width: pw, height: ch },
    page: { x, y: y + PREVIEW_HEADER, width: pw, height: Math.max(0, ph) }
  }
}

export function computeLayout(input: LayoutInput): LayoutOutput {
  const width = Math.max(0, Math.round(input.width))
  const height = Math.max(0, Math.round(input.height))
  const shell = { x: 0, y: 0, width, height }
  const sidebar = input.sidebarVisible ? clampSidebar(input.sidebarWidth) : 0
  const left = input.sidebarVisible ? sidebar : INSET
  const content = {
    x: left,
    y: INSET,
    width: Math.max(0, width - left - INSET),
    height: Math.max(0, height - INSET * 2)
  }
  const panes = input.panes > 0 ? splitRect(content, input.panes, input.split) : []
  const dividers = panes.length > 1 ? dividerRects(panes, input.split?.layout ?? 'horizontal') : []
  let overlay: Rect | null
  let preview: PreviewRects | null = null
  switch (input.overlay) {
    case 'full':
      overlay = shell
      break
    case 'preview':
      overlay = shell
      preview = previewRects(content)
      break
    case 'content':
      overlay = content
      break
    case 'find':
    case 'findReplace': {
      const w = Math.min(360, content.width)
      overlay = { x: content.x + content.width - w - 12, y: content.y + 10, width: w, height: input.overlay === 'findReplace' ? 96 : 52 }
      break
    }
    case 'sidebar':
      overlay = { x: 0, y: 0, width: clampSidebar(input.sidebarWidth) + INSET, height }
      break
    case 'toast': {
      const w = Math.min(300, content.width)
      overlay = { x: content.x + Math.round((content.width - w) / 2), y: height - 72, width: w, height: 52 }
      break
    }
    default:
      overlay = null
  }
  return { shell, content, panes, dividers, overlay, preview }
}

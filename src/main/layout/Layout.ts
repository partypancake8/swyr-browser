// Pure layout: bounds of the shell, tab panes and overlay for one window.
import type { Rect } from '@shared/types'

export const INSET = 8
export const PANE_GAP = 6
export const SIDEBAR_MIN = 200
export const SIDEBAR_MAX = 400
export const SIDEBAR_DEFAULT = 260

export type OverlayLayout = 'none' | 'full' | 'find' | 'sidebar' | 'toast'

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

export interface LayoutOutput {
  shell: Rect
  content: Rect
  panes: Rect[]
  overlay: Rect | null
}

export const clampSidebar = (w: number): number => Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, w)))

/** normalize ratios to n entries, each clamped to 20..80 % for two panes, summing to 1 */
export function normalizeRatios(n: number, ratios?: number[]): number[] {
  if (n <= 1) return [1]
  let r = ratios && ratios.length === n ? ratios.slice() : Array(n).fill(1 / n)
  const min = n === 2 ? 0.2 : 0.1
  r = r.map((v) => (Number.isFinite(v) && v > 0 ? v : 1 / n))
  const sum = r.reduce((a, b) => a + b, 0)
  r = r.map((v) => Math.max(min, v / sum))
  const sum2 = r.reduce((a, b) => a + b, 0)
  return r.map((v) => v / sum2)
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
  let overlay: Rect | null
  switch (input.overlay) {
    case 'full':
      overlay = shell
      break
    case 'find': {
      const w = Math.min(360, content.width)
      overlay = { x: content.x + content.width - w - 12, y: content.y + 10, width: w, height: 52 }
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
  return { shell, content, panes, overlay }
}

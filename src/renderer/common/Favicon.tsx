import { useState, type ReactNode } from 'react'
import { Archive, Blocks, Globe, History, Library, Paintbrush, Search, Settings, Shapes, Sparkles, StickyNote, TriangleAlert, type LucideIcon } from 'lucide-react'
import type { Item } from '@shared/types'

/** one icon per swyr:// page, so internal tabs are told apart in the sidebar */
const INTERNAL_ICONS: Record<string, LucideIcon> = {
  settings: Settings,
  history: History,
  library: Library,
  styles: Paintbrush,
  note: StickyNote,
  notes: StickyNote,
  canvas: Shapes,
  canvases: Shapes,
  archive: Archive,
  extensions: Blocks,
  onboarding: Sparkles,
  error: TriangleAlert,
  newtab: Search
}

export function internalPageIcon(url: string): LucideIcon | null {
  if (!url.startsWith('swyr://')) return null
  const host = url.slice(7).split(/[/?#]/)[0]
  return INTERNAL_ICONS[host] ?? Search
}

export function Favicon({ item, size = 16 }: { item: Pick<Item, 'url' | 'favicon'> & { kind?: Item['kind'] }; size?: number }): ReactNode {
  const [failed, setFailed] = useState<string | null>(null)
  const Icon = item.kind === 'note' ? StickyNote : item.kind === 'canvas' ? Shapes : internalPageIcon(item.url)
  if (Icon) return <Icon size={size} strokeWidth={1.8} className="shrink-0" data-favicon-kind="internal" />
  if (item.favicon && failed !== item.favicon) {
    return (
      <img
        src={item.favicon}
        width={size}
        height={size}
        className="shrink-0 rounded-[3px] object-contain"
        style={{ width: size, height: size }}
        onError={() => setFailed(item.favicon)}
        draggable={false}
        alt=""
        data-favicon-kind="site"
      />
    )
  }
  return <Globe size={size} strokeWidth={1.8} className="shrink-0" data-favicon-kind="site" />
}

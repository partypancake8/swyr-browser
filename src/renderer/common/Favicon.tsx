import { useState, type ReactNode } from 'react'
import { Archive, Globe, Library, Search, Settings } from 'lucide-react'
import type { Item } from '@shared/types'

export function Favicon({ item, size = 16 }: { item: Pick<Item, 'url' | 'favicon'>; size?: number }): ReactNode {
  const [failed, setFailed] = useState<string | null>(null)
  if (item.url.startsWith('swyr://')) {
    const host = item.url.slice(7).split(/[/?#]/)[0]
    const Icon = host === 'settings' ? Settings : host === 'archive' ? Archive : host === 'library' ? Library : Search
    return <Icon size={size} strokeWidth={1.8} className="shrink-0" />
  }
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
      />
    )
  }
  return <Globe size={size} strokeWidth={1.8} className="shrink-0" />
}

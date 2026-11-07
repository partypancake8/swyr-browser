// Sidebar media controls: the tab that plays audio or video, usable from any tab or space.
import type { ReactNode } from 'react'
import { Pause, PictureInPicture2, Play, X } from 'lucide-react'
import type { ViewState } from '@shared/types'
import { Favicon } from '../common/Favicon'
import { invoke } from '../common/store'

export function MediaBar({ vs }: { vs: ViewState }): ReactNode {
  const media = vs.window.media
  if (!media) return null
  const item = vs.state.items.find((i) => i.id === media.itemId)
  if (!item) return null
  // hidden while the playing tab is on screen (alone or as a pane of the active split)
  const active = vs.state.items.find((i) => i.id === vs.window.activeItemId)
  const onScreen = active && (active.id === item.id || active.panes?.itemIds.includes(item.id))
  if (onScreen && media.playing) return null
  return (
    <div className="mb-1 flex h-10 shrink-0 items-center gap-1.5 rounded-[10px] bg-[var(--field)] pl-2 pr-1" data-media={media.itemId}>
      <Favicon item={item} size={16} />
      <button
        className="min-w-0 flex-1 truncate text-left text-[13px] font-medium"
        title={`Go to ${media.title}`}
        onClick={() => invoke('media.activate', { itemId: item.id })}
      >
        {media.title}
      </button>
      <button className="icon-btn" title={media.playing ? 'Pause' : 'Play'} onClick={() => invoke('media.toggle', { itemId: item.id })}>
        {media.playing ? <Pause size={15} strokeWidth={2} /> : <Play size={15} strokeWidth={2} />}
      </button>
      <button className="icon-btn" title="Picture in picture" onClick={() => invoke('media.pip', { itemId: item.id })}>
        <PictureInPicture2 size={15} strokeWidth={1.9} />
      </button>
      <button className="icon-btn" title="Stop" onClick={() => invoke('media.close', { itemId: item.id })}>
        <X size={15} strokeWidth={2} />
      </button>
    </div>
  )
}

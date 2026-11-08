// The shell renders the sidebar and the frame behind the tab views.
import { SpaceIcon } from '../common/SpaceIcon'
import { useCallback, useRef, type ReactNode } from 'react'
import { Plus } from 'lucide-react'
import { useView, invoke } from '../common/store'
import { SpaceBackground, activeSpace, useSpaceTheme } from '../common/theme'
import { Sidebar } from './Sidebar'
import { SplitDividers, useTabDragWatcher } from './SplitDropZones'
import { DownloadsPanel } from './DownloadsPanel'

const INSET = 8

export function App(): ReactNode {
  const vs = useView((s) => s.vs)
  // round 5: a blank window has no space, so it draws on the neutral theme
  const space = vs && !vs.window.blank ? activeSpace(vs) : undefined
  const { dark } = useSpaceTheme(space, vs?.systemDark ?? false)
  const drag = useRef<{ raf: number; width: number } | null>(null)
  useTabDragWatcher()

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { raf: 0, width: e.clientX }
  }, [])
  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    d.width = e.clientX
    if (!d.raf) {
      d.raf = requestAnimationFrame(() => {
        if (drag.current) {
          drag.current.raf = 0
          void invoke('sidebar.setWidth', { width: drag.current.width })
        }
      })
    }
  }, [])
  const onPointerUp = useCallback(() => {
    drag.current = null
  }, [])

  if (!vs) return <div className="h-full" />
  const visible = vs.window.sidebarVisible
  const width = vs.state.settings.sidebarWidth
  const left = visible ? width : INSET
  const active = vs.state.items.find((i) => i.id === vs.window.activeItemId)
  const split = (vs.window.paneRects?.length ?? 0) > 1
  const showsTab = split || Boolean(active && vs.window.loaded.includes(active.id))

  return (
    <SpaceBackground space={space} dark={dark} className="h-full w-full overflow-hidden">
      {visible ? (
        <div className="absolute inset-y-0 left-0" style={{ width }}>
          <Sidebar vs={vs} />
          <DownloadsPanel windowId={vs.window.id} />
          <div
            className="no-drag absolute inset-y-0 right-0 z-10 w-[6px] cursor-col-resize"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onDoubleClick={() => invoke('sidebar.setWidth', { width: 260 })}
          />
        </div>
      ) : (
        <>
          <div className="drag absolute inset-x-0 top-0 h-2" />
          <div className="absolute inset-y-0 left-0 z-10 w-[6px]" onMouseEnter={() => invoke('sidebar.peek', { show: true })} />
        </>
      )}
      <div
        className={`absolute overflow-hidden rounded-[10px] ${split ? '' : 'bg-[var(--content)]'}`}
        style={{ left, top: INSET, right: INSET, bottom: INSET, boxShadow: split ? 'none' : 'var(--shadow)' }}
      >
        {!showsTab && (
          <div className="flex h-full flex-col items-center justify-center gap-3">
            <div className="flex items-center gap-1.5 text-[15px] font-semibold">
              {space && <SpaceIcon name={space.icon} size={16} />}
              {space ? space.name : 'swyr'}
            </div>
            <button
              className="flex items-center gap-2 rounded-lg bg-[var(--select)] px-3 py-1.5 text-[13px] font-medium hover:brightness-95"
              onClick={() => invoke('commandbar.open', { mode: 'new' })}
            >
              <Plus size={15} strokeWidth={2} /> New Tab <span className="font-normal">⌘T</span>
            </button>
          </div>
        )}
      </div>
      <SplitDividers vs={vs} />
    </SpaceBackground>
  )
}

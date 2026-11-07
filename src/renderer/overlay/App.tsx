// The overlay view: command bar, find bar, space editor, sidebar preview and toasts.
import { useEffect, type ReactNode } from 'react'
import { useView, invoke } from '../common/store'
import { SpaceBackground, activeSpace, useSpaceTheme } from '../common/theme'
import { Sidebar } from '../shell/Sidebar'
import { CommandBar } from './CommandBar'
import { FindBar } from './FindBar'
import { SpaceEditor } from './SpaceEditor'
import { Dialogs } from './dialogs/Dialogs'
import { Preview } from './Preview'
import { SplitDropZones } from '../shell/SplitDropZones'

export function App(): ReactNode {
  const vs = useView((s) => s.vs)
  const space = vs ? activeSpace(vs) : undefined
  const { dark } = useSpaceTheme(space, vs?.systemDark ?? false)
  const overlay = vs?.window.overlay ?? null

  useEffect(() => {
    if (overlay?.kind !== 'sidebar') return
    const leave = (): void => void invoke('sidebar.peek', { show: false })
    document.documentElement.addEventListener('mouseleave', leave)
    return () => document.documentElement.removeEventListener('mouseleave', leave)
  }, [overlay?.kind])

  if (!vs || !overlay) return null

  switch (overlay.kind) {
    case 'commandbar':
      return (
        <div className="fixed inset-0 bg-[var(--backdrop)]" onMouseDown={(e) => e.target === e.currentTarget && invoke('commandbar.close')}>
          <div className="flex justify-center" style={{ paddingTop: '20vh' }} onMouseDown={(e) => e.target === e.currentTarget && invoke('commandbar.close')}>
            <CommandBar key={overlay.seq} vs={vs} mode={overlay.mode} initialQuery={overlay.query} />
          </div>
        </div>
      )
    case 'find':
      return <FindBar key={overlay.seq} query={overlay.query} active={overlay.active} matches={overlay.matches} />
    case 'spaceEdit': {
      const target = vs.state.spaces.find((s) => s.id === overlay.spaceId)
      if (!target) return null
      return (
        <div
          className="fixed inset-0 flex items-start justify-center bg-[var(--backdrop)]"
          style={{ paddingTop: '18vh' }}
          onMouseDown={(e) => e.target === e.currentTarget && invoke('overlay.close')}
        >
          <SpaceEditor key={overlay.seq} space={target} canDelete={vs.state.spaces.length > 1} profiles={vs.state.profiles} systemDark={vs.systemDark} />
        </div>
      )
    }
    case 'sidebar':
      return (
        <div className="h-full pr-2">
          <SpaceBackground space={space} dark={dark} className="h-full overflow-hidden rounded-r-xl" style={{ boxShadow: '0 12px 32px rgba(0,0,0,0.25)' }}>
            <Sidebar vs={vs} peek />
          </SpaceBackground>
        </div>
      )
    case 'dialog':
      return <Dialogs key={overlay.seq} vs={vs} dialog={overlay} />
    case 'toast':
      return (
        <div className="flex h-full items-center justify-center p-1">
          <div className="rounded-full bg-[var(--fg)] px-4 py-2 text-[13px] font-semibold text-(color:--card)" style={{ boxShadow: 'var(--shadow)' }}>
            {overlay.message}
          </div>
        </div>
      )
    // round 2a
    case 'preview':
      return <Preview key={overlay.seq} vs={vs} />
    case 'splitDrop':
      return <SplitDropZones key={overlay.seq} hover={overlay.edge} />
    default:
      return null
  }
}

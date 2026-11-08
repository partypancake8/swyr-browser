// Mini Window chrome: traffic light inset, back/forward, address, "Open in main window" with a space picker, close.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AppWindow, ArrowLeft, ArrowRight, ChevronDown, RotateCw, X } from 'lucide-react'
import type { MiniViewState } from '@shared/types'
import { displayUrl } from '@shared/url'
import { Favicon } from '../common/Favicon'
import { SpaceBackground, useSpaceTheme } from '../common/theme'

const api = window.swyrMini
const run = (command: string, payload?: unknown): void => {
  void api?.invoke(command, payload).catch((err) => console.error('[swyr]', command, err))
}

export function MiniApp(): ReactNode {
  const [vs, setVs] = useState<MiniViewState | null>(null)
  const [editing, setEditing] = useState(false)
  useEffect(() => {
    if (!api) return undefined
    const off = api.onState((s) => setVs(s))
    const offEv = api.onEvent((e) => e.type === 'focusUrl' && setEditing(true))
    void api.getState().then((s) => s && setVs((prev) => prev ?? s))
    return () => {
      off()
      offEv()
    }
  }, [])
  const space = vs ? (vs.spaces.find((s) => s.id === vs.activeSpaceId) ?? vs.spaces[0]) : undefined
  const { dark } = useSpaceTheme(space, vs?.systemDark ?? false)
  if (!vs) return <div className="h-full" />
  const m = vs.mini
  const blank = !m.url || m.url === 'about:blank'
  const showInput = editing || blank
  const target = space ? space.name : 'main window'
  return (
    <SpaceBackground space={space} dark={dark} className="h-full w-full overflow-hidden">
      <div className="drag relative flex h-[38px] items-center gap-0.5 pr-1.5" style={{ paddingLeft: 76 }}>
        <button className="icon-btn" title="Back (⌘[)" disabled={!m.canGoBack} onClick={() => run('mini.back')}>
          <ArrowLeft size={15} strokeWidth={1.9} />
        </button>
        <button className="icon-btn" title="Forward (⌘])" disabled={!m.canGoForward} onClick={() => run('mini.forward')}>
          <ArrowRight size={15} strokeWidth={1.9} />
        </button>
        <button className="icon-btn" title={m.loading ? 'Stop' : 'Reload (⌘R)'} onClick={() => run(m.loading ? 'mini.stop' : 'mini.reload')}>
          {m.loading ? <X size={15} strokeWidth={1.9} /> : <RotateCw size={14} strokeWidth={1.9} />}
        </button>
        <div className="mx-1 min-w-0 flex-1">
          {showInput ? (
            <AddressInput initial={blank ? '' : m.url} onDone={() => setEditing(false)} />
          ) : (
            <button
              className="no-drag flex h-7 w-full items-center gap-2 overflow-hidden rounded-lg bg-[var(--field)] px-2 text-left"
              title={m.url}
              onClick={() => setEditing(true)}
            >
              <Favicon item={{ url: m.url, favicon: m.favicon }} size={13} />
              <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">{displayUrl(m.url)}</span>
            </button>
          )}
        </div>
        <div className="no-drag flex h-7 shrink-0 items-center overflow-hidden rounded-lg bg-[var(--field)]">
          <button
            className="flex h-full items-center gap-1.5 pl-2 pr-1.5 text-[12.5px] font-semibold hover:bg-[var(--row-hover)]"
            title={`Open in main window, in ${target} (⌘O)`}
            onClick={() => run('mini.openInMain', { spaceId: space?.id })}
          >
            <AppWindow size={14} strokeWidth={1.9} /> Open
          </button>
          <button className="flex h-full w-6 items-center justify-center hover:bg-[var(--row-hover)]" title="Choose a space" onClick={() => run('mini.spaceMenu')}>
            <ChevronDown size={13} strokeWidth={2} />
          </button>
        </div>
        <button className="icon-btn ml-0.5" title="Close (⌘W)" onClick={() => run('mini.close')}>
          <X size={15} strokeWidth={2} />
        </button>
      </div>
    </SpaceBackground>
  )
}

function AddressInput({ initial, onDone }: { initial: string; onDone: () => void }): ReactNode {
  const ref = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState(initial)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])
  return (
    <input
      ref={ref}
      value={value}
      placeholder="Search or enter URL"
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && value.trim()) {
          run('mini.navigate', { input: value.trim() })
          onDone()
        }
        if (e.key === 'Escape') onDone()
      }}
      onBlur={onDone}
      className="no-drag h-7 w-full rounded-lg bg-[var(--card)] px-2 text-[12.5px] font-medium outline-none ring-1 ring-[var(--card-border)]"
    />
  )
}

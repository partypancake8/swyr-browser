// Round 7: the sidebar row for an app update (available, downloading, ready to install on restart).
import { useEffect, type ReactNode } from 'react'
import { ArrowDownCircle, RotateCw } from 'lucide-react'
import { invoke } from '../common/store'
import { startPlatformSync, usePlatform } from './urlrow/platform'

export function UpdateBar(): ReactNode {
  useEffect(() => startPlatformSync(), [])
  const u = usePlatform((s) => s.p?.update)
  if (!u || !u.version || (u.status !== 'available' && u.status !== 'downloading' && u.status !== 'ready')) return null
  const ready = u.status === 'ready'
  const text = ready
    ? `swyr ${u.version} is ready. Restart to update.`
    : u.status === 'downloading'
      ? `Downloading swyr ${u.version}${typeof u.percent === 'number' ? ` (${u.percent}%)` : ''}`
      : `swyr ${u.version} is available.`
  return (
    <div className="mb-1 flex min-h-10 shrink-0 items-center gap-1.5 rounded-[10px] bg-[var(--field)] py-1 pl-2 pr-1" data-update={u.status}>
      <ArrowDownCircle size={16} strokeWidth={1.9} className="shrink-0" />
      <button
        className="min-w-0 flex-1 text-left text-[13px] font-medium leading-snug"
        title={ready ? 'Restart swyr to install the update' : 'Open the release notes'}
        onClick={() => invoke(ready ? 'update.install' : 'update.openReleaseNotes')}
      >
        {text}
      </button>
      {ready && (
        <button className="icon-btn" title="Restart to update" onClick={() => invoke('update.install')}>
          <RotateCw size={15} strokeWidth={2} />
        </button>
      )}
    </div>
  )
}

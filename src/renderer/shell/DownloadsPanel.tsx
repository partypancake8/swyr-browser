// Sidebar downloads panel: progress, open, show in Finder, cancel, clear.
import { useEffect, type ReactNode } from 'react'
import { File, FolderOpen, X } from 'lucide-react'
import type { DownloadEntry } from '@shared/types'
import { invoke } from '../common/store'
import { startPlatformSync, usePlatform } from './urlrow/platform'

function size(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

function status(d: DownloadEntry): string {
  if (d.state === 'completed') return size(d.receivedBytes || d.totalBytes)
  if (d.state === 'cancelled') return 'Cancelled'
  if (d.state === 'interrupted') return 'Failed'
  return d.totalBytes > 0 ? `${size(d.receivedBytes)} of ${size(d.totalBytes)}` : size(d.receivedBytes)
}

function Row({ d }: { d: DownloadEntry }): ReactNode {
  const pct = d.totalBytes > 0 ? Math.min(100, Math.round((d.receivedBytes / d.totalBytes) * 100)) : 0
  const done = d.state === 'completed'
  return (
    <div className="group flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-[var(--row-hover)]">
      <File size={16} strokeWidth={1.9} className="shrink-0" />
      <button className="min-w-0 flex-1 text-left" disabled={!done} title={done ? 'Open' : d.filename} onClick={() => invoke('downloads.openFile', { id: d.id })}>
        <div className="truncate text-[13px] font-semibold">{d.filename}</div>
        <div className="truncate text-[11px] font-medium">{status(d)}</div>
        {d.state === 'progressing' && (
          <div className="mt-1 h-[3px] overflow-hidden rounded-full bg-[var(--divider)]">
            <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${pct}%` }} />
          </div>
        )}
      </button>
      {d.state === 'progressing' ? (
        <button className="icon-btn !h-6 !w-6" title="Cancel" onClick={() => invoke('downloads.cancel', { id: d.id })}>
          <X size={14} strokeWidth={2} />
        </button>
      ) : done ? (
        <button className="icon-btn !h-6 !w-6" title="Show in Finder" onClick={() => invoke('downloads.reveal', { id: d.id })}>
          <FolderOpen size={14} strokeWidth={2} />
        </button>
      ) : null}
    </div>
  )
}

export function DownloadsPanel({ windowId }: { windowId: number }): ReactNode {
  useEffect(() => startPlatformSync(), [])
  const p = usePlatform((s) => s.p)
  if (!p || !p.downloadsPanel.includes(windowId)) return null
  return (
    <div className="no-drag absolute inset-x-2 bottom-11 z-20 flex max-h-[55%] flex-col overflow-hidden rounded-xl border border-[var(--card-border)] bg-[var(--card)] shadow-lg">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-[var(--card-border)] pl-3 pr-1">
        <span className="flex-1 text-[13px] font-bold">Downloads</span>
        {p.downloads.some((d) => d.state !== 'progressing') && (
          <button className="rounded-md px-2 py-0.5 text-[12px] font-semibold hover:bg-[var(--select)]" onClick={() => invoke('downloads.clear')}>
            Clear
          </button>
        )}
        <button className="icon-btn !h-7 !w-7" title="Close" onClick={() => invoke('downloads.open', { show: false })}>
          <X size={14} strokeWidth={2} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {p.downloads.length === 0 ? (
          <div className="px-3 py-4 text-center text-[13px] font-medium">No downloads yet.</div>
        ) : (
          p.downloads.map((d) => <Row key={d.id} d={d} />)
        )}
      </div>
      <button
        className="shrink-0 truncate border-t border-[var(--card-border)] px-3 py-2 text-left text-[11px] font-medium hover:bg-[var(--select)]"
        title="Change the downloads folder"
        onClick={() => invoke('downloads.setDirectory')}
      >
        Saving to {p.downloadDirectory.replace(/^\/Users\/[^/]+/, '~')}
      </button>
    </div>
  )
}

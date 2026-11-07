// Library sections for Styles and Downloads.
import { useEffect, useState, type ReactNode } from 'react'
import { ExternalLink, File, FolderOpen, Paintbrush, Share2, Trash2 } from 'lucide-react'
import type { DownloadEntry, PlatformRuntime, ViewState } from '@shared/types'
import { invoke } from '../../common/store'

function EmptyCard({ id, title, body }: { id: string; title: string; body: string }): ReactNode {
  return (
    <div className="flex flex-col items-center rounded-xl border border-[var(--card-border)] px-6 py-16 text-center" data-empty={id}>
      <h2 className="mb-2 text-[18px] font-bold">{title}</h2>
      <p className="max-w-[420px] text-[14px] leading-6">{body}</p>
    </div>
  )
}

export function StylesView({ vs }: { vs: ViewState | null }): ReactNode {
  const styles = [...(vs?.state.styles ?? [])].sort((a, b) => a.hostPattern.localeCompare(b.hostPattern))
  const [copied, setCopied] = useState<string | null>(null)
  return (
    <div data-library="styles">
      <div className="mb-1 flex items-center gap-3">
        <h1 className="flex-1 text-[26px] font-bold">Styles</h1>
        <button className="rounded-lg bg-[var(--select)] px-2.5 py-1 text-[12px] font-semibold hover:brightness-95" onClick={() => invoke('style.import', {})}>
          Install from Clipboard
        </button>
        <button className="rounded-lg bg-[var(--select)] px-2.5 py-1 text-[12px] font-semibold hover:brightness-95" onClick={() => invoke('style.open', {})}>
          Manage Styles
        </button>
      </div>
      <p className="mb-6 text-[14px]">Every site you styled: colours, fonts, hidden elements and your own CSS and JavaScript. Share one by copying its code.</p>
      {styles.length === 0 ? (
        <EmptyCard id="styles" title="No styles yet" body="Styles change how a site looks: colours, fonts, custom CSS and hidden elements. Each site you style is listed here." />
      ) : (
        <div className="overflow-hidden rounded-xl border border-[var(--card-border)]">
          {styles.map((st) => {
            const parts = [st.css ? 'CSS' : '', st.js ? 'JavaScript' : '', st.hiddenSelectors.length ? `${st.hiddenSelectors.length} hidden` : '', st.colors.bg || st.colors.fg ? 'Colours' : '', st.font ? st.font : '']
            return (
              <div key={st.id} className="flex items-center gap-3 border-b border-[var(--card-border)] px-4 py-3 last:border-b-0" data-style={st.id}>
                <Paintbrush size={18} strokeWidth={1.9} className="shrink-0" />
                <button className="min-w-0 flex-1 text-left" onClick={() => invoke('style.open', { id: st.id })}>
                  <div className="truncate text-[15px] font-semibold">{st.hostPattern}</div>
                  <div className="truncate text-[12px]">{(st.enabled ? 'On' : 'Off') + (parts.filter(Boolean).length ? ' · ' + parts.filter(Boolean).join(', ') : '')}</div>
                </button>
                <button className="rounded-lg px-2.5 py-1 text-[12px] font-semibold hover:bg-[var(--select)]" onClick={() => invoke('style.toggle', { id: st.id })}>
                  {st.enabled ? 'Turn Off' : 'Turn On'}
                </button>
                <button
                  className="icon-btn"
                  title={copied === st.id ? 'Share code copied' : 'Copy share code'}
                  onClick={() => void invoke('style.export', { id: st.id }).then(() => setCopied(st.id))}
                >
                  <Share2 size={16} strokeWidth={1.9} />
                </button>
                <button className="icon-btn" title="Delete style" onClick={() => invoke('style.delete', { id: st.id })}>
                  <Trash2 size={16} strokeWidth={1.9} />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function bytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 ** 2).toFixed(1)} MB`
}

export function DownloadsView(): ReactNode {
  const [list, setList] = useState<DownloadEntry[] | null>(null)
  useEffect(() => {
    let alive = true
    const load = (): void => {
      void invoke('platform.state').then((r) => {
        if (alive) setList(((r as PlatformRuntime | null)?.downloads ?? []).slice().sort((a, b) => b.startedAt - a.startedAt))
      })
    }
    load()
    const timer = window.setInterval(load, 1000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [])
  return (
    <div data-library="downloads">
      <div className="mb-1 flex items-center gap-3">
        <h1 className="flex-1 text-[26px] font-bold">Downloads</h1>
        {list && list.length > 0 && (
          <button className="rounded-lg bg-[var(--select)] px-2.5 py-1 text-[12px] font-semibold hover:brightness-95" onClick={() => invoke('downloads.clear')}>
            Clear List
          </button>
        )}
      </div>
      <p className="mb-6 text-[14px]">Files you downloaded in swyr, newest first.</p>
      {list && list.length === 0 && (
        <EmptyCard id="downloads" title="No downloads yet" body="Files you download in swyr show up here, newest first, with buttons to open them or show them in Finder." />
      )}
      {list && list.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-[var(--card-border)]">
          {list.map((d) => (
            <div key={d.id} className="flex items-center gap-3 border-b border-[var(--card-border)] px-4 py-3 last:border-b-0" data-download={d.id}>
              <File size={18} strokeWidth={1.9} className="shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-semibold">{d.filename}</div>
                <div className="truncate text-[12px]">
                  {d.state === 'completed' ? bytes(d.receivedBytes || d.totalBytes) : d.state === 'progressing' ? `${bytes(d.receivedBytes)} so far` : d.state === 'cancelled' ? 'Cancelled' : 'Failed'}
                </div>
              </div>
              {d.state === 'completed' && (
                <>
                  <button className="icon-btn" title="Open" onClick={() => invoke('downloads.openFile', { id: d.id })}>
                    <ExternalLink size={16} strokeWidth={1.9} />
                  </button>
                  <button className="icon-btn" title="Show in Finder" onClick={() => invoke('downloads.reveal', { id: d.id })}>
                    <FolderOpen size={16} strokeWidth={1.9} />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

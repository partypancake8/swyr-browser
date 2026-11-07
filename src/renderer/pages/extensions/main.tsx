// swyr://extensions: installed extensions with on/off, remove, "Load Unpacked" and a link to the store.
import { createRoot } from 'react-dom/client'
import { useState, type ReactNode } from 'react'
import { FolderOpen, Store, Trash2 } from 'lucide-react'
import '../../common/base.css'
import '../page.css'
import '../settings/settings.css'
import { invoke, startViewSync, useView } from '../../common/store'
import { activeSpace, useSpaceTheme } from '../../common/theme'
import type { ExtensionRuntime } from '@shared/types'
import { usePlatformPage } from '../settings/usePlatformPage'
import { Button, Card, Toggle } from '../settings/ui'

function Icon({ ext }: { ext: ExtensionRuntime }): ReactNode {
  if (ext.iconDataUrl) return <img src={ext.iconDataUrl} alt="" width={32} height={32} className="h-8 w-8 shrink-0 rounded-md" draggable={false} />
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--fg)] text-[15px] font-bold text-[var(--content)]">
      {(ext.name || '?').trim().charAt(0).toUpperCase()}
    </span>
  )
}

function ExtensionsPage(): ReactNode {
  const vs = useView((s) => s.vs)
  const space = vs ? activeSpace(vs) : undefined
  useSpaceTheme(space, vs?.systemDark ?? false)
  const [p, refresh] = usePlatformPage(vs)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  if (!vs) return null
  const profiles = vs.state.profiles.filter((x) => !x.incognito)
  const profileName = (id: string): string => profiles.find((x) => x.id === id)?.name ?? 'Unknown profile'
  const list = [...(p?.extensions ?? [])].sort((a, b) => a.name.localeCompare(b.name))
  const run = (cmd: string, payload?: unknown): void => {
    setError(null)
    void invoke(cmd, payload).then((r) => {
      const err = r && typeof r === 'object' && 'error' in r ? String((r as { error: unknown }).error) : null
      if (err) setError(err)
      refresh()
    })
  }
  return (
    <div className="mx-auto max-w-[760px] px-6 py-10">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="flex-1 text-[26px] font-bold">Extensions</h1>
        <Button onClick={() => run('extensions.loadUnpacked')}>
          <span className="flex items-center gap-1.5">
            <FolderOpen size={14} /> Load Unpacked…
          </span>
        </Button>
        <Button kind="primary" onClick={() => run('extensions.openStore')}>
          <span className="flex items-center gap-1.5">
            <Store size={14} /> Chrome Web Store
          </span>
        </Button>
      </div>
      <p className="mb-5 text-[14px]">
        Extensions belong to a profile and run in every space that uses {profiles.length > 1 ? 'that profile' : 'it'}. Extensions with a button show it under the address field in the sidebar.
      </p>
      {error && (
        <div className="mb-4 rounded-xl border border-[var(--card-border)] bg-[var(--card)] px-4 py-3 text-[13px] font-semibold text-[var(--danger)]">{error}</div>
      )}
      {list.length === 0 ? (
        <Card>
          <div className="px-4 py-10 text-center">
            <div className="text-[15px] font-semibold">No extensions yet</div>
            <div className="mt-1 text-[13px]">Open the Chrome Web Store and click Add to swyr, or load an unpacked folder.</div>
          </div>
        </Card>
      ) : (
        <Card>
          {list.map((ext) => (
            <div key={`${ext.profileId}:${ext.id}`} className="flex items-center gap-3 border-b border-[var(--card-border)] px-4 py-3 last:border-b-0">
              <Icon ext={ext} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="truncate text-[14px] font-bold">{ext.name}</span>
                  <span className="shrink-0 text-[12px] font-medium">{ext.version}</span>
                </div>
                {ext.description && <div className="truncate text-[13px]">{ext.description}</div>}
                <div className="mt-0.5 truncate text-[12px] font-medium">
                  {ext.source === 'store' ? 'Chrome Web Store' : 'Unpacked'}
                  {profiles.length > 1 ? ` · ${profileName(ext.profileId)}` : ''} · {ext.id}
                </div>
              </div>
              {confirm === `${ext.profileId}:${ext.id}` ? (
                <>
                  <Button onClick={() => setConfirm(null)}>Keep</Button>
                  <Button
                    kind="danger"
                    onClick={() => {
                      setConfirm(null)
                      run('extensions.remove', { id: ext.id, profileId: ext.profileId })
                    }}
                  >
                    Remove
                  </Button>
                </>
              ) : (
                <button className="icon-btn" title="Remove" onClick={() => setConfirm(`${ext.profileId}:${ext.id}`)}>
                  <Trash2 size={16} strokeWidth={1.9} />
                </button>
              )}
              <Toggle label={ext.enabled ? `Turn off ${ext.name}` : `Turn on ${ext.name}`} on={ext.enabled} onChange={(v) => run('extensions.toggle', { id: ext.id, profileId: ext.profileId, enabled: v })} />
            </div>
          ))}
        </Card>
      )}
    </div>
  )
}

startViewSync()
createRoot(document.getElementById('root')!).render(<ExtensionsPage />)

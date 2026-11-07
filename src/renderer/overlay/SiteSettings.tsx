// Site Settings popover: ad blocking, styles, zoom, permissions, site data, mini window and extensions
// for the active site. Opened from the URL row (siteSettings.open), anchored under it.
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { AppWindow, Bell, Blocks, Camera, ClipboardList, MapPin, Mic, Paintbrush, ShieldCheck, Trash2, ZoomIn } from 'lucide-react'
import type { SiteInfo, SitePermission, ViewState } from '@shared/types'
import { invoke } from '../common/store'
import { Favicon } from '../common/Favicon'
import '../pages/settings/settings.css'
import { Button, Toggle } from '../pages/settings/ui'

const PERMISSION_LABELS: Record<SitePermission, { label: string; icon: typeof Camera }> = {
  camera: { label: 'Camera', icon: Camera },
  microphone: { label: 'Microphone', icon: Mic },
  notifications: { label: 'Notifications', icon: Bell },
  location: { label: 'Location', icon: MapPin },
  clipboard: { label: 'Clipboard', icon: ClipboardList }
}

/** the card frame shared by the URL row popovers, under the URL field */
export function Popover({ vs, width = 340, children, label }: { vs: ViewState; width?: number; children: ReactNode; label: string }): ReactNode {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') void invoke('overlay.close')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const left = vs.window.sidebarVisible ? 10 : 16
  return (
    <div className="fixed inset-0" onMouseDown={(e) => e.target === e.currentTarget && invoke('overlay.close')}>
      <div
        role="dialog"
        aria-label={label}
        className="absolute flex max-h-[calc(100vh-110px)] flex-col overflow-hidden rounded-2xl border border-[var(--card-border)] bg-[var(--card)]"
        style={{ left, top: 90, width, boxShadow: '0 18px 44px rgba(0,0,0,0.22), 0 0 0 1px rgba(0,0,0,0.03)' }}
      >
        {children}
      </div>
    </div>
  )
}

export function SiteHeader({ info, sub }: { info: Pick<SiteInfo, 'favicon' | 'host' | 'title' | 'url'>; sub?: ReactNode }): ReactNode {
  return (
    <div className="flex items-center gap-3 border-b border-[var(--card-border)] px-4 py-3.5">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[var(--select)]">
        <Favicon item={{ url: info.url, favicon: info.favicon }} size={20} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-bold">{info.host || 'This page'}</div>
        <div className="truncate text-[12.5px] font-medium">{sub ?? info.title}</div>
      </div>
    </div>
  )
}

function Group({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }): ReactNode {
  return (
    <div className="border-b border-[var(--card-border)] px-4 py-3 last:border-b-0">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-wide">{title}</span>
        {action}
      </div>
      {children}
    </div>
  )
}

function Line({ icon, label, detail, children }: { icon: ReactNode; label: ReactNode; detail?: ReactNode; children?: ReactNode }): ReactNode {
  return (
    <div className="flex min-h-[36px] items-center gap-2.5 py-1">
      <span className="flex w-5 shrink-0 justify-center">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-semibold">{label}</div>
        {detail && <div className="truncate text-[12px] font-medium">{detail}</div>}
      </div>
      {children}
    </div>
  )
}

export function SiteSettings({ vs }: { vs: ViewState }): ReactNode {
  const [info, setInfo] = useState<SiteInfo | null>(null)
  const refresh = useCallback(() => {
    void invoke('siteSettings.info').then((r) => {
      if (r && typeof r === 'object') setInfo(r as SiteInfo)
    })
  }, [])
  // refetch after every state broadcast (toggles, zoom, recorded permissions)
  useEffect(() => refresh(), [vs, refresh])
  const run = (command: string, payload?: unknown): void => void invoke(command, payload).then(refresh)

  if (!info) return <Popover vs={vs} label="Site Settings"><div className="px-4 py-6 text-[13px]">Loading…</div></Popover>
  if (!info.web) {
    return (
      <Popover vs={vs} label="Site Settings">
        <SiteHeader info={info} sub="swyr page" />
        <div className="px-4 py-4 text-[13px]">Site settings are available on web pages.</div>
      </Popover>
    )
  }
  const isFile = info.url.startsWith('file:')
  const zoomPct = Math.round(Math.pow(1.2, info.zoom) * 100)
  const perms = (Object.keys(info.permissions) as SitePermission[]).filter((p) => PERMISSION_LABELS[p])
  const blocking = info.adblockEnabled && !info.adblockAllowed
  return (
    <Popover vs={vs} label="Site Settings">
      <SiteHeader info={info} sub={isFile ? info.title || 'Local file' : info.url.startsWith('https:') ? 'Secure connection' : 'Not secure'} />
      <div className="min-h-0 overflow-y-auto">
        {!isFile && (
          <Group title="Ad blocking">
            <Line
              icon={<ShieldCheck size={16} strokeWidth={1.9} />}
              label="Block ads and trackers"
              detail={!info.adblockEnabled ? 'The ad blocker is off in Settings' : `${info.blocked} blocked on this page`}
            >
              <Toggle
                label={blocking ? 'Allow ads on this site' : 'Block ads on this site'}
                on={blocking}
                onChange={(v) => (info.adblockEnabled ? run('siteSettings.setAdblock', { allow: !v }) : run('adblock.toggle', { enabled: true }))}
              />
            </Line>
          </Group>
        )}
        <Group
          title="Styles"
          action={
            <button className="rounded-md px-1.5 py-0.5 text-[12px] font-semibold text-[var(--accent)] hover:bg-[var(--select)]" onClick={() => run('style.panel', { show: true })}>
              {info.styles.length ? 'Edit' : 'New style'}
            </button>
          }
        >
          {info.styles.length === 0 ? (
            <Line icon={<Paintbrush size={16} strokeWidth={1.9} />} label="No styles for this site" detail="Change colors, fonts or hide elements" />
          ) : (
            info.styles.map((s) => (
              <Line key={s.id} icon={<Paintbrush size={16} strokeWidth={1.9} />} label={s.hostPattern} detail={describeStyle(s)}>
                <Toggle label={s.enabled ? 'Turn style off' : 'Turn style on'} on={s.enabled} onChange={(v) => run('style.toggle', { id: s.id, enabled: v })} />
              </Line>
            ))
          )}
        </Group>
        <Group title="Zoom">
          <Line icon={<ZoomIn size={16} strokeWidth={1.9} />} label={`${zoomPct}%`} detail={zoomPct === 100 ? 'Actual size' : 'Zoomed for this tab'}>
            <Button onClick={() => run('zoom.out')} title="Zoom out">−</Button>
            <Button onClick={() => run('zoom.in')} title="Zoom in">+</Button>
            <Button disabled={info.zoom === 0} onClick={() => run('zoom.reset')}>Reset</Button>
          </Line>
        </Group>
        <Group title="Permissions">
          {perms.length === 0 ? (
            <div className="py-1.5 text-[13px] font-medium">This site has not asked for any permissions.</div>
          ) : (
            perms.map((p) => {
              const meta = PERMISSION_LABELS[p]
              const Icon = meta.icon
              const allowed = info.permissions[p] === 'allow'
              return (
                <Line key={p} icon={<Icon size={16} strokeWidth={1.9} />} label={meta.label} detail={allowed ? 'Allowed' : 'Blocked'}>
                  {allowed ? (
                    <Button kind="danger" onClick={() => run('siteSettings.setPermission', { origin: info.origin, permission: p, value: 'deny' })}>
                      Revoke
                    </Button>
                  ) : (
                    <Button onClick={() => run('siteSettings.setPermission', { origin: info.origin, permission: p, value: null })}>Reset</Button>
                  )}
                </Line>
              )
            })
          )}
        </Group>
        {!isFile && (
          <Group title="This site">
            <Line icon={<AppWindow size={16} strokeWidth={1.9} />} label="Always open in a mini window" detail="Links from other apps open small">
              <Toggle label="Always open this site in a mini window" on={info.mini} onChange={(v) => run('siteSettings.setMini', { enabled: v })} />
            </Line>
            <Line icon={<Trash2 size={16} strokeWidth={1.9} />} label="Clear cookies and site data for this site">
              <Button kind="danger" onClick={() => run('siteSettings.clearData')}>
                Clear
              </Button>
            </Line>
          </Group>
        )}
        <Group title="Extensions with access">
          {info.extensions.length === 0 ? (
            <div className="py-1.5 text-[13px] font-medium">No extensions in this profile.</div>
          ) : (
            info.extensions.map((e) => (
              <Line
                key={e.id}
                icon={e.iconDataUrl ? <img src={e.iconDataUrl} alt="" width={16} height={16} className="h-4 w-4 rounded-[3px]" /> : <Blocks size={16} strokeWidth={1.9} />}
                label={e.name}
                detail="Can read and change this site"
              />
            ))
          )}
        </Group>
      </div>
    </Popover>
  )
}

export function describeStyle(s: { colors: { bg?: string; fg?: string; accent?: string }; font?: string; fontScale?: number; css: string; js: string; hiddenSelectors: string[] }): string {
  const parts: string[] = []
  if (s.colors.bg || s.colors.fg || s.colors.accent) parts.push('colors')
  if (s.font) parts.push(s.font)
  if (s.fontScale && s.fontScale !== 1) parts.push(`${Math.round(s.fontScale * 100)}% text`)
  if (s.hiddenSelectors.length) parts.push(`${s.hiddenSelectors.length} hidden`)
  if (s.css.trim()) parts.push('CSS')
  if (s.js.trim()) parts.push('JS')
  return parts.join(' · ') || 'Empty style'
}

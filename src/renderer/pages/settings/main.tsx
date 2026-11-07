// swyr://settings: General settings and the shortcut list. More panes arrive later.
import { createRoot } from 'react-dom/client'
import type { ReactNode } from 'react'
import '../../common/base.css'
import '../page.css'
import { invoke, startViewSync, useView } from '../../common/store'
import { activeSpace, useSpaceTheme } from '../../common/theme'
import { COMMAND_TITLES, acceleratorLabel, resolveBindings } from '@shared/commands'
import type { ArchiveAfter } from '@shared/types'

const ENGINES = [
  { name: 'Google', url: 'https://www.google.com/search?q=%s' },
  { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s' },
  { name: 'Bing', url: 'https://www.bing.com/search?q=%s' },
  { name: 'Kagi', url: 'https://kagi.com/search?q=%s' }
]

const ARCHIVE: { value: ArchiveAfter; label: string }[] = [
  { value: '12h', label: '12 hours' },
  { value: '24h', label: '24 hours' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: 'never', label: 'Never' }
]

function Row({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-[var(--card-border)] px-4 py-3 last:border-b-0">
      <div className="text-[14px] font-medium">{label}</div>
      {children}
    </div>
  )
}

function SettingsPage(): ReactNode {
  const vs = useView((s) => s.vs)
  const space = vs ? activeSpace(vs) : undefined
  useSpaceTheme(space, vs?.systemDark ?? false)
  if (!vs) return null
  const s = vs.state.settings
  const select = 'rounded-lg bg-[var(--select)] px-2 py-1 text-[13px] font-medium outline-none'
  return (
    <div className="mx-auto max-w-[720px] px-6 py-10">
      <h1 className="mb-6 text-[26px] font-bold">Settings</h1>
      <h2 className="mb-2 text-[13px] font-bold uppercase tracking-wide">General</h2>
      <div className="mb-8 overflow-hidden rounded-xl border border-[var(--card-border)]">
        <Row label="Archive Today tabs after">
          <select className={select} value={s.archiveAfter} onChange={(e) => invoke('settings.set', { archiveAfter: e.target.value })}>
            {ARCHIVE.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Search engine">
          <select className={select} value={s.searchEngine} onChange={(e) => invoke('settings.set', { searchEngine: e.target.value })}>
            {ENGINES.map((e) => (
              <option key={e.url} value={e.url}>
                {e.name}
              </option>
            ))}
          </select>
        </Row>
      </div>
      <h2 className="mb-2 text-[13px] font-bold uppercase tracking-wide">Keyboard shortcuts</h2>
      <div className="mb-8 overflow-hidden rounded-xl border border-[var(--card-border)]">
        {resolveBindings(s.shortcuts).map((b) => (
          <Row key={b.id} label={`${COMMAND_TITLES[b.command] ?? b.command}${b.payload ? ' ' + describe(b.payload) : ''}`}>
            <kbd className="rounded-md bg-[var(--select)] px-2 py-0.5 text-[13px] font-semibold">{acceleratorLabel(b.accelerator)}</kbd>
          </Row>
        ))}
      </div>
      <p className="text-[13px]">swyr is open source under the MIT license.</p>
    </div>
  )
}

function describe(payload: unknown): string {
  const p = payload as { index?: number; mode?: string }
  if (typeof p.index === 'number') return String(p.index + 1)
  if (p.mode) return `(${p.mode === 'new' ? 'new tab' : 'current tab'})`
  return ''
}

startViewSync()
createRoot(document.getElementById('root')!).render(<SettingsPage />)

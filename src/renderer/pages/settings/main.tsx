// swyr://settings: General, Profiles, Link Rules, Shortcuts, Extensions and Advanced panes.
import { createRoot } from 'react-dom/client'
import { useEffect, useState, type ReactNode } from 'react'
import { Blocks, Keyboard, Route, Settings2, Users, Wrench } from 'lucide-react'
import '../../common/base.css'
import '../page.css'
import './settings.css'
import { invoke, startViewSync, useView } from '../../common/store'
import { activeSpace, useSpaceTheme } from '../../common/theme'
import { sortedSpaces } from '@shared/ops'
import type { Appearance, ArchiveAfter, PlatformRuntime, ViewState } from '@shared/types'
import { usePlatformPage } from './usePlatformPage'
import { Button, Row, Section, Toggle, inputClass, selectClass } from './ui'
import { AdvancedPane } from './ImportPane'
import { ShortcutsPane } from './ShortcutsPane'

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

const PANES = [
  { id: 'general', label: 'General', icon: Settings2 },
  { id: 'profiles', label: 'Profiles', icon: Users },
  { id: 'linkrules', label: 'Link Rules', icon: Route },
  { id: 'shortcuts', label: 'Shortcuts', icon: Keyboard },
  { id: 'extensions', label: 'Extensions', icon: Blocks },
  { id: 'advanced', label: 'Advanced', icon: Wrench }
] as const
type PaneId = (typeof PANES)[number]['id']

const set = (patch: Record<string, unknown>): Promise<unknown> => invoke('settings.set', patch)

function currentPane(): PaneId {
  const h = location.hash.replace('#', '')
  return (PANES.find((p) => p.id === h)?.id ?? 'general') as PaneId
}

function tildify(p: string): string {
  return p.replace(/^\/Users\/[^/]+/, '~')
}

// ----- General

function GeneralPane({ vs, p }: { vs: ViewState; p: PlatformRuntime | null }): ReactNode {
  const s = vs.state.settings
  const [host, setHost] = useState('')
  const [width, setWidth] = useState(String(s.sidebarWidth))
  useEffect(() => setWidth(String(s.sidebarWidth)), [s.sidebarWidth])
  const allow = s.adblockAllow ?? []
  const addHost = (): void => {
    const h = host.trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/\/.*$/, '')
    if (!h) return
    void set({ adblockAllow: [...allow, h] })
    setHost('')
  }
  return (
    <>
      <Section title="Browsing">
        <Row label="Archive Today tabs after" detail="Today tabs you have not opened in this long move to the Archive.">
          <select className={selectClass} value={s.archiveAfter} onChange={(e) => set({ archiveAfter: e.target.value })}>
            {ARCHIVE.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Search engine">
          <select className={selectClass} value={s.searchEngine} onChange={(e) => set({ searchEngine: e.target.value })}>
            {ENGINES.map((e) => (
              <option key={e.url} value={e.url}>
                {e.name}
              </option>
            ))}
            {!ENGINES.some((e) => e.url === s.searchEngine) && <option value={s.searchEngine}>Custom</option>}
          </select>
        </Row>
        <Row label="Picture in Picture" detail="Videos keep playing in a floating window when you switch tabs.">
          <Toggle label="Picture in Picture automatically" on={s.pipAuto} onChange={(v) => set({ pipAuto: v })} />
        </Row>
        <Row label="Open links from other apps in a Mini Window" detail="Links without a Link Rule open in a small window instead of the current space.">
          <Toggle label="Open external links in a Mini Window" on={s.openExternalLinksInMiniWindow} onChange={(v) => set({ openExternalLinksInMiniWindow: v })} />
        </Row>
      </Section>

      <Section title="Appearance">
        <Row label="Theme" detail="Each space can also pick its own in the space editor.">
          <select className={selectClass} value={s.appearance} onChange={(e) => set({ appearance: e.target.value as Appearance })}>
            <option value="auto">Match system</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </Row>
        <Row label="Sidebar width" detail="200 to 400 points. You can also drag the sidebar edge.">
          <input
            className={`${inputClass} w-20 text-right`}
            type="number"
            min={200}
            max={400}
            step={10}
            value={width}
            onChange={(e) => setWidth(e.target.value)}
            onBlur={() => set({ sidebarWidth: Number(width) || 260 })}
            onKeyDown={(e) => e.key === 'Enter' && set({ sidebarWidth: Number(width) || 260 })}
          />
        </Row>
      </Section>

      <Section title="Ad blocking">
        <Row
          label="Block ads and trackers"
          detail={
            p
              ? `${p.adblockLists === 'full' ? 'EasyList and EasyPrivacy' : 'Built-in starter list (full lists load when online)'} · ${p.adblockStats.blocked} blocked since launch`
              : 'EasyList and EasyPrivacy'
          }
        >
          <Toggle label="Block ads and trackers" on={s.adblock !== false} onChange={(v) => set({ adblock: v })} />
        </Row>
        <Row label="Sites allowed to show ads" detail={allow.length ? undefined : 'None yet. Ads are blocked everywhere.'}>
          <input
            className={`${inputClass} w-44`}
            placeholder="example.com"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addHost()}
          />
          <Button onClick={addHost}>
            Allow
          </Button>
        </Row>
        {allow.map((h) => (
          <Row key={h} label={h}>
            <Button onClick={() => set({ adblockAllow: allow.filter((x) => x !== h) })}>Remove</Button>
          </Row>
        ))}
      </Section>

      <Section title="Downloads">
        <Row label="Save downloads to" detail={p ? tildify(p.downloadDirectory) : ''}>
          <Button onClick={() => invoke('downloads.setDirectory')}>Change…</Button>
        </Row>
      </Section>

      <Section title="Default browser">
        <Row
          label={p?.defaultBrowser ? 'swyr is your default browser' : 'swyr is not your default browser'}
          detail="Links from other apps open in swyr and follow your Link Rules."
        >
          {!p?.defaultBrowser && (
            <Button kind="primary" onClick={() => invoke('browser.makeDefault')}>
              Make swyr the default browser
            </Button>
          )}
        </Row>
      </Section>
    </>
  )
}

// ----- Profiles

function ProfilesPane({ vs }: { vs: ViewState }): ReactNode {
  const profiles = vs.state.profiles.filter((x) => !x.incognito)
  const spaces = sortedSpaces(vs.state).filter((x) => !x.incognito)
  const [name, setName] = useState('')
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  const create = (): void => {
    if (!name.trim()) return
    void invoke('profile.new', { name: name.trim() })
    setName('')
  }
  return (
    <Section
      title="Your profiles"
      note="Each profile has its own cookies, logins, history, extensions and Favorites. Pick a space's profile in the space editor or below."
    >
      {profiles.map((pr) => {
        const used = spaces.filter((sp) => sp.profileId === pr.id)
        return (
          <Row
            key={pr.id}
            label={
              editing?.id === pr.id ? (
                <input
                  autoFocus
                  className={`${inputClass} w-56`}
                  value={editing.name}
                  onChange={(e) => setEditing({ id: pr.id, name: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      void invoke('profile.rename', { id: pr.id, name: editing.name })
                      setEditing(null)
                    }
                    if (e.key === 'Escape') setEditing(null)
                  }}
                />
              ) : (
                pr.name
              )
            }
            detail={used.length ? `Used by ${used.map((sp) => `${sp.emoji ? sp.emoji + ' ' : ''}${sp.name}`).join(', ')}` : 'No spaces use this profile yet.'}
          >
            {editing?.id === pr.id ? (
              <Button
                onClick={() => {
                  void invoke('profile.rename', { id: pr.id, name: editing.name })
                  setEditing(null)
                }}
              >
                Save
              </Button>
            ) : (
              <Button onClick={() => setEditing({ id: pr.id, name: pr.name })}>Rename</Button>
            )}
            {confirm === pr.id ? (
              <>
                <Button onClick={() => setConfirm(null)}>Keep</Button>
                <Button
                  kind="danger"
                  onClick={() => {
                    setConfirm(null)
                    void invoke('profile.delete', { id: pr.id })
                  }}
                >
                  Delete
                </Button>
              </>
            ) : (
              <Button kind="danger" className={profiles.length < 2 ? 'invisible' : ''} onClick={() => setConfirm(pr.id)}>
                Delete…
              </Button>
            )}
          </Row>
        )
      })}
      <Row label="New profile">
        <input className={`${inputClass} w-44`} placeholder="Work" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} />
        <Button kind="primary" onClick={create}>
          Add
        </Button>
      </Row>
      <div className="border-t border-[var(--card-border)] px-4 py-3">
        <div className="mb-2 text-[14px] font-semibold">Spaces</div>
        {spaces.map((sp) => (
          <div key={sp.id} className="flex items-center justify-between gap-3 py-1">
            <span className="text-[13px] font-medium">
              {sp.emoji ? sp.emoji + ' ' : ''}
              {sp.name}
            </span>
            <select className={selectClass} value={sp.profileId} onChange={(e) => invoke('space.edit', { id: sp.id, profileId: e.target.value })}>
              {profiles.map((pr) => (
                <option key={pr.id} value={pr.id}>
                  {pr.name}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
    </Section>
  )
}

// ----- Link Rules

function LinkRulesPane({ vs }: { vs: ViewState }): ReactNode {
  const spaces = sortedSpaces(vs.state).filter((x) => !x.incognito)
  const rules = vs.state.settings.linkRules
  const [pattern, setPattern] = useState('')
  const [spaceId, setSpaceId] = useState(spaces[0]?.id ?? '')
  const add = (): void => {
    if (!pattern.trim() || !spaceId) return
    void invoke('linkRules.add', { pattern: pattern.trim(), spaceId })
    setPattern('')
  }
  const spaceName = (id: string): string => {
    const sp = spaces.find((x) => x.id === id)
    return sp ? `${sp.emoji ? sp.emoji + ' ' : ''}${sp.name}` : 'a deleted space'
  }
  return (
    <Section
      title="Rules"
      note="Links you open from other apps go to the space that matches. Use a site like github.com (subdomains included), or a pattern like *.google.com or github.com/my-org/*."
    >
      {rules.length === 0 && <Row label="No rules yet" detail="Without a rule, links open in the space you are in." />}
      {rules.map((r) => (
        <Row key={r.id ?? r.pattern} label={r.pattern} detail={`Opens in ${spaceName(r.spaceId)}`}>
          <Button onClick={() => invoke('linkRules.remove', { id: r.id, pattern: r.pattern })}>Remove</Button>
        </Row>
      ))}
      <Row label="New rule">
        <input className={`${inputClass} w-44`} placeholder="github.com" value={pattern} onChange={(e) => setPattern(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <select className={selectClass} value={spaceId} onChange={(e) => setSpaceId(e.target.value)}>
          {spaces.map((sp) => (
            <option key={sp.id} value={sp.id}>
              {sp.emoji ? sp.emoji + ' ' : ''}
              {sp.name}
            </option>
          ))}
        </select>
        <Button kind="primary" onClick={add}>
          Add
        </Button>
      </Row>
    </Section>
  )
}

// ----- Extensions

function ExtensionsPane({ p }: { p: PlatformRuntime | null }): ReactNode {
  const list = p?.extensions ?? []
  return (
    <Section title="Installed" note="swyr runs Chrome extensions. Install them from the Chrome Web Store or load an unpacked folder.">
      <Row label="Installed extensions" detail={list.length ? `${list.length} installed, ${list.filter((e) => e.enabled).length} on` : 'None yet.'}>
        <Button kind="primary" onClick={() => invoke('extensions.open')}>
          Manage Extensions
        </Button>
      </Row>
      <Row label="Chrome Web Store" detail="Open the store in a tab and click Add to swyr on any extension.">
        <Button onClick={() => invoke('extensions.openStore')}>Open Store</Button>
      </Row>
    </Section>
  )
}

// ----- page

function SettingsPage(): ReactNode {
  const vs = useView((s) => s.vs)
  const space = vs ? activeSpace(vs) : undefined
  useSpaceTheme(space, vs?.systemDark ?? false)
  const [pane, setPane] = useState<PaneId>(currentPane)
  const [p] = usePlatformPage(vs)
  useEffect(() => {
    const onHash = (): void => setPane(currentPane())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  if (!vs) return null
  return (
    <div className="mx-auto flex max-w-[980px] gap-8 px-6 py-10">
      <nav className="w-[190px] shrink-0">
        <h1 className="mb-5 px-2 text-[24px] font-bold">Settings</h1>
        {PANES.map((x) => {
          const Icon = x.icon
          const on = x.id === pane
          return (
            <button
              key={x.id}
              className={`mb-0.5 flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[14px] ${on ? 'bg-[var(--nav-active)] font-bold' : 'font-medium hover:bg-[var(--select)]'}`}
              onClick={() => {
                history.replaceState(null, '', `#${x.id}`)
                setPane(x.id)
              }}
            >
              <Icon size={16} strokeWidth={2} />
              {x.label}
            </button>
          )
        })}
        <p className="mt-6 px-2 text-[12px]">swyr is open source under the MIT license.</p>
      </nav>
      <main className="min-w-0 flex-1 pt-1">
        <h2 className="mb-5 text-[20px] font-bold">{PANES.find((x) => x.id === pane)?.label}</h2>
        {pane === 'general' && <GeneralPane vs={vs} p={p} />}
        {pane === 'profiles' && <ProfilesPane vs={vs} />}
        {pane === 'linkrules' && <LinkRulesPane vs={vs} />}
        {pane === 'shortcuts' && <ShortcutsPane vs={vs} />}
        {pane === 'extensions' && <ExtensionsPane p={p} />}
        {pane === 'advanced' && <AdvancedPane />}
      </main>
    </div>
  )
}

startViewSync()
createRoot(document.getElementById('root')!).render(<SettingsPage />)

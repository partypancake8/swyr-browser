// swyr://settings: General, Profiles, Link Rules, Shortcuts, Extensions and Advanced panes.
import { SpaceIcon } from '../../common/SpaceIcon'
import { createRoot } from 'react-dom/client'
import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Blocks, Keyboard, Route, Search, Settings2, Users, Wrench } from 'lucide-react'
import '../../common/base.css'
import '../page.css'
import './settings.css'
import { invoke, startViewSync, useView } from '../../common/store'
import { activeSpace, useSpaceTheme } from '../../common/theme'
import { sortedSpaces } from '@shared/ops'
import type { Appearance, ArchiveAfter, PlatformRuntime, Space, UpdateRuntime, ViewState } from '@shared/types'
import { usePlatformPage } from './usePlatformPage'
import { Button, Card, Row, Section, Toggle, inputClass, selectClass } from './ui'
import { searchSettings, type PaneId, type SettingEntry } from './search'
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
] as const satisfies readonly { id: PaneId; label: string; icon: unknown }[]
const paneLabel = (id: PaneId): string => PANES.find((x) => x.id === id)?.label ?? id

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
        <Row setting="archiveAfter" label="Archive Today tabs after" detail="Today tabs you have not opened in this long move to the Archive.">
          <select className={selectClass} value={s.archiveAfter} onChange={(e) => set({ archiveAfter: e.target.value })}>
            {ARCHIVE.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
        </Row>
        <Row setting="searchEngine" label="Search engine">
          <select className={selectClass} value={s.searchEngine} onChange={(e) => set({ searchEngine: e.target.value })}>
            {ENGINES.map((e) => (
              <option key={e.url} value={e.url}>
                {e.name}
              </option>
            ))}
            {!ENGINES.some((e) => e.url === s.searchEngine) && <option value={s.searchEngine}>Custom</option>}
          </select>
        </Row>
        <Row setting="pipAuto" label="Picture in Picture" detail="Videos keep playing in a floating window when you switch tabs.">
          <Toggle label="Picture in Picture automatically" on={s.pipAuto} onChange={(v) => set({ pipAuto: v })} />
        </Row>
        <Row setting="openExternalLinksInMiniWindow" label="Open links from other apps in a Mini Window" detail="Links without a Link Rule open in a small window instead of the current space.">
          <Toggle label="Open external links in a Mini Window" on={s.openExternalLinksInMiniWindow} onChange={(v) => set({ openExternalLinksInMiniWindow: v })} />
        </Row>
      </Section>

      <Section title="Appearance">
        <Row setting="appearance" label="Theme" detail="Each space can also pick its own in the space editor.">
          <select className={selectClass} value={s.appearance} onChange={(e) => set({ appearance: e.target.value as Appearance })}>
            <option value="auto">Match system</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </Row>
        <Row setting="sidebarWidth" label="Sidebar width" detail="200 to 400 points. You can also drag the sidebar edge.">
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
          setting="adblock"
          label="Block ads and trackers"
          detail={
            p
              ? `${p.adblockLists === 'full' ? 'EasyList and EasyPrivacy' : 'Built-in starter list (full lists load when online)'} · ${p.adblockStats.blocked} blocked since launch`
              : 'EasyList and EasyPrivacy'
          }
        >
          <Toggle label="Block ads and trackers" on={s.adblock !== false} onChange={(v) => set({ adblock: v })} />
        </Row>
        <Row setting="adblockAllow" label="Sites allowed to show ads" detail={allow.length ? undefined : 'None yet. Ads are blocked everywhere.'}>
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
        <Row setting="downloadDirectory" label="Save downloads to" detail={p ? tildify(p.downloadDirectory) : ''}>
          <Button onClick={() => invoke('downloads.setDirectory')}>Change…</Button>
        </Row>
      </Section>

      <UpdatesSection p={p} />

      <Section title="Default browser">
        <Row
          setting="defaultBrowser"
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

// ----- Updates (round 7)

function updateDetail(u: UpdateRuntime): string {
  const when = u.checkedAt ? `Last checked ${new Date(u.checkedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}.` : 'Not checked yet.'
  if (u.status === 'local') return 'Updates are installed locally: this copy was built and installed by hand, so it does not check for new versions.'
  const state =
    u.status === 'checking'
      ? 'Checking now.'
      : u.status === 'upToDate'
        ? 'This is the newest version.'
        : u.status === 'available'
          ? `swyr ${u.version} is available.${u.error ? ' ' + u.error : ''}`
          : u.status === 'downloading'
            ? `Downloading swyr ${u.version}${typeof u.percent === 'number' ? `, ${u.percent}%` : ''}.`
            : u.status === 'ready'
              ? `swyr ${u.version} is ready. Restart to update.`
              : u.status === 'error'
                ? u.error || 'The last check failed.'
                : ''
  return [state, when].filter(Boolean).join(' ')
}

function UpdatesSection({ p }: { p: PlatformRuntime | null }): ReactNode {
  const u = p?.update
  return (
    <Section
      title="Updates"
      note={u?.status === 'local' ? 'This copy of swyr was installed locally.' : 'swyr checks for a new version 20 seconds after it starts and every 2 hours, downloads it, and installs it when you quit.'}
    >
      <Row setting="updates" label={u ? `swyr ${u.current}` : 'swyr'} detail={u ? updateDetail(u) : ''}>
        {u?.version && u.status !== 'ready' && <Button onClick={() => invoke('update.openReleaseNotes')}>Release notes</Button>}
        {u?.status === 'local' ? (
          <Button disabled>Installed locally</Button>
        ) : u?.status === 'ready' ? (
          <Button kind="primary" onClick={() => invoke('update.install')}>
            Restart to update
          </Button>
        ) : (
          <Button kind="primary" disabled={u?.status === 'checking' || u?.status === 'downloading'} onClick={() => invoke('update.check')}>
            Check for updates
          </Button>
        )}
      </Row>
    </Section>
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
      setting="profiles"
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
            detail={used.length ? `Used by ${used.map((sp) => sp.name).join(', ')}` : 'No spaces use this profile yet.'}
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
      <Row setting="profileNew" label="New profile">
        <input className={`${inputClass} w-44`} placeholder="Work" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} />
        <Button kind="primary" onClick={create}>
          Add
        </Button>
      </Row>
      <div data-setting="profileSpaces" className="border-t border-[var(--card-border)] px-4 py-3">
        <div className="mb-2 text-[14px] font-semibold">Spaces</div>
        {spaces.map((sp) => (
          <div key={sp.id} className="flex items-center justify-between gap-3 py-1">
            <span className="flex items-center gap-1.5 text-[13px] font-medium">
              <SpaceIcon name={sp.icon} size={14} />
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
  const [editing, setEditing] = useState<string | null>(null)
  const spaceName = (id: string): string => {
    const sp = spaces.find((x) => x.id === id)
    return sp ? sp.name : 'a deleted space'
  }
  const label = (r: { pattern: string; sourceApp?: string }): string =>
    r.pattern && r.sourceApp ? `${r.pattern} from ${r.sourceApp}` : r.pattern || `Any link from ${r.sourceApp}`
  return (
    <Section
      setting="linkRules"
      title="Rules"
      note="Links you open from other apps go to the space that matches. Use a site like github.com (subdomains included), or a pattern like *.google.com or github.com/my-org/*. A rule can also name the app the link came from, like Slack or Mail; swyr takes the app that was in front when the link arrived as its source."
    >
      {rules.length === 0 && <Row label="No rules yet" detail="Without a rule, links open in the space you are in." />}
      {rules.map((r) =>
        editing === r.id ? (
          <RuleEditor
            key={r.id}
            spaces={spaces}
            initial={{ pattern: r.pattern, sourceApp: r.sourceApp ?? '', spaceId: r.spaceId }}
            submitLabel="Save"
            onSubmit={(v) => {
              void invoke('linkRules.update', { id: r.id, ...v })
              setEditing(null)
            }}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <Row key={r.id ?? r.pattern} label={label(r)} detail={`Opens in ${spaceName(r.spaceId)}`}>
            {!r.mini && <Button onClick={() => setEditing(r.id)}>Edit</Button>}
            <Button onClick={() => invoke('linkRules.remove', { id: r.id, pattern: r.pattern })}>Remove</Button>
          </Row>
        )
      )}
      <RuleEditor spaces={spaces} initial={{ pattern: '', sourceApp: '', spaceId: spaces[0]?.id ?? '' }} submitLabel="Add" onSubmit={(v) => void invoke('linkRules.add', v)} />
    </Section>
  )
}

interface RuleFields {
  pattern: string
  sourceApp: string
  spaceId: string
}

function RuleEditor(props: { spaces: Space[]; initial: RuleFields; submitLabel: string; onSubmit: (v: RuleFields) => void; onCancel?: () => void }): ReactNode {
  const { spaces, initial } = props
  const [pattern, setPattern] = useState(initial.pattern)
  const [sourceApp, setSourceApp] = useState(initial.sourceApp)
  const [spaceId, setSpaceId] = useState(initial.spaceId)
  const submit = (): void => {
    if ((!pattern.trim() && !sourceApp.trim()) || !spaceId) return
    props.onSubmit({ pattern: pattern.trim(), sourceApp: sourceApp.trim(), spaceId })
    if (!props.onCancel) {
      setPattern('')
      setSourceApp('')
    }
  }
  const key = (e: KeyboardEvent): void => {
    if (e.key === 'Enter') submit()
    if (e.key === 'Escape') props.onCancel?.()
  }
  return (
    <Row setting={props.onCancel ? undefined : 'linkRuleNew'} label={props.onCancel ? 'Edit rule' : 'New rule'}>
      <input className={`${inputClass} w-36`} placeholder="github.com" aria-label="Site" value={pattern} onChange={(e) => setPattern(e.target.value)} onKeyDown={key} />
      <input className={`${inputClass} w-28`} placeholder="From app" aria-label="Source app" data-testid="rule-source-app" value={sourceApp} onChange={(e) => setSourceApp(e.target.value)} onKeyDown={key} />
      <select className={selectClass} value={spaceId} onChange={(e) => setSpaceId(e.target.value)}>
        {spaces.map((sp) => (
          <option key={sp.id} value={sp.id}>
            {sp.name}
          </option>
        ))}
      </select>
      <Button kind="primary" onClick={submit}>
        {props.submitLabel}
      </Button>
      {props.onCancel && <Button onClick={props.onCancel}>Cancel</Button>}
    </Row>
  )
}

// ----- Extensions

function ExtensionsPane({ p }: { p: PlatformRuntime | null }): ReactNode {
  const list = p?.extensions ?? []
  return (
    <Section title="Installed" note="swyr runs Chrome extensions. Install them from the Chrome Web Store or load an unpacked folder.">
      <Row setting="extensionsInstalled" label="Installed extensions" detail={list.length ? `${list.length} installed, ${list.filter((e) => e.enabled).length} on` : 'None yet.'}>
        <Button kind="primary" onClick={() => invoke('extensions.open')}>
          Manage Extensions
        </Button>
      </Row>
      <Row setting="extensionsStore" label="Chrome Web Store" detail="Open the store in a tab and click Add to swyr on any extension.">
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
  const [query, setQuery] = useState('')
  const [target, setTarget] = useState<{ id: string; n: number } | null>(null)
  const results = useMemo(() => searchSettings(query, paneLabel), [query])
  useEffect(() => {
    const onHash = (): void => setPane(currentPane())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  // after a result is picked: wait for its row (the Shortcuts list loads async), scroll to it and flash it
  useEffect(() => {
    if (!target) return
    let tries = 0
    let timer = 0
    const find = (): void => {
      const el = document.querySelector<HTMLElement>(`[data-setting="${CSS.escape(target.id)}"]`)
      if (!el) {
        if (++tries < 40) timer = window.setTimeout(find, 50)
        return
      }
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
      el.classList.remove('setting-flash')
      void el.offsetWidth
      el.classList.add('setting-flash')
      timer = window.setTimeout(() => el.classList.remove('setting-flash'), 1800)
    }
    find()
    return () => window.clearTimeout(timer)
  }, [target])
  const openPane = (id: PaneId): void => {
    history.replaceState(null, '', `#${id}`)
    setPane(id)
  }
  const pick = (e: SettingEntry): void => {
    setQuery('')
    openPane(e.pane)
    setTarget((t) => ({ id: e.id, n: (t?.n ?? 0) + 1 }))
  }
  if (!vs) return null
  const searching = query.trim() !== ''
  return (
    <div className="mx-auto flex max-w-[980px] gap-8 px-6 py-10">
      <nav className="w-[190px] shrink-0">
        <h1 className="mb-4 px-2 text-[24px] font-bold">Settings</h1>
        <label className={`mb-4 flex items-center gap-2 ${inputClass}`}>
          <Search size={14} className="shrink-0" />
          <input
            data-settings-search
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-(color:--fg) placeholder:opacity-75"
            placeholder="Search settings"
            aria-label="Search settings"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setQuery('')
              if (e.key === 'Enter' && results[0]) pick(results[0])
            }}
          />
        </label>
        {PANES.map((x) => {
          const Icon = x.icon
          const on = !searching && x.id === pane
          return (
            <button
              key={x.id}
              className={`mb-0.5 flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[14px] ${on ? 'bg-[var(--nav-active)] font-bold' : 'font-medium hover:bg-[var(--select)]'}`}
              onClick={() => {
                setQuery('')
                openPane(x.id)
              }}
            >
              <Icon size={16} strokeWidth={2} />
              {x.label}
            </button>
          )
        })}
        <p className="mt-6 px-2 text-[12px]">swyr is open source under the MIT license.</p>
      </nav>
      {searching ? (
        <main className="min-w-0 flex-1 pt-1">
          <h2 className="mb-5 text-[20px] font-bold">{results.length ? `${results.length} ${results.length === 1 ? 'match' : 'matches'}` : 'No matches'}</h2>
          {results.length === 0 ? (
            <p className="text-[13px]">Nothing in settings matches “{query.trim()}”. Try a word like archive, theme or shortcut.</p>
          ) : (
            <Card>
              {results.map((e) => (
                <button
                  key={e.id}
                  data-settings-result={e.id}
                  className="flex min-h-[52px] w-full items-center justify-between gap-4 border-b border-[var(--card-border)] px-4 py-2.5 text-left last:border-b-0 hover:bg-[var(--select)]"
                  onClick={() => pick(e)}
                >
                  <span className="min-w-0">
                    <span className="block text-[14px] font-semibold">{e.label}</span>
                    {e.detail && <span className="mt-0.5 block text-[12.5px] leading-snug">{e.detail}</span>}
                  </span>
                  <span className="shrink-0 rounded-md bg-[var(--select)] px-2 py-0.5 text-[12px] font-semibold">{paneLabel(e.pane)}</span>
                </button>
              ))}
            </Card>
          )}
        </main>
      ) : (
        <main className="min-w-0 flex-1 pt-1" data-settings-pane={pane}>
          <h2 className="mb-5 text-[20px] font-bold">{paneLabel(pane)}</h2>
          {pane === 'general' && <GeneralPane vs={vs} p={p} />}
          {pane === 'profiles' && <ProfilesPane vs={vs} />}
          {pane === 'linkrules' && <LinkRulesPane vs={vs} />}
          {pane === 'shortcuts' && <ShortcutsPane vs={vs} />}
          {pane === 'extensions' && <ExtensionsPane p={p} />}
          {pane === 'advanced' && <AdvancedPane />}
        </main>
      )}
    </div>
  )
}

startViewSync()
createRoot(document.getElementById('root')!).render(<SettingsPage />)

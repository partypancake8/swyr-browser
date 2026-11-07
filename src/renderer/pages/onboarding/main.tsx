// swyr://onboarding: the first-run guide. Five steps: Welcome, Import, Make it yours, Defaults, Done.
// Nothing is applied until "Start browsing" (onboarding.complete), except imports and the default browser.
import { createRoot } from 'react-dom/client'
import { useState, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight, Bookmark, Check, Columns2, Command, Download, Layers, Minus, PanelLeft, Plus, Shield, Sparkles } from 'lucide-react'
import '../../common/base.css'
import './onboarding.css'
import { invoke, startViewSync, useView } from '../../common/store'
import { SpaceBackground, activeSpace, useSpaceTheme } from '../../common/theme'
import { gradientCss, isDark } from '@shared/theme'
import { acceleratorLabel, resolveBindings } from '@shared/commands'
import { IMPORT_FROM_LABEL, NOT_AFFILIATED } from '@shared/importer'
import type { ArchiveAfter, Space, SpaceTheme } from '@shared/types'
import { Toggle } from '../settings/ui'

/** eight original two-colour presets (none of them a copy of another browser's palette) */
const ONBOARDING_PRESETS: { name: string; colors: string[] }[] = [
  { name: 'Dune', colors: ['#F3D9B1', '#E9B48A'] },
  { name: 'Lagoon', colors: ['#BFE3DA', '#9CC9E8'] },
  { name: 'Orchard', colors: ['#D9EDC2', '#F4E3A1'] },
  { name: 'Heather', colors: ['#E2D5EE', '#C9D6F2'] },
  { name: 'Clay', colors: ['#EBC7B5', '#D9DCC4'] },
  { name: 'Glacier', colors: ['#D6EEF2', '#E8E6F7'] },
  { name: 'Moss', colors: ['#C9DDBE', '#A9CBB7'] },
  { name: 'Citrus', colors: ['#F7E6A6', '#F2C49B'] }
]

const ARCHIVE: { value: ArchiveAfter; label: string }[] = [
  { value: '12h', label: '12 hours' },
  { value: '24h', label: '1 day' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: 'never', label: 'Never' }
]

const STEPS = ['Welcome', 'Import', 'Make it yours', 'Defaults', 'Done'] as const

type ImportResult = { error?: string; spaces?: number; bookmarks?: number; pinned?: number } | null

function Card({ children, className = '' }: { children: ReactNode; className?: string }): ReactNode {
  return (
    <div className={`rounded-2xl border border-[var(--card-border)] bg-[var(--card)] p-8 ${className}`} style={{ boxShadow: 'var(--shadow)' }}>
      {children}
    </div>
  )
}

function Primary(props: { onClick: () => void; children: ReactNode; disabled?: boolean }): ReactNode {
  return (
    <button
      disabled={props.disabled}
      onClick={props.onClick}
      className="flex h-10 items-center gap-2 rounded-xl bg-[var(--fg)] px-5 text-[14px] font-semibold text-[var(--content)] hover:brightness-110 disabled:opacity-50"
    >
      {props.children}
    </button>
  )
}

function Plain(props: { onClick: () => void; children: ReactNode; disabled?: boolean }): ReactNode {
  return (
    <button
      disabled={props.disabled}
      onClick={props.onClick}
      className="flex h-10 items-center gap-2 rounded-xl bg-[var(--select)] px-4 text-[14px] font-semibold hover:brightness-95 disabled:opacity-50"
    >
      {props.children}
    </button>
  )
}

// ----- step 1

function Welcome(): ReactNode {
  const points = [
    { icon: PanelLeft, title: 'Tabs in a sidebar', text: 'Pinned tabs stay put. Today tabs tidy themselves into the Archive when you stop using them.' },
    { icon: Layers, title: 'Spaces', text: 'One space per part of your life, each with its own colours, tabs and profile.' },
    { icon: Command, title: 'Command Bar', text: 'One field for tabs, history, commands and search.' },
    { icon: Columns2, title: 'Split View', text: 'Up to four pages side by side in one tab.' }
  ]
  return (
    <>
      <div className="mb-1 text-[14px] font-bold uppercase tracking-wide">Welcome</div>
      <h1 className="mb-3 text-[34px] font-bold leading-tight tracking-tight">This is swyr.</h1>
      <p className="mb-6 max-w-[560px] text-[16px] leading-relaxed">
        A calm browser for people who keep a lot open. swyr is free and open source under the MIT license: no account, nothing to sign in to, and your data stays on this Mac.
      </p>
      <div className="grid grid-cols-2 gap-3">
        {points.map((p) => (
          <div key={p.title} className="flex gap-3 rounded-xl bg-[var(--select)] p-4">
            <p.icon size={20} strokeWidth={2} className="mt-0.5 shrink-0" />
            <div>
              <div className="text-[14px] font-bold">{p.title}</div>
              <div className="mt-0.5 text-[13px] leading-snug">{p.text}</div>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

// ----- step 2

function ImportStep(): ReactNode {
  const [busy, setBusy] = useState<string | null>(null)
  const [sidebar, setSidebar] = useState<ImportResult>(null)
  const [chrome, setChrome] = useState<ImportResult>(null)
  const run = async (command: string, set: (r: ImportResult) => void): Promise<void> => {
    setBusy(command)
    try {
      set((await invoke(command)) as ImportResult)
    } finally {
      setBusy(null)
    }
  }
  const status = (r: ImportResult, ok: (r: NonNullable<ImportResult>) => string): ReactNode =>
    r && <div className="mt-2 text-[13px] font-semibold">{r.error ? r.error : <span className="flex items-center gap-1.5"><Check size={14} /> {ok(r)}</span>}</div>
  return (
    <>
      <div className="mb-1 text-[14px] font-bold uppercase tracking-wide">Import</div>
      <h1 className="mb-3 text-[30px] font-bold leading-tight tracking-tight">Bring your tabs with you</h1>
      <p className="mb-6 text-[15px] leading-relaxed">swyr reads these files on this Mac only and never uploads them. You can also import later from Settings.</p>
      <div className="flex flex-col gap-3">
        <div className="rounded-xl bg-[var(--select)] p-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-[15px] font-bold">Sidebar, spaces and pinned tabs</div>
              <div className="text-[13px]">Your spaces, folders, pinned tabs and favorites.</div>
            </div>
            <Primary disabled={busy !== null} onClick={() => void run('import.arc', setSidebar)}>
              <Download size={16} /> {busy === 'import.arc' ? 'Importing…' : IMPORT_FROM_LABEL}
            </Primary>
          </div>
          {status(sidebar, (r) => `Imported ${r.spaces ?? 0} spaces and ${r.pinned ?? 0} pinned tabs.`)}
        </div>
        <div className="rounded-xl bg-[var(--select)] p-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-[15px] font-bold">Bookmarks</div>
              <div className="text-[13px]">From Chrome, Safari or Firefox, as one folder in your Pinned tabs. Passwords stay in the other browser.</div>
            </div>
            <div className="flex shrink-0 flex-col gap-1.5">
              {(
                [
                  ['import.chrome', 'Chrome'],
                  ['import.safari', 'Safari'],
                  ['import.firefox', 'Firefox']
                ] as const
              ).map(([command, name]) => (
                <Primary key={command} disabled={busy !== null} onClick={() => void run(command, setChrome)}>
                  <Bookmark size={16} /> {busy === command ? 'Importing…' : `From ${name}`}
                </Primary>
              ))}
            </div>
          </div>
          {status(chrome, (r) => `Imported ${r.bookmarks ?? 0} bookmarks.`)}
        </div>
      </div>
    </>
  )
}

// ----- step 3

function SidebarPreview({ theme, dark }: { theme: SpaceTheme; dark: boolean }): ReactNode {
  const row = dark ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.6)'
  const active = dark ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.95)'
  return (
    <div className="flex h-[230px] overflow-hidden rounded-xl border border-[var(--card-border)]" style={{ background: gradientCss(theme, dark) }} aria-label="Sidebar preview">
      <div className="flex w-[150px] shrink-0 flex-col gap-1.5 p-3">
        <div className="mb-1 flex gap-1.5">
          {[0, 1, 2].map((i) => (
            <span key={i} className="h-2.5 w-2.5 rounded-full" style={{ background: row }} />
          ))}
        </div>
        <div className="h-7 rounded-lg" style={{ background: row }} />
        <div className="my-1 grid grid-cols-4 gap-1">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className="h-6 rounded-md" style={{ background: row }} />
          ))}
        </div>
        {[70, 92, 60].map((w, i) => (
          <div key={i} className="h-6 rounded-md" style={{ width: `${w}%`, background: i === 1 ? active : 'transparent', border: i === 1 ? 'none' : `1.5px solid ${row}` }} />
        ))}
      </div>
      <div className="m-2 ml-0 flex-1 rounded-lg" style={{ background: dark ? '#1c1d22' : '#ffffff' }}>
        <div className="m-4 h-3 w-2/3 rounded" style={{ background: dark ? 'rgba(255,255,255,0.12)' : 'rgba(21,23,28,0.08)' }} />
        <div className="mx-4 h-3 w-1/2 rounded" style={{ background: dark ? 'rgba(255,255,255,0.12)' : 'rgba(21,23,28,0.08)' }} />
      </div>
    </div>
  )
}

function ThemeStep(props: { colors: string[]; setColors: (c: string[]) => void; theme: SpaceTheme; dark: boolean }): ReactNode {
  const { colors, setColors } = props
  const same = (a: string[], b: string[]): boolean => a.length === b.length && a.every((c, i) => c.toLowerCase() === b[i].toLowerCase())
  return (
    <>
      <div className="mb-1 text-[14px] font-bold uppercase tracking-wide">Make it yours</div>
      <h1 className="mb-3 text-[30px] font-bold leading-tight tracking-tight">Pick your colours</h1>
      <p className="mb-5 text-[15px] leading-relaxed">Every space has its own gradient. This one is for your first space; change it any time from the space menu.</p>
      <div className="grid grid-cols-[1fr_300px] gap-6">
        <div>
          <div className="grid grid-cols-4 gap-2.5">
            {ONBOARDING_PRESETS.map((p) => {
              const on = same(p.colors, colors)
              return (
                <button
                  key={p.name}
                  aria-pressed={on}
                  title={p.name}
                  onClick={() => setColors([...p.colors])}
                  className={`flex flex-col items-center gap-1.5 rounded-xl p-1.5 ${on ? 'bg-[var(--select)]' : ''}`}
                >
                  <span
                    className="h-12 w-full rounded-lg"
                    style={{ background: gradientCss({ ...props.theme, colors: p.colors }, props.dark), boxShadow: on ? '0 0 0 2.5px var(--fg)' : 'inset 0 0 0 1px var(--card-border)' }}
                  />
                  <span className="text-[12px] font-semibold">{p.name}</span>
                </button>
              )
            })}
          </div>
          <div className="mt-5 text-[13px] font-bold uppercase tracking-wide">Custom colour stops</div>
          <div className="mt-2 flex items-center gap-2">
            {colors.map((c, i) => (
              <label key={i} className="flex items-center gap-1.5 rounded-lg bg-[var(--select)] px-2 py-1.5">
                <input
                  type="color"
                  value={c}
                  aria-label={`Colour ${i + 1}`}
                  className="h-7 w-9 cursor-pointer rounded border-0 bg-transparent p-0"
                  onChange={(e) => setColors(colors.map((x, j) => (j === i ? e.target.value : x)))}
                />
                <span className="font-mono text-[12px] font-semibold">{c.toUpperCase()}</span>
              </label>
            ))}
            {colors.length < 3 && (
              <button className="icon-btn bg-[var(--select)]" title="Add a colour stop" onClick={() => setColors([...colors, colors[colors.length - 1]])}>
                <Plus size={16} />
              </button>
            )}
            {colors.length > 1 && (
              <button className="icon-btn bg-[var(--select)]" title="Remove the last colour stop" onClick={() => setColors(colors.slice(0, -1))}>
                <Minus size={16} />
              </button>
            )}
          </div>
        </div>
        <SidebarPreview theme={props.theme} dark={props.dark} />
      </div>
    </>
  )
}

// ----- step 4

/** web apps the Defaults step offers as Favorites */
const WEB_APPS = [
  { title: 'Gmail', url: 'https://mail.google.com/' },
  { title: 'Google Calendar', url: 'https://calendar.google.com/' },
  { title: 'Google Drive', url: 'https://drive.google.com/' },
  { title: 'Notion', url: 'https://www.notion.so/' },
  { title: 'GitHub', url: 'https://github.com/' },
  { title: 'Slack', url: 'https://app.slack.com/' },
  { title: 'YouTube', url: 'https://www.youtube.com/' },
  { title: 'Figma', url: 'https://www.figma.com/' }
]

function DefaultsStep(props: {
  adblock: boolean
  setAdblock: (v: boolean) => void
  archiveAfter: ArchiveAfter
  setArchiveAfter: (v: ArchiveAfter) => void
  apps: string[]
  setApps: (v: string[]) => void
}): ReactNode {
  const [isDefault, setIsDefault] = useState<boolean | null>(null)
  return (
    <>
      <div className="mb-1 text-[14px] font-bold uppercase tracking-wide">Defaults</div>
      <h1 className="mb-5 text-[30px] font-bold leading-tight tracking-tight">A few sensible choices</h1>
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-4 rounded-xl bg-[var(--select)] p-4">
          <div>
            <div className="text-[15px] font-bold">Default browser</div>
            <div className="text-[13px]">Links from other apps open in swyr.</div>
          </div>
          <Plain onClick={() => void invoke('browser.makeDefault').then((r) => setIsDefault(r === true))}>
            {isDefault ? <Check size={16} /> : <Sparkles size={16} />} {isDefault ? 'swyr is your default' : 'Set as default browser'}
          </Plain>
        </div>
        <div className="flex items-center justify-between gap-4 rounded-xl bg-[var(--select)] p-4">
          <div className="flex items-center gap-3">
            <Shield size={20} strokeWidth={2} />
            <div>
              <div className="text-[15px] font-bold">Block ads and trackers</div>
              <div className="text-[13px]">Pages load faster and follow you less. Turn it off per site any time.</div>
            </div>
          </div>
          <Toggle on={props.adblock} onChange={props.setAdblock} label="Block ads and trackers" />
        </div>
        <div className="rounded-xl bg-[var(--select)] p-4">
          <div className="text-[15px] font-bold">Pick your web apps</div>
          <div className="mb-3 text-[13px]">The ones you pick become Favorites at the top of the sidebar, in every space.</div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Web apps">
            {WEB_APPS.map((a) => {
              const on = props.apps.includes(a.url)
              return (
                <button
                  key={a.url}
                  aria-pressed={on}
                  data-app={a.title}
                  onClick={() => props.setApps(on ? props.apps.filter((u) => u !== a.url) : [...props.apps, a.url])}
                  className={`flex h-8 items-center gap-1 rounded-lg px-3 text-[13px] font-semibold ${on ? 'bg-[var(--fg)] text-[var(--content)]' : 'bg-[var(--card)]'}`}
                >
                  {on && <Check size={13} strokeWidth={3} />} {a.title}
                </button>
              )
            })}
          </div>
        </div>
        <div className="rounded-xl bg-[var(--select)] p-4">
          <div className="text-[15px] font-bold">Archive Today tabs after</div>
          <div className="mb-3 text-[13px]">Tabs you have not opened in this long move to the Archive. Pinned tabs never do.</div>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Archive Today tabs after">
            {ARCHIVE.map((a) => (
              <button
                key={a.value}
                role="radio"
                aria-checked={props.archiveAfter === a.value}
                onClick={() => props.setArchiveAfter(a.value)}
                className={`h-8 rounded-lg px-3 text-[13px] font-semibold ${props.archiveAfter === a.value ? 'bg-[var(--fg)] text-[var(--content)]' : 'bg-[var(--card)]'}`}
              >
                {a.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}

// ----- step 5

function DoneStep({ overrides }: { overrides: Record<string, string> }): ReactNode {
  const bindings = resolveBindings(overrides)
  const key = (id: string, fallback: string): string => acceleratorLabel(bindings.find((b) => b.id === id)?.accelerator ?? fallback)
  const rows = [
    { keys: key('tab.new', 'Cmd+T'), text: 'New tab, or search from anywhere' },
    { keys: key('sidebar.toggle', 'Cmd+S'), text: 'Show or hide the sidebar' },
    { keys: key('tab.togglePin', 'Cmd+D'), text: 'Pin a tab so it stays' },
    { keys: '⌃1 … ⌃9', text: 'Jump to a space' },
    { keys: key('mini.new', 'Cmd+Alt+N'), text: 'Open a Mini Window' },
    { keys: key('split.add', 'Ctrl+Shift+='), text: 'Add a page to Split View' }
  ]
  return (
    <>
      <div className="mb-1 text-[14px] font-bold uppercase tracking-wide">Done</div>
      <h1 className="mb-3 text-[30px] font-bold leading-tight tracking-tight">You're ready</h1>
      <p className="mb-5 text-[15px] leading-relaxed">Six keys worth learning first. Every shortcut is listed, and can be changed, in Settings &gt; Shortcuts.</p>
      <div className="grid grid-cols-2 gap-2">
        {rows.map((r) => (
          <div key={r.text} className="flex items-center gap-3 rounded-xl bg-[var(--select)] px-4 py-3">
            <kbd className="min-w-[64px] rounded-md bg-[var(--card)] px-2 py-1 text-center text-[14px] font-bold">{r.keys}</kbd>
            <span className="text-[14px] font-semibold">{r.text}</span>
          </div>
        ))}
      </div>
      <p className="mt-5 text-[12px]">{NOT_AFFILIATED}</p>
    </>
  )
}

// ----- page

function Onboarding(): ReactNode {
  const vs = useView((s) => s.vs)
  const space = vs ? activeSpace(vs) : undefined
  const systemDark = vs?.systemDark ?? window.matchMedia('(prefers-color-scheme: dark)').matches
  const [step, setStep] = useState(() => Math.max(0, Math.min(STEPS.length - 1, Number(new URLSearchParams(location.search).get('step') ?? '0') || 0)))
  const [colors, setColors] = useState<string[] | null>(null)
  const [adblock, setAdblock] = useState<boolean | null>(null)
  const [archiveAfter, setArchiveAfter] = useState<ArchiveAfter | null>(null)
  const [apps, setApps] = useState<string[]>([])
  const [finishing, setFinishing] = useState(false)
  const chosen = colors ?? space?.theme.colors ?? ONBOARDING_PRESETS[0].colors
  const theme: SpaceTheme = { colors: chosen, angle: space?.theme.angle ?? 150, noise: space?.theme.noise ?? 0.18, appearance: space?.theme.appearance ?? 'auto' }
  const preview: Space | undefined = space ? { ...space, theme } : undefined
  const { dark } = useSpaceTheme(preview, systemDark)
  const settings = vs?.state.settings
  const ad = adblock ?? settings?.adblock ?? true
  const arch = archiveAfter ?? settings?.archiveAfter ?? '12h'
  const finish = async (): Promise<void> => {
    setFinishing(true)
    await invoke('onboarding.complete', { themeColors: chosen, adblock: ad, archiveAfter: arch, favorites: WEB_APPS.filter((a) => apps.includes(a.url)) })
  }
  return (
    <SpaceBackground space={preview} dark={isDark(theme, systemDark)} className="flex h-full flex-col items-center justify-center overflow-y-auto px-6 py-8">
      <div className="w-full max-w-[780px]">
        <ol className="mb-4 flex items-center justify-center gap-2" aria-label="Steps">
          {STEPS.map((s, i) => (
            <li key={s}>
              <button
                onClick={() => setStep(i)}
                aria-current={i === step ? 'step' : undefined}
                className={`flex h-8 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-semibold ${i === step ? 'bg-[var(--card)]' : 'bg-[var(--tile)] hover:bg-[var(--tile-active)]'}`}
              >
                <span className={`flex h-4.5 w-4.5 items-center justify-center rounded-full text-[11px] font-bold ${i < step ? 'bg-[var(--fg)] text-[var(--content)]' : ''}`}>
                  {i < step ? <Check size={11} strokeWidth={3} /> : i + 1}
                </span>
                {s}
              </button>
            </li>
          ))}
        </ol>
        <Card className="onboarding-card">
          <div className="min-h-[380px]">
            {step === 0 && <Welcome />}
            {step === 1 && <ImportStep />}
            {step === 2 && <ThemeStep colors={chosen} setColors={setColors} theme={theme} dark={dark} />}
            {step === 3 && <DefaultsStep adblock={ad} setAdblock={setAdblock} archiveAfter={arch} setArchiveAfter={setArchiveAfter} apps={apps} setApps={setApps} />}
            {step === 4 && <DoneStep overrides={settings?.shortcuts ?? {}} />}
          </div>
          <div className="mt-6 flex items-center justify-between">
            {step > 0 ? (
              <Plain onClick={() => setStep(step - 1)}>
                <ArrowLeft size={16} /> Back
              </Plain>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-2">
              {step === 1 && <Plain onClick={() => setStep(2)}>Skip</Plain>}
              {step < STEPS.length - 1 ? (
                <Primary onClick={() => setStep(step + 1)}>
                  {step === 0 ? 'Get started' : 'Continue'} <ArrowRight size={16} />
                </Primary>
              ) : (
                <Primary disabled={finishing} onClick={() => void finish()}>
                  Start browsing <ArrowRight size={16} />
                </Primary>
              )}
            </div>
          </div>
        </Card>
      </div>
    </SpaceBackground>
  )
}

startViewSync()
createRoot(document.getElementById('root')!).render(<Onboarding />)

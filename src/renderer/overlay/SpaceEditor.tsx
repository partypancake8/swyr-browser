// The space editor: name, Lucide icon picker, up to three colour stops, angle, noise, appearance, profile, live preview.
import { useMemo, useState, type ReactNode } from 'react'
import { Plus, Search, X } from 'lucide-react'
import type { Appearance, Profile, Space, SpaceTheme } from '@shared/types'
import { NOISE_URL, THEME_PRESETS, gradientCss, isDark } from '@shared/theme'
import { DEFAULT_SPACE_ICON, isSpaceIcon, searchSpaceIcons } from '@shared/spaceIcons'
import { SpaceIcon } from '../common/SpaceIcon'
import { invoke } from '../common/store'

const MAX_STOPS = 3

function Preview({ theme, icon, name, systemDark }: { theme: SpaceTheme; icon: string; name: string; systemDark: boolean }): ReactNode {
  const dark = isDark(theme, systemDark)
  const fg = dark ? '#f3f4f6' : '#15171c'
  const row = dark ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.86)'
  const tile = dark ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.55)'
  return (
    <div className="relative mb-4 flex h-[108px] overflow-hidden rounded-xl border border-[var(--card-border)]" style={{ background: gradientCss(theme, dark), color: fg }} aria-label="Preview">
      {theme.noise > 0 && <div className="noise" style={{ backgroundImage: NOISE_URL, opacity: Math.min(1, theme.noise * (dark ? 0.8 : 1.2)) }} />}
      <div className="relative flex w-[132px] shrink-0 flex-col gap-1 p-2">
        <div className="grid grid-cols-4 gap-1">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-4 rounded-[5px]" style={{ background: tile }} />
          ))}
        </div>
        <div className="flex h-5 items-center gap-1.5 rounded-md px-1.5 text-[10px] font-semibold" style={{ background: row }}>
          <span className="h-2 w-2 rounded-sm" style={{ background: fg, opacity: 0.6 }} />
          Pinned tab
        </div>
        <div className="flex h-5 items-center gap-1.5 px-1.5 text-[10px] font-medium">
          <span className="h-2 w-2 rounded-sm" style={{ background: fg, opacity: 0.6 }} />
          Today tab
        </div>
        <div className="mt-auto flex items-center justify-center">
          <SpaceIcon name={icon} size={12} strokeWidth={2.2} />
        </div>
      </div>
      <div className="relative my-2 mr-2 flex flex-1 items-center justify-center gap-1.5 rounded-lg text-[13px] font-semibold" style={{ background: dark ? '#1c1d22' : '#ffffff', boxShadow: '0 1px 3px rgba(0,0,0,0.15)' }}>
        <SpaceIcon name={icon} size={14} />
        {name || 'Untitled space'}
      </div>
    </div>
  )
}

/** a searchable grid of Lucide icons; the current one is highlighted */
function IconPicker({ value, onPick }: { value: string; onPick: (name: string) => void }): ReactNode {
  const [q, setQ] = useState('')
  const list = useMemo(() => searchSpaceIcons(q), [q])
  return (
    <div className="mb-4" role="group" aria-label="Choose an icon">
      <label className="mb-2 flex h-8 items-center gap-2 rounded-lg bg-[var(--select)] px-2">
        <Search size={14} />
        <input
          data-icon-search
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              e.stopPropagation()
              if (list[0]) onPick(list[0])
            }
          }}
          placeholder="Search icons"
          aria-label="Search icons"
          className="min-w-0 flex-1 bg-transparent text-[13px] outline-none"
        />
      </label>
      <div className="grid max-h-[148px] grid-cols-10 gap-0.5 overflow-y-auto" data-icon-grid>
        {list.map((name) => (
          <button
            key={name}
            data-icon-option
            data-icon-name={name}
            className={`flex h-8 items-center justify-center rounded-md hover:bg-[var(--select)] ${name === value ? 'bg-[var(--select)] ring-1 ring-[var(--accent)]' : ''}`}
            onClick={() => onPick(name)}
            aria-label={name}
            aria-pressed={name === value}
            title={name}
          >
            <SpaceIcon name={name} size={16} />
          </button>
        ))}
        {list.length === 0 && <div className="col-span-10 py-4 text-center text-[13px]">No icons match "{q}".</div>}
      </div>
    </div>
  )
}

function Slider({ label, value, min, max, step, format, onChange }: { label: string; value: number; min: number; max: number; step: number; format: (v: number) => string; onChange: (v: number) => void }): ReactNode {
  return (
    <label className="mb-3 flex items-center gap-3">
      <span className="w-14 shrink-0 text-[12px] font-semibold">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="slider min-w-0 flex-1" aria-label={label} />
      <span className="w-10 shrink-0 text-right text-[12px] font-semibold tabular-nums">{format(value)}</span>
    </label>
  )
}

export function SpaceEditor({ space, canDelete, profiles = [], systemDark = false }: { space: Space; canDelete: boolean; profiles?: Profile[]; systemDark?: boolean }): ReactNode {
  const [name, setName] = useState(space.name)
  const [icon, setIcon] = useState<string>(isSpaceIcon(space.icon) ? space.icon : DEFAULT_SPACE_ICON)
  const [colors, setColors] = useState<string[]>(space.theme.colors.length ? space.theme.colors.slice(0, MAX_STOPS) : ['#F6D5C3', '#CFE0F5'])
  const [angle, setAngle] = useState(space.theme.angle)
  const [noise, setNoise] = useState(space.theme.noise)
  const [appearance, setAppearance] = useState<Appearance>(space.theme.appearance)
  const [profileId, setProfileId] = useState(space.profileId)
  const theme: SpaceTheme = { colors, angle, noise, appearance }

  const save = async (): Promise<void> => {
    await invoke('space.edit', { id: space.id, name, icon, theme, ...(profileId !== space.profileId ? { profileId } : {}) })
    await invoke('overlay.close')
  }
  const cancel = (): void => void invoke('overlay.close')
  const setStop = (i: number, c: string): void => setColors(colors.map((x, j) => (j === i ? c : x)))

  return (
    <div
      className="max-h-[78vh] w-[400px] overflow-y-auto rounded-2xl border border-[var(--card-border)] bg-[var(--card)] p-5"
      style={{ boxShadow: '0 24px 48px rgba(0,0,0,0.22)' }}
      role="dialog"
      aria-label="Edit Space"
      onKeyDown={(e) => {
        if (e.key === 'Escape') cancel()
        if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT' && (e.target as HTMLInputElement).type === 'text') void save()
      }}
    >
      <div className="mb-4 text-[15px] font-semibold">Edit Space</div>
      <Preview theme={theme} icon={icon} name={name} systemDark={systemDark} />

      <div className="mb-3 flex items-center gap-2">
        <div className="flex h-9 w-12 shrink-0 items-center justify-center rounded-lg bg-[var(--select)]" aria-label={`Icon: ${icon}`} title={icon}>
          <SpaceIcon name={icon} size={18} />
        </div>
        <input
          autoFocus
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Space name"
          className="h-9 min-w-0 flex-1 rounded-lg bg-[var(--select)] px-3 text-[14px] font-medium outline-none focus:ring-1 focus:ring-[var(--accent)]"
          aria-label="Name"
        />
      </div>

      <div className="mb-1 text-[12px] font-semibold">Icon</div>
      <IconPicker value={icon} onPick={setIcon} />


      <div className="mb-1 text-[12px] font-semibold">Colours</div>
      <div className="mb-3 flex items-center gap-2">
        {colors.map((c, i) => (
          <div key={i} className="group relative">
            <input
              type="color"
              value={c.length === 7 ? c : '#cccccc'}
              onChange={(e) => setStop(i, e.target.value)}
              className="h-9 w-11 cursor-pointer rounded-lg border border-[var(--card-border)] bg-transparent p-0.5"
              aria-label={`Colour ${i + 1}`}
            />
            {colors.length > 1 && (
              <button
                className="absolute -right-1.5 -top-1.5 hidden h-4 w-4 items-center justify-center rounded-full bg-[var(--fg)] text-(color:--card) group-hover:flex"
                onClick={() => setColors(colors.filter((_, j) => j !== i))}
                aria-label={`Remove colour ${i + 1}`}
              >
                <X size={10} strokeWidth={3} />
              </button>
            )}
          </div>
        ))}
        {colors.length < MAX_STOPS && (
          <button
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-dashed border-[var(--card-border)] hover:bg-[var(--select)]"
            onClick={() => setColors([...colors, colors[colors.length - 1] ?? '#CFE0F5'])}
            aria-label="Add colour"
            title="Add colour"
          >
            <Plus size={14} strokeWidth={2} />
          </button>
        )}
        <div className="flex flex-1 flex-wrap justify-end gap-1">
          {THEME_PRESETS.map((p) => (
            <button
              key={p.join()}
              className="h-6 w-6 rounded-full border border-[var(--card-border)]"
              style={{ background: `linear-gradient(135deg, ${p.join(', ')})` }}
              onClick={() => setColors([...p])}
              aria-label="Preset"
              title="Preset"
            />
          ))}
        </div>
      </div>

      <Slider label="Angle" value={angle} min={0} max={360} step={5} format={(v) => `${v}°`} onChange={setAngle} />
      <Slider label="Grain" value={Math.round(noise * 100)} min={0} max={100} step={1} format={(v) => `${v}%`} onChange={(v) => setNoise(v / 100)} />

      <div className="mb-1 text-[12px] font-semibold">Appearance</div>
      <div className="mb-4 flex gap-1 rounded-lg bg-[var(--select)] p-1">
        {(['auto', 'light', 'dark'] as const).map((a) => (
          <button
            key={a}
            className={`flex-1 rounded-md py-1 text-[12px] font-semibold capitalize ${appearance === a ? 'bg-[var(--card)] shadow-sm' : ''}`}
            onClick={() => setAppearance(a)}
            aria-pressed={appearance === a}
          >
            {a}
          </button>
        ))}
      </div>

      {profiles.length > 1 && (
        <label className="mb-4 flex items-center gap-3">
          <span className="w-14 shrink-0 text-[12px] font-semibold">Profile</span>
          <select value={profileId} onChange={(e) => setProfileId(e.target.value)} className="h-8 min-w-0 flex-1 rounded-lg bg-[var(--select)] px-2 text-[13px] outline-none" aria-label="Profile">
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="flex items-center gap-2">
        {canDelete && (
          <button
            className="rounded-lg px-3 py-1.5 text-[13px] font-semibold text-(color:--danger) hover:bg-[var(--select)]"
            onClick={() => invoke('dialog.open', { dialog: 'confirmDeleteSpace', spaceId: space.id })}
          >
            Delete…
          </button>
        )}
        <div className="flex-1" />
        <button className="rounded-lg px-3 py-1.5 text-[13px] font-semibold hover:bg-[var(--select)]" onClick={cancel}>
          Cancel
        </button>
        <button className="rounded-lg bg-[var(--fg)] px-3 py-1.5 text-[13px] font-semibold text-(color:--card)" onClick={save}>
          Save
        </button>
      </div>
    </div>
  )
}

// A small space editor: name, emoji, two colours, appearance.
import { useState, type ReactNode } from 'react'
import type { Appearance, Space } from '@shared/types'
import { THEME_PRESETS, gradientCss } from '@shared/theme'
import { invoke } from '../common/store'

export function SpaceEditor({ space, canDelete }: { space: Space; canDelete: boolean }): ReactNode {
  const [name, setName] = useState(space.name)
  const [emoji, setEmoji] = useState(space.emoji)
  const [colors, setColors] = useState<string[]>(space.theme.colors.length >= 2 ? space.theme.colors.slice(0, 2) : [space.theme.colors[0] ?? '#F6D5C3', '#CFE0F5'])
  const [appearance, setAppearance] = useState<Appearance>(space.theme.appearance)
  const save = async (): Promise<void> => {
    await invoke('space.edit', { id: space.id, name, emoji, theme: { colors, appearance } })
    await invoke('overlay.close')
  }
  return (
    <div
      className="w-[380px] rounded-2xl border border-[var(--card-border)] bg-[var(--card)] p-5"
      style={{ boxShadow: '0 24px 48px rgba(0,0,0,0.22)' }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') void invoke('overlay.close')
        if (e.key === 'Enter') void save()
      }}
    >
      <div className="mb-4 text-[15px] font-semibold">Edit Space</div>
      <div className="mb-4 h-14 rounded-xl" style={{ background: gradientCss({ ...space.theme, colors, appearance: 'light' }, false) }} />
      <label className="mb-3 flex items-center gap-2">
        <input
          value={emoji}
          onChange={(e) => setEmoji(e.target.value.slice(0, 4))}
          placeholder="🙂"
          className="h-9 w-12 rounded-lg bg-[var(--select)] text-center text-[16px] outline-none"
          aria-label="Emoji"
        />
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-9 min-w-0 flex-1 rounded-lg bg-[var(--select)] px-3 text-[14px] font-medium outline-none"
          aria-label="Name"
        />
      </label>
      <div className="mb-3 flex items-center gap-2">
        {colors.map((c, i) => (
          <input
            key={i}
            type="color"
            value={c}
            onChange={(e) => setColors(colors.map((x, j) => (j === i ? e.target.value : x)))}
            className="h-8 w-10 cursor-pointer rounded-md border border-[var(--card-border)] bg-transparent"
            aria-label={`Colour ${i + 1}`}
          />
        ))}
        <div className="flex flex-1 justify-end gap-1">
          {THEME_PRESETS.map((p) => (
            <button
              key={p.join()}
              className="h-6 w-6 rounded-full border border-[var(--card-border)]"
              style={{ background: `linear-gradient(135deg, ${p[0]}, ${p[1]})` }}
              onClick={() => setColors([...p])}
              aria-label="Preset"
            />
          ))}
        </div>
      </div>
      <div className="mb-5 flex gap-1 rounded-lg bg-[var(--select)] p-1">
        {(['auto', 'light', 'dark'] as const).map((a) => (
          <button
            key={a}
            className={`flex-1 rounded-md py-1 text-[12px] font-semibold capitalize ${appearance === a ? 'bg-[var(--card)] shadow-sm' : ''}`}
            onClick={() => setAppearance(a)}
          >
            {a}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        {canDelete && (
          <button
            className="rounded-lg px-3 py-1.5 text-[13px] font-semibold text-[#b42318] hover:bg-[var(--select)]"
            onClick={async () => {
              await invoke('overlay.close')
              await invoke('space.delete', { id: space.id })
            }}
          >
            Delete
          </button>
        )}
        <div className="flex-1" />
        <button className="rounded-lg px-3 py-1.5 text-[13px] font-semibold hover:bg-[var(--select)]" onClick={() => invoke('overlay.close')}>
          Cancel
        </button>
        <button className="rounded-lg bg-[var(--fg)] px-3 py-1.5 text-[13px] font-semibold text-(color:--card)" onClick={save}>
          Save
        </button>
      </div>
    </div>
  )
}

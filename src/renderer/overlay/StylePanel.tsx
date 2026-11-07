// Style panel: no-code controls for the active site's style (colors, font, text size), the "Hide element"
// picker, "Edit code" for the CSS / JS editor page, and the site's styles with on/off toggles.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Code2, MousePointerClick, Paintbrush, Plus, RotateCcw, X } from 'lucide-react'
import type { SiteInfo, Style, ViewState } from '@shared/types'
import { invoke } from '../common/store'
import { Toggle } from '../pages/settings/ui'
import { Popover, SiteHeader, describeStyle } from './SiteSettings'

export const FONTS = [
  { label: 'Page font', value: '' },
  { label: 'System', value: '-apple-system, BlinkMacSystemFont, system-ui, sans-serif' },
  { label: 'Helvetica Neue', value: "'Helvetica Neue', Helvetica, Arial, sans-serif" },
  { label: 'Avenir Next', value: "'Avenir Next', Avenir, sans-serif" },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Charter', value: "Charter, 'Iowan Old Style', Georgia, serif" },
  { label: 'Iowan Old Style', value: "'Iowan Old Style', Georgia, serif" },
  { label: 'New York', value: "'New York', ui-serif, Georgia, serif" },
  { label: 'Menlo', value: 'Menlo, ui-monospace, monospace' },
  { label: 'SF Mono', value: "'SF Mono', ui-monospace, Menlo, monospace" }
]

type ColorKey = 'bg' | 'fg' | 'accent'
const COLOR_LABELS: Record<ColorKey, string> = { bg: 'Background', fg: 'Text', accent: 'Accent' }
const COLOR_DEFAULTS: Record<ColorKey, string> = { bg: '#fdf6e3', fg: '#1f2328', accent: '#1d5c8f' }

function ColorField({ k, value, onChange }: { k: ColorKey; value: string | undefined; onChange: (v: string | null) => void }): ReactNode {
  return (
    <div className="flex flex-1 flex-col items-center gap-1">
      <label
        className="relative flex h-10 w-full items-center justify-center overflow-hidden rounded-[10px] border border-[var(--card-border)]"
        style={{ background: value ?? 'transparent' }}
        title={`${COLOR_LABELS[k]} color`}
      >
        {!value && <span className="text-[12px] font-semibold">Page</span>}
        <input
          type="color"
          aria-label={`${COLOR_LABELS[k]} color`}
          className="absolute inset-0 h-full w-full cursor-default opacity-0"
          value={value ?? COLOR_DEFAULTS[k]}
          onChange={(e) => onChange(e.target.value)}
        />
      </label>
      <div className="flex items-center gap-1 text-[12px] font-semibold">
        {COLOR_LABELS[k]}
        {value && (
          <button className="rounded p-0.5 hover:bg-[var(--select)]" title={`Use the page's ${COLOR_LABELS[k].toLowerCase()} color`} onClick={() => onChange(null)}>
            <X size={11} strokeWidth={2.4} />
          </button>
        )}
      </div>
    </div>
  )
}

export function StylePanel({ vs }: { vs: ViewState }): ReactNode {
  const [styles, setStyles] = useState<Style[]>([])
  const [info, setInfo] = useState<SiteInfo | null>(null)
  const [pattern, setPattern] = useState('')
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Partial<Style>>({})
  const [customFont, setCustomFont] = useState(false)
  const timer = useRef<number | null>(null)

  const refresh = useCallback(() => {
    void invoke('style.forActiveSite').then((r) => setStyles(Array.isArray(r) ? (r as Style[]) : []))
    void invoke('siteSettings.info').then((r) => r && typeof r === 'object' && setInfo(r as SiteInfo))
    void invoke('style.siteDefaults').then((r) => {
      const d = r as { hostPattern?: string } | null
      if (d?.hostPattern) setPattern(d.hostPattern)
    })
  }, [])
  useEffect(() => refresh(), [refresh])
  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current)
  }, [])

  const current = styles.find((s) => s.id === currentId) ?? styles.find((s) => s.hostPattern === pattern) ?? styles[0]
  const view: Partial<Style> = { ...current, ...draft }

  const save = (patch: Partial<Style>, now = false): void => {
    const next = { ...draft, ...patch }
    setDraft(next)
    if (timer.current) window.clearTimeout(timer.current)
    const commit = (): void => {
      timer.current = null
      const payload = { ...next, id: current?.id, hostPattern: current?.hostPattern ?? pattern, enabled: true }
      void invoke('style.save', payload).then((r) => {
        const st = r as Style | null
        if (st?.id) {
          setCurrentId(st.id)
          setDraft({})
          setStyles((list) => (list.some((x) => x.id === st.id) ? list.map((x) => (x.id === st.id ? st : x)) : [...list, st]))
        }
      })
    }
    if (now) commit()
    else timer.current = window.setTimeout(commit, 120)
  }

  const setColor = (k: ColorKey, v: string | null): void => save({ colors: { ...(view.colors ?? {}), [k]: v ?? '' } })
  const scale = view.fontScale ?? 1
  const fontKnown = FONTS.some((f) => f.value === (view.font ?? ''))

  if (info && !info.web) {
    return (
      <Popover vs={vs} label="Styles" width={360}>
        <SiteHeader info={info} sub="swyr page" />
        <div className="px-4 py-4 text-[13px]">Styles work on web pages.</div>
      </Popover>
    )
  }

  return (
    <Popover vs={vs} label="Styles" width={360}>
      {info && <SiteHeader info={info} sub={current ? `Style for ${current.hostPattern}` : `New style for ${pattern || 'this site'}`} />}
      <div className="min-h-0 overflow-y-auto">
        <div className="border-b border-[var(--card-border)] px-4 py-3">
          <div className="mb-2 text-[11px] font-bold uppercase tracking-wide">Colors</div>
          <div className="flex gap-2">
            {(['bg', 'fg', 'accent'] as ColorKey[]).map((k) => (
              <ColorField key={k} k={k} value={view.colors?.[k]} onChange={(v) => setColor(k, v)} />
            ))}
          </div>
        </div>
        <div className="border-b border-[var(--card-border)] px-4 py-3">
          <div className="mb-2 text-[11px] font-bold uppercase tracking-wide">Font</div>
          <select
            aria-label="Font"
            className="w-full rounded-lg bg-[var(--select)] px-2 py-1.5 text-[13px] font-semibold outline-none"
            value={customFont || !fontKnown ? '__custom' : (view.font ?? '')}
            onChange={(e) => {
              if (e.target.value === '__custom') return setCustomFont(true)
              setCustomFont(false)
              save({ font: e.target.value })
            }}
          >
            {FONTS.map((f) => (
              <option key={f.label} value={f.value}>
                {f.label}
              </option>
            ))}
            <option value="__custom">Custom…</option>
          </select>
          {(customFont || !fontKnown) && (
            <input
              aria-label="Custom font family"
              className="mt-2 w-full rounded-lg border border-[var(--card-border)] bg-[var(--content)] px-2.5 py-1.5 text-[13px] font-medium outline-none focus:border-[var(--accent)]"
              placeholder="Font family, e.g. Futura"
              defaultValue={fontKnown ? '' : (view.font ?? '')}
              onChange={(e) => save({ font: e.target.value })}
            />
          )}
          <div className="mt-3 flex items-center gap-3">
            <span className="w-[46px] shrink-0 text-[12px] font-semibold">Size</span>
            <input
              aria-label="Text size"
              type="range"
              className="slider flex-1"
              min={0.7}
              max={1.6}
              step={0.05}
              value={scale}
              onChange={(e) => save({ fontScale: Number(e.target.value) })}
            />
            <span className="w-[42px] shrink-0 text-right text-[12px] font-semibold tabular-nums">{Math.round(scale * 100)}%</span>
            <button className="icon-btn !h-6 !w-6" title="Reset size" disabled={scale === 1} onClick={() => save({ fontScale: 1 })}>
              <RotateCcw size={13} strokeWidth={2} />
            </button>
          </div>
        </div>
        <div className="flex gap-2 border-b border-[var(--card-border)] px-4 py-3">
          <button
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[var(--select)] px-3 py-2 text-[13px] font-semibold hover:brightness-95"
            onClick={() => void invoke('style.pickElement')}
          >
            <MousePointerClick size={15} strokeWidth={1.9} /> Hide element
          </button>
          <button
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[var(--select)] px-3 py-2 text-[13px] font-semibold hover:brightness-95"
            onClick={() => void (current ? invoke('overlay.close').then(() => invoke('style.open', { id: current.id })) : invoke('style.edit'))}
          >
            <Code2 size={15} strokeWidth={1.9} /> Edit code
          </button>
        </div>
        {(view.hiddenSelectors?.length ?? 0) > 0 && (
          <div className="border-b border-[var(--card-border)] px-4 py-3">
            <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide">Hidden elements</div>
            {view.hiddenSelectors!.map((sel) => (
              <div key={sel} className="flex items-center gap-2 py-1">
                <code className="min-w-0 flex-1 truncate font-mono text-[12px]">{sel}</code>
                <button
                  className="icon-btn !h-6 !w-6"
                  title="Show this element again"
                  onClick={() => save({ hiddenSelectors: (view.hiddenSelectors ?? []).filter((x) => x !== sel) }, true)}
                >
                  <X size={13} strokeWidth={2.2} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="px-4 py-3">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wide">Styles on this site</span>
            <button
              className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] font-semibold text-[var(--accent)] hover:bg-[var(--select)]"
              onClick={() =>
                void invoke('style.save', { hostPattern: pattern, enabled: true }).then((r) => {
                  const st = r as Style | null
                  if (st?.id) {
                    setStyles((l) => [...l, st])
                    setCurrentId(st.id)
                    setDraft({})
                  }
                })
              }
            >
              <Plus size={12} strokeWidth={2.4} /> New
            </button>
          </div>
          {styles.length === 0 ? (
            <div className="py-1 text-[13px] font-medium">No styles yet. Pick a color or a font to start one.</div>
          ) : (
            styles.map((s) => (
              <div
                key={s.id}
                className={`flex min-h-[38px] items-center gap-2.5 rounded-lg px-2 py-1 ${s.id === current?.id ? 'bg-[var(--select)]' : ''}`}
                onClick={() => {
                  setCurrentId(s.id)
                  setDraft({})
                }}
              >
                <Paintbrush size={15} strokeWidth={1.9} className="shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold">{s.hostPattern}</div>
                  <div className="truncate text-[12px] font-medium">{describeStyle(s)}</div>
                </div>
                <span onClick={(e) => e.stopPropagation()}>
                  <Toggle
                    label={s.enabled ? 'Turn style off' : 'Turn style on'}
                    on={s.enabled}
                    onChange={(v) => {
                      setStyles((l) => l.map((x) => (x.id === s.id ? { ...x, enabled: v } : x)))
                      void invoke('style.toggle', { id: s.id, enabled: v })
                    }}
                  />
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </Popover>
  )
}

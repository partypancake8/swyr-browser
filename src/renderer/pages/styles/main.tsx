// swyr://styles lists every style (site, on/off, edit, delete); swyr://styles/<id> is the CSS / JS editor.
import { createRoot } from 'react-dom/client'
import { useCallback, useEffect, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ArrowLeft, Paintbrush, Plus, Trash2 } from 'lucide-react'
import '../../common/base.css'
import '../page.css'
import '../settings/settings.css'
import { invoke, startViewSync, useView } from '../../common/store'
import { activeSpace, useSpaceTheme } from '../../common/theme'
import type { Style } from '@shared/types'
import { Button, Card, Toggle, inputClass } from '../settings/ui'

function describe(s: Style): string {
  const parts: string[] = []
  if (s.colors.bg || s.colors.fg || s.colors.accent) parts.push('colors')
  if (s.font) parts.push('font')
  if (s.fontScale && s.fontScale !== 1) parts.push(`${Math.round(s.fontScale * 100)}% text`)
  if (s.hiddenSelectors.length) parts.push(`${s.hiddenSelectors.length} hidden element${s.hiddenSelectors.length === 1 ? '' : 's'}`)
  if (s.css.trim()) parts.push('CSS')
  if (s.js.trim()) parts.push('JavaScript')
  return parts.join(' · ') || 'Empty'
}

const go = (path: string): void => {
  location.href = `swyr://styles${path}`
}

function useStyles(): [Style[] | null, () => void] {
  const vs = useView((s) => s.vs)
  const [list, setList] = useState<Style[] | null>(null)
  const refresh = useCallback(() => {
    void invoke('style.list').then((r) => setList(Array.isArray(r) ? (r as Style[]) : []))
  }, [])
  useEffect(() => refresh(), [refresh, vs?.state.styles])
  return [list, refresh]
}

function Manager(): ReactNode {
  const [list, refresh] = useStyles()
  const [host, setHost] = useState('')
  const [confirm, setConfirm] = useState<string | null>(null)
  const create = (): void => {
    const hostPattern = host.trim()
    if (!hostPattern) return
    void invoke('style.save', { hostPattern, enabled: true }).then((r) => {
      const st = r as Style | null
      if (st?.id) go(`/${encodeURIComponent(st.id)}`)
    })
  }
  const sorted = [...(list ?? [])].sort((a, b) => a.hostPattern.localeCompare(b.hostPattern))
  return (
    <div className="mx-auto max-w-[820px] px-6 py-10">
      <h1 className="mb-2 text-[26px] font-bold">Styles</h1>
      <p className="mb-5 text-[14px]">
        Styles change how a site looks: colors, fonts, text size, hidden elements, and your own CSS and JavaScript. Open a site and click the brush in the address row to start one there.
      </p>
      <div className="mb-6 flex gap-2">
        <input
          aria-label="Site for a new style"
          className={`${inputClass} flex-1`}
          placeholder="Site, e.g. news.ycombinator.com or *.github.com"
          value={host}
          onChange={(e) => setHost(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && create()}
        />
        <Button kind="primary" disabled={!host.trim()} onClick={create}>
          <span className="flex items-center gap-1.5">
            <Plus size={14} /> New Style
          </span>
        </Button>
        <Button onClick={() => void invoke('style.import', {}).then(refresh)}>Install from Clipboard</Button>
      </div>
      {list && sorted.length === 0 ? (
        <Card>
          <div className="px-4 py-10 text-center">
            <Paintbrush size={22} className="mx-auto mb-2" />
            <div className="text-[15px] font-semibold">No styles yet</div>
            <div className="mt-1 text-[13px]">Create one above, or from the brush button next to the address of any site.</div>
          </div>
        </Card>
      ) : (
        <Card>
          {sorted.map((s) => (
            <div key={s.id} className="flex items-center gap-3 border-b border-[var(--card-border)] px-4 py-3 last:border-b-0">
              <Paintbrush size={18} strokeWidth={1.8} className="shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-bold">{s.hostPattern}</div>
                <div className="truncate text-[12.5px] font-medium">{describe(s)}</div>
              </div>
              {confirm === s.id ? (
                <>
                  <Button onClick={() => setConfirm(null)}>Keep</Button>
                  <Button
                    kind="danger"
                    onClick={() => {
                      setConfirm(null)
                      void invoke('style.delete', { id: s.id }).then(refresh)
                    }}
                  >
                    Delete
                  </Button>
                </>
              ) : (
                <>
                  <Button onClick={() => go(`/${encodeURIComponent(s.id)}`)}>Edit</Button>
                  <button className="icon-btn" title="Delete style" onClick={() => setConfirm(s.id)}>
                    <Trash2 size={16} strokeWidth={1.9} />
                  </button>
                </>
              )}
              <Toggle label={s.enabled ? `Turn off the style for ${s.hostPattern}` : `Turn on the style for ${s.hostPattern}`} on={s.enabled} onChange={(v) => void invoke('style.toggle', { id: s.id, enabled: v }).then(refresh)} />
            </div>
          ))}
        </Card>
      )}
    </div>
  )
}

/** Tab inserts two spaces; Cmd+S saves */
function codeKeys(e: KeyboardEvent<HTMLTextAreaElement>, save: () => void, set: (v: string) => void): void {
  if (e.key === 's' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault()
    save()
  } else if (e.key === 'Tab' && !e.shiftKey) {
    e.preventDefault()
    const el = e.currentTarget
    const { selectionStart: a, selectionEnd: b, value } = el
    set(value.slice(0, a) + '  ' + value.slice(b))
    requestAnimationFrame(() => el.setSelectionRange(a + 2, a + 2))
  }
}

function Editor({ id }: { id: string }): ReactNode {
  const [list, refresh] = useStyles()
  const style = list?.find((s) => s.id === id)
  const [draft, setDraft] = useState<{ hostPattern: string; css: string; js: string } | null>(null)
  const [saved, setSaved] = useState<'idle' | 'saved'>('idle')
  const [confirm, setConfirm] = useState(false)
  if (style && !draft) setDraft({ hostPattern: style.hostPattern, css: style.css, js: style.js })

  if (list && !style) {
    return (
      <div className="mx-auto max-w-[820px] px-6 py-10">
        <button className="mb-4 flex items-center gap-1.5 text-[13px] font-semibold" onClick={() => go('')}>
          <ArrowLeft size={14} /> All styles
        </button>
        <Card>
          <div className="px-4 py-10 text-center text-[15px] font-semibold">This style was deleted.</div>
        </Card>
      </div>
    )
  }
  if (!style || !draft) return null
  const dirty = draft.hostPattern !== style.hostPattern || draft.css !== style.css || draft.js !== style.js
  const save = (): void => {
    void invoke('style.save', { id: style.id, ...draft }).then(() => {
      refresh()
      setSaved('saved')
      window.setTimeout(() => setSaved('idle'), 1400)
    })
  }
  const pane = (label: string, key: 'css' | 'js', placeholder: string): ReactNode => (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="mb-1.5 text-[12px] font-bold uppercase tracking-wide">{label}</div>
      <textarea
        aria-label={label}
        spellCheck={false}
        className="min-h-[420px] flex-1 resize-none rounded-xl border border-[var(--card-border)] bg-[var(--card)] p-3 font-mono text-[13px] leading-[1.55] outline-none focus:border-[var(--accent)]"
        style={{ fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace", tabSize: 2 }}
        placeholder={placeholder}
        value={draft[key]}
        onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
        onKeyDown={(e) => codeKeys(e, save, (v) => setDraft({ ...draft, [key]: v }))}
      />
    </div>
  )
  return (
    <div className="mx-auto flex min-h-full max-w-[1200px] flex-col px-6 py-8">
      <button className="mb-4 flex w-fit items-center gap-1.5 text-[13px] font-semibold" onClick={() => go('')}>
        <ArrowLeft size={14} /> All styles
      </button>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Paintbrush size={20} strokeWidth={1.9} />
        <input
          aria-label="Site"
          className={`${inputClass} min-w-[240px] flex-1 !text-[15px] !font-bold`}
          value={draft.hostPattern}
          onChange={(e) => setDraft({ ...draft, hostPattern: e.target.value })}
        />
        <span className="flex items-center gap-2 text-[13px] font-semibold">
          {style.enabled ? 'On' : 'Off'}
          <Toggle label={style.enabled ? 'Turn style off' : 'Turn style on'} on={style.enabled} onChange={(v) => void invoke('style.toggle', { id: style.id, enabled: v }).then(refresh)} />
        </span>
        <Button onClick={() => void invoke('style.export', { id: style.id })}>Copy Share Code</Button>
        {confirm ? (
          <>
            <Button onClick={() => setConfirm(false)}>Keep</Button>
            <Button kind="danger" onClick={() => void invoke('style.delete', { id: style.id }).then(() => go(''))}>
              Delete
            </Button>
          </>
        ) : (
          <Button kind="danger" onClick={() => setConfirm(true)}>
            <span className="flex items-center gap-1.5">
              <Trash2 size={14} /> Delete
            </span>
          </Button>
        )}
        <Button kind="primary" disabled={!dirty || !draft.hostPattern.trim()} onClick={save}>
          {saved === 'saved' && !dirty ? 'Saved' : 'Save'}
        </Button>
      </div>
      <p className="mb-4 text-[13px]">
        {describe(style)}. CSS applies to open pages as soon as you save; JavaScript runs once on each page load, and right away after a save. ⌘S saves.
      </p>
      <div className="flex min-h-0 flex-1 flex-col gap-4 md:flex-row">
        {pane('CSS', 'css', 'body {\n  max-width: 900px;\n  margin: 0 auto;\n}')}
        {pane('JavaScript', 'js', "document.querySelector('header')?.remove()")}
      </div>
    </div>
  )
}

function StylesPage(): ReactNode {
  const vs = useView((s) => s.vs)
  const space = vs ? activeSpace(vs) : undefined
  useSpaceTheme(space, vs?.systemDark ?? false)
  const id = decodeURIComponent(location.pathname.replace(/^\/+|\/+$/g, ''))
  return id ? <Editor id={id} /> : <Manager />
}

startViewSync()
createRoot(document.getElementById('root')!).render(<StylesPage />)

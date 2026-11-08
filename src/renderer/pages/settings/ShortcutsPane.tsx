// Settings > Shortcuts: every binding of the shortcut table, a key recorder with conflict checks, and resets.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Search } from 'lucide-react'
import { acceleratorLabel } from '@shared/commands'
import type { ShortcutEntry, ViewState } from '@shared/types'
import { invoke } from '../../common/store'
import { Button, Row, Section, inputClass } from './ui'
import { shortcutSettingId } from './search'

type SetResult = { ok: true; accelerator: string } | { ok: false; error: string; conflict?: { id: string; title: string } } | null

export function ShortcutsPane({ vs }: { vs: ViewState }): ReactNode {
  const overrides = vs.state.settings.shortcuts
  const [list, setList] = useState<ShortcutEntry[]>([])
  const [recording, setRecording] = useState<string | null>(null)
  const [message, setMessage] = useState<{ id: string; text: string } | null>(null)
  const [query, setQuery] = useState('')

  const refresh = useCallback(() => {
    void invoke('shortcuts.list').then((r) => {
      if (Array.isArray(r)) setList(r as ShortcutEntry[])
    })
  }, [])
  useEffect(() => refresh(), [overrides, refresh])

  const record = async (id: string): Promise<void> => {
    setRecording(id)
    setMessage(null)
    try {
      const r = (await invoke('shortcuts.record', { id })) as SetResult
      if (r && !r.ok) setMessage({ id, text: r.error })
    } finally {
      setRecording(null)
      refresh()
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return list
    return list.filter((b) => b.title.toLowerCase().includes(q) || acceleratorLabel(b.accelerator).toLowerCase().includes(q) || b.command.includes(q))
  }, [list, query])
  const groups: { title: string; rows: ShortcutEntry[] }[] = [
    { title: 'Everywhere', rows: filtered.filter((b) => !b.scope) },
    { title: 'In a Mini Window', rows: filtered.filter((b) => b.scope === 'mini') }
  ]
  const changed = list.filter((b) => b.overridden).length

  return (
    <>
      <div className="mb-3 flex items-center gap-3" data-setting="shortcutsFilter">
        <label className={`flex flex-1 items-center gap-2 ${inputClass}`}>
          <Search size={14} />
          <input className="min-w-0 flex-1 bg-transparent outline-none" placeholder="Filter shortcuts" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Filter shortcuts" />
        </label>
        <Button className={changed ? '' : 'invisible'} onClick={() => void invoke('shortcuts.reset').then(refresh)}>
          Reset All ({changed})
        </Button>
      </div>
      <p className="mb-4 text-[13px]">Click Change, then press the new keys. Escape cancels. A key already used by another shortcut is refused.</p>
      {groups.map(
        (g) =>
          g.rows.length > 0 && (
            <Section key={g.title} title={g.title}>
              {g.rows.map((b) => (
                <Row
                  key={b.id}
                  setting={shortcutSettingId(b.id)}
                  label={b.title}
                  detail={message?.id === b.id ? <span className="font-semibold text-[var(--danger)]">{message.text}</span> : undefined}
                >
                  <kbd
                    className={`min-w-16 rounded-md px-2 py-0.5 text-center text-[13px] font-semibold ${recording === b.id ? 'bg-[var(--accent)] text-[var(--content)]' : 'bg-[var(--select)]'}`}
                  >
                    {recording === b.id ? 'Press keys…' : acceleratorLabel(b.accelerator)}
                  </kbd>
                  <Button disabled={recording !== null} onClick={() => void record(b.id)}>
                    Change
                  </Button>
                  <Button
                    className={b.overridden ? '' : 'invisible'}
                    title={b.overridden ? `Back to ${acceleratorLabel(b.default)}` : 'Already the default'}
                    onClick={() => void invoke('shortcuts.reset', { id: b.id }).then(refresh)}
                  >
                    Reset
                  </Button>
                </Row>
              ))}
            </Section>
          )
      )}
    </>
  )
}

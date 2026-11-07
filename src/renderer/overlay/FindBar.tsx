// Find in page: a small bar at the top right of the content area.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { invoke } from '../common/store'

export function FindBar({ query, active, matches }: { query: string; active: number; matches: number }): ReactNode {
  const [value, setValue] = useState(query)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
    if (query) void invoke('find.update', { query })
  }, [query])
  return (
    <div className="flex h-full w-full items-center p-1">
      <div
        className="flex h-full w-full items-center gap-1 rounded-xl border border-[var(--card-border)] bg-[var(--card)] pl-3 pr-1"
        style={{ boxShadow: 'var(--shadow)' }}
      >
        <input
          ref={ref}
          value={value}
          placeholder="Find in page"
          className="min-w-0 flex-1 bg-transparent text-[13px] font-medium outline-none placeholder:text-(color:--fg) placeholder:opacity-75"
          onChange={(e) => {
            setValue(e.target.value)
            void invoke('find.update', { query: e.target.value })
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void invoke(e.shiftKey ? 'find.prev' : 'find.next')
            if (e.key === 'Escape') void invoke('find.close')
          }}
        />
        <span className="shrink-0 px-1 text-[12px] font-medium tabular-nums">{value ? `${active}/${matches}` : ''}</span>
        <button className="icon-btn" title="Previous (⇧⌘G)" onClick={() => invoke('find.prev')}>
          <ChevronUp size={16} />
        </button>
        <button className="icon-btn" title="Next (⌘G)" onClick={() => invoke('find.next')}>
          <ChevronDown size={16} />
        </button>
        <button className="icon-btn" title="Close" onClick={() => invoke('find.close')}>
          <X size={16} />
        </button>
      </div>
    </div>
  )
}

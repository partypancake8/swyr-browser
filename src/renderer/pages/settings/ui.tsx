// Small flat building blocks shared by swyr://settings and swyr://extensions.
import type { ButtonHTMLAttributes, ReactNode } from 'react'

export function Card({ children }: { children: ReactNode }): ReactNode {
  return <div className="mb-6 overflow-hidden rounded-xl border border-[var(--card-border)] bg-[var(--card)]">{children}</div>
}

export function Section({ title, children, note }: { title: string; children: ReactNode; note?: ReactNode }): ReactNode {
  return (
    <section>
      <h2 className="mb-2 text-[13px] font-bold uppercase tracking-wide">{title}</h2>
      {note && <p className="mb-2 text-[13px]">{note}</p>}
      <Card>{children}</Card>
    </section>
  )
}

export function Row({ label, detail, children }: { label: ReactNode; detail?: ReactNode; children?: ReactNode }): ReactNode {
  return (
    <div className="flex min-h-[52px] items-center justify-between gap-4 border-b border-[var(--card-border)] px-4 py-2.5 last:border-b-0">
      <div className="min-w-0">
        <div className="text-[14px] font-semibold">{label}</div>
        {detail && <div className="mt-0.5 text-[12.5px] leading-snug">{detail}</div>}
      </div>
      {children !== undefined && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  )
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }): ReactNode {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={label}
      onClick={() => onChange(!on)}
      className={`relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors ${on ? 'bg-[var(--accent)]' : 'bg-[var(--toggle-off)]'}`}
    >
      <span
        className="absolute top-[3px] h-4 w-4 rounded-full bg-white shadow-sm transition-[left]"
        style={{ left: on ? 19 : 3 }}
      />
    </button>
  )
}

export function Button({ kind = 'plain', className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { kind?: 'plain' | 'primary' | 'danger' }): ReactNode {
  const look =
    kind === 'primary'
      ? 'bg-[var(--accent)] text-[var(--content)]'
      : kind === 'danger'
        ? 'bg-[var(--select)] text-[var(--danger)]'
        : 'bg-[var(--select)]'
  return (
    <button
      {...rest}
      className={`rounded-lg px-3 py-1.5 text-[13px] font-semibold hover:brightness-95 disabled:cursor-default disabled:opacity-50 ${look} ${className}`}
    />
  )
}

export const inputClass =
  'rounded-lg border border-[var(--card-border)] bg-[var(--content)] px-2.5 py-1.5 text-[13px] font-medium outline-none focus:border-[var(--accent)]'
export const selectClass = 'rounded-lg bg-[var(--select)] px-2 py-1.5 text-[13px] font-semibold outline-none'

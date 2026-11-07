// Keyboard shortcuts: menu accelerators for the bindings the menu bar carries, before-input-event for the rest.
// Round 3c: the full default table lives in src/shared/commands.ts; this module also lists, changes and
// resets bindings (shortcuts.list / shortcuts.set / shortcuts.reset) with conflict checks.
import type { Event, Input } from 'electron'
import type { ShortcutEntry } from '@shared/types'
import { DEFAULT_BINDINGS, bindingAction, bindingTitle, normalizeAccelerator, resolveBindings, type Binding } from '@shared/commands'
import type { Core } from '../windows/WindowManager'
import type { SwyrWindow } from '../windows/SwyrWindow'

interface Matcher {
  meta: boolean
  ctrl: boolean
  alt: boolean
  shift: boolean
  code: string
  binding: Binding
}

const NAMED_CODES: Record<string, string> = {
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  tab: 'Tab',
  '=': 'Equal',
  plus: 'Equal',
  '-': 'Minus',
  '[': 'BracketLeft',
  ']': 'BracketRight',
  ',': 'Comma',
  '.': 'Period',
  '/': 'Slash',
  '\\': 'Backslash',
  ';': 'Semicolon',
  "'": 'Quote',
  '`': 'Backquote',
  enter: 'Enter',
  escape: 'Escape',
  space: 'Space',
  backspace: 'Backspace',
  delete: 'Delete'
}

export function keyCode(key: string): string {
  const k = key.toLowerCase()
  if (NAMED_CODES[k]) return NAMED_CODES[k]
  if (/^[a-z]$/.test(k)) return `Key${k.toUpperCase()}`
  if (/^[0-9]$/.test(k)) return `Digit${k}`
  return key
}

export function parseAccelerator(accel: string, binding: Binding): Matcher {
  const parts = accel.endsWith('++') ? [...accel.slice(0, -2).split('+'), 'plus'] : accel.split('+')
  const m: Matcher = { meta: false, ctrl: false, alt: false, shift: false, code: '', binding }
  for (const raw of parts.filter(Boolean)) {
    const p = raw.toLowerCase()
    if (p === 'cmd' || p === 'command' || p === 'cmdorctrl' || p === 'commandorcontrol' || p === 'meta') m.meta = true
    else if (p === 'ctrl' || p === 'control') m.ctrl = true
    else if (p === 'alt' || p === 'option') m.alt = true
    else if (p === 'shift') m.shift = true
    else m.code = keyCode(raw)
  }
  return m
}

export type SetResult = { ok: true; accelerator: string } | { ok: false; error: string; conflict?: { id: string; title: string } }

export class Shortcuts {
  bindings: Binding[] = []
  private raw: Matcher[] = []
  /** binding ids the menu bar registers as accelerators (everything else goes through handleInput) */
  private menuBound = new Set<string>()
  /** while the Settings recorder listens, no shortcut fires */
  paused = false

  constructor(private readonly core: Core) {
    this.reload()
  }

  reload(): void {
    this.bindings = resolveBindings(this.core.store.state.settings.shortcuts)
    this.raw = this.bindings
      .filter((b) => b.scope !== 'mini' && b.accelerator && (b.raw || !this.menuBound.has(b.id)))
      .map((b) => parseAccelerator(b.accelerator, b))
  }

  /** called by the menu after every rebuild */
  setMenuBound(ids: Iterable<string>): void {
    const next = new Set(ids)
    if (next.size === this.menuBound.size && [...next].every((id) => this.menuBound.has(id))) return
    this.menuBound = next
    this.reload()
  }

  /** the first main-scope binding of a command (optionally with a payload) */
  accelerator(command: string, payload?: unknown): Binding | undefined {
    const key = payload === undefined ? undefined : JSON.stringify(payload)
    return this.bindings.find(
      (b) => b.scope !== 'mini' && b.command === command && (key === undefined ? b.payload === undefined : JSON.stringify(b.payload) === key)
    )
  }

  handleInput(event: Event, input: Input, w: SwyrWindow): void {
    if (input.type !== 'keyDown' || this.paused) return
    for (const m of this.raw) {
      if (
        m.code === input.code &&
        m.meta === input.meta &&
        m.ctrl === input.control &&
        m.alt === input.alt &&
        m.shift === input.shift
      ) {
        const action = bindingAction(m.binding)
        // a binding whose command is not available in this build leaves the key to the page
        if (!this.core.commands.has(action.command)) return
        event.preventDefault()
        void this.core.commands.run(action.command, action.payload, w).catch((err) => console.error('[swyr]', err))
        return
      }
    }
  }

  /** every binding with its current and default accelerator */
  list(): ShortcutEntry[] {
    const overrides = this.core.store.state.settings.shortcuts ?? {}
    const defaults = new Map(DEFAULT_BINDINGS.map((b) => [b.id, b.accelerator]))
    return this.bindings.map((b) => ({
      id: b.id,
      command: b.command,
      accelerator: b.accelerator,
      default: defaults.get(b.id) ?? b.accelerator,
      ...(b.scope ? { scope: b.scope } : {}),
      ...(b.payload !== undefined ? { payload: b.payload } : {}),
      title: bindingTitle(b),
      overridden: Boolean(overrides[b.id])
    }))
  }

  /** the binding that already uses an accelerator in the same scope (bindings of the same action do not conflict) */
  conflict(id: string, accelerator: string): Binding | undefined {
    const target = this.bindings.find((b) => b.id === id)
    const norm = normalizeAccelerator(accelerator)
    if (!target || !norm) return undefined
    const action = JSON.stringify(bindingAction(target))
    return this.bindings.find(
      (b) =>
        b.id !== id &&
        (b.scope ?? 'main') === (target.scope ?? 'main') &&
        normalizeAccelerator(b.accelerator) === norm &&
        JSON.stringify(bindingAction(b)) !== action
    )
  }

  set(id: string, accelerator: string): SetResult {
    const target = DEFAULT_BINDINGS.find((b) => b.id === id)
    if (!target) return { ok: false, error: `No shortcut called ${id}.` }
    const norm = normalizeAccelerator(accelerator)
    if (!norm) return { ok: false, error: 'That is not a key combination.' }
    const hasModifier = /(^|\+)(cmd|ctrl|alt)\+/.test(norm)
    if (!hasModifier && !/(^|\+)f\d{1,2}$/.test(norm)) return { ok: false, error: 'Shortcuts need Command, Control or Option (or a function key).' }
    const other = this.conflict(id, accelerator)
    if (other) return { ok: false, error: `Already used by ${bindingTitle(other)}.`, conflict: { id: other.id, title: bindingTitle(other) } }
    const isDefault = normalizeAccelerator(target.accelerator) === norm
    this.core.store.update((s) => {
      const next = { ...(s.settings.shortcuts ?? {}) }
      if (isDefault) delete next[id]
      else next[id] = accelerator
      s.settings.shortcuts = next
    })
    this.reload()
    return { ok: true, accelerator: isDefault ? target.accelerator : accelerator }
  }

  reset(id?: string): boolean {
    if (id && !DEFAULT_BINDINGS.some((b) => b.id === id)) return false
    this.core.store.update((s) => {
      if (!id) s.settings.shortcuts = {}
      else {
        const next = { ...(s.settings.shortcuts ?? {}) }
        delete next[id]
        s.settings.shortcuts = next
      }
    })
    this.reload()
    return true
  }
}

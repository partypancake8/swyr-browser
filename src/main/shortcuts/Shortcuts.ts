// Keyboard shortcuts: menu accelerators for most bindings, before-input-event for the rest.
import type { Event, Input } from 'electron'
import { resolveBindings, type Binding } from '@shared/commands'
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
  enter: 'Enter',
  escape: 'Escape',
  space: 'Space'
}

export function keyCode(key: string): string {
  const k = key.toLowerCase()
  if (NAMED_CODES[k]) return NAMED_CODES[k]
  if (/^[a-z]$/.test(k)) return `Key${k.toUpperCase()}`
  if (/^[0-9]$/.test(k)) return `Digit${k}`
  return key
}

export function parseAccelerator(accel: string, binding: Binding): Matcher {
  const parts = accel.split('+').filter(Boolean)
  const m: Matcher = { meta: false, ctrl: false, alt: false, shift: false, code: '', binding }
  for (const raw of parts) {
    const p = raw.toLowerCase()
    if (p === 'cmd' || p === 'command' || p === 'cmdorctrl' || p === 'commandorcontrol' || p === 'meta') m.meta = true
    else if (p === 'ctrl' || p === 'control') m.ctrl = true
    else if (p === 'alt' || p === 'option') m.alt = true
    else if (p === 'shift') m.shift = true
    else m.code = keyCode(raw)
  }
  return m
}

export class Shortcuts {
  bindings: Binding[] = []
  private raw: Matcher[] = []

  constructor(private readonly core: Core) {
    this.reload()
  }

  reload(): void {
    this.bindings = resolveBindings(this.core.store.state.settings.shortcuts)
    this.raw = this.bindings.filter((b) => b.raw).map((b) => parseAccelerator(b.accelerator, b))
  }

  /** accelerator of the first binding of a command (optionally with a payload) */
  accelerator(command: string, payload?: unknown): Binding | undefined {
    const key = payload === undefined ? undefined : JSON.stringify(payload)
    return this.bindings.find((b) => b.command === command && (key === undefined ? !b.payload : JSON.stringify(b.payload) === key))
  }

  handleInput(event: Event, input: Input, w: SwyrWindow): void {
    if (input.type !== 'keyDown') return
    for (const m of this.raw) {
      if (
        m.code === input.code &&
        m.meta === input.meta &&
        m.ctrl === input.control &&
        m.alt === input.alt &&
        m.shift === input.shift
      ) {
        event.preventDefault()
        void this.core.commands.run(m.binding.command, m.binding.payload, w).catch((err) => console.error('[swyr]', err))
        return
      }
    }
  }
}

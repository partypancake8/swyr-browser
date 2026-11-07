// The command registry: every user action is a named command with a payload.
import type { Core } from '../windows/WindowManager'
import type { SwyrWindow } from '../windows/SwyrWindow'

export interface CommandContext {
  core: Core
  /** the window the command runs in (undefined only when no window is open) */
  w: SwyrWindow | undefined
}

export type CommandHandler = (ctx: CommandContext, payload: Record<string, unknown>) => unknown | Promise<unknown>

export class Commands {
  private readonly handlers = new Map<string, CommandHandler>()

  constructor(private readonly core: Core) {}

  register(name: string, handler: CommandHandler): void {
    this.handlers.set(name, handler)
  }

  has(name: string): boolean {
    return this.handlers.has(name)
  }

  names(): string[] {
    return [...this.handlers.keys()]
  }

  async run(name: string, payload?: unknown, w?: SwyrWindow): Promise<unknown> {
    const handler = this.handlers.get(name)
    if (!handler) throw new Error(`unknown command: ${name}`)
    const p = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
    return handler({ core: this.core, w: w && !w.closed ? w : this.core.current() }, p)
  }
}

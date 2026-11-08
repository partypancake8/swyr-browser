// Single JSON document at userData/state.json with debounced atomic writes.
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { SCHEMA_VERSION, type PersistedState } from '@shared/types'
import { defaultSettings, defaultState } from './defaults'
import { migrateSpaceIcon } from './migrateIcons'
import { SECRET_NAMES, adoptLegacySecrets } from '../secrets/Secrets'

/** secrets never reach state.json, even if a bug puts one into the state */
const SECRET_KEYS = new Set<string>(SECRET_NAMES)
const withoutSecrets = (key: string, value: unknown): unknown => (SECRET_KEYS.has(key) ? undefined : value)

type Listener = (state: PersistedState) => void

const WRITE_DELAY_MS = 250
const ARCHIVE_LIMIT = 2000

/** upgrade an older document in place; add a case per schema bump */
export function migrate(raw: Record<string, unknown>): PersistedState {
  const version = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 0
  const base = defaultState()
  const s = raw as Partial<PersistedState>
  const out: PersistedState = {
    schemaVersion: SCHEMA_VERSION,
    profiles: Array.isArray(s.profiles) && s.profiles.length ? s.profiles : base.profiles,
    spaces: Array.isArray(s.spaces) ? s.spaces : [],
    // round 5: tabs of blank windows never outlive their window
    items: Array.isArray(s.items) ? s.items.filter((i) => i && i.blankWindow === undefined) : [],
    archive: Array.isArray(s.archive) ? s.archive : [],
    settings: { ...defaultSettings(), ...(s.settings ?? {}) },
    styles: Array.isArray(s.styles) ? s.styles : []
  }
  if (version < 1) {
    // version 0 had no schema field; nothing else to convert yet
  }
  // spaces carried an emoji before 0.2.3; they now carry a Lucide icon name
  for (const sp of out.spaces) if (sp && typeof sp === 'object') migrateSpaceIcon(sp as unknown as Record<string, unknown>)
  if (!out.spaces.length) {
    const space = base.spaces[0]
    space.profileId = out.profiles[0].id
    out.spaces = [space]
  }
  return out
}

export class Store {
  state: PersistedState
  readonly file: string
  private timer: NodeJS.Timeout | null = null
  private listeners = new Set<Listener>()
  private notifyQueued = false

  constructor(dir = app.getPath('userData')) {
    this.file = path.join(dir, 'state.json')
    this.state = this.load()
    // older versions kept the GitHub token in settings: it moves to the encrypted secrets file
    adoptLegacySecrets(this.state.settings as unknown as Record<string, unknown>)
    this.scheduleWrite()
  }

  private load(): PersistedState {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'))
      return migrate(raw)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        try {
          fs.copyFileSync(this.file, this.file + '.corrupt-' + Date.now())
        } catch {
          /* ignore */
        }
      }
      return defaultState()
    }
  }

  onChange(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  /** mutate state, then persist and broadcast */
  update(fn: (s: PersistedState) => void): void {
    fn(this.state)
    if (this.state.archive.length > ARCHIVE_LIMIT) this.state.archive.splice(0, this.state.archive.length - ARCHIVE_LIMIT)
    this.changed()
  }

  /** persist and broadcast after a direct mutation */
  changed(): void {
    this.scheduleWrite()
    this.notify()
  }

  notify(): void {
    if (this.notifyQueued) return
    this.notifyQueued = true
    queueMicrotask(() => {
      this.notifyQueued = false
      for (const l of this.listeners) l(this.state)
    })
  }

  private scheduleWrite(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), WRITE_DELAY_MS)
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    const tmp = this.file + '.tmp'
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      fs.writeFileSync(tmp, JSON.stringify(this.state, withoutSecrets, 1))
      fs.renameSync(tmp, this.file)
    } catch (err) {
      console.error('[swyr] state write failed', err)
    }
  }
}

// Secrets (the GitHub token for Live Folders, and any later token) live in userData/secrets.bin, encrypted with
// Electron safeStorage, which keeps its key in the macOS Keychain. They never enter state.json or the state sent
// to renderers; renderers only learn whether a secret is set.
// Headless test runs (SWYR_TEST=1) do not touch the login Keychain: they encrypt with a per-run key held in memory
// (AES-256-GCM), so the file on disk is still never plaintext.
import { app, safeStorage } from 'electron'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export type SecretName = 'githubToken'
export const SECRET_NAMES: readonly SecretName[] = ['githubToken']

const TEST = process.env.SWYR_TEST === '1' && process.env.SWYR_TEST_KEYCHAIN !== '1'
const testKey = TEST ? crypto.randomBytes(32) : null

interface SecretsFile {
  v: 1
  mode: 'safeStorage' | 'test'
  data: string
}

function encrypt(plain: string): SecretsFile | null {
  if (testKey) {
    const iv = crypto.randomBytes(12)
    const c = crypto.createCipheriv('aes-256-gcm', testKey, iv)
    const body = Buffer.concat([c.update(plain, 'utf8'), c.final()])
    return { v: 1, mode: 'test', data: Buffer.concat([iv, c.getAuthTag(), body]).toString('base64') }
  }
  if (!safeStorage.isEncryptionAvailable()) return null
  return { v: 1, mode: 'safeStorage', data: safeStorage.encryptString(plain).toString('base64') }
}

function decrypt(f: SecretsFile): string | null {
  try {
    const buf = Buffer.from(f.data, 'base64')
    if (f.mode === 'test') {
      if (!testKey) return null
      const d = crypto.createDecipheriv('aes-256-gcm', testKey, buf.subarray(0, 12))
      d.setAuthTag(buf.subarray(12, 28))
      return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8')
    }
    if (f.mode === 'safeStorage' && !testKey && safeStorage.isEncryptionAvailable()) return safeStorage.decryptString(buf)
  } catch {
    /* a file from another key or a damaged file reads as empty */
  }
  return null
}

export class Secrets {
  readonly file: string
  private values: Partial<Record<SecretName, string>> | null = null

  constructor(dir = app.getPath('userData')) {
    this.file = path.join(dir, 'secrets.bin')
  }

  private load(): Partial<Record<SecretName, string>> {
    if (this.values) return this.values
    this.values = {}
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as SecretsFile
      const plain = raw && raw.v === 1 && typeof raw.data === 'string' ? decrypt(raw) : null
      const parsed = plain ? (JSON.parse(plain) as Record<string, unknown>) : {}
      for (const name of SECRET_NAMES) if (typeof parsed[name] === 'string') this.values[name] = parsed[name] as string
    } catch {
      /* no secrets yet */
    }
    return this.values
  }

  get(name: SecretName): string | undefined {
    return this.load()[name]
  }

  has(name: SecretName): boolean {
    return Boolean(this.get(name))
  }

  /** set or clear (empty or undefined) a secret, then write the encrypted file */
  set(name: SecretName, value: string | undefined): void {
    const values = this.load()
    if (value) values[name] = value
    else delete values[name]
    this.write()
  }

  private write(): void {
    const values = this.load()
    try {
      if (!Object.keys(values).length) {
        fs.rmSync(this.file, { force: true })
        return
      }
      const enc = encrypt(JSON.stringify(values))
      // without a working Keychain the secret stays in memory for this run only, never on disk in the clear
      if (!enc) return console.warn('[swyr] safeStorage is unavailable; the token is kept in memory only')
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      const tmp = this.file + '.tmp'
      fs.writeFileSync(tmp, JSON.stringify(enc), { mode: 0o600 })
      fs.renameSync(tmp, this.file)
    } catch (err) {
      console.error('[swyr] secrets write failed', err)
    }
  }
}

let shared: Secrets | null = null
export function secrets(): Secrets {
  if (!shared) shared = new Secrets()
  return shared
}

/** what renderers may know about secrets: only whether each one is set */
export function secretsView(): Record<SecretName, boolean> {
  const s = secrets()
  return { githubToken: s.has('githubToken') }
}

/** a GitHub token as typed: trimmed, printable ASCII only, at most 512 characters; '' clears it */
export function cleanToken(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  if (t.length > 512 || /[^\x21-\x7e]/.test(t)) return null
  return t
}

/** state.json from older versions kept the token in settings: move it into the encrypted store */
export function adoptLegacySecrets(settings: Record<string, unknown>): boolean {
  let moved = false
  for (const name of SECRET_NAMES) {
    const v = settings[name]
    if (typeof v === 'string' && v) {
      if (!secrets().has(name)) secrets().set(name, v)
      moved = true
    }
    if (name in settings) delete settings[name]
  }
  return moved
}

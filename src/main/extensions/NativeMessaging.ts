// Chrome native messaging (chrome.runtime.sendNativeMessage / connectNative) for extensions, replacing the partial
// handlers in electron-chrome-extensions: Chrome's host manifest lookup and validation, length-prefixed framing that
// buffers partial reads, Chrome's size limits, and Chrome's error strings. Errors travel back to the extension as
// { [NATIVE_ERROR_KEY]: message } (the library's preload swallows thrown errors); the swyr extension preload turns that
// into chrome.runtime.lastError or a rejected promise.
import { app } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const NATIVE_ERROR_KEY = '__swyrNativeError'
export const NATIVE_DISCONNECT_KEY = '__swyrNativeDisconnect'

/** Chrome's own lastError texts */
export const NativeErrors = {
  notFound: 'Specified native messaging host not found.',
  forbidden: 'Access to the specified native messaging host is forbidden.',
  invalidName: 'Invalid native messaging host name specified.',
  failedToStart: 'Failed to start native messaging host.',
  exited: 'Native host has exited.',
  comm: 'Error when communicating with the native messaging host.'
} as const

/** largest message a host may send (Chrome: 1 MB) and the largest we send to it (Chrome: 64 MB) */
export const MAX_FROM_HOST = 1024 * 1024
export const MAX_TO_HOST = 64 * 1024 * 1024

export interface HostManifest {
  name: string
  description?: string
  path: string
  type: 'stdio'
  allowed_origins: string[]
  /** the manifest file it came from */
  file: string
}

export type Lookup = { ok: true; manifest: HostManifest } | { ok: false; error: string }

const NAME_RE = /^([a-z0-9_]+\.)*[a-z0-9_]+$/

/**
 * host manifest directories, in lookup order: swyr's own (<userData>/NativeMessagingHosts) first, then Chrome's and
 * Chromium's. Nothing else is honoured: a host is never looked up in a path a page or extension supplies, and the
 * SWYR_NATIVE_HOST_DIRS override works only in headless test runs.
 */
export function hostDirs(): string[] {
  const override = process.env.SWYR_TEST === '1' ? process.env.SWYR_NATIVE_HOST_DIRS : undefined
  if (override !== undefined) return override.split(path.delimiter).filter((d) => path.isAbsolute(d))
  const home = os.homedir()
  const own = path.join(app.getPath('userData'), 'NativeMessagingHosts')
  if (process.platform === 'darwin') {
    const lib = path.join(home, 'Library', 'Application Support')
    return [
      own,
      path.join(lib, 'Google', 'Chrome', 'NativeMessagingHosts'),
      '/Library/Google/Chrome/NativeMessagingHosts',
      path.join(lib, 'Chromium', 'NativeMessagingHosts'),
      '/Library/Application Support/Chromium/NativeMessagingHosts'
    ]
  }
  return [
    own,
    path.join(home, '.config', 'google-chrome', 'NativeMessagingHosts'),
    '/etc/opt/chrome/native-messaging-hosts',
    path.join(home, '.config', 'chromium', 'NativeMessagingHosts'),
    '/etc/chromium/native-messaging-hosts'
  ]
}

/** finds and validates the host manifest for `name` as seen by `origin` (chrome-extension://<id>/) */
export function findHost(name: string, origin: string, dirs = hostDirs()): Lookup {
  if (typeof name !== 'string' || !NAME_RE.test(name)) return { ok: false, error: NativeErrors.invalidName }
  let forbidden = false
  for (const dir of dirs) {
    const file = path.join(dir, `${name}.json`)
    let raw: unknown
    try {
      raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch {
      continue
    }
    const m = raw as Partial<HostManifest>
    if (!m || m.name !== name || m.type !== 'stdio' || typeof m.path !== 'string' || !m.path) continue
    // a Mozilla manifest lists allowed_extensions instead of origins: it cannot grant a Chrome origin
    if (!Array.isArray(m.allowed_origins) || !m.allowed_origins.includes(origin)) {
      forbidden = true
      continue
    }
    const exe = path.isAbsolute(m.path) ? m.path : path.resolve(dir, m.path)
    return { ok: true, manifest: { name, description: m.description, path: exe, type: 'stdio', allowed_origins: m.allowed_origins, file } }
  }
  return { ok: false, error: forbidden ? NativeErrors.forbidden : NativeErrors.notFound }
}

/** 4-byte little-endian length then UTF-8 JSON */
export function encodeFrame(message: unknown): Buffer {
  const json = JSON.stringify(message)
  if (json === undefined) throw new Error(NativeErrors.comm)
  const body = Buffer.from(json, 'utf8')
  if (body.length > MAX_TO_HOST) throw new Error(NativeErrors.comm)
  const head = Buffer.alloc(4)
  head.writeUInt32LE(body.length, 0)
  return Buffer.concat([head, body])
}

/** splits a growing stdout buffer into messages; throws on an oversized or malformed frame */
export class FrameReader {
  private buf: Buffer = Buffer.alloc(0)
  push(chunk: Buffer): unknown[] {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk
    const out: unknown[] = []
    while (this.buf.length >= 4) {
      const len = this.buf.readUInt32LE(0)
      if (len > MAX_FROM_HOST) throw new Error(NativeErrors.comm)
      if (this.buf.length < 4 + len) break
      const body = this.buf.subarray(4, 4 + len).toString('utf8')
      this.buf = this.buf.subarray(4 + len)
      out.push(JSON.parse(body))
    }
    return out
  }
}

export interface HostEvents {
  message(msg: unknown): void
  /** called once; error is a Chrome lastError text, or undefined for a clean close by the extension */
  closed(error: string | undefined): void
}

/** one running native host process */
export class NativeHost {
  private proc: ChildProcess | null = null
  private readonly reader = new FrameReader()
  private done = false

  constructor(
    readonly manifest: HostManifest,
    readonly origin: string,
    private readonly events: HostEvents
  ) {}

  start(): void {
    let proc: ChildProcess
    try {
      fs.accessSync(this.manifest.path, fs.constants.X_OK)
      // Chrome passes the caller origin as the first argument and runs the host from its own directory
      proc = spawn(this.manifest.path, [this.origin], { cwd: path.dirname(this.manifest.path), stdio: ['pipe', 'pipe', 'pipe'], shell: false })
    } catch {
      return this.finish(NativeErrors.failedToStart)
    }
    this.proc = proc
    proc.on('error', () => this.finish(NativeErrors.failedToStart))
    proc.on('exit', () => this.finish(NativeErrors.exited))
    proc.stdin?.on('error', () => this.finish(NativeErrors.exited))
    proc.stderr?.on('data', (d: Buffer) => {
      if (process.env.SWYR_NATIVE_DEBUG) console.warn(`[swyr] native host ${this.manifest.name}:`, d.toString().trimEnd())
    })
    if (process.env.SWYR_NATIVE_DEBUG) console.warn(`[swyr] native host ${this.manifest.name} started for ${this.origin}`)
    proc.stdout?.on('data', (chunk: Buffer) => {
      let msgs: unknown[]
      try {
        msgs = this.reader.push(chunk)
      } catch {
        return this.finish(NativeErrors.comm)
      }
      if (process.env.SWYR_NATIVE_DEBUG && msgs.length) console.warn(`[swyr] native host ${this.manifest.name} sent ${msgs.length} message(s)`)
      for (const m of msgs) if (!this.done) this.events.message(m)
    })
  }

  post(message: unknown): void {
    if (this.done || !this.proc?.stdin) return
    let frame: Buffer
    try {
      frame = encodeFrame(message)
    } catch {
      return this.finish(NativeErrors.comm)
    }
    this.proc.stdin.write(frame)
  }

  /** the extension closed the connection: close stdin, then make sure the process goes away */
  close(): void {
    this.finish(undefined)
  }

  get closed(): boolean {
    return this.done
  }

  private finish(error: string | undefined): void {
    if (this.done) return
    if (process.env.SWYR_NATIVE_DEBUG) console.warn(`[swyr] native host ${this.manifest.name} closed: ${error ?? 'by the extension'}`)
    this.done = true
    const proc = this.proc
    this.proc = null
    if (proc) {
      try {
        proc.stdin?.end()
      } catch {
        /* already closed */
      }
      if (proc.exitCode === null && proc.signalCode === null) {
        const t = setTimeout(() => proc.kill('SIGTERM'), 2000)
        t.unref?.()
        proc.once('exit', () => clearTimeout(t))
      }
    }
    this.events.closed(error)
  }
}

/** what a library api handler receives as the caller */
interface Sender {
  send(channel: string, ...args: unknown[]): void
  ipc: { on(channel: string, fn: (...args: unknown[]) => void): unknown; off(channel: string, fn: (...args: unknown[]) => void): unknown }
  startTask?: () => { end(): void }
  isDestroyed?: () => boolean
  once?: (event: string, fn: () => void) => unknown
}
interface ApiEvent {
  sender: Sender
  extension: Electron.Extension
}
interface Router {
  handle(name: string, cb: (event: ApiEvent, ...args: unknown[]) => unknown, opts?: { permission?: string }): void
}

const errorReply = (message: string): Record<string, string> => ({ [NATIVE_ERROR_KEY]: message })

/** registers swyr's runtime.sendNativeMessage / connectNative / disconnectNative on an extensions router */
export function installNativeMessaging(router: Router): void {
  const ports = new Map<string, NativeHost>()

  router.handle(
    'runtime.sendNativeMessage',
    async (event, application, message) => {
      const origin = `chrome-extension://${event.extension.id}/`
      const found = findHost(String(application), origin)
      if (!found.ok) return errorReply(found.error)
      return new Promise((resolve) => {
        let answered = false
        const host = new NativeHost(found.manifest, origin, {
          message: (msg) => {
            if (answered) return
            answered = true
            resolve(msg)
            host.close()
          },
          closed: (error) => {
            if (!answered) resolve(errorReply(error ?? NativeErrors.exited))
            answered = true
          }
        })
        host.start()
        host.post(message)
      })
    },
    { permission: 'nativeMessaging' }
  )

  router.handle(
    'runtime.connectNative',
    (event, connectionId, application) => {
      const id = typeof connectionId === 'string' && connectionId ? connectionId : randomUUID()
      const sender = event.sender
      const origin = `chrome-extension://${event.extension.id}/`
      const channel = `crx-native-msg-${id}`
      const alive = (): boolean => !sender.isDestroyed?.()
      // a service worker stays running while its native port is open, like Chrome
      let task: { end(): void } | undefined
      try {
        task = sender.startTask?.()
      } catch {
        task = undefined
      }
      const ref: { host?: NativeHost } = {}
      const fromExtension = (_e: unknown, msg: unknown): void => ref.host?.post(msg)
      const disconnect = (error: string | undefined): void => {
        ports.delete(id)
        sender.ipc.off(channel, fromExtension as (...a: unknown[]) => void)
        task?.end()
        task = undefined
        if (!alive()) return
        try {
          if (error) sender.send(channel, { [NATIVE_DISCONNECT_KEY]: error })
          sender.send(`${channel}-disconnect`)
        } catch {
          /* the caller went away */
        }
      }
      sender.ipc.on(channel, fromExtension as (...a: unknown[]) => void)
      const found = findHost(String(application), origin)
      if (!found.ok) {
        // Chrome reports a missing host through onDisconnect, after connectNative returns
        setTimeout(() => disconnect(found.error), 0)
        return
      }
      const h = new NativeHost(found.manifest, origin, {
        message: (msg) => {
          if (!alive()) return h.close()
          try {
            sender.send(channel, msg)
          } catch {
            h.close()
          }
        },
        closed: (error) => disconnect(error)
      })
      ref.host = h
      ports.set(id, h)
      sender.once?.('destroyed', () => h.close())
      h.start()
    },
    { permission: 'nativeMessaging' }
  )

  router.handle(
    'runtime.disconnectNative',
    (_event, connectionId) => {
      const host = ports.get(String(connectionId))
      host?.close()
    },
    { permission: 'nativeMessaging' }
  )
}

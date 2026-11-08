// Permission prompts. A web page that asks for notifications, location, camera, microphone, MIDI, clipboard
// reading, pointer lock and the like gets a prompt in its window's overlay (OverlayState kind 'permission') with
// Allow and Block. The answer is remembered per site (settings.sitePermissions, or in memory for private windows),
// a prompt nobody answers in 60 seconds is denied, and closing the prompt without answering denies once.
// Mini Windows have no overlay: they ask with a sheet on the Mini Window (denied in headless test runs).
import { dialog, type Session, type WebContents } from 'electron'
import type { PermissionOverlay, SitePermission } from '@shared/types'
import type { Core } from '../windows/WindowManager'
import type { SwyrWindow } from '../windows/SwyrWindow'
import { classify } from '../security/IpcGuard'
import { newId } from '../util/id'
import { checkPolicy, decisions, isPrivateSession, markPrivateSession, originOf, permissionsFor, remembered, requestPolicy, setDecision } from './SiteSettings'

export const PROMPT_TIMEOUT_MS = 60_000

const LABELS: Record<SitePermission, string> = {
  camera: 'use your camera',
  microphone: 'use your microphone',
  notifications: 'show notifications',
  location: 'know your location',
  clipboard: 'see text and images you copy',
  midi: 'use your MIDI devices',
  pointerLock: 'hide and lock your pointer',
  keyboardLock: 'capture your keyboard',
  idleDetection: 'know when you are away',
  windowManagement: 'manage windows on your displays',
  localFonts: 'use the fonts on this Mac',
  localNetwork: 'connect to devices on your network'
}

export function describePermissions(perms: SitePermission[]): string {
  const parts = perms.map((p) => LABELS[p] ?? p)
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : (parts[0] ?? '')
}

interface Prompt {
  id: string
  wc: WebContents
  ses: Session
  origin: string
  perms: SitePermission[]
  callbacks: Array<(allow: boolean) => void>
  timer: NodeJS.Timeout
}

const queues = new Map<SwyrWindow, Prompt[]>()
let coreRef: Core | null = null

function hostOf(origin: string): string {
  try {
    return new URL(origin).host || origin
  } catch {
    return origin
  }
}

function overlayFor(p: Prompt): Omit<PermissionOverlay, 'seq'> {
  return { kind: 'permission', promptId: p.id, origin: p.origin, host: hostOf(p.origin), permission: p.perms[0], permissions: p.perms, incognito: isPrivateSession(p.ses) }
}

function show(w: SwyrWindow): void {
  const head = queues.get(w)?.[0]
  if (!head || w.closed) return
  if (w.overlayState?.kind === 'permission' && w.overlayState.promptId === head.id) return
  w.openOverlay(overlayFor(head))
}

/** settle a prompt: every request waiting on it gets the answer; remember: store the decision for the site */
function settle(w: SwyrWindow, prompt: Prompt, allow: boolean, remember: boolean): void {
  const q = queues.get(w) ?? []
  const i = q.indexOf(prompt)
  if (i < 0) return
  q.splice(i, 1)
  if (!q.length) queues.delete(w)
  clearTimeout(prompt.timer)
  if (remember && coreRef) for (const perm of prompt.perms) setDecision(coreRef, prompt.origin, perm, allow ? 'allow' : 'deny', prompt.ses)
  for (const cb of prompt.callbacks.splice(0)) {
    try {
      cb(allow)
    } catch {
      /* the page went away */
    }
  }
  if (w.closed) return
  const showing = w.overlayState?.kind === 'permission' && w.overlayState.promptId === prompt.id
  if (q.length) {
    if (showing || !w.overlayState) show(w)
  } else if (showing) {
    w.closeOverlay()
  }
}

/** permission.respond: answer the prompt on screen in this window (or the one named by promptId) */
export function respond(w: SwyrWindow | undefined, allow: boolean, promptId?: string, remember = true): boolean {
  if (!w) return false
  const q = queues.get(w)
  const prompt = promptId ? q?.find((p) => p.id === promptId) : q?.[0]
  if (!prompt) return false
  settle(w, prompt, allow, remember)
  return true
}

/** the window's overlay closed: a dismissed prompt denies once; a prompt hidden behind another overlay comes back */
export function onOverlayClosed(w: SwyrWindow, closed: { kind: string; promptId?: string } | null): void {
  const q = queues.get(w)
  if (!q?.length) return
  if (closed?.kind === 'permission') {
    const prompt = q.find((p) => p.id === closed.promptId)
    if (prompt) return settle(w, prompt, false, false)
  }
  setImmediate(() => {
    if (!w.closed && !w.overlayState) show(w)
  })
}

/** the window closed or a page went away: deny what it was still asking */
function dropFor(match: (p: Prompt) => boolean): void {
  for (const [w, q] of [...queues]) for (const p of [...q]) if (match(p)) settle(w, p, false, false)
}

export function pendingPrompts(w: SwyrWindow): number {
  return queues.get(w)?.length ?? 0
}

function ask(core: Core, wc: WebContents, ses: Session, origin: string, perms: SitePermission[], callback: (allow: boolean) => void): void {
  const sender = classify(wc)
  const w = sender?.w
  if (!w || (sender.role !== 'webPage' && sender.role !== 'previewPage')) {
    // a Mini Window asks with a sheet on its own window; anything else (extension popups, hidden pages) is denied
    if (sender?.role === 'miniPage' && sender.mini && !core.test) {
      const win = sender.mini.win
      void dialog
        .showMessageBox(win, {
          type: 'question',
          buttons: ['Allow', 'Block'],
          defaultId: 1,
          cancelId: 1,
          message: `${hostOf(origin)} wants to ${describePermissions(perms)}`,
          detail: isPrivateSession(ses) ? 'swyr forgets this answer when the window closes.' : 'swyr remembers this answer for the site. Change it in Site Settings.'
        })
        .then((r) => {
          const allow = r.response === 0
          for (const perm of perms) setDecision(core, origin, perm, allow ? 'allow' : 'deny', ses)
          callback(allow)
        })
        .catch(() => callback(false))
      return
    }
    return callback(false)
  }
  const q = queues.get(w) ?? []
  const same = q.find((p) => p.wc === wc && p.origin === origin && p.perms.join() === perms.join())
  if (same) {
    same.callbacks.push(callback)
    return
  }
  const prompt: Prompt = {
    id: newId('perm'),
    wc,
    ses,
    origin,
    perms,
    callbacks: [callback],
    timer: setTimeout(() => settle(w, prompt, false, false), PROMPT_TIMEOUT_MS)
  }
  prompt.timer.unref?.()
  q.push(prompt)
  queues.set(w, q)
  if (!watched.has(wc)) {
    watched.add(wc)
    wc.once('destroyed', () => dropFor((p) => p.wc === wc))
    wc.on('did-start-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument) dropFor((p) => p.wc === wc)
    })
  }
  if (!w.overlayState || w.overlayState.kind === 'toast' || q.length === 1) show(w)
}

const watched = new WeakSet<WebContents>()

/** install the prompting permission handlers on a profile session */
export function attachPermissions(core: Core, ses: Session, incognito: boolean): void {
  coreRef = core
  if (incognito) markPrivateSession(ses)
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    const mediaTypes = (details as { mediaTypes?: string[] }).mediaTypes
    const origin = originOf(details.requestingUrl || wc?.getURL())
    const policy = requestPolicy(permission, origin, mediaTypes)
    if (policy !== 'ask') return callback(policy === 'allow')
    const perms = permissionsFor(permission, mediaTypes)
    const known = remembered(decisions(core, origin, ses), perms)
    if (known !== null) return callback(known)
    if (!wc || wc.isDestroyed()) return callback(false)
    ask(core, wc, ses, origin, perms, callback)
  })
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin, details) => {
    const mediaType = (details as { mediaType?: string }).mediaType
    return checkPolicy(core, permission, originOf(requestingOrigin), mediaType, ses)
  })
}

/** swyr's own UI session (shell, overlay, Mini Window bar): clipboard writes and fullscreen only */
export function attachUiPermissions(ses: Session): void {
  const ok = new Set(['clipboard-sanitized-write', 'fullscreen'])
  const dev = process.env.ELECTRON_RENDERER_URL ? originOf(process.env.ELECTRON_RENDERER_URL) : ''
  const ours = (url: string): boolean => {
    const o = originOf(url)
    return o.startsWith('swyr:') || (Boolean(dev) && o === dev)
  }
  ses.setPermissionRequestHandler((_wc, permission, callback, details) => callback(ok.has(permission) && ours(details.requestingUrl)))
  ses.setPermissionCheckHandler((_wc, permission, origin) => ok.has(permission) && ours(origin))
}

/** a window closed: its pending prompts are denied */
export function forgetWindow(w: SwyrWindow): void {
  dropFor((p) => queues.get(w)?.includes(p) ?? false)
  queues.delete(w)
}

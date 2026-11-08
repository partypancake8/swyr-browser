// Site permissions: what each Electron permission request means for swyr, and the decisions remembered per origin.
// Regular profiles keep decisions in settings.sitePermissions (Site Settings lists, changes and resets them);
// private windows keep them in memory for the life of the window. The prompt itself is in PermissionPrompts.ts.
// Type imports only, so tests/unit-3a.mjs and tests/security.mjs can load this file directly.
import type { Session } from 'electron'
import type { PermissionDecision, SitePermission } from '@shared/types'
import type { Core } from '../windows/WindowManager'

export const SITE_PERMISSIONS: SitePermission[] = [
  'camera',
  'microphone',
  'notifications',
  'location',
  'clipboard',
  'midi',
  'pointerLock',
  'keyboardLock',
  'idleDetection',
  'windowManagement',
  'localFonts',
  'localNetwork'
]

/** permissions Chrome grants without asking: allowed for every site */
export const AUTO_ALLOW = new Set([
  'clipboard-sanitized-write',
  'fullscreen',
  'mediaKeySystem',
  'persistent-storage',
  'screen-wake-lock',
  'background-sync',
  'background-fetch',
  'periodic-background-sync',
  'sensors',
  'speaker-selection',
  'storage-access',
  'top-level-storage-access',
  // the File System Access API asks through the file picker itself
  'fileSystem'
])

/** the swyr permission names an Electron permission request stands for ([] when it never prompts) */
export function permissionsFor(permission: string, mediaTypes?: string[]): SitePermission[] {
  switch (permission) {
    case 'media': {
      const out: SitePermission[] = []
      const types = mediaTypes && mediaTypes.length ? mediaTypes : ['audio', 'video']
      if (types.includes('video')) out.push('camera')
      if (types.includes('audio')) out.push('microphone')
      return out
    }
    case 'notifications':
      return ['notifications']
    case 'geolocation':
    case 'geolocation-approximate':
      return ['location']
    case 'clipboard-read':
    case 'deprecated-sync-clipboard-read':
      return ['clipboard']
    case 'midi':
    case 'midiSysex':
      return ['midi']
    case 'pointerLock':
      return ['pointerLock']
    case 'keyboardLock':
      return ['keyboardLock']
    case 'idle-detection':
      return ['idleDetection']
    case 'window-management':
      return ['windowManagement']
    case 'local-fonts':
      return ['localFonts']
    case 'local-network':
    case 'local-network-access':
    case 'loopback-network':
      return ['localNetwork']
    default:
      return []
  }
}

/** what to do with a request before looking at remembered decisions */
export function requestPolicy(permission: string, origin: string, mediaTypes?: string[]): 'allow' | 'deny' | 'ask' {
  if (!origin) return 'deny'
  if (permission === 'openExternal') return 'deny'
  if (AUTO_ALLOW.has(permission)) return 'allow'
  const perms = permissionsFor(permission, mediaTypes)
  if (!perms.length) return 'deny'
  // swyr's own pages: media and notifications without a prompt; nothing else
  if (origin.startsWith('swyr://')) return perms.every((p) => p === 'camera' || p === 'microphone' || p === 'notifications' || p === 'clipboard') ? 'allow' : 'deny'
  // extensions declare what they use in their manifest, as in Chrome
  if (origin.startsWith('chrome-extension://')) return perms.every((p) => p === 'notifications' || p === 'clipboard') ? 'allow' : 'deny'
  return 'ask'
}

export function originOf(url: string | undefined): string {
  if (!url) return ''
  try {
    const u = new URL(url)
    if (u.protocol === 'file:') return 'file://'
    return u.origin === 'null' ? '' : u.origin
  } catch {
    return ''
  }
}

type Decisions = Partial<Record<SitePermission, PermissionDecision>>

/** private window decisions: per session, in memory only */
const privateDecisions = new WeakMap<Session, Map<string, Decisions>>()
const privateSessions = new WeakSet<Session>()

export function markPrivateSession(ses: Session): void {
  privateSessions.add(ses)
}

export const isPrivateSession = (ses: Session | undefined | null): boolean => Boolean(ses && privateSessions.has(ses))

export function decisions(core: Core, origin: string, ses?: Session | null): Decisions {
  if (ses && privateSessions.has(ses)) return privateDecisions.get(ses)?.get(origin) ?? {}
  return core.store.state.settings.sitePermissions?.[origin] ?? {}
}

export function setDecision(core: Core, origin: string, perm: SitePermission, value: PermissionDecision | null, ses?: Session | null): void {
  if (ses && privateSessions.has(ses)) {
    let map = privateDecisions.get(ses)
    if (!map) privateDecisions.set(ses, (map = new Map()))
    const site = { ...(map.get(origin) ?? {}) }
    if (value) site[perm] = value
    else delete site[perm]
    if (Object.keys(site).length) map.set(origin, site)
    else map.delete(origin)
    core.store.notify()
    return
  }
  core.store.update((s) => {
    const all = { ...(s.settings.sitePermissions ?? {}) }
    const site = { ...(all[origin] ?? {}) }
    if (value) site[perm] = value
    else delete site[perm]
    if (Object.keys(site).length) all[origin] = site
    else delete all[origin]
    s.settings.sitePermissions = all
  })
}

/** the remembered answer for a request: allow when every permission it needs is allowed, deny when any is blocked */
export function remembered(site: Decisions, perms: SitePermission[]): boolean | null {
  if (perms.some((p) => site[p] === 'deny')) return false
  if (perms.length && perms.every((p) => site[p] === 'allow')) return true
  return null
}

/** the synchronous permission check (navigator.permissions, Notification.permission): granted only once allowed */
export function checkPolicy(core: Core, permission: string, origin: string, mediaType: string | undefined, ses?: Session | null): boolean {
  const policy = requestPolicy(permission, origin, mediaType && mediaType !== 'unknown' ? [mediaType] : undefined)
  if (policy !== 'ask') return policy === 'allow'
  const perms = permissionsFor(permission, mediaType && mediaType !== 'unknown' ? [mediaType] : undefined)
  return remembered(decisions(core, origin, ses), perms) === true
}

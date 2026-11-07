// Site permissions: requests from pages are recorded per origin in settings.sitePermissions so the
// Site Settings popover can list and revoke them. A recorded 'deny' blocks the permission for that origin.
import type { Session } from 'electron'
import type { PermissionDecision, SitePermission } from '@shared/types'
import type { Core } from '../windows/WindowManager'

export const SITE_PERMISSIONS: SitePermission[] = ['camera', 'microphone', 'notifications', 'location', 'clipboard']

/** the swyr permission names an Electron permission request stands for */
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
      return ['location']
    case 'clipboard-read':
    case 'clipboard-sanitized-write':
      return ['clipboard']
    default:
      return []
  }
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

export function decisions(core: Core, origin: string): Partial<Record<SitePermission, PermissionDecision>> {
  return core.store.state.settings.sitePermissions?.[origin] ?? {}
}

export function setDecision(core: Core, origin: string, perm: SitePermission, value: PermissionDecision | null): void {
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

const ALWAYS_DENY = new Set(['openExternal'])

/** install the recording permission handlers on a profile session */
export function attachPermissions(core: Core, ses: Session, incognito: boolean): void {
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    if (ALWAYS_DENY.has(permission)) return callback(false)
    const perms = permissionsFor(permission, (details as { mediaTypes?: string[] }).mediaTypes)
    const origin = originOf(details.requestingUrl || wc?.getURL())
    if (!perms.length || !origin) return callback(true)
    const site = decisions(core, origin)
    if (perms.some((p) => site[p] === 'deny')) return callback(false)
    // granted (swyr has no prompt yet): remember it so Site Settings can revoke it; private windows keep nothing
    if (!incognito) for (const p of perms) if (site[p] !== 'allow') setDecision(core, origin, p, 'allow')
    callback(true)
  })
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin, details) => {
    if (ALWAYS_DENY.has(permission)) return false
    const mediaType = (details as { mediaType?: string }).mediaType
    const perms = permissionsFor(permission, mediaType && mediaType !== 'unknown' ? [mediaType] : undefined)
    const origin = originOf(requestingOrigin)
    if (!perms.length || !origin) return true
    const site = decisions(core, origin)
    return !perms.some((p) => site[p] === 'deny')
  })
}

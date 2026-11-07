// One persistent session per profile, with a Chrome-like user agent and the swyr:// protocol.
import { app, session, type Session } from 'electron'
import type { Profile } from '@shared/types'
import { handleProtocol } from '../protocol/Protocol'

export function chromeLikeUserAgent(ua: string): string {
  return ua
    .replace(/\s(swyr|Electron)\/\S+/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

const sessions = new Map<string, Session>()
const profilesById = new Map<string, Profile>()
type SessionHook = (ses: Session, profile: Profile) => void
const hooks: SessionHook[] = []

/** extension point: extensions, ad blocking and downloads attach per session here */
export function onProfileSession(hook: SessionHook): void {
  hooks.push(hook)
  for (const [id, ses] of sessions) hook(ses, profilesById.get(id)!)
}

export function profileSession(profile: Profile): Session {
  const existing = sessions.get(profile.id)
  if (existing) return existing
  const ses = session.fromPartition(profile.partition || `persist:profile-${profile.id}`)
  ses.setUserAgent(chromeLikeUserAgent(ses.getUserAgent()))
  handleProtocol(ses)
  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    const deny = new Set(['openExternal'])
    callback(!deny.has(permission))
  })
  for (const hook of hooks) hook(ses, profile)
  sessions.set(profile.id, ses)
  profilesById.set(profile.id, profile)
  return ses
}

export function setupDefaultSession(): void {
  app.userAgentFallback = chromeLikeUserAgent(app.userAgentFallback)
  handleProtocol(session.defaultSession)
}

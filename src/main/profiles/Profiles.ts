// One session per profile, with Chrome's user agent and client hints (ChromeIdentity) and the swyr:// protocol.
// Persistent profiles use persist:profile-<id>; private windows use an in-memory incognito-<n> partition.
import { app, session, type Session } from 'electron'
import type { PersistedState, Profile } from '@shared/types'
import { handleProtocol } from '../protocol/Protocol'
import { newId } from '../util/id'
import { applyChromeIdentity, chromeLikeUserAgent } from './ChromeIdentity'

export { chromeLikeUserAgent } from './ChromeIdentity'

const sessions = new Map<string, Session>()
const profilesById = new Map<string, Profile>()
const partitions = new WeakMap<Session, string>()
type SessionHook = (ses: Session, profile: Profile) => void
const hooks: SessionHook[] = []

/** extension point: extensions, ad blocking and downloads attach per session here */
export function onProfileSession(hook: SessionHook): void {
  hooks.push(hook)
  for (const [id, ses] of sessions) hook(ses, profilesById.get(id)!)
}

export function partitionFor(profile: Profile): string {
  return profile.partition || `persist:profile-${profile.id}`
}

export function profileSession(profile: Profile): Session {
  const existing = sessions.get(profile.id)
  if (existing) return existing
  const partition = partitionFor(profile)
  const ses = session.fromPartition(partition)
  partitions.set(ses, partition)
  applyChromeIdentity(ses)
  handleProtocol(ses)
  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    const deny = new Set(['openExternal'])
    callback(!deny.has(permission))
  })
  sessions.set(profile.id, ses)
  profilesById.set(profile.id, profile)
  for (const hook of hooks) {
    try {
      hook(ses, profile)
    } catch (err) {
      console.error('[swyr] session hook failed', err)
    }
  }
  return ses
}

/** the sessions created so far, by profile id */
export function liveSessions(): Map<string, Session> {
  return sessions
}

export function profileOf(ses: Session): Profile | undefined {
  for (const [id, s] of sessions) if (s === ses) return profilesById.get(id)
  return undefined
}

/** the partition string a session was created from ('' for the default session) */
export function partitionOf(ses: Session | undefined): string {
  if (!ses) return ''
  return partitions.get(ses) ?? (ses === session.defaultSession ? '' : 'unknown')
}

/** drop a profile's session from the cache, clearing its data when asked (profile delete, private window close) */
export async function forgetProfileSession(profileId: string, clear: boolean): Promise<void> {
  const ses = sessions.get(profileId)
  sessions.delete(profileId)
  profilesById.delete(profileId)
  if (ses && clear) {
    try {
      await ses.clearStorageData()
      await ses.clearCache()
    } catch {
      /* ignore */
    }
  }
}

export function makeProfile(name: string): Profile {
  const id = newId('profile')
  return { id, name, partition: `persist:profile-${id}`, createdAt: Date.now() }
}

let incognitoCounter = 0
export function makeIncognitoProfile(): Profile {
  incognitoCounter += 1
  return { id: newId('private'), name: 'Private', partition: `incognito-${incognitoCounter}`, createdAt: Date.now(), incognito: true }
}

/** profiles a user can pick for a space (private window profiles excluded) */
export function regularProfiles(s: PersistedState): Profile[] {
  return s.profiles.filter((p) => !p.incognito)
}

export function setupDefaultSession(): void {
  app.userAgentFallback = chromeLikeUserAgent(app.userAgentFallback)
  applyChromeIdentity(session.defaultSession)
  handleProtocol(session.defaultSession)
}

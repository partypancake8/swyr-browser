// Link Rules: route URLs that arrive from outside swyr to a chosen space (and its profile).
// A pattern is a hostname ("github.com", also matching its subdomains) or a glob ("*.github.com",
// "github.com/org/*"); globs with a slash match host + path.
// Round 5: a rule may also (or only) name the app the link came from (sourceApp, matched against the frontmost app
// when the link arrived; see SourceApp.ts).
import type { LinkRule } from '@shared/types'

/** the app a link came from (see SourceApp.ts for how swyr detects it) */
export interface SourceApp {
  name: string
  bundleId: string
}


function globToRegExp(glob: string): RegExp {
  const esc = glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`^${esc}$`, 'i')
}

export function normalizePattern(pattern: string): string {
  let p = pattern.trim().toLowerCase()
  p = p.replace(/^[a-z]+:\/\//, '')
  if (!p.includes('*')) p = p.replace(/\/+$/, '')
  return p
}

export function ruleMatches(pattern: string, url: string): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (!/^https?:$/.test(u.protocol)) return false
  const host = u.hostname.toLowerCase()
  const p = normalizePattern(pattern)
  if (!p) return false
  if (p.includes('/')) {
    const target = host + u.pathname
    if (p.includes('*')) return globToRegExp(p).test(target) || globToRegExp(p).test(target.replace(/^www\./, ''))
    const h = host.replace(/^www\./, '')
    return target.startsWith(p) || (h + u.pathname).startsWith(p)
  }
  if (p.includes('*')) {
    const re = globToRegExp(p)
    // "*.github.com" also covers the bare domain
    return re.test(host) || (p.startsWith('*.') && host === p.slice(2))
  }
  return host === p || host.endsWith('.' + p)
}

/** how specific a rule is: a source app outranks any domain, then the longer pattern wins */
function specificity(r: LinkRule): number {
  return (r.sourceApp?.trim() ? 10000 : 0) + normalizePattern(r.pattern).replace(/\*/g, '').length
}

/** one rule against a link: its pattern (when it has one) and its source app (when it names one) must both match */
export function ruleApplies(r: LinkRule, url: string, source?: SourceApp | string | null): boolean {
  const hasPattern = Boolean(normalizePattern(r.pattern ?? ''))
  const hasSource = Boolean(r.sourceApp?.trim())
  if (!hasPattern && !hasSource) return false
  if (hasPattern && !ruleMatches(r.pattern, url)) return false
  if (hasSource) {
    try {
      if (!/^https?:$/.test(new URL(url).protocol)) return false
    } catch {
      return false
    }
    return sourceAppMatches(r.sourceApp, source)
  }
  return true
}

/** the first rule matching url (and the app it came from), most specific first */
export function matchRule(rules: LinkRule[], url: string, source?: SourceApp | string | null): LinkRule | undefined {
  const ranked = [...rules].sort((a, b) => specificity(b) - specificity(a))
  return ranked.find((r) => ruleApplies(r, url, source))
}

/** the source app a link.openExternal payload carries (sourceApp is a name, sourceBundleId a bundle id) */
export function sourceFromPayload(p: Record<string, unknown>): SourceApp | null {
  const name = typeof p.sourceApp === 'string' ? p.sourceApp.trim() : ''
  const bundleId = typeof p.sourceBundleId === 'string' ? p.sourceBundleId.trim() : ''
  return name || bundleId ? { name, bundleId } : null
}

/** a rule's source app ("Slack", "com.tinyspeck") matches the app by name or bundle id, case-insensitively */
export function sourceAppMatches(want: string | undefined, app: SourceApp | string | null | undefined): boolean {
  const w = (want ?? '').trim().toLowerCase()
  if (!w) return true
  if (!app) return false
  const names = typeof app === 'string' ? [app] : [app.name, app.bundleId]
  return names.some((n) => n && n.toLowerCase().includes(w))
}

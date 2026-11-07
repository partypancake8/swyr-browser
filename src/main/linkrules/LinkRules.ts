// Link Rules: route URLs that arrive from outside swyr to a chosen space (and its profile).
// A pattern is a hostname ("github.com", also matching its subdomains) or a glob ("*.github.com",
// "github.com/org/*"); globs with a slash match host + path.
import type { LinkRule } from '@shared/types'

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

/** the first rule matching url, most specific pattern first */
export function matchRule(rules: LinkRule[], url: string): LinkRule | undefined {
  const ranked = [...rules].sort((a, b) => normalizePattern(b.pattern).replace(/\*/g, '').length - normalizePattern(a.pattern).replace(/\*/g, '').length)
  return ranked.find((r) => ruleMatches(r.pattern, url))
}

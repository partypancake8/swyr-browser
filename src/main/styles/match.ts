// Pure helpers for Styles: which styles match a URL, and the stylesheet a style produces.
// No Electron imports, so tests/unit-3a.mjs can load this file directly.
import type { Style } from '@shared/types'

function globToRegExp(glob: string): RegExp {
  const esc = glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`^${esc}$`, 'i')
}

/** `${protocol}//${host}` of a URL ("file://" for local files), or '' for URLs without an origin */
export function originKey(url: string): string {
  try {
    const u = new URL(url)
    return `${u.protocol}//${u.host}`.toLowerCase()
  } catch {
    return ''
  }
}

/**
 * hostPattern is a glob over `${protocol}//${host}` ("https://*.github.com", "file://*") or a plain
 * hostname: "example.com" matches example.com and its subdomains, "*.github.com" matches subdomains
 * (and the bare domain).
 */
export function hostMatches(pattern: string, url: string): boolean {
  const p = pattern.trim().toLowerCase().replace(/\/+$/, '')
  if (!p) return false
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (!/^(https?|file):$/.test(u.protocol)) return false
  if (p.includes('://')) return globToRegExp(p).test(originKey(url))
  const host = u.hostname.toLowerCase()
  if (p === '*') return true
  if (!host) return false
  if (p.includes('*')) return globToRegExp(p).test(host) || (p.startsWith('*.') && host === p.slice(2))
  const bare = p.replace(/^www\./, '')
  return host === bare || host.endsWith('.' + bare)
}

/** the default host pattern for a new style on this page */
export function sitePattern(url: string): string {
  try {
    const u = new URL(url)
    if (u.protocol === 'file:') return 'file://*'
    return u.hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return ''
  }
}

export function stylesFor(styles: Style[], url: string, enabledOnly = true): Style[] {
  return styles.filter((s) => (!enabledOnly || s.enabled) && hostMatches(s.hostPattern, url))
}

const CONTAINERS = 'html, body, main, article, section, header, footer, nav, aside, [role="main"]'
const TEXT =
  'body, body p, body li, body span, body td, body th, body dd, body dt, body label, body blockquote, body figcaption, body h1, body h2, body h3, body h4, body h5, body h6, body div'

const cssValue = (v: string): string => v.replace(/[;{}<>\\]/g, '')

/** the generated stylesheet of a style (colors, font, size, hidden elements) followed by its custom css */
export function styleCss(s: Style): string {
  const out: string[] = []
  const c = s.colors ?? {}
  const vars: string[] = []
  if (c.bg) vars.push(`--swyr-style-bg: ${cssValue(c.bg)};`)
  if (c.fg) vars.push(`--swyr-style-fg: ${cssValue(c.fg)};`)
  if (c.accent) vars.push(`--swyr-style-accent: ${cssValue(c.accent)};`)
  if (vars.length) out.push(`:root { ${vars.join(' ')} }`)
  if (c.bg) out.push(`${CONTAINERS} { background-color: var(--swyr-style-bg) !important; }`)
  if (c.fg) out.push(`${TEXT} { color: var(--swyr-style-fg) !important; }`)
  if (c.accent) {
    out.push('body a, body a * { color: var(--swyr-style-accent) !important; }')
    out.push(':root { accent-color: var(--swyr-style-accent); caret-color: var(--swyr-style-accent); }')
  }
  if (s.font && s.font.trim()) {
    const font = cssValue(s.font.trim())
    const family = /\s/.test(font) && !/[,'"]/.test(font) ? `'${font}'` : font
    out.push(
      `body, body *:not(pre):not(code):not(kbd):not(samp):not(i):not([class*="icon"]):not([class*="Icon"]) { font-family: ${family} !important; }`
    )
  }
  if (typeof s.fontScale === 'number' && Number.isFinite(s.fontScale) && s.fontScale > 0 && Math.abs(s.fontScale - 1) > 0.001) {
    const scale = Math.max(0.5, Math.min(3, s.fontScale))
    out.push(`html { zoom: ${scale} !important; }`)
  }
  const hidden = (s.hiddenSelectors ?? []).map((x) => x.trim()).filter((x) => x && !/[{}]/.test(x))
  for (const sel of hidden) out.push(`${sel} { display: none !important; }`)
  if (s.css && s.css.trim()) out.push(s.css)
  return out.join('\n')
}

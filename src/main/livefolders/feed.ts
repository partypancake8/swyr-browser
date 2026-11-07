// A small RSS 2.0 / RSS 1.0 / Atom parser: just the entry titles and links a Live Folder needs. No dependencies.

export interface LiveEntry {
  title: string
  url: string
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m
    }
    return ENTITIES[code.toLowerCase()] ?? m
  })
}

/** text content of an XML fragment: CDATA unwrapped, tags dropped, entities decoded, whitespace collapsed */
function text(fragment: string): string {
  const cdata: string[] = []
  const marked = fragment.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_m, inner: string) => {
    cdata.push(inner)
    return `\u0000${cdata.length - 1}\u0000`
  })
  const plain = decodeEntities(marked.replace(/<[^>]*>/g, ''))
  // eslint-disable-next-line no-control-regex
  const restored = plain.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => cdata[Number(i)].replace(/<[^>]*>/g, ''))
  return restored.replace(/\s+/g, ' ').trim()
}

function child(block: string, tag: string): string | null {
  const re = new RegExp(`<(?:[\\w-]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${tag}>`, 'i')
  const m = re.exec(block)
  return m ? m[1] : null
}

function attr(tagText: string, name: string): string | null {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tagText)
  return m ? decodeEntities(m[2] ?? m[3] ?? '') : null
}

/** the best link of an Atom entry: rel="alternate" (or no rel) first, then any href */
function atomLink(block: string): string | null {
  const links = block.match(/<(?:[\w-]+:)?link\b[^>]*>/gi) ?? []
  let fallback: string | null = null
  for (const l of links) {
    const href = attr(l, 'href')
    if (!href) continue
    const rel = attr(l, 'rel')
    if (!rel || rel === 'alternate') return href
    fallback = fallback ?? href
  }
  return fallback
}

const isWebUrl = (u: string): boolean => /^https?:\/\//i.test(u)

/** entries of an RSS or Atom document, in feed order; entries without a web link are skipped */
export function parseFeed(xml: string, limit = 50): LiveEntry[] {
  const out: LiveEntry[] = []
  const blocks = xml.match(/<(?:[\w-]+:)?(item|entry)\b[\s\S]*?<\/(?:[\w-]+:)?\1>/gi) ?? []
  for (const block of blocks) {
    if (out.length >= limit) break
    const isAtom = /^<(?:[\w-]+:)?entry\b/i.test(block)
    let url: string | null
    if (isAtom) url = atomLink(block)
    else {
      const link = child(block, 'link')
      url = link ? text(link) : null
      if (!url || !isWebUrl(url)) {
        const guid = child(block, 'guid')
        const g = guid ? text(guid) : ''
        url = isWebUrl(g) ? g : (url ?? attr(block.slice(0, block.indexOf('>') + 1), 'rdf:about'))
      }
    }
    if (!url || !isWebUrl(url.trim())) continue
    const title = text(child(block, 'title') ?? '') || url.trim()
    out.push({ title, url: url.trim() })
  }
  return out
}

/** entries from the test source's JSON fixture: [{ title, url }] */
export function parseFixture(raw: unknown, limit = 200): LiveEntry[] {
  if (!Array.isArray(raw)) throw new Error('the fixture is not a JSON array')
  const out: LiveEntry[] = []
  for (const e of raw) {
    if (out.length >= limit) break
    const r = e as { title?: unknown; url?: unknown }
    if (typeof r?.url !== 'string' || !isWebUrl(r.url)) continue
    out.push({ title: typeof r.title === 'string' && r.title ? r.title : r.url, url: r.url })
  }
  return out
}

/** the search query for a GitHub source, with the right type qualifier added when missing */
export function githubQuery(source: 'github-prs' | 'github-issues', query: string | undefined): string {
  const q = (query ?? '').trim() || (source === 'github-prs' ? 'is:pr is:open author:@me' : 'is:issue is:open assignee:@me')
  if (/\b(is|type):(pr|issue|pull-request)\b/i.test(q)) return q
  return `${source === 'github-prs' ? 'is:pr' : 'is:issue'} ${q}`
}

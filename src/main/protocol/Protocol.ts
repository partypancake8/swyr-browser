// swyr:// serves the shell, overlay and internal pages from the built renderer.
import { net, protocol, type Session } from 'electron'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const SCHEME = 'swyr'

/** host -> html entry, relative to the renderer root */
export const PAGES: Record<string, string> = {
  shell: 'shell/index.html',
  overlay: 'overlay/index.html',
  mini: 'mini/index.html',
  newtab: 'pages/newtab/index.html',
  settings: 'pages/settings/index.html',
  archive: 'pages/archive/index.html',
  library: 'pages/library/index.html',
  extensions: 'pages/extensions/index.html',
  // round 3a
  history: 'pages/history/index.html',
  styles: 'pages/styles/index.html',
  // round 3b: swyr://note/<docId> and swyr://canvas/<docId>
  note: 'pages/note/index.html',
  canvas: 'pages/canvas/index.html',
  // round 3c
  onboarding: 'pages/onboarding/index.html',
  error: 'pages/error/index.html'
}

/** pages that may be opened in a tab */
export const TAB_PAGES = new Set(['newtab', 'settings', 'archive', 'library', 'extensions', 'history', 'styles', 'note', 'canvas', 'onboarding', 'error'])

/** round 3b: hosts whose page path is a document id (swyr://note/<id>) rather than an asset */
const DOC_PAGE_HOSTS = new Set(['note', 'canvas'])
const isDocPagePath = (host: string, pathname: string): boolean => DOC_PAGE_HOSTS.has(host) && /^\/[A-Za-z0-9_-]{1,64}\/?$/.test(pathname)

export function registerSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true }
    },
    // round 2c: electron-chrome-extensions serves extension icons over crx://
    { scheme: 'crx', privileges: { bypassCSP: true } }
  ])
}

function rendererDir(): string {
  return path.join(__dirname, '../renderer')
}

/**
 * the Content-Security-Policy of every swyr:// page: scripts only from swyr's own bundles (no inline script, no eval,
 * nothing remote), inline styles for Excalidraw and TipTap, images from anywhere (favicons, pasted images), and no
 * framing by any page
 */
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  'img-src * data: blob:',
  "font-src 'self' data:",
  "connect-src 'self'",
  "media-src 'self' data: blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'"
].join('; ')

/** the CSP of swyr's error and not-found responses: no script at all */
const STATIC_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'none'"

/**
 * a request for a swyr:// URL that web content started: a web page linking, framing, fetching or embedding an
 * internal page or asset. swyr's own loads (loadURL from main) carry no referrer or origin, and swyr pages loading
 * their own assets are same-origin swyr:// requests.
 */
export function fromWebContent(headers: Headers, referrer: string): boolean {
  const sources = [headers.get('origin') ?? '', referrer && referrer !== 'about:client' ? referrer : '', headers.get('referer') ?? '']
  for (const src of sources) {
    if (!src || src === 'null') continue
    if (!/^swyr:/i.test(src) && !/^devtools:/i.test(src)) return true
  }
  const site = headers.get('sec-fetch-site')
  return site === 'cross-site' && Boolean(headers.get('origin'))
}

const devUrl = (): string | undefined => process.env.ELECTRON_RENDERER_URL

async function serve(request: Request): Promise<Response> {
  const url = new URL(request.url)
  // internal pages and their assets are only for swyr itself and for other internal pages
  if (fromWebContent(request.headers, request.referrer)) {
    return new Response('Not allowed', { status: 403, headers: { 'content-type': 'text/plain; charset=utf-8', 'content-security-policy': STATIC_CSP } })
  }
  const host = url.hostname
  const dev = devUrl()
  const page = PAGES[host]
  // round 3a: page routes like swyr://styles/<id> (a path without a file extension) serve the page itself
  // round 3b: swyr://note/<id> and swyr://canvas/<id> route a document id to the page
  const routed = Boolean(page) && !/\.[a-z0-9]+$/i.test(url.pathname)
  const isAsset = url.pathname !== '/' && url.pathname !== '' && !url.pathname.endsWith('.html') && !routed && !isDocPagePath(host, url.pathname)
  if (dev) {
    const target = isAsset ? `${dev}${url.pathname}${url.search}` : page ? `${dev}/${page}` : ''
    if (target) return net.fetch(target)
  } else {
    const root = rendererDir()
    if (isAsset) {
      const file = path.normalize(path.join(root, url.pathname))
      if (file.startsWith(root + path.sep)) return net.fetch(pathToFileURL(file).toString())
    } else if (page) {
      const res = await net.fetch(pathToFileURL(path.join(root, page)).toString())
      const headers = new Headers(res.headers)
      headers.set('content-type', 'text/html; charset=utf-8')
      headers.set('content-security-policy', CSP)
      return new Response(res.body, { status: res.status, headers })
    }
  }
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>Not found</title><body style="font:15px system-ui;padding:40px;color:#111">swyr could not find <b>${host}${url.pathname.replace(/[<>&]/g, '')}</b></body>`,
    { status: 404, headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': STATIC_CSP } }
  )
}

const handled = new WeakSet<Session>()

export function handleProtocol(ses: Session): void {
  if (handled.has(ses)) return
  handled.add(ses)
  ses.protocol.handle(SCHEME, serve)
}

export function isInternalUrl(url: string): boolean {
  return url.startsWith(`${SCHEME}:`)
}

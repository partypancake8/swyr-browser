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
  // round 3b: swyr://note/<docId> and swyr://canvas/<docId>
  note: 'pages/note/index.html',
  canvas: 'pages/canvas/index.html'
}

/** pages that may be opened in a tab */
export const TAB_PAGES = new Set(['newtab', 'settings', 'archive', 'library', 'extensions', 'note', 'canvas'])

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

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  'img-src * data: blob:',
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'"
].join('; ')

const devUrl = (): string | undefined => process.env.ELECTRON_RENDERER_URL

async function serve(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const host = url.hostname
  const dev = devUrl()
  const page = PAGES[host]
  const isAsset = url.pathname !== '/' && url.pathname !== '' && !url.pathname.endsWith('.html') && !isDocPagePath(host, url.pathname)
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
    { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' } }
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

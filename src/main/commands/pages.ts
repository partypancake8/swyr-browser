// Round 3a page commands: Styles, Site Settings, Reader, History, copy as Markdown, capture, view source,
// print and save. registerPageCommands runs from the builtins; 'pages.start' wires the services to every
// web contents (styles, history, reader state) and to every profile session (permissions).
import { app, clipboard, ClipboardItem, dialog, type WebContents } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Item, LinkRule, PermissionDecision, SiteInfo, SitePermission } from '@shared/types'
import { itemTitle } from '@shared/ops'
import { newId } from '../util/id'
import type { CommandContext, CommandHandler, Commands } from './Commands'
import type { Core } from '../windows/WindowManager'
import type { SwyrWindow } from '../windows/SwyrWindow'
import { StyleApplier, PICKER_SCRIPT, saveStyle, siteStyle } from '../styles/Styles'
import { sitePattern, stylesFor } from '../styles/match'
import { History } from '../history/History'
import { defaultHistoryPath, readBrowserHistory, type HistoryBrowser } from '../import/BrowserHistory'
import { showReader } from '../reader/Reader'
import { SITE_PERMISSIONS, decisions, originOf, setDecision } from '../sitesettings/SiteSettings'
import { attachPermissions, respond as respondPermission } from '../sitesettings/PermissionPrompts'
import { onProfileSession } from '../profiles/Profiles'
import { platformRuntime } from './platform'
import { hostAllowed } from '../adblock/Adblock'
import { matchRule, normalizePattern, sourceFromPayload } from '../linkrules/LinkRules'
import { openInMiniWindow } from './mini'
import { isFile } from '../security/urlPolicy'

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined)

/** commands the internal pages swyr://styles and swyr://history may run over IPC */
export const PAGE_3A_COMMANDS = [
  'style.save',
  'style.toggle',
  'style.delete',
  'style.list',
  'style.open',
  'style.export',
  'style.import',
  'history.query',
  'history.clear',
  'history.remove',
  'history.open',
  'history.visit'
]

interface Services {
  styles: StyleApplier
  history: History
}

let S: Services | null = null
/** web contents showing the Reader view */
const readers = new WeakSet<WebContents>()
const PICKER_WORLD = 1032
const STYLE_CODE_PREFIX = 'swyr-style:'

export function historyService(): History | null {
  return S?.history ?? null
}

function start(core: Core): Services {
  if (S) return S
  const styles = new StyleApplier(core)
  const history = new History()
  S = { styles, history }
  app.on('web-contents-created', (_e, wc) => {
    styles.watch(wc)
    history.watch(wc)
    wc.on('did-navigate', () => {
      if (!readers.has(wc)) return
      readers.delete(wc)
      setReader(core, wc, false)
    })
  })
  onProfileSession((ses, profile) => attachPermissions(core, ses, Boolean(profile.incognito)))
  return S
}

function setReader(core: Core, wc: WebContents, on: boolean): void {
  for (const w of core.windows) {
    const id = w.tabs.idOf(wc)
    const rt = id ? w.tabs.runtime.get(id) : undefined
    if (rt) rt.reader = on
  }
  core.scheduleBroadcast()
}

/** the item and page of the focused tab (or focused pane) */
function active(w: SwyrWindow | undefined): { item: Item | undefined; wc: WebContents | undefined } {
  if (!w) return { item: undefined, wc: undefined }
  const id = w.focusedItemId()
  const item = w.core.store.state.items.find((i) => i.id === id)
  return { item, wc: w.activeContents() }
}

function pageUrl(w: SwyrWindow | undefined): string {
  const { item, wc } = active(w)
  return (wc && !wc.isDestroyed() ? wc.getURL() : '') || item?.url || ''
}

/** open an internal page in this space: reuse a tab already on it, else a new Today tab */
/** whether a URL is in history (the IPC guard asks before it lets swyr://history reopen a local file) */
export function historyHas(core: Core, url: string): boolean {
  return start(core).history.has(url)
}

function openPage(ctx: CommandContext, base: string, url = base): unknown {
  const { core, w } = ctx
  if (!w) return undefined
  const space = w.space()
  const existing = core.store.state.items.find((i) => i.kind === 'tab' && i.spaceId === space.id && i.url.startsWith(base))
  if (existing) {
    if (existing.url !== url) return core.commands.run('tab.navigate', { itemId: existing.id, url }, w).then(() => existing.id)
    w.activate(existing.id)
    return existing.id
  }
  return core.commands.run('tab.new', { url }, w)
}

function toggleOverlay(w: SwyrWindow | undefined, kind: 'siteSettings' | 'stylePanel', p: Record<string, unknown>): boolean {
  if (!w) return false
  const open = typeof p.show === 'boolean' ? p.show : w.overlayState?.kind !== kind
  if (open) w.openOverlay({ kind })
  else if (w.overlayState?.kind === kind) w.closeOverlay()
  return open
}

function captureDir(core: Core): string {
  return core.test ? path.join(app.getPath('userData'), 'captures') : path.join(os.homedir(), 'Pictures', 'swyr Captures')
}

function stamp(d = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} at ${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}`
}

function siteInfo(core: Core, w: SwyrWindow | undefined): SiteInfo {
  const { item, wc } = active(w)
  const url = pageUrl(w)
  const origin = originOf(url)
  let host = ''
  try {
    const u = new URL(url)
    host = u.protocol === 'file:' ? 'Local file' : u.hostname
  } catch {
    /* not a URL */
  }
  const web = /^(https?|file):/i.test(url)
  const s = core.store.state
  const plat = platformRuntime()
  const profileId = item?.profileId ?? w?.space().profileId
  const bareHost = host.replace(/^www\./, '')
  const miniRule = web && bareHost ? s.settings.linkRules.find((r) => r.mini && r.pattern === normalizePattern(bareHost)) : undefined
  return {
    itemId: item?.id ?? null,
    url,
    origin,
    host,
    title: item ? itemTitle(item) : '',
    favicon: item?.favicon ?? null,
    web,
    adblockEnabled: s.settings.adblock !== false,
    adblockAllowed: Boolean(bareHost && /^https?:/i.test(url) && hostAllowed(bareHost, s.settings.adblockAllow ?? [])),
    blockedCount: item ? (plat.adblockStats.perTab[item.id] ?? 0) : 0,
    styles: web ? stylesFor(s.styles ?? [], url, false) : [],
    zoom: wc && !wc.isDestroyed() ? wc.getZoomLevel() : 0,
    permissions: origin ? decisions(core, origin, wc?.session) : {},
    mini: Boolean(miniRule),
    extensions: plat.extensions
      .filter((e) => e.enabled && e.profileId === profileId)
      .map((e) => ({ id: e.id, name: e.name, iconDataUrl: e.iconDataUrl }))
  }
}

/** the confirmation before a shared style with JavaScript is installed; headless test runs answer yes */
async function confirmStyleCode(core: Core, w: SwyrWindow | undefined, hostPattern: string): Promise<boolean> {
  if (core.test) return true
  const opts = {
    type: 'warning' as const,
    buttons: ['Install and Run Code', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    message: `This style runs code on ${hostPattern}`,
    detail: `Its JavaScript will run on every page of ${hostPattern} and can read and change anything there, including what you type. Install it only if you trust the person who shared it.`
  }
  const r = w && !w.closed ? await dialog.showMessageBox(w.win, opts) : await dialog.showMessageBox(opts)
  return r.response === 0
}

export function registerPageCommands(c: Commands): void {
  c.register('pages.start', ({ core }) => Boolean(start(core)))

  // ----- Styles
  c.register('style.save', ({ core }, p) => saveStyle(core, p as Record<string, unknown> & { hostPattern: string }))
  c.register('style.toggle', ({ core }, p) => {
    const style = core.store.state.styles.find((s) => s.id === str(p.id))
    if (!style) return false
    const enabled = typeof p.enabled === 'boolean' ? p.enabled : !style.enabled
    core.store.update(() => (style.enabled = enabled))
    return enabled
  })
  c.register('style.delete', ({ core }, p) => {
    const id = str(p.id)
    const before = core.store.state.styles.length
    core.store.update((s) => (s.styles = s.styles.filter((x) => x.id !== id)))
    return core.store.state.styles.length < before
  })
  c.register('style.list', ({ core }) => core.store.state.styles)
  // sharing: a style travels as a "swyr-style:" code (base64url JSON) that anyone can install
  c.register('style.export', ({ core, w }, p) => {
    const style = core.store.state.styles.find((s) => s.id === str(p.id))
    if (!style) return null
    const { hostPattern, colors, font, fontScale, css, js, hiddenSelectors } = style
    const code = STYLE_CODE_PREFIX + Buffer.from(JSON.stringify({ v: 1, hostPattern, colors, font, fontScale, css, js, hiddenSelectors }), 'utf8').toString('base64url')
    clipboard.writeText(code)
    w?.toast('Style share code copied')
    return code
  })
  c.register('style.import', async ({ core, w }, p) => {
    const text = (str(p.code) ?? str(p.text) ?? (await clipboard.readText())).trim()
    if (!text.startsWith(STYLE_CODE_PREFIX)) return { error: 'That is not a swyr style code.' }
    try {
      const data = JSON.parse(Buffer.from(text.slice(STYLE_CODE_PREFIX.length), 'base64url').toString('utf8')) as Record<string, unknown>
      const hostPattern = typeof data.hostPattern === 'string' ? data.hostPattern.trim() : ''
      // a style with code: say which site it runs on and that it will run there, and install only on a yes
      if (typeof data.js === 'string' && data.js.trim() && hostPattern) {
        if (!(await confirmStyleCode(core, w, hostPattern))) return { error: 'Not installed.' }
      }
      const style = saveStyle(core, { ...data, id: undefined, enabled: true } as unknown as Record<string, unknown> & { hostPattern: string })
      if (!style) return { error: 'That style code has no site.' }
      w?.toast(`Installed a style for ${style.hostPattern}`)
      return style
    } catch {
      return { error: 'That style code is damaged.' }
    }
  })
  c.register('style.forActiveSite', ({ core, w }) => {
    const url = pageUrl(w)
    return /^(https?|file):/i.test(url) ? stylesFor(core.store.state.styles ?? [], url, false) : []
  })
  c.register('style.siteDefaults', ({ w }) => ({ hostPattern: sitePattern(pageUrl(w)), url: pageUrl(w) }))
  c.register('style.pickElement', async ({ core, w }) => {
    const { wc } = active(w)
    const url = pageUrl(w)
    if (!w || !wc || !/^(https?|file):/i.test(url)) return null
    if (w.overlayState && w.overlayState.kind !== 'toast') w.closeOverlay()
    wc.focus()
    const selector = (await wc.executeJavaScriptInIsolatedWorld(PICKER_WORLD, [{ code: PICKER_SCRIPT }], true).catch(() => null)) as string | null
    if (typeof selector !== 'string' || !selector) return null
    const style = siteStyle(core, url)
    if (!style) return null
    saveStyle(core, { id: style.id, hostPattern: style.hostPattern, enabled: true, hiddenSelectors: [...style.hiddenSelectors, selector] })
    w.toast('Element hidden')
    return selector
  })
  c.register('style.open', (ctx, p) => {
    const id = str(p.id)
    return openPage(ctx, 'swyr://styles', id ? `swyr://styles/${encodeURIComponent(id)}` : 'swyr://styles')
  })
  c.register('style.panel', ({ w }, p) => toggleOverlay(w, 'stylePanel', p))
  c.register('style.edit', async (ctx) => {
    // "Edit code" from the panel: the site's style in the code editor
    const style = siteStyle(ctx.core, pageUrl(ctx.w))
    if (!style) return false
    ctx.w?.closeOverlay(false)
    return ctx.core.commands.run('style.open', { id: style.id }, ctx.w)
  })

  // ----- Site Settings
  c.register('siteSettings.open', ({ w }, p) => toggleOverlay(w, 'siteSettings', p))
  c.register('siteSettings.info', ({ core, w }) => siteInfo(core, w))
  c.register('siteSettings.setPermission', ({ core, w }, p) => {
    const origin = str(p.origin) ?? originOf(pageUrl(w))
    const perm = str(p.permission) as SitePermission | undefined
    if (!origin || !perm || !SITE_PERMISSIONS.includes(perm)) return false
    const value = p.value === 'allow' || p.value === 'deny' ? (p.value as PermissionDecision) : null
    const ses = active(w).wc?.session
    setDecision(core, origin, perm, value, ses)
    return decisions(core, origin, ses)
  })
  c.register('siteSettings.resetPermissions', ({ core, w }, p) => {
    const origin = str(p.origin) ?? originOf(pageUrl(w))
    if (!origin) return false
    const ses = active(w).wc?.session
    for (const perm of Object.keys(decisions(core, origin, ses)) as SitePermission[]) setDecision(core, origin, perm, null, ses)
    return true
  })
  // the permission prompt in the overlay: Allow or Block for the request on screen
  c.register('permission.respond', ({ w }, p) => {
    if (typeof p.allow !== 'boolean') return false
    return respondPermission(w, p.allow, str(p.promptId), p.remember !== false)
  })
  c.register('siteSettings.clearData', async ({ w }) => {
    const { wc } = active(w)
    const origin = originOf(pageUrl(w))
    if (!wc || !/^https?:/i.test(origin)) return false
    await wc.session.clearStorageData({ origin })
    w?.toast(`Cleared cookies and site data for ${new URL(origin).hostname}`)
    return true
  })
  c.register('siteSettings.setMini', ({ core, w }, p) => {
    let host = ''
    try {
      const u = new URL(pageUrl(w))
      if (/^https?:$/.test(u.protocol)) host = u.hostname.replace(/^www\./, '')
    } catch {
      host = ''
    }
    if (!host || !w) return false
    const pattern = normalizePattern(host)
    const on = typeof p.enabled === 'boolean' ? p.enabled : !core.store.state.settings.linkRules.some((r) => r.mini && r.pattern === pattern)
    core.store.update((s) => {
      s.settings.linkRules = s.settings.linkRules.filter((r) => !(r.mini && r.pattern === pattern))
      if (on) {
        const rule: LinkRule = { id: newId('rule'), pattern, spaceId: w.activeSpaceId, profileId: w.space().profileId, mini: true }
        s.settings.linkRules.push(rule)
      }
    })
    return on
  })
  c.register('siteSettings.setAdblock', async ({ core, w }, p) => {
    let host = ''
    try {
      host = new URL(pageUrl(w)).hostname.replace(/^www\./, '')
    } catch {
      /* not a URL */
    }
    if (!host) return false
    // allow = ads allowed on this site (blocking off)
    return core.commands.run('adblock.allowSite', { host, allow: p.allow === true }, w)
  })

  // links from outside swyr: a site marked "always open in a mini window" opens in one
  const handlers = (c as unknown as { handlers?: Map<string, CommandHandler> }).handlers
  const openExternal = handlers?.get('link.openExternal')
  c.register('link.openExternal', async (ctx, p) => {
    try {
      const url = str(p.url)
      if (url && /^https?:\/\//i.test(url)) {
        const rule = matchRule(ctx.core.store.state.settings.linkRules, url, sourceFromPayload(p))
        if (rule?.mini && openInMiniWindow(url, ctx.core) !== null) return 'mini'
      }
      return openExternal ? await openExternal(ctx, p) : false
    } catch (err) {
      console.error('[swyr] link.openExternal', err instanceof Error ? err.message : err)
      return false
    }
  })

  // ----- Reader
  c.register('page.readerMode', async ({ core, w }, p) => {
    const { item, wc } = active(w)
    if (!w || !item || !wc || wc.isDestroyed()) return false
    const on = readers.has(wc)
    const want = typeof p.enabled === 'boolean' ? p.enabled : !on
    if (want === on) return on
    if (!want) {
      readers.delete(wc)
      setReader(core, wc, false)
      wc.reload()
      return false
    }
    if (!/^(https?|file):/i.test(wc.getURL())) {
      w.toast('Reader is available on web pages')
      return false
    }
    const ok = await showReader(wc)
    if (!ok) {
      w.toast('This page has no article to show in Reader')
      return false
    }
    readers.add(wc)
    S?.styles.suspend(wc)
    setReader(core, wc, true)
    return true
  })

  // ----- page actions
  c.register('page.copyUrlMarkdown', async ({ w }) => {
    const { item } = active(w)
    if (!item || !w) return false
    const title = (itemTitle(item) || item.url).replace(/([[\]\\])/g, '\\$1')
    const url = item.url.replace(/[()]/g, (ch) => encodeURIComponent(ch))
    const md = `[${title}](${url})`
    await clipboard.writeText(md)
    w.toast('Copied link as Markdown')
    return md
  })
  c.register('page.capture', async ({ core, w }, p) => {
    const { wc } = active(w)
    if (!w || !wc || wc.isDestroyed()) return false
    const image = await wc.capturePage(undefined, { stayHidden: true })
    if (image.isEmpty()) return false
    const toClipboard = p.toClipboard === true
    let file: string | null = null
    if (str(p.path) || !toClipboard) {
      file = str(p.path) ? path.resolve(str(p.path)!.replace(/^~(?=$|\/)/, os.homedir())) : path.join(captureDir(core), `swyr Capture ${stamp()}.png`)
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, image.toPNG())
    }
    if (toClipboard) await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(image.toPNG())], { type: 'image/png' }) })])
    w.toast(file && toClipboard ? 'Capture saved and copied' : file ? `Capture saved to ${path.basename(path.dirname(file))}` : 'Capture copied')
    return file ?? true
  })
  c.register('page.viewSource', ({ core, w }) => {
    const url = pageUrl(w)
    if (!w || !/^(https?|file):/i.test(url)) return false
    return core.commands.run('tab.new', { url: `view-source:${url}` }, w)
  })
  c.register('page.print', ({ core, w }) => {
    const { wc } = active(w)
    if (!wc) return false
    if (core.test) return 'skipped in test mode'
    wc.print({}, (ok, reason) => {
      if (!ok && reason && reason !== 'Print job canceled') console.error('[swyr] print failed', reason)
    })
    return true
  })
  c.register('page.saveAs', async ({ core, w }, p) => {
    const { item, wc } = active(w)
    if (!wc || !item) return false
    let file = str(p.path)
    if (!file) {
      if (core.test) return 'skipped in test mode'
      const name = (itemTitle(item) || 'page').replace(/[/:\\?*"<>|]+/g, ' ').trim().slice(0, 120) || 'page'
      const res = await dialog.showSaveDialog({ title: 'Save Page As', defaultPath: path.join(app.getPath('downloads'), `${name}.html`), filters: [{ name: 'Web Page', extensions: ['html'] }] })
      if (res.canceled || !res.filePath) return false
      file = res.filePath
    }
    const target = path.resolve(file.replace(/^~(?=$|\/)/, os.homedir()))
    await wc.savePage(target, p.format === 'HTMLOnly' ? 'HTMLOnly' : 'HTMLComplete')
    w?.toast('Page saved')
    return target
  })

  // ----- History
  c.register('history.query', ({ core }, p) => {
    const h = start(core).history
    const limit = typeof p.limit === 'number' && Number.isFinite(p.limit) ? Math.max(1, Math.min(5000, Math.floor(p.limit))) : 100
    return h.query({ query: str(p.query) ?? '', limit, profileId: str(p.profileId), dedupe: p.dedupe !== false })
  })
  c.register('history.clear', ({ core, w }, p) => {
    const n = start(core).history.clear(str(p.profileId))
    w?.toast('History cleared')
    return n
  })
  c.register('history.remove', ({ core }, p) => {
    const url = str(p.url)
    return url ? start(core).history.remove(url, str(p.profileId)) : 0
  })
  c.register('history.open', (ctx) => openPage(ctx, 'swyr://history'))
  // the history page reopens a visit; a local file only opens when it really is in history
  c.register('history.visit', ({ core, w }, p) => {
    const url = str(p.url)
    if (!url || !w) return false
    if (isFile(url) && !start(core).history.has(url)) return false
    return core.commands.run('tab.new', { url }, w)
  })
  c.register('import.history', async ({ core, w }, p) => {
    const browsers: HistoryBrowser[] = ['chrome', 'edge', 'brave', 'firefox', 'safari']
    const browser = browsers.find((b) => b === str(p.browser)) ?? 'chrome'
    let file = str(p.path) ?? defaultHistoryPath(browser) ?? undefined
    if (!str(p.path) && !core.test && (!file || !fs.existsSync(file))) {
      const res = await dialog.showOpenDialog({ title: 'Choose a browser history file', buttonLabel: 'Import', properties: ['openFile', 'showHiddenFiles'] })
      if (res.canceled || !res.filePaths[0]) return null
      file = res.filePaths[0]
    }
    if (!file) return { error: 'No history file was found for that browser.' }
    try {
      const { format, visits } = readBrowserHistory(file)
      const profileId = str(p.profileId) ?? w?.space().profileId ?? core.store.state.profiles[0]?.id
      if (!profileId) return { error: 'There is no profile to import into.' }
      const added = start(core).history.importVisits(profileId, visits)
      if (!core.test) w?.toast(`Imported ${added} history entries`)
      return { browser, format, visits: visits.length, added, profileId }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'EPERM' || code === 'EACCES') return { error: 'macOS blocked reading that file. Give swyr Full Disk Access in System Settings, or choose a copy of the file.' }
      return { error: code === 'ENOENT' ? 'No history file was found at that path.' : (err as Error).message }
    }
  })

  void c.run('pages.start')
}

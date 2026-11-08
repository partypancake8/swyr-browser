// Styles: per-site colors, fonts, text size, hidden elements and custom CSS / JS, applied live to every
// web page (tabs, Preview, Mini Windows). CSS goes in with webContents.insertCSS and the returned keys are
// kept, so turning a style off or editing it updates the page at once without a reload. Style JavaScript cannot be
// taken back, so when a style whose JS ran is turned off, deleted or edited, the page reloads to reset its state.
import type { WebContents } from 'electron'
import type { Style, StyleSavePayload } from '@shared/types'
import { newId } from '../util/id'
import type { Core } from '../windows/WindowManager'
import { patternNamesSite, sitePattern, styleCss, stylesFor } from './match'

interface Applied {
  /** style id -> inserted css key and the css it carries */
  css: Map<string, { key: string; css: string }>
  /** style id + js already run in the current document */
  ran: Set<string>
  /** the current document fired dom-ready */
  ready: boolean
  /** Reader view is showing: styles are lifted until the next navigation */
  suspended: boolean
  chain: Promise<void>
}

const WEB_URL = /^(https?|file):/i

export class StyleApplier {
  private readonly docs = new Map<WebContents, Applied>()

  constructor(private readonly core: Core) {
    core.store.onChange(() => this.syncAll())
  }

  /** start tracking a web contents (every view; only http, https and file pages get styles) */
  watch(wc: WebContents): void {
    if (this.docs.has(wc)) return
    const doc: Applied = { css: new Map(), ran: new Set(), ready: false, suspended: false, chain: Promise.resolve() }
    this.docs.set(wc, doc)
    wc.on('did-navigate', () => {
      doc.ready = false
      doc.suspended = false
      doc.ran.clear()
      this.queue(wc, doc, true)
    })
    wc.on('did-navigate-in-page', (_e, _url, isMainFrame) => {
      if (isMainFrame) this.queue(wc, doc, false)
    })
    wc.on('dom-ready', () => {
      doc.ready = true
      this.queue(wc, doc, true)
    })
    wc.once('destroyed', () => this.docs.delete(wc))
  }

  syncAll(): void {
    for (const [wc, doc] of this.docs) this.queue(wc, doc, false)
  }

  /** Reader view lifts the page's styles; the next navigation brings them back */
  suspend(wc: WebContents): void {
    const doc = this.docs.get(wc)
    if (!doc) return
    doc.suspended = true
    this.queue(wc, doc, false)
  }

  private queue(wc: WebContents, doc: Applied, reset: boolean): void {
    doc.chain = doc.chain.then(() => this.sync(wc, doc, reset)).catch(() => undefined)
  }

  private async sync(wc: WebContents, doc: Applied, reset: boolean): Promise<void> {
    if (wc.isDestroyed()) return
    if (reset) {
      // a new document (or a re-fired dom-ready): drop what we inserted and insert again
      for (const [, entry] of doc.css) await wc.removeInsertedCSS(entry.key).catch(() => undefined)
      doc.css.clear()
    }
    const url = wc.getURL()
    const want = doc.suspended || !WEB_URL.test(url) ? [] : stylesFor(this.core.store.state.styles ?? [], url)
    const wantIds = new Set(want.map((s) => s.id))
    for (const [id, entry] of [...doc.css]) {
      if (!wantIds.has(id)) {
        doc.css.delete(id)
        await wc.removeInsertedCSS(entry.key).catch(() => undefined)
      }
    }
    for (const s of want) {
      const css = styleCss(s)
      const prev = doc.css.get(s.id)
      if (prev && prev.css === css) continue
      if (prev) {
        doc.css.delete(s.id)
        await wc.removeInsertedCSS(prev.key).catch(() => undefined)
      }
      if (!css.trim() || wc.isDestroyed()) continue
      const key = await wc.insertCSS(css, { cssOrigin: 'author' }).catch(() => null)
      if (key) doc.css.set(s.id, { key, css })
    }
    // JS that already ran in this document but is no longer wanted (style off, deleted, edited, or no longer
    // matching): its effect cannot be undone in place, so the page reloads and starts clean
    if (!doc.suspended && doc.ran.size) {
      const wantTags = new Set(want.filter((s) => s.enabled && patternNamesSite(s.hostPattern) && (s.js ?? '').trim()).map((s) => `${s.id}:${(s.js ?? '').trim()}`))
      if ([...doc.ran].some((tag) => !wantTags.has(tag))) {
        doc.ran.clear()
        doc.ready = false
        if (!wc.isDestroyed()) wc.reload()
        return
      }
    }
    if (!doc.ready) return
    // style JavaScript runs only for enabled styles of a named site (never for catch-all patterns), in the page
    for (const s of want) {
      if (!s.enabled || !patternNamesSite(s.hostPattern)) continue
      const js = (s.js ?? '').trim()
      const tag = `${s.id}:${js}`
      if (!js || doc.ran.has(tag)) continue
      doc.ran.add(tag)
      const code = `(() => { try { ${js}\n } catch (err) { console.error('[swyr style]', err) } })()`
      await wc.executeJavaScript(code, false).catch(() => undefined)
    }
  }

  /** wait until every queued update has reached the pages */
  async settled(): Promise<void> {
    await Promise.all([...this.docs.values()].map((d) => d.chain))
  }
}

const strArr = (v: unknown): string[] | undefined =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean))] : undefined
const optStr = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

/** create or update a style from a style.save payload */
export function saveStyle(core: Core, p: Partial<StyleSavePayload> & Record<string, unknown>): Style | null {
  const s = core.store.state
  if (!Array.isArray(s.styles)) s.styles = []
  const existing = typeof p.id === 'string' ? s.styles.find((x) => x.id === p.id) : undefined
  const hostPattern = (optStr(p.hostPattern) ?? existing?.hostPattern ?? '').trim()
  if (!hostPattern) return null
  const colorsIn = p.colors && typeof p.colors === 'object' ? (p.colors as Record<string, unknown>) : undefined
  const pickColor = (k: 'bg' | 'fg' | 'accent'): string | undefined => {
    if (colorsIn && k in colorsIn) {
      const v = colorsIn[k]
      return typeof v === 'string' && v.trim() ? v.trim() : undefined
    }
    return existing?.colors?.[k]
  }
  const colors: Style['colors'] = {}
  for (const k of ['bg', 'fg', 'accent'] as const) {
    const v = pickColor(k)
    if (v) colors[k] = v
  }
  const fontScale = typeof p.fontScale === 'number' && Number.isFinite(p.fontScale) ? Math.max(0.5, Math.min(3, p.fontScale)) : 'fontScale' in p ? undefined : existing?.fontScale
  const font = 'font' in p ? optStr(p.font)?.trim() || undefined : existing?.font
  const next: Style = {
    id: existing?.id ?? newId('style'),
    hostPattern,
    enabled: typeof p.enabled === 'boolean' ? p.enabled : (existing?.enabled ?? true),
    colors,
    css: optStr(p.css) ?? existing?.css ?? '',
    js: optStr(p.js) ?? existing?.js ?? '',
    hiddenSelectors: strArr(p.hiddenSelectors) ?? existing?.hiddenSelectors ?? []
  }
  if (font) next.font = font
  if (fontScale !== undefined) next.fontScale = fontScale
  core.store.update((st) => {
    const i = st.styles.findIndex((x) => x.id === next.id)
    if (i >= 0) st.styles[i] = next
    else st.styles.push(next)
  })
  return next
}

/** the style a page's "Hide element" and quick controls write to: the first plain style for the site */
export function siteStyle(core: Core, url: string): Style | null {
  const pattern = sitePattern(url)
  if (!pattern) return null
  const own = (core.store.state.styles ?? []).find((s) => s.hostPattern === pattern)
  return own ?? saveStyle(core, { hostPattern: pattern, enabled: true })
}

/**
 * The page-world part of "Hide element": highlight the hovered element, click to pick it, Escape to
 * cancel. Runs in an isolated world so the page cannot see or break it; resolves with a selector or null.
 */
export const PICKER_SCRIPT = String.raw`new Promise((resolve) => {
  const prev = document.getElementById('__swyr_picker')
  if (prev) prev.remove()
  const box = document.createElement('div')
  box.id = '__swyr_picker'
  const label = document.createElement('div')
  const css = (el, s) => { for (const k in s) el.style.setProperty(k, s[k], 'important') }
  css(box, { position: 'fixed', 'z-index': '2147483647', 'pointer-events': 'none', border: '2px solid #1d5c8f', background: 'rgba(29,92,143,0.18)', 'border-radius': '4px', transition: 'all 60ms ease-out', left: '0', top: '0', width: '0', height: '0' })
  css(label, { position: 'fixed', 'z-index': '2147483647', 'pointer-events': 'none', background: '#15171c', color: '#fff', font: '600 12px -apple-system, system-ui, sans-serif', padding: '4px 8px', 'border-radius': '6px', left: '12px', top: '12px' })
  label.textContent = 'Click an element to hide it. Esc cancels.'
  document.documentElement.append(box, label)
  let target = null
  const unique = (sel) => { try { return document.querySelectorAll(sel).length === 1 } catch { return false } }
  const esc = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/[^a-zA-Z0-9_-]/g, '\\$&'))
  const stableClass = (c) => c && c.length < 40 && !/\d{3,}|^(css|sc|jsx|emotion)-|__[a-z0-9]{5,}$|^[a-z]{1,3}[A-Z0-9][a-zA-Z0-9]{4,}$/.test(c) && !/^(hover|active|focus|selected|open|is-|has-)/.test(c)
  const part = (el) => {
    let s = el.tagName.toLowerCase()
    const cls = [...el.classList].filter(stableClass).slice(0, 2)
    if (cls.length) s += cls.map((c) => '.' + esc(c)).join('')
    const parent = el.parentElement
    if (parent) {
      const same = [...parent.children].filter((x) => x.tagName === el.tagName)
      if (same.length > 1 && !(cls.length && [...parent.children].filter((x) => x.matches(s)).length === 1)) s += ':nth-of-type(' + (same.indexOf(el) + 1) + ')'
    }
    return s
  }
  const selectorFor = (el) => {
    if (el.id && !/\d{4,}/.test(el.id) && unique('#' + esc(el.id))) return '#' + esc(el.id)
    for (const a of ['data-testid', 'aria-label', 'role', 'name']) {
      const v = el.getAttribute(a)
      if (v && v.length < 60) {
        const s = el.tagName.toLowerCase() + '[' + a + '="' + v.replace(/"/g, '\\"') + '"]'
        if (unique(s)) return s
      }
    }
    const parts = []
    let cur = el
    while (cur && cur.nodeType === 1 && cur !== document.documentElement && parts.length < 7) {
      if (cur.id && !/\d{4,}/.test(cur.id) && unique('#' + esc(cur.id))) { parts.unshift('#' + esc(cur.id)); break }
      parts.unshift(part(cur))
      const sel = parts.join(' > ')
      if (unique(sel)) return sel
      cur = cur.parentElement
    }
    return parts.join(' > ')
  }
  const done = (value) => {
    removeEventListener('mousemove', move, true)
    removeEventListener('click', click, true)
    removeEventListener('mousedown', block, true)
    removeEventListener('mouseup', block, true)
    removeEventListener('keydown', key, true)
    box.remove()
    label.remove()
    resolve(value)
  }
  const move = (e) => {
    const el = document.elementFromPoint(e.clientX, e.clientY)
    if (!el || el === box || el === label || el === document.documentElement || el === document.body) return
    target = el
    const r = el.getBoundingClientRect()
    css(box, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' })
    label.textContent = selectorFor(el)
  }
  const block = (e) => { e.preventDefault(); e.stopPropagation() }
  const click = (e) => { block(e); done(target ? selectorFor(target) : null) }
  const key = (e) => { if (e.key === 'Escape') { block(e); done(null) } }
  addEventListener('mousemove', move, true)
  addEventListener('click', click, true)
  addEventListener('mousedown', block, true)
  addEventListener('mouseup', block, true)
  addEventListener('keydown', key, true)
})`

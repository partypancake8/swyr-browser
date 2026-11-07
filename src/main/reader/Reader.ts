// Reader view: @mozilla/readability (Apache-2.0) runs inside the page, in an isolated world, and the
// tab's document is replaced with a clean reader template without navigating. Leaving reloads the page.
import fs from 'node:fs'
import { createRequire } from 'node:module'
import type { WebContents } from 'electron'

/** isolated world id for reader code (the page cannot see its globals) */
export const READER_WORLD = 1031

let source: string | null = null
function readabilitySource(): string {
  if (source === null) {
    const file = createRequire(__filename).resolve('@mozilla/readability/Readability.js')
    source = fs.readFileSync(file, 'utf8')
  }
  return source
}

export const READER_CSS = String.raw`
:root:has(#swyr-reader), :root:has(#swyr-reader) body { margin: 0 !important; padding: 0 !important; background: #fbf9f4 !important; }
:root:has(#swyr-reader[data-theme="dark"]), :root:has(#swyr-reader[data-theme="dark"]) body { background: #1b1b1d !important; }
@media (prefers-color-scheme: dark) {
  :root:has(#swyr-reader[data-theme="auto"]), :root:has(#swyr-reader[data-theme="auto"]) body { background: #1b1b1d !important; }
}
#swyr-reader {
  --r-bg: #fbf9f4; --r-fg: #1d1c1a; --r-soft: #45423c; --r-accent: #1d5c8f; --r-rule: rgba(29, 28, 26, 0.14); --r-btn: rgba(29, 28, 26, 0.07);
  --r-size: 20px;
  all: initial; display: block; min-height: 100vh; background: var(--r-bg); color: var(--r-fg);
  font-family: 'Iowan Old Style', 'Charter', 'Georgia', 'Times New Roman', serif; font-size: var(--r-size); line-height: 1.62;
  -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility;
}
#swyr-reader[data-theme="dark"] { --r-bg: #1b1b1d; --r-fg: #ecebe8; --r-soft: #c9c6c0; --r-accent: #8cc4f0; --r-rule: rgba(236, 235, 232, 0.16); --r-btn: rgba(236, 235, 232, 0.1); }
@media (prefers-color-scheme: dark) {
  #swyr-reader[data-theme="auto"] { --r-bg: #1b1b1d; --r-fg: #ecebe8; --r-soft: #c9c6c0; --r-accent: #8cc4f0; --r-rule: rgba(236, 235, 232, 0.16); --r-btn: rgba(236, 235, 232, 0.1); }
}
#swyr-reader * { box-sizing: border-box; }
#swyr-reader .swyr-reader-bar {
  position: sticky; top: 0; z-index: 10; display: flex; align-items: center; gap: 6px; padding: 10px 16px;
  background: var(--r-bg); border-bottom: 1px solid var(--r-rule);
  font: 600 13px/1 -apple-system, BlinkMacSystemFont, system-ui, sans-serif; color: var(--r-fg);
}
#swyr-reader .swyr-reader-bar .spacer { flex: 1; }
#swyr-reader .swyr-reader-bar .name { font-weight: 600; opacity: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 40%; }
#swyr-reader button {
  all: unset; cursor: default; padding: 7px 11px; border-radius: 8px; background: var(--r-btn); color: var(--r-fg);
  font: 600 13px/1 -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
}
#swyr-reader button:hover { filter: brightness(0.95); }
#swyr-reader button.exit { background: var(--r-fg); color: var(--r-bg); }
#swyr-reader .swyr-reader-article { display: block; max-width: 680px; margin: 0 auto; padding: 48px 24px 120px; }
#swyr-reader .site { font: 600 13px/1.3 -apple-system, BlinkMacSystemFont, system-ui, sans-serif; text-transform: uppercase; letter-spacing: 0.04em; color: var(--r-soft); margin-bottom: 14px; }
#swyr-reader h1.title { font-size: 1.85em; line-height: 1.18; margin: 0 0 14px; font-weight: 700; color: var(--r-fg); }
#swyr-reader .meta { font: 500 14px/1.4 -apple-system, BlinkMacSystemFont, system-ui, sans-serif; color: var(--r-soft); padding-bottom: 22px; margin-bottom: 28px; border-bottom: 1px solid var(--r-rule); }
#swyr-reader .content { display: block; }
#swyr-reader .content article, #swyr-reader .content section, #swyr-reader .content > div { display: block; margin: 0; padding: 0; max-width: none; }
#swyr-reader .content p, #swyr-reader .content ul, #swyr-reader .content ol, #swyr-reader .content blockquote, #swyr-reader .content figure, #swyr-reader .content pre, #swyr-reader .content table { margin: 0 0 1.1em; }
#swyr-reader .content h1, #swyr-reader .content h2, #swyr-reader .content h3, #swyr-reader .content h4 { line-height: 1.25; margin: 1.6em 0 0.6em; color: var(--r-fg); }
#swyr-reader .content h2 { font-size: 1.4em; } #swyr-reader .content h3 { font-size: 1.2em; }
#swyr-reader .content a { color: var(--r-accent); text-decoration: underline; text-underline-offset: 2px; }
#swyr-reader .content img, #swyr-reader .content video, #swyr-reader .content svg { max-width: 100%; height: auto; border-radius: 6px; }
#swyr-reader .content figcaption { font: 500 14px/1.4 -apple-system, BlinkMacSystemFont, system-ui, sans-serif; color: var(--r-soft); margin-top: 6px; }
#swyr-reader .content blockquote { border-left: 3px solid var(--r-rule); padding-left: 18px; color: var(--r-soft); }
#swyr-reader .content pre, #swyr-reader .content code { font-family: ui-monospace, 'SF Mono', Menlo, monospace; font-size: 0.82em; }
#swyr-reader .content pre { overflow-x: auto; padding: 14px 16px; border-radius: 8px; background: var(--r-btn); }
#swyr-reader .content table { border-collapse: collapse; width: 100%; font-size: 0.9em; }
#swyr-reader .content td, #swyr-reader .content th { border: 1px solid var(--r-rule); padding: 6px 8px; }
#swyr-reader .content hr { border: 0; border-top: 1px solid var(--r-rule); margin: 2em 0; }
`

/** extraction + rendering, run in the reader world; resolves with { ok, title } */
function readerScript(): string {
  return `(() => {
  const module = undefined;
  ${readabilitySource()}
  const strip = (root) => {
    for (const el of root.querySelectorAll('script, style, noscript, iframe, object, embed, form, link')) el.remove()
    for (const el of root.querySelectorAll('*')) for (const a of [...el.attributes]) if (/^on/i.test(a.name) || (/^(href|src)$/i.test(a.name) && /^\\s*javascript:/i.test(a.value))) el.removeAttribute(a.name)
    return root
  }
  let article = null
  try { article = new Readability(document.cloneNode(true), { charThreshold: 200 }).parse() } catch (err) { article = null }
  let content
  if (article && article.content) {
    content = strip(new DOMParser().parseFromString(article.content, 'text/html').body)
  } else {
    const pick = document.querySelector('article, main, [role="main"]') || document.body
    content = strip(pick.cloneNode(true))
    for (const el of content.querySelectorAll('nav, aside, header, footer, [role="navigation"], [role="complementary"]')) el.remove()
  }
  const title = (article && article.title) || document.title || location.href
  const text = content.textContent || ''
  const words = text.trim().split(/\\s+/).filter(Boolean).length
  const minutes = Math.max(1, Math.round(words / 230))
  // the article title is shown above the body; drop a leading heading that repeats it
  const first = content.querySelector('h1, h2')
  if (first && first.textContent.trim() === title.trim()) first.remove()
  const site = (article && article.siteName) || location.hostname || ''
  const byline = article && article.byline ? article.byline : ''
  const docTitle = document.title
  // replace the document without navigating
  for (const a of [...document.documentElement.attributes]) document.documentElement.removeAttribute(a.name)
  document.head.replaceChildren()
  const meta = document.createElement('meta'); meta.setAttribute('charset', 'utf-8')
  const t = document.createElement('title'); t.textContent = docTitle || title
  document.head.append(meta, t)
  const body = document.body || document.documentElement.appendChild(document.createElement('body'))
  for (const a of [...body.attributes]) body.removeAttribute(a.name)
  const root = document.createElement('div')
  root.id = 'swyr-reader'
  root.setAttribute('data-theme', 'auto')
  const bar = document.createElement('div'); bar.className = 'swyr-reader-bar'
  const mk = (label, cls, fn, tip) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; if (cls) b.className = cls; if (tip) b.title = tip; b.addEventListener('click', fn); return b }
  let size = 20
  const setSize = (n) => { size = Math.max(14, Math.min(32, n)); root.style.setProperty('--r-size', size + 'px') }
  const name = document.createElement('span'); name.className = 'name'; name.textContent = site
  const spacer = document.createElement('span'); spacer.className = 'spacer'
  const darkNow = () => root.getAttribute('data-theme') === 'dark' || (root.getAttribute('data-theme') === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches)
  const themeBtn = mk('', '', () => { root.setAttribute('data-theme', darkNow() ? 'light' : 'dark'); themeBtn.textContent = darkNow() ? 'Light' : 'Dark' }, 'Light or dark')
  themeBtn.textContent = darkNow() ? 'Light' : 'Dark'
  bar.append(
    mk('Exit reader', 'exit', () => location.reload(), 'Back to the original page'),
    name, spacer,
    mk('A\\u2212', '', () => setSize(size - 2), 'Smaller text'),
    mk('A+', '', () => setSize(size + 2), 'Larger text'),
    themeBtn
  )
  const art = document.createElement('article'); art.className = 'swyr-reader-article'
  if (site) { const s = document.createElement('div'); s.className = 'site'; s.textContent = site; art.append(s) }
  const h1 = document.createElement('h1'); h1.className = 'title'; h1.textContent = title
  const info = document.createElement('div'); info.className = 'meta'; info.textContent = (byline ? byline + ' \\u00b7 ' : '') + minutes + ' min read'
  const holder = document.createElement('div'); holder.className = 'content'
  holder.append(...content.childNodes)
  art.append(h1, info, holder)
  root.append(bar, art)
  body.replaceChildren(root)
  for (const el of [...document.documentElement.children]) if (el !== document.head && el !== body) el.remove()
  scrollTo(0, 0)
  return { ok: true, title, words }
})()`
}

/** extract the article and show the reader template in place; false when the page cannot be read */
export async function showReader(wc: WebContents): Promise<boolean> {
  if (wc.isDestroyed()) return false
  const result = (await wc.executeJavaScriptInIsolatedWorld(READER_WORLD, [{ code: readerScript() }], true).catch((err) => {
    console.error('[swyr] reader failed', err)
    return null
  })) as { ok?: boolean } | null
  if (!result?.ok) return false
  await wc.insertCSS(READER_CSS, { cssOrigin: 'author' }).catch(() => undefined)
  return true
}

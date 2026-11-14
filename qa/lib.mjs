// Shared pieces for the QA scripts (sweep, sitecheck, reliability): launching the built app hidden on a temp
// profile, running JavaScript in its renderers, and the text clipping detector.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { launch, repo, sleep } from '../tests/harness.mjs'

export { launch, repo, sleep }

export const outDir = path.join(repo, 'qa/out')

// a small warm cache and a renderer cap keep the process count low, as in the test suite
process.env.SWYR_WARM_TABS ??= '2'
process.env.SWYR_RENDERER_LIMIT ??= '4'

/** build out/ when it is missing or older than src/ (the QA scripts always drive the built app) */
export function ensureBuilt() {
  const main = path.join(repo, 'out/main/index.js')
  const newest = (dir) => {
    let t = 0
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      t = Math.max(t, e.isDirectory() ? newest(p) : fs.statSync(p).mtimeMs)
    }
    return t
  }
  if (fs.existsSync(main) && fs.statSync(main).mtimeMs >= newest(path.join(repo, 'src'))) return
  const r = spawnSync('npm', ['run', '--silent', 'build'], { cwd: repo, stdio: ['ignore', 'ignore', 'inherit'] })
  if (r.status !== 0) throw new Error('build failed')
}

export function tempProfile(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `swyr-qa-${tag}-`))
}

export function writeJson(name, data) {
  fs.mkdirSync(outDir, { recursive: true })
  const file = path.join(outDir, name)
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n')
  return file
}

/** run JavaScript in the first web contents whose URL starts with prefix */
export function jsIn(t, prefix, code) {
  return t.app.evaluate(async ({ webContents }, [p, c]) => {
    const wc = webContents.getAllWebContents().find((w) => !w.isDestroyed() && w.getURL().startsWith(p))
    return wc ? wc.executeJavaScript(c, true) : '__no_contents__'
  }, [prefix, code])
}

export async function waitForJs(t, prefix, code, label, ms = 15000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    const v = await jsIn(t, prefix, code).catch(() => null)
    if (v && v !== '__no_contents__') return v
    await sleep(200)
  }
  throw new Error('timeout waiting for ' + label)
}

/**
 * The detector, as a function run inside a renderer. It looks at every visible element under the roots that has
 * its own text and reports:
 *  - clipped-text: the element clips vertically (overflow hidden or clip) and either its content is taller than
 *    its box, or the font's ink (cap height above, the descenders of g, j, p, q, y below) reaches past the clip
 *    edge for the line box the element gives it. The second test is what catches a single-line title whose
 *    line-height is smaller than the font's ascent plus descent.
 *  - overflow: text wider than its box when that is not ellipsis truncation by design, or a page that scrolls
 *    sideways.
 */
export function detectorSource(rootSelector, excludeSelector) {
  return `(${detect.toString()})(${JSON.stringify(rootSelector ?? null)}, ${JSON.stringify(excludeSelector ?? null)})`
}

/* global document, getComputedStyle, innerWidth */
function detect(rootSelector, excludeSelector) {
  const roots = rootSelector ? [...document.querySelectorAll(rootSelector)] : [document.body]
  const ctx = document.createElement('canvas').getContext('2d')
  const findings = []
  const seen = new Set()
  const label = (el) => {
    const parts = []
    let e = el
    for (let i = 0; e && e.nodeType === 1 && i < 4; i++, e = e.parentElement) {
      let s = e.tagName.toLowerCase()
      const di = e.getAttribute('data-item') || e.getAttribute('data-testid') || e.getAttribute('aria-label')
      if (di) s += `[${di.slice(0, 24)}]`
      else if (typeof e.className === 'string' && e.className) s += '.' + e.className.trim().split(/\s+/).slice(0, 3).join('.')
      parts.unshift(s)
    }
    return parts.join(' > ').slice(0, 220)
  }
  const ownText = (el) =>
    [...el.childNodes]
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent)
      .join('')
      .trim()
  for (const root of roots) {
    for (const el of [root, ...root.querySelectorAll('*')]) {
      if (seen.has(el)) continue
      seen.add(el)
      if (excludeSelector && el.closest(excludeSelector)) continue
      if (/^(INPUT|TEXTAREA|SELECT|OPTION|SCRIPT|STYLE|SVG|CANVAS|IFRAME)$/i.test(el.tagName)) continue
      const text = ownText(el)
      if (!text) continue
      const cs = getComputedStyle(el)
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue
      const r = el.getBoundingClientRect()
      // visually hidden text for screen readers (a 1px clipped box) is not on screen
      if (r.width <= 2 || r.height <= 2) continue
      const textNode = [...el.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim())
      const clipsY = cs.overflowY === 'hidden' || cs.overflowY === 'clip'
      const clipsX = cs.overflowX === 'hidden' || cs.overflowX === 'clip'
      const ellipsis = cs.textOverflow === 'ellipsis'
      const sample = text.slice(0, 60)
      if (clipsY && el.scrollHeight > el.clientHeight + 1) {
        findings.push({ kind: 'clipped-text', selector: label(el), text: sample, detail: `content ${el.scrollHeight}px tall in a ${el.clientHeight}px box` })
        continue
      }
      if (clipsY && textNode) {
        ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
        const m = ctx.measureText('Hgjpqy')
        const range = document.createRange()
        range.selectNodeContents(textNode)
        const tr = range.getClientRects()[0]
        if (tr) {
          const baseline = tr.top + m.fontBoundingBoxAscent
          const inkTop = baseline - m.actualBoundingBoxAscent
          const inkBottom = baseline + m.actualBoundingBoxDescent
          const clipTop = r.top + parseFloat(cs.borderTopWidth)
          const clipBottom = r.bottom - parseFloat(cs.borderBottomWidth)
          const over = Math.max(inkBottom - clipBottom, clipTop - inkTop)
          if (over > 0.25) {
            findings.push({
              kind: 'clipped-text',
              selector: label(el),
              text: sample,
              detail: `glyphs reach ${over.toFixed(1)}px past the clip edge (font ${cs.fontSize}, line-height ${cs.lineHeight}, box ${Math.round(r.height)}px)`
            })
            continue
          }
        }
      }
      if (clipsX && !ellipsis && el.scrollWidth > el.clientWidth + 1) {
        findings.push({ kind: 'overflow', selector: label(el), text: sample, detail: `text ${el.scrollWidth}px wide cut at ${el.clientWidth}px without an ellipsis` })
        continue
      }
      if (!clipsX && cs.display !== 'inline' && /nowrap|pre/.test(cs.whiteSpace) && el.scrollWidth > el.clientWidth + 1) {
        findings.push({ kind: 'overflow', selector: label(el), text: sample, detail: `text ${el.scrollWidth}px wide spills out of a ${el.clientWidth}px box` })
      }
    }
  }
  const se = document.scrollingElement
  if (se && getComputedStyle(document.body).overflowX !== 'hidden' && se.scrollWidth > innerWidth + 1) {
    findings.push({ kind: 'overflow', selector: 'document', text: '', detail: `page is ${se.scrollWidth}px wide in a ${innerWidth}px viewport` })
  }
  return findings
}

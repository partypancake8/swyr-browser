// npm run sweep: launches the built app hidden on a temp profile, walks the UI surfaces in light and dark at two
// window sizes, saves a screenshot of each to qa/out/shots/ and runs the text clipping detector on it.
// Results: qa/out/sweep-results.json. Exits 0 whenever the sweep ran, whatever it found.
// npm run sweep -- --selftest: plants a clipped title and a healthy one, and exits 0 only if the detector flags
// the first and passes the second.
import fs from 'node:fs'
import path from 'node:path'
import { detectorSource, ensureBuilt, jsIn, launch, outDir, sleep, tempProfile, waitForJs, writeJson } from './lib.mjs'

const SELFTEST = process.argv.includes('--selftest')
const shots = path.join(outDir, 'shots')
const page = (title, body = '') => `data:text/html,${encodeURIComponent(`<!doctype html><title>${title}</title><h1>${title}</h1>${body}`)}`

ensureBuilt()
fs.mkdirSync(shots, { recursive: true })
const t = await launch({ userData: tempProfile('sweep'), log: process.env.SWYR_QA_LOG === '1' })

const scan = async (prefix, root, exclude) => {
  const r = await jsIn(t, prefix, detectorSource(root, exclude))
  return Array.isArray(r) ? r : []
}

async function selftest() {
  await waitForJs(t, 'swyr://shell', `Boolean(document.querySelector('[data-section="today"]'))`, 'shell')
  const plant = `(() => {
    const box = document.createElement('div')
    box.id = 'qa-plant'
    box.style.cssText = 'position:fixed;left:0;top:0;width:240px;z-index:99999;font:500 13px system-ui'
    box.innerHTML = '<span id="qa-bad" style="display:block;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;line-height:1">google docs - Google Search</span>' +
      '<span id="qa-good" style="display:block;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;line-height:18px">google docs - Google Search</span>' +
      '<div id="qa-short" style="height:8px;overflow:hidden;line-height:18px">a box shorter than its text</div>'
    document.body.appendChild(box)
    return true
  })()`
  await jsIn(t, 'swyr://shell', plant)
  const one = (id) => scan('swyr://shell', '#' + id)
  const bad = await one('qa-bad')
  const good = await one('qa-good')
  const short = await one('qa-short')
  await jsIn(t, 'swyr://shell', `document.getElementById('qa-plant').remove()`)
  const ok = bad.some((f) => f.kind === 'clipped-text') && short.some((f) => f.kind === 'clipped-text') && good.length === 0
  console.log('planted clipped title:', JSON.stringify(bad))
  console.log('planted short box:', JSON.stringify(short))
  console.log('healthy control:', JSON.stringify(good))
  console.log(ok ? 'SELFTEST PASS' : 'SELFTEST FAIL')
  return ok
}

async function setSize(width, height) {
  await t.app.evaluate(({ BrowserWindow }, [w, h]) => {
    for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed() && win.getContentSize()[0] >= 600) win.setContentSize(w, h)
  }, [width, height])
  await sleep(500)
}

async function setTheme(appearance) {
  const s = await t.state()
  for (const sp of s.spaces) await t.dispatch('space.edit', { id: sp.id, theme: { appearance } })
  await t.dispatch('settings.set', { appearance }).catch(() => undefined)
  await sleep(400)
}

const byTitle = (s, title) => s.items.find((i) => i.title === title)

// ----- fixtures: tabs with short and long titles (descenders included), pinned tabs, favorites, folders
const TITLES = {
  docs: 'google docs - Google Search',
  long: 'Typography, glyphs and jumpy quirky descenders: a very long page title that cannot fit',
  short: 'Gym',
  pinned: 'Pinned page with gjpqy',
  folderTab: 'Inside a folder: paging through jpg galleries',
  fav1: 'Favorite one',
  fav2: 'Favorite two',
  split1: 'Left pane gjpq',
  split2: 'Right pane gjpq'
}

async function fixtures() {
  await t.waitFor((s) => s.windows?.length === 1, 'first window')
  const text = '<p>' + 'the quick brown fox jumps over the lazy dog, gjpqy. '.repeat(40) + '</p>'
  // one at a time: a tab pushed out of the warm cache before its page finished loading keeps no title
  for (const k of Object.keys(TITLES)) {
    await t.dispatch('tab.new', { url: page(TITLES[k], text) })
    await t.waitFor((s) => byTitle(s, TITLES[k]), 'title of ' + k, 15000)
  }
  const s = await t.state()
  const id = (k) => byTitle(s, TITLES[k]).id
  await t.dispatch('tab.pin', { itemId: id('pinned') })
  await t.dispatch('tab.favorite', { itemId: id('fav1') })
  await t.dispatch('tab.favorite', { itemId: id('fav2') })
  const folder = await t.dispatch('folder.new', { name: 'Reading list: typography, jpg galleries and quirky long names', section: 'pinned' })
  await t.dispatch('tab.move', { itemId: id('folderTab'), section: 'pinned', parentId: folder })
  await t.dispatch('folder.new', { name: 'Empty', section: 'pinned' })
  await t.dispatch('tab.activate', { id: id('split1') })
  await t.dispatch('split.add', { itemId: id('split2') }).catch(() => undefined)
  await t.dispatch('tab.activate', { id: id('docs') })
  await t.waitIdle().catch(() => undefined)
  return id
}

// ----- surfaces: each one opens itself, names the renderer and root to scan, and closes again
const SURFACES = [
  {
    name: 'sidebar tab list (pinned and today)',
    async open(id) {
      await t.dispatch('tab.activate', { id: id('docs') })
    },
    targets: [['swyr://shell', '[data-section="pinned"], [data-section="today"]']]
  },
  {
    name: 'sidebar favorites',
    async open(id) {
      await t.dispatch('tab.activate', { id: id('fav1') })
    },
    targets: [['swyr://shell', '[data-section="favorites"]']]
  },
  {
    name: 'sidebar folders',
    async open(id) {
      await t.dispatch('tab.activate', { id: id('folderTab') })
    },
    targets: [['swyr://shell', '[data-kind="folder"], [data-kind="liveFolder"]']]
  },
  {
    name: 'sidebar chrome (address field, space switcher, footer)',
    async open(id) {
      await t.dispatch('tab.activate', { id: id('long') })
    },
    // the lists have their own surfaces above
    targets: [['swyr://shell', null, '[data-section]']]
  },
  {
    name: 'command bar with results',
    async open() {
      await t.dispatch('commandbar.open', { query: 'g' })
      await waitForJs(t, 'swyr://overlay', `document.querySelectorAll('[data-cmd-row]').length > 1`, 'command bar rows').catch(() => undefined)
    },
    close: () => t.dispatch('commandbar.close'),
    targets: [['swyr://overlay', null]]
  },
  {
    name: 'find bar',
    async open(id) {
      await t.dispatch('tab.activate', { id: id('long') })
      await t.dispatch('find.open', {})
      await t.dispatch('find.update', { query: 'quick' }).catch(() => undefined)
    },
    close: () => t.dispatch('find.close'),
    targets: [['swyr://overlay', null]]
  },
  {
    name: 'find and replace bar',
    async open(id) {
      await t.dispatch('tab.activate', { id: id('long') })
      await t.dispatch('find.open', { replace: true })
    },
    close: () => t.dispatch('find.close'),
    targets: [['swyr://overlay', null]]
  },
  {
    name: 'split view',
    async open() {
      const s = await t.state()
      const split = s.items.find((i) => i.kind === 'split')
      if (split) await t.dispatch('tab.activate', { id: split.id })
    },
    targets: [['swyr://shell', '[data-split]']]
  },
  {
    name: 'settings page',
    open: () => t.dispatch('settings.open'),
    targets: [['swyr://settings', null]]
  },
  {
    name: 'library page',
    open: () => t.dispatch('library.open'),
    targets: [['swyr://library', null]]
  },
  {
    name: 'history page',
    open: () => t.dispatch('history.open'),
    targets: [['swyr://history', null]]
  },
  {
    name: 'archive page',
    open: () => t.dispatch('archive.open'),
    targets: [['swyr://archive', null]]
  },
  {
    name: 'new tab page',
    open: () => t.dispatch('tab.new', {}),
    targets: [['swyr://newtab', null]]
  },
  {
    name: 'downloads panel',
    open: () => t.dispatch('downloads.open', { show: true }),
    close: () => t.dispatch('downloads.open', { show: false }),
    targets: [['swyr://shell', null, '[data-section]']]
  },
  {
    name: 'site settings popup',
    async open(id) {
      await t.dispatch('tab.activate', { id: id('long') })
      await t.dispatch('siteSettings.open', {})
    },
    close: () => t.dispatch('overlay.close'),
    targets: [['swyr://overlay', null]]
  },
  {
    name: 'space editor popup',
    open: () => t.dispatch('space.edit', {}),
    close: () => t.dispatch('overlay.close'),
    targets: [['swyr://overlay', null]]
  },
  {
    name: 'confirm dialog',
    async open() {
      const s = await t.state()
      await t.dispatch('dialog.open', { dialog: 'confirmClearArchive', count: 3, spaceId: s.spaces[0].id })
    },
    close: () => t.dispatch('overlay.close'),
    targets: [['swyr://overlay', null]]
  }
]

async function sweep() {
  const id = await fixtures()
  const findings = []
  const surfaces = []
  const errors = []
  const sizes = [
    [1280, 800],
    [960, 640]
  ]
  for (const appearance of ['light', 'dark']) {
    await setTheme(appearance)
    for (const [w, h] of sizes) {
      await setSize(w, h)
      for (const sf of SURFACES) {
        if (!surfaces.includes(sf.name)) surfaces.push(sf.name)
        const slug = sf.name.replace(/\(.*?\)/g, '').trim().replace(/[^a-z0-9]+/gi, '-').toLowerCase()
        const shot = path.join(shots, `${slug}-${appearance}-${w}x${h}.png`)
        try {
          await sf.open(id)
          await sleep(700)
          await t.capture(shot)
          for (const [prefix, root, exclude] of sf.targets) {
            for (const f of await scan(prefix, root, exclude)) {
              findings.push({
                id: `${slug}-${appearance}-${w}x${h}-${findings.length + 1}`,
                surface: sf.name,
                kind: f.kind,
                detail: `${f.detail}; ${f.selector}${f.text ? ` "${f.text}"` : ''}; ${appearance} ${w}x${h}`,
                screenshot: path.relative(outDir, shot)
              })
            }
          }
        } catch (err) {
          errors.push(`${sf.name} ${appearance} ${w}x${h}: ${String(err?.message ?? err).slice(0, 200)}`)
        } finally {
          if (sf.close) await sf.close().catch(() => undefined)
          await sleep(150)
        }
      }
    }
  }
  const file = writeJson('sweep-results.json', { surfaces, findings, errors })
  const counts = {}
  for (const f of findings) counts[`${f.kind} | ${f.surface}`] = (counts[`${f.kind} | ${f.surface}`] ?? 0) + 1
  for (const [k, n] of Object.entries(counts)) console.log(`${n}\t${k}`)
  for (const e of errors) console.log('surface error:', e)
  console.log(`sweep: ${surfaces.length} surfaces, ${findings.length} findings -> ${file}`)
}

let code = 0
try {
  if (SELFTEST) code = (await selftest()) ? 0 : 1
  else await sweep()
} catch (err) {
  console.error('sweep failed:', err)
  code = 2
} finally {
  await t.close()
}
process.exit(code)

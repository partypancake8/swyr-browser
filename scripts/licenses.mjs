// Regenerates THIRD_PARTY_LICENSES.md from package-lock.json and node_modules.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'))
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const direct = new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})])
const rows = new Map()
for (const [key, meta] of Object.entries(lock.packages)) {
  if (!key.startsWith('node_modules/')) continue
  const name = key.slice(key.lastIndexOf('node_modules/') + 13)
  let license = meta.license
  if (!license) {
    try {
      license = JSON.parse(fs.readFileSync(path.join(root, key, 'package.json'), 'utf8')).license
    } catch {
      /* not installed on this platform */
    }
  }
  if (!license) {
    // round 3b: a few packages ship only a license file (fuzzy, khroma)
    try {
      const dir = path.join(root, key)
      const file = fs.readdirSync(dir).find((f) => /^licen[cs]e/i.test(f))
      if (file && /Permission is hereby granted, free of charge/.test(fs.readFileSync(path.join(dir, file), 'utf8'))) license = 'MIT'
    } catch {
      /* not installed on this platform */
    }
  }
  const id = `${name}@${meta.version}`
  if (!rows.has(id)) rows.set(id, { name, version: meta.version, license: license ?? 'UNKNOWN', dev: Boolean(meta.dev), direct: direct.has(name) && !key.includes('/node_modules/', 13) })
}
const sorted = [...rows.values()].sort((a, b) => a.name.localeCompare(b.name))
const table = (list) => ['| Package | Version | License |', '|---|---|---|', ...list.map((r) => `| ${r.name} | ${r.version} | ${r.license} |`)].join('\n')
const md = `# Third-party licenses

swyr is MIT licensed (see LICENSE). It is built on the packages below, each under its own license.
Regenerate this file with \`node scripts/licenses.mjs\`.

## Bundled runtime

- Electron (MIT) ships Chromium (BSD-3-Clause) and the third-party code Chromium bundles; the full notices are in \`LICENSES.chromium.html\` inside the Electron distribution and the packaged app.
- Node.js (MIT) is embedded in Electron.
- Icons are from Lucide (ISC), via lucide-react.

## Platform libraries

- Chrome extension support: electron-chrome-extensions and electron-chrome-web-store by Samuel Maddock (MIT, https://github.com/samuelmaddock/electron-browser-shell). Extensions installed from the Chrome Web Store are downloaded by the user's own action; swyr does not mirror or redistribute them.
- Ad and tracker blocking: @ghostery/adblocker-electron, @ghostery/adblocker, @ghostery/adblocker-content, @ghostery/adblocker-electron-preload, @ghostery/adblocker-extended-selectors and @ghostery/url-parser, Copyright (c) 2017-present Ghostery GmbH.

  This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

  swyr uses these files unmodified from npm; their source is available at https://github.com/ghostery/adblocker. The filter lists they download (EasyList and EasyPrivacy, via Ghostery's prebuilt engines) are dual licensed GPL-3.0 / CC BY-SA 3.0 by The EasyList authors (https://easylist.to) and are fetched at run time, not bundled.

## Notes and canvases

- The note editor is built on TipTap (@tiptap/*, MIT, Copyright (c) 2025 Tiptap GmbH, https://github.com/ueberdosis/tiptap) and ProseMirror (MIT, Marijn Haverbeke and others), with Markdown through @tiptap/markdown and marked (MIT).
- Canvases embed Excalidraw (@excalidraw/excalidraw, MIT, https://github.com/excalidraw/excalidraw). It is bundled into the app and its fonts ship inside the app (served from swyr://canvas/excalidraw-assets/); nothing is loaded from a CDN. The bundled fonts keep their own licenses: Excalifont, Virgil, Cascadia Code, Nunito, Lilita One, Liberation Sans and Xiaolai are under the SIL Open Font License 1.1; Assistant is also OFL 1.1; Comic Shanns is MIT. Excalidraw's optional diagram import pulls in Mermaid (MIT) and its dependencies listed below.

## Direct dependencies

${table(sorted.filter((r) => r.direct))}

## Runtime dependencies (shipped in the app)

${table(sorted.filter((r) => !r.dev))}

## Development and build dependencies (not shipped)

${table(sorted.filter((r) => r.dev))}
`
fs.writeFileSync(path.join(root, 'THIRD_PARTY_LICENSES.md'), md)
console.log(`wrote ${sorted.length} packages`)

// npm test: unit checks, then headless end-to-end flows against out/ (built by npm test).
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
for (const file of ['unit.mjs', 'e2e.mjs', 'e2e-sidebar.mjs']) {
  const r = spawnSync(process.execPath, ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', path.join(here, file)], { stdio: 'inherit' })
  if (r.status !== 0) {
    console.error(`FAILED: ${file}`)
    process.exit(r.status ?? 1)
  }
}
console.log('all tests passed')

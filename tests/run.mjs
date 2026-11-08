// npm test: unit checks, then headless end-to-end flows against out/ (built by npm test).
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
for (const file of ['unit.mjs', 'platform-unit.mjs', 'unit-3a.mjs', 'livefolders-unit.mjs', 'e2e.mjs', 'e2e-sidebar.mjs', 'views.mjs', 'platform-e2e.mjs', 'documents-e2e.mjs', 'round3c-e2e.mjs', 'updater.mjs', 'security.mjs', 'parity.mjs']) {
  const r = spawnSync(process.execPath, ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', path.join(here, file)], { stdio: 'inherit' })
  if (r.status !== 0) {
    console.error(`FAILED: ${file}`)
    process.exit(r.status ?? 1)
  }
}
console.log('all tests passed')

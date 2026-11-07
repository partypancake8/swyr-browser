// Pure checks for the platform layer: Link Rules matching and the sidebar importer.
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { matchRule, ruleMatches, normalizePattern } from '../src/main/linkrules/LinkRules.ts'
import { readSidebarFile, parseSidebar, summarize } from '../src/main/import/ArcImport.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
let n = 0
const test = (name, fn) => {
  fn()
  n++
  console.log('ok', name)
}

test('link rules: hostname covers subdomains, not lookalikes', () => {
  assert.ok(ruleMatches('github.com', 'https://github.com/x'))
  assert.ok(ruleMatches('github.com', 'https://gist.github.com/'))
  assert.ok(!ruleMatches('github.com', 'https://notgithub.com/'))
  assert.ok(!ruleMatches('github.com', 'file:///github.com'))
})

test('link rules: globs and paths', () => {
  assert.ok(ruleMatches('*.google.com', 'https://docs.google.com/a'))
  assert.ok(ruleMatches('*.google.com', 'https://google.com/'))
  assert.ok(!ruleMatches('*.google.com', 'https://google.co.uk/'))
  assert.ok(ruleMatches('github.com/org/*', 'https://github.com/org/repo'))
  assert.ok(!ruleMatches('github.com/org/*', 'https://github.com/other/repo'))
  assert.equal(normalizePattern(' HTTPS://Example.NET/ '), 'example.net')
})

test('link rules: the most specific rule wins', () => {
  const rules = [
    { id: 'a', pattern: 'github.com', spaceId: 's1', profileId: 'p' },
    { id: 'b', pattern: 'github.com/work/*', spaceId: 's2', profileId: 'p' }
  ]
  assert.equal(matchRule(rules, 'https://github.com/work/x').id, 'b')
  assert.equal(matchRule(rules, 'https://github.com/me').id, 'a')
  assert.equal(matchRule(rules, 'https://example.com/'), undefined)
})

test('importer: sample sidebar file', () => {
  const sb = readSidebarFile(path.join(here, 'fixtures/sidebar-sample.json'))
  assert.deepEqual(summarize(sb), { spaces: 2, folders: 1, pinned: 2, today: 2, favorites: 0 })
  const a = sb.spaces[0]
  assert.equal(a.title, 'Imported Space A')
  assert.equal(a.pinned[0].kind, 'folder')
  assert.equal(a.pinned[0].title, 'Imported Folder')
  assert.equal(a.pinned[0].children[0].url, 'https://imported-pinned.example/in-folder')
  assert.equal(a.pinned[1].customTitle, 'Custom name')
  assert.equal(a.today[0].url, 'https://imported-today.example/')
})

test('importer: defensive against junk', () => {
  assert.throws(() => parseSidebar({}))
  assert.throws(() => parseSidebar({ sidebar: { containers: [{ global: {} }, 'x'] } }))
  const sb = parseSidebar({ sidebar: { containers: [{ global: {} }, { spaces: ['s', { id: 's', newContainerIDs: [{ pinned: {} }, 'p'] }], items: ['p', { id: 'p', childrenIds: ['t', 'missing'] }, 't', { id: 't', parentID: 'p', data: { tab: {} } }] }] } })
  assert.deepEqual(summarize(sb), { spaces: 1, folders: 0, pinned: 0, today: 0, favorites: 0 })
  assert.equal(sb.spaces[0].title, 'Imported space 1')
})

console.log(`${n} platform unit checks passed`)

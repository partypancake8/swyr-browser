// Pure checks for round 3a: Styles host matching and generated CSS, history queries, permission mapping.
import assert from 'node:assert/strict'
import { hostMatches, sitePattern, styleCss, stylesFor } from '../src/main/styles/match.ts'
import { queryVisits } from '../src/main/history/query.ts'
import { permissionsFor, originOf } from '../src/main/sitesettings/SiteSettings.ts'

let n = 0
const test = (name, fn) => {
  fn()
  n++
  console.log('ok', name)
}

test('styles: plain hostnames match the site and its subdomains', () => {
  assert.equal(hostMatches('example.com', 'https://example.com/a'), true)
  assert.equal(hostMatches('example.com', 'https://www.example.com/'), true)
  assert.equal(hostMatches('www.example.com', 'https://example.com/'), true)
  assert.equal(hostMatches('example.com', 'https://notexample.com/'), false)
  assert.equal(hostMatches('example.com', 'swyr://settings'), false)
})

test('styles: globs over protocol and host', () => {
  assert.equal(hostMatches('*.github.com', 'https://gist.github.com/x'), true)
  assert.equal(hostMatches('*.github.com', 'https://github.com/'), true)
  assert.equal(hostMatches('*.github.com', 'https://gitlab.com/'), false)
  assert.equal(hostMatches('file://*', 'file:///tmp/a.html'), true)
  assert.equal(hostMatches('file://*', 'https://example.com/'), false)
  assert.equal(hostMatches('https://*.example.com', 'https://a.example.com/'), true)
  assert.equal(hostMatches('https://*.example.com', 'http://a.example.com/'), false)
  assert.equal(sitePattern('https://www.news.ycombinator.com/item'), 'news.ycombinator.com')
  assert.equal(sitePattern('file:///tmp/x.html'), 'file://*')
})

test('styles: generated css covers colors, font, size and hidden elements', () => {
  const css = styleCss({ id: 's', hostPattern: 'a.com', enabled: true, colors: { bg: '#010203', fg: '#fff', accent: 'red' }, font: 'Futura PT', fontScale: 1.2, css: 'p{x:y}', js: '', hiddenSelectors: ['h1', '.ad'] })
  assert.match(css, /--swyr-style-bg: #010203/)
  assert.match(css, /background-color: var\(--swyr-style-bg\) !important/)
  assert.match(css, /a \* \{ color: var\(--swyr-style-accent\)/)
  assert.match(css, /font-family: 'Futura PT' !important/)
  assert.match(css, /zoom: 1.2/)
  assert.match(css, /h1 \{ display: none !important; \}/)
  assert.match(css, /\.ad \{ display: none !important; \}/)
  assert.ok(css.endsWith('p{x:y}'))
  assert.equal(styleCss({ id: 's', hostPattern: 'a', enabled: true, colors: {}, css: '', js: '', hiddenSelectors: [] }), '')
  const list = [
    { id: '1', hostPattern: 'a.com', enabled: true },
    { id: '2', hostPattern: 'a.com', enabled: false },
    { id: '3', hostPattern: 'b.com', enabled: true }
  ]
  assert.deepEqual(stylesFor(list, 'https://a.com/').map((s) => s.id), ['1'])
  assert.deepEqual(stylesFor(list, 'https://a.com/', false).map((s) => s.id), ['1', '2'])
})

test('history: newest first, deduped with visit counts, substring search', () => {
  const visits = [
    { url: 'https://a.com/', title: 'Alpha', visitedAt: 1 },
    { url: 'https://b.com/probe', title: 'Beta', visitedAt: 2 },
    { url: 'https://a.com/', title: 'Alpha', visitedAt: 3 }
  ]
  const rows = queryVisits([{ profileId: 'p', visits }])
  assert.deepEqual(rows.map((r) => [r.url, r.visitCount]), [['https://a.com/', 2], ['https://b.com/probe', 1]])
  assert.deepEqual(queryVisits([{ profileId: 'p', visits }], 'probe').map((r) => r.url), ['https://b.com/probe'])
  assert.deepEqual(queryVisits([{ profileId: 'p', visits }], 'alpha').map((r) => r.visitedAt), [3])
  assert.equal(queryVisits([{ profileId: 'p', visits }], '', 100, false).length, 3)
  assert.equal(queryVisits([{ profileId: 'p', visits }], '', 1).length, 1)
})

test('site permissions: Electron permission names map to swyr ones', () => {
  assert.deepEqual(permissionsFor('media', ['video']), ['camera'])
  assert.deepEqual(permissionsFor('media', ['audio', 'video']), ['camera', 'microphone'])
  assert.deepEqual(permissionsFor('geolocation'), ['location'])
  assert.deepEqual(permissionsFor('clipboard-read'), ['clipboard'])
  assert.deepEqual(permissionsFor('fullscreen'), [])
  assert.equal(originOf('https://x.com:8443/a?b'), 'https://x.com:8443')
  assert.equal(originOf('file:///tmp/a'), 'file://')
})

console.log(`unit-3a: ${n} passed`)

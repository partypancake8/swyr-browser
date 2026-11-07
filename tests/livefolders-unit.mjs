// Pure checks for Live Folder sources (round 3b): the RSS/Atom parser, the fixture reader and GitHub queries.
import assert from 'node:assert/strict'
import { parseFeed, parseFixture, githubQuery, decodeEntities } from '../src/main/livefolders/feed.ts'

let n = 0
const test = (name, fn) => {
  fn()
  n++
  console.log('ok', name)
}

test('feed: RSS 2.0 items with CDATA titles and entities', () => {
  const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>Blog</title><link>https://blog.example/</link>
    <item><title><![CDATA[First <b>post</b>]]></title><link>https://blog.example/1</link></item>
    <item><title>Tom &amp; Jerry &#8217;s</title><link> https://blog.example/2 </link></item>
    <item><title>No link</title><guid isPermaLink="false">abc</guid></item>
    <item><title>Guid link</title><guid>https://blog.example/3</guid></item>
  </channel></rss>`
  assert.deepEqual(parseFeed(xml), [
    { title: 'First post', url: 'https://blog.example/1' },
    { title: 'Tom & Jerry ’s', url: 'https://blog.example/2' },
    { title: 'Guid link', url: 'https://blog.example/3' }
  ])
})

test('feed: Atom entries prefer the alternate link', () => {
  const xml = `<feed xmlns="http://www.w3.org/2005/Atom"><title>F</title><link href="https://x.example/"/>
    <entry><title type="html">A &lt;one&gt;</title><link rel="self" href="https://x.example/a.atom"/><link rel="alternate" href="https://x.example/a"/></entry>
    <entry><title>B</title><link href='https://x.example/b'/></entry>
  </feed>`
  assert.deepEqual(parseFeed(xml), [
    { title: 'A <one>', url: 'https://x.example/a' },
    { title: 'B', url: 'https://x.example/b' }
  ])
})

test('feed: limit and entities', () => {
  const items = Array.from({ length: 5 }, (_, i) => `<item><title>t${i}</title><link>https://e.example/${i}</link></item>`).join('')
  assert.equal(parseFeed(`<rss><channel>${items}</channel></rss>`, 3).length, 3)
  assert.equal(decodeEntities('&lt;a&gt; &#x41; &unknown;'), '<a> A &unknown;')
})

test('fixture: keeps web links in order, rejects non-arrays', () => {
  assert.deepEqual(parseFixture([{ title: 'a', url: 'https://a.example' }, { url: 'javascript:alert(1)' }, { url: 'https://b.example' }]), [
    { title: 'a', url: 'https://a.example' },
    { title: 'https://b.example', url: 'https://b.example' }
  ])
  assert.throws(() => parseFixture({}))
})

test('github: type qualifier added when missing', () => {
  assert.equal(githubQuery('github-prs', 'is:pr is:open author:@me'), 'is:pr is:open author:@me')
  assert.equal(githubQuery('github-prs', 'repo:a/b'), 'is:pr repo:a/b')
  assert.equal(githubQuery('github-issues', 'repo:a/b'), 'is:issue repo:a/b')
  assert.match(githubQuery('github-issues', ''), /^is:issue/)
})

console.log(`${n} live folder unit checks passed`)

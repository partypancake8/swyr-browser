// Headless flows for notes, canvases and Live Folders (round 3b).
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launch, sleep } from './harness.mjs'

const t = await launch({ log: process.env.SWYR_TEST_LOG === '1' })
const step = (name) => console.log('step', name)
const docsDir = path.join(t.userData, 'documents')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'swyr-live-'))

try {
  await t.waitFor((s) => s.windows?.length === 1, 'initial state')

  step('note.new defaults the title and writes a document file')
  const noteItem = await t.dispatch('note.new', {})
  let s = await t.waitFor((s) => s.items.some((i) => i.id === noteItem), 'note item')
  const note = s.items.find((i) => i.id === noteItem)
  assert.equal(note.kind, 'note')
  assert.equal(note.section, 'today')
  assert.match(note.url, /^swyr:\/\/note\/note_/)
  const docId = note.url.split('/').pop()
  await t.dispatch('note.setContent', { itemId: noteItem, markdown: '- [ ] task one\n- [x] done' })
  await sleep(700)
  const onDisk = JSON.parse(fs.readFileSync(path.join(docsDir, docId + '.json'), 'utf8'))
  assert.equal(onDisk.kind, 'note')
  assert.equal(onDisk.title, 'Untitled note')
  assert.match(onDisk.markdown, /task one/)

  step('renaming the note renames its sidebar item')
  await t.dispatch('note.setTitle', { docId, title: 'Plans' })
  s = await t.waitFor((s) => s.items.find((i) => i.id === noteItem)?.title === 'Plans', 'renamed item')

  step('closing the note keeps its document; Library delete removes it')
  await t.dispatch('tab.close', { id: noteItem })
  await sleep(300)
  assert.equal((await t.dispatch('note.get', { docId }))?.title, 'Plans')
  const list = await t.dispatch('documents.list', { kind: 'note' })
  assert.ok(list.some((d) => d.id === docId))
  await t.dispatch('documents.delete', { docId })
  await sleep(300)
  assert.equal(await t.dispatch('note.get', { docId }), null)
  assert.ok(!fs.existsSync(path.join(docsDir, docId + '.json')))
  s = await t.state()
  assert.ok(!s.archive.some((a) => a.item.url.includes(docId)))

  step('canvas commands work without the page open')
  const canvasItem = await t.dispatch('canvas.new', { title: 'Board', activate: false })
  await t.dispatch('canvas.addText', { itemId: canvasItem, text: 'hi', x: 10, y: 10 })
  await t.dispatch('canvas.addLink', { itemId: canvasItem, url: 'https://example.com', title: 'Ex' })
  const els = await t.dispatch('canvas.getElements', { itemId: canvasItem })
  assert.equal(els.length, 2)
  assert.equal(els[1].link, 'https://example.com')
  assert.equal(await t.dispatch('canvas.addLink', { itemId: canvasItem, url: 'javascript:alert(1)' }), false)

  step('live folder refresh replaces children but keeps one the user opened')
  const fixture = path.join(tmp, 'items.json')
  fs.writeFileSync(fixture, JSON.stringify([{ title: 'A', url: 'https://a.example/' }, { title: 'B', url: 'https://b.example/' }]))
  const lf = await t.dispatch('liveFolder.new', { name: 'Feed', source: 'test', sourceConfig: { fixture } })
  s = await t.waitFor((s) => s.items.filter((i) => i.parentId === lf).length === 2, 'two children')
  const b = s.items.find((i) => i.parentId === lf && i.title === 'B')
  assert.equal(b.section, 'pinned')
  assert.equal(b.pinnedUrl, 'https://b.example/')
  await t.dispatch('tab.activate', { id: b.id })
  fs.writeFileSync(fixture, JSON.stringify([{ title: 'C', url: 'https://c.example/' }, { title: 'A2', url: 'https://a.example/' }]))
  await t.dispatch('liveFolder.refresh', { itemId: lf })
  s = await t.state()
  const kids = s.items.filter((i) => i.parentId === lf).sort((x, y) => x.order - y.order)
  assert.deepEqual(kids.map((k) => k.title), ['C', 'A2', 'B'])
  assert.equal(s.items.find((i) => i.id === lf).live.error, null)

  step('a broken source reports its error on the folder')
  await t.dispatch('liveFolder.edit', { itemId: lf, sourceConfig: { fixture: path.join(tmp, 'missing.json') } })
  const r = await t.dispatch('liveFolder.refresh', { itemId: lf })
  assert.equal(r.ok, false)
  s = await t.state()
  assert.ok(s.items.find((i) => i.id === lf).live.error)

  step('the GitHub token goes to settings, never onto the item')
  await t.dispatch('liveFolder.edit', { itemId: lf, name: 'PRs', source: 'github-prs', sourceConfig: { query: 'repo:a/b', token: 'tok123' } })
  s = await t.state()
  const folder = s.items.find((i) => i.id === lf)
  assert.equal(folder.title, 'PRs')
  assert.deepEqual(folder.live.sourceConfig, { query: 'repo:a/b' })
  assert.equal(s.settings.githubToken, 'tok123')

  step('liveFolder.delete removes the folder and its children')
  await t.dispatch('liveFolder.delete', { itemId: lf })
  s = await t.state()
  assert.ok(!s.items.some((i) => i.id === lf || i.parentId === lf))

  console.log('documents e2e passed')
} finally {
  await t.close()
}

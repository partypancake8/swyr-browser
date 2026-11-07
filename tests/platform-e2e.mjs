// Headless platform flows: extensions, ad blocker, link rules, importer, profiles, private windows.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { launch, repo, sleep } from './harness.mjs'

const fixtures = path.join(repo, 'tests/fixtures')
const step = (s) => console.log('step', s)
const t = await launch()
try {
  let s = await t.waitFor((s) => s.windows?.length === 1, 'initial state')
  assert.equal(s.settings.adblock, true, 'ad blocker is on by default')

  step('unpacked extension with an action')
  await t.dispatch('extensions.loadUnpacked', { path: path.join(fixtures, 'ext-hello') })
  s = await t.waitFor((s) => (s.extensions || []).some((e) => e.name === 'swyr hello test'), 'extension loaded')
  const ext = s.extensions.find((e) => e.name === 'swyr hello test')
  assert.equal(ext.actionTitle, 'hello')
  assert.ok(s.settings.extensions.some((x) => x.id === ext.id && x.enabled))
  await t.dispatch('extensions.toggle', { id: ext.id, enabled: false })
  s = await t.waitFor((s) => s.extensions.some((e) => e.id === ext.id && !e.enabled), 'extension off')
  await t.dispatch('extensions.toggle', { id: ext.id, enabled: true })
  await t.waitFor((s) => s.extensions.some((e) => e.id === ext.id && e.enabled), 'extension on')

  step('ad blocker counts blocked requests per tab')
  const tab = await t.dispatch('tab.new', { url: 'file://' + path.join(fixtures, 'adtest.html') })
  s = await t.waitFor((s) => (s.adblockStats?.perTab?.[tab] ?? 0) >= 1, 'blocked on adtest')

  step('link rules route external links')
  const work = await t.dispatch('space.new', { name: 'Work' })
  await t.dispatch('linkRules.add', { pattern: '*.example.net', spaceId: work })
  await t.dispatch('space.switch', { index: 0 })
  await t.dispatch('link.openExternal', { url: 'https://www.example.net/a' })
  s = await t.waitFor((s) => s.items.some((i) => i.url.includes('example.net/a') && i.spaceId === work), 'routed')
  assert.equal(s.windows[0].activeSpaceId, work)
  await t.dispatch('link.openExternal', { url: 'https://example.com/unruled' })
  s = await t.waitFor((s) => s.items.some((i) => i.url.includes('unruled') && i.spaceId === work), 'no rule opens in the active space')
  step('with the Mini Window setting on, unruled external links open in a Mini Window and ruled ones still route')
  await t.dispatch('settings.set', { openExternalLinksInMiniWindow: true })
  assert.equal(await t.dispatch('link.openExternal', { url: 'https://example.com/to-mini' }), 'mini')
  s = await t.waitFor((s) => s.windows.some((w) => w.kind === 'mini' && w.url.includes('to-mini')), 'mini window for the external link')
  assert.ok(!s.items.some((i) => i.url.includes('to-mini')), 'no tab for a link that went to the Mini Window')
  await t.dispatch('link.openExternal', { url: 'https://www.example.net/b' })
  s = await t.waitFor((s) => s.items.some((i) => i.url.includes('example.net/b') && i.spaceId === work), 'link rule wins over the Mini Window')
  await t.dispatch('mini.close')
  await t.dispatch('settings.set', { openExternalLinksInMiniWindow: false })
  s = await t.waitFor((s) => !s.windows.some((w) => w.kind === 'mini'), 'mini closed')
  const rule = s.settings.linkRules[0]
  await t.dispatch('linkRules.remove', { id: rule.id })
  s = await t.waitFor((s) => s.settings.linkRules.length === 0, 'rule removed')

  step('importer: dry run changes nothing, real run creates spaces')
  const before = s.spaces.length
  const dry = await t.dispatch('import.arc', { path: path.join(fixtures, 'sidebar-sample.json'), dryRun: true })
  assert.equal(dry.spaces, 2)
  assert.equal((await t.state()).spaces.length, before)
  await t.dispatch('import.arc', { path: path.join(fixtures, 'sidebar-sample.json') })
  s = await t.waitFor((s) => s.spaces.length === before + 2, 'imported spaces')
  const folder = s.items.find((i) => i.kind === 'folder' && i.title === 'Imported Folder')
  assert.ok(folder)
  assert.ok(s.items.some((i) => i.parentId === folder.id && i.section === 'pinned'))
  assert.ok(s.items.some((i) => i.customTitle === 'Custom name'))

  step('profiles: new, assign to a space, delete moves spaces back')
  const alt = await t.dispatch('profile.new', { name: 'Alt' })
  await t.dispatch('space.edit', { id: work, profileId: alt })
  await t.dispatch('space.switch', { id: work })
  await t.dispatch('tab.new', { url: 'swyr://newtab' })
  await sleep(300)
  const part = await t.app.evaluate(() => globalThis.__swyr.activePartition())
  assert.equal(part, `persist:profile-${alt}`)
  assert.equal(await t.dispatch('profile.delete', { id: alt }), (await t.state()).profiles[0].id)
  s = await t.state()
  assert.ok(s.spaces.every((x) => x.profileId === s.profiles[0].id))
  assert.equal(await t.dispatch('profile.delete', { id: s.profiles[0].id }), false, 'the last profile stays')

  step('private window: own partition, never written to disk')
  await t.dispatch('window.newIncognito')
  s = await t.waitFor((s) => s.windows.length === 2 && s.profiles.some((p) => p.incognito), 'private window')
  const priv = s.profiles.find((p) => p.incognito)
  assert.match(priv.partition, /^incognito-\d+$/)
  await sleep(600)
  const disk = JSON.parse(fs.readFileSync(path.join(t.userData, 'state.json'), 'utf8'))
  assert.ok(!disk.profiles.some((p) => p.incognito) && !disk.spaces.some((x) => x.incognito))

  step('a private space is listed only in its own window')
  s = await t.state()
  const privSpace = s.spaces.find((x) => x.incognito)
  assert.ok(privSpace, 'private space exists')
  const regular = s.spaces.filter((x) => !x.incognito)
  const shells = () =>
    t.app.evaluate(({ webContents }) =>
      Promise.all(
        webContents
          .getAllWebContents()
          .filter((w) => w.getURL().startsWith('swyr://shell'))
          .map((w) => w.executeJavaScript(`[...document.querySelectorAll('[data-space]')].map((el) => el.dataset.space)`))
      )
    )
  await sleep(300)
  const lists = await shells()
  assert.equal(lists.length, 2)
  const mainList = lists.find((l) => !l.includes(privSpace.id))
  const privList = lists.find((l) => l.includes(privSpace.id))
  assert.ok(mainList && privList, 'one switcher per window')
  assert.deepEqual([...mainList].sort(), regular.map((x) => x.id).sort(), 'main window lists only regular spaces')
  assert.deepEqual(privList, [privSpace.id], 'private window lists only its own space')
  // the first (regular) window can not reach the private space by index, id or next/prev
  assert.equal(await t.dispatch('space.switch', { index: regular.length }), false)
  assert.equal(await t.dispatch('space.switch', { id: privSpace.id }), false)
  for (let i = 0; i < regular.length + 1; i++) {
    await t.dispatch('space.next')
    s = await t.state()
    assert.notEqual(s.windows[0].activeSpaceId, privSpace.id)
  }

  step('settings.set merges and persists')
  await t.dispatch('settings.set', { adblockAllow: ['Example.com', 'example.com'], sidebarWidth: 999 })
  s = await t.state()
  assert.deepEqual(s.settings.adblockAllow, ['example.com'])
  assert.equal(s.settings.sidebarWidth, 400)
  console.log('platform e2e passed')
} finally {
  await t.close()
}

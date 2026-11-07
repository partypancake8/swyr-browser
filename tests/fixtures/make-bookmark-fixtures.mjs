// Rebuilds the Safari and Firefox bookmark fixtures: node tests/fixtures/make-bookmark-fixtures.mjs
// Safari: an XML plist (with a <data> value, as real files have, so the XML reader path runs) converted to binary with plutil.
// Firefox: a tiny places.sqlite with the real roots (menu, toolbar, unfiled, tags) built with node:sqlite.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const dir = path.dirname(fileURLToPath(import.meta.url))
const leaf = (url, title) => `<dict><key>WebBookmarkType</key><string>WebBookmarkTypeLeaf</string><key>URLString</key><string>${url}</string><key>URIDictionary</key><dict><key>title</key><string>${title}</string></dict></dict>`
const list = (title, children) => `<dict><key>WebBookmarkType</key><string>WebBookmarkTypeList</string><key>Title</key><string>${title}</string><key>Children</key><array>${children.join('')}</array></dict>`
const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>WebBookmarkType</key><string>WebBookmarkTypeList</string><key>Title</key><string></string>
<key>Sync</key><dict><key>Data</key><data>AAECAw==</data></dict><key>Children</key><array>
<dict><key>WebBookmarkType</key><string>WebBookmarkTypeProxy</string><key>Title</key><string>History</string></dict>
${list('BookmarksBar', [leaf('https://safari-fixture.example/bar', 'Safari Bar Page'), list('Safari Work', [leaf('https://safari-fixture.example/work', 'Safari Work Page &amp; Notes')])])}
${list('BookmarksMenu', [leaf('https://safari-fixture.example/menu', 'Safari Menu Page'), leaf('javascript:void(0)', 'bookmarklet is skipped')])}
${list('com.apple.ReadingList', [leaf('https://safari-fixture.example/read', 'Safari Reading Item')])}
</array></dict></plist>
`
const tmp = path.join(dir, 'safari/Bookmarks.xml.tmp')
fs.mkdirSync(path.dirname(tmp), { recursive: true })
fs.writeFileSync(tmp, xml)
execFileSync('/usr/bin/plutil', ['-convert', 'binary1', '-o', path.join(dir, 'safari/Bookmarks.plist'), tmp])
fs.rmSync(tmp)

const places = path.join(dir, 'firefox/places.sqlite')
fs.mkdirSync(path.dirname(places), { recursive: true })
fs.rmSync(places, { force: true })
const db = new DatabaseSync(places)
db.exec(`
CREATE TABLE moz_places (id INTEGER PRIMARY KEY, url TEXT, title TEXT, last_visit_date INTEGER);
CREATE TABLE moz_bookmarks (id INTEGER PRIMARY KEY, type INTEGER, fk INTEGER, parent INTEGER, position INTEGER, title TEXT, guid TEXT);
INSERT INTO moz_places (id, url, title) VALUES
  (1, 'https://firefox-fixture.example/toolbar', 'x'), (2, 'https://firefox-fixture.example/dev', 'x'),
  (3, 'https://firefox-fixture.example/menu', 'x'), (4, 'https://firefox-fixture.example/unfiled', 'x'),
  (5, 'place:sort=8&maxResults=10', 'x'), (6, 'https://firefox-fixture.example/tagged', 'x');
INSERT INTO moz_bookmarks (id, type, fk, parent, position, title, guid) VALUES
  (1, 2, NULL, 0, 0, '', 'root________'),
  (2, 2, NULL, 1, 0, 'menu', 'menu________'),
  (3, 2, NULL, 1, 1, 'toolbar', 'toolbar_____'),
  (4, 2, NULL, 1, 2, 'tags', 'tags________'),
  (5, 2, NULL, 1, 3, 'unfiled', 'unfiled_____'),
  (6, 2, NULL, 1, 4, 'mobile', 'mobile______'),
  (10, 1, 1, 3, 0, 'Firefox Toolbar Page', 'fx-toolbar-1'),
  (11, 2, NULL, 3, 1, 'Firefox Dev', 'fx-folder-dev'),
  (12, 1, 2, 11, 0, 'Firefox Dev Page', 'fx-dev-1'),
  (13, 3, NULL, 3, 2, NULL, 'fx-separator'),
  (14, 1, 3, 2, 0, 'Firefox Menu Page', 'fx-menu-1'),
  (15, 1, 5, 2, 1, 'Most Visited', 'fx-place-q'),
  (16, 1, 4, 5, 0, 'Firefox Unfiled Page', 'fx-unfiled-1'),
  (17, 2, NULL, 4, 0, 'some-tag', 'fx-tag-1'),
  (18, 1, 6, 17, 0, NULL, 'fx-tagged-1');
`)
db.close()
console.log('fixtures written')

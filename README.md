# swyr

swyr is an open-source macOS browser built around a vertical sidebar. Spaces hold their own pinned tabs, Today tabs and colours; Favorites sit at the top of the sidebar; a command bar opens tabs, searches the web and runs every command; Today tabs archive themselves after 12 hours. It is an open-source alternative to Arc, written from scratch on Electron (Chromium).

## Install

1. Download `swyr-0.1.0-arm64.dmg` (Apple silicon) from the releases page, or build it yourself with `npm run dist` (it lands in `dist/`).
2. Open the DMG and drag swyr into Applications.
3. Start swyr. The first run opens a short guide: import your sidebar or your Chrome, Safari or Firefox bookmarks (passwords stay behind: Electron has no password store), pick colours and web apps, and choose the defaults.

## Build and run

Requirements: macOS, Node 22.12 or newer (developed and tested on Node 26.7, which electron-vite 6 accepts), npm.

```sh
npm install        # also downloads the Electron binary (postinstall)
npm run dev        # run with hot reload
npm run build      # build main, preload and renderers into out/
npm run typecheck
npm run lint
npm test           # build, then unit checks and headless end-to-end flows
npm run dist       # package dist/swyr-0.1.0-arm64.dmg (and a zip)
```

## Headless tests

Tests run the built app with `SWYR_TEST=1`: windows are never shown, every page starts muted (set `SWYR_AUDIO=1` to hear it), `SWYR_USER_DATA` points the profile at a temporary folder, and `globalThis.__swyr` (getState, dispatch, dispatchIn, waitIdle, capture, captureMini, evalInActiveTab, partitionOf, activePartition) drives it through Playwright's `_electron.launch`.

- `npm test` runs every suite one after another (never in parallel), ending with the parity suite.
- `node tests/parity.mjs` re-proves every feature marked done in the table below and prints `PARITY <row> ok` for each one (or `PARITY <row> FAIL <reason>` and exits non-zero). Pages come from a local HTTP server, so it needs no network. Set `SWYR_TEST_OUT=<dir>` to keep its captures.
- `node tests/packaged.mjs` smoke-tests the packaged app after `npm run dist`.

Gestures and window chrome (hover reveal, swipe, drags, full screen, traffic lights, DevTools and picture-in-picture windows) cannot be driven headless; the suite proves the command or state change the gesture triggers, and the table says so.

## Features

Status of every row of the feature inventory swyr set out to match. done = proven by `tests/parity.mjs`; partial = works with a named gap; out-of-scope = deliberately not built, with the reason.

<!-- feature-table:start -->
| Row | Feature | Status | Note |
|---|---|---|---|
| 1 | Vertical sidebar | done | Sidebar holds URL field, Favorites, Pinned, Today and the space switcher; parity checks the shell DOM, pane x >= sidebar width, capture r01-sidebar |
| 2 | Sidebar collapse | done | Cmd+S menu item runs sidebar.toggle; sidebarVisible false and the page pane starts at x < 20; capture r02-sidebar-hidden |
| 3 | Hover sidebar reveal | done | synthetic mouseMove onto the 6 px left-edge hot zone opens the sidebar overlay (sidebar.peek), capture r03-hover-reveal; real pointer gesture itself unverified headless |
| 4 | Spaces | done | space.new with own pinned tabs; Ctrl+1 / Ctrl+2 keys through the shell switch spaces and hide the other space rows |
| 5 | Space color / gradient | done | space.edit with three colour stops at 135 deg; shell .space-bg computes a 3-stop linear-gradient(135deg), capture r05-gradient |
| 6 | Space icon / emoji | done | space.new emoji shows on its [data-space] switcher button |
| 7 | Space swipe | done | synthetic precise horizontal mouseWheel events on the sidebar switch the space; a real two-finger trackpad swipe is unverified headless |
| 8 | Next/prev space | done | Cmd+Opt+Right / Left keys through the shell run space.next / space.prev |
| 9 | Per-space profile | done | space.edit profileId links Work to the Alt profile; activePartition of its tab is persist:profile-<alt>; Favorites shared only within a profile |
| 10 | Profiles | done | profile.new makes a second partition; a cookie set in one profile session is absent in the other |
| 11 | Favorites | done | tab.favorite moves the tab to the profile grid (spaceId null); Cmd+1 menu item opens it; shown in another space of the same profile, hidden in a space of another profile |
| 12 | Pinned tabs | done | Cmd+D menu item runs tab.togglePin; pinnedUrl set, row under [data-section=pinned]; never auto-archived (row 14) |
| 13 | Today tabs | done | tab.new lands in section today below the divider ([data-section=today] row) |
| 14 | Auto-archive timer | done | settings archiveAfter 24h: archive.runAuto at +23 h keeps the tab, at +25 h archives it with reason auto, pinned stays; never archives nothing at +400 days |
| 15 | Archive view | done | tab.close puts the tab in the Archive; archive.open page lists it (capture r15-archive), archive.restore brings it back; searchable in the Command Bar (row 66) |
| 16 | Clear Today tabs | done | tab.archiveAllToday (Cmd+Shift+K) archives every Today tab of the space, pinned tabs survive |
| 17 | Folders | done | folder.new in Pinned, nested folder.new with parentId, tab.move into it, folder.toggle collapses and hides its rows |
| 18 | Tab reordering | done | tab.move reorders Today and crosses the divider (pins with pinnedUrl, unpins clears it); the mouse drag gesture itself is unverified headless (tests/e2e-sidebar.mjs drives it with synthetic mouse events) |
| 19 | Tab renaming | done | tab.rename sets customTitle on a pinned tab and its sidebar row shows the new name |
| 20 | Pinned-tab URL reset | done | pinned tab navigated away shows the Back to pinned URL button in its row; clicking it returns to pinnedUrl |
| 21 | Split View | done | Ctrl+Shift+= key splits, split.add to 4 panes (5th refused), vertical layout, one combined sidebar row data-split=4, capture r21-split4 |
| 22 | Split drag-to-split | done | split.dropZones shows edge targets (capture r22-drop-zones), split.drop edge left, split.setRatios by divider position, split.swap; the drag gestures themselves are unverified headless |
| 23 | Split focus / close | done | Ctrl+Shift+1, Ctrl+Shift+] and [ keys move pane focus; Ctrl+Shift+- closes the focused pane; split.remove dissolves |
| 24 | Command Bar | done | commandbar.open new; clicking the URL suggestion opens a new tab, commands are listed by title; capture r24-commandbar |
| 25 | Cmd+L vs Cmd+T | done | commandbar.open current is prefilled with the tab URL; choosing a URL navigates the same item in place with no new tab |
| 26 | URL field in sidebar | done | the sidebar URL button shows the host and clicking it opens the Command Bar on the current tab |
| 27 | Copy URL | done | page.copyUrl returns the URL, clipboard holds it, toast shown |
| 28 | Copy URL as Markdown | done | page.copyUrlMarkdown writes [Title](url) to the clipboard |
| 29 | Mini Window | done | mini.new opens a small separate window with its own chrome (captureMini r29-mini) |
| 30 | Mini Window open-in-space | done | mini.openInMain with a spaceId moves the page into that space and switches to it |
| 31 | Open Link in Mini Window | done | page context-menu event lists Open Link in Mini Window; clicking it opens a Mini Window on the link; openExternalLinksInMiniWindow sends external links to a Mini Window |
| 32 | Preview | done | a cross-site link in a pinned tab opens the Preview card while the pinned tab stays (capture r32-preview); preview.expand keeps it as a Today tab |
| 33 | Link Rules | done | rules route open-url links by site, by source app, or both (parity: the same localhost link goes to Side from Slack and to Home from Mail, matched by name or bundle id; a source-only rule; Settings pane and rule editor have a From app field); macOS open-url carries no sender, so the source app is detected with the frontmost-app heuristic (lsappinfo front, osascript fallback, 300 ms cap) at the moment the link arrives |
| 34 | Styles | done | two style.save styles apply on one site, style.toggle turns one off, Library Styles section lists them (added this round) |
| 35 | Styles colour / font editor | done | style.save colours bg/fg, font Georgia, fontScale: computed body colours and font change; Styles panel capture r35-style-panel |
| 36 | Hide element picker | done | style.pickElement plus a real synthetic click on the page element hides it and persists the selector per site |
| 37 | Styles custom CSS/JS | done | style.save css and js: after reload the CSS rule and the script effect are present; code editor page capture r37-style-code |
| 38 | Style sharing | done | style.export copies a swyr-style: share code; style.import installs it as a new style that applies (added this round, Library and Styles page buttons) |
| 39 | Extensions | done | extensions.loadUnpacked loads a Chrome MV3 extension with its action; extensions.openStore opens the Chrome Web Store tab; extensions page opens |
| 40 | Canvases | done | canvas.new mounts the board (<canvas> element), canvas.addText and addLink persist elements, pinnable, Ctrl+Shift+E binding; capture r40-canvas |
| 41 | Notes | done | note.new and note.setContent: editor shows the text, document file saved, note pinned, Ctrl+N binding; capture r41-note |
| 42 | Notes in split | done | note.new with split true opens the note as a pane of a split (Ctrl+Opt+N); capture r42-note-split |
| 43 | Live Folders | done | liveFolder.new rss source on a local feed, liveFolder.refresh fills the folder with the feed items; capture r43-live-folder |
| 44 | Site Settings | done | siteSettings.info returns permissions, ad blocking, blocked count, styles, extensions, zoom; setPermission deny persists; popover capture r44-site-settings |
| 45 | Site Search | done | settings.siteSearch with a custom keyword: typing "lo kittens" resolves to the site search URL; built-in yt, gh, w shortcuts |
| 46 | Picture in Picture auto | done | pipAuto on: switching away from a tab with a playing video requests picture-in-picture (request recorded by a page stub, since the PiP window itself is an on-screen window unverified headless) |
| 47 | Media controls in sidebar | done | playing audio shows the [data-media] bar in another space; media.toggle pauses and resumes; capture r47-media-bar |
| 48 | Mini player | done | the sidebar media bar is a compact (<= 48 px) player with play/pause, go-to-tab and stop |
| 49 | Downloads | done | a served attachment downloads to the chosen folder (state completed, file contents checked); downloads.open panel capture r49-downloads-panel; Library Downloads section lists it (added this round) |
| 50 | Library | done | library.open lists Archive, Spaces, Downloads, Notes, Canvases, Styles and Media; capture r50-library |
| 51 | Developer mode | done | page.viewSource opens view-source:, Cmd+Opt+I/J/U bound; page.devtools and page.console stop in test mode because DevTools opens its own on-screen window (window itself unverified headless) |
| 52 | Reader mode | done | page.readerMode on an article keeps the body text and drops the noise; capture r52-reader; toggles back |
| 53 | Link previews (AI) | out-of-scope | AI feature tied to the old vendor paid service; swyr ships no AI features by design |
| 54 | Instant Links | out-of-scope | AI generated answers in the Command Bar; no AI features by design |
| 55 | Tidy Tab Titles | out-of-scope | AI renaming of tabs; no AI features by design (tabs can be renamed by hand, row 19) |
| 56 | Tidy Downloads | out-of-scope | AI renaming of downloads; no AI features by design |
| 57 | Ask on Page | out-of-scope | AI question answering on a page (already removed upstream); no AI features by design |
| 58 | Chat in Command Bar | out-of-scope | third-party AI chat entry; no AI features by design |
| 59 | Tidy Tabs | out-of-scope | AI grouping of Today tabs; no AI features by design |
| 60 | Capture | done | page.capture writes a PNG of the page (and can copy it), Cmd+Shift+2 binding |
| 61 | Account sync | out-of-scope | needs an account service; swyr is account-free and local only by design |
| 62 | Shared Spaces | out-of-scope | needs a hosted sharing service; swyr is local only by design |
| 63 | Themes | done | space.edit appearance dark / light switches the shell theme per space, plus gradient (row 5) and noise (row 65) |
| 64 | Auto dark mode | done | appearance auto follows nativeTheme: dark system gives the dark shell, light system the light shell |
| 65 | Texture / noise slider | done | space.edit theme.noise 0 vs 0.8 changes the grain overlay opacity in the shell |
| 66 | Search / tab find | done | Command Bar query lists the open tab under Open tabs and the archived tab under Archive (fuzzy); capture r66-search |
| 67 | Go to sidebar item N | done | Cmd+2 menu item runs tab.goTo and activates the second sidebar item |
| 68 | Cycle recent tabs | done | Ctrl+Tab key returns to the previously used tab (tab.cycleRecent over the five most recent) |
| 69 | Cmd+W behavior | done | Cmd+W menu item archives the Today tab (reason closed); Cmd+W in a window with no tab left closes that window (added this round) |
| 70 | Reopen closed tab | done | Cmd+Shift+T menu item restores the last archived tab |
| 71 | New window | done | window.new opens a second main window; closing it leaves one |
| 72 | New blank window | done | window.newBlank (Ctrl+Cmd+N) opens a blank window with no spaces: no [data-space] switcher, no Favorites or Pinned, a neutral theme, its own Today list and a New Tab; runtime flags it blank, space switching is a no-op there, spaces in state are unchanged, and closing it removes only its own tabs (parity checks the second window's shell DOM via shellEvalIn) |
| 73 | Private window | done | window.newIncognito: own incognito partition, its visits are not in history |
| 74 | Full-screen | done | window.fullscreen stops in test mode (real full screen takes the display); emitted enter-full-screen hides the sidebar and hover reveal works; the OS full screen itself is unverified headless |
| 75 | Window chrome | done | no title bar (content size equals window size), traffic lights at 14,14 inside the sidebar top row with 72 px inset; the drawn traffic lights are unverified headless |
| 76 | Menu bar items | done | application menu is swyr, File, Edit, View, Spaces, Archive, Tabs, Window, Help with Settings in the app menu |
| 77 | Settings panes | done | swyr://settings has General, Profiles, Link Rules, Shortcuts, Extensions, Advanced and ad blocking; Cmd+, binding; capture r77-settings (no AI pane by design) |
| 78 | Ad blocking | done | built-in blocker on by default; the adtest fixture page counts blocked tracker requests per tab |
| 79 | Password manager / autofill | out-of-scope | Electron exposes no Chromium password manager or autofill; the recommended path is a password manager extension (Bitwarden, 1Password) from the Chrome Web Store |
| 80 | Import from other browsers | done | proven: Chrome, Safari (Bookmarks.plist via plutil) and Firefox (places.sqlite) bookmarks as folders in Pinned of the current space from the File menu and the onboarding Import step, the old sidebar file, and history from Chrome/Edge/Brave, Firefox and Safari; gap: passwords are not imported because Electron has no password store (use a password manager extension) |
| 81 | Default browser | done | browser.makeDefault, http/https URL types in Info.plist; an app open-url event opens a tab through Link Rules |
| 82 | Chromium engine | done | Chromium 156 (process.versions.chrome), Chrome user agent without Electron tokens, Chrome extensions load (row 39) |
| 83 | Find in page | done | find.update counts matches, find.next / find.prev move; Find and Replace (Cmd+Opt+F, added this round) replaces one or all matches in editable fields; capture r83-find-replace |
| 84 | Zoom | done | Cmd+= key zooms in, zoom.out and zoom.reset step and reset the level |
| 85 | Mobile companion | out-of-scope | mobile app, not part of a desktop browser |
| 86 | Onboarding | done | swyr://onboarding steps Welcome, Import, Make it yours, Defaults (with the web app picker added this round), Done; onboarding.complete applies colours, archive timer, ad blocker and picked Favorites; no account step because swyr has no account |
<!-- feature-table:end -->

## Site compatibility

swyr presents itself to websites exactly as the matching Google Chrome build does, so sign-in pages (Google included) and video players treat it as Chrome:

- every session, wherever it is created (profiles, private windows, mini window, previews, extension pages), sends Chrome's reduced user agent (`Chrome/<major>.0.0.0`, the major always equal to the bundled Chromium) with no Electron or swyr token;
- the `Sec-CH-UA` client hint headers and `navigator.userAgentData` carry Chrome's brand list (GREASE, Chromium and Google Chrome in Chrome's order), and secure navigations carry them as Chrome's do;
- web pages see `window.chrome` with `app`, `csi`, `loadTimes` and `runtime`, as in Chrome;
- the ad blocker never blocks YouTube's video and image CDNs, YouTube's own player, API and playback reports on YouTube pages, or media a site serves from its own domain. Ad and tracker hosts stay blocked.

DRM video (Netflix, Disney+, Prime Video, Spotify web) still needs Widevine, which stock Electron does not ship.

## Extension native messaging

Extensions can talk to desktop apps (1Password, Bitwarden, KeePassXC) through `chrome.runtime.sendNativeMessage` and `chrome.runtime.connectNative`, as in Chrome. Host manifests are read from `<userData>/NativeMessagingHosts/<name>.json` first, then the Chrome, Chromium and Mozilla `NativeMessagingHosts` folders under `~/Library/Application Support` and `/Library`, so apps that registered with Chrome work without extra setup. The manifest's `allowed_origins` must list the extension origin; the host is started with that origin as its argument and speaks 4-byte length-prefixed JSON (1 MB per message from the host, 64 MB to it). Failures surface as Chrome's `chrome.runtime.lastError` texts. `SWYR_NATIVE_HOST_DIRS` (a `:`-separated list) replaces the search path, and `SWYR_NATIVE_DEBUG=1` logs host starts, messages and exits.

## Layout

- `src/main`: windows (BaseWindow + WebContentsViews), layout, state store, command registry, shortcuts, menus, profiles, auto-archive, the `swyr://` protocol and the test hook.
- `src/preload`: the bridge for the shell, overlay and internal pages, plus the extension preload (native messaging errors, popup sizing).
- `src/renderer`: the sidebar shell, the overlay (command bar, find and replace, space editor, Preview, Site Settings, Styles panel) and the internal pages (`swyr://newtab`, `settings`, `archive`, `library`, `history`, `styles`, `note`, `canvas`, `onboarding`).
- `src/shared`: state types, command metadata and default shortcuts.

## License

MIT, see LICENSE. Third-party licenses are listed in THIRD_PARTY_LICENSES.md.

---

swyr is not affiliated with The Browser Company. Arc is a trademark of The Browser Company of New York, Inc.

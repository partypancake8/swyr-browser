# swyr

swyr is an open-source macOS browser built around a vertical sidebar, written from scratch on Electron (Chromium) as an alternative to Arc. Each space holds its own pinned tabs, Today tabs and colours. Favorites sit at the top of the sidebar. A command bar opens tabs, searches the web and runs every command, and Today tabs move to the Archive on their own after 12 hours.

## Install

1. Download `swyr-0.2.0-arm64.dmg` (Apple silicon) from the [releases page](https://github.com/partypancake8/swyr-browser/releases), or build it with `npm run dist`, which writes it to `dist/`.
2. Open the DMG and drag swyr into Applications.
3. Start swyr. The first run opens a short guide that imports your sidebar or your Chrome, Safari or Firefox bookmarks, lets you pick colours and web apps, and sets the defaults. Passwords are not imported because Electron has no password store.

You install the DMG once. After that swyr updates itself (see Updates).

## Build and run

You need macOS, npm and Node 22.12 or newer. swyr is developed and tested on Node 26.7, which electron-vite 6 accepts.

```sh
npm ci             # installs the exact locked versions and downloads the Electron binary (postinstall)
npm run dev        # run with hot reload
npm run build      # build main, preload and renderers into out/
npm run typecheck
npm run lint
npm test           # build, then unit checks and headless end-to-end flows
npm run audit      # npm audit of the production dependencies
npm run dist       # package dist/swyr-<version>-arm64.dmg, the zip and latest-mac.yml
```

Use `npm ci`, not `npm install`, so the lockfile decides every version. SECURITY.md covers how to report a vulnerability and how the packaged app is hardened.

## Headless tests

Tests launch the built app with `SWYR_TEST=1` through Playwright's `_electron.launch`. In that mode windows are never shown and every page starts muted (set `SWYR_AUDIO=1` to hear it). `SWYR_USER_DATA` points the profile at a temporary folder, and the test drives the app through `globalThis.__swyr` (getState, dispatch, dispatchIn, waitIdle, capture, captureMini, evalInActiveTab, partitionOf, activePartition).

- `npm test` runs every suite one after another, never in parallel, and ends with the parity suite.
- `node tests/parity.mjs` re-proves every feature marked done in the table below. It prints `PARITY <row> ok` for each row, or `PARITY <row> FAIL <reason>` and exits non-zero. Pages come from a local HTTP server, so it needs no network. Set `SWYR_TEST_OUT=<dir>` to keep its captures.
- `node tests/packaged.mjs` smoke-tests the packaged app after `npm run dist`. Its fuses lock out the Node inspector, so this test and `node tests/packaged-platform.mjs` (extensions, native messaging and the ad blocker in the signed app) drive it over the Chrome DevTools Protocol instead of Playwright. Commands go to `globalThis.__swyr` in the main process over the binary's stdin and stdout, which `SWYR_TEST_STDIO=1` opens only under `SWYR_TEST=1`. The sidebar's bridge is only read for state and probed to show the IPC guard still drops local paths and refuses main-only commands.
- `node tests/updater.mjs` proves an update offered by a local feed reaches state and the sidebar.

Gestures and window chrome (hover reveal, swipe, drags, full screen, traffic lights, DevTools and picture-in-picture windows) cannot be driven headless. For these the suite proves the command or state change that the gesture triggers, and the row's note says so.

## Features

The table lists every row of the feature inventory swyr set out to match. A row marked done is proven by `tests/parity.mjs`. A row marked partial works with a named gap, and a row marked out-of-scope was deliberately not built, with the reason in its note.

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
| 77 | Settings panes | done | swyr://settings has General, Profiles, Link Rules, Shortcuts, Extensions, Advanced and ad blocking, plus a search box that finds any setting or shortcut across the panes; Cmd+, binding; capture r77-settings (no AI pane by design) |
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

## Updates

swyr updates itself from the GitHub releases of this repository through electron-updater.

- A release build checks 20 seconds after it starts and then every 2 hours. It reads `latest-mac.yml` from the newest release, downloads the zip it names and checks its sha512.
- While the download runs, and once it is ready, a row at the bottom of the sidebar says so. Click "swyr 0.2.1 is ready. Restart to update." to install it now. Otherwise the update installs the next time you quit swyr.
- Settings > General > Updates shows the running version and the last check, and has a Check for updates button. The swyr menu has Check for Updates… as well.
- If a download or install fails, the row and Settings keep the new version on offer and open its release page, where you can download the DMG by hand.
- Development builds started from `out/main/index.js` never check.

Releases are signed with an Apple Development certificate and are not notarized. Squirrel.Mac, which installs the update, accepts a new version only when its signature matches the installed app, so every release must be signed with the same certificate. The first install still needs a right-click Open past Gatekeeper. If Squirrel.Mac refuses an update, swyr falls back to the release page as above. Installing an update over an unnotarized build has not been tested end to end yet; 0.2.0 to 0.2.1 is the first real case.

To publish a release, bump `version` in package.json, commit and push main, then run `swyr-release` (in `~/bin`) from the repository. It checks that main is clean and matches origin/main, runs `npm run dist` and `node tests/packaged.mjs`, and creates the GitHub release `v<version>` with the DMG, the zip and `latest-mac.yml`. `swyr-release --notes-file <path>` sets the release notes. It refuses to run when that release already exists. The headless check `node tests/updater.mjs` serves a local feed that offers 9.9.9 and proves the app reports it and shows the sidebar row (`SWYR_UPDATE_FEED` and `SWYR_UPDATE_NO_DOWNLOAD=1` under `SWYR_TEST=1`).

## Site compatibility

swyr presents itself to websites as the matching Google Chrome build, so sign-in pages (Google included) and video players treat it as Chrome. Every session sends Chrome's reduced user agent, `Chrome/<major>.0.0.0`, with the major version always equal to the bundled Chromium and no Electron or swyr token. This applies wherever a session is created: profiles, private windows, the mini window, previews and extension pages. The `Sec-CH-UA` client hint headers and `navigator.userAgentData` carry Chrome's brand list (GREASE, Chromium and Google Chrome, in Chrome's order), and secure navigations send these headers as Chrome's do. Web pages also see `window.chrome` with `app`, `csi`, `loadTimes` and `runtime`, as in Chrome.

The built-in ad blocker never blocks YouTube's video and image CDNs, YouTube's own player, API and playback reports on YouTube pages, or media that a site serves from its own domain. Ad and tracker hosts stay blocked.

DRM video (Netflix, Disney+, Prime Video, Spotify web) still needs Widevine, which stock Electron does not ship.

## Extension native messaging

Extensions reach desktop apps such as 1Password, Bitwarden and KeePassXC through `chrome.runtime.sendNativeMessage` and `chrome.runtime.connectNative`, as in Chrome. swyr reads host manifests from `<userData>/NativeMessagingHosts/<name>.json` first, then from the Chrome and Chromium `NativeMessagingHosts` folders under `~/Library/Application Support` and `/Library`, so an app that registered with Chrome works without extra setup. No other folder is searched, and a page or extension cannot supply a path. The manifest's `allowed_origins` must list the extension origin. swyr starts the host with that origin as its argument, and the host speaks 4-byte length-prefixed JSON, up to 1 MB per message from the host and 64 MB to it. Failures surface as Chrome's `chrome.runtime.lastError` texts. In headless test runs (`SWYR_TEST=1`) only, `SWYR_NATIVE_HOST_DIRS`, a `:`-separated list of absolute paths, replaces the search path. `SWYR_NATIVE_DEBUG=1` logs host starts, messages and exits.

## Security

Isolation. Every renderer runs in Chromium's sandbox: swyr calls `app.enableSandbox()` before startup, so no view can opt out. Every view (sidebar, overlay, tabs, Preview, Mini Window bar and page, extension popups and any window the extensions library opens) runs with context isolation on, Node integration off in pages, workers and frames, web security on, insecure content blocked, and `<webview>` refused. Internal `swyr://` pages are served with a Content-Security-Policy that loads scripts only from swyr's own bundles, with no inline script, no eval and no remote code, and forbids framing.

Internal pages. Web content can never open a `swyr://` page or a local file. Links, `location` changes, redirects, frames and `window.open` to `swyr://` or `file://` are blocked, the protocol handler answers 403 to any `swyr://` request that a web page started, and the context menu offers only Copy Link for such links. `javascript:` and `vbscript:` URLs never load through any command. URLs typed in the Command Bar or the URL field, or sent by an internal page, are also refused when they are `data:` pages or local files.

IPC. Web pages get no `window.swyr`, no `ipcRenderer`, no `require` and no `process`. Their preload only sets Chrome's `window.chrome` and brand list and forwards the mouse back and forward buttons. Every IPC channel goes through one guard (`src/main/security/IpcGuard.ts`) that checks who sent the message: the sidebar and overlay may run any command except test-only ones, `swyr://` pages in tabs may run a short list, the Mini Window bar only its own commands, and web pages only the mouse buttons and the ad blocker's cosmetic filters. Messages from sub-frames are refused unless the channel needs them. Payloads are type-checked, local file paths are dropped (files are always picked in a dialog swyr opens), and refused URLs fail before any command runs.

External links. `link.openExternal` opens `http` and `https` links in swyr and hands only `mailto`, `tel`, `sms`, `facetime`, `zoommtg`, `slack`, `spotify`, `vscode` and `x-apple.systempreferences` links to macOS. Anything else returns false.

Permissions. When a site asks for notifications, location, the camera, the microphone, MIDI devices, clipboard reading, pointer or keyboard lock, idle detection, window management, local fonts or the local network, swyr shows a prompt with Allow and Block. The answer is remembered for that site and listed in Site Settings, where each decision can be switched or reset. A prompt that nobody answers within 60 seconds, or that is closed, denies the request without remembering it. Device choosers (USB, HID, serial, Bluetooth) and screen capture are denied. Permissions Chrome grants without asking, such as fullscreen and clipboard writes, are granted. `swyr://` pages get the camera, microphone, notifications and clipboard without a prompt.

Secrets. The GitHub token for Live Folders is encrypted with Electron's `safeStorage`, whose key lives in the macOS Keychain, and written to `secrets.bin` in the profile folder. It never goes into `state.json`, into exports, or into the state sent to the sidebar and pages, which only learn whether a token is set. `settings.set` refuses it; the folder editor sets it through `liveFolder.setToken`. A token from an older `state.json` moves into `secrets.bin` on the next start.

Private windows. A private window uses an in-memory session and writes nothing to disk: its spaces and tabs never reach `state.json`, notes and canvases made in it stay in memory, history is not recorded, the downloads list is never saved, and permission answers last only until the window closes. Its cookies and site data are cleared when it closes.

Styles. Style CSS applies wherever its pattern matches, but style JavaScript runs only for styles you turned on for a named site, never for catch-all patterns such as `*`. Installing a shared style that contains JavaScript first shows a confirmation that names the site and says the code will run there.

Extensions and downloads. Extensions install only from the Chrome Web Store flow or from a folder you choose in the Load Unpacked dialog. Downloads never open by themselves. Disk images, installer packages, apps, shell scripts, `.command`, `.js` and `.jar` files are flagged in the downloads panel and ask for confirmation before they open.

Packaged app. The signed binary has its Electron fuses set before signing: it cannot run as Node, ignores `NODE_OPTIONS` and `--inspect`, and refuses to start if `app.asar` was edited. It runs with the hardened runtime and keeps library validation on. Dependencies install from the lockfile with `npm ci`, and `npm run audit` reports no vulnerabilities in the production dependencies; a few fixes come from `overrides` in `package.json`.

Reporting. SECURITY.md covers how to report a vulnerability, which versions get fixes, and the full list of fuses, entitlements and overrides.

Other. swyr runs no script built from page text in pages; its own helpers on web pages run in isolated worlds. The spellchecker downloads dictionaries only from Chromium's default server. swyr does not hide automation signals beyond what Chrome itself shows.

## Settings search

The search box at the top of `swyr://settings` indexes every setting and every shortcut binding title across the panes. Each result names its pane, and clicking a result opens that pane, scrolls to the row and highlights it briefly.

## Layout

- `src/main`: windows (BaseWindow + WebContentsViews), layout, state store, command registry, shortcuts, menus, profiles, auto-archive, the `swyr://` protocol and the test hook.
- `src/preload`: the bridge for the shell, overlay and internal pages, the tab preload (Chrome's `window.chrome` and brand list on web pages, mouse back and forward buttons) and the extension preload (native messaging errors, popup sizing).
- `src/renderer`: the sidebar shell, the overlay (command bar, find and replace, space editor, Preview, Site Settings, Styles panel) and the internal pages (`swyr://newtab`, `settings`, `archive`, `library`, `history`, `styles`, `note`, `canvas`, `onboarding`).
- `src/shared`: state types, command metadata and default shortcuts.

## License

MIT, see LICENSE. Third-party licenses are listed in THIRD_PARTY_LICENSES.md.

---

swyr is not affiliated with The Browser Company. Arc is a trademark of The Browser Company of New York, Inc.

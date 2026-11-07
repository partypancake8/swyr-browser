# swyr

swyr is an open-source macOS browser built around a vertical sidebar. Spaces hold their own pinned tabs, Today tabs and colours; Favorites sit at the top of the sidebar; a command bar opens tabs, searches the web and runs every command; Today tabs archive themselves after 12 hours. It is an open-source alternative to Arc, written from scratch on Electron (Chromium).

## Build and run

Requirements: macOS, Node 22.12 or newer (developed and tested on Node 26.7, which electron-vite 6 accepts), npm.

```sh
npm install        # also downloads the Electron binary (postinstall)
npm run dev        # run with hot reload
npm run build      # build main, preload and renderers into out/
npm run typecheck
npm run lint
npm test           # build, then unit checks and headless end-to-end flows
```

Tests run the built app with `SWYR_TEST=1`: windows are never shown, `SWYR_USER_DATA` points the profile at a temporary folder, and `globalThis.__swyr` (getState, dispatch, waitIdle, capture) drives it through Playwright.

## Layout

- `src/main`: windows (BaseWindow + WebContentsViews), layout, state store, command registry, shortcuts, menus, profiles, auto-archive, the `swyr://` protocol and the test hook.
- `src/preload`: the bridge for the shell, overlay and internal pages.
- `src/renderer`: the sidebar shell, the overlay (command bar, find, space editor) and the internal pages (`swyr://newtab`, `swyr://settings`, `swyr://archive`).
- `src/shared`: state types, command metadata and default shortcuts.

## License

MIT, see LICENSE. Third-party licenses are listed in THIRD_PARTY_LICENSES.md.

---

swyr is not affiliated with The Browser Company. Arc is a trademark of The Browser Company of New York, Inc.

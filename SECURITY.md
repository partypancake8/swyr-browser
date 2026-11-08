# Security policy

## Supported versions

Only the latest release on the [releases page](https://github.com/partypancake8/swyr-browser/releases) gets security fixes. swyr updates itself, so a fix ships as a new release and reaches installed copies through the in-app updater. Older releases are not patched.

| Version | Supported |
| --- | --- |
| latest release | yes |
| anything older | no |

## Reporting a vulnerability

Report it privately through GitHub: open the repository's Security tab and choose "Report a vulnerability" (GitHub private vulnerability reporting). Do not open a public issue, and do not send it by email.

Include the swyr version (swyr menu, About swyr), the macOS version, the steps or a page that reproduces it, and what an attacker gains.

## What to expect

- An acknowledgement within 7 days.
- A first assessment within 14 days: whether it is a vulnerability, how severe it is, and a planned fix.
- A fixed release as soon as the fix is ready, then a published GitHub security advisory that credits you unless you ask otherwise.

swyr is maintained by one person, so these are targets, not guarantees. If a report goes unanswered for 14 days, add a comment to it.

## How the packaged app is hardened

- Electron fuses are set in `scripts/after-pack.mjs` before signing: `RunAsNode`, `EnableNodeOptionsEnvironmentVariable`, `EnableNodeCliInspectArguments` and `GrantFileProtocolExtraPrivileges` are off; `EnableCookieEncryption`, `EnableEmbeddedAsarIntegrityValidation` and `OnlyLoadAppFromAsar` are on. The signed swyr binary therefore cannot be used as a Node interpreter, cannot be attached to with `--inspect`, and refuses to start if `app.asar` was edited. `npx @electron/fuses read --app dist/mac-arm64/swyr.app` lists them.
- `Info.plist` carries the SHA-256 of the `app.asar` header (`ElectronAsarIntegrity`), which electron-builder writes and the asar integrity fuse checks.
- The app is signed with the hardened runtime. Its entitlements are only `allow-jit` and `allow-unsigned-executable-memory` (V8 and Chromium need both), `network.client`, and `device.camera` and `device.audio-input` (sites ask for them, and macOS still asks you). Library validation stays on: swyr loads no native modules, and native messaging hosts run as their own processes. swyr never requests `disable-library-validation`, `allow-dyld-environment-variables` or `get-task-allow`.
- The only files outside `app.asar` are the ad blocker's and the extensions library's preload scripts, which the sessions load by file path. They sit inside the signed bundle, so the code signature covers them.
- `tests/packaged.mjs` and `tests/packaged-platform.mjs` run against the signed, fused app: launch, page load, extensions, native messaging and the ad blocker, plus proof that `--inspect` and `ELECTRON_RUN_AS_NODE` are refused.

## Dependencies

- Installs use `npm ci`, so the committed lockfile decides every version. Electron is pinned to an exact version.
- `npm run audit` runs `npm audit --omit=dev`. A release ships with no critical vulnerability and no high vulnerability that has a fix.
- Dependabot opens weekly pull requests for npm packages and GitHub Actions, with minor and patch updates grouped. Electron majors are upgraded by hand.
- CI (`.github/workflows/ci.yml`) runs typecheck, lint, build, the audit and the unit suites on every push and pull request.

Some fixes are applied through `overrides` in `package.json` because the package that pulls in the vulnerable version has no fixed release yet:

| Package | Pulled in by | Advisory | Override |
| --- | --- | --- | --- |
| lodash-es | mermaid and chevrotain, through @excalidraw/excalidraw 0.18.1 (latest) | GHSA-r5fr-rjxr-66jc, GHSA-xxjr-mmjv-4gpg (high) | 4.18.1 |
| nanoid | @excalidraw/excalidraw and @excalidraw/mermaid-to-excalidraw | GHSA-mwcw-c2x4-8c55 and others (high) | 3.3.20 and 5.1.16 |
| katex | mermaid | GHSA-238p-pmpm-9mq7 (low) | 0.19.1 |
| adm-zip | electron-chrome-web-store 0.13.0 (latest), which asks for ^0.5 | GHSA-vwc7-r8mq-g2x9, GHSA-xcpc-8h2w-3j85 and six more (high) | 0.6.1 |

Remove an override once its parent package ships the fixed version.

## Known advisories

`npm audit --omit=dev` reports nothing today. The adm-zip override is the one to watch: electron-chrome-web-store declares `adm-zip ^0.5`, and every 0.5 release is affected by the advisories above, which include path traversal through symlinks and memory exhaustion from crafted zips. swyr uses adm-zip only to unpack an extension that the Chrome Web Store served over HTTPS, after you confirm the install; the library checks that the CRX's public key matches the extension ID you asked for, but it does not verify the CRX signature. A Web Store install through 0.6.1 was tested headless (uBlock Origin Lite, 1,028 files). If a later adm-zip breaks store installs, the override has to go, and the advisories return as known and unfixed until electron-chrome-web-store updates.

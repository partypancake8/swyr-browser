// Loaded with -r by npm run perf, after the Playwright loader: the automation switches it adds keep hidden pages
// from being throttled, which would hide the very behaviour the suite measures.
/* global require */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded with -r, so CommonJS
const { app } = require('electron')
for (const s of ['disable-renderer-backgrounding', 'disable-background-timer-throttling', 'disable-backgrounding-occluded-windows']) {
  app.commandLine.removeSwitch(s)
}

// Round 3c app commands: onboarding, window bounds and window chrome, the shortcut table (list, set, record,
// reset), the About panel, and the page commands of the full shortcut table that no other module owns.
// Registered after the platform commands, so shortcuts.record and shortcuts.reset here replace the earlier ones.
import { app, clipboard, dialog, Menu } from 'electron'
import path from 'node:path'
import { itemTitle } from '@shared/ops'
import type { CommandContext, Commands } from './Commands'
import { registerOnboardingCommands } from '../onboarding/Onboarding'
import { acceleratorFromInput } from './platform'
import { ISSUES_URL } from '../menu/Menu'
import { aboutPanelOptions } from '../menu/About'

/** commands the internal pages (swyr://onboarding, swyr://settings, swyr://newtab) may run over IPC */
export const APP_PAGE_COMMANDS = [
  'onboarding.open',
  'onboarding.complete',
  'import.chrome',
  'shortcuts.list',
  'shortcuts.set',
  'shortcuts.record',
  'shortcuts.reset',
  'shortcuts.open',
  'app.about'
]

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : undefined)
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined)

const SKIPPED = 'skipped in test mode'

function contents({ w }: CommandContext): Electron.WebContents | undefined {
  return w?.activeContents()
}

export function registerAppCommands(c: Commands): void {
  registerOnboardingCommands(c)

  // ----- windows
  c.register('window.setBounds', ({ core, w }, p) => {
    if (!w) return null
    const cur = w.win.getBounds()
    const width = num(p.width) ?? cur.width
    const height = num(p.height) ?? cur.height
    const rect = { x: num(p.x) ?? cur.x, y: num(p.y) ?? cur.y, width: Math.max(600, width), height: Math.max(400, height) }
    w.win.setBounds(rect)
    core.saveWindowBounds(w, true)
    const b = w.win.getBounds()
    return { x: b.x, y: b.y, width: b.width, height: b.height }
  })
  c.register('window.newBlank', async ({ core, w }) => {
    const win = core.createWindow({ spaceId: w?.space().incognito ? undefined : w?.activeSpaceId })
    await core.commands.run('tab.new', {}, win)
    return win.id
  })
  c.register('window.fullscreen', ({ core, w }) => {
    if (!w) return false
    if (core.test) return SKIPPED
    w.win.setFullScreen(!w.win.isFullScreen())
    return true
  })
  c.register('window.minimize', ({ core, w }) => {
    if (!w) return false
    if (core.test) return SKIPPED
    w.win.minimize()
    return true
  })
  c.register('app.hide', ({ core }) => {
    if (core.test) return SKIPPED
    app.hide()
    return true
  })
  c.register('app.hideOthers', ({ core }) => {
    if (core.test) return SKIPPED
    Menu.sendActionToFirstResponder('hideOtherApplications:')
    return true
  })
  c.register('app.about', ({ core }) => {
    if (core.test) return aboutPanelOptions()
    app.showAboutPanel()
    return true
  })
  c.register('help.reportIssue', ({ core, w }) => core.commands.run('tab.new', { url: ISSUES_URL }, w))

  // ----- the shortcut table
  c.register('shortcuts.list', ({ core }) => core.shortcuts.list())
  c.register('shortcuts.set', ({ core }, p) => {
    const id = str(p.id)
    const accel = str(p.accelerator)
    if (!id || !accel) return { ok: false, error: 'Give a shortcut id and an accelerator.' }
    return core.shortcuts.set(id, accel)
  })
  c.register('shortcuts.reset', ({ core }, p) => core.shortcuts.reset(str(p.id)))
  c.register('shortcuts.record', ({ core, w }, p) => {
    // listens on the page that asked (Settings > Shortcuts), then validates through shortcuts.set
    const id = str(p.id)
    const wc = w?.activeContents()
    if (!id || !wc || !core.shortcuts.bindings.some((b) => b.id === id)) return null
    return new Promise((resolve) => {
      core.shortcuts.paused = true
      const done = (accel: string | null): void => {
        clearTimeout(timer)
        if (!wc.isDestroyed()) wc.off('before-input-event', onInput)
        core.shortcuts.paused = false
        resolve(accel ? core.shortcuts.set(id, accel) : null)
      }
      const onInput = (e: Electron.Event, input: Electron.Input): void => {
        if (input.type !== 'keyDown') return
        e.preventDefault() // also keeps menu accelerators from firing
        if (input.code === 'Escape' && !input.meta && !input.control && !input.alt) return done(null)
        const accel = acceleratorFromInput(input)
        if (accel) done(accel)
      }
      const timer = setTimeout(() => done(null), 15000)
      wc.prependListener('before-input-event', onInput)
    })
  })
  c.register('shortcuts.open', ({ core, w }) => {
    if (!w) return null
    const url = 'swyr://settings#shortcuts'
    const existing = core.store.state.items.find((i) => i.spaceId === w.activeSpaceId && i.url.startsWith('swyr://settings'))
    if (existing) return core.commands.run('tab.navigate', { itemId: existing.id, url }, w).then(() => existing.id)
    return core.commands.run('tab.new', { url }, w)
  })

  // ----- page commands of the shortcut table
  c.register('page.console', (ctx) => {
    const wc = contents(ctx)
    if (!wc) return false
    if (ctx.core.test) return SKIPPED
    const show = (): void => void wc.devToolsWebContents?.executeJavaScript("DevToolsAPI.showPanel('console')").catch(() => undefined)
    if (wc.isDevToolsOpened()) show()
    else {
      wc.once('devtools-opened', show)
      wc.openDevTools({ mode: 'detach' })
    }
    return true
  })
  c.register('page.viewSource', (ctx) => {
    const url = contents(ctx)?.getURL()
    if (!url || !/^(https?|file):/i.test(url)) return false
    return ctx.core.commands.run('tab.new', { url: `view-source:${url}` }, ctx.w)
  })
  c.register('page.copyUrlMarkdown', ({ core, w }) => {
    const item = w ? core.store.state.items.find((i) => i.id === w.focusedItemId()) : undefined
    const url = w?.activeContents()?.getURL() || item?.url
    if (!w || !url) return false
    const title = (item ? itemTitle(item) : '') || url
    const text = `[${title.replace(/([[\]\\])/g, '\\$1')}](${url.replace(/\)/g, '%29')})`
    clipboard.writeText(text)
    w.toast('Copied URL as Markdown')
    return text
  })
  c.register('page.saveAs', async (ctx, p) => {
    const wc = contents(ctx)
    if (!wc) return false
    let file = str(p.path)
    if (!file) {
      if (ctx.core.test) return SKIPPED
      const name = (wc.getTitle() || 'page').replace(/[/:\\?*"<>|]+/g, ' ').trim().slice(0, 120) || 'page'
      const res = await dialog.showSaveDialog({
        title: 'Save Page As',
        defaultPath: path.join(app.getPath('downloads'), `${name}.html`),
        filters: [{ name: 'Web Page, Complete', extensions: ['html'] }]
      })
      if (res.canceled || !res.filePath) return false
      file = res.filePath
    }
    await wc.savePage(file, 'HTMLComplete')
    return file
  })
  c.register('page.print', (ctx) => {
    const wc = contents(ctx)
    if (!wc) return false
    if (ctx.core.test) return SKIPPED
    wc.print({}, () => undefined)
    return true
  })
  c.register('page.jumpToSelection', async (ctx) => {
    const wc = contents(ctx)
    if (!wc) return false
    return wc
      .executeJavaScript(
        `(() => { const s = getSelection(); if (!s || !s.rangeCount || s.isCollapsed) return false; const n = s.getRangeAt(0).startContainer; const el = n.nodeType === 1 ? n : n.parentElement; if (!el) return false; el.scrollIntoView({ block: 'center' }); return true })()`
      )
      .catch(() => false)
  })
}

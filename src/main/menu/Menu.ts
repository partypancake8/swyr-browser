// The macOS menu bar, wired to commands with accelerators from Shortcuts.
// Round 3c: every main-scope binding of the shortcut table appears here (or is handled by before-input-event),
// the Help menu carries Keyboard Shortcuts, Report an Issue and About swyr, and the dock menu lives here too.
import { Menu, type MenuItemConstructorOptions } from 'electron'
import { windowSpaces } from '@shared/ops'
import { bindingAction } from '@shared/commands'
import type { Core } from '../windows/WindowManager'
import { IMPORT_FROM_LABEL } from '@shared/importer'

/** where "Report an issue" goes (placeholder until the public repository is final) */
export const ISSUES_URL = 'https://github.com/partypancake8/swyr-browser/issues'
export const REPO_URL = 'https://github.com/partypancake8/swyr-browser'

export class AppMenu {
  private signature = ''

  constructor(private readonly core: Core) {}

  private run(command: string, payload?: unknown): void {
    void this.core.commands.run(command, payload, this.core.current()).catch((err) => console.error('[swyr]', err))
  }

  /** a menu item for a command; its accelerator comes from the binding of that command (and payload) */
  private cmd(label: string, command: string, payload?: unknown): MenuItemConstructorOptions {
    const b = this.core.shortcuts.accelerator(command, payload)
    const action = b ? bindingAction(b) : { command, payload }
    const enabled = this.core.commands.has(action.command)
    // before-input-event handles the key first in every swyr contents; the menu accelerator covers the rest
    const register = Boolean(b && !b.raw && enabled)
    return {
      label,
      accelerator: b?.accelerator,
      registerAccelerator: b ? register : undefined,
      enabled,
      click: () => this.run(action.command, action.payload)
    }
  }

  refresh(): void {
    const s = this.core.store.state
    const w = this.core.current()
    const item = w?.activeItem()
    const sig = JSON.stringify([
      s.spaces.map((x) => [x.id, x.name, x.order]),
      w?.activeSpaceId,
      item?.section,
      s.settings.shortcuts,
      s.settings.sidebarVisible,
      w?.fullscreen
    ])
    if (sig === this.signature) return
    this.signature = sig
    Menu.setApplicationMenu(Menu.buildFromTemplate(this.template()))
  }

  /** the dock icon's menu */
  dockMenu(): Menu {
    return Menu.buildFromTemplate([
      { label: 'New Window', click: () => this.run('window.new') },
      { label: 'New Mini Window', click: () => this.run('mini.new') },
      { label: 'New Private Window', click: () => this.run('window.newIncognito') }
    ])
  }

  template(): MenuItemConstructorOptions[] {
    const s = this.core.store.state
    const w = this.core.current()
    const item = w?.activeItem()
    const pinned = item && item.section !== 'today'
    const spaces = windowSpaces(s, w?.activeSpaceId)
    const sep: MenuItemConstructorOptions = { type: 'separator' }
    return [
      {
        label: 'swyr',
        submenu: [
          this.cmd('About swyr', 'app.about'),
          this.cmd('Check for Updates…', 'update.checkInteractive'),
          this.cmd('Welcome Guide', 'onboarding.open'),
          sep,
          this.cmd('Settings…', 'settings.open'),
          this.cmd('Extensions', 'extensions.open'),
          this.cmd('Make swyr the Default Browser', 'browser.makeDefault'),
          sep,
          { role: 'services' },
          sep,
          this.cmd('Hide swyr', 'app.hide'),
          this.cmd('Hide Others', 'app.hideOthers'),
          { role: 'unhide' },
          sep,
          this.cmd('Quit swyr', 'app.quit')
        ]
      },
      {
        label: 'File',
        submenu: [
          this.cmd('New Tab', 'tab.new'),
          this.cmd('New Window', 'window.new'),
          this.cmd('New Mini Window', 'mini.new'),
          this.cmd('New Private Window', 'window.newIncognito'),
          this.cmd('New Blank Window', 'window.newBlank'),
          sep,
          this.cmd('New Note', 'note.new'),
          this.cmd('New Note in Split View', 'note.new', { split: true }),
          this.cmd('New Canvas', 'canvas.new'),
          sep,
          this.cmd('New Live Folder…', 'liveFolder.editor'), // round 3b
          sep,
          this.cmd('Open Location', 'commandbar.open', { mode: 'current' }),
          sep,
          this.cmd('Close Tab', 'tab.close'),
          this.cmd('Close Window', 'window.close'),
          sep,
          this.cmd('Save Page As…', 'page.saveAs'),
          this.cmd('Print…', 'page.print'),
          sep,
          this.cmd(IMPORT_FROM_LABEL + '…', 'import.arc'),
          {
            label: 'Import Bookmarks',
            submenu: [
              this.cmd('From Chrome…', 'import.chrome'),
              this.cmd('From Safari…', 'import.safari'),
              this.cmd('From Firefox…', 'import.firefox')
            ]
          },
          {
            label: 'Import History',
            submenu: [
              this.cmd('From Chrome', 'import.history', { browser: 'chrome' }),
              this.cmd('From Edge', 'import.history', { browser: 'edge' }),
              this.cmd('From Brave', 'import.history', { browser: 'brave' }),
              this.cmd('From Firefox', 'import.history', { browser: 'firefox' }),
              this.cmd('From Safari', 'import.history', { browser: 'safari' })
            ]
          },
          this.cmd('Export swyr Data…', 'data.export')
        ]
      },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          sep,
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'pasteAndMatchStyle' },
          { role: 'delete' },
          { role: 'selectAll' },
          sep,
          this.cmd('Find…', 'find.open'),
          this.cmd('Find and Replace…', 'find.open', { replace: true }),
          this.cmd('Find Next', 'find.next'),
          this.cmd('Find Previous', 'find.prev'),
          this.cmd('Jump to Selection', 'page.jumpToSelection'),
          sep,
          this.cmd('Copy URL', 'page.copyUrl'),
          this.cmd('Copy URL as Markdown', 'page.copyUrlMarkdown')
        ]
      },
      {
        label: 'View',
        submenu: [
          this.cmd(s.settings.sidebarVisible ? 'Hide Sidebar' : 'Show Sidebar', 'sidebar.toggle'),
          this.cmd('Reader Mode', 'page.readerMode'),
          sep,
          this.cmd('Add Split View', 'split.add'),
          this.cmd('Close Split Pane', 'split.remove'),
          this.cmd('Next Split Pane', 'split.focusNext'),
          this.cmd('Previous Split Pane', 'split.focusPrev'),
          this.cmd('Toggle Split Layout', 'split.setLayout'),
          {
            label: 'Focus Split Pane',
            submenu: [1, 2, 3, 4].map((n) => this.cmd(`Pane ${n}`, 'split.focus', { pane: n }))
          },
          sep,
          this.cmd('Reload Page', 'tab.reload'),
          this.cmd('Force Reload Page', 'tab.hardReload'),
          this.cmd('Stop Loading', 'tab.stop'),
          sep,
          this.cmd('Zoom In', 'zoom.in'),
          this.cmd('Zoom Out', 'zoom.out'),
          this.cmd('Actual Size', 'zoom.reset'),
          sep,
          this.cmd(w?.fullscreen ? 'Exit Full Screen' : 'Enter Full Screen', 'window.fullscreen'),
          sep,
          {
            label: 'Developer',
            submenu: [
              this.cmd('Developer Tools', 'page.devtools'),
              this.cmd('JavaScript Console', 'page.console'),
              this.cmd('View Page Source', 'page.viewSource')
            ]
          }
        ]
      },
      {
        label: 'Spaces',
        submenu: [
          this.cmd('New Space', 'space.new'),
          this.cmd('Edit Space…', 'space.edit'),
          sep,
          this.cmd('Next Space', 'space.next'),
          this.cmd('Previous Space', 'space.prev'),
          sep,
          ...spaces.map((sp, i): MenuItemConstructorOptions => {
            const base = this.cmd(sp.name, 'space.switch', i < 9 ? { index: i } : { id: sp.id })
            return { ...base, type: 'checkbox', checked: sp.id === w?.activeSpaceId }
          }),
          sep,
          this.cmd('Library', 'library.open')
        ]
      },
      {
        label: 'Archive',
        submenu: [
          this.cmd('Open Archive', 'archive.open'),
          this.cmd('Reopen Closed Tab', 'tab.reopen'),
          sep,
          this.cmd('Archive All Today Tabs', 'tab.archiveAllToday'),
          sep,
          this.cmd('History', 'history.open'),
          this.cmd('Downloads', 'downloads.open')
        ]
      },
      {
        label: 'Tabs',
        submenu: [
          this.cmd(pinned ? 'Unpin Tab' : 'Pin Tab', 'tab.togglePin'),
          this.cmd('Add to Favorites', 'tab.favorite'),
          this.cmd('Rename Tab…', 'tab.rename'),
          this.cmd('Duplicate Tab', 'tab.duplicate'),
          this.cmd('Capture', 'page.capture'),
          sep,
          this.cmd('Next Tab', 'tab.next'),
          this.cmd('Previous Tab', 'tab.prev'),
          this.cmd('Cycle Recent Tabs', 'tab.cycleRecent'),
          sep,
          this.cmd('Back', 'tab.back'),
          this.cmd('Forward', 'tab.forward'),
          sep,
          {
            label: 'Go to Sidebar Item',
            submenu: Array.from({ length: 9 }, (_, i) => this.cmd(`Item ${i + 1}`, 'tab.goTo', { index: i }))
          },
          {
            label: 'Go to Favorite',
            submenu: Array.from({ length: 9 }, (_, i) => this.cmd(`Favorite ${i + 1}`, 'favorite.goTo', { index: i }))
          }
        ]
      },
      {
        label: 'Window',
        role: 'window',
        submenu: [
          this.cmd('Minimize', 'window.minimize'),
          { role: 'zoom' },
          sep,
          this.cmd('New Window', 'window.new'),
          this.cmd('New Mini Window', 'mini.new'),
          this.cmd('New Private Window', 'window.newIncognito'),
          sep,
          { role: 'front' }
        ]
      },
      {
        role: 'help',
        submenu: [
          this.cmd('Keyboard Shortcuts', 'shortcuts.open'),
          this.cmd('Report an Issue', 'help.reportIssue'),
          { label: 'swyr on GitHub', click: () => this.run('tab.new', { url: REPO_URL }) },
          sep,
          this.cmd('About swyr', 'app.about')
        ]
      }
    ]
  }
}

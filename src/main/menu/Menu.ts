// The macOS menu bar, wired to commands with accelerators from Shortcuts.
import { Menu, type MenuItemConstructorOptions } from 'electron'
import { windowSpaces } from '@shared/ops'
import type { Core } from '../windows/WindowManager'
import { IMPORT_FROM_LABEL } from '@shared/importer'

export class AppMenu {
  private signature = ''

  constructor(private readonly core: Core) {}

  private cmd(label: string, command: string, payload?: unknown): MenuItemConstructorOptions {
    const b = this.core.shortcuts.accelerator(command, payload)
    return {
      label,
      accelerator: b?.accelerator,
      registerAccelerator: b ? !b.raw : undefined,
      click: () => {
        void this.core.commands.run(command, payload, this.core.current()).catch((err) => console.error('[swyr]', err))
      }
    }
  }

  refresh(): void {
    const s = this.core.store.state
    const w = this.core.current()
    const item = w?.activeItem()
    const sig = JSON.stringify([
      s.spaces.map((x) => [x.id, x.name, x.emoji, x.order]),
      w?.activeSpaceId,
      item?.section,
      s.settings.shortcuts,
      s.settings.sidebarVisible
    ])
    if (sig === this.signature) return
    this.signature = sig
    Menu.setApplicationMenu(Menu.buildFromTemplate(this.template()))
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
          { role: 'about', label: 'About swyr' },
          sep,
          this.cmd('Settings…', 'settings.open'),
          this.cmd('Extensions', 'extensions.open'),
          sep,
          { role: 'services' },
          sep,
          { role: 'hide', label: 'Hide swyr' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          sep,
          this.cmd('Quit swyr', 'app.quit')
        ]
      },
      {
        label: 'File',
        submenu: [
          this.cmd('New Tab', 'commandbar.open', { mode: 'new' }),
          this.cmd('New Window', 'window.new'),
          this.cmd('New Private Window', 'window.newIncognito'),
          sep,
          // round 3b
          this.cmd('New Note', 'note.new'),
          this.cmd('New Canvas', 'canvas.new'),
          this.cmd('New Live Folder…', 'liveFolder.editor'),
          sep,
          this.cmd('Open Location…', 'commandbar.open', { mode: 'current' }),
          sep,
          this.cmd('Close Tab', 'tab.close'),
          this.cmd('Close Window', 'window.close'),
          sep,
          this.cmd(IMPORT_FROM_LABEL + '…', 'import.arc'),
          this.cmd('Export swyr Data…', 'data.export'),
          sep,
          this.cmd('Downloads', 'downloads.open')
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
          this.cmd('Find Next', 'find.next'),
          this.cmd('Find Previous', 'find.prev'),
          sep,
          this.cmd('Copy URL', 'page.copyUrl')
        ]
      },
      {
        label: 'View',
        submenu: [
          this.cmd(s.settings.sidebarVisible ? 'Hide Sidebar' : 'Show Sidebar', 'sidebar.toggle'),
          sep,
          // round 2a: Split View
          this.cmd('Add Split View', 'split.add'),
          this.cmd('Close Split Pane', 'split.remove'),
          this.cmd('Next Split Pane', 'split.focusNext'),
          this.cmd('Previous Split Pane', 'split.focusPrev'),
          this.cmd('Toggle Split Layout', 'split.setLayout'),
          sep,
          this.cmd('Reload Page', 'tab.reload'),
          this.cmd('Force Reload Page', 'tab.hardReload'),
          this.cmd('Stop Loading', 'tab.stop'),
          sep,
          this.cmd('Zoom In', 'zoom.in'),
          this.cmd('Zoom Out', 'zoom.out'),
          this.cmd('Actual Size', 'zoom.reset'),
          sep,
          this.cmd('Developer Tools', 'page.devtools'),
          { role: 'togglefullscreen' }
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
            const base = this.cmd(`${sp.emoji ? sp.emoji + '  ' : ''}${sp.name}`, 'space.switch', i < 9 ? { index: i } : { id: sp.id })
            return { ...base, type: 'checkbox', checked: sp.id === w?.activeSpaceId }
          })
        ]
      },
      {
        label: 'Archive',
        submenu: [
          this.cmd('Open Archive', 'archive.open'),
          this.cmd('Reopen Closed Tab', 'tab.reopen'),
          sep,
          this.cmd('Archive All Today Tabs', 'tab.archiveAllToday')
        ]
      },
      {
        label: 'Tabs',
        submenu: [
          this.cmd(pinned ? 'Unpin Tab' : 'Pin Tab', 'tab.togglePin'),
          this.cmd('Add to Favorites', 'tab.favorite'),
          this.cmd('Rename Tab…', 'tab.rename'),
          this.cmd('Duplicate Tab', 'tab.duplicate'),
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
          }
        ]
      },
      { role: 'windowMenu' },
      {
        role: 'help',
        submenu: [this.cmd('swyr on GitHub', 'tab.new', { url: 'https://github.com/partypancake8/swyr-browser' })]
      }
    ]
  }
}

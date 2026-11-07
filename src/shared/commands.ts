// Command metadata shared by main (registry, menu, shortcuts) and renderers (command bar labels).

export interface CommandMeta {
  name: string
  title: string
  /** listed in the command bar's Commands section */
  palette?: boolean
}

export const COMMANDS: CommandMeta[] = [
  { name: 'tab.new', title: 'New Tab', palette: true },
  { name: 'tab.close', title: 'Close Tab', palette: true },
  { name: 'tab.reopen', title: 'Reopen Closed Tab', palette: true },
  { name: 'tab.pin', title: 'Pin Tab', palette: true },
  { name: 'tab.unpin', title: 'Unpin Tab', palette: true },
  { name: 'tab.togglePin', title: 'Pin or Unpin Tab' },
  { name: 'tab.favorite', title: 'Add Tab to Favorites', palette: true },
  { name: 'tab.rename', title: 'Rename Tab', palette: true },
  { name: 'tab.resetToPinnedUrl', title: 'Go Back to Pinned URL', palette: true },
  { name: 'tab.duplicate', title: 'Duplicate Tab', palette: true },
  { name: 'tab.activate', title: 'Switch to Tab' },
  { name: 'tab.goTo', title: 'Go to Sidebar Item' },
  { name: 'tab.navigate', title: 'Navigate' },
  { name: 'tab.back', title: 'Back', palette: true },
  { name: 'tab.forward', title: 'Forward', palette: true },
  { name: 'tab.reload', title: 'Reload Page', palette: true },
  { name: 'tab.hardReload', title: 'Force Reload Page', palette: true },
  { name: 'tab.stop', title: 'Stop Loading', palette: true },
  { name: 'tab.next', title: 'Next Tab', palette: true },
  { name: 'tab.prev', title: 'Previous Tab', palette: true },
  { name: 'tab.cycleRecent', title: 'Cycle Recent Tabs' },
  { name: 'tab.archiveAllToday', title: 'Archive All Today Tabs', palette: true },
  { name: 'tab.move', title: 'Move Tab' },
  { name: 'archive.restore', title: 'Restore from Archive' },
  { name: 'archive.open', title: 'Open Archive', palette: true },
  { name: 'space.new', title: 'New Space', palette: true },
  { name: 'space.switch', title: 'Switch Space' },
  { name: 'space.next', title: 'Next Space', palette: true },
  { name: 'space.prev', title: 'Previous Space', palette: true },
  { name: 'space.edit', title: 'Edit Space', palette: true },
  { name: 'space.delete', title: 'Delete Space' },
  { name: 'sidebar.toggle', title: 'Show or Hide Sidebar', palette: true },
  { name: 'sidebar.setWidth', title: 'Set Sidebar Width' },
  { name: 'sidebar.peek', title: 'Peek Sidebar' },
  { name: 'commandbar.open', title: 'Open Command Bar' },
  { name: 'commandbar.close', title: 'Close Command Bar' },
  { name: 'window.new', title: 'New Window', palette: true },
  { name: 'window.close', title: 'Close Window' },
  { name: 'page.copyUrl', title: 'Copy URL', palette: true },
  { name: 'page.devtools', title: 'Developer Tools', palette: true },
  { name: 'zoom.in', title: 'Zoom In', palette: true },
  { name: 'zoom.out', title: 'Zoom Out', palette: true },
  { name: 'zoom.reset', title: 'Actual Size', palette: true },
  { name: 'find.open', title: 'Find in Page', palette: true },
  { name: 'find.next', title: 'Find Next' },
  { name: 'find.prev', title: 'Find Previous' },
  { name: 'find.update', title: 'Update Find Query' },
  { name: 'find.close', title: 'Close Find' },
  { name: 'overlay.close', title: 'Close Overlay' },
  { name: 'settings.open', title: 'Settings', palette: true },
  { name: 'downloads.open', title: 'Downloads', palette: true },
  { name: 'tab.contextMenu', title: 'Tab Menu' },
  { name: 'space.contextMenu', title: 'Space Menu' },
  { name: 'settings.set', title: 'Change Setting' },
  { name: 'app.quit', title: 'Quit swyr', palette: true },
  // round 2b: sidebar, folders, archive, library
  { name: 'tab.unfavorite', title: 'Remove from Favorites', palette: true },
  { name: 'item.copyUrl', title: 'Copy Tab URL' },
  { name: 'folder.new', title: 'New Folder', palette: true },
  { name: 'folder.rename', title: 'Rename Folder' },
  { name: 'folder.toggle', title: 'Expand or Collapse Folder' },
  { name: 'folder.delete', title: 'Delete Folder' },
  { name: 'archive.delete', title: 'Delete from Archive' },
  { name: 'archive.clear', title: 'Clear Archive' },
  { name: 'library.open', title: 'Open Library', palette: true },
  { name: 'space.reorder', title: 'Reorder Spaces' },
  { name: 'dialog.open', title: 'Open Dialog' },
  { name: 'menu.popup', title: 'Show Menu' },
  // round 2a
  { name: 'split.add', title: 'Add Split View', palette: true },
  { name: 'split.remove', title: 'Close Split Pane', palette: true },
  { name: 'split.focus', title: 'Focus Split Pane' },
  { name: 'split.focusNext', title: 'Next Split Pane', palette: true },
  { name: 'split.focusPrev', title: 'Previous Split Pane', palette: true },
  { name: 'split.swap', title: 'Swap Split Panes' },
  { name: 'split.setLayout', title: 'Toggle Split Layout', palette: true },
  { name: 'split.setRatios', title: 'Resize Split Panes' },
  { name: 'split.drop', title: 'Drop Tab into Split View' },
  { name: 'split.dropZones', title: 'Split Drop Zones' },
  { name: 'preview.open', title: 'Open Preview' },
  { name: 'preview.close', title: 'Close Preview' },
  { name: 'preview.expand', title: 'Open Preview as Tab' },
  { name: 'mini.new', title: 'New Mini Window', palette: true },
  { name: 'mini.openInMain', title: 'Open in Main Window' },
  { name: 'mini.close', title: 'Close Mini Window' },
  { name: 'mini.navigate', title: 'Navigate Mini Window' },
  { name: 'mini.back', title: 'Back' },
  { name: 'mini.forward', title: 'Forward' },
  { name: 'mini.reload', title: 'Reload Page' },
  { name: 'mini.stop', title: 'Stop Loading' },
  { name: 'mini.focusUrl', title: 'Edit Address' },
  { name: 'mini.spaceMenu', title: 'Choose Space' },
  { name: 'media.toggle', title: 'Play or Pause Media', palette: true },
  { name: 'media.close', title: 'Stop Media', palette: true },
  { name: 'media.activate', title: 'Go to Playing Tab', palette: true },
  { name: 'media.pip', title: 'Picture in Picture', palette: true },
  // round 2c: platform
  { name: 'extensions.open', title: 'Extensions', palette: true },
  { name: 'extensions.openStore', title: 'Open the Chrome Web Store', palette: true },
  { name: 'extensions.loadUnpacked', title: 'Load Unpacked Extension…', palette: true },
  { name: 'extensions.remove', title: 'Remove Extension' },
  { name: 'extensions.toggle', title: 'Turn Extension On or Off' },
  { name: 'extensions.openPopup', title: 'Open Extension Popup' },
  { name: 'downloads.setDirectory', title: 'Change Downloads Folder…' },
  { name: 'downloads.cancel', title: 'Cancel Download' },
  { name: 'downloads.openFile', title: 'Open Downloaded File' },
  { name: 'downloads.reveal', title: 'Show Download in Finder' },
  { name: 'downloads.clear', title: 'Clear Downloads' },
  { name: 'adblock.toggle', title: 'Turn Ad Blocker On or Off', palette: true },
  { name: 'adblock.allowSite', title: 'Allow Ads on This Site', palette: true },
  { name: 'linkRules.add', title: 'Add Link Rule' },
  { name: 'linkRules.remove', title: 'Remove Link Rule' },
  { name: 'link.openExternal', title: 'Open Link' },
  { name: 'import.arc', title: 'Import Sidebar From Another Browser…', palette: true },
  { name: 'data.export', title: 'Export swyr Data…', palette: true },
  { name: 'profile.new', title: 'New Profile', palette: true },
  { name: 'profile.rename', title: 'Rename Profile' },
  { name: 'profile.delete', title: 'Delete Profile' },
  { name: 'profile.switch', title: 'Switch Profile' },
  { name: 'window.newIncognito', title: 'New Private Window', palette: true },
  { name: 'browser.makeDefault', title: 'Make swyr the Default Browser', palette: true },
  // round 3a: Styles, Site Settings, Reader, History, capture
  { name: 'style.save', title: 'Save Style' },
  { name: 'style.toggle', title: 'Turn Style On or Off' },
  { name: 'style.delete', title: 'Delete Style' },
  { name: 'style.list', title: 'List Styles' },
  { name: 'style.forActiveSite', title: 'Styles for This Site' },
  { name: 'style.siteDefaults', title: 'Style Defaults for This Site' },
  { name: 'style.pickElement', title: 'Hide an Element on This Page', palette: true },
  { name: 'style.panel', title: 'Style This Site', palette: true },
  { name: 'style.edit', title: 'Edit Style Code for This Site', palette: true },
  { name: 'style.open', title: 'Styles', palette: true },
  { name: 'siteSettings.open', title: 'Site Settings', palette: true },
  { name: 'siteSettings.info', title: 'Site Information' },
  { name: 'siteSettings.setPermission', title: 'Change Site Permission' },
  { name: 'siteSettings.clearData', title: 'Clear Cookies and Site Data', palette: true },
  { name: 'siteSettings.setMini', title: 'Always Open This Site in a Mini Window' },
  { name: 'siteSettings.setAdblock', title: 'Ad Blocking for This Site' },
  { name: 'page.readerMode', title: 'Reader Mode', palette: true },
  { name: 'page.copyUrlMarkdown', title: 'Copy URL as Markdown', palette: true },
  { name: 'page.capture', title: 'Capture Page', palette: true },
  { name: 'page.viewSource', title: 'View Page Source', palette: true },
  { name: 'page.print', title: 'Print…', palette: true },
  { name: 'page.saveAs', title: 'Save Page As…', palette: true },
  { name: 'history.query', title: 'Search History' },
  { name: 'history.clear', title: 'Clear History' },
  { name: 'history.remove', title: 'Remove from History' },
  { name: 'history.open', title: 'History', palette: true }
]

export const COMMAND_TITLES: Record<string, string> = Object.fromEntries(COMMANDS.map((c) => [c.name, c.title]))

export interface Binding {
  /** stable id used as the key of settings.shortcuts overrides */
  id: string
  command: string
  payload?: unknown
  accelerator: string
  /** handled by before-input-event instead of a menu accelerator */
  raw?: boolean
  // round 2a
  /** 'mini': only active inside a Mini Window (its own before-input-event handler) */
  scope?: 'mini'
}

const nums = (n: number): number[] => Array.from({ length: n }, (_, i) => i + 1)

/** Default shortcuts (macOS). Accelerator strings use Electron syntax. */
export const DEFAULT_BINDINGS: Binding[] = [
  { id: 'commandbar.new', command: 'commandbar.open', payload: { mode: 'new' }, accelerator: 'Cmd+T' },
  { id: 'commandbar.current', command: 'commandbar.open', payload: { mode: 'current' }, accelerator: 'Cmd+L' },
  { id: 'tab.close', command: 'tab.close', accelerator: 'Cmd+W' },
  { id: 'tab.reopen', command: 'tab.reopen', accelerator: 'Cmd+Shift+T' },
  { id: 'tab.archiveAllToday', command: 'tab.archiveAllToday', accelerator: 'Cmd+Shift+K' },
  { id: 'tab.togglePin', command: 'tab.togglePin', accelerator: 'Cmd+D' },
  { id: 'sidebar.toggle', command: 'sidebar.toggle', accelerator: 'Cmd+S' },
  { id: 'window.new', command: 'window.new', accelerator: 'Cmd+N' },
  { id: 'window.close', command: 'window.close', accelerator: 'Cmd+Shift+W' },
  { id: 'tab.prev', command: 'tab.prev', accelerator: 'Cmd+Alt+Up' },
  { id: 'tab.next', command: 'tab.next', accelerator: 'Cmd+Alt+Down' },
  { id: 'tab.back', command: 'tab.back', accelerator: 'Cmd+[' },
  { id: 'tab.forward', command: 'tab.forward', accelerator: 'Cmd+]' },
  ...nums(9).map((n) => ({ id: `tab.goTo:${n}`, command: 'tab.goTo', payload: { index: n - 1 }, accelerator: `Cmd+${n}` })),
  ...nums(9).map((n) => ({
    id: `space.switch:${n}`,
    command: 'space.switch',
    payload: { index: n - 1 },
    accelerator: `Ctrl+${n}`,
    raw: true
  })),
  { id: 'space.prev', command: 'space.prev', accelerator: 'Cmd+Alt+Left', raw: true },
  { id: 'space.next', command: 'space.next', accelerator: 'Cmd+Alt+Right', raw: true },
  { id: 'tab.cycleRecent', command: 'tab.cycleRecent', accelerator: 'Ctrl+Tab', raw: true },
  { id: 'tab.reload', command: 'tab.reload', accelerator: 'Cmd+R' },
  { id: 'tab.hardReload', command: 'tab.hardReload', accelerator: 'Cmd+Shift+R' },
  { id: 'tab.stop', command: 'tab.stop', accelerator: 'Cmd+.' },
  { id: 'find.open', command: 'find.open', accelerator: 'Cmd+F' },
  { id: 'find.next', command: 'find.next', accelerator: 'Cmd+G' },
  { id: 'find.prev', command: 'find.prev', accelerator: 'Cmd+Shift+G' },
  { id: 'page.devtools', command: 'page.devtools', accelerator: 'Cmd+Alt+I' },
  { id: 'page.copyUrl', command: 'page.copyUrl', accelerator: 'Cmd+Shift+C' },
  { id: 'zoom.in', command: 'zoom.in', accelerator: 'Cmd+Plus' },
  { id: 'zoom.inEquals', command: 'zoom.in', accelerator: 'Cmd+=', raw: true },
  { id: 'zoom.out', command: 'zoom.out', accelerator: 'Cmd+-' },
  { id: 'zoom.reset', command: 'zoom.reset', accelerator: 'Cmd+0' },
  { id: 'settings.open', command: 'settings.open', accelerator: 'Cmd+,' },
  { id: 'app.quit', command: 'app.quit', accelerator: 'Cmd+Q' },
  { id: 'library.open', command: 'library.open', accelerator: 'Cmd+Shift+L', raw: true },
  // round 2a: Split View, Mini Window
  { id: 'split.add', command: 'split.add', accelerator: 'Ctrl+Shift+=', raw: true },
  { id: 'split.remove', command: 'split.remove', accelerator: 'Ctrl+Shift+-', raw: true },
  ...nums(4).map((n) => ({
    id: `split.focus:${n}`,
    command: 'split.focus',
    payload: { pane: n },
    accelerator: `Ctrl+Shift+${n}`,
    raw: true
  })),
  { id: 'split.focusNext', command: 'split.focusNext', accelerator: 'Ctrl+Shift+]', raw: true },
  { id: 'split.focusPrev', command: 'split.focusPrev', accelerator: 'Ctrl+Shift+[', raw: true },
  { id: 'mini.new', command: 'mini.new', accelerator: 'Cmd+Alt+N', raw: true },
  { id: 'mini.openInMain', command: 'mini.openInMain', accelerator: 'Cmd+O', scope: 'mini' },
  { id: 'mini.close', command: 'mini.close', accelerator: 'Cmd+W', scope: 'mini' },
  { id: 'mini.focusUrl', command: 'mini.focusUrl', accelerator: 'Cmd+L', scope: 'mini' },
  { id: 'mini.back', command: 'mini.back', accelerator: 'Cmd+[', scope: 'mini' },
  { id: 'mini.forward', command: 'mini.forward', accelerator: 'Cmd+]', scope: 'mini' },
  { id: 'mini.reload', command: 'mini.reload', accelerator: 'Cmd+R', scope: 'mini' },
  // round 2c: platform
  { id: 'extensions.open', command: 'extensions.open', accelerator: 'Cmd+E' },
  { id: 'downloads.open', command: 'downloads.open', accelerator: 'Cmd+Shift+J' },
  { id: 'window.newIncognito', command: 'window.newIncognito', accelerator: 'Cmd+Shift+N' }
]

export function resolveBindings(overrides: Record<string, string> | undefined): Binding[] {
  return DEFAULT_BINDINGS.map((b) => (overrides && overrides[b.id] ? { ...b, accelerator: overrides[b.id] } : b))
}

const SYMBOLS: Record<string, string> = {
  cmd: '⌘',
  command: '⌘',
  cmdorctrl: '⌘',
  commandorcontrol: '⌘',
  ctrl: '⌃',
  control: '⌃',
  alt: '⌥',
  option: '⌥',
  shift: '⇧',
  up: '↑',
  down: '↓',
  left: '←',
  right: '→',
  plus: '+',
  tab: '⇥',
  enter: '↩',
  escape: '⎋'
}

export function acceleratorLabel(accel: string): string {
  const parts = accel.split('+')
  // "Cmd++" style is not used; "Plus" names the key.
  const order = ['⌃', '⌥', '⇧', '⌘']
  const mods: string[] = []
  let key = ''
  for (const p of parts) {
    const s = SYMBOLS[p.toLowerCase()]
    if (s && order.includes(s)) mods.push(s)
    else key = s ?? p.toUpperCase()
  }
  mods.sort((a, b) => order.indexOf(a) - order.indexOf(b))
  return mods.join('') + key
}

/** first shortcut label per command (for menus and the command bar) */
export function shortcutLabels(overrides: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const b of resolveBindings(overrides)) {
    const key = b.payload ? `${b.command}:${JSON.stringify(b.payload)}` : b.command
    if (!out[key]) out[key] = acceleratorLabel(b.accelerator)
  }
  return out
}

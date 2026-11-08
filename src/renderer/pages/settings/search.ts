// Settings search: one index of every setting across the panes, and the matcher behind the search box.
import { DEFAULT_BINDINGS, acceleratorLabel, bindingTitle } from '@shared/commands'
import { IMPORT_FROM_LABEL } from '@shared/importer'

export type PaneId = 'general' | 'profiles' | 'linkrules' | 'shortcuts' | 'extensions' | 'advanced'

export interface SettingEntry {
  /** matches the data-setting attribute of the row that holds the setting */
  id: string
  pane: PaneId
  label: string
  detail?: string
  keywords?: string
}

const STATIC: SettingEntry[] = [
  // General
  { id: 'archiveAfter', pane: 'general', label: 'Archive Today tabs after', detail: 'Today tabs you have not opened in this long move to the Archive.', keywords: 'archive timer auto close tabs cleanup 12 hours 24 hours 7 days 30 days never' },
  { id: 'searchEngine', pane: 'general', label: 'Search engine', keywords: 'google duckduckgo bing kagi default search query' },
  { id: 'pipAuto', pane: 'general', label: 'Picture in Picture', detail: 'Videos keep playing in a floating window when you switch tabs.', keywords: 'pip video floating player' },
  { id: 'openExternalLinksInMiniWindow', pane: 'general', label: 'Open links from other apps in a Mini Window', detail: 'Links without a Link Rule open in a small window.', keywords: 'external links mini window little' },
  { id: 'appearance', pane: 'general', label: 'Theme', detail: 'Match system, light or dark.', keywords: 'appearance dark mode light mode color' },
  { id: 'sidebarWidth', pane: 'general', label: 'Sidebar width', detail: '200 to 400 points.', keywords: 'sidebar size wide narrow' },
  { id: 'adblock', pane: 'general', label: 'Block ads and trackers', detail: 'EasyList and EasyPrivacy.', keywords: 'ad blocker adblock trackers privacy content blocking' },
  { id: 'adblockAllow', pane: 'general', label: 'Sites allowed to show ads', keywords: 'ad blocker allow list whitelist exception site' },
  { id: 'downloadDirectory', pane: 'general', label: 'Save downloads to', keywords: 'downloads folder location directory' },
  { id: 'defaultBrowser', pane: 'general', label: 'Default browser', detail: 'Make swyr the default browser.', keywords: 'default browser links other apps' },
  // Profiles
  { id: 'profiles', pane: 'profiles', label: 'Your profiles', detail: 'Each profile has its own cookies, logins, history, extensions and Favorites.', keywords: 'profile rename delete cookies logins accounts' },
  { id: 'profileNew', pane: 'profiles', label: 'New profile', keywords: 'add profile create' },
  { id: 'profileSpaces', pane: 'profiles', label: 'Spaces', detail: 'Pick the profile each space uses.', keywords: 'space profile assign' },
  // Link Rules
  { id: 'linkRules', pane: 'linkrules', label: 'Link Rules', detail: 'Links from other apps go to the space that matches.', keywords: 'rules routing redirect site pattern source app slack mail' },
  { id: 'linkRuleNew', pane: 'linkrules', label: 'New rule', keywords: 'add link rule site pattern space' },
  // Shortcuts
  { id: 'shortcutsFilter', pane: 'shortcuts', label: 'Filter shortcuts', detail: 'Change any keyboard shortcut.', keywords: 'keyboard shortcut keys hotkey bindings change record' },
  // Extensions
  { id: 'extensionsInstalled', pane: 'extensions', label: 'Installed extensions', keywords: 'extensions add-ons plugins manage chrome' },
  { id: 'extensionsStore', pane: 'extensions', label: 'Chrome Web Store', keywords: 'extensions store install add' },
  // Advanced
  { id: 'import', pane: 'advanced', label: IMPORT_FROM_LABEL, detail: 'Brings in your spaces, pinned tabs, folders and open tabs.', keywords: 'import sidebar migrate other browser' },
  { id: 'export', pane: 'advanced', label: 'Export swyr data', detail: 'Saves your spaces, tabs, archive and settings as one JSON file.', keywords: 'export backup json data' },
  { id: 'reset', pane: 'advanced', label: 'Reset settings', detail: 'Puts every setting and shortcut back to its default.', keywords: 'reset defaults restore factory' }
]

/** the row id a shortcut binding carries in the Shortcuts pane */
export const shortcutSettingId = (bindingId: string): string => `shortcut:${bindingId}`

const SHORTCUTS: SettingEntry[] = DEFAULT_BINDINGS.map((b) => ({
  id: shortcutSettingId(b.id),
  pane: 'shortcuts',
  label: bindingTitle(b),
  detail: `Keyboard shortcut ${acceleratorLabel(b.accelerator)}${b.scope === 'mini' ? ' in a Mini Window' : ''}`,
  keywords: `shortcut keyboard key ${b.command}`
}))

export const SETTINGS_INDEX: SettingEntry[] = [...STATIC, ...SHORTCUTS]

/** every word of the query must appear in the label, detail, keywords or pane name; label hits rank first */
export function searchSettings(query: string, paneLabel: (id: PaneId) => string): SettingEntry[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return []
  const scored: { e: SettingEntry; score: number; i: number }[] = []
  SETTINGS_INDEX.forEach((e, i) => {
    const label = e.label.toLowerCase()
    const hay = `${label} ${e.detail ?? ''} ${e.keywords ?? ''} ${paneLabel(e.pane)}`.toLowerCase()
    if (!words.every((w) => hay.includes(w))) return
    const score = label.startsWith(words[0]) ? 0 : words.every((w) => label.includes(w)) ? 1 : e.pane === 'shortcuts' ? 3 : 2
    scored.push({ e, score, i })
  })
  return scored.sort((a, b) => a.score - b.score || a.i - b.i).map((x) => x.e)
}

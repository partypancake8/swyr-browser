// Shared state and command types for main, preload and renderers.

export const SCHEMA_VERSION = 1

export type Appearance = 'light' | 'dark' | 'auto'
export type Section = 'favorites' | 'pinned' | 'today'
export type ItemKind = 'tab' | 'folder' | 'split' | 'note' | 'canvas' | 'liveFolder'
export type ArchiveAfter = '12h' | '24h' | '7d' | '30d' | 'never'

export interface Profile {
  id: string
  name: string
  partition: string
  createdAt: number
}

export interface SpaceTheme {
  colors: string[]
  angle: number
  noise: number
  appearance: Appearance
}

export interface Space {
  id: string
  name: string
  emoji: string
  profileId: string
  theme: SpaceTheme
  order: number
}

export interface SplitPanes {
  itemIds: string[]
  layout: 'horizontal' | 'vertical'
  ratios: number[]
}

export interface Item {
  id: string
  /** null for favorites, which belong to a profile rather than a space */
  spaceId: string | null
  profileId: string
  parentId: string | null
  section: Section
  kind: ItemKind
  order: number
  customTitle: string | null
  pinnedUrl: string | null
  url: string
  title: string
  favicon: string | null
  panes?: SplitPanes
  collapsed?: boolean
  createdAt: number
  lastActiveAt: number
}

export type ArchiveReason = 'auto' | 'manual' | 'closed'

export interface ArchiveEntry {
  id: string
  item: Item
  archivedAt: number
  reason: ArchiveReason
}

export interface SiteSearch {
  keyword: string
  name: string
  urlTemplate: string
}

export interface LinkRule {
  pattern: string
  spaceId: string
  profileId: string
}

export interface Settings {
  archiveAfter: ArchiveAfter
  sidebarWidth: number
  sidebarVisible: boolean
  shortcuts: Record<string, string>
  searchEngine: string
  siteSearch: SiteSearch[]
  linkRules: LinkRule[]
  adblock: boolean
  openExternalLinksInMiniWindow: boolean
  appearance: Appearance
  pipAuto: boolean
}

export interface Style {
  id: string
  hostPattern: string
  enabled: boolean
  colors: { bg?: string; fg?: string; accent?: string }
  font?: string
  fontScale?: number
  css: string
  js: string
  hiddenSelectors: string[]
}

export interface PersistedState {
  schemaVersion: number
  profiles: Profile[]
  spaces: Space[]
  items: Item[]
  archive: ArchiveEntry[]
  settings: Settings
  styles: Style[]
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface TabRuntime {
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  zoom: number
}

export type OverlayState =
  | { kind: 'commandbar'; mode: 'new' | 'current'; query: string; seq: number }
  | { kind: 'find'; query: string; active: number; matches: number; seq: number }
  | { kind: 'spaceEdit'; spaceId: string; seq: number }
  | { kind: 'sidebar'; seq: number }
  | { kind: 'toast'; message: string; seq: number }

export interface WindowRuntime {
  id: number
  activeSpaceId: string
  activeItemId: string | null
  sidebarVisible: boolean
  bounds: Rect
  /** loaded tab ids for this window, most recent first (the warm cache) */
  loaded: string[]
  tabs: Record<string, TabRuntime>
  overlay: OverlayState | null
  renamingItemId: string | null
  fullscreen: boolean
}

/** what the main process sends to a shell or overlay renderer */
export interface ViewState {
  state: PersistedState
  window: WindowRuntime
  systemDark: boolean
}

/** what the test hook returns */
export interface TestState extends PersistedState {
  windows: WindowRuntime[]
}

export interface ShellEvent {
  type: 'focusUrl' | 'rename'
  itemId?: string
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
export type OverlayInput = DistributiveOmit<OverlayState, 'seq'>

// round 2c: platform layer (extensions, ad blocker, downloads, link rules, profiles, importer).
// Interface merging keeps these additive; nothing above is renamed.

export interface LinkRule {
  /** stable id for linkRules.remove */
  id: string
}

export interface Profile {
  /** private window profile: non-persisted partition, never written to state.json */
  incognito?: boolean
}

export interface Space {
  /** the space of a private window, removed when that window closes */
  incognito?: boolean
}

export interface ExtensionSetting {
  id: string
  /** unpacked extensions load from here; store installs live under userData/extensions/<profileId> */
  path?: string
  enabled: boolean
  profileId: string
  source?: 'unpacked' | 'store'
}

export interface Settings {
  extensions?: ExtensionSetting[]
  /** hostnames where the ad blocker is off */
  adblockAllow?: string[]
  /** where downloads are saved; defaults to ~/Downloads */
  downloadDirectory?: string
}

export interface ExtensionRuntime {
  id: string
  name: string
  version: string
  enabled: boolean
  profileId: string
  actionTitle?: string
  iconDataUrl?: string
  hasAction?: boolean
  description?: string
  source?: 'unpacked' | 'store'
}

export type DownloadStateName = 'progressing' | 'completed' | 'cancelled' | 'interrupted'

export interface DownloadEntry {
  id: string
  filename: string
  url: string
  path: string
  state: DownloadStateName
  receivedBytes: number
  totalBytes: number
  startedAt: number
}

export interface AdblockStats {
  blocked: number
  /** blocked requests per sidebar item id */
  perTab: Record<string, number>
}

/** runtime-only platform state; pushed to the shell as a { type: 'platform' } event */
export interface PlatformRuntime {
  extensions: ExtensionRuntime[]
  downloads: DownloadEntry[]
  adblockStats: AdblockStats
  /** window ids whose downloads panel is open */
  downloadsPanel: number[]
  defaultBrowser: boolean
  adblockLists: 'bundled' | 'full'
  downloadDirectory: string
}

export interface ImportSummary {
  spaces: number
  folders: number
  pinned: number
  today: number
  favorites: number
}

export interface TestState {
  extensions?: ExtensionRuntime[]
  downloads?: DownloadEntry[]
  adblockStats?: AdblockStats
}

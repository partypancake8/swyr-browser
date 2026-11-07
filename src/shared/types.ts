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

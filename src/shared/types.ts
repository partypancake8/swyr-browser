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
  // round 2a
  /** 0-based index of the focused pane */
  focused?: number
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
  | DialogOverlay
  // round 2a
  | { kind: 'preview'; seq: number }
  | { kind: 'splitDrop'; seq: number; edge?: SplitEdge | null; baseId?: string | null }

/** an edge of the content area a tab can be dropped on to split */
export type SplitEdge = 'left' | 'right' | 'top' | 'bottom'

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
  // round 2a
  kind?: 'main'
  /** 0-based index of the focused pane of the active split (0 when no split is active) */
  focusedPane: number
  /** bounds of every visible pane, in window coordinates */
  paneRects: Rect[]
  /** the gaps between panes (where the shell draws draggable dividers) */
  dividers: SplitDivider[]
  preview: PreviewRuntime | null
  /** preview card frame (header + page) and the page bounds, window coordinates */
  previewBounds: { card: Rect; page: Rect } | null
  media: MediaRuntime | null
}

// round 2a
export interface SplitDivider {
  /** divider i sits between pane i and pane i + 1 */
  index: number
  rect: Rect
  layout: 'horizontal' | 'vertical'
}

// round 2a
export interface PreviewRuntime {
  url: string
  title: string
  fromItemId: string | null
}

// round 2a
export interface MediaRuntime {
  itemId: string
  title: string
  playing: boolean
}

// round 2a
export interface MiniWindowRuntime {
  id: number
  kind: 'mini'
  activeItemId: string
  url: string
  bounds: Rect
}

// round 2a: what the main process sends to a mini window's chrome
export interface MiniViewState {
  mini: MiniWindowRuntime & { title: string; favicon: string | null; loading: boolean; canGoBack: boolean; canGoForward: boolean }
  spaces: Space[]
  activeSpaceId: string | null
  systemDark: boolean
}

/** what the main process sends to a shell or overlay renderer */
export interface ViewState {
  state: PersistedState
  window: WindowRuntime
  systemDark: boolean
}

/** what the test hook returns */
export interface TestState extends PersistedState {
  // round 2a: mini windows are listed after the main windows
  windows: Array<(WindowRuntime & { kind: 'main' }) | MiniWindowRuntime>
}

export interface ShellEvent {
  type: 'focusUrl' | 'rename'
  itemId?: string
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
export type OverlayInput = DistributiveOmit<OverlayState, 'seq'>

// round 2b: sidebar, folders, archive, library, space editor
export type DialogKind = 'rename' | 'confirmDeleteSpace' | 'confirmClearArchive'

/** a modal dialog drawn by the overlay view (src/renderer/overlay/dialogs) */
export interface DialogOverlay {
  kind: 'dialog'
  dialog: DialogKind
  itemId?: string
  spaceId?: string
  seq: number
}

export interface FolderNewPayload {
  name?: string
  section?: 'pinned'
  parentId?: string | null
  spaceId?: string
  /** item ids to move into the new folder */
  itemIds?: string[]
  /** start an inline rename in the sidebar */
  rename?: boolean
}

export interface TabMovePayload {
  itemId: string
  section: Section
  parentId?: string | null
  index?: number
  spaceId?: string
}

export interface SpaceEditPayload {
  id: string
  name?: string
  emoji?: string
  theme?: Partial<SpaceTheme>
  profileId?: string
}

/** one entry of a native menu built by the renderer (command: menu.popup) */
export interface MenuEntry {
  label?: string
  type?: 'separator' | 'normal' | 'checkbox'
  command?: string
  payload?: unknown
  enabled?: boolean
  checked?: boolean
  submenu?: MenuEntry[]
}

export type LibrarySection = 'archive' | 'spaces' | 'downloads' | 'notes' | 'canvases' | 'styles' | 'media'

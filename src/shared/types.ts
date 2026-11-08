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
  | { kind: 'find'; query: string; active: number; matches: number; seq: number; replace?: boolean }
  | { kind: 'spaceEdit'; spaceId: string; seq: number }
  | { kind: 'sidebar'; seq: number }
  | { kind: 'toast'; message: string; seq: number }
  | DialogOverlay
  // round 2a
  | { kind: 'preview'; seq: number }
  | { kind: 'splitDrop'; seq: number; edge?: SplitEdge | null; baseId?: string | null }
  // round 3a: popovers anchored to the URL row
  | { kind: 'siteSettings'; seq: number }
  | { kind: 'stylePanel'; seq: number }
  // round 8: a site asks for a permission (answered with permission.respond)
  | PermissionOverlay

/** the permission prompt: which site asks for what */
export interface PermissionOverlay {
  kind: 'permission'
  promptId: string
  origin: string
  host: string
  /** the first permission asked for (a camera and microphone request lists both in permissions) */
  permission: SitePermission
  permissions: SitePermission[]
  /** the request comes from a private window: the answer is not remembered after the window closes */
  incognito: boolean
  seq: number
}

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
  /** which secrets are set (the values stay in the main process, see src/main/secrets/Secrets.ts) */
  secrets?: { githubToken: boolean }
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
export type DialogKind = 'rename' | 'confirmDeleteSpace' | 'confirmClearArchive' | 'liveFolder' // round 3b: liveFolder

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
  /** round 8: a file that runs code when opened (dmg, pkg, app, sh, command, js, jar...): the panel warns */
  dangerous?: boolean
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
  /** round 7: in-app updates from GitHub Releases */
  update: UpdateRuntime
}

export type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error' | 'upToDate'

/** round 7: the updater's runtime state (src/main/updates/Updater.ts) */
export interface UpdateRuntime {
  status: UpdateStatus
  /** the version on offer (available, downloading, ready) */
  version?: string
  /** download progress, 0 to 100 */
  percent?: number
  error?: string
  /** epoch ms of the last finished check */
  checkedAt?: number
  /** the running version */
  current: string
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
  update?: UpdateRuntime
}

// round 3a: Styles, Site Settings, Reader, History, capture.

export type SitePermission =
  | 'camera'
  | 'microphone'
  | 'notifications'
  | 'location'
  | 'clipboard'
  // round 8: every permission a site can ask for prompts in the overlay
  | 'midi'
  | 'pointerLock'
  | 'keyboardLock'
  | 'idleDetection'
  | 'windowManagement'
  | 'localFonts'
  | 'localNetwork'
export type PermissionDecision = 'allow' | 'deny'

export interface Settings {
  /** decisions per origin, recorded when pages ask (Site Settings lists and revokes them) */
  sitePermissions?: Record<string, Partial<Record<SitePermission, PermissionDecision>>>
}

export interface LinkRule {
  /** open matching links in a Mini Window instead of a space ("Always open this site in a mini window") */
  mini?: boolean
}

export interface TabRuntime {
  /** the tab shows the Reader view of its page */
  reader?: boolean
}

export interface StyleSavePayload {
  id?: string
  hostPattern: string
  enabled?: boolean
  colors?: Style['colors']
  font?: string
  fontScale?: number
  css?: string
  js?: string
  hiddenSelectors?: string[]
}

export interface HistoryEntry {
  url: string
  title: string
  visitedAt: number
  visitCount: number
  profileId: string
}

/** what siteSettings.info returns for the popover */
export interface SiteInfo {
  itemId: string | null
  url: string
  origin: string
  host: string
  title: string
  favicon: string | null
  /** the page is a web page (http, https or file) */
  web: boolean
  adblockEnabled: boolean
  /** ads allowed on this site (settings.adblockAllow) */
  adblockAllowed: boolean
  blocked: number
  styles: Style[]
  zoom: number
  permissions: Partial<Record<SitePermission, PermissionDecision>>
  mini: boolean
  extensions: { id: string; name: string; iconDataUrl?: string }[]
}

// round 3b: notes, canvases, live folders, library sections
export type DocumentKind = 'note' | 'canvas'

export interface NoteDocument {
  id: string
  kind: 'note'
  title: string
  markdown: string
  updatedAt: number
}

/** a canvas board: Excalidraw elements, a small subset of its appState, and its binary files (images) */
export interface CanvasDocument {
  id: string
  kind: 'canvas'
  title: string
  elements: Record<string, unknown>[]
  appState: Record<string, unknown>
  files: Record<string, unknown>
  updatedAt: number
}

export type SwyrDocument = NoteDocument | CanvasDocument

/** one row of the Library's Notes or Canvases list */
export interface DocumentSummary {
  id: string
  kind: DocumentKind
  title: string
  updatedAt: number
  /** sidebar items that open this document */
  itemIds: string[]
  spaceIds: string[]
  /** a short preview: the first text of a note, or the element count of a canvas */
  preview: string
}

export type LiveFolderSource = 'github-prs' | 'github-issues' | 'rss' | 'test'

export interface LiveFolderConfig {
  /** GitHub search query, e.g. "is:pr is:open author:@me" */
  query?: string
  /** RSS or Atom feed URL */
  url?: string
  /** test source only: path of a JSON file with [{ title, url }] */
  fixture?: string
}

export interface LiveFolderInfo {
  source: LiveFolderSource
  sourceConfig: LiveFolderConfig
  lastRefreshedAt?: number
  /** message of the last failed refresh, cleared on success */
  error?: string | null
}

export interface Item {
  /** liveFolder items: where the folder fills itself from */
  live?: LiveFolderInfo
}


/** one tab with media, for the Library's Media section */
export interface MediaEntry {
  itemId: string
  windowId: number
  title: string
  url: string
  favicon: string | null
  playing: boolean
}

// round 3c: onboarding, window bounds, private windows, the shortcut table
export interface Settings {
  /** first-run onboarding finished (swyr://onboarding opens until it is) */
  onboarded?: boolean
  /** bounds of the last moved or resized main window, restored on launch */
  windowBounds?: Rect
}

export interface WindowRuntime {
  /** a private window: in-memory partition, its own space, no history */
  incognito?: boolean
}

/** one row of shortcuts.list */
export interface ShortcutEntry {
  id: string
  command: string
  accelerator: string
  /** the built-in accelerator (accelerator differs when the user changed it) */
  default: string
  scope?: 'mini'
  payload?: unknown
  title: string
  overridden: boolean
}

export interface OnboardingCompletePayload {
  /** web apps picked on the Defaults step; each becomes a Favorite */
  favorites?: { url: string; title: string }[]
  themeColors?: string[]
  adblock?: boolean
  archiveAfter?: ArchiveAfter
}

// round 5: blank windows (no spaces) and Link Rules by source app

export interface Item {
  /** a Today tab owned by a blank window (Ctrl+Cmd+N); only that window lists it, and it goes when the window closes */
  blankWindow?: number
}

export interface WindowRuntime {
  /** a blank window: no space switcher, no Favorites or Pinned, a neutral theme and its own Today list */
  blank?: boolean
}

export interface LinkRule {
  /**
   * match links by the app they came from (name or bundle id, case-insensitive substring); macOS does not say who sent
   * a link, so swyr records the frontmost app at the moment the link arrives
   */
  sourceApp?: string
}

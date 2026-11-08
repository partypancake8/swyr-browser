// Native context menus for sidebar tab rows, space buttons and web pages.
import { Menu, clipboard, type ContextMenuParams, type MenuItemConstructorOptions } from 'electron'
import type { Item } from '@shared/types'
import { resolveWithSettings } from '@shared/url'
import type { Core } from '../windows/WindowManager'
import type { SwyrWindow } from '../windows/SwyrWindow'
import { webContentMayOpen } from '../security/urlPolicy'

export class ContextMenus {
  /** test mode only: the last menu that would have been shown (menus never pop up headless) */
  last: MenuItemConstructorOptions[] | null = null

  constructor(private readonly core: Core) {}

  private show(w: SwyrWindow, template: MenuItemConstructorOptions[]): void {
    if (this.core.test) {
      this.last = template
      return
    }
    Menu.buildFromTemplate(template).popup({ window: w.win })
  }

  /** test mode: labels of the last menu, and running one of its entries by label */
  lastLabels(): string[] {
    return (this.last ?? []).map((e) => (e.type === 'separator' ? '-' : (e.label ?? e.role ?? '')))
  }

  clickLast(label: string): boolean {
    const entry = (this.last ?? []).find((e) => e.label === label)
    if (!entry || typeof entry.click !== 'function') return false
    ;(entry.click as () => void)()
    return true
  }

  private run(w: SwyrWindow, command: string, payload?: unknown): () => void {
    return () => {
      void this.core.commands.run(command, payload, w).catch((err) => console.error('[swyr]', err))
    }
  }

  tab(w: SwyrWindow, item: Item): void {
    const sep: MenuItemConstructorOptions = { type: 'separator' }
    const template: MenuItemConstructorOptions[] = [
      { label: 'Rename…', click: this.run(w, 'tab.rename', { id: item.id }) },
      item.section === 'pinned'
        ? { label: 'Unpin', click: this.run(w, 'tab.unpin', { id: item.id }) }
        : { label: 'Pin', click: this.run(w, 'tab.pin', { id: item.id }) },
      item.section === 'favorites'
        ? { label: 'Remove from Favorites', click: this.run(w, 'tab.unpin', { id: item.id }) }
        : { label: 'Add to Favorites', click: this.run(w, 'tab.favorite', { id: item.id }) },
      { label: 'Duplicate', click: this.run(w, 'tab.duplicate', { id: item.id }) },
      { label: 'Copy URL', click: () => clipboard.writeText(item.url) }
    ]
    if (item.pinnedUrl && item.pinnedUrl !== item.url) {
      template.push({ label: 'Go Back to Pinned URL', click: this.run(w, 'tab.resetToPinnedUrl', { id: item.id }) })
    }
    template.push(sep, { label: 'Archive', click: this.run(w, 'tab.close', { id: item.id, remove: true }) })
    this.show(w, template)
  }

  space(w: SwyrWindow, spaceId: string): void {
    const many = this.core.store.state.spaces.length > 1
    this.show(w, [
      { label: 'Edit Space…', click: this.run(w, 'space.edit', { id: spaceId }) },
      { label: 'New Space', click: this.run(w, 'space.new') },
      { type: 'separator' },
      { label: 'Delete Space', enabled: many, click: this.run(w, 'space.delete', { id: spaceId }) }
    ])
  }

  page(w: SwyrWindow, itemId: string, params: ContextMenuParams): void {
    const wc = w.tabs.get(itemId)?.webContents
    if (!wc) return
    const sep: MenuItemConstructorOptions = { type: 'separator' }
    const t: MenuItemConstructorOptions[] = []
    // links a page may not open (swyr:// pages, local files, script URLs) get only Copy Link
    if (params.linkURL && !webContentMayOpen(params.linkURL, wc.getURL())) {
      t.push({ label: 'Copy Link', click: () => clipboard.writeText(params.linkURL) }, sep)
    } else if (params.linkURL) {
      t.push(
        { label: 'Open Link in New Tab', click: this.run(w, 'tab.new', { url: params.linkURL, background: true }) },
        { label: 'Open Link in Mini Window', click: this.run(w, 'mini.new', { url: params.linkURL }) },
        { label: 'Open Link in Split View', click: this.run(w, 'split.add', { url: params.linkURL }) },
        { label: 'Copy Link', click: () => clipboard.writeText(params.linkURL) },
        sep
      )
    }
    if (params.isEditable) {
      t.push({ role: 'cut', enabled: params.editFlags.canCut }, { role: 'copy', enabled: params.editFlags.canCopy }, { role: 'paste', enabled: params.editFlags.canPaste }, sep)
    } else if (params.selectionText) {
      const text = params.selectionText.trim()
      const short = text.length > 24 ? text.slice(0, 24) + '…' : text
      t.push(
        { role: 'copy' },
        { label: `Search for "${short}"`, click: this.run(w, 'tab.new', { url: resolveWithSettings(text, this.core.store.state.settings).url }) },
        sep
      )
    }
    t.push(
      { label: 'Back', enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() },
      { label: 'Forward', enabled: wc.navigationHistory.canGoForward(), click: () => wc.navigationHistory.goForward() },
      { label: 'Reload', click: () => wc.reload() },
      sep,
      { label: 'Inspect', click: () => wc.inspectElement(params.x, params.y) }
    )
    this.show(w, t)
  }
}

// Preview commands: open a link from a pinned tab or favorite in a floating card, close it, or keep it as a tab.
import type { Item } from '@shared/types'
import { resolveWithSettings } from '@shared/url'
import { makeItem } from './builtins'
import type { Commands } from './Commands'

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

/** a rough registrable domain: the last two labels, or three for short second-level suffixes like co.uk */
export function siteOf(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    const host = u.hostname.replace(/^www\./, '').toLowerCase()
    if (/^[\d.]+$/.test(host) || host.includes(':') || !host.includes('.')) return host
    const parts = host.split('.')
    const tld = parts[parts.length - 1]
    const sld = parts[parts.length - 2]
    const keep = tld.length === 2 && sld.length <= 3 && parts.length > 2 ? 3 : 2
    return parts.slice(-keep).join('.')
  } catch {
    return null
  }
}

/** links from pinned tabs and favorites that leave the item's site open in Preview */
export function previewSource(item: Item | undefined): boolean {
  return Boolean(item && item.kind === 'tab' && (item.section === 'pinned' || item.section === 'favorites'))
}

export function leavesSite(fromUrl: string, toUrl: string): boolean {
  const to = siteOf(toUrl)
  if (!to) return false
  const from = siteOf(fromUrl)
  return Boolean(from) && from !== to
}

export function registerPreviewCommands(c: Commands): void {
  c.register('preview.open', ({ core, w }, p) => {
    if (!w) return false
    const input = str(p.url)
    if (!input) return false
    const url = resolveWithSettings(input, core.store.state.settings).url
    if (/^\s*(javascript|file|swyr):/i.test(url)) return false
    w.preview.show(url, str(p.fromItemId) ?? null)
    w.openOverlay({ kind: 'preview' }, false)
    if (!core.test) w.preview.view?.webContents.focus()
    return true
  })

  c.register('preview.close', ({ w }) => {
    if (!w) return false
    if (w.overlayState?.kind === 'preview') w.closeOverlay()
    else w.preview.dispose()
    w.layout()
    return true
  })

  c.register('preview.expand', ({ core, w }) => {
    if (!w || !w.preview.isOpen()) return false
    const taken = w.preview.take()
    if (w.overlayState?.kind === 'preview') w.closeOverlay(false)
    if (!taken) return false
    const s = core.store.state
    const space = w.space()
    const live = taken.view.webContents
    const url = (!live.isDestroyed() && live.getURL()) || taken.state.url
    const item = makeItem(s, {
      url,
      title: taken.state.title || (!live.isDestroyed() ? live.getTitle() : ''),
      section: 'today',
      profileId: space.profileId,
      spaceId: space.id
    })
    core.store.update((st) => st.items.push(item))
    if (taken.profileId === space.profileId && !live.isDestroyed()) w.tabs.adopt(item, taken.view)
    else if (!live.isDestroyed()) live.close()
    w.activate(item.id)
    return item.id
  })
}

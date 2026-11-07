// Media: which tab of a window plays audio or video, sidebar controls, and automatic picture-in-picture.
import type { WebContents } from 'electron'
import type { MediaRuntime } from '@shared/types'
import { itemTitle } from '@shared/ops'
import type { Commands } from '../commands/Commands'
import type { SwyrWindow } from '../windows/SwyrWindow'

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

/** request picture-in-picture for the playing video, if any; resolves true when it entered */
export const PIP_ENTER = `(async () => {
  try {
    if (!document.pictureInPictureEnabled || document.pictureInPictureElement) return false
    const v = [...document.querySelectorAll('video')].find((v) => !v.paused && !v.ended && v.readyState > 2 && !v.disablePictureInPicture)
    if (!v) return false
    await v.requestPictureInPicture()
    return true
  } catch (e) {
    return false
  }
})()`

export const PIP_EXIT = `(async () => {
  try {
    if (!document.pictureInPictureElement) return false
    await document.exitPictureInPicture()
    return true
  } catch (e) {
    return false
  }
})()`

/** pause everything that plays, or resume the most recent element; returns the new state */
export const MEDIA_TOGGLE = `(() => {
  const els = [...document.querySelectorAll('video, audio')]
  const playing = els.filter((e) => !e.paused && !e.ended)
  if (playing.length) {
    els.forEach((e) => delete e.dataset.swyrPaused)
    playing.forEach((e) => {
      e.dataset.swyrPaused = '1'
      e.pause()
    })
    return 'paused'
  }
  // resume everything the last toggle paused, else the most recent element
  const marked = els.filter((e) => e.dataset.swyrPaused === '1')
  const resume = marked.length ? marked : [els.find((e) => e.currentTime > 0) || els[0]].filter(Boolean)
  if (!resume.length) return 'none'
  resume.forEach((e) => {
    delete e.dataset.swyrPaused
    const p = e.play()
    if (p && p.catch) p.catch(() => undefined)
  })
  return 'playing'
})()`

export const MEDIA_PAUSE = `(() => { document.querySelectorAll('video, audio').forEach((e) => e.pause()); return true })()`

export class MediaTracker {
  /** tabs of this window that currently play media */
  readonly playing = new Set<string>()
  /** the tab shown in the sidebar media bar */
  current: string | null = null
  /** tabs we put into picture-in-picture */
  readonly pip = new Set<string>()

  constructor(private readonly w: SwyrWindow) {}

  wire(id: string, wc: WebContents): void {
    wc.on('media-started-playing', () => {
      this.playing.add(id)
      this.current = id
      this.w.core.scheduleBroadcast()
    })
    wc.on('media-paused', () => {
      this.playing.delete(id)
      this.w.core.scheduleBroadcast()
    })
  }

  forget(id: string): void {
    this.playing.delete(id)
    this.pip.delete(id)
    if (this.current === id) this.current = [...this.playing][0] ?? null
  }

  /** a tab that plays media must not be evicted from the warm cache */
  protects(id: string): boolean {
    return this.playing.has(id) || this.current === id
  }

  runtime(): MediaRuntime | null {
    const id = this.current
    if (!id) return null
    const item = this.w.core.store.state.items.find((i) => i.id === id)
    if (!item || !this.w.tabs.get(id)) return null
    return { itemId: id, title: itemTitle(item), playing: this.playing.has(id) }
  }

  /** tab views just left or joined the content area */
  onVisibility(hidden: string[], shown: string[]): void {
    const auto = this.w.core.store.state.settings.pipAuto
    for (const id of shown) {
      if (!this.pip.has(id)) continue
      this.pip.delete(id)
      const wc = this.w.tabs.get(id)?.webContents
      if (wc && !wc.isDestroyed()) void wc.executeJavaScript(PIP_EXIT, true).catch(() => undefined)
    }
    if (!auto) return
    for (const id of hidden) {
      if (!this.playing.has(id)) continue
      const wc = this.w.tabs.get(id)?.webContents
      if (!wc || wc.isDestroyed()) continue
      void wc
        .executeJavaScript(PIP_ENTER, true)
        .then((ok) => {
          if (ok === true) this.pip.add(id)
        })
        .catch(() => undefined)
    }
  }

  async toggle(id: string): Promise<string> {
    const wc = this.w.tabs.get(id)?.webContents
    if (!wc || wc.isDestroyed()) return 'none'
    try {
      return String(await wc.executeJavaScript(MEDIA_TOGGLE, true))
    } catch {
      return 'none'
    }
  }

  async stop(id: string): Promise<boolean> {
    const wc = this.w.tabs.get(id)?.webContents
    if (wc && !wc.isDestroyed()) await wc.executeJavaScript(MEDIA_PAUSE, true).catch(() => undefined)
    this.playing.delete(id)
    if (this.current === id) this.current = null
    this.w.core.scheduleBroadcast()
    return true
  }
}

export function registerMediaCommands(c: Commands): void {
  c.register('media.toggle', async ({ w }, p) => {
    const id = str(p.itemId) ?? w?.media.current
    if (!w || !id) return 'none'
    return w.media.toggle(id)
  })
  c.register('media.close', async ({ w }, p) => {
    const id = str(p.itemId) ?? w?.media.current
    if (!w || !id) return false
    return w.media.stop(id)
  })
  c.register('media.activate', ({ w }, p) => {
    const id = str(p.itemId) ?? w?.media.current
    if (!w || !id) return false
    w.activate(id)
    return true
  })
  c.register('media.pip', async ({ w }, p) => {
    const id = str(p.itemId) ?? w?.media.current
    const wc = id ? w?.tabs.get(id)?.webContents : undefined
    if (!w || !id || !wc || wc.isDestroyed()) return false
    const ok = await wc.executeJavaScript(PIP_ENTER, true).catch(() => false)
    if (ok === true) w.media.pip.add(id)
    return ok === true
  })
}

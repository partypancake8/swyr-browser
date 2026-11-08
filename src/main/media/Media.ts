// Media: which tab of a window plays audio or video, sidebar controls, and automatic picture-in-picture.
import type { WebContents, WebFrameMain } from 'electron'
import type { MediaEntry, MediaRuntime } from '@shared/types'
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

/** whether anything in this frame plays */
const MEDIA_PLAYING = `[...document.querySelectorAll('video, audio')].some((e) => !e.paused && !e.ended)`

/** pause what plays in this frame and mark it, so the next toggle resumes it */
const MEDIA_PAUSE_MARK = `(() => {
  const els = [...document.querySelectorAll('video, audio')]
  els.forEach((e) => delete e.dataset.swyrPaused)
  els.filter((e) => !e.paused && !e.ended).forEach((e) => { e.dataset.swyrPaused = '1'; e.pause() })
  return true
})()`

/** every live frame of a page: the main frame first, then its iframes (media often plays in an embed) */
function framesOf(wc: WebContents): WebFrameMain[] {
  try {
    const main = wc.mainFrame
    return main ? [main, ...main.framesInSubtree.filter((f) => f !== main)] : []
  } catch {
    return []
  }
}

/** run a script in every frame of a page and collect what each returned */
export async function inEveryFrame(wc: WebContents, code: string, userGesture = true): Promise<unknown[]> {
  if (wc.isDestroyed()) return []
  const frames = framesOf(wc)
  return Promise.all(frames.map((f) => f.executeJavaScript(code, userGesture).catch(() => undefined)))
}

/** recently played media this session (not saved), newest first, for the Library's Media section */
const RECENT_LIMIT = 20
const recent: Array<MediaEntry & { playedAt: number }> = []

function remember(entry: MediaEntry): void {
  const i = recent.findIndex((r) => r.url === entry.url)
  if (i >= 0) recent.splice(i, 1)
  recent.unshift({ ...entry, playing: false, playedAt: Date.now() })
  if (recent.length > RECENT_LIMIT) recent.length = RECENT_LIMIT
}

/** what played earlier this session, newest first */
export function recentMedia(): Array<MediaEntry & { playedAt: number }> {
  return recent.map((r) => ({ ...r }))
}

/** picture-in-picture for the first frame (main frame, then iframes) whose video can enter it */
async function enterPip(wc: WebContents): Promise<boolean> {
  for (const f of framesOf(wc)) {
    const ok = await f.executeJavaScript(PIP_ENTER, true).catch(() => false)
    if (ok === true) return true
  }
  return false
}

export class MediaTracker {
  /** tabs of this window that currently play media */
  readonly playing = new Set<string>()
  /** the tab shown in the sidebar media bar */
  current: string | null = null
  /** tabs we put into picture-in-picture */
  readonly pip = new Set<string>()

  constructor(private readonly w: SwyrWindow) {}

  wire(id: string, wc: WebContents): void {
    const started = (): void => {
      const fresh = !this.playing.has(id) || this.current !== id
      this.playing.add(id)
      this.current = id
      if (fresh) this.record(id, wc)
      this.w.core.scheduleBroadcast()
    }
    // fires for media in any frame of the page, iframes included
    wc.on('media-started-playing', started)
    // an iframe player that makes sound counts as playing even if the media event was missed
    wc.on('audio-state-changed', (e) => {
      if (e.audible && !this.playing.has(id)) started()
    })
    wc.on('media-paused', () => {
      // another frame of the page may still be playing
      void inEveryFrame(wc, MEDIA_PLAYING, false).then((r) => {
        if (r.some((x) => x === true)) return
        this.playing.delete(id)
        this.w.core.scheduleBroadcast()
      })
    })
  }

  /** note a tab that started playing in the session's media history (never for private windows) */
  private record(id: string, wc: WebContents): void {
    if (this.w.space().incognito) return
    const item = this.w.core.store.state.items.find((i) => i.id === id)
    const url = item?.url || (wc.isDestroyed() ? '' : wc.getURL())
    if (!url) return
    remember({ itemId: id, windowId: this.w.id, title: item ? itemTitle(item) : url, url, favicon: item?.favicon ?? null, playing: true })
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
      if (wc && !wc.isDestroyed()) void inEveryFrame(wc, PIP_EXIT)
    }
    if (!auto) return
    for (const id of hidden) {
      if (!this.playing.has(id)) continue
      const wc = this.w.tabs.get(id)?.webContents
      if (!wc || wc.isDestroyed()) continue
      void enterPip(wc).then((ok) => {
        if (ok) this.pip.add(id)
      })
    }
  }

  async toggle(id: string): Promise<string> {
    const wc = this.w.tabs.get(id)?.webContents
    if (!wc || wc.isDestroyed()) return 'none'
    // media in iframes counts: pause every frame when any plays, else resume in each frame
    const playing = (await inEveryFrame(wc, MEDIA_PLAYING, false)).some((x) => x === true)
    if (playing) {
      await inEveryFrame(wc, MEDIA_PAUSE_MARK)
      return 'paused'
    }
    const r = await inEveryFrame(wc, MEDIA_TOGGLE)
    return r.includes('playing') ? 'playing' : 'none'
  }

  async stop(id: string): Promise<boolean> {
    const wc = this.w.tabs.get(id)?.webContents
    if (wc && !wc.isDestroyed()) await inEveryFrame(wc, MEDIA_PAUSE)
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
    const ok = await enterPip(wc)
    if (ok) w.media.pip.add(id)
    return ok
  })
}

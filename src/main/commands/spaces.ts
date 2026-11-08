// Space commands: create, edit (name, icon, theme, profile), reorder and delete.
import type { Appearance, Item, PersistedState, Space, SpaceTheme } from '@shared/types'
import { baseColor, isDark } from '@shared/theme'
import { sortedSpaces, spaceById, regularSpaces } from '@shared/ops'
import { makeSpace } from '../state/defaults'
import { DEFAULT_SPACE_ICON, isSpaceIcon } from '@shared/spaceIcons'
import { archiveItems } from './builtins'
import type { Commands } from './Commands'
import type { Core } from '../windows/WindowManager'

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const APPEARANCES: Appearance[] = ['light', 'dark', 'auto']

/** keep the spaces array in `order` order with orders 0..n-1, so array index and order agree */
export function normalizeSpaces(s: PersistedState): void {
  s.spaces.sort((a, b) => a.order - b.order)
  s.spaces.forEach((sp, i) => (sp.order = i))
}

/** apply a partial theme, ignoring anything malformed */
export function applyTheme(theme: SpaceTheme, patch: unknown): void {
  if (!patch || typeof patch !== 'object') return
  const t = patch as Partial<SpaceTheme>
  if (Array.isArray(t.colors)) {
    const colors = t.colors.filter((c): c is string => typeof c === 'string' && HEX.test(c)).slice(0, 3)
    if (colors.length) theme.colors = colors
  }
  if (typeof t.angle === 'number' && Number.isFinite(t.angle)) theme.angle = ((Math.round(t.angle) % 360) + 360) % 360
  if (typeof t.noise === 'number' && Number.isFinite(t.noise)) theme.noise = Math.max(0, Math.min(1, t.noise))
  if (APPEARANCES.includes(t.appearance as Appearance)) theme.appearance = t.appearance as Appearance
}

function repaint(core: Core, space: Space): void {
  for (const w of core.windows) {
    if (w.activeSpaceId !== space.id || w.closed) continue
    w.win.setBackgroundColor(baseColor(space, isDark(space.theme, core.systemDark())))
  }
  core.scheduleBroadcast()
}

export function registerSpaceCommands(c: Commands): void {
  c.register('space.new', ({ core, w }, p) => {
    const s = core.store.state
    const profileId = str(p.profileId) && s.profiles.some((x) => x.id === p.profileId) ? (p.profileId as string) : (w?.space().profileId ?? s.profiles[0].id)
    const space = makeSpace(str(p.name)?.trim() || `Space ${s.spaces.length + 1}`, profileId, s.spaces.length, isSpaceIcon(p.icon) ? p.icon : DEFAULT_SPACE_ICON)
    if (Array.isArray(p.colors)) applyTheme(space.theme, { colors: p.colors })
    applyTheme(space.theme, p.theme)
    core.store.update((st) => {
      normalizeSpaces(st)
      space.order = st.spaces.length
      st.spaces.push(space)
    })
    if (w && p.activate !== false) w.switchSpace(space.id)
    return space.id
  })

  c.register('space.edit', ({ core, w }, p) => {
    const s = core.store.state
    const space = spaceById(s, str(p.id) ?? w?.activeSpaceId)
    if (!space) return false
    const hasPatch = 'name' in p || 'icon' in p || 'theme' in p || 'profileId' in p
    if (!hasPatch) {
      w?.openOverlay({ kind: 'spaceEdit', spaceId: space.id })
      return true
    }
    const profileId = str(p.profileId)
    const newProfile = profileId && profileId !== space.profileId && s.profiles.some((x) => x.id === profileId) ? profileId : undefined
    const reload: Item[] = []
    core.store.update((st) => {
      if (typeof p.name === 'string' && p.name.trim()) space.name = p.name.trim().slice(0, 80)
      // only Lucide icon names; anything else (an emoji, an unknown name) leaves the icon as it was
      if (isSpaceIcon(p.icon)) space.icon = p.icon
      applyTheme(space.theme, p.theme)
      if (newProfile) {
        space.profileId = newProfile
        for (const it of st.items) {
          if (it.spaceId !== space.id) continue
          it.profileId = newProfile
          if (it.kind === 'tab') reload.push(it)
        }
      }
    })
    if (newProfile) {
      for (const it of reload) core.destroyItemViews(it.id)
      for (const win of core.windows) {
        if (win.activeSpaceId !== space.id) continue
        const active = win.activeItem()
        win.activeItemId = null
        win.activate(active && active.spaceId === space.id ? active.id : (win.pickItemForSpace(space)?.id ?? null), { focus: false })
      }
    }
    repaint(core, space)
    return true
  })

  c.register('space.reorder', ({ core }, p) => {
    const s = core.store.state
    const space = spaceById(s, str(p.id))
    const index = num(p.index)
    if (!space || index === undefined) return false
    core.store.update((st) => {
      const list = (space.incognito ? sortedSpaces(st) : regularSpaces(st)).filter((x) => x.id !== space.id)
      list.splice(Math.max(0, Math.min(list.length, Math.round(index))), 0, space)
      list.forEach((x, i) => (x.order = i))
      normalizeSpaces(st)
    })
    return regularSpaces(core.store.state).map((x) => x.id)
  })

  c.register('space.delete', ({ core, w }, p) => {
    const s = core.store.state
    const space = spaceById(s, str(p.id) ?? w?.activeSpaceId)
    // a private space goes with its window; every other window keeps at least one regular space
    if (!space || (!space.incognito && regularSpaces(s).length < 2)) return false
    const ordered = space.incognito ? sortedSpaces(s) : regularSpaces(s)
    const idx = ordered.findIndex((x) => x.id === space.id)
    const fallback = ordered[idx + 1] ?? ordered[idx - 1]
    for (const win of core.windows) if (win.activeSpaceId === space.id) win.switchSpace(fallback.id)
    const items = s.items.filter((i) => i.spaceId === space.id)
    // pinned tabs and folders are kept in the archive; Today tabs are closed into it
    archiveItems(core, items.filter((i) => i.section === 'pinned'), 'manual')
    archiveItems(core, items.filter((i) => i.section !== 'pinned'), 'closed')
    core.store.update((st) => {
      st.spaces = st.spaces.filter((x) => x.id !== space.id)
      st.items = st.items.filter((i) => i.spaceId !== space.id)
      if (Array.isArray(st.settings.linkRules)) st.settings.linkRules = st.settings.linkRules.filter((r) => r.spaceId !== space.id)
      normalizeSpaces(st)
    })
    for (const win of core.windows) win.lastActiveBySpace.delete(space.id)
    return true
  })
}

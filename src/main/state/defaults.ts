import { SCHEMA_VERSION, type PersistedState, type Settings, type Space } from '@shared/types'
import { THEME_PRESETS } from '@shared/theme'
import { DEFAULT_SEARCH } from '@shared/url'
import { newId } from '../util/id'
import { DEFAULT_SPACE_ICON } from '@shared/spaceIcons'

export function defaultSettings(): Settings {
  return {
    archiveAfter: '12h',
    sidebarWidth: 260,
    sidebarVisible: true,
    shortcuts: {},
    searchEngine: DEFAULT_SEARCH,
    siteSearch: [
      { keyword: 'yt', name: 'YouTube', urlTemplate: 'https://www.youtube.com/results?search_query=%s' },
      { keyword: 'gh', name: 'GitHub', urlTemplate: 'https://github.com/search?q=%s' },
      { keyword: 'w', name: 'Wikipedia', urlTemplate: 'https://en.wikipedia.org/w/index.php?search=%s' }
    ],
    linkRules: [],
    adblock: true,
    openExternalLinksInMiniWindow: false,
    appearance: 'auto',
    pipAuto: false,
    // round 3c
    onboarded: false
  }
}

export function makeSpace(name: string, profileId: string, order: number, icon: string = DEFAULT_SPACE_ICON): Space {
  const colors = THEME_PRESETS[order % THEME_PRESETS.length]
  return {
    id: newId('space'),
    name,
    icon,
    profileId,
    theme: { colors: [...colors], angle: 150, noise: 0.18, appearance: 'auto' },
    order
  }
}

export function defaultState(): PersistedState {
  const profileId = newId('profile')
  const now = Date.now()
  return {
    schemaVersion: SCHEMA_VERSION,
    profiles: [{ id: profileId, name: 'Personal', partition: `persist:profile-${profileId}`, createdAt: now }],
    spaces: [makeSpace('Personal', profileId, 0, 'home')],
    items: [],
    archive: [],
    settings: defaultSettings(),
    styles: []
  }
}

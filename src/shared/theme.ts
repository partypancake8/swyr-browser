// Space theme helpers shared by the shell, overlay and internal pages.
import type { Space, SpaceTheme } from './types'

/** original swyr palette: soft two-colour pairs */
export const THEME_PRESETS: string[][] = [
  ['#F6D5C3', '#CFE0F5'],
  ['#CDEBD8', '#F3E7B8'],
  ['#E3D2F4', '#F7CFDA'],
  ['#C8E6EE', '#D9D3F5'],
  ['#F4E1B5', '#F2C6B6'],
  ['#D6E9C4', '#C4DDE9']
]

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6)
  const n = parseInt(full, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function mix(hex: string, target: string, amount: number): string {
  const a = hexToRgb(hex)
  const b = hexToRgb(target)
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * amount))
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('')
}

export function isDark(theme: SpaceTheme, systemDark: boolean): boolean {
  return theme.appearance === 'dark' || (theme.appearance === 'auto' && systemDark)
}

export function themeColors(theme: SpaceTheme, dark: boolean): string[] {
  const cs = theme.colors.length ? theme.colors : ['#E8E8E8']
  return dark ? cs.map((c) => mix(c, '#121317', 0.72)) : cs
}

export function gradientCss(theme: SpaceTheme, dark: boolean): string {
  const cs = themeColors(theme, dark)
  if (cs.length === 1) return cs[0]
  return `linear-gradient(${theme.angle}deg, ${cs.join(', ')})`
}

export function baseColor(space: Space | undefined, dark: boolean): string {
  if (!space) return dark ? '#1b1c20' : '#f1f1f1'
  return themeColors(space.theme, dark)[0]
}

/** an SVG fractal noise tile as a data URL, used as a texture overlay */
export const NOISE_URL =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.55 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")"

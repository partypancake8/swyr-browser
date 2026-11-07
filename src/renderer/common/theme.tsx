// Space theme for renderers: the gradient background, noise and light or dark tokens.
import { useEffect, type CSSProperties, type ReactNode } from 'react'
import type { Space, ViewState } from '@shared/types'
import { NOISE_URL, baseColor, gradientCss, isDark } from '@shared/theme'

export function activeSpace(vs: ViewState): Space | undefined {
  return vs.state.spaces.find((s) => s.id === vs.window.activeSpaceId) ?? vs.state.spaces[0]
}

export function useSpaceTheme(space: Space | undefined, systemDark: boolean): { dark: boolean; background: string } {
  const dark = space ? isDark(space.theme, systemDark) : systemDark
  const background = space ? gradientCss(space.theme, dark) : dark ? '#1b1c20' : '#f1f1f1'
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    document.documentElement.style.setProperty('--space-bg', baseColor(space, dark))
  }, [dark, space])
  return { dark, background }
}

export function SpaceBackground(props: { space: Space | undefined; dark: boolean; className?: string; style?: CSSProperties; children?: ReactNode }): ReactNode {
  const { space, dark } = props
  const background = space ? gradientCss(space.theme, dark) : 'var(--space-bg)'
  const noise = space ? space.theme.noise : 0
  return (
    <div className={`space-bg ${props.className ?? ''}`} style={{ background, ...props.style }}>
      {noise > 0 && <div className="noise" style={{ backgroundImage: NOISE_URL, opacity: Math.min(1, noise * (dark ? 0.8 : 1.2)) }} />}
      {props.children}
    </div>
  )
}

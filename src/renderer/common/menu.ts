// Native context menus built in the renderer and shown by the main process (command: menu.popup).
import type { MouseEvent as ReactMouseEvent } from 'react'
import type { MenuEntry } from '@shared/types'
import { invoke } from './store'

export const SEP: MenuEntry = { type: 'separator' }

export function showMenu(entries: (MenuEntry | false | null | undefined)[], e?: ReactMouseEvent | MouseEvent): void {
  e?.preventDefault()
  e?.stopPropagation()
  const list = entries.filter((x): x is MenuEntry => Boolean(x))
  // drop leading, trailing and doubled separators
  const clean = list.filter((x, i) => x.type !== 'separator' || (i > 0 && i < list.length - 1 && list[i - 1].type !== 'separator'))
  void invoke('menu.popup', { entries: clean, x: e?.clientX, y: e?.clientY })
}

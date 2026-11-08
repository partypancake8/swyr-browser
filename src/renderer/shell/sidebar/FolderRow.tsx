// A folder row in the Pinned list: chevron, folder icon, name, inline rename, drop-into highlight.
import type { ReactNode } from 'react'
import { ChevronRight, Folder, FolderOpen } from 'lucide-react'
import type { Item, MenuEntry, Space, ViewState } from '@shared/types'
import { childrenOf, itemTitle, windowSpaces } from '@shared/ops'
import { SEP, showMenu } from '../../common/menu'
import { invoke } from '../../common/store'
import { justDragged } from './dnd'
import { DropLine, ROW_INDENT, RenameInput, useItemDnd } from './TabRow'

function folderMenu(folder: Item, vs: ViewState, space: Space | undefined): MenuEntry[] {
  const others = windowSpaces(vs.state, vs.window.activeSpaceId).filter((x) => x.id !== space?.id)
  return [
    { label: 'Rename…', command: 'folder.rename', payload: { itemId: folder.id } },
    { label: folder.collapsed ? 'Expand' : 'Collapse', command: 'folder.toggle', payload: { itemId: folder.id } },
    { label: 'New Folder Inside', command: 'folder.new', payload: { name: 'New Folder', parentId: folder.id, rename: true } },
    ...(folder.parentId ? [{ label: 'Move Out of Folder', command: 'tab.move', payload: { itemId: folder.id, section: 'pinned', parentId: null } }] : []),
    ...(others.length
      ? [
          {
            label: 'Move to Space',
            submenu: others.map((x) => ({ label: x.name, command: 'tab.move', payload: { itemId: folder.id, section: 'pinned', parentId: null, spaceId: x.id } }))
          }
        ]
      : []),
    SEP,
    { label: 'Delete Folder (keep its tabs)', command: 'folder.delete', payload: { itemId: folder.id } }
  ]
}

export function FolderRow({ folder, depth, vs, space }: { folder: Item; depth: number; vs: ViewState; space: Space | undefined }): ReactNode {
  const renaming = vs.window.renamingItemId === folder.id
  const open = !folder.collapsed
  const count = childrenOf(vs.state, folder.id).length
  const dnd = useItemDnd(folder)
  const into = dnd.indicator?.position === 'inside'
  const Icon = open && count > 0 ? FolderOpen : Folder
  return (
    <div
      ref={dnd.ref}
      {...dnd.attributes}
      {...dnd.listeners}
      role="treeitem"
      aria-expanded={open}
      tabIndex={-1}
      className={`group no-drag relative flex h-8 shrink-0 items-center gap-1.5 rounded-lg pr-2 outline-none hover:bg-[var(--row-hover)] ${into ? 'drop-into' : ''} ${
        dnd.isDragging ? 'opacity-40' : ''
      }`}
      style={{ paddingLeft: 4 + depth * ROW_INDENT }}
      onClick={() => {
        if (!renaming && !justDragged()) void invoke('folder.toggle', { itemId: folder.id })
      }}
      onDoubleClick={(e) => {
        e.stopPropagation()
        if (!renaming) void invoke('folder.rename', { itemId: folder.id })
      }}
      onContextMenu={(e) => showMenu(folderMenu(folder, vs, space), e)}
      data-item={folder.id} data-item-id={folder.id}
      data-kind="folder"
      data-depth={depth}
      title={renaming ? undefined : itemTitle(folder)}
    >
      <ChevronRight size={14} strokeWidth={2.2} className="shrink-0 transition-transform duration-150" style={{ transform: open ? 'rotate(90deg)' : 'none' }} />
      <Icon size={16} strokeWidth={1.9} className="shrink-0" />
      {renaming ? (
        <RenameInput item={folder} />
      ) : (
        <span className="ml-0.5 min-w-0 flex-1 truncate text-[13px] font-semibold leading-none">{itemTitle(folder)}</span>
      )}
      {!renaming && !open && count > 0 && <span className="shrink-0 rounded-md bg-[var(--select)] px-1.5 text-[11px] font-semibold leading-[18px]">{count}</span>}
      <DropLine indicator={dnd.indicator} depth={depth} />
    </div>
  )
}

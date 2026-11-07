// Modal dialogs drawn by the overlay: rename (favorites and any item), confirm space delete, confirm archive clear.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { DialogOverlay, ViewState } from '@shared/types'
import { itemTitle, spaceCounts } from '@shared/ops'
import { Favicon } from '../../common/Favicon'
import { invoke } from '../../common/store'

function Card({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }): ReactNode {
  return (
    <div
      className="fixed inset-0 flex items-start justify-center bg-[var(--backdrop)]"
      style={{ paddingTop: '22vh' }}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <div className="w-[360px] rounded-2xl border border-[var(--card-border)] bg-[var(--card)] p-5" style={{ boxShadow: '0 24px 48px rgba(0,0,0,0.22)' }} role="dialog" aria-label={title}>
        <div className="mb-3 text-[15px] font-semibold">{title}</div>
        {children}
      </div>
    </div>
  )
}

const btn = 'rounded-lg px-3 py-1.5 text-[13px] font-semibold hover:bg-[var(--select)]'
const primary = 'rounded-lg bg-[var(--fg)] px-3 py-1.5 text-[13px] font-semibold text-(color:--card)'
const danger = 'rounded-lg bg-[#b42318] px-3 py-1.5 text-[13px] font-semibold text-white hover:brightness-110'

function RenameDialog({ vs, itemId }: { vs: ViewState; itemId: string }): ReactNode {
  const item = vs.state.items.find((i) => i.id === itemId)
  const [value, setValue] = useState(item ? itemTitle(item) : '')
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])
  const close = (): void => void invoke('overlay.close')
  if (!item) return null
  const save = async (): Promise<void> => {
    await invoke('tab.rename', { itemId: item.id, title: value })
    close()
  }
  return (
    <Card title={item.kind === 'folder' ? 'Rename Folder' : 'Rename'} onClose={close}>
      <label className="mb-4 flex h-10 items-center gap-2 rounded-lg bg-[var(--select)] px-3">
        {item.kind !== 'folder' && <Favicon item={item} size={16} />}
        <input
          ref={ref}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void save()}
          placeholder={item.title || 'Name'}
          aria-label="Name"
          className="min-w-0 flex-1 bg-transparent text-[14px] font-medium outline-none"
        />
      </label>
      {item.kind !== 'folder' && <p className="mb-4 text-[12px]">Leave it empty to use the page title.</p>}
      <div className="flex justify-end gap-2">
        <button className={btn} onClick={close}>
          Cancel
        </button>
        <button className={primary} onClick={save}>
          Save
        </button>
      </div>
    </Card>
  )
}

function ConfirmDeleteSpace({ vs, spaceId }: { vs: ViewState; spaceId: string }): ReactNode {
  const space = vs.state.spaces.find((s) => s.id === spaceId)
  const close = (): void => void invoke('overlay.close')
  const ref = useRef<HTMLButtonElement>(null)
  useEffect(() => ref.current?.focus(), [])
  if (!space) return null
  const c = spaceCounts(vs.state, space.id)
  const last = vs.state.spaces.length < 2
  return (
    <Card title={`Delete ${space.emoji ? space.emoji + ' ' : ''}${space.name}?`} onClose={close}>
      <p className="mb-4 text-[13px] leading-5">
        {last
          ? 'This is your only space, so it cannot be deleted.'
          : `Its ${c.pinned} pinned ${c.pinned === 1 ? 'tab' : 'tabs'} and ${c.folders} ${c.folders === 1 ? 'folder' : 'folders'} move to the Archive, and its ${c.today} Today ${c.today === 1 ? 'tab is' : 'tabs are'} closed into the Archive. You can restore any of them later.`}
      </p>
      <div className="flex justify-end gap-2">
        <button className={btn} onClick={close}>
          Cancel
        </button>
        {!last && (
          <button
            ref={ref}
            className={danger}
            onClick={async () => {
              await invoke('overlay.close')
              await invoke('space.delete', { id: space.id })
            }}
          >
            Delete Space
          </button>
        )}
      </div>
    </Card>
  )
}

function ConfirmClearArchive({ vs }: { vs: ViewState }): ReactNode {
  const close = (): void => void invoke('overlay.close')
  const n = vs.state.archive.length
  return (
    <Card title="Clear the Archive?" onClose={close}>
      <p className="mb-4 text-[13px] leading-5">{`This permanently removes ${n} archived ${n === 1 ? 'tab' : 'tabs'}. It cannot be undone.`}</p>
      <div className="flex justify-end gap-2">
        <button className={btn} onClick={close}>
          Cancel
        </button>
        <button
          className={danger}
          onClick={async () => {
            await invoke('archive.clear')
            close()
          }}
        >
          Clear Archive
        </button>
      </div>
    </Card>
  )
}

export function Dialogs({ vs, dialog }: { vs: ViewState; dialog: DialogOverlay }): ReactNode {
  switch (dialog.dialog) {
    case 'rename':
      return dialog.itemId ? <RenameDialog vs={vs} itemId={dialog.itemId} /> : null
    case 'confirmDeleteSpace':
      return dialog.spaceId ? <ConfirmDeleteSpace vs={vs} spaceId={dialog.spaceId} /> : null
    case 'confirmClearArchive':
      return <ConfirmClearArchive vs={vs} />
    default:
      return null
  }
}

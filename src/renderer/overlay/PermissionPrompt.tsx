// The permission prompt: a site asks for notifications, location, the camera and so on. Allow and Block answer it
// (permission.respond) and swyr remembers the answer for the site; Escape or a click outside closes it and denies
// this one request without remembering anything.
import type { ReactNode } from 'react'
import { ShieldCheck } from 'lucide-react'
import type { PermissionOverlay, ViewState } from '@shared/types'
import { invoke } from '../common/store'
import { Popover, PERMISSION_LABELS } from './SiteSettings'
import { Button } from '../pages/settings/ui'

function askText(p: PermissionOverlay): string {
  const parts = p.permissions.map((x) => PERMISSION_LABELS[x]?.ask ?? x)
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : (parts[0] ?? '')
}

export function PermissionPrompt({ vs, prompt }: { vs: ViewState; prompt: PermissionOverlay }): ReactNode {
  const answer = (allow: boolean): void => void invoke('permission.respond', { allow, promptId: prompt.promptId })
  const meta = PERMISSION_LABELS[prompt.permission]
  const Icon = meta?.icon ?? ShieldCheck
  return (
    <Popover vs={vs} width={360} label="Permission request">
      <div className="flex items-start gap-3 px-4 pb-3 pt-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[var(--select)]">
          <Icon size={18} strokeWidth={1.9} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="break-words text-[15px] font-bold" data-testid="permission-host">
            {prompt.host}
          </div>
          <div className="mt-0.5 text-[13.5px] font-medium">wants to {askText(prompt)}</div>
        </div>
      </div>
      <div className="px-4 pb-3 text-[12.5px] font-medium">
        {prompt.incognito ? 'This is a private window: swyr forgets your answer when the window closes.' : 'swyr remembers your answer for this site. You can change it in Site Settings.'}
      </div>
      <div className="flex justify-end gap-2 border-t border-[var(--card-border)] px-4 py-3">
        <Button onClick={() => answer(false)}>Block</Button>
        <Button kind="primary" onClick={() => answer(true)}>
          Allow
        </Button>
      </div>
    </Popover>
  )
}

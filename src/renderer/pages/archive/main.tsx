// swyr://archive: archived tabs grouped by day, with search, restore, delete and clear.
import { createRoot } from 'react-dom/client'
import type { ReactNode } from 'react'
import '../../common/base.css'
import '../page.css'
import { startViewSync, useView } from '../../common/store'
import { activeSpace, useSpaceTheme } from '../../common/theme'
import { ArchiveView } from './ArchiveView'

function ArchivePage(): ReactNode {
  const vs = useView((s) => s.vs)
  const space = vs ? activeSpace(vs) : undefined
  useSpaceTheme(space, vs?.systemDark ?? false)
  return (
    <div className="mx-auto max-w-[760px] px-6 py-10">
      <ArchiveView vs={vs} />
    </div>
  )
}

startViewSync()
createRoot(document.getElementById('root')!).render(<ArchivePage />)

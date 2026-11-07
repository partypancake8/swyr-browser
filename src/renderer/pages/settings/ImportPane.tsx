// Settings > Advanced: import a sidebar from another browser, export swyr data, reset settings.
import { useState, type ReactNode } from 'react'
import { Download, RotateCcw, Upload } from 'lucide-react'
import type { ImportSummary } from '@shared/types'
import { IMPORT_DEFAULT_PATH_HINT, IMPORT_FROM_LABEL } from '@shared/importer'
import { invoke } from '../../common/store'
import { Button, Row, Section } from './ui'

type ImportResult = (ImportSummary & { dryRun?: boolean }) | { error: string } | null

function plural(n: number, one: string, many = one + 's'): string {
  return `${n} ${n === 1 ? one : many}`
}

export function AdvancedPane(): ReactNode {
  const [result, setResult] = useState<ImportResult>(null)
  const [busy, setBusy] = useState(false)
  const [exported, setExported] = useState<string | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)

  const runImport = async (): Promise<void> => {
    setBusy(true)
    try {
      setResult((await invoke('import.arc')) as ImportResult)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Section title="Import">
        <Row
          label={IMPORT_FROM_LABEL}
          detail={
            <>
              Brings in your spaces, pinned tabs, folders and open tabs. swyr reads the file on this Mac only and never uploads it. The usual location is{' '}
              <code className="font-semibold">{IMPORT_DEFAULT_PATH_HINT}</code>.
            </>
          }
        >
          <Button kind="primary" disabled={busy} onClick={() => void runImport()}>
            <span className="flex items-center gap-1.5">
              <Upload size={14} /> {busy ? 'Importing…' : 'Choose File…'}
            </span>
          </Button>
        </Row>
        {result && 'error' in result && <Row label="Import failed" detail={result.error} />}
        {result && !('error' in result) && (
          <Row
            label="Imported"
            detail={`${plural(result.spaces, 'space')}, ${plural(result.pinned, 'pinned tab')}, ${plural(result.folders, 'folder')}, ${plural(result.today, 'Today tab')}${result.favorites ? `, ${plural(result.favorites, 'favorite')}` : ''}.`}
          />
        )}
      </Section>

      <Section title="Your data">
        <Row label="Export swyr data" detail="Saves your spaces, tabs, archive and settings as one JSON file.">
          <Button
            onClick={() =>
              void invoke('data.export').then((r) => {
                if (typeof r === 'string') setExported(r)
              })
            }
          >
            <span className="flex items-center gap-1.5">
              <Download size={14} /> Export…
            </span>
          </Button>
        </Row>
        {exported && <Row label="Exported" detail={exported} />}
        <Row label="Reset settings" detail="Puts every setting and shortcut back to its default. Spaces, tabs, extensions and Link Rules stay.">
          {confirmReset ? (
            <>
              <Button onClick={() => setConfirmReset(false)}>Cancel</Button>
              <Button
                kind="danger"
                onClick={() => {
                  setConfirmReset(false)
                  void invoke('settings.reset')
                }}
              >
                Reset
              </Button>
            </>
          ) : (
            <Button kind="danger" onClick={() => setConfirmReset(true)}>
              <span className="flex items-center gap-1.5">
                <RotateCcw size={14} /> Reset…
              </span>
            </Button>
          )}
        </Row>
      </Section>
    </>
  )
}

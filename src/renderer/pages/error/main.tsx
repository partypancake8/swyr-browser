// swyr://error?code=&name=&url=: what went wrong in plain words, with Retry and Copy URL.
import { createRoot } from 'react-dom/client'
import { useEffect, useState, type ReactNode } from 'react'
import { Check, Copy, RotateCw, Unplug } from 'lucide-react'
import '../../common/base.css'
import '../page.css'
import { startViewSync, useView } from '../../common/store'
import { activeSpace, useSpaceTheme } from '../../common/theme'
import { errorCopy } from './messages'

const params = new URLSearchParams(location.search)
const failedUrl = params.get('url') ?? ''
const code = Number(params.get('code') ?? '0')
const name = params.get('name') || `Error ${code}`

function hostOf(url: string): string {
  try {
    const u = new URL(url)
    return u.host || u.href
  } catch {
    return url
  }
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const el = document.createElement('textarea')
    el.value = text
    document.body.appendChild(el)
    el.select()
    const ok = document.execCommand('copy')
    el.remove()
    return ok
  }
}

function ErrorPage(): ReactNode {
  const vs = useView((s) => s.vs)
  const space = vs ? activeSpace(vs) : undefined
  useSpaceTheme(space, vs?.systemDark ?? window.matchMedia('(prefers-color-scheme: dark)').matches)
  const [copied, setCopied] = useState(false)
  const host = hostOf(failedUrl)
  const copy = errorCopy(code)
  useEffect(() => {
    document.title = host ? `${host} is not available` : 'Page not available'
  }, [host])
  const retry = (): void => {
    if (failedUrl) location.replace(failedUrl)
  }
  return (
    <div className="flex min-h-full items-center justify-center px-6 py-12">
      <div className="w-full max-w-[520px]">
        <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--select)]">
          <Unplug size={24} strokeWidth={2} />
        </div>
        <h1 className="mb-2 text-[26px] font-bold leading-tight tracking-tight">{copy.title}</h1>
        <p className="mb-5 text-[15px] leading-relaxed">{copy.detail(host)}</p>
        <div className="mb-6 rounded-xl border border-[var(--card-border)] bg-[var(--card)] px-4 py-3">
          <div className="break-all text-[13.5px] font-semibold">{failedUrl}</div>
          <div className="mt-1 font-mono text-[12.5px]">{name}</div>
        </div>
        <div className="flex gap-2">
          <button
            autoFocus
            className="flex items-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2 text-[14px] font-semibold text-[var(--content)] hover:brightness-110"
            onClick={retry}
          >
            <RotateCw size={15} strokeWidth={2.2} /> Retry
          </button>
          <button
            className="flex items-center gap-2 rounded-lg bg-[var(--select)] px-4 py-2 text-[14px] font-semibold hover:brightness-95"
            onClick={() =>
              void copyText(failedUrl).then((ok) => {
                setCopied(ok)
                if (ok) setTimeout(() => setCopied(false), 1500)
              })
            }
          >
            {copied ? <Check size={15} strokeWidth={2.2} /> : <Copy size={15} strokeWidth={2.2} />} {copied ? 'Copied' : 'Copy URL'}
          </button>
        </div>
      </div>
    </div>
  )
}

startViewSync()
createRoot(document.getElementById('root')!).render(<ErrorPage />)

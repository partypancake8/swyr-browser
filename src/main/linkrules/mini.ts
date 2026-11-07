/// <reference types="vite/client" />
// Optional bridge to the Mini Window (src/main/windows/MiniWindow.ts, owned by the views work).
// import.meta.glob resolves to an empty map when that file is absent, so this builds either way.
type MiniModule = { openInMiniWindow?: (url: string, ...rest: unknown[]) => unknown }

const modules = import.meta.glob<MiniModule>('../windows/MiniWindow.ts')

/** opens url in a Mini Window; false when the Mini Window is not available */
export async function openInMiniWindow(url: string, ...rest: unknown[]): Promise<boolean> {
  const load = modules['../windows/MiniWindow.ts']
  if (!load) return false
  try {
    const mod = await load()
    if (typeof mod.openInMiniWindow !== 'function') return false
    await mod.openInMiniWindow(url, ...rest)
    return true
  } catch (err) {
    console.warn('[swyr] mini window unavailable', (err as Error).message)
    return false
  }
}

// Site compatibility, page side: runs in a web page's main world before any page script and makes the page
// see what the same Chrome build shows. navigator.userAgentData reports Chrome's brand list (GREASE,
// Chromium, Google Chrome) and window.chrome carries app, csi, loadTimes and runtime. Self-contained:
// contextBridge.executeInMainWorld serializes this function, so it may not use anything from outside.
// The header half lives in src/main/profiles/ChromeIdentity.ts.
export function chromeLook(): void {
  type NavTiming = { type?: string; nextHopProtocol?: string; responseStart?: number; domContentLoadedEventEnd?: number; loadEventEnd?: number }
  const w = globalThis as unknown as Record<string, unknown> & { NavigatorUAData?: { prototype: object } }
  const natives = new WeakMap<object, string>()
  const fnToString = Function.prototype.toString
  const asNative = <F extends object>(fn: F, name: string): F => {
    natives.set(fn, `function ${name}() { [native code] }`)
    return fn
  }
  try {
    const toString = asNative(function toString(this: unknown): string {
      if ((typeof this === 'function' || typeof this === 'object') && this !== null && natives.has(this as object)) return natives.get(this as object) as string
      return fnToString.call(this as () => void)
    }, 'toString')
    Object.defineProperty(Function.prototype, 'toString', { value: toString, writable: true, configurable: true, enumerable: false })
  } catch {
    /* leave toString alone */
  }

  // Chrome's brand list: GREASE, Chromium and Google Chrome, in the order Chrome picks for this major version
  type BV = { brand: string; version: string }
  const orders = [
    [0, 1, 2],
    [0, 2, 1],
    [1, 0, 2],
    [1, 2, 0],
    [2, 0, 1],
    [2, 1, 0]
  ]
  const fix = (list: BV[]): BV[] => {
    if (!Array.isArray(list)) return list
    const clean = list.filter((b) => !/electron|swyr/i.test(b.brand))
    if (clean.some((b) => b.brand === 'Google Chrome')) return clean
    const chromium = clean.find((b) => b.brand === 'Chromium')
    const grease = clean.find((b) => b !== chromium)
    if (!chromium || !grease) return clean
    const base = [grease, chromium, { brand: 'Google Chrome', version: chromium.version }]
    const order = orders[(Number(chromium.version.split('.')[0]) || 0) % orders.length]
    const out: BV[] = new Array(3)
    base.forEach((b, i) => (out[order[i]] = { brand: b.brand, version: b.version }))
    return out
  }
  try {
    const proto = w.NavigatorUAData?.prototype as Record<string, unknown> | undefined
    if (proto) {
      const desc = Object.getOwnPropertyDescriptor(proto, 'brands')
      const getBrands = desc?.get
      if (desc && getBrands) {
        const cache = new WeakMap<object, BV[]>()
        Object.defineProperty(proto, 'brands', {
          ...desc,
          get: asNative(function brands(this: object): BV[] {
            const orig = getBrands.call(this) as BV[]
            let fixed = cache.get(orig)
            if (!fixed) {
              fixed = Object.freeze(fix(orig).map((b) => Object.freeze(b))) as BV[]
              cache.set(orig, fixed)
            }
            return fixed
          }, 'get brands')
        })
      }
      const high = proto.getHighEntropyValues as ((hints: string[]) => Promise<Record<string, unknown>>) | undefined
      if (typeof high === 'function') {
        Object.defineProperty(proto, 'getHighEntropyValues', {
          value: asNative(function getHighEntropyValues(this: object, hints: string[]): Promise<Record<string, unknown>> {
            return high.call(this, hints).then((v) => {
              if (Array.isArray(v.brands)) v.brands = fix(v.brands as BV[])
              if (Array.isArray(v.fullVersionList)) v.fullVersionList = fix(v.fullVersionList as BV[])
              return v
            })
          }, 'getHighEntropyValues'),
          writable: true,
          configurable: true,
          enumerable: true
        })
      }
      const toJSON = proto.toJSON as (() => Record<string, unknown>) | undefined
      if (typeof toJSON === 'function') {
        Object.defineProperty(proto, 'toJSON', {
          value: asNative(function toJSON(this: object): Record<string, unknown> {
            const v = toJSON.call(this)
            if (Array.isArray(v.brands)) v.brands = fix(v.brands as BV[])
            return v
          }, 'toJSON'),
          writable: true,
          configurable: true,
          enumerable: true
        })
      }
    }
  } catch {
    /* keep the native object */
  }

  // window.chrome: Chrome pages have chrome.app, chrome.csi, chrome.loadTimes and (with any extension installed) chrome.runtime
  try {
    let chrome = w.chrome as Record<string, unknown> | undefined
    if (!chrome || typeof chrome !== 'object') {
      chrome = {}
      Object.defineProperty(w, 'chrome', { value: chrome, writable: true, configurable: false, enumerable: true })
    }
    const c = chrome
    if (!c.app) {
      c.app = {
        isInstalled: false,
        InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
        RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
        getDetails: asNative(function getDetails(): null {
          return null
        }, 'getDetails'),
        getIsInstalled: asNative(function getIsInstalled(): boolean {
          return false
        }, 'getIsInstalled'),
        installState: asNative(function installState(cb?: (s: string) => void): void {
          if (typeof cb === 'function') setTimeout(() => cb('not_installed'), 0)
        }, 'installState'),
        runningState: asNative(function runningState(): string {
          return 'cannot_run'
        }, 'runningState')
      }
    }
    const timing = (): NavTiming | undefined => (performance as unknown as { getEntriesByType(t: string): NavTiming[] }).getEntriesByType('navigation')[0]
    if (!c.csi) {
      c.csi = asNative(function csi(): Record<string, number> {
        const start = performance.timeOrigin
        const nav = timing()
        return { startE: Math.round(start), onloadT: Math.round(start + (nav?.domContentLoadedEventEnd || performance.now())), pageT: performance.now(), tran: 15 }
      }, 'csi')
    }
    if (!c.loadTimes) {
      c.loadTimes = asNative(function loadTimes(): Record<string, unknown> {
        const start = performance.timeOrigin / 1000
        const nav = timing()
        const at = (ms: number | undefined): number => (ms ? start + ms / 1000 : 0)
        const proto = nav?.nextHopProtocol || 'http/1.1'
        const spdy = proto === 'h2' || proto === 'h3'
        return {
          requestTime: start,
          startLoadTime: start,
          commitLoadTime: at(nav?.responseStart),
          finishDocumentLoadTime: at(nav?.domContentLoadedEventEnd),
          finishLoadTime: at(nav?.loadEventEnd),
          firstPaintTime: at(performance.getEntriesByName('first-paint')[0]?.startTime),
          firstPaintAfterLoadTime: 0,
          navigationType: nav?.type === 'reload' ? 'Reload' : nav?.type === 'back_forward' ? 'BackForward' : 'Other',
          wasFetchedViaSpdy: spdy,
          wasNpnNegotiated: spdy,
          npnNegotiatedProtocol: spdy ? proto : 'unknown',
          wasAlternateProtocolAvailable: false,
          connectionInfo: proto
        }
      }, 'loadTimes')
    }
    if (!c.runtime) {
      // what Chrome shows a page once any extension is installed: messaging that needs an extension id
      const needsId = (name: string): (() => never) =>
        asNative(function (): never {
          throw new TypeError(`Error in invocation of runtime.${name}(): chrome.runtime.${name}() called from a webpage must specify an Extension ID (string) for its first argument.`)
        }, name)
      c.runtime = {
        OnInstalledReason: { CHROME_UPDATE: 'chrome_update', INSTALL: 'install', SHARED_MODULE_UPDATE: 'shared_module_update', UPDATE: 'update' },
        OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' },
        PlatformArch: { ARM: 'arm', ARM64: 'arm64', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
        PlatformNaclArch: { ARM: 'arm', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
        PlatformOs: { ANDROID: 'android', CROS: 'cros', FUCHSIA: 'fuchsia', LINUX: 'linux', MAC: 'mac', OPENBSD: 'openbsd', WIN: 'win' },
        RequestUpdateCheckStatus: { NO_UPDATE: 'no_update', THROTTLED: 'throttled', UPDATE_AVAILABLE: 'update_available' },
        connect: needsId('connect'),
        sendMessage: needsId('sendMessage')
      }
    }
  } catch {
    /* a page without window.chrome still works */
  }
}

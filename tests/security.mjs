// PLACEHOLDER: replaced at integration by the runtime security suite (process isolation, IPC, CSP, permissions).
// Until then it only proves the built app launches headless through the shared harness and reaches state.
import { launch } from './harness.mjs'

const t = await launch()
try {
  await t.waitFor((s) => s.windows?.length >= 1, 'first window')
  console.log('SECURITY PLACEHOLDER PASS (launch only; the runtime security suite replaces this file)')
} finally {
  await t.close()
}

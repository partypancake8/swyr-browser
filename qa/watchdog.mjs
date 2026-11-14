// An overall time limit for a QA script: when it runs out, the script stops the apps it started (its own child
// processes, by PID) and exits non-zero, so a hung page or app can never keep a run going forever.
import { execFileSync } from 'node:child_process'

export function watchdog(name, minutes) {
  const timer = setTimeout(() => {
    console.log(`${name}: still running after ${minutes} min; stopping its apps and exiting`)
    let kids
    try {
      kids = execFileSync('pgrep', ['-P', String(process.pid)], { encoding: 'utf8' }).split('\n').filter(Boolean).map(Number)
    } catch {
      kids = []
    }
    for (const pid of kids) {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        /* already gone */
      }
    }
    process.exit(3)
  }, minutes * 60 * 1000)
  timer.unref()
}

// Save before a desktop tab closes.
// Contract with the desktop shell: before closing a web tab it hides the page and evaluates
//   `window.dilinDesktop.beforeClose()`, waiting for the returned Promise (or 8 seconds) before it really closes;
//   no hook means it closes right away.
// Each editor registers "send whatever is still unsaved"; beforeClose runs them all and resolves when every one
//   settles or after 7.5 seconds (a little earlier than the shell's cap, so nothing is cut off half-way).
// Plain module, no React; only attaches when the shell injected window.dilinDesktop.

export type BeforeCloseFlush = () => unknown

/** Page-side budget, a little under the shell's 8 s */
export const DESKTOP_BEFORE_CLOSE_BUDGET_MS = 7500

const flushers = new Set<BeforeCloseFlush>()

/** Negative control for tests only: DILIN_NEG containing desktop_before_close_unhooked ⇒ never attach (old behaviour) */
const neg = (site: string) => { const v = typeof process !== 'undefined' ? process.env?.DILIN_NEG : undefined; return !!v && v.split(',').includes(site) }

/** Run every registered flush; one failing never blocks the rest; stop waiting at the budget */
export async function runDesktopBeforeClose(budgetMs: number = DESKTOP_BEFORE_CLOSE_BUDGET_MS): Promise<void> {
  const all = [...flushers].map(f => Promise.resolve().then(f).catch(() => undefined))
  if (!all.length) return
  let timer: ReturnType<typeof setTimeout> | undefined
  const cap = new Promise<void>(r => { timer = setTimeout(r, budgetMs) })
  try { await Promise.race([Promise.allSettled(all).then(() => undefined), cap]) } finally { if (timer) clearTimeout(timer) }
}

const runNow = () => runDesktopBeforeClose()

function install(): void {
  if (typeof window === 'undefined' || neg('desktop_before_close_unhooked')) return
  const d = (window as unknown as { dilinDesktop?: Record<string, unknown> }).dilinDesktop
  if (!d || typeof d !== 'object') return
  try { if (d.beforeClose !== runNow) d.beforeClose = runNow } catch { /* frozen by the shell ⇒ it just closes as before */ }
}

/** Register one "save before close"; returns the unregister function (call it on unmount) */
export function registerDesktopBeforeClose(f: BeforeCloseFlush): () => void {
  flushers.add(f)
  install()
  return () => { flushers.delete(f) }
}

/** Tests only */
export function _desktopBeforeCloseCountForTest(): number { return flushers.size }

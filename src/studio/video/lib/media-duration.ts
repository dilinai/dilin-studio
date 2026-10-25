// 部分浏览器：MediaRecorder 录出的 WebM 档头不带时长 ⇒ <audio>/<video>.duration＝Infinity（Chrome／ArkWeb 都这样）
// ⇒ 剪辑页量长度退回 5 秒（实录 12 秒记成 5）。读到 Infinity 时先把播放头拨到极远处，浏览器会扫完整档、把真时长算出来（durationchange），
// 读到后拨回 0。限时内没算出来 ⇒ 回 null，由调用方照旧退回默认。题：vedit-media-duration.browser.test.cjs（真 Chrome 真录一段 WebM）。
export const DURATION_SEEK_TIMEOUT_MS = 4_000

/** 元素已 loadedmetadata：有限正数直接回；Infinity ⇒ 拨远逼出真时长；其余（NaN／0／超时）⇒ null */
export function resolveMediaDuration(el: HTMLMediaElement, timeoutMs = DURATION_SEEK_TIMEOUT_MS): Promise<number | null> {
  const ok = (d: number) => Number.isFinite(d) && d > 0
  if (ok(el.duration)) return Promise.resolve(el.duration)
  if (el.duration !== Infinity) return Promise.resolve(null)
  return new Promise((resolve) => {
    let done = false
    const finish = (v: number | null) => {
      if (done) return
      done = true
      window.clearTimeout(timer)
      el.removeEventListener('durationchange', check)
      el.removeEventListener('timeupdate', check)
      el.removeEventListener('seeked', check)
      try { el.currentTime = 0 } catch { /* 已卸 */ }
      resolve(v)
    }
    const check = () => { if (ok(el.duration)) finish(el.duration) }
    const timer = window.setTimeout(() => finish(null), timeoutMs)
    el.addEventListener('durationchange', check)
    el.addEventListener('timeupdate', check)
    el.addEventListener('seeked', check)
    try { el.currentTime = 1e101 } catch { finish(null) }
  })
}

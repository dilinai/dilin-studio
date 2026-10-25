'use client'
// 网页剪辑页·预览画布从原元素取帧的判据（绿幕浮层起播与拖播放头先闪绿再抠； 预览不一定是播放头那一帧）。
// 调色／抠像、滤镜、特效、运动模糊几张画布都用它：
// ① 影片在跳转（seeking）或还没解出这一帧（readyState<2）⇒ 等：画布保留上一张画好的、原元素照旧藏着（⛔ 露出没抠的原片；⛔ 拿旧帧配新时间画上去之后不再重画）；
// ② 帧的指纹带元素编号——换段换了另一个元素、时间恰好相同也算新的一格。

const ids = new WeakMap<object, number>()
let seq = 0
/** 元素编号（同一个元素一辈子同一个号） */
export function elementId(el: object): number {
  let i = ids.get(el)
  if (i === undefined) { i = ++seq; ids.set(el, i) }
  return i
}

/** 原元素这一刻取不到对的帧（跳转中／还没解出画面／图还没载好）⇒ true＝先等 */
export function framePending(src: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement): boolean {
  if (src instanceof HTMLVideoElement) return src.seeking || src.readyState < 2 || !src.videoWidth
  if (src instanceof HTMLImageElement) return !src.complete || !src.naturalWidth
  return src.dataset.ready !== '1'
}

/** 这一格的指纹：影片＝元素编号＋时间；图＝元素编号＋网址；画布（上游画好的）＝它的帧号 */
export function frameKey(src: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement): string {
  if (src instanceof HTMLVideoElement) return `v${elementId(src)}@${src.currentTime.toFixed(4)}`
  if (src instanceof HTMLImageElement) return `i${elementId(src)}@${src.currentSrc}`
  return `cv${src.dataset.frame}`
}

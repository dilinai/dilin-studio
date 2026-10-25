'use client'
// 网页剪辑页·影音元素对齐播放头。
// 判法（载入中不动·差一点稍快稍慢·差太多才跳）在 _lib/timeline.pure.ts mediaSync；每段片段一个元素·接下来那段先备好由页面照 prerollClips 挂。
import * as T from '../lib/timeline.pure'

/** 影音元素跟着播放头（播放头自己走·元素去对齐它·判法在 T.mediaSync）：换素材换 src（往前多跳一次载入要花的时间）；
 *  停着 ⇒ 精确停在那一帧；播着 ⇒ 载入／跳转中不动它·差一点稍快稍慢追·差太多才跳。rate＝片段变速（追的快慢乘在上面）；
 *  每次跳转花多久记在元素上（dataset.seekCost·下次往前多跳这么多） */
export function syncMediaEl(el: HTMLMediaElement | null, url: string | null, local: number, playing: boolean, rate = 1) {
  if (!el) return
  if (!url) { if (!el.paused) el.pause(); return }
  const now = performance.now()
  if (el.dataset.seekAt && !el.seeking && el.readyState >= 3) { el.dataset.seekCost = String(Math.min(1, (now - Number(el.dataset.seekAt)) / 1000)); delete el.dataset.seekAt }
  const cost = Number(el.dataset.seekCost ?? '0.2') || 0
  const jump = (to: number) => { el.currentTime = to; el.dataset.seekAt = String(now); delete el.dataset.nudge }
  if (el.dataset.src !== url) { el.dataset.src = url; el.src = url; jump(playing ? Math.max(0, local + cost * rate) : local) }
  // 倍速太高 ⇒ 跳格预览（元素停着照播放头跳·不实时解）
  // 倒放（rate<0）、定格（rate=0）也走跳格（元素不能倒着放）
  if (playing && (rate > T.SCRUB_RATE || rate <= 0)) {
    if (!el.paused) el.pause()
    el.dataset.scrub = '1'
    const to = T.scrubSeek({ cur: el.currentTime, target: local, busy: el.seeking || el.readyState < 2, seekCost: cost, rate })
    if (to !== null) jump(to)
    return
  }
  delete el.dataset.scrub
  if (playing) {
    //（Firefox 声音断续）：上一拍的追速记在元素上·判法有回滞·追的途中不每帧改 playbackRate
    const s = T.mediaSync({ cur: el.currentTime, target: local, busy: el.seeking || el.readyState < 3, seekCost: cost * rate, prevNudge: Number(el.dataset.nudge ?? '1') || 1 })
    if (s.seek !== null) jump(s.seek)
    if (s.nudge === 1) delete el.dataset.nudge; else el.dataset.nudge = String(s.nudge)
    const r = T.safeMediaRate(rate * s.nudge) // 超出浏览器倍速范围会抛错整页崩
    if (Math.abs(el.playbackRate - r) > 1e-3) el.playbackRate = r
    if (el.paused) void el.play().catch(() => {})
  } else {
    const r0 = T.safeMediaRate(rate) // 停着时 38 倍原样设进去整页崩·夹进浏览器范围
    if (Math.abs(el.playbackRate - r0) > 1e-6) el.playbackRate = r0
    if (!el.paused) el.pause()
    delete el.dataset.nudge
    if (Math.abs(el.currentTime - local) > 0.001) el.currentTime = local
  }
}


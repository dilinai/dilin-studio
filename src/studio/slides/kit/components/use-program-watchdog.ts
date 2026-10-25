/**
 * 简报程序计时闸·B 层接到「网站页面放 deck 的那扇框」（全屏放映 SlidesPlayer——编辑页与分享页共用、画布小窗 SlidesWindowPlayer）。
 * 宿主给：deck 框、这份放映 html（组装时的框表由它算）、当前页码（翻页 ⇒ 新世代）、重建世代（deck 框换了 ⇒ 新世代）、
 *   这次放映的封锁名单（seals·A／B 两层共用·跨重建保留）、onStuck。
 * 只在浏览器、且 Chrome／Edge 桌面 127 起才启；离线下载的 html 没有宿主＝不启（本 hook 只挂在网站页面）。
 * deck 报上来的 sealed（A 层判导走／hang／guard）⇒ 记进 seals（不重建·deck 里那框已经静态）；看门狗不再盯名单内的框
 *   （⛔ 导走后心跳停了被当卡住、整场重建、提示写成卡住）；之后别的框触发重建时它照样留静态、盖它自己的原因。
 */
import { useEffect, useMemo, useRef } from 'react'
import { deckIframeProgIds } from './program-harden'
import {
  ProgramWatchdog, PROGRAM_WATCH_PING_MS, addProgramSeal, deckWatchTargets, programSealFromDeck, programWatchdogSupported, programWatchNonce,
  type ProgramSeals,
} from './program-watchdog'

export function useProgramWatchdog(o: {
  frame: () => HTMLIFrameElement | null
  html: string
  page: number
  /** deck 框换了（重建、重开放映）就换一个值 */
  generation: number
  active: boolean
  /** 这次放映的封锁名单（宿主那一份·重开放映才清） */
  seals: () => ProgramSeals
  onStuck: (ids: string[]) => void
}): void {
  const map = useMemo(() => (o.html ? deckIframeProgIds(o.html) : []), [o.html])
  const wdRef = useRef<ProgramWatchdog | null>(null)
  const frameRef = useRef(o.frame); frameRef.current = o.frame
  const stuckRef = useRef(o.onStuck); stuckRef.current = o.onStuck
  const sealsRef = useRef(o.seals); sealsRef.current = o.seals
  const hasProg = map.some((x) => x)
  const on = o.active && hasProg && typeof navigator !== 'undefined' && programWatchdogSupported(navigator.userAgent)

  // A 层封下的框（deck 往上报）⇒ 并进封锁名单（不分浏览器：名单只会让框更静态）
  useEffect(() => {
    if (!o.active || !hasProg) return
    const onMsg = (e: MessageEvent) => {
      const s = programSealFromDeck(e.data, e.source, frameRef.current()?.contentWindow, map)
      if (s) addProgramSeal(sealsRef.current(), s.id, s.why)
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [o.active, hasProg, map])

  useEffect(() => {
    if (!on) return
    const wd = new ProgramWatchdog({
      targets: () => deckWatchTargets(frameRef.current()?.contentWindow, map),
      now: () => performance.now(),
      rand: programWatchNonce,
      post: (w, m) => { (w as Window).postMessage(m, '*') },
      onStuck: (ids) => stuckRef.current(ids),
      sealed: (id) => sealsRef.current().has(id),
    })
    wdRef.current = wd
    const iv = window.setInterval(() => wd.tick(), PROGRAM_WATCH_PING_MS)
    const onMsg = (e: MessageEvent) => wd.onMessage(e.source, e.data)
    const vis = () => wd.lifecycle(document.visibilityState === 'visible' ? 'show' : 'hide')
    const hide = () => wd.lifecycle('hide')
    const show = () => wd.lifecycle('show')
    window.addEventListener('message', onMsg)
    document.addEventListener('visibilitychange', vis)
    document.addEventListener('freeze', hide)
    document.addEventListener('resume', show)
    window.addEventListener('pagehide', hide)
    window.addEventListener('pageshow', show)
    return () => {
      window.clearInterval(iv)
      window.removeEventListener('message', onMsg)
      document.removeEventListener('visibilitychange', vis)
      document.removeEventListener('freeze', hide)
      document.removeEventListener('resume', show)
      window.removeEventListener('pagehide', hide)
      window.removeEventListener('pageshow', show)
      wdRef.current = null
    }
  }, [on, map, o.generation])

  // 翻页 ⇒ 程序框重载（WindowProxy 不变但世代换）⇒ 撤旧；旧页的框被执行器重载成静态＝合法不再回 ⇒ reloaded（不留重握手·见 program-watchdog carry）
  useEffect(() => { wdRef.current?.reset({ reloaded: true }) }, [o.page])
}

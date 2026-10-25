'use client'

/**
 * 简报全屏播放
 *   父页点「播放」⇒ start(页号)：本元件根节点 requestFullscreen（点击当下同步叫·浏览器要「使用者手势」）；
 *     浏览器不给全屏（iOS Safari 等）⇒ 退回页内铺满（fixed 盖整页）·其余照常。
 *   画面＝「html」下载同一份（playSlidesHtml·动画照常播）·按 16:9 在黑底里居中铺满；从当前页开始。
 *   键位见 playKeys.ts（↑↓ 换页·←→ 换步·空白键／PageDown 下一步·PageUp 上一步·Home／End）；左键点画面＝下一步（✕ 上除外）。
 *   退出：Esc（浏览器原生退全屏 ⇒ fullscreenchange 同步收起）／鼠标移到顶缘滑下半透明圆 ✕ 点它；离开顶缘 2 秒后 ✕ 滑回去。
 *   画面 iframe 不吃鼠标、不拿焦点（pointer-events:none·tabIndex=-1）⇒ 键盘永远落在父页这一层、按同一套键位走。
 *   退出时回报最后停在第几页（父页据此把编辑画面换到那一页）。
 */

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { fitBox, fullscreenChangeVerdict, playKeyAction, targetPage, type PlayAction } from './playKeys'
import { slideChangeIndex } from './slide-msg'
import { blockProgramFramesHtml } from '../kit/components/program-harden'
import { useProgramWatchdog } from '../kit/components/use-program-watchdog'
import { addProgramSeal, type ProgramSeals } from '../kit/components/program-watchdog'

export type SlidesPlayerHandle = {
  start: (index: number) => void
  /** 放映框本体——父页登记给 useSignedMediaRefresh（过期重签信只回这扇框） */
  frame: () => HTMLIFrameElement | null
}

type Props = {
  /** 播放用的整份 HTML（playSlidesHtml 出的）；没在播时可给空字串 */
  html: string
  count: number
  closeLabel: string
  onExit: (index: number) => void
  testId?: string
}

/** 顶缘多高算「移到上边」：✕ 还没出来时 24px；出来之后把 ✕ 本身那一截（到 72px）也算进去，免得移到钮上它又缩回去 */
const EDGE_PX = 24
const EDGE_WITH_X_PX = 72
const HIDE_AFTER_MS = 2000

const SlidesPlayer = forwardRef<SlidesPlayerHandle, Props>(function SlidesPlayer({ html, count, closeLabel, onExit, testId = 'slides-play' }, ref) {
  const rootRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [open, setOpen] = useState(false)
  const openRef = useRef(false)
  const startRef = useRef(0)
  const idxRef = useRef(0)
  const [idx, setIdx] = useState(0)
  const countRef = useRef(count)
  countRef.current = count
  const onExitRef = useRef(onExit)
  onExitRef.current = onExit
  const fsRef = useRef(false)   // 这一趟真进了浏览器全屏
  const [showX, setShowX] = useState(false)
  const showXRef = useRef(false)
  const hideTimerRef = useRef(0)
  const [box, setBox] = useState({ w: 0, h: 0, left: 0, top: 0 })
  const [epoch, setEpoch] = useState(0)
  // 简报程序计时闸 B 层：某个程序框 3 秒没心跳 ⇒ 记进这次放映的封锁名单、重建放映停在同页、名单内的框静态（Chrome／Edge 桌面才启）
  //   同一份名单也收 A 层（deck 里盯 load／守卫）报上来的导走／停下（不重建）·重建时各框盖各自的原因
  const blockedRef = useRef<ProgramSeals>(new Map())
  const [blockVer, setBlockVer] = useState(0)
  const shownHtml = useMemo(() => (blockedRef.current.size ? blockProgramFramesHtml(html, blockedRef.current) : html), [html, blockVer])

  const setX = useCallback((v: boolean) => { showXRef.current = v; setShowX(v) }, [])
  const clearHide = () => { if (hideTimerRef.current) { window.clearTimeout(hideTimerRef.current); hideTimerRef.current = 0 } }

  const close = useCallback(() => {
    if (!openRef.current) return
    openRef.current = false
    clearHide()
    setX(false)
    setOpen(false)
    const root = rootRef.current
    if (typeof document !== 'undefined' && document.fullscreenElement && document.fullscreenElement === root) {
      document.exitFullscreen?.().catch(() => { /* 已经不在全屏 */ })
    }
    fsRef.current = false
    onExitRef.current(idxRef.current)
  }, [setX])

  useImperativeHandle(ref, () => ({
    frame: () => frameRef.current,
    start(index: number) {
      const root = rootRef.current
      if (!root || openRef.current) return
      const n = countRef.current
      const at = n > 0 ? Math.max(0, Math.min(n - 1, index)) : 0
      startRef.current = at; idxRef.current = at; setIdx(at)
      blockedRef.current = new Map(); setBlockVer((v) => v + 1)
      openRef.current = true
      fsRef.current = false
      root.hidden = false   // 同步先露出来：requestFullscreen 要在这一下点击里叫
      setOpen(true)
      setEpoch((k) => k + 1)
      setX(false)
      ;(document.activeElement as HTMLElement | null)?.blur?.()   // 焦点别留在「播放」钮上（不然空白键＝再按一次钮）
      root.focus({ preventScroll: true })
      if (typeof root.requestFullscreen === 'function') {
        root.requestFullscreen().then(() => { fsRef.current = true }).catch(() => { /* 不给全屏 ⇒ 页内铺满照播 */ })
      }
    },
  }), [setX])

  useProgramWatchdog({
    frame: () => frameRef.current, html: shownHtml, page: idx, generation: epoch, active: open, seals: () => blockedRef.current,
    onStuck: (ids) => {
      for (const id of ids) addProgramSeal(blockedRef.current, id, 'stuck')
      try { console.warn(`[dilinai] program animation stuck (${ids.join(', ')}); rebuilt the slideshow with it static`) } catch { /* */ }
      startRef.current = idxRef.current
      setBlockVer((v) => v + 1)
      setEpoch((k) => k + 1)
    },
  })

  // 浏览器原生退全屏（Esc／F11／系统手势）⇒ 播放一起收
  useEffect(() => {
    const onFs = () => {
      const root = rootRef.current
      if (!root) return
      const v = fullscreenChangeVerdict({ open: openRef.current, entered: fsRef.current, isMine: document.fullscreenElement === root })
      if (v === 'entered') fsRef.current = true
      else if (v === 'close') close()
    }
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [close])

  // 画面框：按 16:9 在根节点里居中
  useEffect(() => {
    if (!open) return
    const root = rootRef.current
    if (!root) return
    const measure = () => setBox(fitBox(root.clientWidth, root.clientHeight))
    measure()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    ro?.observe(root)
    window.addEventListener('resize', measure)
    return () => { ro?.disconnect(); window.removeEventListener('resize', measure) }
  }, [open])

  // 简报本体回报换页
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      // 只认自己那扇简报 iframe·页码要是范围内的整数
      const i = slideChangeIndex(e.data, e.source, frameRef.current?.contentWindow, countRef.current)
      if (i !== null) { idxRef.current = i; setIdx(i) }
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [])

  const act = useCallback((a: PlayAction) => {
    const w = frameRef.current?.contentWindow
    if (!w) return
    const p = targetPage(a, idxRef.current, countRef.current)
    if (p !== null) { if (p !== idxRef.current || a === 'firstPage' || a === 'lastPage') w.postMessage({ type: 'goto', index: p }, '*'); return }
    w.postMessage({ type: a === 'prevStep' ? 'prevStep' : 'nextStep' }, '*')
  }, [])

  // 键盘：挂 window 捕获阶段——先于编辑器那几把（方向键挪元件、Ctrl+Z…）·播放中一律不往下传
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (!openRef.current) return
      e.stopPropagation()
      if (e.key === 'Escape') { e.preventDefault(); close(); return }   // 全屏时浏览器自己先退（走 fullscreenchange）；页内铺满时靠这里
      const a = playKeyAction(e)
      if (!a) return
      e.preventDefault()
      act(a)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, act, close])

  useEffect(() => () => clearHide(), [])

  const onMove = (e: React.MouseEvent) => {
    const zone = showXRef.current ? EDGE_WITH_X_PX : EDGE_PX
    if (e.clientY <= zone) { clearHide(); if (!showXRef.current) setX(true); return }
    if (showXRef.current && !hideTimerRef.current) {
      hideTimerRef.current = window.setTimeout(() => { hideTimerRef.current = 0; setX(false) }, HIDE_AFTER_MS)
    }
  }
  const onLeave = () => {
    if (showXRef.current && !hideTimerRef.current) hideTimerRef.current = window.setTimeout(() => { hideTimerRef.current = 0; setX(false) }, HIDE_AFTER_MS)
  }

  return (
    <div ref={rootRef} hidden={!open} tabIndex={-1}
      className="fixed inset-0 z-[2147483000] outline-none select-none overflow-hidden"
      style={{ width: '100vw', height: '100vh', background: '#000' }}
      data-testid={testId} data-page={idx}
      onMouseMove={onMove} onMouseLeave={onLeave}
      onClick={(e) => { if (e.button === 0) act('nextStep') }}>
      {open && shownHtml && (
        // allow="autoplay"：同页「下一步」播影片（影片步骤）不被浏览器的自动播放规则拦
        <iframe key={epoch} ref={frameRef} srcDoc={shownHtml} sandbox="allow-scripts" allow="autoplay" tabIndex={-1} title="slides"
          className="absolute border-0"
          style={{ left: box.left, top: box.top, width: box.w, height: box.h, pointerEvents: 'none' }}
          onLoad={() => { if (startRef.current > 0) frameRef.current?.contentWindow?.postMessage({ type: 'goto', index: startRef.current }, '*') }}
          data-testid={`${testId}-frame`} />
      )}
      <button type="button" aria-label={closeLabel} title={closeLabel} tabIndex={showX ? 0 : -1}
        data-testid={`${testId}-close`} data-shown={showX ? '1' : '0'}
        onClick={(e) => { e.stopPropagation(); close() }}
        onMouseDown={(e) => e.stopPropagation()}
        className="absolute left-1/2 top-3 w-10 h-10 rounded-full flex items-center justify-center leading-none backdrop-blur-sm transition-[transform,opacity,background-color] duration-300 ease-out hover:!bg-[rgba(60,60,60,0.8)]"
        // 颜色写死在 style：浅色主题会把 text-white／bg-black 这类类名改色（黑边上看不见）；灰底＋白边在黑边与亮色投影片上都看得见
        style={{ transform: `translate(-50%, ${showX ? '0' : '-72px'})`, opacity: showX ? 1 : 0, pointerEvents: showX ? 'auto' : 'none',
          color: '#ffffff', background: 'rgba(64,64,64,0.6)', border: '1px solid rgba(255,255,255,0.55)', boxShadow: '0 2px 10px rgba(0,0,0,0.35)' }}>
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="w-4 h-4" aria-hidden="true">
          <path d="M5 5l10 10M15 5L5 15" />
        </svg>
      </button>
    </div>
  )
})

export default SlidesPlayer

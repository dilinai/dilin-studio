'use client'

/**
 * 通用框层（FrameLayer）：文件／表格／简报共用的框选、移动、缩放、旋转层。
 *
 * 交互源自简报组件画布，抽掉简报专属的部分：只管框、不管内容。
 *   · 点＝选（8 个缩放把手＋1 个旋转把手）；拖＝移动（吸附页面边缘／中线、其他框的边线／中线＋参考线）；把手＝缩放（Shift 锁比例）／旋转（Shift 每 15°）；
 *   · 空白处（或锁住的框上）按住拖＝拉框（相交即选）；点两下、第二下按住拖＝在哪里都拉框；Ctrl／Shift 拉＝加选；Ctrl+点＝加选／减选；
 *   · 多选：整组移动、整组等比缩放（四角把手）、整组绕中心转、整组排层级；
 *   · 方向键 1（Shift 10）·Ctrl+A 全选（隐藏、锁住的不算）·Esc 取消选取／收起右键选单；
 *   · 右键选单：上移一層／下移一層／移到最頂／移到最底（onZMove）＋宿主 extraMenuItems；
 *   · 放开滑鼠才回一批 onFrames（画面先乐观跟手·只送改了的栏）；locked 只能选、不能拖。
 * ⛔ 图层视窗（设计上不做）。内容由宿主画：renderItem（每个框一格）或 renderStage（整层一次画·简报用）。
 * 座标一律是页面逻辑座标（pageWidth×pageHeight·与 Frame 同单位）；屏幕 px＝逻辑 × scale。层次＝items 数组顺序（0 最底）。
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useStudioT } from '../StudioT'
import { editorShell } from '../theme/editor-shell-theme'
import type { Frame, PageSize, ZDir, ZMove } from '../frame-kit/types'
import {
  HANDLES, framePatch, groupBox, groupRotateDelta, handleCursor, handleOnPage, marqueeHits, moveGroup, nudgeGroup, resizeFrame, resizeGroup,
  rotateFrame, rotateGroup, type Guide, type Handle, type IdFrame,
} from '../frame-kit/transform'

export type FrameLayerItem = { id: string; frame: Frame; locked?: boolean; hidden?: boolean }
export type FrameChange = { id: string; frame: Partial<Frame> }
/** 跟手中的框（编号 ⇒ 框）；dup＝Alt+拖复制（原件不动·这些是影子的框） */
export type LiveFrames = { frames: Map<string, Frame>; dup: boolean }
export type FrameLayerMenuItem = { key: string; label: ReactNode; onSelect: () => void }
type Pt = { x: number; y: number }

export type FrameLayerProps<T extends FrameLayerItem> = {
  /** 数组顺序＝叠层（后面盖前面） */
  items: readonly T[]
  /** 页面逻辑尺寸（与 Frame 同单位） */
  pageWidth: number
  pageHeight: number
  /** 屏幕 px ÷ 逻辑单位 */
  scale: number
  /** 每个框里画什么（宿主渲染）·frame＝跟手中的框 */
  renderItem?: (item: T, frame: Frame) => ReactNode
  /** 或整层一次画（宿主自己按 live 套跟手框·简报 ComponentSlideView 用）；给了就不走 renderItem */
  renderStage?: (live: LiveFrames | null) => ReactNode
  /** 选中的（一个＝单选；多个＝多选·多选里没有锁住的） */
  selectedIds: readonly string[]
  onSelect: (ids: string[]) => void
  /** 放开滑鼠／方向键停手：每个动到的只送改了的栏（一次手势＝一批） */
  onFrames: (changes: FrameChange[]) => void
  /** 叠层（单个或整组·右键四项） */
  onZMove: (ids: string[], z: ZMove) => void
  /** 右键选单在四项叠层之后加的项（ids＝这次右键作用的那几个） */
  extraMenuItems?: (ids: string[]) => FrameLayerMenuItem[]
  /** 改四项叠层的字面（缺省＝misc frame_layer_z_*） */
  menuLabels?: Partial<Record<ZDir, string>>
  /** 旋转把手提示（缺省＝misc frame_layer_rotate_hint） */
  rotateHint?: string
  /** 双击单个框（多选时、刚拖过不算） */
  onItemDoubleClick?: (id: string) => void
  /** Alt+拖放开：这几个在新位置各新增一份（原件不动）·没给＝Alt+拖照常移动 */
  onDuplicate?: (moved: Map<string, Frame>) => void
  /** 点选区：box＝整个框；edge＝只有边线那一圈点得到（空心形状·中间透过去点底下的） */
  hitMode?: (item: T) => 'box' | 'edge'
  /** 这一下按键接不接（缺省：不在输入框／富文字、没有弹窗、焦点在框层里或页面本身） */
  isShortcutTarget?: (target: EventTarget | null) => boolean
  /** 拖东西进来（云盘档／本机档）：放下的动作交给宿主 */
  drop?: { canDrop: (dt: DataTransfer | null) => boolean; onDrop: (dt: DataTransfer, at: Pt) => void; hint?: ReactNode }
  /** data-testid 前缀（缺省 fl·简报 slc） */
  testIdPrefix?: string
  /**
   * 空白处不接滑鼠（云文档：浮在正文上面的那层·没点到组件的地方要让给底下的正文打字）：
   *   整层 pointer-events:none，只有组件的点选区、把手、右键选单接滑鼠；空白处拉框／点空白取消选取因此不在这层发生（宿主自己清选取）。
   *   缺省 false＝原样（简报）。
   */
  passThrough?: boolean
}

type Drag =
  | { mode: 'move'; items: IdFrame[]; px: number; py: number; moved: boolean; copy: boolean; clickId?: string }
  | { mode: 'resize'; items: IdFrame[]; box: Frame; px: number; py: number; handle: Handle; moved: boolean }
  | { mode: 'rotate'; items: IdFrame[]; center: Pt; from: Pt; moved: boolean }
  | { mode: 'marquee'; start: Pt; cur: Pt; moved: boolean; base: string[]; clickId?: string }

const HANDLE_PX = 9
/** 旋转把手中心离框上缘（屏幕 px） */
const ROTATE_GAP_PX = 20
const SNAP_PX = 6
/** 「点两下、第二下按住拖」：两下间隔与距离 */
const DOUBLE_MS = 450
const DOUBLE_PX = 8
export const FRAME_LAYER_DUP_PREFIX = '__dup__'
export const Z_MENU: readonly (readonly [ZDir, 'frame_layer_z_up' | 'frame_layer_z_down' | 'frame_layer_z_top' | 'frame_layer_z_bottom'])[] = [
  ['up', 'frame_layer_z_up'], ['down', 'frame_layer_z_down'], ['top', 'frame_layer_z_top'], ['bottom', 'frame_layer_z_bottom'],
]

/** Ctrl（Mac＝⌘）按着吗 */
const modKey = (e: { ctrlKey: boolean; metaKey: boolean }) => e.ctrlKey || e.metaKey

function isEditable(el: EventTarget | null): boolean {
  if (!el || typeof (el as Element).closest !== 'function') return false
  const e = el as HTMLElement
  const tag = e.tagName?.toLowerCase()
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true
  if (e.isContentEditable) return true
  return !!e.closest('[contenteditable=""],[contenteditable="true"],[contenteditable="plaintext-only"]')
}

export default function FrameLayer<T extends FrameLayerItem>(props: FrameLayerProps<T>) {
  const t = useStudioT()
  const { items, selectedIds, onSelect, onFrames, scale, pageWidth, pageHeight } = props
  const P = props.testIdPrefix ?? 'fl'
  const page: PageSize = useMemo(() => ({ w: pageWidth, h: pageHeight }), [pageWidth, pageHeight])
  const width = pageWidth * scale
  const height = pageHeight * scale
  const rootRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<Drag | null>(null)
  // 跟手的框；同步记一份 ref：pointerup 可能早于最后一拍 pointermove 的重渲
  const [live, setLiveState] = useState<LiveFrames | null>(null)
  const liveRef = useRef<LiveFrames | null>(null)
  const setLive = useCallback((v: LiveFrames | null) => { liveRef.current = v; setLiveState(v) }, [])
  const [guides, setGuides] = useState<Guide[]>([])
  const [marquee, setMarquee] = useState<{ a: Pt; b: Pt } | null>(null)
  const [groupSpin, setGroupSpin] = useState<{ box: Frame; deg: number } | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; ids: string[] } | null>(null)
  // 组件靠近画面下缘时选单往下开出画面外 ⇒ 挂上那一刻量高度·下缘超出就往上翻（再不够就贴顶）
  const placeMenu = useCallback((el: HTMLDivElement | null) => {
    if (!el || typeof window === 'undefined') return
    const y = Number(el.dataset.y)
    if (Number.isFinite(y)) el.style.top = `${menuTopFor(y, el.offsetHeight, window.innerHeight)}px`
  }, [])
  const [dropHover, setDropHover] = useState(false)
  const nudgeRef = useRef<{ key: string; starts: IdFrame[]; cur: IdFrame[]; timer: number } | null>(null)
  const lastDownRef = useRef<{ t: number; x: number; y: number } | null>(null)
  /** 按下（第一下）那一刻是不是多选：双击的第一下会把多选收成单选·双击判定要看按下前的状态 */
  const wasMultiRef = useRef(false)
  const justDraggedRef = useRef(0)

  const selSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const multi = selectedIds.length > 1

  // 画面上的框：跟手的换成跟手框（复制拖动时原件不动）
  const moved = useMemo(() => (live && !live.dup ? items.map((c) => (live.frames.has(c.id) ? ({ ...c, frame: live.frames.get(c.id)! } as T) : c)) : items), [items, live])
  const selectedItems = useMemo(() => moved.filter((c) => selSet.has(c.id) && !c.hidden), [moved, selSet])
  const single = !multi && selectedItems.length === 1 ? selectedItems[0] : null

  // 选中的框没了（被删／换页）⇒ 清掉跟手态
  useEffect(() => {
    if (live && !live.dup && [...live.frames.keys()].some((id) => !items.some((c) => c.id === id))) setLive(null)
  }, [items, live, setLive])

  const toCanvas = useCallback((clientX: number, clientY: number) => {
    const r = rootRef.current?.getBoundingClientRect()
    if (!r) return { x: 0, y: 0 }
    return { x: (clientX - r.left) / scale, y: (clientY - r.top) / scale }
  }, [scale])

  const others = useCallback((ids: ReadonlySet<string>) => items.filter((c) => !ids.has(c.id) && !c.hidden).map((c) => c.frame), [items])
  /** 能一起动的（没锁·没藏） */
  const movable = useCallback((ids: Iterable<string>) => {
    const s = new Set(ids)
    return items.filter((c) => s.has(c.id) && !c.locked && !c.hidden).map((c) => ({ id: c.id, frame: c.frame }))
  }, [items])

  const endDrag = useCallback(() => {
    const d = dragRef.current
    dragRef.current = null
    setGuides([])
    setGroupSpin(null)
    if (!d) return
    if (d.mode === 'marquee') {
      setMarquee(null)
      if (d.moved) {
        justDraggedRef.current = Date.now()
        const hits = marqueeHits(d.start, d.cur, items)
        onSelect(d.base.length ? [...new Set([...d.base, ...hits])] : hits)
      } else if (d.clickId) onSelect([d.clickId])
      else if (!d.base.length) { setMenu(null); onSelect([]) }
      return
    }
    const l = liveRef.current
    if (d.moved && l) {
      justDraggedRef.current = Date.now()
      if (d.mode === 'move' && d.copy) {
        props.onDuplicate?.(new Map(l.frames))
      } else {
        const changes: FrameChange[] = []
        for (const it of d.items) {
          const cur = l.frames.get(it.id)
          const patch = cur ? framePatch(it.frame, cur) : null
          if (patch) changes.push({ id: it.id, frame: patch })
        }
        if (changes.length) onFrames(changes)
      }
    } else if (d.mode === 'move' && !d.moved && d.clickId) {
      // 多选里点一下（没拖）＝只选它
      onSelect([d.clickId])
    }
    // 宿主在 onFrames 里同步套上乐观更新 ⇒ 这里清掉跟手框不会跳回原位
    setLive(null)
  }, [items, onFrames, onSelect, props, setLive])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d) return
    const p = toCanvas(e.clientX, e.clientY)
    if (d.mode === 'marquee') {
      if (!d.moved && Math.hypot((p.x - d.start.x) * scale, (p.y - d.start.y) * scale) < 3) return
      d.moved = true
      d.cur = p
      setMarquee({ a: d.start, b: p })
      return
    }
    if (d.mode === 'move') {
      const dx = p.x - d.px, dy = p.y - d.py
      if (!d.moved && Math.hypot(dx * scale, dy * scale) < 3) return
      d.moved = true
      const ids = new Set(d.items.map((i) => i.id))
      const r = moveGroup(page, d.items, dx, dy, d.copy ? items.filter((c) => !c.hidden).map((c) => c.frame) : others(ids), SNAP_PX / scale, true)
      setLive({ frames: new Map(r.items.map((i) => [i.id, i.frame])), dup: d.copy })
      setGuides(r.guides)
    } else if (d.mode === 'resize') {
      d.moved = true
      const next = d.items.length === 1
        ? [{ id: d.items[0].id, frame: resizeFrame(d.items[0].frame, d.handle, p.x - d.px, p.y - d.py, { keepRatio: e.shiftKey }) }]
        : resizeGroup(d.items, d.box, d.handle, p.x - d.px, p.y - d.py)
      setLive({ frames: new Map(next.map((i) => [i.id, i.frame])), dup: false })
    } else {
      d.moved = true
      if (d.items.length === 1) {
        setLive({ frames: new Map([[d.items[0].id, rotateFrame(d.items[0].frame, p, { step: e.shiftKey ? 15 : 0 })]]), dup: false })
      } else {
        const deg = groupRotateDelta(d.center, d.from, p, e.shiftKey ? 15 : 0)
        setLive({ frames: new Map(rotateGroup(d.items, d.center, deg).map((i) => [i.id, i.frame])), dup: false })
        setGroupSpin((g) => (g ? { ...g, deg } : g))
      }
    }
  }, [toCanvas, scale, others, items, setLive, page])

  const capture = (e: React.PointerEvent) => {
    // 抓在按下的那块（点选区／把手／空白层）上·不抓在根上：抓在根上 ⇒ 放开落在根 ⇒ click／dblclick 的目标变成根，
    // 框上的双击永远收不到。那块在框层里 ⇒ 移动事件照样冒泡到根的 onPointerMove／onPointerUp。
    try { (e.currentTarget as Element).setPointerCapture(e.pointerId) } catch { /* 个别环境不给抓 */ }
  }

  /** 这一下是不是「点两下的第二下」（触控板轻点两下、第二下按住拖＝拉框） */
  const isSecondPress = (e: React.PointerEvent) => {
    const now = Date.now()
    const prev = lastDownRef.current
    lastDownRef.current = { t: now, x: e.clientX, y: e.clientY }
    return !!prev && now - prev.t <= DOUBLE_MS && Math.hypot(e.clientX - prev.x, e.clientY - prev.y) <= DOUBLE_PX
  }

  const startMarquee = (e: React.PointerEvent, clickId?: string) => {
    const p = toCanvas(e.clientX, e.clientY)
    const additive = modKey(e) || e.shiftKey
    dragRef.current = { mode: 'marquee', start: p, cur: p, moved: false, base: additive ? [...selectedIds].filter((id) => movable([id]).length) : [], clickId }
    capture(e)
  }

  const copyOn = (e: React.PointerEvent) => e.altKey && !!props.onDuplicate

  const onItemDown = (e: React.PointerEvent, c: T) => {
    if (e.button !== 0) return
    e.stopPropagation()
    setMenu(null)
    rootRef.current?.focus({ preventScroll: true })
    const second = isSecondPress(e)
    // 第二下（点两下）：按住拖＝拉框；没拖＝选它（接着的 dblclick 照旧）
    if (second) { startMarquee(e, c.id); return }
    wasMultiRef.current = multi
    const p = toCanvas(e.clientX, e.clientY)
    if (modKey(e)) {
      // Ctrl+点＝加选／减选（锁住的不进多选）
      if (c.locked) { if (!selectedIds.length) onSelect([c.id]); return }
      const base = selectedIds.filter((id) => movable([id]).length)
      const has = base.includes(c.id)
      const next = has ? base.filter((id) => id !== c.id) : [...base, c.id]
      onSelect(next)
      if (!has) { dragRef.current = { mode: 'move', items: movable(next), px: p.x, py: p.y, moved: false, copy: copyOn(e) }; capture(e) }
      return
    }
    if (c.locked) { startMarquee(e, c.id); return }   // 锁住的（多半是整页底图）上按住拖＝拉框；只点一下＝选它
    const inGroup = multi && selSet.has(c.id)
    const ids = inGroup ? selectedIds : [c.id]
    if (!inGroup) onSelect([c.id])
    dragRef.current = { mode: 'move', items: movable(ids), px: p.x, py: p.y, moved: false, copy: copyOn(e), ...(inGroup ? { clickId: c.id } : {}) }
    capture(e)
  }

  // 方向键／Ctrl+A／Esc：挂在 window（焦点在宿主旁边的清单、按钮上也响；在输入框、富文字框、弹窗里不接）
  const defaultShortcutTarget = (target: EventTarget | null): boolean => {
    if (typeof document === 'undefined' || isEditable(target)) return false
    if (document.querySelector('[aria-modal="true"]')) return false
    const el = target as Element | null
    if (!el || el === document.body || el === document.documentElement || (el as unknown) === document) return true
    if (typeof el.closest !== 'function' || el.closest('[role="dialog"],[role="alertdialog"]')) return false
    return !!rootRef.current && rootRef.current.contains(el)
  }
  const keyStateRef = useRef({ selectedIds, items, onSelect, onFrames, setLive, menu, accept: props.isShortcutTarget ?? defaultShortcutTarget })
  keyStateRef.current = { selectedIds, items, onSelect, onFrames, setLive, menu, accept: props.isShortcutTarget ?? defaultShortcutTarget }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = keyStateRef.current
      if (e.defaultPrevented || !s.accept(e.target)) return
      if (e.key === 'Escape') {
        if (s.menu) { setMenu(null); return }
        if (s.selectedIds.length) s.onSelect([])
        return
      }
      if (modKey(e) && !e.altKey && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault()
        s.onSelect(s.items.filter((c) => !c.hidden && !c.locked).map((c) => c.id))
        return
      }
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
      if (modKey(e) || e.altKey) return
      const sel = new Set(s.selectedIds)
      const its = s.items.filter((c) => sel.has(c.id) && !c.locked && !c.hidden).map((c) => ({ id: c.id, frame: c.frame }))
      if (!its.length) return
      e.preventDefault()
      const key = [...sel].sort().join('|')
      let n = nudgeRef.current
      if (!n || n.key !== key) {
        if (n) { window.clearTimeout(n.timer); commitNudge(n) }
        n = nudgeRef.current = { key, starts: its, cur: its, timer: 0 }
      }
      if (n.timer) window.clearTimeout(n.timer)
      n.cur = nudgeGroup(n.cur, e.key, e.shiftKey)
      s.setLive({ frames: new Map(n.cur.map((i) => [i.id, i.frame])), dup: false })
      // 乐观跟手·停手 350ms 才送一批
      n.timer = window.setTimeout(() => { const cur = nudgeRef.current; nudgeRef.current = null; if (cur) commitNudge(cur) }, 350)
    }
    const commitNudge = (n: { starts: IdFrame[]; cur: IdFrame[] }) => {
      const s = keyStateRef.current
      const changes: FrameChange[] = []
      n.starts.forEach((st, i) => { const patch = framePatch(st.frame, n.cur[i].frame); if (patch) changes.push({ id: st.id, frame: patch }) })
      if (changes.length) s.onFrames(changes)
      s.setLive(null)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      const n = nudgeRef.current
      if (n) { window.clearTimeout(n.timer); nudgeRef.current = null; commitNudge(n) }   // 换页／卸载前把停手前那几下送出去
    }
  }, [])

  // 右键选单：点外面／滚动收起
  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    window.addEventListener('pointerdown', close)
    window.addEventListener('scroll', close, true)
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('scroll', close, true) }
  }, [menu])

  const canDrop = (dt: DataTransfer | null) => !!props.drop && props.drop.canDrop(dt)

  // 整组的框（多选）：转的时候画按下那一刻的框转过的样子
  const gbox = multi && selectedItems.length > 1 ? groupBox(selectedItems.map((c) => c.frame)) : null

  const handleEls = (box: Frame, hs: readonly Handle[], onDown: (e: React.PointerEvent, h: Handle) => void, onRotate: (e: React.PointerEvent) => void, testPrefix: string) => (<>
    {hs.map((h) => {
      const lx = h.includes('w') ? 0 : h.includes('e') ? 100 : 50
      const ly = h.includes('n') ? 0 : h.includes('s') ? 100 : 50
      const on = handleOnPage(page, box, h, ROTATE_GAP_PX / scale)
      return (
        <div key={h} data-testid={`${testPrefix}-${h}`} data-off={on ? undefined : '1'}
          style={{
            position: 'absolute', left: `calc(${lx}% - ${HANDLE_PX / 2}px)`, top: `calc(${ly}% - ${HANDLE_PX / 2}px)`,
            width: HANDLE_PX, height: HANDLE_PX, background: '#fff', border: '1.5px solid #2563eb', borderRadius: 2,
            cursor: handleCursor(h, box.rotate), pointerEvents: on ? 'auto' : 'none', opacity: on ? 1 : 0.35,
          }}
          onPointerDown={(e) => { if (e.button !== 0) return; e.stopPropagation(); onDown(e, h) }} />
      )
    })}
    {(() => { const on = handleOnPage(page, box, 'rotate', ROTATE_GAP_PX / scale); return (
      <div data-testid={`${testPrefix}-rotate`} title={props.rotateHint ?? t('frame_layer_rotate_hint')} data-off={on ? undefined : '1'}
        style={{ position: 'absolute', left: `calc(50% - 6px)`, top: -(ROTATE_GAP_PX + 6), width: 12, height: 12, borderRadius: 6, background: '#fff', border: '1.5px solid #2563eb', cursor: 'grab', pointerEvents: on ? 'auto' : 'none', opacity: on ? 1 : 0.35 }}
        onPointerDown={(e) => { if (e.button !== 0) return; e.stopPropagation(); onRotate(e) }} />) })()}
    <div style={{ position: 'absolute', left: '50%', top: -14, width: 1, height: 14, background: '#2563eb' }} />
  </>)

  const boxStyle = (f: Frame): React.CSSProperties => ({
    position: 'absolute', left: f.x * scale, top: f.y * scale, width: f.w * scale, height: f.h * scale,
    transform: f.rotate ? `rotate(${f.rotate}deg)` : undefined,
  })

  const extras = menu && props.extraMenuItems ? props.extraMenuItems(menu.ids) : []

  return (
    <div
      ref={rootRef}
      tabIndex={0}
      data-testid={`${P}-canvas`}
      data-selected={selectedIds.join(',')}
      className="relative outline-none select-none"
      style={{ width, height, ...(props.passThrough ? { pointerEvents: 'none' as const } : {}) }}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDragOver={(e) => { if (canDrop(e.dataTransfer)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDropHover(true) } }}
      onDragLeave={() => setDropHover(false)}
      onDrop={(e) => {
        setDropHover(false)
        if (!canDrop(e.dataTransfer)) return
        e.preventDefault()
        props.drop!.onDrop(e.dataTransfer, toCanvas(e.clientX, e.clientY))
      }}
    >
      {/* 内容：宿主画（整层 renderStage，或每个框 renderItem·Alt+拖时多叠半透明影子） */}
      <div className="absolute inset-0" style={{ overflow: 'clip' }} data-testid={`${P}-stage`}>
        {props.renderStage ? props.renderStage(live) : props.renderItem ? (<>
          {moved.filter((c) => !c.hidden).map((c) => (
            <div key={c.id} data-testid={`${P}-item`} data-cid={c.id} style={boxStyle(c.frame)}>{props.renderItem!(c, c.frame)}</div>
          ))}
          {live?.dup && items.filter((c) => live.frames.has(c.id)).map((c) => (
            <div key={`${FRAME_LAYER_DUP_PREFIX}${c.id}`} data-testid={`${P}-ghost`} data-cid={c.id} style={{ ...boxStyle(live.frames.get(c.id)!), opacity: 0.6 }}>{props.renderItem!(c, live.frames.get(c.id)!)}</div>
          ))}
        </>) : null}
      </div>

      {/* 点选层：每个没隐藏的框一块透明区（数组顺序＝叠层·后面的盖前面的＝点到最上面那个）
          裁在页面范围内：伸出页面的那段不能盖住页面外的清单／顶栏去抢点击（选中框与把手不裁·照样画在外面）
          用 overflow:clip 不用 hidden：hidden 会让这层变成可捲动的容器·任何 scrollIntoView 都会把点选区整层捲歪（与画面错位）
          空白处按住拖＝拉框（放开没拖＝取消选取） */}
      <div className="absolute inset-0" style={{ overflow: 'clip' }} data-testid={`${P}-hit-layer`}
        onPointerDown={(e) => {
          if (e.target !== e.currentTarget || e.button !== 0) return
          setMenu(null)
          rootRef.current?.focus({ preventScroll: true })
          isSecondPress(e)
          startMarquee(e)
        }}>
        {moved.filter((c) => !c.hidden).map((c) => {
          const handlers = {
            onPointerDown: (e: React.PointerEvent) => onItemDown(e, c),
            onDoubleClick: (e: React.MouseEvent) => {
              e.stopPropagation()
              // 多选时不算；刚拖过（含点两下拉框）不算双击
              if (multi || wasMultiRef.current || Date.now() - justDraggedRef.current < 400) return
              props.onItemDoubleClick?.(c.id)
            },
            onContextMenu: (e: React.MouseEvent) => {
              e.preventDefault(); e.stopPropagation()
              const inGroup = multi && selSet.has(c.id)
              if (!inGroup) onSelect([c.id])
              setMenu({ x: e.clientX, y: e.clientY, ids: inGroup ? [...selectedIds] : [c.id] })
            },
          }
          // 空心（edge）只有边线那一圈点得到——中间透过去点底下的（同 PowerPoint）
          const hollow = props.hitMode?.(c) === 'edge'
          const edge = 8
          return (
            <div key={c.id} data-testid={`${P}-hit`} data-cid={c.id} {...(hollow ? {} : handlers)}
              style={{
                ...boxStyle({ ...c.frame, w: Math.max(4 / scale, c.frame.w), h: Math.max(4 / scale, c.frame.h) }),
                cursor: c.locked ? 'default' : 'move',
                ...(hollow ? { pointerEvents: 'none' as const } : props.passThrough ? { pointerEvents: 'auto' as const } : {}),
              }}>
              {hollow && ([
                { left: -edge / 2, top: -edge / 2, right: -edge / 2, height: edge },
                { left: -edge / 2, bottom: -edge / 2, right: -edge / 2, height: edge },
                { left: -edge / 2, top: -edge / 2, bottom: -edge / 2, width: edge },
                { right: -edge / 2, top: -edge / 2, bottom: -edge / 2, width: edge },
              ] as React.CSSProperties[]).map((st, i) => (
                <div key={i} data-testid={`${P}-hit-edge`} {...handlers} style={{ position: 'absolute', ...st, pointerEvents: 'auto', cursor: c.locked ? 'default' : 'move' }} />
              ))}
            </div>
          )
        })}
      </div>

      {/* 单选：选中框＋把手（锁住的只出框·不出把手）。框与把手不裁；落在页面外的把手变淡且不接滑鼠 */}
      {single && (
        <div data-testid={`${P}-selection`} data-cid={single.id} data-locked={single.locked ? '1' : undefined}
          style={{ ...boxStyle(single.frame), outline: `1.5px ${single.locked ? 'dashed' : 'solid'} #2563eb`, pointerEvents: 'none' }}>
          {!single.locked && handleEls(single.frame, HANDLES,
            (e, h) => { const p = toCanvas(e.clientX, e.clientY); dragRef.current = { mode: 'resize', items: [{ id: single.id, frame: single.frame }], box: single.frame, px: p.x, py: p.y, handle: h, moved: false }; capture(e) },
            (e) => { const f = single.frame; dragRef.current = { mode: 'rotate', items: [{ id: single.id, frame: f }], center: { x: f.x + f.w / 2, y: f.y + f.h / 2 }, from: toCanvas(e.clientX, e.clientY), moved: false }; capture(e) },
            `${P}-handle`)}
        </div>
      )}

      {/* 多选：每个成员一圈细框＋整组的框（四角把手＝整组等比缩放·旋转把手＝整组绕中心转） */}
      {multi && selectedItems.map((c) => (
        <div key={c.id} data-testid={`${P}-multi-member`} data-cid={c.id} style={{ ...boxStyle(c.frame), outline: '1px solid #60a5fa', pointerEvents: 'none' }} />
      ))}
      {gbox && (() => {
        const shownBox = groupSpin ? { ...groupSpin.box, rotate: groupSpin.deg } : gbox
        return (
          <div data-testid={`${P}-group`} data-n={selectedItems.length} style={{ ...boxStyle(shownBox), outline: '1.5px dashed #2563eb', pointerEvents: 'none' }}>
            {handleEls(shownBox, ['nw', 'ne', 'se', 'sw'],
              (e, h) => { const p = toCanvas(e.clientX, e.clientY); dragRef.current = { mode: 'resize', items: movable(selectedIds), box: gbox, px: p.x, py: p.y, handle: h, moved: false }; capture(e) },
              (e) => { dragRef.current = { mode: 'rotate', items: movable(selectedIds), center: { x: gbox.x + gbox.w / 2, y: gbox.y + gbox.h / 2 }, from: toCanvas(e.clientX, e.clientY), moved: false }; setGroupSpin({ box: gbox, deg: 0 }); capture(e) },
              `${P}-group-handle`)}
          </div>
        )
      })()}

      {/* 拉框 */}
      {marquee && (
        <div data-testid={`${P}-marquee`} style={{
          position: 'absolute', left: Math.min(marquee.a.x, marquee.b.x) * scale, top: Math.min(marquee.a.y, marquee.b.y) * scale,
          width: Math.abs(marquee.b.x - marquee.a.x) * scale, height: Math.abs(marquee.b.y - marquee.a.y) * scale,
          border: '1px solid #2563eb', background: 'rgba(37,99,235,0.08)', pointerEvents: 'none',
        }} />
      )}

      {/* 参考线 */}
      {guides.map((g, i) => (
        <div key={i} data-testid={`${P}-guide`} style={g.axis === 'x'
          ? { position: 'absolute', left: g.at * scale, top: g.from * scale, width: 1, height: (g.to - g.from) * scale, background: '#ec4899', pointerEvents: 'none' }
          : { position: 'absolute', top: g.at * scale, left: g.from * scale, height: 1, width: (g.to - g.from) * scale, background: '#ec4899', pointerEvents: 'none' }} />
      ))}

      {dropHover && props.drop?.hint != null && (
        <div className="absolute inset-0 border-2 border-dashed border-blue-500 bg-blue-500/10 flex items-center justify-center text-sm text-blue-700 pointer-events-none" data-testid={`${P}-drop-hint`}>
          {props.drop.hint}
        </div>
      )}

      {/* 右键选单：四项叠层＋宿主加的项 */}
      {menu && (
        <div key={`${menu.x},${menu.y}`} ref={placeMenu} data-y={menu.y} className={`fixed z-50 ${editorShell.menu} w-40`} data-testid={`${P}-context-menu`}
          style={{ left: Math.min(menu.x, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 170), top: menu.y, pointerEvents: 'auto' }}
          onPointerDown={(e) => e.stopPropagation()}>
          {Z_MENU.map(([z, key]) => (
            <button key={z} type="button" className={editorShell.menuItem} data-testid={`${P}-menu-z-${z}`}
              onClick={() => { setMenu(null); props.onZMove(menu.ids, z) }}>{props.menuLabels?.[z] ?? t(key)}</button>
          ))}
          {extras.length > 0 && (<>
            <div className={`my-1 border-t ${editorShell.divider}`} />
            {extras.map((m) => (
              <button key={m.key} type="button" className={editorShell.menuItem} data-testid={`${P}-menu-${m.key}`}
                onClick={() => { setMenu(null); m.onSelect() }}>{m.label}</button>
            ))}
          </>)}
        </div>
      )}
    </div>
  )
}

/** 右键选单的 top：放得下就在点下那里；下缘超出画面 ⇒ 往上翻（选单底边对齐点下那里）；还是不够 ⇒ 贴顶留 4px */
export function menuTopFor(y: number, menuH: number, viewH: number): number {
  const pad = 4
  if (y + menuH <= viewH - pad) return y
  return Math.max(pad, Math.min(y - menuH, viewH - pad - menuH))
}

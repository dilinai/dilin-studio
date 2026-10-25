// 组件版 pptx 导出 · 动画 ⇒ PowerPoint 原生动画（<p:timing>）
//
//   纯字串函数（单测直接喂资料）·客户端安全。输入是「已排好的时间线」：
//     TimelineItem＝一条页动画（或程序的一步）：trigger click／with／after＋delayMs＋若干效果节点（同一个组合的子件、程序一步里的几个动作）；
//     bookmark＝改成「影片播到书签时」触发（On Bookmark·放进独立的触发序列·不在主序列）。
//   排法与放映同一套（slide-kit/components/anim planPageAnimations）：
//     单击＝开新一组；与上一项同时＝从上一项的开始算；上一项之后＝从上一项的结束（开始＋延迟＋时长）算；第一项不是单击＝进页自动播。
//   PowerPoint 结构：tmRoot ⊃ mainSeq ⊃ 每次单击一个 par ⊃ 每段「之后」一个 par（delay＝段起点）⊃ 每个效果一个 par（presetID／presetClass／nodeType）。
//   影片：mediacall（playFrom(秒)／togglePause／stop）＋每支影片一个 <p:video> 节点；点影片本身＝暂停／继续（PowerPoint 插影片的预设）。
//   有书签触发 ⇒ 整个 <p:timing> 包进 mc:AlternateContent（Choice p14＝含 p14:bmkTgt；Fallback＝拿掉书签那几段）·与 PowerPoint 自己写的同形。

export type Dir = 'left' | 'right' | 'up' | 'down'

/** 一个效果（时长一律毫秒） */
export type Fx =
  | { cls: 'entr' | 'exit'; effect: string; dir?: Dir; dur: number }
  | { cls: 'emph'; effect: 'pulse' | 'teeter' | 'grow'; dur: number }
  | { cls: 'emph'; effect: 'scale'; by: number; dur: number }
  | { cls: 'emph'; effect: 'rotate'; deg: number; dur: number }
  /** 动作路径：相对起点的点列（投影片宽高的比例·含终点） */
  | { cls: 'path'; pts: Array<[number, number]>; dur: number }
  /** 影片命令：play＝playFrom(fromSec)·pause＝togglePause·stop；dur＝播放命令占的时长（影片长度·「之后」从它播完算） */
  | { cls: 'media'; cmd: 'play' | 'pause' | 'stop'; fromSec?: number; dur: number }

/**
 * target＝PowerPoint 物件名称（objectName）；offsetMs＝在这一条里的相对起点（程序一步里排在后面的动作）；
 * lenMs＝排「上一项之后」时这个效果算多长（不给＝效果时长）·影片步骤照放映给 0（放映里影片步骤不占时间·下一项「之后」立刻接）
 */
export type FxNode = { target: string; fx: Fx; offsetMs?: number; lenMs?: number; fallbackOnly?: boolean }
export type TimelineItem = {
  trigger: 'click' | 'with' | 'after'
  delayMs: number
  nodes: FxNode[]
  /** 给了＝影片（物件名 media）播到书签 name 时触发（trigger 当成这一段里的排法） */
  bookmark?: { media: string; name: string }
}
/** 投影片上的一支嵌入影片（物件名）：loop＝循环·muted＝静音·toggleOnClick＝点影片本身暂停／继续 */
export type SlideMediaSpec = { name: string; loop?: boolean; muted?: boolean; toggleOnClick?: boolean }

/** 物件编号与种类（sp＝形状／文字·pic＝图片／影片·graphicFrame＝表格／图表） */
export type ShapeRef = { spid: number; kind: 'sp' | 'pic' | 'graphicFrame' | 'other' }

export type TimingStats = { effects: number; missing: number; bookmarkTriggers: number }

const P14 = 'http://schemas.microsoft.com/office/powerpoint/2010/main'
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006'

/** 方向 ⇒ PowerPoint presetSubtype（1 上·2 右·4 下·8 左） */
const SUB: Record<Dir, number> = { up: 1, right: 2, down: 4, left: 8 }
/** 擦除：从哪边开始 ⇒ filter（filter 写的是起始那一边：自下＝wipe(down)·LibreOffice 读写 pptx 的对照表：wipe(down)＝由下往上） */
const WIPE_FILTER: Record<Dir, string> = { down: 'down', up: 'up', left: 'left', right: 'right' }
/** 飞入／飞出在投影片外的那一端 */
const OFF: Record<Dir, { x?: string; y?: string }> = {
  left: { x: '0-#ppt_w/2' }, right: { x: '1+#ppt_w/2' }, up: { y: '0-#ppt_h/2' }, down: { y: '1+#ppt_h/2' },
}

const ms = (n: number) => Math.max(1, Math.round(Number.isFinite(n) ? n : 1))
const f4 = (n: number) => String(Math.round(n * 10000) / 10000)
export const escAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** 一个效果的时长（排「之后」用） */
export function fxLength(fx: Fx): number {
  return Math.max(0, Number.isFinite(fx.dur) ? fx.dur : 0)
}

/** 基础动画效果 ⇒ PowerPoint 预设（presetID／subtype）·没对上的退回淡化 */
export function presetOf(fx: Fx): { cls: string; id: number; sub: number } {
  switch (fx.cls) {
    case 'entr':
    case 'exit': {
      const dir = fx.dir ?? (fx.effect === 'wipe' ? 'left' : 'down')
      switch (fx.effect) {
        case 'appear': case 'disappear': return { cls: fx.cls, id: 1, sub: 0 }
        case 'fly': return { cls: fx.cls, id: 2, sub: SUB[dir] }
        case 'wipe': return { cls: fx.cls, id: 22, sub: SUB[dir] }
        case 'float': return { cls: fx.cls, id: 42, sub: 0 }
        case 'zoom': return { cls: fx.cls, id: 53, sub: 16 }
        case 'spin': return { cls: fx.cls, id: 31, sub: 0 }
        case 'bounce': return { cls: fx.cls, id: 26, sub: 0 }
        default: return { cls: fx.cls, id: 10, sub: 0 }   // fade
      }
    }
    case 'emph':
      switch (fx.effect) {
        case 'pulse': return { cls: 'emph', id: 26, sub: 0 }
        case 'teeter': return { cls: 'emph', id: 32, sub: 0 }
        case 'rotate': return { cls: 'emph', id: 8, sub: 0 }
        default: return { cls: 'emph', id: 6, sub: 0 }    // grow／scale＝放大／缩小
      }
    case 'path': return { cls: 'path', id: 0, sub: 0 }
    case 'media': return { cls: 'mediacall', id: fx.cmd === 'play' ? 1 : fx.cmd === 'pause' ? 2 : 3, sub: 0 }
  }
}

/**
 * 动作路径点列 ⇒ PowerPoint path 串（M ox oy L ox+x oy+y … E）。
 * from＝这一段的起点（相对物件原位·投影片宽高比例）：同一物件的第 k 段动作路径要从第 k−1 段的终点起写——
 * origin=layout 的路径一律相对物件原位，第二段若还写 M 0 0 会在 PowerPoint 里先跳回原位再走。
 */
export function motionPath(pts: Array<[number, number]>, from: [number, number] = [0, 0]): string {
  const [ox, oy] = from
  return `M ${f4(ox)} ${f4(oy)} ${pts.map(([x, y]) => `L ${f4(ox + x)} ${f4(oy + y)}`).join(' ')} E`
}

/** ids＝照文件顺序发 cTn 编号；motion＝每个物件（spid）动作路径累积到哪（相对原位·照文件顺序＝放映顺序累加） */
class Ids { n = 0; motion = new Map<number, [number, number]>(); next() { return ++this.n } }

/** 效果本体（childTnLst 里的行为）·ids 照文件顺序发 */
function behaviors(fx: Fx, spid: number, ids: Ids): string {
  const tgt = `<p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl>`
  const names = (list: string[]) => `<p:attrNameLst>${list.map((n) => `<p:attrName>${n}</p:attrName>`).join('')}</p:attrNameLst>`
  const setVis = (val: 'visible' | 'hidden', delay = 0) =>
    `<p:set><p:cBhvr><p:cTn id="${ids.next()}" dur="1" fill="hold"><p:stCondLst><p:cond delay="${Math.max(0, delay)}"/></p:stCondLst></p:cTn>${tgt}${names(['style.visibility'])}</p:cBhvr><p:to><p:strVal val="${val}"/></p:to></p:set>`
  const filter = (transition: 'in' | 'out', f: string, dur: number) =>
    `<p:animEffect transition="${transition}" filter="${f}"><p:cBhvr><p:cTn id="${ids.next()}" dur="${dur}"/>${tgt}</p:cBhvr></p:animEffect>`
  const anim = (attr: string, dur: number, tavs: Array<[number, string]>, flt = false) =>
    `<p:anim calcmode="lin" valueType="num"><p:cBhvr additive="base"><p:cTn id="${ids.next()}" dur="${dur}" fill="hold"/>${tgt}${names([attr])}</p:cBhvr><p:tavLst>${tavs
      .map(([tm, v]) => `<p:tav tm="${tm}"><p:val>${flt ? `<p:fltVal val="${v}"/>` : `<p:strVal val="${v}"/>`}</p:val></p:tav>`).join('')}</p:tavLst></p:anim>`
  const scale = (by: number, dur: number, autoRev = false) =>
    `<p:animScale><p:cBhvr><p:cTn id="${ids.next()}" dur="${dur}"${autoRev ? ' autoRev="1"' : ''} fill="hold"/>${tgt}</p:cBhvr><p:by x="${Math.round(by * 100000)}" y="${Math.round(by * 100000)}"/></p:animScale>`
  const rot = (deg: number, dur: number, delay = 0) =>
    `<p:animRot by="${Math.round(deg * 60000)}"><p:cBhvr><p:cTn id="${ids.next()}" dur="${dur}" fill="hold"${delay ? `><p:stCondLst><p:cond delay="${delay}"/></p:stCondLst></p:cTn>` : '/>'}${tgt}${names(['r'])}</p:cBhvr></p:animRot>`
  const D = ms(fx.dur)
  switch (fx.cls) {
    case 'entr': {
      const dir = fx.dir ?? (fx.effect === 'wipe' ? 'left' : 'down')
      switch (fx.effect) {
        case 'appear': return setVis('visible')
        case 'fly': {
          const o = OFF[dir]
          return setVis('visible') + anim('ppt_x', D, [[0, o.x ?? '#ppt_x'], [100000, '#ppt_x']]) + anim('ppt_y', D, [[0, o.y ?? '#ppt_y'], [100000, '#ppt_y']])
        }
        case 'float':
          // 网页：从下方 60px（＝投影片高 562.5 的 0.1067）浮上来＋淡入
          return setVis('visible') + filter('in', 'fade', D) + anim('ppt_x', D, [[0, '#ppt_x'], [100000, '#ppt_x']]) + anim('ppt_y', D, [[0, '#ppt_y+0.1067'], [100000, '#ppt_y']])
        case 'wipe': return setVis('visible') + filter('in', `wipe(${WIPE_FILTER[dir]})`, D)
        case 'zoom':
          return setVis('visible') + anim('ppt_w', D, [[0, '#ppt_w*0.3'], [100000, '#ppt_w']]) + anim('ppt_h', D, [[0, '#ppt_h*0.3'], [100000, '#ppt_h']]) + filter('in', 'fade', D)
        case 'spin':
          return setVis('visible') + anim('ppt_w', D, [[0, '#ppt_w*0.3'], [100000, '#ppt_w']]) + anim('ppt_h', D, [[0, '#ppt_h*0.3'], [100000, '#ppt_h']])
            + anim('style.rotation', D, [[0, '-360'], [100000, '0']], true) + filter('in', 'fade', D)
        case 'bounce':
          // 网页 sk-bounce-in：自上方 600px 落下、弹两下（600px／562.5＝1.0667 个投影片高）
          return setVis('visible') + anim('ppt_y', D, [[0, '#ppt_y-1.0667'], [60000, '#ppt_y'], [75000, '#ppt_y-0.0711'], [90000, '#ppt_y'], [95000, '#ppt_y-0.0178'], [100000, '#ppt_y']])
        default: return setVis('visible') + filter('in', 'fade', D)
      }
    }
    case 'exit': {
      const dir = fx.dir ?? 'down'
      switch (fx.effect) {
        case 'appear': case 'disappear': return setVis('hidden')
        case 'fly': {
          const o = OFF[dir]
          return anim('ppt_x', D, [[0, '#ppt_x'], [100000, o.x ?? '#ppt_x']]) + anim('ppt_y', D, [[0, '#ppt_y'], [100000, o.y ?? '#ppt_y']]) + setVis('hidden', D - 1)
        }
        case 'zoom':
          return anim('ppt_w', D, [[0, '#ppt_w'], [100000, '#ppt_w*0.3']]) + anim('ppt_h', D, [[0, '#ppt_h'], [100000, '#ppt_h*0.3']]) + filter('out', 'fade', D) + setVis('hidden', D - 1)
        default: return filter('out', 'fade', D) + setVis('hidden', D - 1)
      }
    }
    case 'emph':
      switch (fx.effect) {
        case 'pulse': return scale(1.08, ms(D / 2), true)
        case 'teeter': {
          // 网页 sk-teeter：-6°→+6°→-4°→+4°→0（每段 1/5）
          const seq = [-6, 12, -10, 8, -4]
          const seg = ms(D / seq.length)
          return seq.map((d, k) => rot(d, seg, k * seg)).join('')
        }
        case 'grow': return scale(1.15, D)
        case 'scale': return scale(fx.by, D)
        case 'rotate': return rot(fx.deg, D)
      }
      return ''
    case 'path': {
      const from = ids.motion.get(spid) ?? [0, 0]
      const end = fx.pts.length ? fx.pts[fx.pts.length - 1] : [0, 0]
      ids.motion.set(spid, [from[0] + end[0], from[1] + end[1]])
      return `<p:animMotion origin="layout" path="${motionPath(fx.pts, from)}" pathEditMode="relative" ptsTypes="${'A'.repeat(fx.pts.length + 1)}"><p:cBhvr><p:cTn id="${ids.next()}" dur="${D}" fill="hold"/>${tgt}${names(['ppt_x', 'ppt_y'])}</p:cBhvr></p:animMotion>`
    }
    case 'media': {
      const cmd = fx.cmd === 'play' ? `playFrom(${(Math.max(0, fx.fromSec ?? 0)).toFixed(1)})` : fx.cmd === 'pause' ? 'togglePause' : 'stop'
      return `<p:cmd type="call" cmd="${cmd}"><p:cBhvr><p:cTn id="${ids.next()}" dur="${fx.cmd === 'play' ? D : 1}" fill="hold"/>${tgt}</p:cBhvr></p:cmd>`
    }
  }
}

type Built = { xml: string; stats: TimingStats; bld: Array<[number, number]> }

/** 一组效果（单击一次／一段书签）里的几段（par）·回 XML */
function buildGroups(
  items: TimelineItem[], lookup: (name: string) => ShapeRef[], ids: Ids, stats: TimingStats, grp: Map<number, number>, bld: Array<[number, number]>,
  onGroup: (auto: boolean, firstTrigger: TimelineItem['trigger'], inner: string, parId: number) => string,
): string {
  type Eff = { spid: number; kind: ShapeRef['kind']; fx: Fx; delay: number }
  type Sub = { start: number; effs: Eff[] }
  type Group = { auto: boolean; first: TimelineItem['trigger']; subs: Sub[] }
  const groups: Group[] = []
  let cur: Group | null = null
  let prevStart = 0
  let prevEnd = 0
  for (const it of items) {
    const effs: Array<Omit<Eff, 'delay'> & { off: number }> = []
    let len = 0
    for (const n of it.nodes) {
      const refs = lookup(n.target)
      if (!refs.length) { stats.missing++; continue }
      const off = Math.max(0, n.offsetMs ?? 0)
      len = Math.max(len, off + (typeof n.lenMs === 'number' ? Math.max(0, n.lenMs) : fxLength(n.fx)))
      for (const r of refs) effs.push({ spid: r.spid, kind: r.kind, fx: n.fx, off })
    }
    if (!effs.length) continue
    let start: number
    let sub: Sub
    if (it.trigger === 'click' || !cur) {
      cur = { auto: it.trigger !== 'click', first: it.trigger, subs: [] }
      groups.push(cur)
      start = 0
      sub = { start, effs: [] }
      cur.subs.push(sub)
    } else if (it.trigger === 'with') {
      start = prevStart
      const last = cur.subs[cur.subs.length - 1]
      if (last.start === start) sub = last
      else { sub = { start, effs: [] }; cur.subs.push(sub) }
    } else {
      start = prevEnd
      sub = { start, effs: [] }
      cur.subs.push(sub)
    }
    const delay = Math.max(0, Math.round(it.delayMs || 0))
    for (const e of effs) sub.effs.push({ spid: e.spid, kind: e.kind, fx: e.fx, delay: delay + Math.round(e.off) })
    prevStart = start
    prevEnd = start + delay + len
  }
  return groups.map((g) => {
    const parId = ids.next()
    const inner = g.subs.map((s, si) => {
      const sid = ids.next()
      const effs = s.effs.map((e, ei) => {
        const nodeType = ei > 0 ? 'withEffect' : si > 0 ? 'afterEffect' : g.auto ? (g.first === 'after' ? 'afterEffect' : 'withEffect') : 'clickEffect'
        const p = presetOf(e.fx)
        const eid = ids.next()
        let grpAttr = ''
        if (e.fx.cls !== 'media') {
          const gid = grp.get(e.spid) ?? 0
          grp.set(e.spid, gid + 1)
          grpAttr = ` grpId="${gid}"`
          if (e.kind === 'sp') bld.push([e.spid, gid])
        }
        const accel = e.fx.cls === 'path' ? ' accel="50000" decel="50000"' : ''
        stats.effects++
        return `<p:par><p:cTn id="${eid}" presetID="${p.id}" presetClass="${p.cls}" presetSubtype="${p.sub}"${accel} fill="hold"${grpAttr} nodeType="${nodeType}"><p:stCondLst><p:cond delay="${e.delay}"/></p:stCondLst><p:childTnLst>${behaviors(e.fx, e.spid, ids)}</p:childTnLst></p:cTn></p:par>`
      }).join('')
      return `<p:par><p:cTn id="${sid}" fill="hold"><p:stCondLst><p:cond delay="${Math.round(s.start)}"/></p:stCondLst><p:childTnLst>${effs}</p:childTnLst></p:cTn></p:par>`
    }).join('')
    return onGroup(g.auto, g.first, inner, parId)
  }).join('')
}

/** 药（只在 node 题里设·DILIN_NEG=pptx_cue_bookmark）：录片那一步的书签照旧挂 On Bookmark（题要红）。 */
function cueBookmarkNeg(): boolean {
  const v = typeof process !== 'undefined' ? process.env.DILIN_NEG : undefined
  return !!v && v.split(',').map((x) => x.trim()).includes('pptx_cue_bookmark')
}

function buildOnce(items: TimelineItem[], media: SlideMediaSpec[], lookup: (name: string) => ShapeRef[], withBookmarks: boolean): Built {
  const ids = new Ids()
  const stats: TimingStats = { effects: 0, missing: 0, bookmarkTriggers: 0 }
  const grp = new Map<number, number>()
  const bld: Array<[number, number]> = []
  const rootId = ids.next()
  const parts: string[] = []
  // fallbackOnly 节点（书签的退化版·见 planSlideTimeline）只进 Fallback；Choice 里由书签段负责
  if (withBookmarks) items = items.map((i) => (i.nodes.some((n) => n.fallbackOnly) ? { ...i, nodes: i.nodes.filter((n) => !n.fallbackOnly) } : i)).filter((i) => i.nodes.length)
  const main = items.filter((i) => !i.bookmark)
  // 主序列（单击推进）
  if (main.length) {
    const seqId = ids.next()
    const body = buildGroups(main, lookup, ids, stats, grp, bld, (auto, _first, inner, parId) => {
      const cond = auto ? `<p:cond delay="indefinite"/><p:cond evt="onBegin" delay="0"><p:tn val="${seqId}"/></p:cond>` : '<p:cond delay="indefinite"/>'
      return `<p:par><p:cTn id="${parId}" fill="hold"><p:stCondLst>${cond}</p:stCondLst><p:childTnLst>${inner}</p:childTnLst></p:cTn></p:par>`
    })
    if (body) {
      parts.push(`<p:seq concurrent="1" nextAc="seek"><p:cTn id="${seqId}" dur="indefinite" nodeType="mainSeq"><p:childTnLst>${body}</p:childTnLst></p:cTn>`
        + '<p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst>'
        + '<p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst></p:seq>')
    }
  }
  // 触发序列：书签（On Bookmark）·点影片本身（暂停／继续）
  const interactive = (cond: string, list: TimelineItem[]) => {
    const seqId = ids.next()
    const body = buildGroups(list, lookup, ids, stats, grp, bld, (_a, _f, inner, parId) =>
      `<p:par><p:cTn id="${parId}" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>${inner}</p:childTnLst></p:cTn></p:par>`)
    if (!body) return ''
    return `<p:seq concurrent="1" nextAc="seek"><p:cTn id="${seqId}" restart="whenNotActive" fill="hold" evtFilter="cancelBubble" nodeType="interactiveSeq"><p:stCondLst>${cond}</p:stCondLst>`
      + `<p:endSync evt="end" delay="0"><p:rtn val="all"/></p:endSync><p:childTnLst>${body}</p:childTnLst></p:cTn><p:nextCondLst>${cond}</p:nextCondLst></p:seq>`
  }
  if (withBookmarks) {
    const keys: string[] = []
    const byKey = new Map<string, TimelineItem[]>()
    for (const it of items) {
      if (!it.bookmark) continue
      const k = `${it.bookmark.media}\u0000${it.bookmark.name}`
      if (!byKey.has(k)) { byKey.set(k, []); keys.push(k) }
      byKey.get(k)!.push(it)
    }
    for (const k of keys) {
      const [mediaName, bmk] = k.split('\u0000')
      const ref = lookup(mediaName)[0]
      if (!ref) { stats.missing += byKey.get(k)!.length; continue }
      const cond = `<p:cond evt="onMediaBookmark" delay="0"><p:tgtEl><p14:bmkTgt spid="${ref.spid}" bmkName="${escAttr(bmk)}"/></p:tgtEl></p:cond>`
      const x = interactive(cond, byKey.get(k)!)
      if (x) { parts.push(x); stats.bookmarkTriggers++ }
    }
  } else {
    stats.missing += items.filter((i) => i.bookmark).reduce((n, i) => n + i.nodes.length, 0)
  }
  for (const m of media) {
    if (!m.toggleOnClick) continue
    const ref = lookup(m.name)[0]
    if (!ref) continue
    const cond = `<p:cond evt="onClick" delay="0"><p:tgtEl><p:spTgt spid="${ref.spid}"/></p:tgtEl></p:cond>`
    const saved = stats.effects
    parts.push(interactive(cond, [{ trigger: 'click', delayMs: 0, nodes: [{ target: m.name, fx: { cls: 'media', cmd: 'pause', dur: 1 } }] }]))
    stats.effects = saved   // 点影片暂停不算进「转成原生的动画」
  }
  // 每支影片一个媒体节点（音量／静音／循环）
  for (const m of media) {
    const ref = lookup(m.name)[0]
    if (!ref) continue
    parts.push(`<p:video><p:cMediaNode vol="80000"${m.muted ? ' mute="1"' : ''}><p:cTn id="${ids.next()}"${m.loop ? ' repeatCount="indefinite"' : ''} fill="hold"><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst></p:cTn><p:tgtEl><p:spTgt spid="${ref.spid}"/></p:tgtEl></p:cMediaNode></p:video>`)
  }
  if (!parts.length) return { xml: '', stats, bld }
  const bldXml = bld.length ? `<p:bldLst>${bld.map(([s, g]) => `<p:bldP spid="${s}" grpId="${g}" animBg="1"/>`).join('')}</p:bldLst>` : ''
  const xml = `<p:timing><p:tnLst><p:par><p:cTn id="${rootId}" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst>${parts.join('')}</p:childTnLst></p:cTn></p:par></p:tnLst>${bldXml}</p:timing>`
  return { xml, stats, bld }
}

/**
 * 一页的 <p:timing>（没东西＝空串）。lookup：物件名 ⇒ 投影片上的物件（组合拆平后一个名字可对到多个·找不到＝空阵列·记 missing）。
 * 有书签触发 ⇒ mc:AlternateContent（Choice p14 含书签段·Fallback 拿掉书签段、改由同一步里延迟出现）。
 */
export function buildTimingXml(items: TimelineItem[], media: SlideMediaSpec[], lookup: (name: string) => ShapeRef[]): { xml: string; stats: TimingStats } {
  const hasBmk = items.some((i) => i.bookmark)
  const full = buildOnce(items, media, lookup, true)
  if (!hasBmk || !full.stats.bookmarkTriggers) return { xml: full.xml, stats: full.stats }
  const fallback = buildOnce(items, media, lookup, false)
  const xml = `<mc:AlternateContent xmlns:mc="${MC}"><mc:Choice xmlns:p14="${P14}" Requires="p14">${full.xml}</mc:Choice><mc:Fallback>${fallback.xml}</mc:Fallback></mc:AlternateContent>`
  return { xml, stats: full.stats }
}

/* ------------------------------------------------------------------ */
/* 页动画表 ⇒ 时间线                                                    */
/* ------------------------------------------------------------------ */

/** 页动画表的一条（基础动画＋影片步骤 phase='media'＋程序步骤 phase='program'·宽松读：AB 那边的联合型别合码前用这个） */
export type AnimLike = {
  id?: string
  componentId: string
  phase: string
  effect: string
  direction?: Dir
  trigger: 'click' | 'with' | 'after'
  durationMs: number
  delayMs: number
  seekSec?: number
}

/** 程序组件的一步（拆开的＝元件动作；录片的＝那一段影片出现＋播放·clip 给了＝书签挂得上） */
export type ProgramStep = { nodes: FxNode[]; clip?: { media: string; durationMs?: number } }
export type ProgramPlan = {
  /** 总步数 N */
  steps: number
  /** 第 k 步（1 起）⇒ 效果节点；null＝这一步做不出来（跳过·记数） */
  step: (k: number) => ProgramStep | null
  /** 书签：第 step 步开始后 atSec 秒触发页上某组件的动画 */
  cues?: ReadonlyArray<{ step: number; atSec: number; componentId: string; animationId?: string }>
  /** 进页那一刻先摆好的（起始藏着的元件先藏、起始看得见但第一个动作是进场的先现）·不占时间 */
  prelude?: FxNode[]
}

export type PlanCtx = {
  /** 放映看得见的组件编号（含组合子件·同 render liveIds）·其余的动画放映也跳过 */
  live: ReadonlySet<string>
  /** 组件编号 ⇒ PowerPoint 物件名（组合 ⇒ 拆平后的子件；一般＝自己） */
  alias: (id: string) => string[]
  /** 真嵌进去的影片（组件编号 ⇒ 自动播放？·片长毫秒〔播放命令的时长照 PowerPoint 自己写的给片长〕） */
  media: ReadonlyMap<string, { autoplay?: boolean; durationMs?: number | null }>
  /** 程序组件（编号 ⇒ 排步资料）·Map 的顺序＝叠层由下而上（隐式步骤照这个顺序补在页尾） */
  programs?: ReadonlyMap<string, ProgramPlan>
}

export type PlanStats = {
  /** 转成原生的基础动画条数 */
  basic: number
  /** 转成媒体命令的影片步骤 */
  mediaSteps: number
  /** 影片没嵌进去（退成封面图）⇒ 它的影片步骤丢掉 */
  mediaDropped: number
  /** 暂停时跳秒 ⇒ PowerPoint 没有单独跳秒 ⇒ 并进下一次播放（从那秒开始） */
  seekFolded: number
  /** 程序步骤排进主序列的步数（显式＋隐式补的） */
  programSteps: number
  /** 页动画表里程序步骤条数多于程序步数 ⇒ 多出的忽略 */
  programStepsIgnored: number
  /** 程序的某一步做不出来（录片失败等）⇒ 跳过 */
  programStepsFailed: number
  /** 书签改成「与那一步同时＋延迟 atSec」（拆开的、录片的都是·WPS 不认 On Bookmark） */
  cuesAsDelay: number
  /** 书签真挂在录好的影片上（On Bookmark 触发·只剩药会走） */
  cuesAsBookmark: number
  /** 书签对不到页上的动画 ⇒ 忽略 */
  cuesDropped: number
}

const BASIC: Record<string, 'entr' | 'emph' | 'exit'> = { enter: 'entr', emphasis: 'emph', exit: 'exit' }

/** 一条基础动画 ⇒ 效果（不是基础动画＝null） */
export function basicFx(a: AnimLike): Fx | null {
  const cls = BASIC[a.phase]
  if (!cls) return null
  const dur = Math.max(1, Number(a.durationMs) || 0)
  return cls === 'emph'
    ? { cls, effect: (a.effect === 'pulse' || a.effect === 'teeter' ? a.effect : 'grow'), dur }
    : { cls, effect: a.effect, ...(a.direction ? { dir: a.direction } : {}), dur }
}

/**
 * 页动画表 ⇒ 时间线：基础动画＋影片步骤＋程序步骤（显式照表·其余隐式补在页尾每步一次单击）＋书签。
 * 书签对的那条动画从原位拿掉、并进那一步（同时＋延迟 atSec）·录片的、拆开的都一样（WPS 不认 On Bookmark）。
 */
export function planSlideTimeline(anims: readonly AnimLike[] | undefined, ctx: PlanCtx): {
  items: TimelineItem[]; stats: PlanStats; bookmarks: Record<string, Array<{ name: string; timeMs: number }>>
} {
  const items: TimelineItem[] = []
  const stats: PlanStats = { basic: 0, mediaSteps: 0, mediaDropped: 0, seekFolded: 0, programSteps: 0, programStepsIgnored: 0, programStepsFailed: 0, cuesAsDelay: 0, cuesAsBookmark: 0, cuesDropped: 0 }
  const bookmarks: Record<string, Array<{ name: string; timeMs: number }>> = {}
  type MState = { started: boolean; playing: boolean; pendingSeek?: number }
  const ms0 = new Map<string, MState>()
  const st = (id: string) => { let s = ms0.get(id); if (!s) { s = { started: false, playing: false }; ms0.set(id, s) } return s }
  const list = (anims ?? []).filter((a) => a && typeof a.componentId === 'string' && ctx.live.has(a.componentId))
  const programs = new Map([...(ctx.programs ?? new Map<string, ProgramPlan>())].filter(([id]) => ctx.live.has(id)))

  // 书签预排：每个书签 ⇒ 页动画表里哪一条（给 animationId＝那条；否则＝那一步之后那个组件第一条基础动画·没有＝它第一条）
  const stepPos = new Map<string, number[]>()
  list.forEach((a, i) => { if (a.phase === 'program' && programs.has(a.componentId)) { const l = stepPos.get(a.componentId) ?? []; l.push(i); stepPos.set(a.componentId, l) } })
  const claimed = new Set<number>()
  const cuesAt = new Map<string, Array<{ idx: number; atSec: number }>>()
  for (const [pid, plan] of programs) {
    for (const cue of plan.cues ?? []) {
      if (!(cue.step >= 1 && cue.step <= plan.steps) || !(cue.atSec >= 0)) { stats.cuesDropped++; continue }
      const pos = stepPos.get(pid)?.[cue.step - 1] ?? Infinity
      const ok = (i: number) => !claimed.has(i) && !!BASIC[list[i].phase] && list[i].componentId === cue.componentId
      let idx = -1
      if (cue.animationId) idx = list.findIndex((a, i) => a.id === cue.animationId && !claimed.has(i) && !!BASIC[a.phase])
      else {
        idx = list.findIndex((_, i) => i > pos && ok(i))
        if (idx < 0) idx = list.findIndex((_, i) => ok(i))
      }
      if (idx < 0) { stats.cuesDropped++; continue }
      claimed.add(idx)
      const key = `${pid}\u0000${cue.step}`
      const l = cuesAt.get(key) ?? []
      l.push({ idx, atSec: cue.atSec })
      cuesAt.set(key, l)
    }
  }

  // 进页先摆好（程序元件起始状态）
  const prelude = [...programs.values()].flatMap((p) => p.prelude ?? [])
  if (prelude.length) items.push({ trigger: 'with', delayMs: 0, nodes: prelude.map((n) => ({ ...n, lenMs: 0 })) })
  // 自动播放的影片（页动画表没给它影片步骤）⇒ 进页就播（与第一项同时·不占时间）
  const explicit = new Set(list.filter((a) => a.phase === 'media').map((a) => a.componentId))
  for (const [id, m] of ctx.media) {
    if (!m.autoplay || explicit.has(id) || !ctx.live.has(id)) continue
    const names = ctx.alias(id)
    items.push({ trigger: 'with', delayMs: 0, nodes: names.map((n) => ({ target: n, fx: { cls: 'media', cmd: 'play', fromSec: 0, dur: m.durationMs || 1 }, lenMs: 0 })) })
    st(id).started = true; st(id).playing = true
  }

  const done = new Map<string, number>()
  let bmkSeq = 0
  const emitStep = (pid: string, plan: ProgramPlan, k: number, trigger: TimelineItem['trigger'], delayMs: number) => {
    const step = plan.step(k)
    if (!step || !step.nodes.length) { stats.programStepsFailed++; return }
    const item: TimelineItem = { trigger, delayMs, nodes: [...step.nodes] }
    items.push(item)
    stats.programSteps++
    for (const c of cuesAt.get(`${pid}\u0000${k}`) ?? []) {
      const a = list[c.idx]
      const fx = basicFx(a)!
      const nodes = ctx.alias(a.componentId).map((n) => ({ target: n, fx }))
      // 录片那一步也一律「同时＋延迟 atSec」：WPS（Mac）读的是 Choice、不认书签 ⇒ 目标一进页就露出；
      //   书签的意思本来就是「那一步开始后第几秒」·影片从那一步起点从头播 ⇒ PowerPoint 里时刻相同。药 pptx_cue_bookmark＝照旧挂书签。
      if (step.clip && cueBookmarkNeg()) {
        const name = `cue${++bmkSeq}`
        // 书签时间不能超过片长（PowerPoint 规定）
        const cap = step.clip.durationMs && step.clip.durationMs > 1 ? step.clip.durationMs - 1 : Infinity
        const at = Math.min(cap, Math.round(c.atSec * 1000))
        ;(bookmarks[step.clip.media] ??= []).push({ name, timeMs: at })
        items.push({ trigger: 'with', delayMs: 0, bookmark: { media: step.clip.media, name }, nodes })
        // WPS（Mac）不认书签 ⇒ Fallback 里退化成「这一步同时＋延迟 at」（影片从这一步起点从头播·时刻相同）；Choice 不带
        for (const n of nodes) item.nodes.push({ ...n, offsetMs: at, lenMs: 0, fallbackOnly: true })
        stats.cuesAsBookmark++
      } else {
        // 同时＋延迟 atSec（不撑长这一步：之后的照程序动作的长度／片长接）
        for (const n of nodes) item.nodes.push({ ...n, offsetMs: Math.round(c.atSec * 1000), lenMs: 0 })
        stats.cuesAsDelay++
      }
    }
  }

  list.forEach((a, i) => {
    if (claimed.has(i)) return
    const trigger = a.trigger === 'with' || a.trigger === 'after' ? a.trigger : 'click'
    const delayMs = Math.max(0, Number(a.delayMs) || 0)
    const names = ctx.alias(a.componentId)
    const fxb = basicFx(a)
    if (fxb) {
      items.push({ trigger, delayMs, nodes: names.map((n) => ({ target: n, fx: fxb })) })
      stats.basic++
      return
    }
    if (a.phase === 'media') {
      if (!ctx.media.has(a.componentId)) { stats.mediaDropped++; return }
      const s = st(a.componentId)
      const vdur = ctx.media.get(a.componentId)?.durationMs || 1
      const seek = typeof a.seekSec === 'number' && Number.isFinite(a.seekSec) ? Math.max(0, a.seekSec) : undefined
      let fx: Fx | null = null
      if (a.effect === 'play') {
        const from = seek ?? s.pendingSeek
        if (from !== undefined) fx = { cls: 'media', cmd: 'play', fromSec: from, dur: vdur }
        else if (!s.started) fx = { cls: 'media', cmd: 'play', fromSec: 0, dur: vdur }
        else if (!s.playing) fx = { cls: 'media', cmd: 'pause', dur: 1 }   // togglePause＝从暂停处继续
        s.started = true; s.playing = true; s.pendingSeek = undefined
      } else if (a.effect === 'pause') {
        if (s.playing) fx = { cls: 'media', cmd: 'pause', dur: 1 }
        s.playing = false
      } else if (a.effect === 'seek' && seek !== undefined) {
        if (s.playing) fx = { cls: 'media', cmd: 'play', fromSec: seek, dur: vdur }
        else { s.pendingSeek = seek; stats.seekFolded++ }
      }
      if (fx) {
        items.push({ trigger, delayMs, nodes: names.map((n) => ({ target: n, fx: fx!, lenMs: 0 })) })
        stats.mediaSteps++
      }
      return
    }
    if (a.phase === 'program') {
      const plan = programs.get(a.componentId)
      if (!plan) return
      const k = (done.get(a.componentId) ?? 0) + 1
      if (k > plan.steps) { stats.programStepsIgnored++; return }
      done.set(a.componentId, k)
      emitStep(a.componentId, plan, k, trigger, delayMs)
    }
  })
  // 隐式：没排进表的步数 ⇒ 页尾每步一次单击（程序组件照叠层由下而上）
  for (const [pid, plan] of programs) {
    for (let k = (done.get(pid) ?? 0) + 1; k <= plan.steps; k++) emitStep(pid, plan, k, 'click', 0)
  }
  return { items, stats, bookmarks }
}

/** <p14:media …/> 补书签（time＝毫秒·名字照给） */
export function bookmarkListXml(list: Array<{ name: string; timeMs: number }>): string {
  if (!list.length) return ''
  return `<p14:bmkLst>${list.map((b) => `<p14:bmk name="${escAttr(b.name)}" time="${Math.max(0, Math.round(b.timeMs))}"/>`).join('')}</p14:bmkLst>`
}

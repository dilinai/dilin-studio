// 网页剪辑·巢状合成（AE 的 precomp／nested sequence）：工程里另存几份子合成（各自的轨道＋长度＋比例），
//   画面轨上一段 { comp:<合成编号> } 就是「把那份合成当一段素材放进来」——起点／长度／素材入点 offset（＝合成里第几秒）／变速／倒放／定格照素材片段算，
//   画面属性、关键帧、特效、调色、动画、转场、轨道遮罩照常套在这一段上。子合成里还能再放别的子合成（⛔ 绕回自己：读档时把绕回去的那段拿掉）。
// 画法：汇出／抽帧（ui/export-render frameDrawer）遇到合成段 ⇒ 另开一只 frameDrawer 照那份合成的轨道画进透明画布（时间＝srcAt）·再当这段的画面；
//   预览同一支（ui/PlanCanvas）。声音：汇出照 flattenCompAudio 把合成里出声的段摊平到上层时间（合成段没变速时）。
// 本档只放纯函数（node 题直接跑）。⛔ 碰 DOM。
import { MAIN_LANE, findClip, newLane, pinMain, planDrop, applyDrop, srcAt, speedOf, timelineEnd, type Lane, type TlClip, type Tracks } from './timeline.pure'
import { ratioOf, type RatioSel } from './ratio.pure'

/** 一份子合成：name＝显示名；ratio＝画面比例（fit＝跟上层画面一样）；length＝合成多长（缺＝最后一段的尾）；tracks＝轨道（同主时间轴的规矩·一定有主轨） */
export type VeditComp = { name: string; ratio: RatioSel; length?: number; tracks: Tracks }
export type Comps = Record<string, VeditComp>
/** 合成最多套几层（主时间轴算第 0 层）：再深的那段读档时拿掉 */
export const COMP_DEPTH_MAX = 8
/** 一份工程最多几份合成 */
export const COMPS_MAX = 200
export const COMP_NAME_MAX = 80

/** 药：DILIN_NEG 含 vedit_comp_off ⇒ 读档不收合成、合成段画不出来（framePlan 不出合成那层）·绕回检查不做·打包不做·声音不摊（只在 node 测试跑） */
export function compNegOff(): boolean {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.DILIN_NEG ?? ''
  return typeof window === 'undefined' && env.split(',').includes('vedit_comp_off')
}

/** 合成多长：写了 length 照它·没写 ⇒ 最后一段的尾 */
export const compDuration = (c: Pick<VeditComp, 'length' | 'tracks'>): number => (c.length && c.length > 0 ? c.length : timelineEnd(c.tracks))
/** 合成画面宽／高：fit ⇒ 跟上层（parent＝上层画面宽／高） */
export const compAspect = (c: Pick<VeditComp, 'ratio'>, parent: number): number => ratioOf(c.ratio, parent) ?? parent
/** 合成画进上层画面时的像素大小：照比例放进上层 W×H 里（同 containRect）·取整·至少 2 */
export function compPixelSize(c: Pick<VeditComp, 'ratio'>, W: number, H: number): { w: number; h: number } {
  const a = compAspect(c, W / H)
  const s = Math.min(W / a, H)
  return { w: Math.max(2, Math.round(a * s)), h: Math.max(2, Math.round(s)) }
}
/** 合成段这一刻画合成里的第几秒（同素材片段 srcAt·变速／倒放／定格照算）；出了合成长度 ⇒ null（这一刻合成里没东西＝透明） */
export function compTimeAt(clip: TlClip, comp: Pick<VeditComp, 'length' | 'tracks'>, t: number): number | null {
  const s = srcAt(clip, t)
  const d = compDuration(comp)
  return s >= -1e-6 && s < d - 1e-6 ? Math.max(0, s) : null
}

/** 轨道里指到哪几份合成 */
export function compRefs(tr: Tracks): string[] {
  const out: string[] = []
  for (const l of tr) for (const c of l.clips) if (c.comp && !out.includes(c.comp)) out.push(c.comp)
  return out
}

/**
 * 绕回与太深的合成段拿掉（读档、命令都过这一道）：从每份合成往下走，走到「正在走的路上」那份 ⇒ 这段绕回自己；
 * 一段底下套的层数（含自己）超过 COMP_DEPTH_MAX ⇒ 太深。回拿掉后的合成与主轨道、拿掉了哪几段。药 ⇒ 不检查。
 */
export function breakCompCycles(root: Tracks, comps: Comps): { root: Tracks; comps: Comps; dropped: Array<{ clip: string; comp: string; why: 'cycle' | 'deep' }> } {
  const dropped: Array<{ clip: string; comp: string; why: 'cycle' | 'deep' }> = []
  if (compNegOff()) return { root, comps, dropped }
  const out: Comps = { ...comps }
  const state = new Map<string, 'gray' | 'black'>()
  const height = new Map<string, number>()
  const strip = (tr: Tracks, bad: Set<string>): Tracks => (bad.size ? tr.map((l) => (l.clips.some((c) => bad.has(c.id)) ? { ...l, clips: l.clips.filter((c) => !bad.has(c.id)) } : l)) : tr)
  // 回这份合成往下最多几层（含自己）
  const visit = (id: string): number => {
    const st = state.get(id)
    if (st === 'black') return height.get(id) ?? 1
    state.set(id, 'gray')
    const bad = new Set<string>()
    let h = 1
    for (const l of out[id].tracks) for (const c of l.clips) {
      if (!c.comp) continue
      if (!out[c.comp]) continue
      if (state.get(c.comp) === 'gray') { bad.add(c.id); dropped.push({ clip: c.id, comp: c.comp, why: 'cycle' }); continue }
      const sub = visit(c.comp)
      if (sub + 1 > COMP_DEPTH_MAX) { bad.add(c.id); dropped.push({ clip: c.id, comp: c.comp, why: 'deep' }); continue }
      h = Math.max(h, sub + 1)
    }
    if (bad.size) out[id] = { ...out[id], tracks: strip(out[id].tracks, bad) }
    state.set(id, 'black'); height.set(id, h)
    return h
  }
  for (const id of Object.keys(out).sort()) visit(id)
  const bad = new Set<string>()
  for (const l of root) for (const c of l.clips) if (c.comp && out[c.comp] && visit(c.comp) + 1 > COMP_DEPTH_MAX + 1) { bad.add(c.id); dropped.push({ clip: c.id, comp: c.comp, why: 'deep' }) }
  return { root: strip(root, bad), comps: out, dropped }
}

/** 把 child 放进 parent 会不会绕回（parent 自己或它往下任何一份就是 child 往下会走到的）：命令／页面放合成段前先问 */
export function compWouldCycle(comps: Comps, parent: string | null, child: string): boolean {
  if (!parent) return false
  const seen = new Set<string>()
  const walk = (id: string): boolean => {
    if (id === parent) return true
    if (seen.has(id)) return false
    seen.add(id)
    const c = comps[id]
    return !!c && compRefs(c.tracks).some(walk)
  }
  return walk(child)
}

/**
 * 「把选中片段打包成合成」（AE Pre-compose）：选中那几段（锁了的轨不算）连同各自的轨道搬进一份新合成（时间从最早那段的头算 0）；
 * 原位置换成一段合成段（放在选中里最上面那条画面轨·那段时间被占 ⇒ 照拖素材进来的规划在它上面新增一条）。
 * 合成主轨＝原主轨那几段（没有 ⇒ 最下面那条画面轨）；音频等别种轨照原顺序搬。回 null＝没东西可打包。
 */
export function precompose(tr: Tracks, ids: readonly string[], o: { compId: string; clipId: string; newId: () => string; name: string }): { tracks: Tracks; comp: VeditComp; clipId: string } | null {
  if (compNegOff()) return null
  const want = new Set(ids)
  const picked = tr.flatMap((l) => (l.locked ? [] : l.clips.filter((c) => want.has(c.id)).map((c) => ({ lane: l, clip: c }))))
  if (!picked.length) return null
  const t0 = Math.min(...picked.map((p) => p.clip.start)), t1 = Math.max(...picked.map((p) => p.clip.start + p.clip.length))
  if (!(t1 - t0 > 1e-6)) return null
  const pickedIds = new Set(picked.map((p) => p.clip.id))
  const srcLanes = tr.filter((l) => l.clips.some((c) => pickedIds.has(c.id)))
  const visual = srcLanes.filter((l) => l.kind === 'visual')
  const mainSrc = srcLanes.find((l) => l.id === MAIN_LANE) ?? visual[visual.length - 1] ?? null
  // 合成里的轨：编号另取（合成自己一套）·主轨叫 main
  let lanes: Lane[] = srcLanes.map((l) => ({ ...newLane(l === mainSrc ? MAIN_LANE : o.newId(), l === mainSrc ? 'visual' : l.kind), clips: l.clips.filter((c) => pickedIds.has(c.id)).map((c) => ({ ...c, start: Math.round((c.start - t0) * 1e6) / 1e6 })) }))
  if (!mainSrc) lanes.push(newLane(MAIN_LANE, 'visual'))
  lanes = pinMain([...lanes.filter((l) => l.kind !== 'audio'), ...lanes.filter((l) => l.kind === 'audio')])
  const comp: VeditComp = { name: o.name.slice(0, COMP_NAME_MAX), ratio: { kind: 'fit' }, length: Math.round((t1 - t0) * 1e6) / 1e6, tracks: lanes }
  // 原处拿掉·放一段合成段
  let rest: Tracks = tr.map((l) => (l.clips.some((c) => pickedIds.has(c.id)) ? { ...l, clips: l.clips.filter((c) => !pickedIds.has(c.id)) } : l))
  const clip: TlClip = { id: o.clipId, mediaId: '', comp: o.compId, start: t0, length: t1 - t0, offset: 0 }
  const home = visual[0] ? rest.find((l) => l.id === visual[0].id) ?? null : null
  const plan = planDrop(rest, 'visual', home ? { lane: home.id } : null, t0, t1 - t0)
  rest = applyDrop(rest, { ...plan, start: t0 }, clip, o.newId())
  return { tracks: rest, comp, clipId: clip.id }
}

/**
 * 汇出混音用：合成段底下出声的片段摊平到上层时间（递归）——每段合成段下面多一条音频轨放摊出来的段（编号＝<合成段>~<里面那段>）。
 * 只摊没变速／没倒放／没定格／没曲线变速的合成段（变了速的合成段声音不出·见 FORMAT.md）；合成段静音／停用／所在轨隐藏静音 ⇒ 不摊。
 * 摊出来的段：头尾截在合成段的范围内（截掉的头照那段的速度往后挪入点·曲线变速／倒放的段被截到 ⇒ 整段不摊）·音量乘上合成段的音量。
 */
export function flattenCompAudio(tr: Tracks, comps: Comps | undefined, depth = 0): Tracks {
  if (!comps || compNegOff() || depth > COMP_DEPTH_MAX || !tr.some((l) => l.clips.some((c) => c.comp))) return tr
  const extra: Lane[] = []
  for (const l of tr) {
    if (l.kind !== 'visual' || l.hidden || l.muted) continue
    for (const cc of l.clips) {
      const comp = cc.comp ? comps[cc.comp] : undefined
      if (!comp || cc.muted || cc.disabled || cc.freeze || cc.reverse || cc.curve || Math.abs(speedOf(cc) - 1) > 1e-6) continue
      const inner = flattenCompAudio(comp.tracks, comps, depth + 1)
      const lo = cc.start, hi = cc.start + cc.length, shift = cc.start - cc.offset
      const clips: TlClip[] = []
      for (const il of inner) {
        if (il.hidden || il.muted) continue
        for (const c of il.clips) {
          const a = c.start + shift, b = a + c.length
          const s = Math.max(a, lo), e = Math.min(b, hi)
          if (!(e - s > 1e-6)) continue
          const cutHead = s - a
          if ((cutHead > 1e-6 || e < b - 1e-6) && (c.curve || c.reverse)) continue
          const { comp: _c, look: _l, anim: _a, fx: _f, transIn: _t, group: _g, ...body } = c
          void _c; void _l; void _a; void _f; void _t; void _g
          clips.push({ ...body, id: `${cc.id}~${c.id}`, start: s, length: e - s, offset: c.offset + (c.freeze ? 0 : cutHead * speedOf(c)), ...(cc.volume !== undefined ? { volume: (c.volume ?? 1) * cc.volume } : {}) })
        }
      }
      if (clips.length) extra.push({ ...newLane(`${cc.id}~a`, 'audio'), clips: clips.sort((x, y) => x.start - y.start) })
    }
  }
  // 摊出来的段可能互相叠：每段自己一条轨（混音只看片段·不看轨上叠不叠）
  const split: Lane[] = extra.flatMap((l) => l.clips.map((c, i) => ({ ...l, id: `${l.id}${i}`, clips: [c] })))
  return split.length ? [...tr, ...split] : tr
}
/** 汇出选中那几段：选到合成段 ⇒ 它摊出来的声音段一起算 */
export function withCompAudioIds(ids: readonly string[], flat: Tracks): string[] {
  const want = new Set(ids)
  const out = [...ids]
  for (const l of flat) for (const c of l.clips) { const k = c.id.indexOf('~'); if (k > 0 && want.has(c.id.slice(0, k)) && !want.has(c.id)) out.push(c.id) }
  return out
}

/** 合成段在哪份合成里（主时间轴＝null）：页面面包屑、命令找片段用 */
export function compOfClip(root: Tracks, comps: Comps, clipId: string): string | null | undefined {
  if (findClip(root, clipId)) return null
  for (const [id, c] of Object.entries(comps)) if (findClip(c.tracks, clipId)) return id
  return undefined
}

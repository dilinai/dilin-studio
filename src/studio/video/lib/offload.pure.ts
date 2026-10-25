// 「合成子素材」「多选合并（有画面）」交给别台合——纯判断：
//   · 右键选单要不要列「交给某台」那几项（只在有画面、本来就能合时；没有在线的别台 ⇒ 不列·只走本机）
//   · 交出去时要带的范围（同本机合成那一段：选中那几段最早的头到最晚的尾·只画那几段）
//   · 合完回来时，选中那几段在合的期间有没有被改过（改过 ⇒ 不替换时间轴·成品只进素材区）
// ⛔ IO：存工程、建任务、问状态在 video-edit/vedit-remote-render.ts。
import { findClip, type Tracks } from './timeline.pure'
import { mergeBlock, subClipPlan } from './group.pure'
import type { ExportPart } from './remote-export.pure'
import type { ExportTargetOption } from './export-client.pure'

type KindOf = Parameters<typeof subClipPlan>[2]
export type OffloadAct = 'subclip' | 'merge'
/** 选单里最多列几台（多了选单太长） */
export const OFFLOAD_DEVICES_MAX = 3

/** 这几段能不能交给别台合：合成子素材＝选到的有画面；合并＝两段以上且有画面（纯声音的本机混音很轻·不必借） */
export function offloadable(act: OffloadAct, tr: Tracks, ids: readonly string[], kindOf: KindOf): boolean {
  if (!ids.length) return false
  if (act === 'merge') return mergeBlock(tr, ids) === 'picture'
  return !!subClipPlan(tr, ids, kindOf)?.picture
}
/** 交出去的范围（同本机：renderVideo range＝{ plan.start, plan.end, only: ids }）；选的都不在 ⇒ null */
export function offloadPart(tr: Tracks, ids: readonly string[], kindOf: KindOf): ExportPart | null {
  const plan = subClipPlan(tr, ids, kindOf)
  if (!plan || !(plan.end > plan.start)) return null
  return { from: plan.start, to: plan.end, only: [...new Set(ids)] }
}
/** 能交的别台（导出弹窗那份清单去掉「这台电脑」·⛔ 雲電腦已在 exportTargetOptions 排掉）·最多 OFFLOAD_DEVICES_MAX 台 */
export function offloadDevices(opts: readonly ExportTargetOption[]): Array<{ deviceId: string; label: string }> {
  const out: Array<{ deviceId: string; label: string }> = []
  for (const o of opts) if ('deviceId' in o && out.length < OFFLOAD_DEVICES_MAX) out.push({ deviceId: o.deviceId, label: o.label })
  return out
}
/** 选中那几段此刻的样子（含所在轨）：交出去前记一份、合完回来再比——不同 ⇒ 合的期间被改过 */
export function clipsSnapshot(tr: Tracks, ids: readonly string[]): string {
  return JSON.stringify([...new Set(ids)].sort().map((id) => {
    const f = findClip(tr, id)
    return f ? [id, f.lane.id, f.lane.locked, f.clip] : [id, null]
  }))
}

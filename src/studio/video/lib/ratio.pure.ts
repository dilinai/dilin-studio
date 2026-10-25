// 网页剪辑页·播放器「比例」选单（附剪映专业版截图）。
// 选单照剪映逐项：适应（原始）／自定义｜16:9／4:3／2.35:1／2:1／1.85:1｜9:16（去掉西瓜视频、抖音的括号说明）／3:4／5.8寸／1:1／1:2·右边小框示意。
// 选了 ⇒ 时间轴预览画在这个比例的黑框里（放不满的补黑边）；看单份原素材时不套。存本机（还没有工程档·工程档做好后搬进去·汇出照它）。
// 本档只放纯函数（题直接跑）：选项清单、存档读回、算比例、算黑框大小、小框示意大小、「适应（原始）」认哪一段。

export type RatioPresetKey = '16:9' | '4:3' | '2.35:1' | '2:1' | '1.85:1' | '9:16' | '3:4' | '5.8in' | '1:1' | '1:2'
export type RatioSel = { kind: 'fit' } | { kind: 'preset'; key: RatioPresetKey } | { kind: 'custom'; w: number; h: number }

/** 宽／高。5.8寸＝5.8 吋全面屏手机（1125×2436·剪映同款） */
export const RATIO_PRESETS: Readonly<Record<RatioPresetKey, number>> = {
  '16:9': 16 / 9, '4:3': 4 / 3, '2.35:1': 2.35, '2:1': 2, '1.85:1': 1.85,
  '9:16': 9 / 16, '3:4': 3 / 4, '5.8in': 1125 / 2436, '1:1': 1, '1:2': 1 / 2,
}
/** 选单分三段（照截图·段间一条分隔线）：横的一段、竖的一段 */
export const RATIO_LANDSCAPE: readonly RatioPresetKey[] = ['16:9', '4:3', '2.35:1', '2:1', '1.85:1']
export const RATIO_PORTRAIT: readonly RatioPresetKey[] = ['9:16', '3:4', '5.8in', '1:1', '1:2']

export const VEDIT_RATIO_KEY = 'dilin.videoEdit.ratio.v1'
export const RATIO_DEFAULT: RatioSel = { kind: 'fit' }
export const CUSTOM_DEFAULT = { w: 1920, h: 1080 } as const
/** 自定义宽高上下限（像素） */
export const CUSTOM_MIN = 16
export const CUSTOM_MAX = 8192

/** 自定义框里打的字 ⇒ 整数像素（夹在上下限）；不是数字 ⇒ null */
export function clampCustom(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v.trim()) : NaN
  if (!Number.isFinite(n)) return null
  return Math.min(CUSTOM_MAX, Math.max(CUSTOM_MIN, Math.round(n)))
}

/** 读回存档（坏的 ⇒ 缺省「适应」·⛔ 抛） */
export function parseRatio(raw: string | null): RatioSel {
  if (!raw) return RATIO_DEFAULT
  let v: unknown
  try { v = JSON.parse(raw) } catch { return RATIO_DEFAULT }
  if (!v || typeof v !== 'object') return RATIO_DEFAULT
  const o = v as Record<string, unknown>
  if (o.kind === 'preset' && typeof o.key === 'string' && Object.prototype.hasOwnProperty.call(RATIO_PRESETS, o.key)) return { kind: 'preset', key: o.key as RatioPresetKey }
  if (o.kind === 'custom') {
    const w = clampCustom(o.w), h = clampCustom(o.h)
    if (w !== null && h !== null) return { kind: 'custom', w, h }
  }
  return RATIO_DEFAULT
}

/** 宽／高；null ⇒ 不框（「适应」但轨道上还没有画面·整块播放区照旧） */
export function ratioOf(sel: RatioSel, fitAspect: number | null): number | null {
  if (sel.kind === 'preset') return RATIO_PRESETS[sel.key]
  if (sel.kind === 'custom') return sel.w / sel.h
  return fitAspect !== null && Number.isFinite(fitAspect) && fitAspect > 0 ? fitAspect : null
}

/** 「适应（原始）」那段的比例：先用探过的（同一个网址探到的才算）；探不到／还没探 ⇒ 用预览元素载入时读到的原比例；都没有 ⇒ null。
 * 探的结果原本按素材 id 记、记成空（网址还没好、读失败）就再也不探 ⇒ 舞台不框、铺满整块播放区（696×402），
 * 白图 16:9 按宽撑满后高只占 58.3%（成片 60%）。药：DILIN_NEG 含 vedit_stage_fit_probe_only ⇒ 只认探的（旧行为） */
export function fitAspectOf(probed: number | null | undefined, seen: number | null | undefined): number | null {
  const ok = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0
  if (ok(probed)) return probed
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.DILIN_NEG ?? ''
  if (typeof window === 'undefined' && env.split(',').includes('vedit_stage_fit_probe_only')) return null
  return ok(seen) ? seen : null
}

/** 黑框大小：这个比例放进播放区里最大的那块（取整·至少 1） */
export function stageBox(boxW: number, boxH: number, ratio: number): { w: number; h: number } {
  if (!(boxW > 0 && boxH > 0 && ratio > 0)) return { w: 0, h: 0 }
  // 播放区比这个比例宽 ⇒ 贴满高（左右补黑）；否则贴满宽（上下补黑）
  if (boxW / boxH > ratio) return { w: Math.max(1, Math.floor(boxH * ratio)), h: Math.floor(boxH) }
  return { w: Math.floor(boxW), h: Math.max(1, Math.floor(boxW / ratio)) }
}

/** 选单右边那个小框示意的大小（放进 maxW×maxH） */
export function iconBox(ratio: number, maxW = 20, maxH = 14): { w: number; h: number } {
  const b = stageBox(maxW, maxH, ratio)
  return { w: Math.max(4, b.w), h: Math.max(4, b.h) }
}

/** 是不是这一项（勾当前项用） */
export function sameRatio(a: RatioSel, b: RatioSel): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'preset' && b.kind === 'preset') return a.key === b.key
  return true // fit／custom 各只有一项
}

/** 「适应（原始）」认哪一段：主轨最早那段有画面素材的（剪映：照第一段素材的比例）；主轨没有 ⇒ 别的画面轨最早那段；都没有 ⇒ null。
 * 没素材的段（纯色底、星空光斑等背景特效·mediaId 空）不算；给了 isPicture 再只认图片／影片（主轨开头是纯色 ⇒ 认不到 ⇒ 预览不框、成片却照 16:9）。
 * 药：DILIN_NEG 含 vedit_fitref_take_blank ⇒ 照旧取最早那段（不管有没有素材） */
export function fitRefMediaId(lanes: ReadonlyArray<{ id: string; kind: string; clips: ReadonlyArray<{ mediaId: string; start: number }> }>, mainId = 'main', isPicture?: (mediaId: string) => boolean): string | null {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.DILIN_NEG ?? ''
  const neg = typeof window === 'undefined' && env.split(',').includes('vedit_fitref_take_blank')
  const ok = (c: { mediaId: string }) => neg || (!!c.mediaId && (!isPicture || isPicture(c.mediaId)))
  const first = (cs: ReadonlyArray<{ mediaId: string; start: number }>) => cs.filter(ok).reduce<{ mediaId: string; start: number } | null>((b, c) => (!b || c.start < b.start ? c : b), null)
  const main = lanes.find((l) => l.id === mainId)
  const m = main ? first(main.clips) : null
  if (m) return m.mediaId || null
  const any = first(lanes.filter((l) => l.kind === 'visual').flatMap((l) => l.clips))
  return any ? any.mediaId || null : null
}

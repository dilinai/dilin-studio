// 网页剪辑页·滤镜轨＋滤镜库＋收藏（附图＝剪映专业版「滤镜」）。
// 滤镜片段＝放在滤镜轨上的一段（TlClip.filter·mediaId 空）：那段时间里，滤镜轨「底下」的画面轨（影片／图片）照那支 applyFilter 套色·强度 0～100%；
// 好几条滤镜轨叠着 ⇒ 每层画面只套离它最近、在它上面的那一段（汇出成片时再做整张合成）。文字、贴纸不套色。
// 顶 bar「濾鏡」页签：左清单「收藏」＋「濾鏡庫」（15 类）·右边缩图格；点一款 ⇒ 播放头放一段（3 秒）；也能拖进轨道；选中滤镜片段 ⇒ 格子上方出强度拉杆。
// 收藏：卡片右上角星星·存帐号偏好（profiles.preferences·换电脑也在）·贴纸与滤镜各一份。
// 本档只放纯函数（题直接跑）；画在 video-edit/page.tsx、VeditAssetTabs.tsx、VeditFilterCanvas.tsx。⛔ 碰 DOM。
import { studioStaticHref } from '../../shared/host'
import { filterStrengthAt } from './text-kf.pure' // 滤镜强度关键帧
import { FILTERS, FILTER_CATS, type FilterCat, type FilterItem } from './filters.data'
import { applyDrop, findClip, planDrop, snapFrame, type FilterBody, type LayerState, type TlClip, type Tracks } from './timeline.pure'

export const FILTER_DEFAULT_SECONDS = 3
export const FILTER_STRENGTH_DEFAULT = 1
export const FILTER_DRAG_MIME = 'application/x-dilin-vedit-filter'

const BY_ID = new Map(FILTERS.map((f) => [f.id, f]))
export const filterById = (id: string | undefined): FilterItem | null => (id ? BY_ID.get(id) ?? null : null)
export function filterName(id: string, lang: 'zh-TW' | 'zh-CN' | 'en'): string {
  const f = filterById(id)
  return f ? f.name[lang === 'zh-CN' ? 'cn' : lang === 'en' ? 'en' : 'tw'] : id
}
/** 缩图（出的 256×256·转 JPEG 放两站 public） */
export const filterThumb = (id: string) => studioStaticHref(`/vedit/filters/${id}.jpg`)

// ── 左清单：滤镜库底下 15 类（编号 filter-<类>）──
export const FILTER_CAT_PREFIX = 'filter-'
export const filterCatIds = (): string[] => FILTER_CATS.map((c) => FILTER_CAT_PREFIX + c.id)
export function filterCatOf(pick: string): FilterCat | null {
  if (!pick.startsWith(FILTER_CAT_PREFIX)) return null
  const id = pick.slice(FILTER_CAT_PREFIX.length)
  return FILTER_CATS.some((c) => c.id === id) ? (id as FilterCat) : null
}
export const filtersIn = (cat: FilterCat): FilterItem[] => FILTERS.filter((f) => f.cats.includes(cat))

// ── 滤镜片段 ──
export function newFilterClip(id: string, filter: string): TlClip {
  return { id, mediaId: '', start: 0, length: FILTER_DEFAULT_SECONDS, offset: 0, filter: { filter, strength: FILTER_STRENGTH_DEFAULT } }
}
/** 点一款 ⇒ 放在播放头（滤镜轨照落点规划：主轨上面离主轨最近那条滤镜轨·那段被占／锁了 ⇒ 往上新增一条）；认不得的不动 */
export function addFilterAt(tr: Tracks, filter: string, at: number, mk: { id: () => string; laneId: () => string }): { tracks: Tracks; id: string | null } {
  if (!filterById(filter)) return { tracks: tr, id: null }
  const c = newFilterClip(mk.id(), filter)
  return { tracks: applyDrop(tr, planDrop(tr, 'filter', null, snapFrame(Math.max(0, at)), c.length), c, mk.laneId()), id: c.id }
}
/** 改强度（0～1·锁了的轨不改） */
export function setFilterStrength(tr: Tracks, id: string, strength: number): Tracks {
  const hit = findClip(tr, id)
  if (!hit || hit.lane.locked || !hit.clip.filter) return tr
  const v = Math.min(1, Math.max(0, Number.isFinite(strength) ? strength : 0))
  if (Math.abs(v - hit.clip.filter.strength) < 1e-9) return tr
  return tr.map((l) => (l !== hit.lane ? l : { ...l, clips: l.clips.map((c) => (c.id === id ? { ...c, filter: { ...c.filter!, strength: v } } : c)) }))
}
/** 这一层画面这一刻要套哪个滤镜：在它上面（轨道序号较小）、离它最近、这一刻有片段又没隐藏／停用的那条滤镜轨；没有 ⇒ null。
 *  layers＝layersAt 的结果（由上到下）；只对画面轨有意义。 */
/** strength＝这一刻的强度（滤镜片段打了强度关键帧 ⇒ 照关键帧·body 保持原物件好让页面比对） */
export function filterOverLayer(layers: readonly LayerState[], laneId: string): { body: FilterBody; item: FilterItem; strength: number } | null {
  const i = layers.findIndex((s) => s.lane.id === laneId)
  if (i < 0 || layers[i].lane.kind !== 'visual') return null
  for (let j = i - 1; j >= 0; j--) {
    const s = layers[j]
    if (s.lane.kind !== 'filter' || !s.show) continue
    const body = s.hit?.clip.filter
    const item = filterById(body?.filter)
    if (body && item) return { body, item, strength: filterStrengthAt(s.hit!.clip, 0, s.hit!.local) }
  }
  return null
}

// ── 收藏（贴纸、滤镜各一份·存帐号偏好）──
export type FavKind = 'sticker' | 'filter' | 'fx' | 'transition' // fx／transition＝特效／转场收藏
export const FAV_PREF_KEY: Record<FavKind, string> = { sticker: 'vedit_fav_stickers', filter: 'vedit_fav_filters', fx: 'vedit_fav_fx', transition: 'vedit_fav_transitions' }
export const FAV_MAX = 500
/** 读回：只留字串编号·去重·认得的（valid 给了就筛）·保持收藏先后（新收的在前） */
export function parseFavs(v: unknown, valid?: (id: string) => boolean): string[] {
  if (!Array.isArray(v)) return []
  const out: string[] = []
  for (const x of v) if (typeof x === 'string' && x && !out.includes(x) && (!valid || valid(x))) out.push(x)
  return out.slice(0, FAV_MAX)
}
/** 点星星：没收 ⇒ 收（放最前）；收了 ⇒ 拿掉 */
export function toggleFav(list: readonly string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [id, ...list].slice(0, FAV_MAX)
}

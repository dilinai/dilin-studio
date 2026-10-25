// 网页剪辑页·贴纸轨＋贴纸库。贴纸片段＝放在贴纸轨上的一段（TlClip.sticker·mediaId 空）：播放器上叠画那张 SVG·
//   停着时能拖位置、拉右下角改大小；轨道上能拉两端改长短（同图片）。顶 bar「貼紙」页签：左清单「收藏」＋「貼紙庫」（12 类）·右边贴纸格；
//   点一张 ⇒ 放在播放头；拖一张进轨道 ⇒ 照拖素材的落点规划放。
// 本档只放纯函数（题直接跑）；画在 video-edit/page.tsx 与 VeditAssetTabs.tsx。⛔ 碰 DOM。
import { studioStaticHref } from '../../shared/host'
import { STICKERS, STICKER_CATS, type StickerCat, type StickerItem } from './stickers.data'
import { applyDrop, findClip, planDrop, snapFrame, type StickerBody, type TextAnim, type TextAnimSlot, type TlClip, type Tracks } from './timeline.pure'
import { mergeTextAnim, type AnimPose } from './text-anim.pure'

/** 新放的贴纸多长（同图片·之后拉两端改） */
export const STICKER_DEFAULT_SECONDS = 3
/** 贴纸长边占画面高：缺省（1080p 画面三分之一）／最小／最大 */
export const STICKER_SIZE_DEFAULT = 1 / 3
export const STICKER_SIZE_MIN = 0.05
export const STICKER_SIZE_MAX = 1.5
/** 贴纸格拖进轨道时带的资料种类（值＝贴纸编号） */
export const STICKER_DRAG_MIME = 'application/x-dilin-vedit-sticker'

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const BY_ID = new Map(STICKERS.map((s) => [s.id, s]))
export const stickerById = (id: string | undefined): StickerItem | null => (id ? BY_ID.get(id) ?? null : null)
/** 贴纸图的网址（档在网站 public/vedit/stickers/·开源单页版走相对路径） */
export const stickerSrc = (s: Pick<StickerItem, 'file'>): string => studioStaticHref(s.file)
/** 贴纸名（照页面语言·认不得 ⇒ 编号） */
export function stickerName(id: string, lang: 'zh-TW' | 'zh-CN' | 'en'): string {
  const s = stickerById(id)
  return s ? s.name[lang === 'zh-CN' ? 'cn' : lang === 'en' ? 'en' : 'tw'] : id
}

// ── 左清单：贴纸库底下 12 类（编号 sticker-<类>）──
export const STICKER_CAT_PREFIX = 'sticker-'
export const stickerCatIds = (): string[] => STICKER_CATS.map((c) => STICKER_CAT_PREFIX + c.id)
export function stickerCatOf(pick: string): StickerCat | null {
  if (!pick.startsWith(STICKER_CAT_PREFIX)) return null
  const id = pick.slice(STICKER_CAT_PREFIX.length)
  return STICKER_CATS.some((c) => c.id === id) ? (id as StickerCat) : null
}
export const stickersIn = (cat: StickerCat): StickerItem[] => STICKERS.filter((s) => s.cats.includes(cat))

/** 画面上多大（单位＝画面高的比例）：长边＝size·照原始比例 */
export function stickerBox(item: Pick<StickerItem, 'w' | 'h'>, size: number): { w: number; h: number } {
  const long = Math.max(1, item.w, item.h)
  return { w: (size * item.w) / long, h: (size * item.h) / long }
}

// ── 贴纸片段 ──
export function newStickerClip(id: string, sticker: string): TlClip {
  return { id, mediaId: '', start: 0, length: STICKER_DEFAULT_SECONDS, offset: 0, sticker: { sticker, x: 0.5, y: 0.5, size: STICKER_SIZE_DEFAULT } }
}
/** 点一张贴纸 ⇒ 放在播放头（贴纸轨照落点规划：主轨上面离主轨最近那条贴纸轨·那段被占／锁了 ⇒ 往上新增一条）；认不得的贴纸不动 */
export function addStickerAt(tr: Tracks, sticker: string, at: number, mk: { id: () => string; laneId: () => string }): { tracks: Tracks; id: string | null } {
  if (!stickerById(sticker)) return { tracks: tr, id: null }
  const c = newStickerClip(mk.id(), sticker)
  return { tracks: applyDrop(tr, planDrop(tr, 'sticker', null, snapFrame(Math.max(0, at)), c.length), c, mk.laneId()), id: c.id }
}
function patchSticker(tr: Tracks, id: string, f: (b: StickerBody) => StickerBody): Tracks {
  const hit = findClip(tr, id)
  if (!hit || hit.lane.locked || !hit.clip.sticker) return tr
  const b = f(hit.clip.sticker)
  return tr.map((l) => (l !== hit.lane ? l : { ...l, clips: l.clips.map((c) => (c.id === id ? { ...c, sticker: b } : c)) }))
}
/** 画面上拖位置：中心落在 0～1 */
export const moveSticker = (tr: Tracks, id: string, x: number, y: number): Tracks =>
  patchSticker(tr, id, (b) => ({ ...b, x: clamp(x, 0, 1), y: clamp(y, 0, 1) }))
/** 拉右下角改大小 */
export const resizeSticker = (tr: Tracks, id: string, size: number): Tracks =>
  patchSticker(tr, id, (b) => ({ ...b, size: clamp(size, STICKER_SIZE_MIN, STICKER_SIZE_MAX) }))
// ── 贴纸动画 ──
// 存在片段身上的 anim（同画面片段 clip.anim·款式＝VISUAL_ANIM_LIB：文字动画库去掉打字类）；时间照 clipAnimPose（片段起点起算）。
// 姿势的位移单位＝贴纸长边（size·画面高的比例·同文字的 em 跟字号走）。预览（page.tsx·CSS）与汇出／出帧（VeditExport·Canvas）都只吃 stickerPose 这一份。
export type StickerPose = { dx: number; dy: number; rot: number; sx: number; sy: number; alpha: number }
/** 这一刻贴纸相对原位：dx／dy＝中心位移（画面高的比例·往右／往下为正）·rot＝度·sx／sy＝缩放·alpha＝不透明度 */
export function stickerPose(b: Pick<StickerBody, 'size'>, pose: AnimPose): StickerPose {
  return { dx: pose.tx * b.size, dy: pose.ty * b.size, rot: pose.rot, sx: pose.sx, sy: pose.sy, alpha: clamp(pose.alpha, 0, 1) }
}
/** 预览用 CSS transform（叠在 translate(-50%,-50%) 之后·cqh＝画面高的百分之一） */
export function stickerPoseCss(p: StickerPose): string {
  const r = (v: number) => Math.round(v * 10000) / 10000
  const parts = ['translate(-50%, -50%)']
  if (Math.abs(p.dx) > 1e-6 || Math.abs(p.dy) > 1e-6) parts.push(`translate(${r(p.dx * 100)}cqh, ${r(p.dy * 100)}cqh)`)
  if (Math.abs(p.rot) > 1e-6) parts.push(`rotate(${r(p.rot)}deg)`)
  if (Math.abs(p.sx - 1) > 1e-6 || Math.abs(p.sy - 1) > 1e-6) parts.push(`scale(${r(p.sx)}, ${r(p.sy)})`)
  return parts.join(' ')
}
/** 贴纸片段的动画改一格（null＝拿掉那格）；不是贴纸／锁着 ⇒ 原样 */
export function setStickerAnim(tr: Tracks, id: string, slot: TextAnimSlot, anim: TextAnim | null): Tracks {
  const hit = findClip(tr, id)
  if (!hit || hit.lane.locked || !hit.clip.sticker) return tr
  const a = mergeTextAnim(hit.clip.anim, { [slot]: anim })
  const { anim: _old, ...rest } = hit.clip
  void _old
  const n: TlClip = a ? { ...rest, anim: a } : rest
  return tr.map((l) => (l !== hit.lane ? l : { ...l, clips: l.clips.map((c) => (c.id === id ? n : c)) }))
}

/** 拉角改大小的换算：拖动的距离（画面高的比例）加到原长边上 */
export const stickerSizeFromDrag = (size0: number, dyFrac: number): number => clamp(size0 + dyFrac, STICKER_SIZE_MIN, STICKER_SIZE_MAX)

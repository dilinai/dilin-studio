/**
 * 组件清单的显示名与图标——纯函数·三语键在 translations/editors.ts 的 slc_*。
 * 名字优先序：用户起的名 ＞ 文字组件的前几个字 ＞ 语义角色（标题／副标题／条目 N…）＞ 种类（文字／图片…）。
 */

import type { ComponentRole, ComponentType, SlideComponent } from '../kit/components/types'
import { plainTextOf, textBodyOf } from '../kit/components/resolve'
/** 字串键（字典在 ../i18n-site.ts 与 ../i18n.ts） */
type TKey = string
import type { ComponentPptxReport } from '../pptx/pptx-components'

export const TYPE_ICON: Record<ComponentType, string> = {
  text: 'T', image: '🖼', video: '🎬', shape: '◆', table: '▦', chart: '📊', html: '⌘', group: '⧉', program: '✦',
}

export const typeKey = (type: ComponentType): TKey => `slc_type_${type}` as TKey

const ROLE_KEY: Partial<Record<ComponentRole, TKey>> = {
  title: 'slc_role_title', subtitle: 'slc_role_subtitle', lead: 'slc_role_lead', eyebrow: 'slc_role_eyebrow',
  item: 'slc_role_item', itemNumber: 'slc_role_item_number', partNumber: 'slc_role_part_number',
  contentsTitle: 'slc_role_title', contentsItem: 'slc_role_item', footer: 'slc_role_footer', decor: 'slc_role_decor',
  card: 'slc_role_card', background: 'slc_role_background', backgroundMask: 'slc_role_background_mask',
  pageFigure: 'slc_role_figure', itemFigure: 'slc_role_figure', legacyHtml: 'slc_role_legacy_html',
}

/** 清单上显示的名字 */
export function componentLabel(c: SlideComponent, t: (k: TKey) => string): string {
  if (c.name && c.name.trim()) return c.name.trim()
  const body = textBodyOf(c)
  const text = body ? plainTextOf(body.paragraphs).replace(/\s+/g, ' ').trim() : ''
  const roleKey = c.role ? ROLE_KEY[c.role] : undefined
  const idx = typeof c.roleIndex === 'number' ? ` ${c.roleIndex + 1}` : ''
  const base = roleKey ? `${t(roleKey)}${c.role === 'item' || c.role === 'contentsItem' || c.role === 'itemNumber' || c.role === 'card' || c.role === 'itemFigure' ? idx : ''}` : t(typeKey(c.type))
  if (text) return `${base}：${text.length > 18 ? `${text.slice(0, 18)}…` : text}`
  return base
}

/** 空文字框在画布上的提示字（编辑器模式） */
export function placeholderKey(c: SlideComponent): TKey | undefined {
  if (c.type !== 'text' && !(c.type === 'shape' && c.text)) return undefined
  if (c.role === 'title' || c.role === 'contentsTitle') return 'slc_ph_title'
  if (c.role === 'subtitle' || c.role === 'lead') return 'slc_ph_subtitle'
  return 'slc_ph_text'
}

/**
 * 左栏「大綱」的副行（已物化的页＝组件里的纯文字·按叠层由下到上·标题类不重复列；没物化 ⇒ null＝照旧读 draft）。
 * 标题仍取 draft（标题类组件改字会回写 draft）。
 */
export function pageSummaryLines(components: readonly SlideComponent[] | undefined, max = 3): string[] | null {
  if (!Array.isArray(components)) return null
  const out: string[] = []
  // 组合里的字也算（按组内叠层）
  const flat = components.flatMap((c) => (c.type === 'group' ? (c.hidden ? [] : c.children) : [c]))
  for (const c of flat) {
    if (c.hidden || c.role === 'title' || c.role === 'contentsTitle' || c.role === 'decor') continue
    const body = textBodyOf(c)
    if (!body) continue
    const text = plainTextOf(body.paragraphs).replace(/\s+/g, ' ').trim()
    if (text) out.push(text)
    if (out.length >= max) break
  }
  return out
}

/** 组件版 pptx 导出后的退化报告（只列真的发生了的） */
export function pptxReportLines(r: ComponentPptxReport, t: (k: TKey) => string): string[] {
  const out: string[] = []
  const n = (k: TKey, v: number) => { if (v) out.push(t(k).replace('{n}', String(v))) }
  n('slc_pptx_r_video_big', r.videoTooBig)
  n('slc_pptx_r_video_fetch', r.videoFetchFailed)
  n('slc_pptx_r_video_fmt', r.videoFormat)
  n('slc_pptx_r_media_dropped', r.mediaStepsDropped)
  n('slc_pptx_r_seek_folded', r.mediaSeekFolded)
  n('slc_pptx_r_anim_missing', r.animMissing)
  n('slc_pptx_r_prog_skipped', r.programsNotExported - r.recordNoCanvas - r.recordNoMp4 - r.recordFailed)
  n('slc_pptx_r_rec_canvas', r.recordNoCanvas)
  n('slc_pptx_r_rec_mp4', r.recordNoMp4)
  n('slc_pptx_r_rec_failed', r.recordFailed)
  n('slc_pptx_r_clip_bg', r.clipsOpaqueBg)
  n('slc_pptx_r_clip_failed', r.clipsFailed)
  n('slc_pptx_r_clip_timeout', r.clipsTimedOut)
  n('slc_pptx_r_prog_extra', r.programStepsIgnored)
  n('slc_pptx_r_prog_failed', r.programStepsFailed - r.clipsFailed)   // 录失败的那几步上面已列
  n('slc_pptx_r_cue_delay', r.cuesAsDelay)
  n('slc_pptx_r_cue_dropped', r.cuesDropped)
  if (r.rotationDropped) out.push(t('slc_pptx_r_rotation').replace('{n}', String(r.rotationDropped)))
  if (r.imagesSkipped) out.push(t('slc_pptx_r_images').replace('{n}', String(r.imagesSkipped)))
  if (r.videoBackgrounds) out.push(t('slc_pptx_r_video_bg').replace('{n}', String(r.videoBackgrounds)))
  if (r.blurDropped) out.push(t('slc_pptx_r_blur').replace('{n}', String(r.blurDropped)))
  if (r.groupsFlattened) out.push(t('slc_pptx_r_groups').replace('{n}', String(r.groupsFlattened)))
  return out
}

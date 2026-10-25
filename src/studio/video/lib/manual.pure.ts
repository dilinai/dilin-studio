// 网页剪辑页·右栏「AI」「人工」两页签：
//   AI＝原本的角色对话（不变）；人工＝自己动手调属性的面板。·
//   ⇒ 人工页顶上只有「文本／动画／朗读」三页：文本页做完整；动画页只留页签＋占位（之后接手）；朗读页写「还没做」。
// 本档只放纯函数（题直接跑）；画在 video-edit/VeditManualPane.tsx。⛔ 碰 DOM。
import { findClip, type TextBody, type Tracks } from './timeline.pure'
import { editableTextIds } from './text.pure'
import type { TextPatch } from './text-style.pure'

export type SideTab = 'ai' | 'manual'
export const SIDE_TABS: readonly SideTab[] = ['ai', 'manual']
/** 记住上次选哪页（存本机·照「雲端硬碟」眼睛钮那种做法） */
export const VEDIT_SIDE_TAB_KEY = 'dilinai:vedit-side-tab'
export const parseSideTab = (raw: string | null | undefined): SideTab => (raw === 'manual' ? 'manual' : 'ai')

/** 人工页顶上三页（跟踪、数字人说不用） */
export type ManualTab = 'text' | 'anim' | 'tts'
export const MANUAL_TABS: readonly ManualTab[] = ['text', 'anim', 'tts']
/** 文本页底下两小页：基础（属性）／花字（接现有花字库）——剪映还有「气泡」·这次没做 */
export type TextSubTab = 'basic' | 'fancy' | 'bubble'
export const TEXT_SUB_TABS: readonly TextSubTab[] = ['basic', 'fancy', 'bubble'] // bubble＝气泡

/** 面板改动的「即时值」与「放手」（照页面现有滑杆：拖的时候只即时看·放手才进一步复原）：
 *  commit=false ⇒ 记成即时值（同一批段落连着拖 ⇒ 并在一起）·不进复原栈；
 *  commit=true ⇒ 并上还没放手的即时值（例如数字框打了没离开就按了别的钮）一次交出去·套到即时值当时那几段（没有即时值 ⇒ 现在选的）。 */
export type TextLive = { ids: string[]; patch: TextPatch }
export function textLiveStep(prev: TextLive | null, cur: readonly string[], p: TextPatch, commit: boolean): { live: TextLive | null; commit: TextLive | null } {
  const same = !!prev && prev.ids.join(',') === cur.join(',')
  if (!commit) return cur.length ? { live: { ids: [...cur], patch: same ? { ...prev!.patch, ...p } : p }, commit: null } : { live: prev, commit: null }
  const ids = prev ? prev.ids : [...cur]
  return { live: null, commit: ids.length ? { ids, patch: prev ? { ...prev.patch, ...p } : p } : null }
}

/** 人工页文本栏要显示什么：没选中能改的文字片段 ⇒ none（写一句提示）；有 ⇒ 那几段的编号＋面板照哪段的值显示（最后选的那段） */
export type ManualTextState = { kind: 'none' } | { kind: 'text'; ids: string[]; body: TextBody }
export function manualTextState(tr: Tracks, sel: readonly string[]): ManualTextState {
  const ids = editableTextIds(tr, sel)
  if (!ids.length) return { kind: 'none' }
  return { kind: 'text', ids, body: findClip(tr, ids[ids.length - 1])!.clip.text! }
}

// 读档时丢掉或改掉的条目（format.ts VideoDrop）⇒ 给人看的一句（按界面语言·字串在 i18n.guest.ts）。
import type { StudioT } from '../shared/types'
import type { VideoDrop } from './format'
import type { VideoGuestKey } from './i18n'

export const DROP_KEY: Record<VideoDrop['code'], VideoGuestKey> = {
  media_bad_id: 'vedit_guest_drop_media_bad_id',
  media_dup: 'vedit_guest_drop_media_dup',
  media_bad_kind: 'vedit_guest_drop_media_bad_kind',
  media_no_drive: 'vedit_guest_drop_media_no_drive',
  media_not_object: 'vedit_guest_drop_media_not_object',
  media_bad_file: 'vedit_guest_drop_media_bad_file',
  lane_bad_id: 'vedit_guest_drop_lane_bad_id',
  lane_bad_kind: 'vedit_guest_drop_lane_bad_kind',
  lane_moved_audio: 'vedit_guest_drop_lane_moved_audio',
  clip_bad_shape: 'vedit_guest_drop_clip_bad_shape',
  clip_no_media: 'vedit_guest_drop_clip_no_media',
  clip_no_body: 'vedit_guest_drop_clip_no_body',
  clip_overlap: 'vedit_guest_drop_clip_overlap',
  group_bad: 'vedit_guest_drop_group_bad',
  group_renamed: 'vedit_guest_drop_group_renamed',
  ref_unknown: 'vedit_guest_drop_ref_unknown',
  ref_unknown_kept: 'vedit_guest_drop_ref_unknown_kept',
  ratio_unknown: 'vedit_guest_drop_ratio_unknown',
  parent_bad: 'vedit_guest_drop_parent_bad',
  parent_loop: 'vedit_guest_drop_parent_loop',
  expr_bad: 'vedit_guest_drop_expr_bad',
  clip_no_comp: 'vedit_guest_drop_clip_no_comp',
  comp_bad: 'vedit_guest_drop_comp_bad',
  comp_cycle: 'vedit_guest_drop_comp_cycle',
  comp_deep: 'vedit_guest_drop_comp_deep',
  matte_bad_ref: 'vedit_guest_drop_matte_bad_ref',
  not_json: 'vedit_guest_drop_not_json',
  not_object: 'vedit_guest_drop_not_object',
}

export function dropText(t: StudioT, d: VideoDrop): string {
  const vars: Record<string, string> = {}
  for (const [k, v] of Object.entries(d)) if (k !== 'code' && typeof v === 'string') vars[k] = v
  return t(DROP_KEY[d.code], vars)
}

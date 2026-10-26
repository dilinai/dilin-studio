// 剪辑工程 ⇒ 剪映专业版草稿（draft_content.json＋draft_meta_info.json·不加密的新建草稿·剪映 6 以后照样认）。
// 栏位照开源 pyJianYingDraft（GuanYixuan/pyJianYingDraft·MIT）新建草稿那一套：时间一律微秒；素材在 materials，
// 轨道片段拿 material_id 指过去；变速、淡入淡出也是 materials 里的一笔，片段用 extra_material_refs 挂上。
// 素材路径用剪映自己的「草稿资料夹」占位符 ⇒ 整个工程资料夹（project.json、assets/、这两份）放进剪映草稿目录就开得起来。
// 带得过去：画面轨／音频轨的素材片段（起点、长度、入点、变速倍数、音量静音、声音淡入淡出、停用）、文字（内容、位置、字级、字色、粗斜底线）。
// 带不过去（列在 notes）：转场、特效滤镜、花字款式、贴纸、形状纯色、程序片段、蒙版与画面属性、曲线变速、倒放定格。
import type { VideoDoc } from '../format'
import { MAIN_LANE, type TlClip } from './timeline.pure'
import { fcpxmlSize } from './fcpxml.pure'

/** 剪映草稿里代表「这份草稿资料夹」的占位符（剪映自己存草稿时也这样写素材路径） */
export const JY_DRAFT_ROOT = '##_draftpath_placeholder_0E685133-18CE-45ED-8CB8-2904A212EC80_##'
export const JY_CONTENT = 'draft_content.json'
export const JY_META = 'draft_meta_info.json'

const US = 1_000_000
const us = (sec: number) => Math.max(0, Math.round(sec * US))
const rgb = (hex: string | undefined): [number, number, number] => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? '')
  if (!m) return [1, 1, 1]
  const n = parseInt(m[1], 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

type Json = Record<string, unknown>

export function docToJianying(doc: VideoDoc, o: { mediaRoot?: string; seed?: string; now?: number; os?: 'windows' | 'mac'; app?: 'jianying' | 'capcut' } = {}): { content: Json; meta: Json; notes: string[] } {
  const root = o.mediaRoot ?? JY_DRAFT_ROOT
  const seed = (o.seed ?? 'd11e').replace(/[^0-9a-f]/gi, '').slice(0, 8).padEnd(8, '0')
  let n = 0
  const id = () => `${seed}${(++n).toString(16).padStart(24, '0')}`.toUpperCase()
  const { w, h } = fcpxmlSize(doc.ratio)
  const notes = new Set<string>()
  const mediaById = new Map(doc.media.map((m) => [m.id, m]))
  const videos: Json[] = [], audios: Json[] = [], texts: Json[] = [], speeds: Json[] = [], fades: Json[] = []
  const matOf = new Map<string, string>()
  const material = (mid: string): string | null => {
    const m = mediaById.get(mid)
    if (!m) return null
    const kind = m.kind === 'audio' || m.noPicture ? 'audio' : m.kind === 'image' ? 'photo' : 'video'
    const key = `${kind}:${m.id}`
    const had = matOf.get(key)
    if (had) return had
    const mat = id(), path = `${root}/assets/${m.file}`, dur = us(m.duration || 0) || 10_800 * US
    if (kind === 'audio') audios.push({ app_id: 0, category_id: '', category_name: 'local', check_flag: 3, copyright_limit_type: 'none', duration: dur, effect_id: '', formula_id: '', id: mat, local_material_id: mat, music_id: mat, name: m.name, path, source_platform: 0, type: 'extract_music', wave_points: [] })
    else videos.push({ audio_fade: null, category_id: '', category_name: 'local', check_flag: 63487, crop: { upper_left_x: 0, upper_left_y: 0, upper_right_x: 1, upper_right_y: 0, lower_left_x: 0, lower_left_y: 1, lower_right_x: 1, lower_right_y: 1 }, crop_ratio: 'free', crop_scale: 1, duration: dur, height: h, id: mat, local_material_id: '', material_id: mat, material_name: m.name, media_path: '', path, type: kind, width: w })
    matOf.set(key, mat)
    return mat
  }
  const base = (segId: string, mat: string, c: TlClip) => ({
    enable_adjust: true, enable_color_correct_adjust: false, enable_color_curves: true, enable_color_match_adjust: false, enable_color_wheels: true, enable_lut: true, enable_smart_color_adjust: false,
    last_nonzero_volume: 1, reverse: false, track_attribute: 0, track_render_index: 0, visible: !c.disabled,
    id: segId, material_id: mat, target_timerange: { start: us(c.start), duration: Math.max(1, us(c.length)) }, common_keyframes: [], keyframe_refs: [],
  })
  const clip = () => ({ alpha: 1, flip: { horizontal: false, vertical: false }, rotation: 0, scale: { x: 1, y: 1 }, transform: { x: 0, y: 0 } })

  const seg = (c: TlClip, audioLane: boolean): Json | null => {
    if (c.transIn) notes.add('transition')
    if (c.fx?.length) notes.add('fx')
    if (c.look) notes.add('look')
    if (c.curve) notes.add('curve')
    if (c.reverse || c.freeze) notes.add('reverse-freeze')
    if (c.sticker) { notes.add('sticker'); return null }
    if (c.filter || c.adjust) { notes.add('filter'); return null }
    if (c.program) { notes.add('program'); return null }
    if (c.shape || c.solid || c.bgfx || c.rig) { notes.add('shape'); return null }
    if (c.text) {
      const t = c.text, mat = id()
      if (t.fancy) notes.add('fancy')
      const size = Math.max(1, +((t.size > 0 && t.size <= 1 ? t.size : 0.08) * 100).toFixed(2))
      const style = { fill: { alpha: 1, content: { render_type: 'solid', solid: { alpha: 1, color: rgb(t.color) } } }, range: [0, [...t.content].length], size, bold: !!t.bold, italic: !!t.italic, underline: !!t.underline, strokes: [] }
      texts.push({ id: mat, content: JSON.stringify({ styles: [style], text: t.content }), typesetting: 0, alignment: t.align === 'left' ? 0 : t.align === 'right' ? 2 : 1, letter_spacing: 0, line_spacing: 0.02, line_feed: 1, line_max_width: 0.82, force_apply_line_max_width: false, check_flag: 7, type: 'text', global_alpha: t.opacity ?? 1 })
      const spd = id(); speeds.push({ curve_speed: null, id: spd, mode: 0, speed: 1, type: 'speed' })
      return { ...base(id(), mat, c), source_timerange: null, speed: 1, volume: 1, extra_material_refs: [spd], is_tone_modify: false, clip: { ...clip(), transform: { x: +(t.x * 2 - 1).toFixed(4), y: +(1 - t.y * 2).toFixed(4) } }, uniform_scale: { on: true, value: 1 } }
    }
    const mat = material(c.mediaId)
    if (!mat) return null
    const m = mediaById.get(c.mediaId)!
    const sp = c.speed && c.speed > 0 ? c.speed : 1
    const spd = id(); speeds.push({ curve_speed: null, id: spd, mode: 0, speed: sp, type: 'speed' })
    const refs = [spd]
    if ((c.fadeIn ?? 0) > 0 || (c.fadeOut ?? 0) > 0) { const f = id(); fades.push({ id: f, fade_in_duration: us(c.fadeIn ?? 0), fade_out_duration: us(c.fadeOut ?? 0), fade_type: 0, type: 'audio_fade' }); refs.push(f) }
    const isAudio = audioLane || m.kind === 'audio' || !!m.noPicture
    const out: Json = { ...base(id(), mat, c), source_timerange: m.kind === 'image' ? { start: 0, duration: Math.max(1, us(c.length)) } : { start: us(c.offset), duration: Math.max(1, us(c.length * sp)) }, speed: sp, volume: c.muted ? 0 : c.volume ?? 1, extra_material_refs: refs, is_tone_modify: !!c.pitch }
    return isAudio ? { ...out, clip: null, hdr_settings: null } : { ...out, clip: clip(), uniform_scale: { on: true, value: 1 }, hdr_settings: { intensity: 1, mode: 1, nits: 1000 } }
  }

  // 剪映轨道：主轨第一条（主视频轨），其余画面轨照由下往上叠、文字轨、音频轨；同轨片段由早到晚且不重叠
  const mainIdx = Math.max(0, doc.tracks.findIndex((l) => l.id === MAIN_LANE))
  const order = [mainIdx, ...doc.tracks.map((_, i) => i).filter((i) => i !== mainIdx).reverse()]
  const tracks: Json[] = []
  for (const i of order) {
    const lane = doc.tracks[i]
    const isAudio = lane.kind === 'audio'
    const groups = new Map<string, Json[]>()
    let last = new Map<string, number>()
    for (const c of [...lane.clips].sort((a, b) => a.start - b.start)) {
      const s = seg(c, isAudio)
      if (!s) continue
      const type = c.text ? 'text' : isAudio || (s as { clip: unknown }).clip === null ? 'audio' : 'video'
      const end = us(c.start + c.length)
      if ((last.get(type) ?? 0) > us(c.start)) { notes.add('overlap'); continue }
      last.set(type, end)
      if (!groups.has(type)) groups.set(type, [])
      groups.get(type)!.push(s)
    }
    for (const [type, segs] of groups) tracks.push({ attribute: lane.muted ? 1 : 0, flag: 0, id: id(), is_default_name: true, name: '', segments: segs, type })
    last = new Map()
  }
  tracks.forEach((t, k) => { for (const s of t.segments as Json[]) { s.render_index = k; s.track_render_index = 0 } })
  const duration = Math.max(0, ...tracks.flatMap((t) => (t.segments as { target_timerange: { start: number; duration: number } }[]).map((s) => s.target_timerange.start + s.target_timerange.duration)))

  // 主轨磁吸关掉：开着剪映会把主轨片段之间的空档吃掉（Windows 剪映 11.6 如此）
  // CapCut 国际版：同一套草稿·只是平台栏写 CapCut 自己的（app_source cc）
  const plat = o.app === 'capcut' ? { app_id: 359289, app_source: 'cc', app_version: '5.9.0', os: o.os ?? 'windows' } : { app_id: 3704, app_source: 'lv', app_version: '5.9.0', os: o.os ?? 'windows' }
  const empty = (ks: string[]) => Object.fromEntries(ks.map((k) => [k, []]))
  const content: Json = {
    // 画幅照工程写死：剪映自己存「自订画幅」就是 ratio custom＋宽高；original＝跟着第一段素材走（直式素材一混进来比例就跑掉）
    canvas_config: { height: h, ratio: 'custom', width: w },
    color_space: 0,
    config: { adjust_max_index: 1, attachment_info: [], combination_max_index: 1, export_range: null, extract_audio_last_index: 1, lyrics_recognition_id: '', lyrics_sync: true, lyrics_taskinfo: [], maintrack_adsorb: false, material_save_mode: 0, multi_language_current: 'none', multi_language_list: [], multi_language_main: 'none', multi_language_mode: 'none', original_sound_last_index: 1, record_audio_last_index: 1, sticker_max_index: 1, subtitle_keywords_config: null, subtitle_recognition_id: '', subtitle_sync: true, subtitle_taskinfo: [], system_font_list: [], video_mute: false, zoom_info_params: null },
    cover: null, create_time: 0, duration, extra_info: null, fps: 30, free_render_index_mode_on: false, group_container: null, id: id(),
    keyframe_graph_list: [], keyframes: empty(['adjusts', 'audios', 'effects', 'filters', 'handwrites', 'stickers', 'texts', 'videos']),
    last_modified_platform: plat,
    platform: plat,
    materials: {
      ...empty(['ai_translates', 'audio_balances', 'audio_effects', 'audio_track_indexes', 'beats', 'canvases', 'chromas', 'common_mask', 'color_curves', 'digital_humans', 'drafts', 'effects', 'flowers', 'green_screens', 'handwrites', 'hsl', 'images', 'log_color_wheels', 'loudnesses', 'manual_deformations', 'masks', 'material_animations', 'material_colors', 'multi_language_refs', 'placeholders', 'plugin_effects', 'primary_color_wheels', 'realtime_denoises', 'shapes', 'smart_crops', 'smart_relights', 'sound_channel_mappings', 'stickers', 'tail_leaders', 'text_templates', 'time_marks', 'transitions', 'video_effects', 'video_trackings', 'vocal_beautifys', 'vocal_separations']),
      audio_fades: fades, audios, speeds, texts, videos,
    },
    mutable_config: null, name: '', new_version: '110.0.0', relationships: [], render_index_track_mode_on: false, retouch_cover: null, source: 'default', static_cover_image_path: '', time_marks: null,
    tracks, update_time: 0, version: 360000,
  }
  const meta: Json = {
    cloud_package_completed_time: '', draft_cloud_capcut_purchase_info: '', draft_cloud_last_action_download: false, draft_cloud_materials: [], draft_cloud_purchase_info: '', draft_cloud_template_id: '', draft_cloud_tutorial_info: '', draft_cloud_videocut_purchase_info: '', draft_cover: '', draft_deeplink_url: '',
    draft_enterprise_info: { draft_enterprise_extra: '', draft_enterprise_id: '', draft_enterprise_name: '', enterprise_material: [] },
    draft_fold_path: '', draft_id: id(), draft_is_ai_packaging_used: false, draft_is_ai_shorts: false, draft_is_ai_translate: false, draft_is_article_video_draft: false, draft_is_from_deeplink: 'false', draft_is_invisible: false,
    draft_materials: [0, 1, 2, 3, 6, 7, 8].map((type) => ({ type, value: [] })), draft_materials_copied_info: [], draft_name: doc.name || 'Dilin Studio', draft_new_version: '', draft_removable_storage_device: '', draft_root_path: '', draft_segment_extra_info: [], draft_type: '',
    tm_draft_cloud_completed: '', tm_draft_cloud_modified: 0, tm_draft_create: o.now ?? 0, tm_draft_modified: o.now ?? 0, tm_draft_removed: 0, tm_duration: duration,
  }
  return { content, meta, notes: [...notes] }
}

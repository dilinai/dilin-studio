// 网页剪辑页·素材区顶 bar 的「文本／特效／转场／字幕」四个页签（「文本 特效 转场 字幕 先把前端照抄 包含左边那个竖清单
//   内容先留空 前端先出来」·附四张剪映专业版截图）。本档＝四个页签各自的左竖清单（分类名照截图逐字抄·可展开的带箭头）＋开关算法。
//   画法在 video-edit/VeditAssetTabs.tsx。⛔ 本档碰 DOM／React（题直接 require）。
// 截图里没展开过的分组（文本：我的／花字库／文字模板／智能文本·特效：人物特效·字幕：字幕模板）子项不明 ⇒ children＝[]·展开后只显一行「即將推出」。
import type { VideoKey as TKey } from '../i18n'

export type AssetTab = 'audio' | 'text' | 'sticker' | 'fx' | 'transition' | 'caption' | 'filter' | 'program' // audio＝音频（内建音效＋录音）
/** 顶 bar 排法照剪映：素材｜（音频）｜文本｜贴纸｜特效｜转场｜字幕｜滤镜 ⇒ 我们没有音频（贴纸 ·滤镜 加上） */
export const ASSET_TABS: readonly AssetTab[] = ['audio', 'text', 'sticker', 'fx', 'transition', 'caption', 'filter', 'program'] // program＝程序片段（剪映没有·排最后）

export type CatItem = { id: string; label: TKey }
/** children 有给 ⇒ 可展开的分组（带箭头）；[]＝截图里没展开过·子项不明 */
export type CatNode = CatItem & { children?: readonly CatItem[] }
export type TabSpec = {
  label: TKey
  /** 右边内容区顶上的搜寻框（截图里有的才有：特效、转场） */
  search: TKey | null
  nodes: readonly CatNode[]
  /** 一开页签选中的分类（照截图里亮青色那一格） */
  pick: string
  /** 一开页签就展开的分组（照截图） */
  open: readonly string[]
}

const c = (id: string, label: TKey): CatItem => ({ id, label })
const g = (id: string, label: TKey, children: readonly CatItem[]): CatNode => ({ id, label, children })

export const ASSET_TAB_SPEC: Record<AssetTab, TabSpec> = {
  // 「音频」：音效素材（自己合成的四类·sfx-lib.pure）｜录音
  audio: {
    label: 'vedit_top_audio',
    search: null,
    nodes: [
      g('audio-sfx', 'vedit_audio_sfx', [c('audio-sfx-transition', 'vedit_audio_cat_transition'), c('audio-sfx-ui', 'vedit_audio_cat_ui'), c('audio-sfx-impact', 'vedit_audio_cat_impact'), c('audio-sfx-mood', 'vedit_audio_cat_mood')]),
      c('audio-rec', 'vedit_audio_rec'),
    ],
    pick: 'audio-sfx-transition',
    open: ['audio-sfx'],
  },
  // 截图 074252：新建文本｜我的▾｜智能包装｜花字库▾｜文字模板▾｜智能文本▾
  text: {
    label: 'vedit_top_text',
    search: null,
    nodes: [
      // 只留「新建文本」「花字库」（我的／智能包装／文字模板／智能文本拿掉）
      c('new', 'vedit_cat_text_new'),
      //（附图）：花字库展开＝那套 15 类（编号 fancy-<类>·同 fancy-text.data FANCY_CATS·款式格画在 VeditAssetTabs）
      g('fancy', 'vedit_cat_text_fancy', [
        c('fancy-hot', 'vedit_fancy_cat_hot'),
        c('fancy-new', 'vedit_fancy_cat_new'),
        c('fancy-autumn', 'vedit_fancy_cat_autumn'),
        c('fancy-variety', 'vedit_fancy_cat_variety'),
        c('fancy-guofeng', 'vedit_fancy_cat_guofeng'),
        c('fancy-glow', 'vedit_fancy_cat_glow'),
        c('fancy-gradient', 'vedit_fancy_cat_gradient'),
        c('fancy-texture', 'vedit_fancy_cat_texture'),
        c('fancy-red', 'vedit_fancy_cat_red'),
        c('fancy-yellow', 'vedit_fancy_cat_yellow'),
        c('fancy-mono', 'vedit_fancy_cat_mono'),
        c('fancy-blue', 'vedit_fancy_cat_blue'),
        c('fancy-pink', 'vedit_fancy_cat_pink'),
        c('fancy-green', 'vedit_fancy_cat_green'),
        c('fancy-purple', 'vedit_fancy_cat_purple'),
      ]),
    ],
    pick: 'new',
    open: [],
  },
  // ＋：左清单＝收藏｜贴纸库▴（那套 12 类·编号 sticker-<类>·同 stickers.data STICKER_CATS）
  //   收藏＝卡上点星星·存帐号偏好（filter.pure FAV_PREF_KEY·同滤镜那份做法）
  sticker: {
    label: 'vedit_top_sticker',
    search: null,
    nodes: [
      c('sticker-fav', 'vedit_cat_fav'),
      g('sticker-lib', 'vedit_sticker_lib', [
        c('sticker-hot', 'vedit_sticker_cat_hot'),
        c('sticker-new', 'vedit_sticker_cat_new'),
        c('sticker-festival', 'vedit_sticker_cat_festival'),
        c('sticker-emotion', 'vedit_sticker_cat_emotion'),
        c('sticker-interact', 'vedit_sticker_cat_interact'),
        c('sticker-arrow', 'vedit_sticker_cat_arrow'),
        c('sticker-cover', 'vedit_sticker_cat_cover'),
        c('sticker-summer', 'vedit_sticker_cat_summer'),
        c('sticker-autumn', 'vedit_sticker_cat_autumn'),
        c('sticker-vlog', 'vedit_sticker_cat_vlog'),
        c('sticker-shop', 'vedit_sticker_cat_shop'),
        c('sticker-animal', 'vedit_sticker_cat_animal'),
      ]),
    ],
    pick: 'sticker-hot',
    open: ['sticker-lib'],
  },
  // （附图＝剪映专业版「滤镜」）：左清单＝收藏｜滤镜库▴（那套 15 类·编号 filter-<类>·同 filters.data FILTER_CATS）
  // 的轨道种类」·：左清单＝内建｜我上传的（剪映没有这一栏·施工暂定）
  program: {
    label: 'vedit_top_program',
    search: null,
    nodes: [c('program-builtin', 'vedit_prog_builtin'), c('program-mine', 'vedit_prog_mine')],
    pick: 'program-builtin',
    open: [],
  },
  filter: {
    label: 'vedit_top_filter',
    search: null,
    nodes: [
      c('filter-fav', 'vedit_cat_fav'),
      g('filter-lib', 'vedit_filter_lib', [
        c('filter-hot', 'vedit_filter_cat_hot'),
        c('filter-new', 'vedit_filter_cat_new'),
        c('filter-portrait', 'vedit_filter_cat_portrait'),
        c('filter-landscape', 'vedit_filter_cat_landscape'),
        c('filter-food', 'vedit_filter_cat_food'),
        c('filter-night', 'vedit_filter_cat_night'),
        c('filter-cinema', 'vedit_filter_cat_cinema'),
        c('filter-film', 'vedit_filter_cat_film'),
        c('filter-mono', 'vedit_filter_cat_mono'),
        c('filter-camera', 'vedit_filter_cat_camera'),
        c('filter-stylized', 'vedit_filter_cat_stylized'),
        c('filter-indoor', 'vedit_filter_cat_indoor'),
        c('filter-outdoor', 'vedit_filter_cat_outdoor'),
        c('filter-basic', 'vedit_filter_cat_basic'),
        c('filter-season', 'vedit_filter_cat_season'),
      ]),
    ],
    pick: 'filter-hot',
    open: ['filter-lib'],
  },
  // 截图 074257：收藏｜画面特效▴（热门…复古）｜人物特效▾
  fx: {
    label: 'vedit_top_fx',
    search: 'vedit_fx_search',
    nodes: [
      c('fav', 'vedit_cat_fav'),
      g('scene', 'vedit_cat_fx_scene', [
        c('scene-hot', 'vedit_cat_hot'),
        c('scene-national', 'vedit_cat_fx_national'),
        c('scene-midautumn', 'vedit_cat_fx_midautumn'),
        c('scene-trip', 'vedit_cat_trip'),
        c('scene-basic', 'vedit_cat_fx_basic'),
        c('scene-dynamic', 'vedit_cat_fx_dynamic'),
        c('scene-mood', 'vedit_cat_fx_mood'),
        c('scene-cool', 'vedit_cat_fx_cool'),
        c('scene-border', 'vedit_cat_fx_border'),
        c('scene-multi', 'vedit_cat_fx_multi'),
        c('scene-sound', 'vedit_cat_fx_sound'),
        c('scene-light', 'vedit_cat_fx_light'),
        c('scene-love', 'vedit_cat_fx_love'),
        c('scene-audio', 'vedit_cat_fx_audio'),
        c('scene-nature', 'vedit_cat_nature'),
        c('scene-gold', 'vedit_cat_fx_gold'),
        c('scene-retro', 'vedit_cat_fx_retro'),
      ]),
      g('body', 'vedit_cat_fx_body', []),
    ],
    pick: 'scene-hot',
    open: ['scene'],
  },
  // 截图 074303：收藏｜转场效果▴（热门…互动emoji）
  transition: {
    label: 'vedit_top_transition',
    search: 'vedit_transition_search',
    nodes: [
      c('fav', 'vedit_cat_fav'),
      g('effects', 'vedit_cat_tr_effects', [
        c('effects-hot', 'vedit_cat_hot'),
        c('effects-trip', 'vedit_cat_trip'),
        c('effects-oneshot', 'vedit_cat_tr_ai_oneshot'),
        c('effects-dissolve', 'vedit_cat_tr_dissolve'),
        c('effects-slides', 'vedit_cat_tr_slides'),
        c('effects-camera', 'vedit_cat_tr_camera'),
        c('effects-blur', 'vedit_cat_tr_blur'),
        c('effects-new', 'vedit_cat_tr_new'),
        c('effects-light', 'vedit_cat_tr_light'),
        c('effects-shoot', 'vedit_cat_tr_shoot'),
        c('effects-warp', 'vedit_cat_tr_warp'),
        c('effects-glitch', 'vedit_cat_tr_glitch'),
        c('effects-split', 'vedit_cat_tr_split'),
        c('effects-nature', 'vedit_cat_nature'),
        c('effects-variety', 'vedit_cat_tr_variety'),
        c('effects-mg', 'vedit_cat_tr_mg'),
        c('effects-emoji', 'vedit_cat_tr_emoji'),
      ]),
    ],
    pick: 'effects-hot',
    open: ['effects'],
  },
  // 截图 074308：智能识别▴（识别字幕｜歌词识别）——：字幕模板／智能包装／新建字幕拿掉（都还没内容）
  caption: {
    label: 'vedit_top_caption',
    search: null,
    nodes: [
      g('smart', 'vedit_cat_cap_smart', [
        c('smart-recognize', 'vedit_cat_cap_recognize'),
        c('smart-lyrics', 'vedit_cat_cap_lyrics'),
      ]),
    ],
    pick: 'smart-recognize',
    open: ['smart'],
  },
}

export function isAssetTab(x: string): x is AssetTab {
  return (ASSET_TABS as readonly string[]).includes(x)
}

export type AssetSideState = { pick: string; open: readonly string[] }
export const initialSide = (tab: AssetTab): AssetSideState => ({ pick: ASSET_TAB_SPEC[tab].pick, open: ASSET_TAB_SPEC[tab].open })

/** 点分组标题 ⇒ 展开／收起（只动那一组） */
export function toggleOpen(s: AssetSideState, id: string): AssetSideState {
  return { ...s, open: s.open.includes(id) ? s.open.filter((x) => x !== id) : [...s.open, id] }
}

/** 点一格分类 ⇒ 选它（分组标题不选·只开收；「即將推出」占位那行不选） */
export function pickCat(tab: AssetTab, s: AssetSideState, id: string): AssetSideState {
  return findCat(tab, id) && !isGroup(tab, id) ? { ...s, pick: id } : s
}

export function findCat(tab: AssetTab, id: string): CatItem | null {
  for (const n of ASSET_TAB_SPEC[tab].nodes) {
    if (n.id === id) return n
    const k = n.children?.find((x) => x.id === id)
    if (k) return k
  }
  return null
}

const isGroup = (tab: AssetTab, id: string) => !!ASSET_TAB_SPEC[tab].nodes.find((n) => n.id === id)?.children

/** 竖清单要画的每一行：depth 0＝顶层（带底色的方格）·1＝分组展开后的子项（无底色）；
 *  group＝可展开（带箭头）·expanded＝已展开·active＝选中（分组：选中的在它底下 ⇒ 标题也亮）；soon＝子项不明的占位行 */
export type SideRow = { id: string; label: TKey; depth: 0 | 1; group: boolean; expanded: boolean; active: boolean; soon: boolean }
export function sideRows(tab: AssetTab, s: AssetSideState): SideRow[] {
  const rows: SideRow[] = []
  for (const n of ASSET_TAB_SPEC[tab].nodes) {
    if (!n.children) { rows.push({ id: n.id, label: n.label, depth: 0, group: false, expanded: false, active: s.pick === n.id, soon: false }); continue }
    const expanded = s.open.includes(n.id)
    rows.push({ id: n.id, label: n.label, depth: 0, group: true, expanded, active: n.children.some((k) => k.id === s.pick), soon: false })
    if (!expanded) continue
    if (!n.children.length) rows.push({ id: `${n.id}:soon`, label: 'vedit_asset_soon', depth: 1, group: false, expanded: false, active: false, soon: true })
    for (const k of n.children) rows.push({ id: k.id, label: k.label, depth: 1, group: false, expanded: false, active: s.pick === k.id, soon: false })
  }
  return rows
}

/** 这个页签用到的全部文案键（题核三语齐用） */
export function tabKeys(tab: AssetTab): TKey[] {
  const sp = ASSET_TAB_SPEC[tab]
  const out: TKey[] = [sp.label, ...(sp.search ? [sp.search] : [])]
  for (const n of sp.nodes) { out.push(n.label); for (const k of n.children ?? []) out.push(k.label) }
  return out
}

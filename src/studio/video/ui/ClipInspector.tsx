'use client'
// 网页剪辑页·右栏「人工」页·选中影片／图片／音频片段时的属性面板（附剪映 11 张截图）。
// 照剪映右栏排：画面（基础｜抠像｜蒙版｜美颜美体）·音频（基础｜换音色｜声音效果）·变速（常规变速｜曲线变速｜变速卡点）·动画（入场｜出场｜循环）·跟踪·调整（基础｜HSL｜曲线｜色轮）。
// 做了的：画面基础（缩放·等比·位置·旋转·对齐·混合模式·不透明度）、蒙版（线性／镜面／圆形／矩形／星形／爱心）、音频基础（音量 dB·淡入·淡出）、常规变速（倍数·时长·声音变调）、
//   动画（款式同文字动画库·去掉打字类）、调整基础（色温…暗角 16 项）；其余分页写「还没做」。
// 改动交给宿主 onPatch(patch, commit)：拖滑杆／打数字时 commit=false（只即时看）·放手才 commit=true（进一步复原）；按钮类一按就 commit。值的范围与换算在 _lib/clip-look.pure.ts。
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { useStudioLang, useStudioT } from '../../shared/StudioT'
import type { VideoKey as TKey } from '../i18n'
import {
  ADJ_GROUPS, ALIGN_DIRS, ANIM_DUR, ANIM_SLOTS, BG_BLUR_LEVELS, BG_COLORS, BLEND_MODES, CROP_RATIOS, cropForRatio, type ClipBg, type ClipCrop, DB_MAX, DB_MIN, FADE_MAX, KF_GROUP, MASK_SHAPES, SCALE_MAX, SCALE_MIN, SPEED_TICKS, VISUAL_ANIM_LIB,
  adjKfProp, adjRange, alignPatch, clipKfTimes, clipTabsFor, dbToVol, gainAt, kfEaseOn, kfOnAt, kfPropsAt, lookOf, maskDefault, posToSpeed, speedToPos, volToDb,
  type AdjKey, type AlignDir, type BlendMode, type ClipMask, type ClipPatch, type ClipTab, type LookPatch, type ManualClipState, type MaskShape,
} from '../lib/clip-look.pure'
import { SPEED_MAX, SPEED_MIN, speedOf, type TextAnimSlot } from '../lib/timeline.pure'
import { EASE_PRESETS, easeSamples, kfNext, kfPrev, type EasePreset, type KfProp } from '../lib/keyframe.pure'
import { CURVE_PRESETS, CURVE_SPEED_MAX, CURVE_SPEED_MIN, bakeCurve, curveAvg, curvePreset, curveSamples, normCurve, speedToY, yToSpeed, type CurvePoint, type CurvePreset, type SpeedCurve } from '../lib/curve-speed.pure'
import { previewPose, type AnimPose } from '../lib/text-anim.pure'
import { NumField, Row, Slider, Soon, Toggle } from './ManualPane'
import VeditKfBtn, { Diamond, kfArrowCls } from './KfBtn'
import { PIN_LIM, PIN_ZERO, ROT3D_DEFAULT, ROT3D_D_MAX, ROT3D_D_MIN, ROT3D_LIM, rot3dToPin, type ClipPin, type ClipRot3d, type PinKey } from '../lib/corner-pin.pure' // 四角透视＋3D 旋转
import { AudioProcSection, AudioSfxPanel } from './AudioPanels'
import { MBLUR_DEFAULT, MBLUR_MODES, MBLUR_PASSES, mblurModeOf, type ClipMotionBlur } from '../lib/motion-blur.pure' // 运动模糊
import VeditMosaicPanel, { type MosaicHost } from './MosaicPanel' // 追踪打码
import VeditMotionTrackPanel, { type MTrackHost } from './MotionTrackPanel' // 运动跟踪
import { MASKS_MAX, MASK_OPS, MATTE_MODES, STRIPE_COUNT_MAX, STRIPE_EASES, patchMaskList, type MaskOp, type MatteMode, type StripeEase } from '../lib/mask-matte.pure' // 条纹／多蒙版／轨道遮罩
import { CurvesPanel, HslPanel, KeyPanel, LutPanel, PenEditor, StyleSection, WheelsPanel } from './GradePanels'
import type { TrackBox } from '../lib/motion-track.pure'
import { PUSH_DUR_MAX, PUSH_DUR_MIN } from '../lib/push-box.pure' // 推镜头「推到框」

/** now＝播放头（时间轴秒·面板显示这一刻的值、关键帧打在这一刻）；onSeek＝跳到某一刻（上一颗／下一颗关键帧） */
/** srcRatio＝素材宽／高（裁剪比例预设用·还不知道 ⇒ 缺） */
export type ClipHost = { state: Extract<ManualClipState, { kind: 'clip' }>; onPatch: (p: ClipPatch, commit: boolean) => void; onCancel: () => void; now: number; onSeek: (t: number) => void; srcRatio?: number
  /** 画面宽／高（3D 旋转换算四角用） */ stageRatio?: number
  /** 追踪打码（「跟踪」页） */ mosaic?: MosaicHost
  /** 运动跟踪（「跟踪」页·影片片段） */ mtrack?: MTrackHost
  /** 轨道遮罩：能选的文字／贴纸轨（id＋名字） */ matteLanes?: Array<{ id: string; label: string }>
  /** 推镜头「推到框」（画面页·影片／图片） */ push?: PushHost }
/** 推到框：selecting＝在画面上拉框中；box＝拉好的框（画面比例·中心＋宽高）；dur／ease＝时长与缓动；onApply＝在播放头套用（宿主叫 push-box.pure applyPushBox） */
export type PushHost = { selecting: boolean; setSelecting: (v: boolean) => void; box: TrackBox | null; dur: number; setDur: (v: number) => void; ease: EasePreset; setEase: (e: EasePreset) => void; onApply: () => void }

const TAB_LABEL: Record<ClipTab, TKey> = { picture: 'vedit_ci_tab_picture', audio: 'vedit_ci_tab_audio', speed: 'vedit_ci_tab_speed', anim: 'vedit_ci_tab_anim', track: 'vedit_ci_tab_track', adjust: 'vedit_ci_tab_adjust' }
type Sub = { key: string; label: TKey; done: boolean }
const SUBS: Record<ClipTab, readonly Sub[]> = {
  picture: [{ key: 'basic', label: 'vedit_ci_sub_basic', done: true }, { key: 'key', label: 'vedit_ci_sub_key', done: true }, { key: 'mask', label: 'vedit_ci_sub_mask', done: true }, { key: 'crop', label: 'vedit_ci_sub_crop', done: true }, { key: 'bg', label: 'vedit_ci_sub_bg', done: true }, { key: 'mblur', label: 'vedit_ci_sub_mblur', done: true }, { key: 'beauty', label: 'vedit_ci_sub_beauty', done: false }],
  audio: [{ key: 'basic', label: 'vedit_ci_sub_basic', done: true }, { key: 'voice', label: 'vedit_ci_sub_voice', done: false }, { key: 'sfx', label: 'vedit_ci_sub_sfx', done: true }],
  speed: [{ key: 'normal', label: 'vedit_ci_sub_speed_normal', done: true }, { key: 'curve', label: 'vedit_ci_sub_speed_curve', done: true }, { key: 'beat', label: 'vedit_ci_sub_speed_beat', done: false }],
  anim: [{ key: 'in', label: 'vedit_man_anim_in', done: true }, { key: 'out', label: 'vedit_man_anim_out', done: true }, { key: 'loop', label: 'vedit_man_anim_loop', done: true }],
  track: [],
  adjust: [{ key: 'basic', label: 'vedit_ci_sub_basic', done: true }, { key: 'hsl', label: 'vedit_ci_sub_hsl', done: true }, { key: 'curve', label: 'vedit_ci_sub_curve', done: true }, { key: 'wheel', label: 'vedit_ci_sub_wheel', done: true }, { key: 'lut', label: 'vedit_ci_sub_lut', done: true }],
}
const BLEND_LABEL: Record<BlendMode, TKey> = {
  normal: 'vedit_ci_blend_normal', darken: 'vedit_ci_blend_darken', multiply: 'vedit_ci_blend_multiply', 'color-burn': 'vedit_ci_blend_color_burn', lighten: 'vedit_ci_blend_lighten', screen: 'vedit_ci_blend_screen',
  'color-dodge': 'vedit_ci_blend_color_dodge', overlay: 'vedit_ci_blend_overlay', 'soft-light': 'vedit_ci_blend_soft_light', 'hard-light': 'vedit_ci_blend_hard_light', difference: 'vedit_ci_blend_difference', exclusion: 'vedit_ci_blend_exclusion',
}
const MASK_LABEL: Record<MaskShape, TKey> = { linear: 'vedit_ci_mask_linear', mirror: 'vedit_ci_mask_mirror', circle: 'vedit_ci_mask_circle', rect: 'vedit_ci_mask_rect', star: 'vedit_ci_mask_star', heart: 'vedit_ci_mask_heart', pen: 'vedit_ci_mask_pen', stripes: 'vedit_ci_mask_stripes' }
const ALIGN_LABEL: Record<AlignDir, TKey> = { left: 'vedit_ci_align_left', hcenter: 'vedit_ci_align_hcenter', right: 'vedit_ci_align_right', top: 'vedit_ci_align_top', vcenter: 'vedit_ci_align_vcenter', bottom: 'vedit_ci_align_bottom' }
const ADJ_LABEL: Record<AdjKey, TKey> = {
  temp: 'vedit_ci_adj_temp', tint: 'vedit_ci_adj_tint', sat: 'vedit_ci_adj_sat', vib: 'vedit_ci_adj_vib', bright: 'vedit_ci_adj_bright', contrast: 'vedit_ci_adj_contrast', highlight: 'vedit_ci_adj_highlight',
  shadow: 'vedit_ci_adj_shadow', white: 'vedit_ci_adj_white', black: 'vedit_ci_adj_black', light: 'vedit_ci_adj_light', sharpen: 'vedit_ci_adj_sharpen', clarity: 'vedit_ci_adj_clarity',
  grain: 'vedit_ci_adj_grain', fade: 'vedit_ci_adj_fade', vignette: 'vedit_ci_adj_vignette',
}
const GROUP_LABEL = { color: 'vedit_ci_adj_g_color', tone: 'vedit_ci_adj_g_tone', effect: 'vedit_ci_adj_g_effect' } as const satisfies Record<string, TKey>
/** 色温、色调那两条照剪映画成彩色滑轨 */
const ADJ_TRACK: Partial<Record<AdjKey, string>> = { temp: 'linear-gradient(90deg,#3b82f6,#facc15)', tint: 'linear-gradient(90deg,#22c55e,#d946ef)', sat: 'linear-gradient(90deg,#9ca3af,#ef4444)', vib: 'linear-gradient(90deg,#9ca3af,#ef4444)' }

function Head({ title, onReset, testid, children }: { title: string; onReset?: () => void; testid?: string; children?: ReactNode }) {
  const t = useStudioT()
  return (
    <div className="pt-2 border-t border-neutral-800 first:border-t-0 first:pt-0 flex items-center gap-2 text-neutral-300">
      {children}
      <span className="flex-1">{title}</span>
      {onReset && <button type="button" title={t('vedit_man_reset')} aria-label={t('vedit_man_reset')} data-testid={testid} onMouseDown={(e) => e.preventDefault()} onClick={onReset}
        className="h-6 w-6 rounded text-neutral-400 hover:text-white hover:bg-neutral-700">↺</button>}
    </div>
  )
}
function AlignIcon({ d }: { d: AlignDir }) {
  const p: Record<AlignDir, string> = { left: 'M3 3v14M6 7h9M6 13h6', hcenter: 'M10 3v14M5 7h10M7 13h6', right: 'M17 3v14M5 7h9M8 13h6', top: 'M3 3h14M7 6v9M13 6v6', vcenter: 'M3 10h14M7 5v10M13 7v6', bottom: 'M3 17h14M7 5v9M13 8v6' }
  return <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" className="w-4 h-4" aria-hidden><path d={p[d]} /></svg>
}
function MaskIcon({ s }: { s: MaskShape | 'none' }) {
  const body = s === 'none' ? <><circle cx="10" cy="10" r="7" /><path d="M5 5l10 10" /></>
    : s === 'linear' ? <><rect x="3" y="3" width="14" height="14" rx="1.5" /><path d="M3 10h14" /></>
      : s === 'mirror' ? <><rect x="3" y="3" width="14" height="14" rx="1.5" /><path d="M3 8h14M3 12h14" /></>
        : s === 'circle' ? <><rect x="3" y="3" width="14" height="14" rx="1.5" /><circle cx="10" cy="10" r="4.5" /></>
          : s === 'rect' ? <><rect x="3" y="3" width="14" height="14" rx="1.5" /><rect x="6" y="6" width="8" height="8" /></>
            : s === 'star' ? <path d="M10 3l2.1 4.6 5 .5-3.8 3.3 1.1 4.9L10 13.8l-4.4 2.5 1.1-4.9L2.9 8.1l5-.5z" />
              : s === 'pen' ? <><path d="M4 16l2.5-6.5L13 3l4 4-6.5 6.5z" /><path d="M6.5 9.5l4 4M4 16l3-1" /></>
              : s === 'stripes' ? <><rect x="3" y="3" width="14" height="14" rx="1.5" /><path d="M3 6.5h14M3 10h10M3 13.5h6" /></>
              : <path d="M10 16.5s-6-3.7-6-8A3.3 3.3 0 0110 6.6a3.3 3.3 0 016 1.9c0 4.3-6 8-6 8z" />
  return <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinejoin="round" className="w-6 h-6" aria-hidden>{body}</svg>
}
/** 动画小样：一块渐层方块照姿势动（位移单位同预览：滑入 3 格＝整格宽） */
const poseCss = (q: AnimPose) => ({ transform: `translate(${q.tx * 33}%, ${q.ty * 50}%) rotate(${q.rot}deg) scale(${q.sx}, ${q.sy})`, opacity: q.alpha })

export default function VeditClipInspector({ host }: { host: ClipHost }) {
  const t = useStudioT()
  const st = host.state
  const tabs = clipTabsFor(st.lane, st.media)
  const [tab, setTab] = useState<ClipTab>(host.mosaic?.rec && tabs.includes('track') ? 'track' : tabs[0]) // 追踪打码开着 ⇒ 记完换段还停在「跟踪」页
  const cur = tabs.includes(tab) ? tab : tabs[0]
  const [subs, setSubs] = useState<Record<ClipTab, string>>({ picture: 'basic', audio: 'basic', speed: 'normal', anim: 'in', track: '', adjust: 'basic' })
  const sub = subs[cur]
  const subDef = SUBS[cur].find((s) => s.key === sub)
  return (
    <div className="h-full flex flex-col bg-neutral-900 text-neutral-200 text-xs" data-testid="vedit-ci" data-tab={cur} data-sub={sub} data-media={st.media} data-count={st.ids.length}>
      <div role="tablist" className="h-10 shrink-0 flex items-stretch gap-1 px-2 border-b border-neutral-800 overflow-x-auto">
        {tabs.map((k) => (
          <button key={k} type="button" role="tab" aria-selected={cur === k} data-testid={`vedit-ci-tab-${k}`} onClick={() => setTab(k)} onMouseDown={(e) => e.preventDefault()}
            className={`shrink-0 px-2.5 text-[13px] border-b-2 ${cur === k ? 'border-cyan-400 text-cyan-400' : 'border-transparent text-neutral-400 hover:text-neutral-200'}`}>{t(TAB_LABEL[k])}</button>
        ))}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-2.5 flex flex-col gap-2.5">
        {SUBS[cur].length > 0 && (
          <div className="flex rounded-md bg-neutral-800 p-0.5" role="tablist">
            {SUBS[cur].map((s) => (
              <button key={s.key} type="button" role="tab" aria-selected={sub === s.key} data-testid={`vedit-ci-sub-${s.key}`} data-done={s.done ? '1' : '0'} onMouseDown={(e) => e.preventDefault()}
                onClick={() => setSubs((o) => ({ ...o, [cur]: s.key }))}
                className={`flex-1 h-7 rounded truncate ${sub === s.key ? 'bg-neutral-600 text-neutral-100' : 'text-neutral-400 hover:text-neutral-200'}`}>{t(s.label)}</button>
            ))}
          </div>
        )}
        {(cur === 'picture' || cur === 'audio' || cur === 'adjust') && <KfBar host={host} />}
        {st.ids.length > 1 && <div className="px-2 py-1 rounded bg-cyan-900/30 text-[11px] text-cyan-200" data-testid="vedit-ci-multi">{t('vedit_ci_multi').replace(/\{n\}/g, String(st.ids.length))}</div>}
        {cur === 'track' ? (st.lane === 'visual' && host.mosaic ? <VeditMosaicPanel host={host} /> : <Soon testid="vedit-ci-soon" text={t('vedit_mosaic_visual_only')} />)
          : subDef && !subDef.done ? <Soon testid="vedit-ci-soon" text={t('vedit_ci_soon')} />
            : cur === 'picture' ? (sub === 'key' ? <KeyPanel host={host} /> : sub === 'mask' ? <MaskPanel host={host} /> : sub === 'crop' ? <CropPanel host={host} /> : sub === 'bg' ? <BgPanel host={host} /> : sub === 'mblur' ? <MotionBlurPanel host={host} /> : <PicturePanel host={host} />)
              : cur === 'audio' ? (sub === 'sfx' ? <AudioSfxPanel host={host} /> : <AudioPanel host={host} />)
                : cur === 'speed' ? (sub === 'curve' ? <CurvePanel host={host} /> : <SpeedPanel host={host} />)
                  : cur === 'anim' ? <AnimPanel key={`${st.ids.join(',')}:${sub}`} host={host} slot={sub as TextAnimSlot} />
                    : sub === 'hsl' ? <HslPanel host={host} /> : sub === 'curve' ? <CurvesPanel host={host} /> : sub === 'wheel' ? <WheelsPanel host={host} /> : sub === 'lut' ? <LutPanel host={host} />
                      : <AdjustPanel host={host} />}
        {/* 运动跟踪（影片片段·接在追踪打码下面） */}
        {cur === 'track' && st.lane === 'visual' && host.mosaic && host.mtrack && (st.media === 'video' ? <VeditMotionTrackPanel clip={st.clip} host={host.mtrack} onPatch={host.onPatch} /> : <div className="text-[11px] text-neutral-500" data-testid="vedit-mt-video-only">{t('vedit_mt_video_only')}</div>)}
      </div>
    </div>
  )
}

function PicturePanel({ host }: { host: ClipHost }) {
  const t = useStudioT()
  const l = lookOf(host.state.clip, host.now) // 显示播放头这一刻的值（有关键帧照关键帧）
  const live = (p: LookPatch) => host.onPatch({ look: p }, false)
  const put = (p: LookPatch) => host.onPatch({ look: p }, true)
  const scale = (sx: number, sy?: number): LookPatch => (l.uniform ? { sx, sy: sx } : sy === undefined ? { sx } : { sy })
  return (
    <div className="flex flex-col gap-2.5" data-testid="vedit-ci-picture">
      <Head title={t('vedit_ci_pos_size')} testid="vedit-ci-xform-reset" onReset={() => put({ sx: 1, sy: 1, uniform: true, x: 0, y: 0, rot: 0 })} />
      <Row label={t(l.uniform ? 'vedit_ci_scale' : 'vedit_ci_scale_w')}>
        <Slider value={Math.round(l.sx * 100)} min={SCALE_MIN * 100} max={SCALE_MAX * 100} label={t('vedit_ci_scale')} testid="vedit-ci-scale"
          onLive={(n) => live(scale(n / 100))} onCommit={(n) => put(scale(n / 100))} />
        <NumField value={Math.round(l.sx * 100)} min={SCALE_MIN * 100} max={SCALE_MAX * 100} suffix="%" label={t('vedit_ci_scale')} testid="vedit-ci-scale-num"
          onLive={(n) => live(scale(n / 100))} onCommit={(n) => put(scale(n / 100))} onCancel={host.onCancel} />
        <KfBtn host={host} props={KF_GROUP.scale} testid="vedit-ci-kf-scale" />
      </Row>
      {!l.uniform && (
        <Row label={t('vedit_ci_scale_h')}>
          <Slider value={Math.round(l.sy * 100)} min={SCALE_MIN * 100} max={SCALE_MAX * 100} label={t('vedit_ci_scale_h')} testid="vedit-ci-scale-h"
            onLive={(n) => live(scale(0, n / 100))} onCommit={(n) => put(scale(0, n / 100))} />
          <NumField value={Math.round(l.sy * 100)} min={SCALE_MIN * 100} max={SCALE_MAX * 100} suffix="%" label={t('vedit_ci_scale_h')} testid="vedit-ci-scale-h-num"
            onLive={(n) => live(scale(0, n / 100))} onCommit={(n) => put(scale(0, n / 100))} onCancel={host.onCancel} />
        </Row>
      )}
      <Row label={t('vedit_ci_uniform')}>
        <label className="ml-auto inline-flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={l.uniform} data-testid="vedit-ci-uniform" onChange={(e) => put(e.target.checked ? { uniform: true, sy: l.sx } : { uniform: false, sy: l.sx })} className="accent-cyan-500" />
        </label>
      </Row>
      <Row label={t('vedit_ci_pos')}>
        <span className="text-[10px] text-neutral-500">X</span>
        <NumField value={Math.round(l.x * 1000) / 10} min={-200} max={200} step={0.5} suffix="%" label={`${t('vedit_ci_pos')} X`} testid="vedit-ci-x"
          onLive={(n) => live({ x: n / 100 })} onCommit={(n) => put({ x: n / 100 })} onCancel={host.onCancel} />
        <span className="text-[10px] text-neutral-500">Y</span>
        <NumField value={Math.round(l.y * 1000) / 10} min={-200} max={200} step={0.5} suffix="%" label={`${t('vedit_ci_pos')} Y`} testid="vedit-ci-y"
          onLive={(n) => live({ y: n / 100 })} onCommit={(n) => put({ y: n / 100 })} onCancel={host.onCancel} />
        <KfBtn host={host} props={KF_GROUP.pos} testid="vedit-ci-kf-pos" />
      </Row>
      <Row label={t('vedit_ci_rotate')}>
        <Slider value={l.rot} min={-180} max={180} label={t('vedit_ci_rotate')} testid="vedit-ci-rotate" onLive={(n) => live({ rot: n })} onCommit={(n) => put({ rot: n })} />
        <NumField value={Math.round(l.rot * 10) / 10} min={-360} max={360} suffix="°" label={t('vedit_ci_rotate')} testid="vedit-ci-rotate-num" onLive={(n) => live({ rot: n })} onCommit={(n) => put({ rot: n })} onCancel={host.onCancel} />
        <KfBtn host={host} props={KF_GROUP.rot} testid="vedit-ci-kf-rot" />
      </Row>
      {/* 镜像（左右／上下翻） */}
      <Row label={t('vedit_ci_flip')}>
        <div className="flex gap-1">
          <Toggle on={l.flipH} label={t('vedit_ci_flip_h')} testid="vedit-ci-flip-h" onClick={() => put({ flipH: !l.flipH })}><span className="text-sm" aria-hidden>⇋</span></Toggle>
          <Toggle on={l.flipV} label={t('vedit_ci_flip_v')} testid="vedit-ci-flip-v" onClick={() => put({ flipV: !l.flipV })}><span className="text-sm rotate-90 inline-block" aria-hidden>⇋</span></Toggle>
        </div>
      </Row>
      <div className="flex gap-1" data-testid="vedit-ci-align">
        {ALIGN_DIRS.map((d) => (
          <Toggle key={d} on={false} label={t(ALIGN_LABEL[d])} testid={`vedit-ci-align-${d}`} onClick={() => put(alignPatch(l, d))}><AlignIcon d={d} /></Toggle>
        ))}
      </div>
      <Head title={t('vedit_ci_blend')} testid="vedit-ci-blend-reset" onReset={() => put({ blend: 'normal', opacity: 1 })} />
      <Row label={t('vedit_ci_blend_mode')}>
        <select value={l.blend} aria-label={t('vedit_ci_blend_mode')} data-testid="vedit-ci-blend" onChange={(e) => put({ blend: e.target.value as BlendMode })}
          className="flex-1 min-w-0 h-7 rounded bg-neutral-800 border border-neutral-700 px-1.5 text-neutral-100 outline-none">
          {BLEND_MODES.map((b) => <option key={b} value={b}>{t(BLEND_LABEL[b])}</option>)}
        </select>
      </Row>
      <Row label={t('vedit_ci_opacity')}>
        <Slider value={Math.round(l.opacity * 100)} min={0} max={100} label={t('vedit_ci_opacity')} testid="vedit-ci-opacity" onLive={(n) => live({ opacity: n / 100 })} onCommit={(n) => put({ opacity: n / 100 })} />
        <NumField value={Math.round(l.opacity * 100)} min={0} max={100} suffix="%" label={t('vedit_ci_opacity')} testid="vedit-ci-opacity-num" onLive={(n) => live({ opacity: n / 100 })} onCommit={(n) => put({ opacity: n / 100 })} onCancel={host.onCancel} />
        <KfBtn host={host} props={KF_GROUP.opacity} testid="vedit-ci-kf-opacity" />
      </Row>
      <PinSection host={host} />
      <Rot3dSection host={host} />
      {host.push && <PushSection host={host} push={host.push} />}
      <StyleSection host={host} />
    </div>
  )
}

/** 推镜头「推到框」：在画面拉框 ⇒ 时长＋缓动 ⇒ 套用（播放头＝现在的样子·播放头＋时长＝框填满画面） */
function PushSection({ host, push }: { host: ClipHost; push: PushHost }) {
  const t = useStudioT()
  const pct = (v: number) => `${Math.round(v * 100)}%`
  const btn = 'h-8 rounded-md text-[12px] px-2'
  return (
    <div className="flex flex-col gap-2" data-testid="vedit-push" data-selecting={push.selecting ? '1' : '0'}>
      <Head title={t('vedit_push_title')} />
      <button type="button" data-testid="vedit-push-select" aria-pressed={push.selecting} onMouseDown={(e) => e.preventDefault()} onClick={() => push.setSelecting(!push.selecting)}
        className={`${btn} ${push.selecting ? 'bg-cyan-600/30 text-cyan-300 ring-1 ring-cyan-500' : 'bg-neutral-800 text-neutral-200 hover:bg-neutral-700'}`}>{t(push.selecting ? 'vedit_push_selecting' : 'vedit_push_select')}</button>
      {push.box && <div className="text-[11px] text-neutral-400 tabular-nums" data-testid="vedit-push-box">{t('vedit_mt_box')}：x {pct(push.box.x)} · y {pct(push.box.y)} · {pct(push.box.w)} × {pct(push.box.h)}</div>}
      <Row label={t('vedit_push_dur')}>
        <NumField value={push.dur} min={PUSH_DUR_MIN} max={PUSH_DUR_MAX} step={0.1} suffix="s" label={t('vedit_push_dur')} testid="vedit-push-dur" onLive={() => {}} onCommit={push.setDur} onCancel={host.onCancel} />
      </Row>
      <Row label={t('vedit_push_ease')}>
        <select value={push.ease} aria-label={t('vedit_push_ease')} data-testid="vedit-push-ease" onChange={(e) => push.setEase(e.target.value as EasePreset)}
          className="flex-1 min-w-0 h-7 rounded bg-neutral-800 border border-neutral-700 px-1.5 text-neutral-100 outline-none">
          {EASE_PRESETS.filter((e) => e !== 'hold').map((e) => <option key={e} value={e}>{t(EASE_LABEL[e])}</option>)}
        </select>
      </Row>
      <button type="button" data-testid="vedit-push-apply" disabled={!push.box} onClick={push.onApply} className={`${btn} bg-cyan-600 text-white hover:bg-cyan-500 disabled:opacity-40`}>{t('vedit_push_apply')}</button>
      <div className="text-[11px] text-neutral-500 leading-relaxed">{t('vedit_push_hint')}</div>
    </div>
  )
}

/** 四角透视：开关·四角 x/y（画面宽／高的百分比·离那个角的位移）·重置·关键帧；画面上选中时也有四颗角点可拖（宿主页画） */
const PIN_CORNERS = [['0', 'vedit_ci_pin_tl'], ['1', 'vedit_ci_pin_tr'], ['2', 'vedit_ci_pin_br'], ['3', 'vedit_ci_pin_bl']] as const
function PinSection({ host }: { host: ClipHost }) {
  const t = useStudioT()
  const p = lookOf(host.state.clip, host.now).pin
  const put = (q: Partial<ClipPin> | null, commit = true) => host.onPatch({ look: { pin: q } }, commit)
  return (
    <div className="flex flex-col gap-2.5" data-testid="vedit-ci-pin" data-on={p ? '1' : '0'}>
      <Head title={t('vedit_ci_pin')} testid="vedit-ci-pin-reset" onReset={p ? () => put({ ...PIN_ZERO }) : undefined}>{p && <KfBtn host={host} props={KF_GROUP.pin} testid="vedit-ci-kf-pin" />}</Head>
      <Row label={t('vedit_ci_pin_on')}>
        <label className="ml-auto inline-flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={!!p} data-testid="vedit-ci-pin-on" onChange={(e) => put(e.target.checked ? { ...PIN_ZERO } : null)} className="accent-cyan-500" />
        </label>
      </Row>
      {p && PIN_CORNERS.map(([i, label]) => (
        <Row key={i} label={t(label)}>
          {(['x', 'y'] as const).map((ax) => { const k = `${ax}${i}` as PinKey; return (
            <Fragment key={ax}>
              <span className="text-[10px] text-neutral-500">{ax.toUpperCase()}</span>
              <NumField value={Math.round(p[k] * 1000) / 10} min={-PIN_LIM * 100} max={PIN_LIM * 100} step={0.5} suffix="%" label={`${t(label)} ${ax.toUpperCase()}`} testid={`vedit-ci-pin-${k}`}
                onLive={(n) => put({ [k]: n / 100 }, false)} onCommit={(n) => put({ [k]: n / 100 })} onCancel={host.onCancel} />
            </Fragment>
          ) })}
        </Row>
      ))}
      {p && <div className="text-[11px] text-neutral-500 leading-relaxed">{t('vedit_ci_pin_hint')}</div>}
    </div>
  )
}

/** 3D 旋转（rotX／rotY＋透视距离）：换算成四角透视的四个角（corner-pin rot3dToPin）一起写进 pin·关键帧照四角透视那颗菱形打 */
function Rot3dSection({ host }: { host: ClipHost }) {
  const t = useStudioT()
  const r = lookOf(host.state.clip, host.now).rot3d
  const cur = r ?? ROT3D_DEFAULT
  const put = (q: ClipRot3d | null, commit = true) => host.onPatch({ look: q ? { rot3d: q, pin: rot3dToPin(q, host.stageRatio ?? 16 / 9) } : { rot3d: null, pin: null } }, commit)
  const set = (p: Partial<ClipRot3d>, commit = true) => put({ ...cur, ...p }, commit)
  return (
    <div className="flex flex-col gap-2.5" data-testid="vedit-ci-rot3d" data-on={r ? '1' : '0'}>
      <Head title={t('vedit_ci_rot3d')} testid="vedit-ci-rot3d-reset" onReset={r ? () => put(null) : undefined} />
      {([['x', 'vedit_ci_rot3d_x', -ROT3D_LIM, ROT3D_LIM, 1], ['y', 'vedit_ci_rot3d_y', -ROT3D_LIM, ROT3D_LIM, 1], ['d', 'vedit_ci_rot3d_d', ROT3D_D_MIN, ROT3D_D_MAX, 0.1]] as const).map(([f, label, lo, hi, step]) => (
        <Row key={f} label={t(label)}>
          <NumField value={cur[f]} min={lo} max={hi} step={step} suffix={f === 'd' ? '' : '°'} label={t(label)} testid={`vedit-ci-rot3d-${f}`}
            onLive={(n) => set({ [f]: n }, false)} onCommit={(n) => set({ [f]: n })} onCancel={host.onCancel} />
        </Row>
      ))}
      <div className="text-[11px] text-neutral-500 leading-relaxed">{t('vedit_ci_rot3d_hint')}</div>
    </div>
  )
}

function MaskPanel({ host }: { host: ClipHost }) {
  const t = useStudioT()
  const lk = lookOf(host.state.clip, host.now)
  // 多蒙版：sel＝面板正在改第几个；第一个照旧走 look.mask（关键帧也只管它）·其余改 look.masks 整串
  const list = lk.masks
  const [sel0, setSel] = useState(0)
  const sel = Math.min(sel0, Math.max(0, list.length - 1))
  const m = list[sel] ?? null
  const h: ClipHost = sel === 0 ? host : { ...host, onPatch: (p, c) => host.onPatch(p.look?.mask !== undefined ? { ...p, look: { ...p.look, mask: undefined, masks: p.look.mask === null ? list.filter((_, i) => i !== sel) : patchMaskList(list, sel, p.look.mask) } } : p, c) }
  const live = (p: Partial<ClipMask>) => h.onPatch({ look: { mask: p } }, false)
  const put = (p: Partial<ClipMask>) => h.onPatch({ look: { mask: p } }, true)
  const pick = (s: MaskShape | null) => h.onPatch({ look: { mask: s ? { ...maskDefault(s), ...(m ? { x: m.x, y: m.y, rot: m.rot, feather: m.feather, invert: m.invert } : {}) } : null } }, true)
  const add = () => { host.onPatch({ look: { masks: [...list, maskDefault('rect')].slice(0, MASKS_MAX) } }, true); setSel(Math.min(list.length, MASKS_MAX - 1)) }
  const del = () => { host.onPatch({ look: sel === 0 ? { mask: null } : { masks: list.filter((_, i) => i !== sel) } }, true); setSel(Math.max(0, sel - 1)) }
  const pct = (v: number) => Math.round(v * 1000) / 10
  const mt = lk.matte
  return (
    <div className="flex flex-col gap-2.5" data-testid="vedit-ci-mask" data-shape={m?.shape ?? 'none'} data-count={list.length} data-sel={sel}>
      <div className="flex items-center gap-1 flex-wrap" data-testid="vedit-ci-masks">
        {list.map((x, i) => (
          <button key={i} type="button" data-testid="vedit-ci-mask-tab" data-active={i === sel ? '1' : '0'} onMouseDown={(e) => e.preventDefault()} onClick={() => setSel(i)}
            className={`h-6 px-2 rounded text-[11px] ${i === sel ? 'bg-cyan-600 text-white' : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'}`}>{i + 1}·{t(MASK_LABEL[x.shape])}</button>
        ))}
        {list.length > 0 && list.length < MASKS_MAX && <button type="button" data-testid="vedit-ci-mask-add" title={t('vedit_ci_mask_add')} onMouseDown={(e) => e.preventDefault()} onClick={add} className="h-6 px-2 rounded text-[11px] bg-neutral-800 text-neutral-300 hover:bg-neutral-700">＋ {t('vedit_ci_mask_add')}</button>}
        {list.length > 0 && <button type="button" data-testid="vedit-ci-mask-del" title={t('vedit_ci_mask_del')} onMouseDown={(e) => e.preventDefault()} onClick={del} className="h-6 px-2 rounded text-[11px] bg-neutral-800 text-neutral-400 hover:bg-red-700 hover:text-white">✕</button>}
        {list.length > 1 && (
          <select value={lk.maskOp} data-testid="vedit-ci-mask-op" aria-label={t('vedit_ci_mask_op')} onChange={(e) => host.onPatch({ look: { maskOp: e.target.value as MaskOp } }, true)} className="ml-auto h-6 rounded bg-neutral-800 text-[11px] text-neutral-200 px-1">
            {MASK_OPS.map((o) => <option key={o} value={o}>{t(o === 'and' ? 'vedit_ci_mask_op_and' : 'vedit_ci_mask_op_or')}</option>)}
          </select>
        )}
      </div>
      <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(56px, 1fr))' }}>
        {(['none', ...MASK_SHAPES] as const).map((s) => {
          const on = (m?.shape ?? 'none') === s
          return (
            <button key={s} type="button" data-testid="vedit-ci-mask-shape" data-shape={s} data-active={on ? '1' : '0'} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(s === 'none' ? null : s)}
              className={`flex flex-col items-center gap-1 rounded-md py-1.5 ${on ? 'ring-2 ring-cyan-400 bg-neutral-800 text-white' : 'bg-neutral-800/60 hover:bg-neutral-800 text-neutral-300'}`}>
              <MaskIcon s={s} />
              <span className="text-[11px]">{t(s === 'none' ? 'vedit_ci_mask_none' : MASK_LABEL[s])}</span>
            </button>
          )
        })}
      </div>
      {m ? (
        <>
          <Head title={t('vedit_ci_mask_params')} testid="vedit-ci-mask-reset" onReset={() => put(maskDefault(m.shape))}>{sel === 0 && <KfBtn host={host} props={KF_GROUP.mask} testid="vedit-ci-kf-mask" />}</Head>
          {m.shape === 'pen' && <PenEditor host={h} m={m} />}
          {m.shape === 'stripes' && (
            <>
              <Row label={t('vedit_ci_mask_progress')}>
                <Slider value={Math.round((m.progress ?? 1) * 100)} min={0} max={100} label={t('vedit_ci_mask_progress')} testid="vedit-ci-mask-progress" onLive={(n) => live({ progress: n / 100 })} onCommit={(n) => put({ progress: n / 100 })} />
                <span className="w-7 text-right tabular-nums text-neutral-300">{Math.round((m.progress ?? 1) * 100)}</span>
              </Row>
              <Row label={t('vedit_ci_mask_count')}>
                <NumField value={m.count ?? 12} min={1} max={STRIPE_COUNT_MAX} label={t('vedit_ci_mask_count')} testid="vedit-ci-mask-count" onLive={(n) => live({ count: Math.round(n) })} onCommit={(n) => put({ count: Math.round(n) })} onCancel={host.onCancel} />
              </Row>
              <Row label={t('vedit_ci_mask_gap')}>
                <Slider value={Math.round((m.gap ?? 0) * 100)} min={0} max={95} label={t('vedit_ci_mask_gap')} testid="vedit-ci-mask-gap" onLive={(n) => live({ gap: n / 100 })} onCommit={(n) => put({ gap: n / 100 })} />
                <span className="w-7 text-right tabular-nums text-neutral-300">{Math.round((m.gap ?? 0) * 100)}</span>
              </Row>
              <Row label={t('vedit_ci_mask_stagger')}>
                <Slider value={Math.round((m.stagger ?? 0.5) * 100)} min={0} max={100} label={t('vedit_ci_mask_stagger')} testid="vedit-ci-mask-stagger" onLive={(n) => live({ stagger: n / 100 })} onCommit={(n) => put({ stagger: n / 100 })} />
                <span className="w-7 text-right tabular-nums text-neutral-300">{Math.round((m.stagger ?? 0.5) * 100)}</span>
              </Row>
              <Row label={t('vedit_ci_mask_ease')}>
                <select value={m.ease ?? 'out'} data-testid="vedit-ci-mask-ease" aria-label={t('vedit_ci_mask_ease')} onChange={(e) => put({ ease: e.target.value as StripeEase })} className="ml-auto h-6 rounded bg-neutral-800 text-[11px] text-neutral-200 px-1">
                  {STRIPE_EASES.map((x) => <option key={x} value={x}>{t(`vedit_ci_mask_ease_${x}` as TKey)}</option>)}
                </select>
              </Row>
            </>
          )}
          <Row label={t('vedit_ci_mask_invert')}>
            <label className="ml-auto inline-flex items-center cursor-pointer"><input type="checkbox" checked={m.invert} data-testid="vedit-ci-mask-invert" onChange={(e) => put({ invert: e.target.checked })} className="accent-cyan-500" /></label>
          </Row>
          <Row label={t('vedit_ci_pos')}>
            <span className="text-[10px] text-neutral-500">X</span>
            <NumField value={pct(m.x)} min={-200} max={200} step={0.5} suffix="%" label={`${t('vedit_ci_mask')} X`} testid="vedit-ci-mask-x" onLive={(n) => live({ x: n / 100 })} onCommit={(n) => put({ x: n / 100 })} onCancel={host.onCancel} />
            <span className="text-[10px] text-neutral-500">Y</span>
            <NumField value={pct(m.y)} min={-200} max={200} step={0.5} suffix="%" label={`${t('vedit_ci_mask')} Y`} testid="vedit-ci-mask-y" onLive={(n) => live({ y: n / 100 })} onCommit={(n) => put({ y: n / 100 })} onCancel={host.onCancel} />
          </Row>
          <Row label={t('vedit_ci_rotate')}>
            <Slider value={m.rot} min={-180} max={180} label={t('vedit_ci_rotate')} testid="vedit-ci-mask-rot" onLive={(n) => live({ rot: n })} onCommit={(n) => put({ rot: n })} />
            <NumField value={m.rot} min={-360} max={360} suffix="°" label={t('vedit_ci_rotate')} testid="vedit-ci-mask-rot-num" onLive={(n) => live({ rot: n })} onCommit={(n) => put({ rot: n })} onCancel={host.onCancel} />
          </Row>
          {m.shape !== 'linear' && (
            <Row label={t('vedit_ci_mask_size')}>
              {m.shape !== 'mirror' && <><span className="text-[10px] text-neutral-500">{t('vedit_ci_w')}</span>
                <NumField value={pct(m.w)} min={2} max={400} suffix="%" label={t('vedit_ci_w')} testid="vedit-ci-mask-w" onLive={(n) => live({ w: n / 100 })} onCommit={(n) => put({ w: n / 100 })} onCancel={host.onCancel} /></>}
              <span className="text-[10px] text-neutral-500">{t('vedit_ci_h')}</span>
              <NumField value={pct(m.h)} min={2} max={400} suffix="%" label={t('vedit_ci_h')} testid="vedit-ci-mask-h" onLive={(n) => live({ h: n / 100 })} onCommit={(n) => put({ h: n / 100 })} onCancel={host.onCancel} />
            </Row>
          )}
          <Row label={t('vedit_ci_mask_feather')}>
            <Slider value={m.feather} min={0} max={100} label={t('vedit_ci_mask_feather')} testid="vedit-ci-mask-feather" onLive={(n) => live({ feather: n })} onCommit={(n) => put({ feather: n })} />
            <span className="w-7 text-right tabular-nums text-neutral-300">{m.feather}</span>
          </Row>
          {m.shape === 'rect' && (
            <Row label={t('vedit_ci_mask_radius')}>
              <Slider value={m.radius} min={0} max={100} label={t('vedit_ci_mask_radius')} testid="vedit-ci-mask-radius" onLive={(n) => live({ radius: n })} onCommit={(n) => put({ radius: n })} />
              <span className="w-7 text-right tabular-nums text-neutral-300">{m.radius}</span>
            </Row>
          )}
        </>
      ) : <div className="text-[11px] text-neutral-500" data-testid="vedit-ci-mask-hint">{t('vedit_ci_mask_hint')}</div>}
      {/* 轨道遮罩：用上方（或指定）文字／贴纸轨的形状当遮罩 */}
      <div className="flex flex-col gap-1.5 border-t border-neutral-800 pt-2" data-testid="vedit-ci-matte" data-on={mt ? '1' : '0'}>
        <Row label={t('vedit_ci_matte')}>
          <select value={mt ? mt.lane ?? '' : '-'} data-testid="vedit-ci-matte-lane" aria-label={t('vedit_ci_matte')} onChange={(e) => host.onPatch({ look: { matte: e.target.value === '-' ? null : { mode: mt?.mode ?? 'alpha', ...(mt?.invert ? { invert: true } : {}), ...(e.target.value ? { lane: e.target.value } : {}) } } }, true)} className="ml-auto h-6 max-w-[60%] rounded bg-neutral-800 text-[11px] text-neutral-200 px-1">
            <option value="-">{t('vedit_ci_mask_none')}</option>
            <option value="">{t('vedit_ci_matte_above')}</option>
            {(host.matteLanes ?? []).map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
          </select>
        </Row>
        {mt && (
          <Row label={t('vedit_ci_matte_mode')}>
            <select value={mt.mode} data-testid="vedit-ci-matte-mode" aria-label={t('vedit_ci_matte_mode')} onChange={(e) => host.onPatch({ look: { matte: { ...mt, mode: e.target.value as MatteMode } } }, true)} className="h-6 rounded bg-neutral-800 text-[11px] text-neutral-200 px-1">
              {MATTE_MODES.map((x) => <option key={x} value={x}>{t(x === 'alpha' ? 'vedit_ci_matte_alpha' : 'vedit_ci_matte_luma')}</option>)}
            </select>
            <label className="ml-auto inline-flex items-center gap-1 cursor-pointer text-[11px] text-neutral-300"><input type="checkbox" checked={!!mt.invert} data-testid="vedit-ci-matte-invert" onChange={(e) => host.onPatch({ look: { matte: { lane: mt.lane, mode: mt.mode, ...(e.target.checked ? { invert: true } : {}) } } }, true)} className="accent-cyan-500" />{t('vedit_ci_mask_invert')}</label>
          </Row>
        )}
        <div className="text-[11px] text-neutral-500">{t('vedit_ci_matte_hint')}</div>
      </div>
      <div className="text-[11px] text-neutral-600">{t('vedit_ci_mask_skip')}</div>
    </div>
  )
}

function AudioPanel({ host }: { host: ClipHost }) {
  const t = useStudioT()
  const c = host.state.clip
  const db = volToDb(gainAt(c, host.now)) // 音量关键帧照播放头
  const lim = Math.min(FADE_MAX, c.length)
  return (
    <div className="flex flex-col gap-2.5" data-testid="vedit-ci-audio">
      <Head title={t('vedit_ci_sub_basic')} testid="vedit-ci-audio-reset" onReset={() => host.onPatch({ volume: 1, fadeIn: 0, fadeOut: 0 }, true)} />
      <Row label={t('vedit_ci_volume')}>
        <Slider value={db} min={DB_MIN} max={DB_MAX} step={0.5} label={t('vedit_ci_volume')} testid="vedit-ci-volume"
          onLive={(n) => host.onPatch({ volume: dbToVol(n) }, false)} onCommit={(n) => host.onPatch({ volume: dbToVol(n) }, true)} />
        <NumField value={db} min={DB_MIN} max={DB_MAX} step={0.5} suffix="dB" label={t('vedit_ci_volume')} testid="vedit-ci-volume-num"
          onLive={(n) => host.onPatch({ volume: dbToVol(n) }, false)} onCommit={(n) => host.onPatch({ volume: dbToVol(n) }, true)} onCancel={host.onCancel} />
        <KfBtn host={host} props={KF_GROUP.vol} testid="vedit-ci-kf-vol" />
      </Row>
      {(['fadeIn', 'fadeOut'] as const).map((k) => (
        <Row key={k} label={t(k === 'fadeIn' ? 'vedit_ci_fade_in' : 'vedit_ci_fade_out')}>
          <Slider value={c[k] ?? 0} min={0} max={lim} step={0.1} label={t(k === 'fadeIn' ? 'vedit_ci_fade_in' : 'vedit_ci_fade_out')} testid={`vedit-ci-${k}`}
            onLive={(n) => host.onPatch({ [k]: n }, false)} onCommit={(n) => host.onPatch({ [k]: n }, true)} />
          <NumField value={c[k] ?? 0} min={0} max={lim} step={0.1} suffix="s" label={t(k === 'fadeIn' ? 'vedit_ci_fade_in' : 'vedit_ci_fade_out')} testid={`vedit-ci-${k}-num`}
            onLive={(n) => host.onPatch({ [k]: n }, false)} onCommit={(n) => host.onPatch({ [k]: n }, true)} onCancel={host.onCancel} />
        </Row>
      ))}
      <AudioProcSection host={host} />
      <div className="text-[11px] text-neutral-500 leading-relaxed" data-testid="vedit-ci-audio-skip">{t('vedit_ci_audio_skip')}</div>
    </div>
  )
}

function SpeedPanel({ host }: { host: ClipHost }) {
  const t = useStudioT()
  const c = host.state.clip
  const sp = speedOf(c)
  const [drag, setDrag] = useState<number | null>(null) // 拖滑杆时只即时显示数字（变速改长度·放手才改）
  const shown = drag ?? sp
  const src = c.length * sp
  const lenOf = (s: number) => Math.round((src / s) * 10) / 10
  const put = (s: number) => { setDrag(null); host.onPatch({ speed: s }, true) }
  return (
    <div className="flex flex-col gap-2.5" data-testid="vedit-ci-speed" data-speed={sp}>
      <Head title={t('vedit_ci_speed_rate')} testid="vedit-ci-speed-reset" onReset={() => put(1)} />
      <div className="flex items-center gap-2">
        <div className="relative flex-1 min-w-0">
          <Slider value={speedToPos(shown)} min={0} max={500} label={t('vedit_ci_speed_rate')} testid="vedit-ci-speed-slider" onLive={(n) => setDrag(posToSpeed(n))} onCommit={(n) => put(posToSpeed(n))} />
          <div className="flex justify-between text-[9px] text-neutral-500 tabular-nums px-0.5">{SPEED_TICKS.map((x) => <span key={x}>{x}x</span>)}</div>
        </div>
        <NumField value={shown} min={SPEED_MIN} max={SPEED_MAX} step={0.01} suffix="x" label={t('vedit_ci_speed_rate')} testid="vedit-ci-speed-num"
          onLive={(n) => setDrag(n)} onCommit={put} onCancel={() => setDrag(null)} />
      </div>
      <Row label={t('vedit_ci_speed_len')}>
        <span className="text-neutral-400 tabular-nums" data-testid="vedit-ci-speed-src">{Math.round(src * 10) / 10}s →</span>
        <NumField value={lenOf(shown)} min={Math.max(0.1, Math.round((src / SPEED_MAX) * 10) / 10)} max={Math.round((src / SPEED_MIN) * 10) / 10} step={0.1} suffix="s" label={t('vedit_ci_speed_len')} testid="vedit-ci-speed-len"
          onLive={(n) => n > 0 && setDrag(src / n)} onCommit={(n) => n > 0 && put(src / n)} onCancel={() => setDrag(null)} />
      </Row>
      <Row label={t('vedit_ci_reverse')}>
        <label className="ml-auto inline-flex items-center cursor-pointer" title={t('vedit_ci_reverse_hint')}>
          <input type="checkbox" checked={!!c.reverse} disabled={!!c.freeze} data-testid="vedit-ci-reverse" onChange={(e) => host.onPatch({ reverse: e.target.checked }, true)} className="accent-cyan-500" />
        </label>
      </Row>
      <Row label={t('vedit_ci_pitch')}>
        <label className="ml-auto inline-flex items-center cursor-pointer" title={t('vedit_ci_pitch_hint')}>
          <input type="checkbox" checked={!!c.pitch} data-testid="vedit-ci-pitch" onChange={(e) => host.onPatch({ pitch: e.target.checked }, true)} className="accent-cyan-500" />
        </label>
      </Row>
      <div className="text-[11px] text-neutral-500 leading-relaxed">{t('vedit_ci_speed_hint')}</div>
    </div>
  )
}

function AnimPanel({ host, slot }: { host: ClipHost; slot: TextAnimSlot }) {
  const t = useStudioT()
  const language = useStudioLang()
  const L = language === 'zh-CN' ? 'cn' : language === 'en' ? 'en' : 'tw'
  const [clock, setClock] = useState(0)
  useEffect(() => {
    let raf = 0
    const t0 = performance.now()
    const tick = () => { setClock((performance.now() - t0) / 1000); raf = requestAnimationFrame(tick) }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])
  const s = ANIM_SLOTS.includes(slot) ? slot : 'in'
  const cur = host.state.clip.anim?.[s]
  const R = ANIM_DUR[s]
  const put = (v: { id: string; dur: number } | null) => host.onPatch({ anim: { slot: s, anim: v } }, true)
  const dur = (n: number, commit: boolean) => cur && host.onPatch({ anim: { slot: s, anim: { id: cur.id, dur: n } } }, commit)
  return (
    <div className="flex flex-col gap-2.5" data-testid="vedit-ci-anim" data-slot={s}>
      <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(64px, 1fr))' }} data-testid="vedit-ci-anim-grid">
        <button type="button" data-testid="vedit-ci-anim-none" data-active={!cur ? '1' : '0'} onMouseDown={(e) => e.preventDefault()} onClick={() => put(null)}
          className={`flex flex-col items-center gap-1 rounded-md p-1 ${!cur ? 'ring-2 ring-cyan-400 bg-neutral-800' : 'bg-neutral-800/60 hover:bg-neutral-800'}`}>
          <span className="h-11 w-full flex items-center justify-center text-neutral-500"><MaskIcon s="none" /></span>
          <span className="text-[11px] text-neutral-400">{t('vedit_man_anim_none')}</span>
        </button>
        {VISUAL_ANIM_LIB[s].map((d) => {
          const q = previewPose(s, d.id, cur?.id === d.id ? cur.dur : R.def, clock)
          return (
            <button key={d.id} type="button" title={d.name[L]} data-testid="vedit-ci-anim-item" data-anim-id={d.id} data-active={cur?.id === d.id ? '1' : '0'} onMouseDown={(e) => e.preventDefault()}
              onClick={() => put({ id: d.id, dur: cur?.dur ?? R.def })}
              className={`flex flex-col items-center gap-1 rounded-md p-1 ${cur?.id === d.id ? 'ring-2 ring-cyan-400 bg-neutral-800' : 'bg-neutral-800/60 hover:bg-neutral-800'}`}>
              <span className="h-11 w-full flex items-center justify-center overflow-hidden rounded bg-neutral-950">
                <span className="block w-9 h-6 rounded-sm bg-gradient-to-br from-sky-400 to-fuchsia-500" style={poseCss(q)} />
              </span>
              <span className="text-[11px] text-neutral-300 truncate max-w-full">{d.name[L]}</span>
            </button>
          )
        })}
      </div>
      {cur ? (
        <Row label={t(s === 'loop' ? 'vedit_man_anim_speed' : 'vedit_man_anim_dur')}>
          <Slider value={Math.round(cur.dur * 10)} min={R.min * 10} max={R.max * 10} label={t('vedit_man_anim_dur')} testid="vedit-ci-anim-dur" onLive={(n) => dur(n / 10, false)} onCommit={(n) => dur(n / 10, true)} />
          <NumField value={cur.dur} min={R.min} max={R.max} step={0.1} suffix={t('vedit_man_anim_sec')} label={t('vedit_man_anim_dur')} testid="vedit-ci-anim-dur-num" onLive={(n) => dur(n, false)} onCommit={(n) => dur(n, true)} onCancel={host.onCancel} />
        </Row>
      ) : <div className="text-[11px] text-neutral-500">{t('vedit_ci_anim_hint')}</div>}
    </div>
  )
}

function AdjustPanel({ host }: { host: ClipHost }) {
  const t = useStudioT()
  const adj = lookOf(host.state.clip, host.now).adj
  const zero = Object.fromEntries(ADJ_GROUPS.flatMap((g) => g.keys).map((k) => [k, 0]))
  // 调节层：锐化、清晰、颗粒、暗角要看邻居／位置·调节层不套 ⇒ 那一组不列
  const groups = host.state.media === 'adjust' ? ADJ_GROUPS.filter((g) => g.group !== 'effect') : ADJ_GROUPS
  return (
    <div className="flex flex-col gap-2" data-testid="vedit-ci-adjust">
      <Head title={t('vedit_ci_adjust')} testid="vedit-ci-adjust-reset" onReset={() => host.onPatch({ look: { adj: zero } }, true)} />
      {host.state.media === 'adjust' && <div className="text-[11px] text-neutral-500 leading-relaxed" data-testid="vedit-ci-adjust-layer">{t('vedit_ci_adjust_layer_hint')}</div>}
      {groups.map((g) => (
        <div key={g.group} className="flex flex-col gap-1.5">
          <div className="text-[11px] text-neutral-500">{t(GROUP_LABEL[g.group])}</div>
          {g.keys.map((k) => {
            const [lo, hi] = adjRange(k)
            const v = Math.round(adj[k] ?? 0)
            return (
              <Row key={k} label={t(ADJ_LABEL[k])}>
                <div className="flex-1 min-w-0 flex items-center rounded" style={ADJ_TRACK[k] ? { backgroundImage: ADJ_TRACK[k], backgroundSize: '100% 2px', backgroundRepeat: 'no-repeat', backgroundPosition: 'center' } : undefined}>
                  <Slider value={v} min={lo} max={hi} label={t(ADJ_LABEL[k])} testid={`vedit-ci-adj-${k}`} onLive={(n) => host.onPatch({ look: { adj: { [k]: n } } }, false)} onCommit={(n) => host.onPatch({ look: { adj: { [k]: n } } }, true)} />
                </div>
                <NumField value={v} min={lo} max={hi} label={t(ADJ_LABEL[k])} testid={`vedit-ci-adj-${k}-num`} className="w-11"
                  onLive={(n) => host.onPatch({ look: { adj: { [k]: n } } }, false)} onCommit={(n) => host.onPatch({ look: { adj: { [k]: n } } }, true)} onCancel={host.onCancel} />
                <KfBtn host={host} props={[adjKfProp(k)]} testid={`vedit-ci-kf-adj-${k}`} />
              </Row>
            )
          })}
        </div>
      ))}
    </div>
  )
}

// ── 关键帧（剪映右栏数值旁那颗菱形·两边箭头跳上一颗／下一颗）──
const EASE_LABEL: Record<EasePreset, TKey> = {
  linear: 'vedit_ci_ease_linear', in: 'vedit_ci_ease_in', out: 'vedit_ci_ease_out', inout: 'vedit_ci_ease_inout', in2: 'vedit_ci_ease_in2', out2: 'vedit_ci_ease_out2',
  inout2: 'vedit_ci_ease_inout2', backIn: 'vedit_ci_ease_backIn', backOut: 'vedit_ci_ease_backOut', hold: 'vedit_ci_ease_hold',
}
/** 一颗菱形钮（管 props 那几项·画法在 VeditKfBtn） */
function KfBtn({ host, props, testid }: { host: ClipHost; props: readonly KfProp[]; testid: string }) {
  const c = host.state.clip
  return <VeditKfBtn times={clipKfTimes(c, props)} on={kfOnAt(c, host.now, props)} now={host.now} onSeek={host.onSeek} onToggle={() => host.onPatch({ kfToggle: [...props] }, true)} testid={testid} />
}
function EaseIcon({ e }: { e: EasePreset }) {
  const pts = e === 'hold' ? [[0, 0], [1, 0], [1, 1]] : easeSamples(e, 20)
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${(2 + x * 24).toFixed(1)} ${(22 - y * 16).toFixed(1)}`).join(' ')
  return <svg viewBox="0 0 28 28" className="w-7 h-7" aria-hidden><path d={d} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" /></svg>
}
/** 面板顶上那条：这段打了几个时刻的关键帧·上一颗／下一颗·播放头停在关键帧上 ⇒ 选它到下一颗的曲线（那一刻所有关键帧一起改） */
function KfBar({ host }: { host: ClipHost }) {
  const t = useStudioT()
  const c = host.state.clip
  const times = clipKfTimes(c)
  if (!times.length) return <div className="text-[11px] text-neutral-500 leading-relaxed" data-testid="vedit-ci-kf-bar" data-count="0">{t('vedit_ci_kf_hint')}</div>
  const prev = kfPrev(times, host.now), next = kfNext(times, host.now)
  const props = kfPropsAt(c, host.now)
  const ease = props.length ? kfEaseOn(c, host.now, props) : null
  const cur = typeof ease === 'string' ? ease : null
  return (
    <div className="flex flex-col gap-1.5 rounded-md bg-neutral-800/50 p-2" data-testid="vedit-ci-kf-bar" data-count={times.length} data-ease={cur ?? ''}>
      <div className="flex items-center gap-1 text-neutral-300">
        <span className="text-cyan-400"><Diamond on /></span>
        <span className="flex-1 text-[11px]">{t('vedit_ci_kf_count').replace('{n}', String(times.length))}</span>
        <button type="button" className={kfArrowCls} disabled={prev === null} title={t('vedit_ci_kf_prev')} aria-label={t('vedit_ci_kf_prev')} data-testid="vedit-ci-kf-bar-prev" onMouseDown={(e) => e.preventDefault()} onClick={() => prev !== null && host.onSeek(prev)}>‹</button>
        <button type="button" className={kfArrowCls} disabled={next === null} title={t('vedit_ci_kf_next')} aria-label={t('vedit_ci_kf_next')} data-testid="vedit-ci-kf-bar-next" onMouseDown={(e) => e.preventDefault()} onClick={() => next !== null && host.onSeek(next)}>›</button>
      </div>
      {props.length ? (
        <>
          <div className="text-[11px] text-neutral-500">{t('vedit_ci_kf_curve')}</div>
          <div className="grid grid-cols-5 gap-1" data-testid="vedit-ci-kf-ease">
            {EASE_PRESETS.map((e) => (
              <button key={e} type="button" title={t(EASE_LABEL[e])} aria-label={t(EASE_LABEL[e])} aria-pressed={cur === e} data-testid="vedit-ci-kf-ease-item" data-ease={e}
                onMouseDown={(ev) => ev.preventDefault()} onClick={() => host.onPatch({ kfEase: { props, ease: e } }, true)}
                className={`flex items-center justify-center rounded ${cur === e ? 'bg-cyan-600/30 text-cyan-300 ring-1 ring-cyan-500' : 'bg-neutral-800 text-neutral-400 hover:text-neutral-100'}`}><EaseIcon e={e} /></button>
            ))}
          </div>
        </>
      ) : <div className="text-[11px] text-neutral-500">{t('vedit_ci_kf_curve_hint')}</div>}
    </div>
  )
}

// ── 曲线变速（剪映「变速 › 曲线变速」：无／自订／蒙太奇／英雄时刻／子弹时间／跳接／闪进／闪出·点可拖）──
const CURVE_LABEL: Record<CurvePreset, TKey> = {
  custom: 'vedit_ci_curve_custom', montage: 'vedit_ci_curve_montage', hero: 'vedit_ci_curve_hero', bullet: 'vedit_ci_curve_bullet', jump: 'vedit_ci_curve_jump', flashIn: 'vedit_ci_curve_flashIn', flashOut: 'vedit_ci_curve_flashOut',
}
const curvePath = (cv: SpeedCurve, w: number, h: number, pad = 0) => curveSamples(cv, 60).map(([x, s], i) => `${i ? 'L' : 'M'}${(pad + x * (w - 2 * pad)).toFixed(1)} ${(pad + (1 - speedToY(s)) * (h - 2 * pad)).toFixed(1)}`).join(' ')
function CurvePanel({ host }: { host: ClipHost }) {
  const t = useStudioT()
  const c = host.state.clip
  const cv = c.curve ?? null
  const [draft, setDraft] = useState<CurvePoint[] | null>(null) // 拖点时只即时显示（改曲线会改长度·放手才改）
  const [pick, setPick] = useState<number | null>(null)
  const drag = useRef<{ i: number; box: DOMRect } | null>(null)
  const baked = cv ? bakeCurve(cv) : null // 切开／修剪过的（只用到原曲线一截）⇒ 拖点时照那截自己的点
  const shown: SpeedCurve | null = cv && baked ? (draft ? { id: 'custom', pts: draft } : baked) : null
  const line = draft || !cv ? shown : cv // 曲线照真的那条画（不烤）
  const src = c.length * speedOf(c)
  const put = (next: SpeedCurve | null) => { setDraft(null); host.onPatch({ curve: next }, true) }
  const W = 240, H = 120, P = 8
  const toPt = (e: { clientX: number; clientY: number }, box: DOMRect): CurvePoint => [Math.min(1, Math.max(0, (e.clientX - box.left - (P * box.width) / W) / (box.width * (1 - (2 * P) / W)))), yToSpeed(1 - (e.clientY - box.top - (P * box.height) / H) / (box.height * (1 - (2 * P) / H)))]
  const movePt = (pts: CurvePoint[], i: number, p: CurvePoint): CurvePoint[] => {
    const n = pts.map((q) => [q[0], q[1]] as CurvePoint)
    const lo = i === 0 ? 0 : n[i - 1][0] + 0.02, hi = i === n.length - 1 ? 1 : n[i + 1][0] - 0.02
    n[i] = [i === 0 ? 0 : i === n.length - 1 ? 1 : Math.min(hi, Math.max(lo, p[0])), p[1]]
    return n
  }
  const lenOf = (k: SpeedCurve | null) => Math.round((src / (k ? curveAvg(k) : 1)) * 10) / 10
  const head = c.length > 0 ? Math.min(1, Math.max(0, (host.now - c.start) / c.length)) : 0
  return (
    <div className="flex flex-col gap-2.5" data-testid="vedit-ci-curve" data-curve={cv?.id ?? 'none'}>
      <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(56px, 1fr))' }}>
        {(['none', ...CURVE_PRESETS] as const).map((id) => {
          const on = (cv?.id ?? 'none') === id
          const pv = id === 'none' ? null : curvePreset(id)
          return (
            <button key={id} type="button" data-testid="vedit-ci-curve-preset" data-curve={id} data-active={on ? '1' : '0'} onMouseDown={(e) => e.preventDefault()}
              onClick={() => { setPick(null); put(pv) }}
              className={`flex flex-col items-center gap-1 rounded-md py-1.5 ${on ? 'ring-2 ring-cyan-400 bg-neutral-800 text-white' : 'bg-neutral-800/60 hover:bg-neutral-800 text-neutral-300'}`}>
              {pv ? <svg viewBox="0 0 40 24" className="w-10 h-6" aria-hidden><path d="M0 12H40" stroke="#525252" strokeWidth={0.6} /><path d={curvePath(pv, 40, 24, 2)} fill="none" stroke="currentColor" strokeWidth={1.4} /></svg> : <span className="h-6 flex items-center"><MaskIcon s="none" /></span>}
              <span className="text-[11px]">{t(id === 'none' ? 'vedit_ci_curve_none' : CURVE_LABEL[id])}</span>
            </button>
          )
        })}
      </div>
      {shown ? (
        <>
          <Head title={t('vedit_ci_curve_graph')} testid="vedit-ci-curve-reset" onReset={() => { setPick(null); put(curvePreset(cv!.id)) }} />
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded bg-neutral-950 touch-none select-none" data-testid="vedit-ci-curve-graph" role="img" aria-label={t('vedit_ci_curve_graph')}
            onDoubleClick={(e) => {
              const p = toPt(e, e.currentTarget.getBoundingClientRect())
              if (p[0] <= 0.02 || p[0] >= 0.98 || shown.pts.length >= 20) return
              const pts = [...shown.pts, [p[0], Math.round(curveSamples(shown, 200)[Math.round(p[0] * 200)][1] * 100) / 100] as CurvePoint].sort((a, b) => a[0] - b[0])
              const k = normCurve({ id: 'custom', pts }); if (k) put(k)
            }}
            onPointerMove={(e) => { const d = drag.current; if (d) setDraft(movePt(draft ?? shown.pts, d.i, toPt(e, d.box))) }}
            onPointerUp={() => { const d = drag.current; drag.current = null; if (d && draft) { const k = normCurve({ id: 'custom', pts: draft }); put(k) } }}>
            {[CURVE_SPEED_MIN, 1, CURVE_SPEED_MAX].map((sp) => { const y = P + (1 - speedToY(sp)) * (H - 2 * P); return <g key={sp}><path d={`M${P} ${y}H${W - P}`} stroke="#404040" strokeWidth={0.6} strokeDasharray={sp === 1 ? undefined : '3 3'} /><text x={W - P} y={y - 2} textAnchor="end" fontSize={8} fill="#737373">{sp}x</text></g> })}
            <path d={`M${P + head * (W - 2 * P)} ${P}V${H - P}`} stroke="#f87171" strokeWidth={0.8} data-testid="vedit-ci-curve-head" />
            <path d={curvePath(line ?? shown, W, H, P)} fill="none" stroke="#22d3ee" strokeWidth={1.6} />
            {shown.pts.map(([x, sp], i) => (
              <circle key={i} cx={P + x * (W - 2 * P)} cy={P + (1 - speedToY(sp)) * (H - 2 * P)} r={pick === i ? 5 : 4} data-testid="vedit-ci-curve-pt" data-x={x} data-speed={sp}
                fill={pick === i ? '#22d3ee' : '#0a0a0a'} stroke="#22d3ee" strokeWidth={1.4} className="cursor-grab"
                onPointerDown={(e) => { e.stopPropagation(); (e.currentTarget.ownerSVGElement as SVGSVGElement).setPointerCapture(e.pointerId); drag.current = { i, box: (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect() }; setPick(i) }} />
            ))}
          </svg>
          <div className="flex items-center gap-2">
            <span className="flex-1 text-neutral-400 tabular-nums" data-testid="vedit-ci-curve-len">{t('vedit_ci_speed_len')} {Math.round(src * 10) / 10}s → {lenOf(line ?? shown)}s</span>
            {pick !== null && pick > 0 && pick < shown.pts.length - 1 && (
              <button type="button" data-testid="vedit-ci-curve-del" onMouseDown={(e) => e.preventDefault()} onClick={() => { const k = normCurve({ id: 'custom', pts: shown.pts.filter((_, j) => j !== pick) }); setPick(null); if (k) put(k) }}
                className="h-6 px-2 rounded bg-neutral-800 text-neutral-300 hover:bg-neutral-700">{t('vedit_ci_curve_del')}</button>
            )}
          </div>
          {pick !== null && shown.pts[pick] && <div className="text-[11px] text-cyan-300 tabular-nums" data-testid="vedit-ci-curve-pick">{Math.round(shown.pts[pick][1] * 100) / 100}x</div>}
          <div className="text-[11px] text-neutral-500 leading-relaxed">{t('vedit_ci_curve_hint')}</div>
        </>
      ) : <div className="text-[11px] text-neutral-500">{t('vedit_ci_speed_hint')}</div>}
    </div>
  )
}

// ── 裁剪（比例预设＋四边）·背景（无／纯色／模糊）──
const CROP_SIDES = [['l', 'vedit_ci_crop_l'], ['t', 'vedit_ci_crop_t'], ['r', 'vedit_ci_crop_r'], ['b', 'vedit_ci_crop_b']] as const
function CropPanel({ host }: { host: ClipHost }) {
  const t = useStudioT()
  const c = lookOf(host.state.clip).crop ?? { l: 0, t: 0, r: 0, b: 0 }
  const put = (crop: ClipCrop | null, commit = true) => host.onPatch({ look: { crop } }, commit)
  const side = (k: keyof ClipCrop, v: number): ClipCrop => ({ ...c, [k]: v })
  return (
    <div className="flex flex-col gap-2.5" data-testid="vedit-ci-crop">
      <Head title={t('vedit_ci_crop_ratio')} testid="vedit-ci-crop-reset" onReset={() => put(null)} />
      <div className="grid grid-cols-3 gap-1.5">
        {CROP_RATIOS.map((r) => (
          <button key={r.key} type="button" data-testid="vedit-ci-crop-ratio" data-ratio={r.key} onMouseDown={(e) => e.preventDefault()}
            onClick={() => put(r.r && host.srcRatio ? cropForRatio(host.srcRatio, r.r) ?? null : null)}
            className="h-7 rounded bg-neutral-800 text-neutral-300 hover:bg-neutral-700 text-xs">{r.key === 'free' ? t('vedit_ci_crop_none') : r.key}</button>
        ))}
      </div>
      {CROP_SIDES.map(([k, label]) => (
        <Row key={k} label={t(label)}>
          <Slider value={Math.round(c[k] * 100)} min={0} max={90} label={t(label)} testid={`vedit-ci-crop-${k}`} onLive={(n) => put(side(k, n / 100), false)} onCommit={(n) => put(side(k, n / 100))} />
          <NumField value={Math.round(c[k] * 100)} min={0} max={90} suffix="%" label={t(label)} testid={`vedit-ci-crop-${k}-num`} onLive={(n) => put(side(k, n / 100), false)} onCommit={(n) => put(side(k, n / 100))} onCancel={host.onCancel} />
        </Row>
      ))}
      <div className="text-[11px] text-neutral-500 leading-relaxed">{t('vedit_ci_crop_hint')}</div>
    </div>
  )
}
function BgPanel({ host }: { host: ClipHost }) {
  const t = useStudioT()
  const bg = lookOf(host.state.clip).bg
  const put = (b: ClipBg | null) => host.onPatch({ look: { bg: b } }, true)
  const ring = (on: boolean) => (on ? 'ring-2 ring-cyan-400' : 'ring-1 ring-neutral-700 hover:ring-neutral-500')
  return (
    <div className="flex flex-col gap-2.5" data-testid="vedit-ci-bg" data-kind={bg?.kind ?? 'none'}>
      <Head title={t('vedit_ci_bg_title')} testid="vedit-ci-bg-reset" onReset={() => put(null)} />
      <div className="text-neutral-400">{t('vedit_ci_bg_blur')}</div>
      <div className="grid grid-cols-5 gap-1.5">
        <button type="button" data-testid="vedit-ci-bg-none" onMouseDown={(e) => e.preventDefault()} onClick={() => put(null)} className={`h-9 rounded bg-neutral-800 text-[11px] text-neutral-300 ${ring(!bg)}`}>{t('vedit_ci_bg_none')}</button>
        {BG_BLUR_LEVELS.map((a) => (
          <button key={a} type="button" data-testid="vedit-ci-bg-blur" data-amount={a} onMouseDown={(e) => e.preventDefault()} onClick={() => put({ kind: 'blur', amount: a })}
            className={`h-9 rounded bg-gradient-to-br from-neutral-500 to-neutral-800 text-[11px] text-white ${ring(bg?.kind === 'blur' && bg.amount === a)}`} style={{ filter: `blur(${a * 0.4}px)` }}>{a}</button>
        ))}
      </div>
      <div className="text-neutral-400">{t('vedit_ci_bg_color')}</div>
      <div className="grid grid-cols-5 gap-1.5">
        {BG_COLORS.map((col) => (
          <button key={col} type="button" title={col} aria-label={col} data-testid="vedit-ci-bg-color" data-color={col} onMouseDown={(e) => e.preventDefault()} onClick={() => put({ kind: 'color', color: col })}
            className={`h-7 rounded ${ring(bg?.kind === 'color' && bg.color === col)}`} style={{ background: col }} />
        ))}
        <label className={`h-7 rounded flex items-center justify-center bg-neutral-800 text-[11px] text-neutral-300 cursor-pointer ${ring(bg?.kind === 'color' && !(BG_COLORS as readonly string[]).includes(bg.color))}`} title={t('vedit_ci_bg_custom')}>
          <input type="color" className="sr-only" data-testid="vedit-ci-bg-pick" value={bg?.kind === 'color' ? bg.color : '#000000'} onChange={(e) => put({ kind: 'color', color: e.target.value })} />+
        </label>
      </div>
      <div className="text-[11px] text-neutral-500 leading-relaxed">{t('vedit_ci_bg_hint')}</div>
    </div>
  )
}

// ── ：运动模糊（模糊程度／混合／叠加次数·照剪映·算法在 _lib/motion-blur.pure.ts）──
function MotionBlurPanel({ host }: { host: ClipHost }) {
  const t = useStudioT()
  const mb = lookOf(host.state.clip).mblur
  const isVideo = host.state.media === 'video'
  const put = (m: ClipMotionBlur | null, commit = true) => host.onPatch({ look: { mblur: m } }, commit)
  const cur = mb ?? MBLUR_DEFAULT
  const set = (p: Partial<ClipMotionBlur>, commit = true) => put({ ...cur, ...p }, commit)
  return (
    <div className="flex flex-col gap-2.5" data-testid="vedit-ci-mblur" data-on={mb ? '1' : '0'}>
      <Head title={t('vedit_ci_mblur_title')} testid="vedit-ci-mblur-reset" onReset={() => put(null)} />
      {!isVideo && <div className="text-[11px] text-neutral-400 leading-relaxed" data-testid="vedit-ci-mblur-image">{t('vedit_ci_mblur_image')}</div>}
      <Row label={t('vedit_ci_mblur_on')}>
        <label className="ml-auto inline-flex items-center cursor-pointer">
          <input type="checkbox" checked={!!mb} data-testid="vedit-ci-mblur-on" onChange={(e) => put(e.target.checked ? cur : null)} className="accent-cyan-500" />
        </label>
      </Row>
      {mb && <>
        {isVideo && <Row label={t('vedit_ci_mblur_mode')}>
          <div className="ml-auto flex gap-1">
            {MBLUR_MODES.map((md) => (
              <button key={md} type="button" data-testid="vedit-ci-mblur-mode" data-mode={md} aria-pressed={mblurModeOf(mb, 'video') === md} onMouseDown={(e) => e.preventDefault()} onClick={() => set({ mode: md })}
                className={`h-7 px-2 rounded text-xs ${mblurModeOf(mb, 'video') === md ? 'bg-cyan-600 text-white' : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'}`}>{t(md === 'dir' ? 'vedit_ci_mblur_mode_dir' : 'vedit_ci_mblur_mode_frames')}</button>
            ))}
          </div>
        </Row>}
        <Row label={t('vedit_ci_mblur_amount')}>
          <Slider value={cur.amount} min={1} max={100} label={t('vedit_ci_mblur_amount')} testid="vedit-ci-mblur-amount" onLive={(n) => set({ amount: n }, false)} onCommit={(n) => set({ amount: n })} />
          <NumField value={cur.amount} min={1} max={100} label={t('vedit_ci_mblur_amount')} testid="vedit-ci-mblur-amount-num" onLive={(n) => set({ amount: n }, false)} onCommit={(n) => set({ amount: n })} onCancel={host.onCancel} />
        </Row>
        <Row label={t('vedit_ci_mblur_blend')}>
          <Slider value={cur.blend} min={1} max={100} label={t('vedit_ci_mblur_blend')} testid="vedit-ci-mblur-blend" onLive={(n) => set({ blend: n }, false)} onCommit={(n) => set({ blend: n })} />
          <NumField value={cur.blend} min={1} max={100} label={t('vedit_ci_mblur_blend')} testid="vedit-ci-mblur-blend-num" onLive={(n) => set({ blend: n }, false)} onCommit={(n) => set({ blend: n })} onCancel={host.onCancel} />
        </Row>
        <Row label={t('vedit_ci_mblur_passes')}>
          <div className="ml-auto flex gap-1">
            {MBLUR_PASSES.map((n) => (
              <button key={n} type="button" data-testid="vedit-ci-mblur-passes" data-n={n} aria-pressed={cur.passes === n} onMouseDown={(e) => e.preventDefault()} onClick={() => set({ passes: n })}
                className={`h-7 w-8 rounded text-xs ${cur.passes === n ? 'bg-cyan-600 text-white' : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'}`}>{n}</button>
            ))}
          </div>
        </Row>
      </>}
      <div className="text-[11px] text-neutral-500 leading-relaxed">{t('vedit_ci_mblur_hint')}</div>
    </div>
  )
}

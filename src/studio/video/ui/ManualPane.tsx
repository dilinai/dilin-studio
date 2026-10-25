'use client'
// 网页剪辑页·右栏「人工」页（附剪映文本属性面板截图·
//）。
// 顶上三页：文本（做完整）／动画（做·入场／出场／循环三分页·款式在 _lib/text-anim.pure.ts）／朗读（写「还没做」）。
// 文本页＝选中文字片段时照剪映排：基础（改字框、字体、字号、粗体底线斜体、颜色、字间距行间距、对齐、预设样式、位置大小、不透明度、描边、背景）｜花字（接现有花字库）。
// 改动都交给宿主 onPatch(patch, commit)：拖滑杆／打数字时 commit=false（只即时看）·放手／离开框才 commit=true（进一步复原）；按钮类一按就 commit。
// 值的范围、换算、画法都在 _lib/text-style.pure.ts；本档只画。
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useStudioLang, useStudioT } from '../../shared/StudioT'
import type { VideoKey as TKey } from '../i18n'
import { FANCY_CATS, type FancyCat } from '../lib/fancy-text.data'
import { fancyIn } from '../lib/text.pure'
import { MANUAL_TABS, TEXT_SUB_TABS, type ManualTab, type ManualTextState, type TextSubTab } from '../lib/manual.pure'
import {
  BG_DEFAULT, LINE_SPACING_MAX, LETTER_SPACING_MAX, LETTER_SPACING_MIN, SCALE_MAX, SCALE_MIN, STROKE_DEFAULT, TEXT_ALIGNS, TEXT_PRESETS,
  activePreset, fontSizeOf, lookBold, lookItalic, posFrom, posOf, presetPatch, resolveTextLook, sizeFromFontSize, spacingFrom, spacingOf, strokeWFrom, strokeWOf,
  type TextPatch,
} from '../lib/text-style.pure'
import { TEXT_SIZE_MAX, TEXT_SIZE_MIN } from '../lib/text.pure'
import type { TextAlign, TextAnimSlot, TextBody, TlClip } from '../lib/timeline.pure'
import { TEXT_KF, kfOnClip, type KfOp } from '../lib/text-kf.pure' // 文字关键帧
import type { KfProp } from '../lib/keyframe.pure'
import { clipKfTimes } from '../lib/clip-look.pure'
import VeditKfBtn from './KfBtn'
import { ANIM_DUR, ANIM_LIB, ANIM_SLOTS, STAGGER, animDef, autoStagger, charCount, charCss, previewCharPoses, previewPose, visibleChars, type AnimPose } from '../lib/text-anim.pure'
import VeditFancyText from './FancyText'
import { BubblePanel, FontSelect, ShadowGlowSection, VerticalToggle } from './TextExtras'

/** 宿主：state＝选中的文字（body 已并上正在拖的即时值）；onPatch＝一笔改动（commit=false 只即时看）；onCancel＝放弃没放手的即时值（打数字按 Esc）；
 *  clipPanel＝：没选文字、选的是影片／图片／音频片段 ⇒ 宿主画好的那张属性面板（VeditClipInspector）整页换上 */
/** kf＝文字关键帧（clip＝面板照哪段·now＝播放头·onOp＝菱形钮／缓动·一按就进复原栈） */
export type ManualHost = { state: ManualTextState; onPatch: (p: TextPatch, commit: boolean) => void; onCancel: () => void; clipPanel?: ReactNode
  kf?: { clip: TlClip; now: number; onSeek: (t: number) => void; onOp: (op: KfOp) => void }
  /** 朗读：busy＝正在合成·msg＝上一次的结果（成功／失败原因）·onRun＝合成选中那段字（结果进素材区、放在那段字底下的音频轨） */
  tts?: (text: string) => ReactNode
  /** 运动跟踪＋四角透视（宿主画好·文字基础页底下） */
  extra?: ReactNode }
/** 文字面板一颗菱形（管 props 那几项） */
function TextKf({ host, props, testid }: { host: ManualHost; props: readonly KfProp[]; testid: string }) {
  const k = host.kf
  if (!k) return null
  return <VeditKfBtn times={clipKfTimes(k.clip, props)} on={kfOnClip(k.clip, k.now, props)} now={k.now} onSeek={k.onSeek} onToggle={() => k.onOp({ toggle: props })} testid={testid} />
}

const TAB_LABEL: Record<ManualTab, TKey> = { text: 'vedit_man_tab_text', anim: 'vedit_man_tab_anim', tts: 'vedit_man_tab_tts' }
const SUB_LABEL: Record<TextSubTab, TKey> = { basic: 'vedit_man_sub_basic', fancy: 'vedit_man_sub_fancy', bubble: 'vedit_man_sub_bubble' }
const ALIGN_LABEL: Record<TextAlign, TKey> = { left: 'vedit_man_align_left', center: 'vedit_man_align_center', right: 'vedit_man_align_right' }
const HEX_RE = /^#[0-9a-f]{6}$/i
/** 颜色框要 #rrggbb：款式是渐层／rgba ⇒ 拿第一个色·认不得 ⇒ 白 */
const hexOr = (c: string | undefined, fb = '#ffffff') => (c && HEX_RE.test(c) ? c.toLowerCase() : fb)

/** 滑杆（照页面现有滑杆：拖的时候即时看·放手／放开键才进一步复原） */
export function Slider({ value, min, max, step = 1, label, testid, onLive, onCommit }: { value: number; min: number; max: number; step?: number; label: string; testid: string; onLive: (v: number) => void; onCommit: (v: number) => void }) {
  return (
    <input type="range" min={min} max={max} step={step} value={Math.min(max, Math.max(min, value))} aria-label={label} data-testid={testid}
      onChange={(e) => onLive(Number(e.target.value))}
      onPointerUp={(e) => onCommit(Number((e.target as HTMLInputElement).value))}
      onKeyUp={(e) => onCommit(Number((e.target as HTMLInputElement).value))}
      className="flex-1 min-w-0 accent-cyan-500" />
  )
}
/** 数字框：打的时候即时看·离开框／Enter 才进一步复原·Esc 放弃 */
export function NumField({ value, min, max, step = 1, label, testid, suffix, onLive, onCommit, onCancel, className = 'w-14' }: { value: number; min: number; max: number; step?: number; label: string; testid: string; suffix?: string; onLive: (v: number) => void; onCommit: (v: number) => void; onCancel: () => void; className?: string }) {
  const [draft, setDraft] = useState<string | null>(null)
  const parse = (s: string) => { const n = Number(s); return s.trim() !== '' && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : null }
  return (
    <span className="inline-flex items-center gap-0.5 shrink-0">
      <input type="number" min={min} max={max} step={step} value={draft ?? String(value)} aria-label={label} data-testid={testid}
        onChange={(e) => { setDraft(e.target.value); const n = parse(e.target.value); if (n !== null) onLive(n) }}
        onBlur={(e) => { const n = parse(e.target.value); setDraft(null); if (n !== null) onCommit(n); else onCancel() }}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); else if (e.key === 'Escape') { setDraft(null); onCancel() } }}
        className={`${className} h-6 px-1 rounded bg-neutral-950 border border-neutral-700 text-right tabular-nums text-neutral-100 focus:border-cyan-500 outline-none`} />
      {suffix && <span className="text-[10px] text-neutral-500">{suffix}</span>}
    </span>
  )
}
/** 颜色框：拖色盘时即时看（input 事件）·色盘关掉／选定（原生 change 事件）才进一步复原 */
export function ColorField({ value, label, testid, onLive, onCommit }: { value: string; label: string; testid: string; onLive: (v: string) => void; onCommit: (v: string) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  const commitRef = useRef(onCommit)
  commitRef.current = onCommit
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const h = () => commitRef.current(el.value)
    el.addEventListener('change', h)
    return () => el.removeEventListener('change', h)
  }, [])
  return <input ref={ref} type="color" value={value} aria-label={label} title={label} data-testid={testid} onChange={(e) => onLive(e.target.value)}
    className="w-14 h-6 p-0 rounded border border-neutral-700 bg-transparent cursor-pointer" />
}
/** 开关钮（粗体／底线／斜体／对齐）：按下不抢焦点 */
export function Toggle({ on, label, testid, onClick, children }: { on: boolean; label: string; testid: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" title={label} aria-label={label} aria-pressed={on} data-testid={testid} data-on={on ? '1' : '0'} onMouseDown={(e) => e.preventDefault()} onClick={onClick}
      className={`h-7 w-8 flex items-center justify-center rounded ${on ? 'bg-cyan-600/30 text-cyan-300' : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'}`}>
      {children}
    </button>
  )
}
export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 min-h-7">
      <span className="w-16 shrink-0 text-neutral-400">{label}</span>
      <div className="flex-1 min-w-0 flex items-center gap-2">{children}</div>
    </div>
  )
}
export function Soon({ text, testid }: { text: string; testid: string }) {
  return <div className="h-full min-h-32 flex items-center justify-center px-6 text-center text-xs text-neutral-500 leading-relaxed" data-testid={testid}>{text}</div>
}
function AlignIcon({ a }: { a: TextAlign }) {
  const d = a === 'left' ? 'M3 5h14M3 9h9M3 13h14M3 17h9' : a === 'right' ? 'M3 5h14M8 9h9M3 13h14M8 17h9' : 'M3 5h14M5.5 9h9M3 13h14M5.5 17h9'
  return <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" className="w-4 h-4" aria-hidden><path d={d} /></svg>
}

export default function VeditManualPane({ host }: { host: ManualHost }) {
  const t = useStudioT()
  const [tab, setTab] = useState<ManualTab>('text')
  const [sub, setSub] = useState<TextSubTab>('basic')
  if (host.state.kind === 'none' && host.clipPanel) return <>{host.clipPanel}</>
  return (
    <div className="h-full flex flex-col bg-neutral-900 text-neutral-200 text-xs" data-testid="vedit-manual" data-tab={tab}>
      {/* 顶上三页（照剪映：文本 动画 朗读·跟踪、数字人说不用） */}
      <div role="tablist" className="h-10 shrink-0 flex items-stretch gap-1 px-2 border-b border-neutral-800">
        {MANUAL_TABS.filter((k) => k !== 'tts' || host.tts).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} data-testid={`vedit-man-tab-${k}`} onClick={() => setTab(k)} onMouseDown={(e) => e.preventDefault()}
            className={`px-2.5 text-[13px] border-b-2 ${tab === k ? 'border-cyan-400 text-cyan-400' : 'border-transparent text-neutral-400 hover:text-neutral-200'}`}>{t(TAB_LABEL[k])}</button>
        ))}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {/* 动画（做）：入场／出场／循环三分页·点一款套到选中的文字（多选＝全部）·可调秒数 */}
        {tab === 'anim' ? (host.state.kind === 'none' ? <Soon testid="vedit-man-pick" text={t('vedit_man_pick_text')} />
          : <AnimPanel key={host.state.ids.join(',')} ids={host.state.ids} body={host.state.body} host={host} />)
          : tab === 'tts' ? (host.state.kind === 'none' || !host.tts ? <Soon testid="vedit-man-tts" text={t('vedit_man_pick_text')} /> : host.tts(host.state.body.content))
            : host.state.kind === 'none' ? <Soon testid="vedit-man-pick" text={t('vedit_man_pick_text')} />
              : <TextPanel key={host.state.ids.join(',')} ids={host.state.ids} body={host.state.body} host={host} sub={sub} setSub={setSub} />}
      </div>
    </div>
  )
}

function TextPanel({ ids, body, host, sub, setSub }: { ids: string[]; body: TextBody; host: ManualHost; sub: TextSubTab; setSub: (s: TextSubTab) => void }) {
  const t = useStudioT()
  return (
    <div className="p-2.5 flex flex-col gap-2.5" data-testid="vedit-man-text" data-count={ids.length}>
      <div className="flex rounded-md bg-neutral-800 p-0.5" role="tablist">
        {TEXT_SUB_TABS.map((k) => (
          <button key={k} type="button" role="tab" aria-selected={sub === k} data-testid={`vedit-man-sub-${k}`} onClick={() => setSub(k)} onMouseDown={(e) => e.preventDefault()}
            className={`flex-1 h-7 rounded ${sub === k ? 'bg-neutral-600 text-neutral-100' : 'text-neutral-400 hover:text-neutral-200'}`}>{t(SUB_LABEL[k])}</button>
        ))}
      </div>
      {ids.length > 1 && <div className="px-2 py-1 rounded bg-cyan-900/30 text-[11px] text-cyan-200" data-testid="vedit-man-multi">{t('vedit_man_multi').replace(/\{n\}/g, String(ids.length))}</div>}
      {sub === 'basic' && ids.length === 1 && host.extra}
      {sub === 'basic' ? <BasicPanel ids={ids} body={body} host={host} /> : sub === 'bubble' ? <BubblePanel body={body} host={host} /> : <FancyPanel body={body} host={host} />}
    </div>
  )
}

function BasicPanel({ ids, body, host }: { ids: string[]; body: TextBody; host: ManualHost }) {
  const t = useStudioT()
  const look = resolveTextLook(body)
  const live = (p: TextPatch) => host.onPatch(p, false)
  const put = (p: TextPatch) => host.onPatch(p, true)
  // 改字框：打字时即时看（去头尾空白的样子）·离开框才进一步复原；框里留着打的原样（含结尾换行）
  const [draft, setDraft] = useState<string | null>(null)
  const escRef = useRef(false) // 按 Esc ⇒ 这次离开框不存
  const pos = posOf(body)
  const scale = body.scale ?? 1
  const preset = activePreset(body)
  const faceColor = hexOr(body.color ?? (look.style.fill.type === 'solid' ? look.style.fill.color : look.style.fill.stops[0]?.color))
  return (
    <div className="flex flex-col gap-2.5" data-testid="vedit-man-basic">
      {ids.length > 1 ? (
        <div className="min-h-16 px-2 py-2 rounded-md bg-neutral-950 text-[11px] text-neutral-500 leading-relaxed" data-testid="vedit-man-content-multi">{t('vedit_man_content_multi')}</div>
      ) : (
        <textarea value={draft ?? body.content} rows={3} aria-label={t('vedit_man_content')} data-testid="vedit-man-content"
          onChange={(e) => { setDraft(e.target.value); live({ content: e.target.value }) }}
          onBlur={(e) => { setDraft(null); if (escRef.current) { escRef.current = false; return } put({ content: e.target.value }) }}
          onKeyDown={(e) => { if (e.key === 'Escape') { escRef.current = true; setDraft(null); host.onCancel(); e.currentTarget.blur() } }}
          className="w-full resize-y rounded-md bg-neutral-950 border border-neutral-800 focus:border-cyan-600 outline-none px-2 py-1.5 text-[13px] text-neutral-100 leading-snug" />
      )}
      <Row label={t('vedit_man_font')}>
        <FontSelect body={body} put={put} />
      </Row>
      <Row label={t('vedit_man_size')}>
        <Slider value={fontSizeOf(body.size)} min={fontSizeOf(TEXT_SIZE_MIN)} max={fontSizeOf(TEXT_SIZE_MAX)} label={t('vedit_man_size')} testid="vedit-man-size"
          onLive={(n) => live({ size: sizeFromFontSize(n) })} onCommit={(n) => put({ size: sizeFromFontSize(n) })} />
        <NumField value={fontSizeOf(body.size)} min={fontSizeOf(TEXT_SIZE_MIN)} max={fontSizeOf(TEXT_SIZE_MAX)} label={t('vedit_man_size')} testid="vedit-man-size-num"
          onLive={(n) => live({ size: sizeFromFontSize(n) })} onCommit={(n) => put({ size: sizeFromFontSize(n) })} onCancel={host.onCancel} />
      </Row>
      <Row label={t('vedit_man_style')}>
        <Toggle on={lookBold(look)} label={t('vedit_man_bold')} testid="vedit-man-bold" onClick={() => put({ bold: !lookBold(look) })}><b className="text-sm">B</b></Toggle>
        <Toggle on={!!body.underline} label={t('vedit_man_underline')} testid="vedit-man-underline" onClick={() => put({ underline: body.underline ? null : true })}><span className="text-sm underline">U</span></Toggle>
        <Toggle on={lookItalic(look)} label={t('vedit_man_italic')} testid="vedit-man-italic" onClick={() => put({ italic: !lookItalic(look) })}><i className="text-sm font-serif">I</i></Toggle>
      </Row>
      <Row label={t('vedit_man_color')}>
        <ColorField value={faceColor} label={t('vedit_man_color')} testid="vedit-man-color" onLive={(c) => live({ color: c })} onCommit={(c) => put({ color: c })} />
        {body.color && (
          <button type="button" title={t('vedit_man_color_reset')} aria-label={t('vedit_man_color_reset')} data-testid="vedit-man-color-reset" onMouseDown={(e) => e.preventDefault()} onClick={() => put({ color: null })}
            className="h-6 w-6 rounded text-neutral-400 hover:text-white hover:bg-neutral-700">↺</button>
        )}
      </Row>
      <div className="flex items-center gap-2 min-h-7">
        <span className="w-16 shrink-0 text-neutral-400">{t('vedit_man_letter')}</span>
        <NumField value={spacingOf(body.letterSpacing)} min={Math.round(LETTER_SPACING_MIN * 10)} max={Math.round(LETTER_SPACING_MAX * 10)} label={t('vedit_man_letter')} testid="vedit-man-letter"
          onLive={(n) => live({ letterSpacing: spacingFrom(n) })} onCommit={(n) => put({ letterSpacing: spacingFrom(n) })} onCancel={host.onCancel} />
        <span className="ml-2 shrink-0 text-neutral-400">{t('vedit_man_line')}</span>
        <NumField value={spacingOf(body.lineSpacing)} min={0} max={Math.round(LINE_SPACING_MAX * 10)} label={t('vedit_man_line')} testid="vedit-man-line"
          onLive={(n) => live({ lineSpacing: spacingFrom(n) })} onCommit={(n) => put({ lineSpacing: spacingFrom(n) })} onCancel={host.onCancel} />
      </div>
      <Row label={t('vedit_man_align')}>
        {TEXT_ALIGNS.map((a) => (
          <Toggle key={a} on={look.align === a} label={t(ALIGN_LABEL[a])} testid={`vedit-man-align-${a}`} onClick={() => put({ align: a === 'center' ? null : a })}><AlignIcon a={a} /></Toggle>
        ))}
        <VerticalToggle body={body} put={put} />
      </Row>

      <div className="pt-2 border-t border-neutral-800 text-neutral-400">{t('vedit_man_preset')}</div>
      <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(34px, 1fr))' }} data-testid="vedit-man-presets">
        <button type="button" title={t('vedit_man_preset_none')} aria-label={t('vedit_man_preset_none')} data-testid="vedit-man-preset" data-preset="none" data-active={preset === 'none' ? '1' : '0'}
          onMouseDown={(e) => e.preventDefault()} onClick={() => put(presetPatch(null))}
          className={`aspect-square rounded-md bg-neutral-800 hover:bg-neutral-700 flex items-center justify-center text-neutral-400 ${preset === 'none' ? 'ring-2 ring-cyan-400' : ''}`}>
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} className="w-5 h-5" aria-hidden><circle cx="10" cy="10" r="7" /><path d="M5 5l10 10" /></svg>
        </button>
        {TEXT_PRESETS.map((p) => {
          const pl = resolveTextLook({ content: 'T', x: 0.5, y: 0.5, size: 0.1, color: p.color, ...(p.stroke ? { stroke: p.stroke } : {}), ...(p.bg ? { bg: p.bg } : {}) })
          return (
            <button key={p.id} type="button" data-testid="vedit-man-preset" data-preset={p.id} data-active={preset === p.id ? '1' : '0'} onMouseDown={(e) => e.preventDefault()} onClick={() => put(presetPatch(p))}
              className={`aspect-square rounded-md bg-neutral-700 hover:bg-neutral-600 flex items-center justify-center overflow-hidden ${preset === p.id ? 'ring-2 ring-cyan-400' : ''}`}>
              <VeditFancyText text="T" fancy={pl.style} style={{ fontSize: 18 }} className="pointer-events-none" />
            </button>
          )
        })}
      </div>

      <div className="pt-2 border-t border-neutral-800 flex items-center justify-between text-neutral-400">
        <span>{t('vedit_man_transform')}</span>
        <button type="button" title={t('vedit_man_reset')} aria-label={t('vedit_man_reset')} data-testid="vedit-man-transform-reset" onMouseDown={(e) => e.preventDefault()}
          onClick={() => put({ scale: null, rotate: null, x: 0.5, y: 0.5 })} className="h-6 w-6 rounded text-neutral-400 hover:text-white hover:bg-neutral-700">↺</button>
      </div>
      <Row label={t('vedit_man_scale')}>
        <Slider value={Math.round(scale * 100)} min={SCALE_MIN * 100} max={SCALE_MAX * 100} label={t('vedit_man_scale')} testid="vedit-man-scale"
          onLive={(n) => live({ scale: n / 100 })} onCommit={(n) => put({ scale: n / 100 })} />
        <NumField value={Math.round(scale * 100)} min={SCALE_MIN * 100} max={SCALE_MAX * 100} suffix="%" label={t('vedit_man_scale')} testid="vedit-man-scale-num"
          onLive={(n) => live({ scale: n / 100 })} onCommit={(n) => put({ scale: n / 100 })} onCancel={host.onCancel} />
        <TextKf host={host} props={TEXT_KF.scale} testid="vedit-man-kf-scale" />
      </Row>
      <Row label={t('vedit_man_pos')}>
        <span className="text-[10px] text-neutral-500">X</span>
        <NumField value={pos.x} min={-50} max={50} step={0.5} suffix="%" label={`${t('vedit_man_pos')} X`} testid="vedit-man-x"
          onLive={(n) => live(posFrom(n, pos.y))} onCommit={(n) => put(posFrom(n, pos.y))} onCancel={host.onCancel} />
        <span className="text-[10px] text-neutral-500">Y</span>
        <NumField value={pos.y} min={-50} max={50} step={0.5} suffix="%" label={`${t('vedit_man_pos')} Y`} testid="vedit-man-y"
          onLive={(n) => live(posFrom(pos.x, n))} onCommit={(n) => put(posFrom(pos.x, n))} onCancel={host.onCancel} />
        <TextKf host={host} props={TEXT_KF.pos} testid="vedit-man-kf-pos" />
      </Row>
      <Row label={t('vedit_man_rotate')}>
        <Slider value={look.rotate} min={-180} max={180} label={t('vedit_man_rotate')} testid="vedit-man-rotate"
          onLive={(n) => live({ rotate: n })} onCommit={(n) => put({ rotate: n })} />
        <NumField value={look.rotate} min={-360} max={360} suffix="°" label={t('vedit_man_rotate')} testid="vedit-man-rotate-num"
          onLive={(n) => live({ rotate: n })} onCommit={(n) => put({ rotate: n })} onCancel={host.onCancel} />
        <TextKf host={host} props={TEXT_KF.rot} testid="vedit-man-kf-rot" />
      </Row>

      <div className="pt-2 border-t border-neutral-800 text-neutral-400">{t('vedit_man_blend')}</div>
      <Row label={t('vedit_man_opacity')}>
        <Slider value={Math.round(look.opacity * 100)} min={0} max={100} label={t('vedit_man_opacity')} testid="vedit-man-opacity"
          onLive={(n) => live({ opacity: n / 100 })} onCommit={(n) => put({ opacity: n / 100 })} />
        <NumField value={Math.round(look.opacity * 100)} min={0} max={100} suffix="%" label={t('vedit_man_opacity')} testid="vedit-man-opacity-num"
          onLive={(n) => live({ opacity: n / 100 })} onCommit={(n) => put({ opacity: n / 100 })} onCancel={host.onCancel} />
        <TextKf host={host} props={TEXT_KF.opacity} testid="vedit-man-kf-opacity" />
      </Row>

      {/* 描边／背景：照剪映前面一个勾·勾上才展开（勾掉＝拿掉这项） */}
      <label className="pt-2 border-t border-neutral-800 flex items-center gap-2 text-neutral-300 cursor-pointer">
        <input type="checkbox" checked={!!body.stroke} data-testid="vedit-man-stroke" onChange={(e) => put({ stroke: e.target.checked ? STROKE_DEFAULT : null })} className="accent-cyan-500" />
        {t('vedit_man_stroke')}
      </label>
      {body.stroke && (() => { const st = body.stroke; return (
        <Row label={t('vedit_man_stroke_w')}>
          <ColorField value={hexOr(st.color, '#000000')} label={`${t('vedit_man_stroke')} ${t('vedit_man_color')}`} testid="vedit-man-stroke-color"
            onLive={(c) => live({ stroke: { ...st, color: c } })} onCommit={(c) => put({ stroke: { ...st, color: c } })} />
          <Slider value={strokeWOf(st.width)} min={1} max={100} label={t('vedit_man_stroke_w')} testid="vedit-man-stroke-w"
            onLive={(n) => live({ stroke: { ...st, width: strokeWFrom(n) } })} onCommit={(n) => put({ stroke: { ...st, width: strokeWFrom(n) } })} />
          <span className="w-7 text-right tabular-nums text-neutral-300">{strokeWOf(st.width)}</span>
        </Row>
      ) })()}
      <label className="pt-2 border-t border-neutral-800 flex items-center gap-2 text-neutral-300 cursor-pointer">
        <input type="checkbox" checked={!!body.bg} data-testid="vedit-man-bg" onChange={(e) => put({ bg: e.target.checked ? BG_DEFAULT : null })} className="accent-cyan-500" />
        {t('vedit_man_bg')}
      </label>
      {body.bg && (() => { const bg = body.bg; return (
        <Row label={t('vedit_man_opacity')}>
          <ColorField value={hexOr(bg.color, '#000000')} label={`${t('vedit_man_bg')} ${t('vedit_man_color')}`} testid="vedit-man-bg-color"
            onLive={(c) => live({ bg: { ...bg, color: c } })} onCommit={(c) => put({ bg: { ...bg, color: c } })} />
          <Slider value={Math.round(bg.opacity * 100)} min={0} max={100} label={`${t('vedit_man_bg')} ${t('vedit_man_opacity')}`} testid="vedit-man-bg-opacity"
            onLive={(n) => live({ bg: { ...bg, opacity: n / 100 } })} onCommit={(n) => put({ bg: { ...bg, opacity: n / 100 } })} />
          <span className="w-9 text-right tabular-nums text-neutral-300">{Math.round(bg.opacity * 100)}%</span>
        </Row>
      ) })()}
      <ShadowGlowSection body={body} live={live} put={put} />
    </div>
  )
}

/** 花字（接现有花字库）：点一款 ⇒ 选中的文字都套这款（字色、描边、背景拿掉·换回花字自己的）；「不用花字」⇒ 回素白字 */
function FancyPanel({ body, host }: { body: TextBody; host: ManualHost }) {
  const t = useStudioT()
  const language = useStudioLang()
  const L = language === 'zh-CN' ? 'cn' : language === 'en' ? 'en' : 'tw'
  const [cat, setCat] = useState<FancyCat>('hot')
  return (
    <div className="flex flex-col gap-2" data-testid="vedit-man-fancy">
      <div className="text-[11px] text-neutral-500">{t('vedit_man_fancy_hint')}</div>
      <div className="flex flex-wrap gap-1">
        {FANCY_CATS.map((c) => (
          <button key={c.id} type="button" data-testid="vedit-man-fancy-cat" data-cat={c.id} aria-pressed={cat === c.id} onMouseDown={(e) => e.preventDefault()} onClick={() => setCat(c.id)}
            className={`px-2 h-6 rounded-full text-[11px] ${cat === c.id ? 'bg-cyan-600/30 text-cyan-300' : 'bg-neutral-800 text-neutral-400 hover:text-neutral-200'}`}>{c[L]}</button>
        ))}
      </div>
      <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))' }}>
        <button type="button" data-testid="vedit-man-fancy-none" data-active={!body.fancy ? '1' : '0'} onMouseDown={(e) => e.preventDefault()} onClick={() => host.onPatch({ fancy: null }, true)}
          className={`h-14 rounded-md bg-neutral-800 hover:bg-neutral-700 text-[11px] text-neutral-300 ${!body.fancy ? 'ring-2 ring-cyan-400' : ''}`}>{t('vedit_man_fancy_none')}</button>
        {fancyIn(cat).map((f) => (
          <button key={f.id} type="button" title={f.name[L]} aria-label={f.name[L]} data-testid="vedit-man-fancy-item" data-fancy-id={f.id} data-active={body.fancy === f.id ? '1' : '0'}
            onMouseDown={(e) => e.preventDefault()} onClick={() => host.onPatch({ fancy: f.id, color: null, stroke: null, bg: null }, true)}
            className={`h-14 rounded-md bg-neutral-800 hover:bg-neutral-700 flex items-center justify-center overflow-hidden ${body.fancy === f.id ? 'ring-2 ring-cyan-400' : ''}`}>
            <VeditFancyText text={t('vedit_fancy_sample')} fancy={f.style} style={{ fontSize: 20 }} className="pointer-events-none" />
          </button>
        ))}
      </div>
    </div>
  )
}

const ANIM_SLOT_LABEL: Record<TextAnimSlot, TKey> = { in: 'vedit_man_anim_in', out: 'vedit_man_anim_out', loop: 'vedit_man_anim_loop' }
/** 姿势 ⇒ 预览小格的 CSS（同画面叠字：位移 em → 旋转 → 缩放·透明度） */
const poseCss = (q: AnimPose) => ({ transform: `translate(${q.tx}em, ${q.ty}em) rotate(${q.rot}deg) scale(${q.sx}, ${q.sy})`, opacity: q.alpha })

/** 动画页（照剪映 入场／出场／循环）：每格小样一直自己重播；点一款 ⇒ 套到选中的文字（只换这一格·别格不动）；「无」⇒ 拿掉这一格；下面调秒数 */
function AnimPanel({ ids, body, host }: { ids: string[]; body: TextBody; host: ManualHost }) {
  const t = useStudioT()
  const language = useStudioLang()
  const L = language === 'zh-CN' ? 'cn' : language === 'en' ? 'en' : 'tw'
  const [slot, setSlot] = useState<TextAnimSlot>('in')
  const [clock, setClock] = useState(0)
  useEffect(() => {
    let raf = 0
    const t0 = performance.now()
    const tick = () => { setClock((performance.now() - t0) / 1000); raf = requestAnimationFrame(tick) }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])
  const cur = body.anim?.[slot]
  const R = ANIM_DUR[slot]
  const sample = t('vedit_fancy_sample')
  const put = (v: { id: string; dur: number } | null) => host.onPatch({ anim: { [slot]: v } }, true)
  const durLive = (s: number) => cur && host.onPatch({ anim: { [slot]: { ...cur, dur: s } } }, false)
  const durPut = (s: number) => cur && host.onPatch({ anim: { [slot]: { ...cur, dur: s } } }, true)
  // 逐字款：每字间隔（秒）
  const curPc = !!(cur && animDef(slot, cur.id)?.perChar)
  const stLive = (v: number) => cur && host.onPatch({ anim: { [slot]: { ...cur, stagger: v } } }, false)
  const stPut = (v: number) => cur && host.onPatch({ anim: { [slot]: { ...cur, stagger: v } } }, true)
  // 没设 ⇒ 显示照时长与字数自动算的那个值（charTiming 同一支 autoStagger）
  const stShow = cur ? (cur.stagger ?? autoStagger(cur.dur, charCount(body.content))) : STAGGER.def
  return (
    <div className="p-2.5 flex flex-col gap-2.5" data-testid="vedit-man-anim" data-slot={slot} data-count={ids.length}>
      <div className="flex rounded-md bg-neutral-800 p-0.5" role="tablist">
        {ANIM_SLOTS.map((k) => (
          <button key={k} type="button" role="tab" aria-selected={slot === k} data-testid={`vedit-man-anim-slot-${k}`} data-set={body.anim?.[k] ? '1' : '0'} onClick={() => setSlot(k)} onMouseDown={(e) => e.preventDefault()}
            className={`relative flex-1 h-7 rounded ${slot === k ? 'bg-neutral-600 text-neutral-100' : 'text-neutral-400 hover:text-neutral-200'}`}>
            {t(ANIM_SLOT_LABEL[k])}
            {body.anim?.[k] && <span className="absolute top-1 right-1.5 w-1.5 h-1.5 rounded-full bg-cyan-400" aria-hidden />}
          </button>
        ))}
      </div>
      {ids.length > 1 && <div className="px-2 py-1 rounded bg-cyan-900/30 text-[11px] text-cyan-200" data-testid="vedit-man-multi">{t('vedit_man_multi').replace(/\{n\}/g, String(ids.length))}</div>}
      <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(68px, 1fr))' }} data-testid="vedit-man-anim-grid">
        <button type="button" data-testid="vedit-man-anim-none" data-active={!cur ? '1' : '0'} onMouseDown={(e) => e.preventDefault()} onClick={() => put(null)}
          className={`flex flex-col items-center gap-1 rounded-md p-1 ${!cur ? 'ring-2 ring-cyan-400 bg-neutral-800' : 'bg-neutral-800/60 hover:bg-neutral-800'}`}>
          <span className="h-12 w-full flex items-center justify-center text-neutral-500">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} className="w-5 h-5" aria-hidden><circle cx="10" cy="10" r="7" /><path d="M5 5l10 10" /></svg>
          </span>
          <span className="text-[11px] text-neutral-400">{t('vedit_man_anim_none')}</span>
        </button>
        {ANIM_LIB[slot].map((d) => {
          const q = previewPose(slot, d.id, cur?.id === d.id ? cur.dur : R.def, clock)
          const pcs = d.perChar ? previewCharPoses(slot, d.id, cur?.id === d.id ? cur.dur : R.def, clock, charCount(sample), cur?.id === d.id ? cur.stagger : undefined) : null
          return (
            <button key={d.id} type="button" title={d.name[L]} data-testid="vedit-man-anim-item" data-anim-id={d.id} data-active={cur?.id === d.id ? '1' : '0'} onMouseDown={(e) => e.preventDefault()}
              onClick={() => put({ id: d.id, dur: cur?.dur ?? R.def })}
              className={`flex flex-col items-center gap-1 rounded-md p-1 ${cur?.id === d.id ? 'ring-2 ring-cyan-400 bg-neutral-800' : 'bg-neutral-800/60 hover:bg-neutral-800'}`}>
              <span className="h-12 w-full flex items-center justify-center overflow-hidden" style={{ fontSize: 20 }}>
                <span className="inline-block font-black text-white" style={poseCss(q)}>
                  {pcs ? Array.from(sample).map((ch, k) => <span key={k} style={{ display: 'inline-block', whiteSpace: 'pre', ...charCss(pcs[k]) }}>{ch}</span>) : q.reveal < 1 ? <>{Array.from(sample).slice(0, visibleChars(sample, q.reveal)).join('')}<span style={{ visibility: 'hidden' }}>{Array.from(sample).slice(visibleChars(sample, q.reveal)).join('')}</span></> : sample}
                </span>
              </span>
              <span className="text-[11px] text-neutral-300 truncate max-w-full">{d.name[L]}</span>
            </button>
          )
        })}
      </div>
      {cur ? (
        <Row label={t(slot === 'loop' ? 'vedit_man_anim_speed' : 'vedit_man_anim_dur')}>
          <Slider value={Math.round(cur.dur * 10)} min={R.min * 10} max={R.max * 10} label={t('vedit_man_anim_dur')} testid="vedit-man-anim-dur"
            onLive={(n) => durLive(n / 10)} onCommit={(n) => durPut(n / 10)} />
          <NumField value={cur.dur} min={R.min} max={R.max} step={0.1} suffix={t('vedit_man_anim_sec')} label={t('vedit_man_anim_dur')} testid="vedit-man-anim-dur-num"
            onLive={durLive} onCommit={durPut} onCancel={host.onCancel} />
        </Row>
      ) : null}
      {cur && curPc ? (
        <Row label={t('vedit_man_anim_stagger')}>
          <Slider value={Math.round(stShow * 100)} min={STAGGER.min * 100} max={STAGGER.max * 100} label={t('vedit_man_anim_stagger')} testid="vedit-man-anim-stagger"
            onLive={(n) => stLive(n / 100)} onCommit={(n) => stPut(n / 100)} />
          <NumField value={stShow} min={STAGGER.min} max={STAGGER.max} step={0.01} suffix={t('vedit_man_anim_sec')} label={t('vedit_man_anim_stagger')} testid="vedit-man-anim-stagger-num"
            onLive={stLive} onCommit={stPut} onCancel={host.onCancel} />
        </Row>
      ) : null}
      {cur && curPc ? <div className="text-[11px] text-neutral-500 leading-relaxed" data-testid="vedit-man-anim-stagger-hint" data-auto={cur.stagger === undefined ? '1' : '0'}>{t('vedit_man_anim_stagger_hint')}</div> : null}
      {cur ? null : (
        <div className="text-[11px] text-neutral-500" data-testid="vedit-man-anim-hint">{t('vedit_man_anim_hint')}</div>
      )}
    </div>
  )
}


'use client'
// 网页剪辑页·「人工」文字栏的扩充项：字体下拉（系统三款＋站上 12 款开源字体）、竖排、阴影、发光、「气泡」分页。
// 值与画法在 _lib/text-style.pure.ts（resolveTextLook／displayText）·画面叠字与汇出同一份；改动交宿主 onPatch（live＝拖着即时看·put＝放手进复原栈）。
import { useEffect } from 'react'
import { useStudioT } from '../../shared/StudioT'
import type { VideoKey as TKey } from '../i18n'
import { ensureAllCatalogFontsLoaded, ensureFontLoaded } from '../../shared/fonts/load'
import { fontStack } from '../../shared/fonts/catalog'
import {
  GLOW_DEFAULT, SHADOW_BLUR_MAX, SHADOW_DEFAULT, SHADOW_DIST_MAX, TEXT_BUBBLES, TEXT_FONTS, WEB_FONTS,
  activeBubble, bubblePatch, resolveTextLook, type TextPatch,
} from '../lib/text-style.pure'
import type { TextBody, TextFont } from '../lib/timeline.pure'
import { ColorField, Row, Slider } from './ManualPane'
import VeditFancyText from './FancyText'

const FONT_LABEL: Record<TextFont, TKey> = { sans: 'vedit_man_font_sans', serif: 'vedit_man_font_serif', mono: 'vedit_man_font_mono' }
const hexOr = (c: string | undefined, d: string) => (c && /^#[0-9a-f]{6}$/i.test(c) ? c : d)

/** 字体下拉：打开时把站上字体都挂上（每项用自己的字预览·切片只拉命中几片）；选了站上字体先载 */
export function FontSelect({ body, put }: { body: TextBody; put: (p: TextPatch) => void }) {
  const t = useStudioT()
  useEffect(() => { if (body.font) ensureFontLoaded(body.font) }, [body.font])
  return (
    <select value={body.font ?? ''} aria-label={t('vedit_man_font')} data-testid="vedit-man-font" onFocus={() => ensureAllCatalogFontsLoaded()}
      onChange={(e) => { const v = e.target.value || null; if (v) ensureFontLoaded(v); put({ font: v }) }}
      className="flex-1 min-w-0 h-7 rounded bg-neutral-800 border border-neutral-700 px-1.5 text-neutral-100 outline-none">
      <option value="">{t('vedit_man_font_default')}</option>
      <optgroup label={t('vedit_man_font_sys')}>
        {TEXT_FONTS.map((f) => <option key={f} value={f}>{t(FONT_LABEL[f])}</option>)}
      </optgroup>
      <optgroup label={t('vedit_man_font_web')}>
        {WEB_FONTS.map((f) => <option key={f.id} value={f.id} style={{ fontFamily: fontStack(f.id) }}>{f.zh}</option>)}
      </optgroup>
    </select>
  )
}

/** 竖排开关（放在对齐那排后面） */
export function VerticalToggle({ body, put }: { body: TextBody; put: (p: TextPatch) => void }) {
  const t = useStudioT()
  return (
    <button type="button" title={t('vedit_man_vertical')} aria-label={t('vedit_man_vertical')} aria-pressed={!!body.vertical} data-testid="vedit-man-vertical"
      onMouseDown={(e) => e.preventDefault()} onClick={() => put({ vertical: body.vertical ? null : true })}
      className={`ml-2 h-7 px-1.5 rounded flex items-center gap-1 text-[11px] ${body.vertical ? 'bg-cyan-600/30 text-cyan-300' : 'bg-neutral-800 text-neutral-400 hover:text-neutral-200'}`}>
      <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="currentColor" aria-hidden><rect x="10" y="2" width="2" height="12" rx="1" /><rect x="5" y="2" width="2" height="8" rx="1" /></svg>
      {t('vedit_man_vertical')}
    </button>
  )
}

/** 阴影、发光：照描边／背景那样前面一个勾·勾上才展开 */
export function ShadowGlowSection({ body, live, put }: { body: TextBody; live: (p: TextPatch) => void; put: (p: TextPatch) => void }) {
  const t = useStudioT()
  const sh = body.shadow, gl = body.glow
  const num = (v: number, unit = '') => <span className="w-9 text-right tabular-nums text-neutral-300">{v}{unit}</span>
  return (
    <>
      <label className="pt-2 border-t border-neutral-800 flex items-center gap-2 text-neutral-300 cursor-pointer">
        <input type="checkbox" checked={!!sh} data-testid="vedit-man-shadow" onChange={(e) => put({ shadow: e.target.checked ? SHADOW_DEFAULT : null })} className="accent-cyan-500" />
        {t('vedit_man_shadow')}
      </label>
      {sh && (
        <>
          <Row label={t('vedit_man_color')}>
            <ColorField value={hexOr(sh.color, '#000000')} label={`${t('vedit_man_shadow')} ${t('vedit_man_color')}`} testid="vedit-man-shadow-color" onLive={(c) => live({ shadow: { ...sh, color: c } })} onCommit={(c) => put({ shadow: { ...sh, color: c } })} />
            <Slider value={Math.round(sh.opacity * 100)} min={0} max={100} label={`${t('vedit_man_shadow')} ${t('vedit_man_opacity')}`} testid="vedit-man-shadow-opacity"
              onLive={(n) => live({ shadow: { ...sh, opacity: n / 100 } })} onCommit={(n) => put({ shadow: { ...sh, opacity: n / 100 } })} />
            {num(Math.round(sh.opacity * 100), '%')}
          </Row>
          <Row label={t('vedit_man_shadow_dist')}>
            <Slider value={Math.round((sh.dist / SHADOW_DIST_MAX) * 100)} min={0} max={100} label={t('vedit_man_shadow_dist')} testid="vedit-man-shadow-dist"
              onLive={(n) => live({ shadow: { ...sh, dist: (n / 100) * SHADOW_DIST_MAX } })} onCommit={(n) => put({ shadow: { ...sh, dist: (n / 100) * SHADOW_DIST_MAX } })} />
            {num(Math.round((sh.dist / SHADOW_DIST_MAX) * 100))}
          </Row>
          <Row label={t('vedit_man_shadow_angle')}>
            <Slider value={sh.angle} min={0} max={359} label={t('vedit_man_shadow_angle')} testid="vedit-man-shadow-angle"
              onLive={(n) => live({ shadow: { ...sh, angle: n } })} onCommit={(n) => put({ shadow: { ...sh, angle: n } })} />
            {num(sh.angle, '°')}
          </Row>
          <Row label={t('vedit_man_shadow_blur')}>
            <Slider value={Math.round((sh.blur / SHADOW_BLUR_MAX) * 100)} min={0} max={100} label={t('vedit_man_shadow_blur')} testid="vedit-man-shadow-blur"
              onLive={(n) => live({ shadow: { ...sh, blur: (n / 100) * SHADOW_BLUR_MAX } })} onCommit={(n) => put({ shadow: { ...sh, blur: (n / 100) * SHADOW_BLUR_MAX } })} />
            {num(Math.round((sh.blur / SHADOW_BLUR_MAX) * 100))}
          </Row>
        </>
      )}
      <label className="pt-2 border-t border-neutral-800 flex items-center gap-2 text-neutral-300 cursor-pointer">
        <input type="checkbox" checked={!!gl} data-testid="vedit-man-glow" onChange={(e) => put({ glow: e.target.checked ? GLOW_DEFAULT : null })} className="accent-cyan-500" />
        {t('vedit_man_glow')}
      </label>
      {gl && (
        <Row label={t('vedit_man_glow_strength')}>
          <ColorField value={hexOr(gl.color, '#ffe066')} label={`${t('vedit_man_glow')} ${t('vedit_man_color')}`} testid="vedit-man-glow-color" onLive={(c) => live({ glow: { ...gl, color: c } })} onCommit={(c) => put({ glow: { ...gl, color: c } })} />
          <Slider value={Math.round(gl.strength * 100)} min={1} max={100} label={t('vedit_man_glow_strength')} testid="vedit-man-glow-strength"
            onLive={(n) => live({ glow: { ...gl, strength: n / 100 } })} onCommit={(n) => put({ glow: { ...gl, strength: n / 100 } })} />
          {num(Math.round(gl.strength * 100))}
        </Row>
      )}
    </>
  )
}

/** 「气泡」分页：点一款 ⇒ 选中的文字都套（字色＋有形状的背景）；「无」⇒ 拿掉 */
export function BubblePanel({ body, host }: { body: TextBody; host: { onPatch: (p: TextPatch, commit: boolean) => void } }) {
  const t = useStudioT()
  const cur = activeBubble(body)
  return (
    <div className="flex flex-col gap-2" data-testid="vedit-man-bubble">
      <div className="text-[11px] text-neutral-500">{t('vedit_man_bubble_hint')}</div>
      <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))' }}>
        <button type="button" data-testid="vedit-man-bubble-item" data-bubble="none" data-active={cur === 'none' ? '1' : '0'} onMouseDown={(e) => e.preventDefault()} onClick={() => host.onPatch(bubblePatch(null), true)}
          className={`h-16 rounded-md bg-neutral-800 hover:bg-neutral-700 text-[11px] text-neutral-300 ${cur === 'none' ? 'ring-2 ring-cyan-400' : ''}`}>{t('vedit_man_bubble_none')}</button>
        {TEXT_BUBBLES.map((b) => {
          const look = resolveTextLook({ content: 'Hi', x: 0.5, y: 0.5, size: 0.1, color: b.color, bg: { color: b.bg, opacity: 1, shape: b.shape } })
          return (
            <button key={b.id} type="button" data-testid="vedit-man-bubble-item" data-bubble={b.id} data-active={cur === b.id ? '1' : '0'} onMouseDown={(e) => e.preventDefault()} onClick={() => host.onPatch(bubblePatch(b), true)}
              className={`h-16 pb-2 rounded-md bg-neutral-600 hover:bg-neutral-500 flex items-center justify-center ${cur === b.id ? 'ring-2 ring-cyan-400' : ''}`}>
              <VeditFancyText text={t('vedit_bubble_sample')} fancy={look.style} style={{ fontSize: 14 }} className="pointer-events-none" />
            </button>
          )
        })}
      </div>
    </div>
  )
}

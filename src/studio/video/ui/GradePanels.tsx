'use client'
// 网页剪辑页·右栏「人工」的调色面板：调整页的 HSL／曲线／色轮／LUT、画面页的抠像、
// 基础页底下的圆角与阴影、蒙版页钢笔那款的点编辑。值的范围、验值、换算都在 _lib/grade.pure.ts 与 clip-look.pure.ts；
// 改动照旧交宿主 onPatch（拖的时候 commit=false 只即时看·放手 commit=true 进一步复原）·调色几样都是整份换（null＝拿掉）。
import { useRef, useState, type ReactNode } from 'react'
import { useStudioT } from '../../shared/StudioT'
import type { VideoKey as TKey } from '../i18n'
import { BORDER_DEFAULT, GLOW_DEFAULT, PEN_MAX, SHADOW_DEFAULT, lookOf, penPath, type ClipBorder, type ClipGlow, type ClipMask, type ClipShadow } from '../lib/clip-look.pure'
import {
  CURVE_CHANNELS, HSL_BANDS, HSL_HUE, KEY_DEFAULT, LUT_IDS, WHEELS, curveFn, hueColor, lutColor, normCurvePts, wheelColor,
  type ClipCurves, type ClipHsl, type ClipKey, type CurveChannel, type HslAdj, type HslBand, type LutId, type Wheel, type WheelKey,
} from '../lib/grade.pure'
import { NumField, Row, Slider } from './ManualPane'
import type { ClipHost } from './ClipInspector'

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const r3 = (v: number) => Math.round(v * 1000) / 1000
function Head({ title, onReset, testid, children }: { title: string; onReset?: () => void; testid?: string; children?: ReactNode }) {
  const t = useStudioT()
  return (
    <div className="flex items-center gap-2 text-neutral-300">
      {children}
      <span className="flex-1">{title}</span>
      {onReset && <button type="button" title={t('vedit_man_reset')} aria-label={t('vedit_man_reset')} data-testid={testid} onMouseDown={(e) => e.preventDefault()} onClick={onReset}
        className="h-6 w-6 rounded text-neutral-400 hover:text-white hover:bg-neutral-700">↺</button>}
    </div>
  )
}
const Hint = ({ k }: { k: TKey }) => { const t = useStudioT(); return <div className="text-[11px] text-neutral-500 leading-relaxed">{t(k)}</div> }

// ── HSL ──
const BAND_LABEL: Record<HslBand, TKey> = { red: 'vedit_ci_hsl_red', orange: 'vedit_ci_hsl_orange', yellow: 'vedit_ci_hsl_yellow', green: 'vedit_ci_hsl_green', cyan: 'vedit_ci_hsl_cyan', blue: 'vedit_ci_hsl_blue', purple: 'vedit_ci_hsl_purple', magenta: 'vedit_ci_hsl_magenta' }
export function HslPanel({ host }: { host: ClipHost }) {
  const t = useStudioT()
  const hsl = lookOf(host.state.clip).hsl ?? {}
  const [band, setBand] = useState<HslBand>('red')
  const a = hsl[band] ?? {}
  const next = (k: keyof HslAdj, v: number): ClipHsl => ({ ...hsl, [band]: { ...a, [k]: v } })
  const send = (k: keyof HslAdj, v: number, commit: boolean) => host.onPatch({ look: { hsl: next(k, v) } }, commit)
  const c = HSL_HUE[band]
  const tracks: Record<keyof HslAdj, string> = {
    h: `linear-gradient(90deg,${hueColor(c - 30)},${hueColor(c)},${hueColor(c + 30)})`,
    s: `linear-gradient(90deg,#9ca3af,${hueColor(c)})`,
    l: `linear-gradient(90deg,#111,${hueColor(c)},#fff)`,
  }
  return (
    <div className="flex flex-col gap-2.5" data-testid="vedit-ci-hsl" data-band={band}>
      <Head title={t('vedit_ci_sub_hsl')} testid="vedit-ci-hsl-reset" onReset={() => host.onPatch({ look: { hsl: null } }, true)} />
      <div className="flex items-center justify-between gap-1">
        {HSL_BANDS.map((b) => {
          const used = !!hsl[b]
          return (
            <button key={b} type="button" title={t(BAND_LABEL[b])} aria-label={t(BAND_LABEL[b])} aria-pressed={band === b} data-testid="vedit-ci-hsl-band" data-band={b} data-used={used ? '1' : '0'}
              onMouseDown={(e) => e.preventDefault()} onClick={() => setBand(b)}
              className={`relative h-6 w-6 rounded-full ${band === b ? 'ring-2 ring-white ring-offset-2 ring-offset-neutral-900' : ''}`} style={{ background: hueColor(HSL_HUE[b]) }}>
              {used && <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-white" aria-hidden />}
            </button>
          )
        })}
      </div>
      {(['h', 's', 'l'] as const).map((k) => (
        <Row key={k} label={t(k === 'h' ? 'vedit_ci_hsl_h' : k === 's' ? 'vedit_ci_hsl_s' : 'vedit_ci_hsl_l')}>
          <div className="flex-1 min-w-0 flex items-center" style={{ backgroundImage: tracks[k], backgroundSize: '100% 3px', backgroundRepeat: 'no-repeat', backgroundPosition: 'center' }}>
            <Slider value={a[k] ?? 0} min={-100} max={100} label={t(BAND_LABEL[band])} testid={`vedit-ci-hsl-${k}`} onLive={(n) => send(k, n, false)} onCommit={(n) => send(k, n, true)} />
          </div>
          <NumField value={a[k] ?? 0} min={-100} max={100} label={t(BAND_LABEL[band])} testid={`vedit-ci-hsl-${k}-num`} className="w-11" onLive={(n) => send(k, n, false)} onCommit={(n) => send(k, n, true)} onCancel={host.onCancel} />
        </Row>
      ))}
      <Hint k={'vedit_ci_hsl_hint'} />
    </div>
  )
}

// ── 曲线 ──
const CH_LABEL: Record<CurveChannel, TKey> = { rgb: 'vedit_ci_curve_rgb', r: 'vedit_ci_curve_r', g: 'vedit_ci_curve_g', b: 'vedit_ci_curve_b' }
const CH_COLOR: Record<CurveChannel, string> = { rgb: '#e5e5e5', r: '#f87171', g: '#4ade80', b: '#60a5fa' }
export function CurvesPanel({ host }: { host: ClipHost }) {
  const t = useStudioT()
  const curves = lookOf(host.state.clip).curves ?? {}
  const [ch, setCh] = useState<CurveChannel>('rgb')
  const [draft, setDraft] = useState<Array<[number, number]> | null>(null)
  const [pick, setPick] = useState<number | null>(null)
  const drag = useRef<{ i: number; box: DOMRect } | null>(null)
  const pts = draft ?? curves[ch] ?? [[0, 0], [1, 1]]
  const S = 200, P = 8
  const toPt = (e: { clientX: number; clientY: number }, box: DOMRect): [number, number] => [clamp(((e.clientX - box.left) / box.width) * (S + 2 * P) / S - P / S, 0, 1), clamp(1 - (((e.clientY - box.top) / box.height) * (S + 2 * P) / S - P / S), 0, 1)]
  const send = (p: Array<[number, number]>, commit: boolean) => {
    const n = normCurvePts(p)
    const out: ClipCurves = { ...curves }
    if (n) out[ch] = n; else delete out[ch]
    host.onPatch({ look: { curves: Object.keys(out).length ? out : null } }, commit)
  }
  const move = (i: number, q: [number, number]): Array<[number, number]> => {
    const n = pts.map((p) => [p[0], p[1]] as [number, number])
    const lo = i === 0 ? 0 : n[i - 1][0] + 0.02, hi = i === n.length - 1 ? 1 : n[i + 1][0] - 0.02
    n[i] = [r3(i === 0 || i === n.length - 1 ? n[i][0] : clamp(q[0], lo, hi)), r3(q[1])]
    return n
  }
  const f = curveFn(pts)
  const X = (x: number) => P + x * S, Y = (y: number) => P + (1 - y) * S
  const d = Array.from({ length: 65 }, (_, i) => `${i ? 'L' : 'M'}${X(i / 64).toFixed(1)} ${Y(f(i / 64)).toFixed(1)}`).join(' ')
  return (
    <div className="flex flex-col gap-2.5" data-testid="vedit-ci-curves" data-ch={ch}>
      <Head title={t('vedit_ci_sub_curve')} testid="vedit-ci-curves-reset" onReset={() => { setPick(null); host.onPatch({ look: { curves: null } }, true) }} />
      <div className="flex rounded-md bg-neutral-800 p-0.5">
        {CURVE_CHANNELS.map((c) => (
          <button key={c} type="button" data-testid="vedit-ci-curve-ch" data-ch={c} aria-pressed={ch === c} onMouseDown={(e) => e.preventDefault()} onClick={() => { setCh(c); setPick(null) }}
            className={`flex-1 h-6 rounded ${ch === c ? 'bg-neutral-600' : 'hover:bg-neutral-700'}`} style={{ color: CH_COLOR[c] }}>{t(CH_LABEL[c])}</button>
        ))}
      </div>
      <svg viewBox={`0 0 ${S + 2 * P} ${S + 2 * P}`} className="w-full aspect-square rounded bg-neutral-950 touch-none select-none" data-testid="vedit-ci-curves-graph" role="img" aria-label={t('vedit_ci_sub_curve')}
        onDoubleClick={(e) => {
          const q = toPt(e, e.currentTarget.getBoundingClientRect())
          if (pts.length >= 16 || pts.some((p) => Math.abs(p[0] - q[0]) < 0.03)) return
          const n = [...pts, [r3(q[0]), r3(f(q[0]))] as [number, number]].sort((a, b) => a[0] - b[0])
          send(n, true)
        }}
        onPointerMove={(e) => { const g = drag.current; if (g) { const n = move(g.i, toPt(e, g.box)); setDraft(n); send(n, false) } }}
        onPointerUp={() => { const g = drag.current; drag.current = null; if (g && draft) { send(draft, true); setDraft(null) } }}>
        {[0.25, 0.5, 0.75].map((v) => <g key={v}><path d={`M${X(v)} ${P}V${P + S}`} stroke="#333" strokeWidth={0.6} /><path d={`M${P} ${Y(v)}H${P + S}`} stroke="#333" strokeWidth={0.6} /></g>)}
        <path d={`M${X(0)} ${Y(0)}L${X(1)} ${Y(1)}`} stroke="#444" strokeWidth={0.8} strokeDasharray="3 3" />
        <path d={d} fill="none" stroke={CH_COLOR[ch]} strokeWidth={1.6} />
        {pts.map(([x, y], i) => (
          <circle key={i} cx={X(x)} cy={Y(y)} r={pick === i ? 5 : 4} data-testid="vedit-ci-curves-pt" data-x={x} data-y={y} fill={pick === i ? CH_COLOR[ch] : '#0a0a0a'} stroke={CH_COLOR[ch]} strokeWidth={1.4} className="cursor-grab"
            onPointerDown={(e) => { e.stopPropagation(); const svg = e.currentTarget.ownerSVGElement as SVGSVGElement; svg.setPointerCapture(e.pointerId); drag.current = { i, box: svg.getBoundingClientRect() }; setPick(i) }} />
        ))}
      </svg>
      {pick !== null && pick > 0 && pick < pts.length - 1 && (
        <button type="button" data-testid="vedit-ci-curves-del" onMouseDown={(e) => e.preventDefault()} onClick={() => { send(pts.filter((_, j) => j !== pick), true); setPick(null) }}
          className="self-start h-6 px-2 rounded bg-neutral-800 text-neutral-300 hover:bg-neutral-700">{t('vedit_ci_curve_del')}</button>
      )}
      <Hint k={'vedit_ci_curves_hint'} />
    </div>
  )
}

// ── 色轮 ──
const WHEEL_LABEL: Record<WheelKey, TKey> = { lift: 'vedit_ci_wheel_lift', gamma: 'vedit_ci_wheel_gamma', gain: 'vedit_ci_wheel_gain', offset: 'vedit_ci_wheel_offset' }
function WheelPad({ w, onChange, testid, label }: { w: Wheel; onChange: (w: Wheel, commit: boolean) => void; testid: string; label: string }) {
  const drag = useRef<DOMRect | null>(null)
  const at = (e: { clientX: number; clientY: number }, b: DOMRect) => {
    let x = ((e.clientX - b.left) / b.width) * 2 - 1, y = ((e.clientY - b.top) / b.height) * 2 - 1
    const r = Math.hypot(x, y); if (r > 1) { x /= r; y /= r }
    return { ...w, x: r3(x), y: r3(y) }
  }
  return (
    <div role="slider" aria-label={label} aria-valuetext={`${w.x},${w.y}`} tabIndex={0} data-testid={testid} data-x={w.x} data-y={w.y}
      className="relative aspect-square w-full rounded-full touch-none cursor-crosshair"
      style={{ background: 'radial-gradient(circle, rgba(128,128,128,1) 0%, rgba(128,128,128,0) 70%), conic-gradient(from 90deg, #f00, #f0f, #00f, #0ff, #0f0, #ff0, #f00)' }}
      onPointerDown={(e) => { const b = e.currentTarget.getBoundingClientRect(); e.currentTarget.setPointerCapture(e.pointerId); drag.current = b; onChange(at(e, b), false) }}
      onPointerMove={(e) => { if (drag.current) onChange(at(e, drag.current), false) }}
      onPointerUp={(e) => { const b = drag.current; drag.current = null; if (b) onChange(at(e, b), true) }}
      onDoubleClick={() => onChange({ ...w, x: 0, y: 0 }, true)}>
      <span className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow" style={{ left: `${50 + w.x * 50}%`, top: `${50 + w.y * 50}%`, background: wheelColor(w) }} aria-hidden />
    </div>
  )
}
export function WheelsPanel({ host }: { host: ClipHost }) {
  const t = useStudioT()
  const wheels = lookOf(host.state.clip).wheels ?? {}
  const send = (k: WheelKey, w: Wheel, commit: boolean) => host.onPatch({ look: { wheels: { ...wheels, [k]: w } } }, commit)
  return (
    <div className="flex flex-col gap-2.5" data-testid="vedit-ci-wheels">
      <Head title={t('vedit_ci_sub_wheel')} testid="vedit-ci-wheels-reset" onReset={() => host.onPatch({ look: { wheels: null } }, true)} />
      <div className="grid grid-cols-2 gap-3">
        {WHEELS.map((k) => {
          const w = wheels[k] ?? { x: 0, y: 0, l: 0 }
          return (
            <div key={k} className="flex flex-col items-stretch gap-1.5" data-testid={`vedit-ci-wheel-${k}`}>
              <div className="flex items-center justify-between text-neutral-300"><span>{t(WHEEL_LABEL[k])}</span>
                <button type="button" title={t('vedit_man_reset')} aria-label={t('vedit_man_reset')} onMouseDown={(e) => e.preventDefault()} onClick={() => send(k, { x: 0, y: 0, l: 0 }, true)} className="h-5 w-5 rounded text-neutral-500 hover:text-white">↺</button>
              </div>
              <WheelPad w={w} label={t(WHEEL_LABEL[k])} testid={`vedit-ci-wheel-${k}-pad`} onChange={(n, c) => send(k, n, c)} />
              <Slider value={w.l} min={-100} max={100} label={`${t(WHEEL_LABEL[k])} ${t('vedit_ci_wheel_l')}`} testid={`vedit-ci-wheel-${k}-l`} onLive={(n) => send(k, { ...w, l: n }, false)} onCommit={(n) => send(k, { ...w, l: n }, true)} />
            </div>
          )
        })}
      </div>
      <Hint k={'vedit_ci_wheels_hint'} />
    </div>
  )
}

// ── LUT ──
const LUT_LABEL: Record<LutId, TKey> = {
  'teal-orange': 'vedit_ci_lut_teal_orange', film: 'vedit_ci_lut_film', kodak: 'vedit_ci_lut_kodak', bleach: 'vedit_ci_lut_bleach', mono: 'vedit_ci_lut_mono',
  vintage: 'vedit_ci_lut_vintage', cool: 'vedit_ci_lut_cool', warm: 'vedit_ci_lut_warm', cyber: 'vedit_ci_lut_cyber', matte: 'vedit_ci_lut_matte',
}
/** 色卡小样：几个固定颜色（天空、肤色、草地、暗部…）套这款 */
const SWATCH: Array<[number, number, number]> = [[0.35, 0.55, 0.85], [0.9, 0.7, 0.55], [0.3, 0.55, 0.25], [0.12, 0.12, 0.15], [0.85, 0.85, 0.8], [0.75, 0.2, 0.2]]
const css = (c: [number, number, number]) => `rgb(${c.map((v) => Math.round(clamp(v, 0, 1) * 255)).join(',')})`
export function LutPanel({ host }: { host: ClipHost }) {
  const t = useStudioT()
  const lut = lookOf(host.state.clip).lut
  const put = (id: LutId | null, strength = lut?.strength ?? 100, commit = true) => host.onPatch({ look: { lut: id ? { id, strength } : null } }, commit)
  return (
    <div className="flex flex-col gap-2.5" data-testid="vedit-ci-lut" data-id={lut?.id ?? 'none'}>
      <Head title={t('vedit_ci_sub_lut')} testid="vedit-ci-lut-reset" onReset={() => put(null)} />
      <div className="grid grid-cols-3 gap-1.5">
        <button type="button" data-testid="vedit-ci-lut-item" data-id="none" onMouseDown={(e) => e.preventDefault()} onClick={() => put(null)}
          className={`flex flex-col items-center gap-1 rounded-md p-1 ${!lut ? 'ring-2 ring-cyan-400 bg-neutral-800' : 'bg-neutral-800/60 hover:bg-neutral-800'}`}>
          <span className="flex w-full h-5 rounded overflow-hidden">{SWATCH.map((c, i) => <span key={i} className="flex-1" style={{ background: css(c) }} />)}</span>
          <span className="text-[11px] text-neutral-300">{t('vedit_ci_lut_none')}</span>
        </button>
        {LUT_IDS.map((id) => (
          <button key={id} type="button" data-testid="vedit-ci-lut-item" data-id={id} data-active={lut?.id === id ? '1' : '0'} onMouseDown={(e) => e.preventDefault()} onClick={() => put(id)}
            className={`flex flex-col items-center gap-1 rounded-md p-1 ${lut?.id === id ? 'ring-2 ring-cyan-400 bg-neutral-800' : 'bg-neutral-800/60 hover:bg-neutral-800'}`}>
            <span className="flex w-full h-5 rounded overflow-hidden">{SWATCH.map((c, i) => <span key={i} className="flex-1" style={{ background: css(lutColor(id, c[0], c[1], c[2])) }} />)}</span>
            <span className="text-[11px] text-neutral-300 truncate max-w-full">{t(LUT_LABEL[id])}</span>
          </button>
        ))}
      </div>
      {lut && (
        <Row label={t('vedit_ci_lut_strength')}>
          <Slider value={lut.strength} min={0} max={100} label={t('vedit_ci_lut_strength')} testid="vedit-ci-lut-strength" onLive={(n) => put(lut.id, n, false)} onCommit={(n) => put(lut.id, n)} />
          <span className="w-7 text-right tabular-nums text-neutral-300">{lut.strength}</span>
        </Row>
      )}
      <Hint k={'vedit_ci_lut_hint'} />
    </div>
  )
}

// ── 抠像（色度抠图）──
const KEY_COLORS = ['#00ff00', '#00b140', '#0047bb', '#0000ff'] as const
export function KeyPanel({ host }: { host: ClipHost }) {
  const t = useStudioT()
  const key = lookOf(host.state.clip).key
  const put = (k: ClipKey | null, commit = true) => host.onPatch({ look: { key: k } }, commit)
  const eyeDropper = typeof window !== 'undefined' && 'EyeDropper' in window
  const pickScreen = async () => {
    try {
      const Ed = (window as unknown as { EyeDropper: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper
      const r = await new Ed().open()
      if (/^#[0-9a-f]{6}$/i.test(r.sRGBHex)) put({ ...(key ?? KEY_DEFAULT), color: r.sRGBHex.toLowerCase() })
    } catch { /* 按了 Esc */ }
  }
  const k = key ?? KEY_DEFAULT
  return (
    <div className="flex flex-col gap-2.5" data-testid="vedit-ci-key" data-on={key ? '1' : '0'}>
      <Row label={t('vedit_ci_key_on')}>
        <label className="ml-auto inline-flex items-center cursor-pointer"><input type="checkbox" checked={!!key} data-testid="vedit-ci-key-on" onChange={(e) => put(e.target.checked ? KEY_DEFAULT : null)} className="accent-cyan-500" /></label>
      </Row>
      {key && (
        <>
          <Row label={t('vedit_ci_key_color')}>
            <div className="flex items-center gap-1.5">
              {KEY_COLORS.map((c) => (
                <button key={c} type="button" title={c} aria-label={c} data-testid="vedit-ci-key-preset" data-color={c} onMouseDown={(e) => e.preventDefault()} onClick={() => put({ ...k, color: c })}
                  className={`h-6 w-6 rounded ${k.color === c ? 'ring-2 ring-cyan-400' : 'ring-1 ring-neutral-700'}`} style={{ background: c }} />
              ))}
              <label className="h-6 w-6 rounded ring-1 ring-neutral-700 cursor-pointer" style={{ background: k.color }} title={t('vedit_ci_key_custom')}>
                <input type="color" className="sr-only" value={k.color} data-testid="vedit-ci-key-pick" onChange={(e) => put({ ...k, color: e.target.value.toLowerCase() })} />
              </label>
              {eyeDropper && <button type="button" data-testid="vedit-ci-key-eyedrop" title={t('vedit_ci_key_eyedrop')} aria-label={t('vedit_ci_key_eyedrop')} onMouseDown={(e) => e.preventDefault()} onClick={() => { void pickScreen() }}
                className="h-6 px-1.5 rounded bg-neutral-800 text-neutral-300 hover:bg-neutral-700">⌖</button>}
            </div>
          </Row>
          {([['sim', 'vedit_ci_key_sim'], ['soft', 'vedit_ci_key_soft'], ['spill', 'vedit_ci_key_spill']] as const).map(([f, label]) => (
            <Row key={f} label={t(label)}>
              <Slider value={k[f]} min={0} max={100} label={t(label)} testid={`vedit-ci-key-${f}`} onLive={(n) => put({ ...k, [f]: n }, false)} onCommit={(n) => put({ ...k, [f]: n })} />
              <span className="w-7 text-right tabular-nums text-neutral-300">{k[f]}</span>
            </Row>
          ))}
        </>
      )}
      <Hint k={'vedit_ci_key_hint'} />
    </div>
  )
}

// ── 圆角与阴影（画面·基础页底下）──
export function StyleSection({ host }: { host: ClipHost }) {
  const t = useStudioT()
  const l = lookOf(host.state.clip)
  const sh = l.shadow
  const putSh = (s: ClipShadow | null, commit = true) => host.onPatch({ look: { shadow: s } }, commit)
  return (
    <div className="flex flex-col gap-2.5" data-testid="vedit-ci-style">
      <div className="pt-2 border-t border-neutral-800 text-neutral-300">{t('vedit_ci_style')}</div>
      <Row label={t('vedit_ci_corner')}>
        <Slider value={l.corner} min={0} max={100} label={t('vedit_ci_corner')} testid="vedit-ci-corner" onLive={(n) => host.onPatch({ look: { corner: n } }, false)} onCommit={(n) => host.onPatch({ look: { corner: n } }, true)} />
        <span className="w-7 text-right tabular-nums text-neutral-300">{l.corner}</span>
      </Row>
      <Row label={t('vedit_ci_shadow')}>
        <label className="ml-auto inline-flex items-center cursor-pointer"><input type="checkbox" checked={!!sh} data-testid="vedit-ci-shadow-on" onChange={(e) => putSh(e.target.checked ? SHADOW_DEFAULT : null)} className="accent-cyan-500" /></label>
      </Row>
      {sh && (
        <>
          <Row label={t('vedit_ci_shadow_color')}>
            <label className="ml-auto h-6 w-10 rounded ring-1 ring-neutral-700 cursor-pointer" style={{ background: sh.color }}>
              <input type="color" className="sr-only" value={sh.color} data-testid="vedit-ci-shadow-color" onChange={(e) => putSh({ ...sh, color: e.target.value.toLowerCase() })} />
            </label>
          </Row>
          {([['opacity', 'vedit_ci_shadow_opacity', 100], ['blur', 'vedit_ci_shadow_blur', 100], ['dist', 'vedit_ci_shadow_dist', 100], ['angle', 'vedit_ci_shadow_angle', 359]] as const).map(([f, label, hi]) => (
            <Row key={f} label={t(label)}>
              <Slider value={sh[f]} min={0} max={hi} label={t(label)} testid={`vedit-ci-shadow-${f}`} onLive={(n) => putSh({ ...sh, [f]: n }, false)} onCommit={(n) => putSh({ ...sh, [f]: n })} />
              <span className="w-8 text-right tabular-nums text-neutral-300">{sh[f]}{f === 'angle' ? '°' : ''}</span>
            </Row>
          ))}
        </>
      )}
      <GlowBorderRows host={host} />
    </div>
  )
}
/** 外发光（颜色／半径／强度）与描边（颜色／宽度·跟圆角一起走） */
function GlowBorderRows({ host }: { host: ClipHost }) {
  const t = useStudioT()
  const l = lookOf(host.state.clip)
  const gl = l.glow, bd = l.border
  const putGl = (g: ClipGlow | null, commit = true) => host.onPatch({ look: { glow: g } }, commit)
  const putBd = (b: ClipBorder | null, commit = true) => host.onPatch({ look: { border: b } }, commit)
  const color = (v: string, testid: string, on: (c: string) => void) => (
    <label className="ml-auto h-6 w-10 rounded ring-1 ring-neutral-700 cursor-pointer" style={{ background: v }}>
      <input type="color" className="sr-only" value={v} data-testid={testid} onChange={(e) => on(e.target.value.toLowerCase())} />
    </label>
  )
  return (
    <>
      <Row label={t('vedit_ci_glow')}>
        <label className="ml-auto inline-flex items-center cursor-pointer"><input type="checkbox" checked={!!gl} data-testid="vedit-ci-glow-on" onChange={(e) => putGl(e.target.checked ? GLOW_DEFAULT : null)} className="accent-cyan-500" /></label>
      </Row>
      {gl && <>
        <Row label={t('vedit_ci_glow_color')}>{color(gl.color, 'vedit-ci-glow-color', (c) => putGl({ ...gl, color: c }))}</Row>
        {([['radius', 'vedit_ci_glow_radius'], ['strength', 'vedit_ci_glow_strength']] as const).map(([f, label]) => (
          <Row key={f} label={t(label)}>
            <Slider value={gl[f]} min={1} max={100} label={t(label)} testid={`vedit-ci-glow-${f}`} onLive={(n) => putGl({ ...gl, [f]: n }, false)} onCommit={(n) => putGl({ ...gl, [f]: n })} />
            <span className="w-8 text-right tabular-nums text-neutral-300">{gl[f]}</span>
          </Row>
        ))}
      </>}
      <Row label={t('vedit_ci_border')}>
        <label className="ml-auto inline-flex items-center cursor-pointer"><input type="checkbox" checked={!!bd} data-testid="vedit-ci-border-on" onChange={(e) => putBd(e.target.checked ? BORDER_DEFAULT : null)} className="accent-cyan-500" /></label>
      </Row>
      {bd && <>
        <Row label={t('vedit_ci_border_color')}>{color(bd.color, 'vedit-ci-border-color', (c) => putBd({ ...bd, color: c }))}</Row>
        <Row label={t('vedit_ci_border_width')}>
          <Slider value={bd.width} min={1} max={100} label={t('vedit_ci_border_width')} testid="vedit-ci-border-width" onLive={(n) => putBd({ ...bd, width: n }, false)} onCommit={(n) => putBd({ ...bd, width: n })} />
          <span className="w-8 text-right tabular-nums text-neutral-300">{bd.width}</span>
        </Row>
      </>}
    </>
  )
}

// ── 钢笔蒙版：点编辑 ──
/** 编辑框显示单位方框 -0.6～0.6（点可以拖出 -0.5～0.5 一点）·拖点·双击边上加点·选中的点可删·直线／平滑 */
export function PenEditor({ host, m }: { host: ClipHost; m: ClipMask }) {
  const t = useStudioT()
  const [draft, setDraft] = useState<Array<[number, number]> | null>(null)
  const [pick, setPick] = useState<number | null>(null)
  const drag = useRef<{ i: number; box: DOMRect } | null>(null)
  const pts = draft ?? m.pts ?? []
  const S = 200, R = 0.6
  const X = (x: number) => ((x + R) / (2 * R)) * S, Y = (y: number) => ((y + R) / (2 * R)) * S
  const toPt = (e: { clientX: number; clientY: number }, b: DOMRect): [number, number] => [r3(clamp(((e.clientX - b.left) / b.width) * 2 * R - R, -1, 1)), r3(clamp(((e.clientY - b.top) / b.height) * 2 * R - R, -1, 1))]
  const send = (p: Array<[number, number]>, commit: boolean) => host.onPatch({ look: { mask: { pts: p } } }, commit)
  const addAt = (q: [number, number]) => {
    if (pts.length >= PEN_MAX) return
    let best = 0, bd = Infinity
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length]
      const vx = b[0] - a[0], vy = b[1] - a[1], L2 = vx * vx + vy * vy || 1
      const u = clamp(((q[0] - a[0]) * vx + (q[1] - a[1]) * vy) / L2, 0, 1)
      const dd = Math.hypot(a[0] + u * vx - q[0], a[1] + u * vy - q[1])
      if (dd < bd) { bd = dd; best = i }
    }
    const n = [...pts]; n.splice(best + 1, 0, q); send(n, true); setPick(best + 1)
  }
  return (
    <div className="flex flex-col gap-1.5" data-testid="vedit-ci-pen" data-count={pts.length}>
      <svg viewBox={`0 0 ${S} ${S}`} className="w-full aspect-square rounded bg-neutral-950 touch-none select-none" data-testid="vedit-ci-pen-box" role="img" aria-label={t('vedit_ci_mask_pen')}
        onDoubleClick={(e) => addAt(toPt(e, e.currentTarget.getBoundingClientRect()))}
        onPointerMove={(e) => { const g = drag.current; if (!g) return; const n = pts.map((p) => [p[0], p[1]] as [number, number]); n[g.i] = toPt(e, g.box); setDraft(n); send(n, false) }}
        onPointerUp={() => { const g = drag.current; drag.current = null; if (g && draft) { send(draft, true); setDraft(null) } }}>
        <rect x={X(-0.5)} y={Y(-0.5)} width={X(0.5) - X(-0.5)} height={Y(0.5) - Y(-0.5)} fill="none" stroke="#404040" strokeDasharray="3 3" />
        <path d={penPath(pts, !!m.sharp, (x, y) => [X(x), Y(y)])} fill="rgba(34,211,238,0.15)" stroke="#22d3ee" strokeWidth={1.4} />
        {pts.map(([x, y], i) => (
          <circle key={i} cx={X(x)} cy={Y(y)} r={pick === i ? 5 : 4} data-testid="vedit-ci-pen-pt" fill={pick === i ? '#22d3ee' : '#0a0a0a'} stroke="#22d3ee" strokeWidth={1.4} className="cursor-grab"
            onPointerDown={(e) => { e.stopPropagation(); const svg = e.currentTarget.ownerSVGElement as SVGSVGElement; svg.setPointerCapture(e.pointerId); drag.current = { i, box: svg.getBoundingClientRect() }; setPick(i) }} />
        ))}
      </svg>
      <div className="flex items-center gap-2">
        <label className="inline-flex items-center gap-1 text-neutral-300 cursor-pointer"><input type="checkbox" checked={!!m.sharp} data-testid="vedit-ci-pen-sharp" onChange={(e) => host.onPatch({ look: { mask: { sharp: e.target.checked } } }, true)} className="accent-cyan-500" />{t('vedit_ci_pen_sharp')}</label>
        <span className="flex-1" />
        {pick !== null && pts.length > 3 && <button type="button" data-testid="vedit-ci-pen-del" onMouseDown={(e) => e.preventDefault()} onClick={() => { send(pts.filter((_, j) => j !== pick), true); setPick(null) }}
          className="h-6 px-2 rounded bg-neutral-800 text-neutral-300 hover:bg-neutral-700">{t('vedit_ci_pen_del')}</button>}
      </div>
      <Hint k={'vedit_ci_pen_hint'} />
    </div>
  )
}

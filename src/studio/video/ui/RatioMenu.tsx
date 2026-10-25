'use client'
// 网页剪辑页·播放器右下角「比例」钮＋选单（照剪映专业版截图逐项）。
// 选单往上弹（钮在播放器底栏）：适应（原始）／自定义（填宽高）｜横的五项｜竖的五项·右边小框示意·勾当前项。
// 点外面／Esc 收起。清单与算法在 _lib/ratio.pure.ts。

import { useEffect, useRef, useState } from 'react'
import { useStudioT } from '../../shared/StudioT'
import {
  CUSTOM_DEFAULT, RATIO_LANDSCAPE, RATIO_PORTRAIT, RATIO_PRESETS, clampCustom, iconBox, sameRatio,
  type RatioPresetKey, type RatioSel,
} from '../lib/ratio.pure'

// 16:9／9:16 只写比例
const PRESET_LABEL: Readonly<Record<RatioPresetKey, { text: string }>> = {
  '16:9': { text: '16:9' }, '4:3': { text: '4:3' }, '2.35:1': { text: '2.35:1' }, '2:1': { text: '2:1' }, '1.85:1': { text: '1.85:1' },
  '9:16': { text: '9:16' }, '3:4': { text: '3:4' }, '5.8in': { text: '' }, '1:1': { text: '1:1' }, '1:2': { text: '1:2' },
}

function Shape({ ratio }: { ratio: number }) {
  const b = iconBox(ratio)
  return <span className="w-6 flex justify-center shrink-0" aria-hidden><span className="block rounded-[2px] border border-neutral-400" style={{ width: b.w, height: b.h }} /></span>
}

export default function VeditRatioMenu({ value, onChange }: { value: RatioSel; onChange: (v: RatioSel) => void }) {
  const t = useStudioT()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [cw, setCw] = useState(String(value.kind === 'custom' ? value.w : CUSTOM_DEFAULT.w))
  const [ch, setCh] = useState(String(value.kind === 'custom' ? value.h : CUSTOM_DEFAULT.h))
  const boxRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  // 选单贴着钮往上弹·用 fixed（播放器外框 overflow-hidden·播放器矮时 absolute 会被切掉）·放不下就在选单里捲
  const [pos, setPos] = useState<{ right: number; bottom: number; maxH: number } | null>(null)
  const place = () => {
    const r = btnRef.current?.getBoundingClientRect()
    if (r) setPos({ right: Math.max(4, window.innerWidth - r.right), bottom: window.innerHeight - r.top + 6, maxH: Math.max(160, r.top - 12) })
  }

  useEffect(() => {
    if (!open) return
    const down = (e: PointerEvent) => { if (!boxRef.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } }
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('keydown', esc, true)
    window.addEventListener('resize', place)
    return () => { window.removeEventListener('pointerdown', down, true); window.removeEventListener('keydown', esc, true); window.removeEventListener('resize', place) }
  }, [open])
  useEffect(() => { if (!open) setEditing(false) }, [open])

  const pick = (v: RatioSel) => { onChange(v); setOpen(false) }
  const applyCustom = () => {
    const w = clampCustom(cw), h = clampCustom(ch)
    if (w === null || h === null) return
    setCw(String(w)); setCh(String(h))
    pick({ kind: 'custom', w, h })
  }
  const row = (sel: RatioSel, label: React.ReactNode, ratio: number | null, testid: string) => (
    <button key={testid} type="button" role="menuitemradio" aria-checked={sameRatio(value, sel)} data-testid={testid}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => (sel.kind === 'custom' ? setEditing((x) => !x) : pick(sel))}
      className="w-full h-8 px-2 flex items-center gap-2 rounded text-left text-[13px] text-neutral-200 hover:bg-neutral-700">
      <span className="w-4 shrink-0 text-cyan-400">{sameRatio(value, sel) ? '✓' : ''}</span>
      <span className="flex-1 whitespace-nowrap">{label}</span>
      {ratio !== null && <Shape ratio={ratio} />}
    </button>
  )
  const presetRow = (k: RatioPresetKey) => {
    const l = PRESET_LABEL[k]
    const text = k === '5.8in' ? t('vedit_ratio_58') : l.text
    return row({ kind: 'preset', key: k }, text, RATIO_PRESETS[k], `vedit-ratio-${k}`)
  }
  const label = t('vedit_ratio')

  return (
    <div ref={boxRef} className="relative">
      <button ref={btnRef} type="button" title={label} aria-label={label} aria-haspopup="menu" aria-expanded={open} data-testid="vedit-ratio"
        onMouseDown={(e) => e.preventDefault()} onClick={() => { place(); setOpen((o) => !o) }}
        className={`h-6 px-1.5 rounded border text-[11px] leading-none ${open ? 'border-neutral-300 text-neutral-100 bg-neutral-700' : 'border-neutral-500 text-neutral-300 hover:bg-neutral-700'}`}>
        {label}
      </button>
      {open && pos && (
        <div role="menu" data-testid="vedit-ratio-menu" className="fixed z-50 w-56 p-1 rounded-lg bg-neutral-800 border border-neutral-700 shadow-xl overflow-y-auto"
          style={{ right: pos.right, bottom: pos.bottom, maxHeight: pos.maxH }}>
          {row({ kind: 'fit' }, t('vedit_ratio_fit'), null, 'vedit-ratio-fit')}
          {row({ kind: 'custom', w: 0, h: 0 }, value.kind === 'custom' ? `${t('vedit_ratio_custom')}（${value.w}×${value.h}）` : t('vedit_ratio_custom'), null, 'vedit-ratio-custom')}
          {editing && (
            <form className="px-2 pb-1.5 pt-0.5 flex items-center gap-1 text-[12px] text-neutral-300" data-testid="vedit-ratio-custom-form"
              onSubmit={(e) => { e.preventDefault(); applyCustom() }}>
              <input inputMode="numeric" value={cw} onChange={(e) => setCw(e.target.value)} aria-label={t('vedit_ratio_w')} placeholder={t('vedit_ratio_w')} data-testid="vedit-ratio-w"
                className="w-16 h-6 px-1 rounded bg-neutral-900 border border-neutral-600 text-neutral-100 tabular-nums outline-none focus:border-cyan-500" />
              <span>×</span>
              <input inputMode="numeric" value={ch} onChange={(e) => setCh(e.target.value)} aria-label={t('vedit_ratio_h')} placeholder={t('vedit_ratio_h')} data-testid="vedit-ratio-h"
                className="w-16 h-6 px-1 rounded bg-neutral-900 border border-neutral-600 text-neutral-100 tabular-nums outline-none focus:border-cyan-500" />
              <button type="submit" data-testid="vedit-ratio-apply" disabled={clampCustom(cw) === null || clampCustom(ch) === null}
                className="ml-auto h-6 px-2 rounded bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white">{t('vedit_ratio_apply')}</button>
            </form>
          )}
          <div className="my-1 border-t border-neutral-700" />
          {RATIO_LANDSCAPE.map(presetRow)}
          <div className="my-1 border-t border-neutral-700" />
          {RATIO_PORTRAIT.map(presetRow)}
        </div>
      )}
    </div>
  )
}

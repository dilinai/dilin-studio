'use client'
// 网页剪辑页·父层／3D／表达式面板（选中画面／文字／贴纸／形状／空物件／摄影机／灯光片段时·接在各自属性面板下面）：
//   父层（下拉选另一段·连不透明度）·3D 开关与 z／x／y／z 旋转·摄影机（位置、目标点、视角、景深）·灯光（种类、颜色、强度、位置、目标、锥角柔边）·
//   表达式（选一项、写一句·写错不存·执行出错标红并写原因·那一刻照原值画）。
//   改动交给宿主 onPatch（rig.pure patchRigClip·一改就进一步复原）；能挂哪几项、能当谁的父层同命令那套（rig.pure／expr.pure）。
import { useState } from 'react'
import { useStudioT } from '../../shared/StudioT'
import { NumField, Row } from './ManualPane'
import { srcAt, type Lane, type TlClip, type Tracks } from '../lib/timeline.pure'
import { CONE_MAX, CONE_MIN, FOV_MAX, FOV_MIN, INTENSITY_MAX, LIGHT_KINDS, POS3_LIM, ROT3_LIM, can3d, canParent, exprPropsFor, parentLoops, propValue, type LightKind, type RigPatch } from '../lib/rig.pure'
import { EXPR_MAX_LEN, compileExpr, exprStatus } from '../lib/expr.pure'
import type { KfProp } from '../lib/keyframe.pure'

const LIGHT_LABEL = { parallel: 'vedit_rig_lt_parallel', point: 'vedit_rig_lt_point', spot: 'vedit_rig_lt_spot', ambient: 'vedit_rig_lt_ambient' } as const
const r3 = (v: number) => Math.round(v * 1000) / 1000
const sel = 'h-6 px-1 rounded bg-neutral-950 border border-neutral-700 text-neutral-100 focus:border-cyan-500 outline-none min-w-0'

export default function VeditRigPanel({ clip, lane, tracks, now, onPatch, nameOf }: { clip: TlClip; lane: Lane['kind']; tracks: Tracks; now: number; onPatch: (p: RigPatch) => void; /** 素材片段在下拉里显示的名字 */ nameOf?: (c: TlClip) => string }) {
  const t = useStudioT()
  const props = exprPropsFor(clip, lane)
  const [prop, setProp] = useState<KfProp | null>(() => (Object.keys(clip.expr ?? {})[0] as KfProp | undefined) ?? props[0] ?? null)
  const [draft, setDraft] = useState<string | null>(null)
  const [synErr, setSynErr] = useState<string | null>(null)
  const noop = () => {}
  const label = (c: TlClip) => c.text ? `T ${c.text.content.slice(0, 18)}` : c.sticker ? `★ ${c.sticker.sticker}` : c.rig?.kind === 'null' ? `▢ ${t('vedit_rig_null')} · ${c.id.slice(0, 4)}` : c.shape ? `◇ ${c.shape.shape}` : c.solid ? `■ ${c.solid.color}` : c.bgfx ? `✦ ${c.bgfx.kind}` : `▶ ${nameOf?.(c) ?? c.id.slice(0, 8)}`
  const parents = tracks.flatMap((l) => l.clips.filter((c) => c.id !== clip.id && canParent(c, l.kind) && !parentLoops(tracks, clip.id, c.id)))
  const cam = clip.rig?.kind === 'camera' ? clip.rig : null, lt = clip.rig?.kind === 'light' ? clip.rig : null
  const num = (key: string, v: number, lo: number, hi: number, step: number, put: (n: number) => void, suffix?: string) => (
    <Row key={key} label={t(`vedit_rig_f_${key}` as 'vedit_rig_f_x')}>
      <NumField value={r3(v)} min={lo} max={hi} step={step} suffix={suffix} label={t(`vedit_rig_f_${key}` as 'vedit_rig_f_x')} testid={`vedit-rig-${key}`} onLive={noop} onCommit={put} onCancel={noop} />
    </Row>
  )
  const src = prop ? draft ?? clip.expr?.[prop] ?? '' : ''
  const st = prop && clip.expr?.[prop] ? exprStatus(clip, prop, now, srcAt(clip, now), 0) : null
  const save = () => {
    if (!prop || draft === null) return
    const s = draft.trim()
    if (s) { const c = compileExpr(s); if (!c.ok) { setSynErr(c.err); return } }
    setSynErr(null); setDraft(null)
    onPatch({ expr: { prop, src: s || null } })
  }
  const bad = !!synErr || (st !== null && !st.ok)
  return (
    <div className="flex flex-col gap-2.5 p-2.5 text-xs text-neutral-200" data-testid="vedit-rig-panel" data-clip-id={clip.id}>
      <div className="pt-2 border-t border-neutral-800 first:border-t-0 first:pt-0 text-neutral-300">{t('vedit_rig_panel')}</div>
      <Row label={t('vedit_rig_parent')}>
        <select data-testid="vedit-rig-parent" aria-label={t('vedit_rig_parent')} value={clip.parent ?? ''} onChange={(e) => onPatch({ parent: e.target.value || null })} className={`${sel} flex-1`}>
          <option value="">{t('vedit_rig_parent_none')}</option>
          {parents.map((c) => <option key={c.id} value={c.id}>{label(c)}</option>)}
        </select>
      </Row>
      {clip.parent && (
        <label className="flex items-center gap-2 pl-[4.5rem] text-neutral-400">
          <input type="checkbox" data-testid="vedit-rig-parent-alpha" checked={!!clip.parentAlpha} onChange={(e) => onPatch({ parentAlpha: e.target.checked })} />
          {t('vedit_rig_parent_alpha')}
        </label>
      )}
      {can3d(clip, lane) && (
        <>
          <label className="flex items-center gap-2 text-neutral-300">
            <input type="checkbox" data-testid="vedit-rig-3d" checked={!!clip.d3} onChange={(e) => onPatch({ d3: e.target.checked ? {} : null })} />
            {t('vedit_rig_3d')}
          </label>
          {clip.d3 && (['z', 'rx', 'ry', 'rz'] as const).map((k) => num(k === 'z' ? 'z3' : k, clip.d3![k] ?? 0, k === 'z' ? -POS3_LIM : -ROT3_LIM, k === 'z' ? POS3_LIM : ROT3_LIM, k === 'z' ? 0.05 : 1, (n) => onPatch({ d3: { [k]: n } }), k === 'z' ? '' : '°'))}
        </>
      )}
      {cam && (
        <>
          <div className="text-neutral-300">{t('vedit_rig_camera')}</div>
          {(['x', 'y', 'z', 'tx', 'ty', 'tz'] as const).map((k) => num(k, cam[k], -POS3_LIM, POS3_LIM, 0.05, (n) => onPatch({ rig: { [k]: n } })))}
          {num('fov', cam.fov, FOV_MIN, FOV_MAX, 1, (n) => onPatch({ rig: { fov: n } }), '°')}
          {num('aperture', cam.aperture ?? 0, 0, 100, 1, (n) => onPatch({ rig: { aperture: n } }))}
          {(cam.aperture ?? 0) > 0 && num('focus', cam.focus ?? Math.abs(cam.z), 0.01, POS3_LIM, 0.05, (n) => onPatch({ rig: { focus: n } }))}
        </>
      )}
      {lt && (
        <>
          <Row label={t('vedit_rig_lt_kind')}>
            <select data-testid="vedit-rig-light-kind" aria-label={t('vedit_rig_lt_kind')} value={lt.light} onChange={(e) => onPatch({ rig: { light: e.target.value as LightKind } })} className={`${sel} flex-1`}>
              {LIGHT_KINDS.map((k) => <option key={k} value={k}>{t(LIGHT_LABEL[k])}</option>)}
            </select>
          </Row>
          <Row label={t('vedit_rig_lt_color')}>
            <input type="color" data-testid="vedit-rig-light-color" aria-label={t('vedit_rig_lt_color')} value={lt.color} onChange={(e) => onPatch({ rig: { color: e.target.value } })} className="h-6 w-10 p-0 border-0 bg-transparent cursor-pointer" />
          </Row>
          {num('intensity', lt.intensity, 0, INTENSITY_MAX, 0.05, (n) => onPatch({ rig: { intensity: n } }))}
          {lt.light !== 'ambient' && (['x', 'y', 'z'] as const).map((k) => num(k, lt[k], -POS3_LIM, POS3_LIM, 0.05, (n) => onPatch({ rig: { [k]: n } })))}
          {(lt.light === 'parallel' || lt.light === 'spot') && (['tx', 'ty', 'tz'] as const).map((k) => num(k, lt[k], -POS3_LIM, POS3_LIM, 0.05, (n) => onPatch({ rig: { [k]: n } })))}
          {lt.light === 'spot' && num('cone', lt.cone, CONE_MIN, CONE_MAX, 1, (n) => onPatch({ rig: { cone: n } }), '°')}
          {lt.light === 'spot' && num('feather', lt.feather, 0, 100, 1, (n) => onPatch({ rig: { feather: n } }))}
        </>
      )}
      {props.length > 0 && prop && (
        <>
          <Row label={t('vedit_rig_expr')}>
            <select data-testid="vedit-rig-expr-prop" aria-label={t('vedit_rig_expr_prop')} value={prop} onChange={(e) => { setProp(e.target.value as KfProp); setDraft(null); setSynErr(null) }} className={`${sel} flex-1`}>
              {props.map((p) => <option key={p} value={p}>{clip.expr?.[p] ? `ƒ ${p}` : p}</option>)}
            </select>
            {clip.expr?.[prop] && <button type="button" data-testid="vedit-rig-expr-clear" onClick={() => { setDraft(null); setSynErr(null); onPatch({ expr: { prop, src: null } }) }} className="h-6 px-1.5 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-300">{t('vedit_rig_expr_clear')}</button>}
          </Row>
          <textarea data-testid="vedit-rig-expr" data-bad={bad ? '1' : '0'} aria-label={t('vedit_rig_expr')} value={src} maxLength={EXPR_MAX_LEN} rows={2} spellCheck={false} placeholder={t('vedit_rig_expr_ph')}
            onChange={(e) => { setDraft(e.target.value); setSynErr(null) }} onBlur={save} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save() } else if (e.key === 'Escape') { setDraft(null); setSynErr(null) } }}
            className={`w-full px-1.5 py-1 rounded bg-neutral-950 border font-mono text-[11px] text-neutral-100 outline-none resize-y ${bad ? 'border-red-500 focus:border-red-400' : 'border-neutral-700 focus:border-cyan-500'}`} />
          {synErr ? <div className="text-[11px] text-red-400" data-testid="vedit-rig-expr-err">{t('vedit_rig_expr_syntax', { err: synErr })}</div>
            : st && !st.ok ? <div className="text-[11px] text-red-400" data-testid="vedit-rig-expr-err">{t('vedit_rig_expr_err', { err: st.err })}</div>
              : st ? <div className="text-[11px] text-neutral-500" data-testid="vedit-rig-expr-ok">{t('vedit_rig_expr_ok', { v: String(r3(propValue(clip, prop, now))) })}</div>
                : <div className="text-[11px] text-neutral-500 leading-relaxed">{t('vedit_rig_expr_hint')}</div>}
        </>
      )}
    </div>
  )
}

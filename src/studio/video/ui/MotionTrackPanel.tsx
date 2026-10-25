'use client'
// 网页剪辑页·运动跟踪面板：
// ① 影片片段「跟踪」页：框选区域（在画面上拖）·从播放头开始追踪（进度·可取消）·路径清单（删）；
// ② 文字／贴纸面板：跟随跟踪下拉＋解除·四角透视（同影片片段那组控件；画面上的四颗角点由宿主页画）。
// 算法与资料格式在 lib/motion-track.pure.ts；改动交宿主 onPatch（ClipPatch：mtrack／follow／look.pin）。
import { Fragment } from 'react'
import { useStudioT } from '../../shared/StudioT'
import { followChoices, type TrackBox } from '../lib/motion-track.pure'
import { PIN_LIM, PIN_ZERO, type ClipPin, type PinKey } from '../lib/corner-pin.pure'
import { lookOf, type ClipPatch } from '../lib/clip-look.pure'
import type { TlClip, Tracks } from '../lib/timeline.pure'
import { NumField, Row } from './ManualPane'

export type MTrackHost = { selecting: boolean; setSelecting: (v: boolean) => void; box: TrackBox | null; run: { done: number; total: number } | null; onStart: (dir?: 'fwd' | 'back', into?: string) => void; onCancel: () => void }
const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`
const pct = (v: number) => `${Math.round(v * 100)}%`

/** 影片片段：运动跟踪 */
export default function VeditMotionTrackPanel({ clip, host, onPatch }: { clip: TlClip; host: MTrackHost; onPatch: (p: ClipPatch, commit: boolean) => void }) {
  const t = useStudioT()
  const list = clip.mtrack ?? []
  const btn = 'h-8 rounded-md text-[12px] px-2'
  return (
    <div className="flex flex-col gap-2.5 pt-2 border-t border-neutral-800" data-testid="vedit-mt-panel" data-selecting={host.selecting ? '1' : '0'} data-running={host.run ? '1' : '0'}>
      <div className="text-neutral-300">{t('vedit_mt_title')}</div>
      <button type="button" data-testid="vedit-mt-select" aria-pressed={host.selecting} disabled={!!host.run} onMouseDown={(e) => e.preventDefault()} onClick={() => host.setSelecting(!host.selecting)}
        className={`${btn} ${host.selecting ? 'bg-cyan-600/30 text-cyan-300 ring-1 ring-cyan-500' : 'bg-neutral-800 text-neutral-200 hover:bg-neutral-700'} disabled:opacity-50`}>{t(host.selecting ? 'vedit_mt_selecting' : 'vedit_mt_select')}</button>
      {host.box && <div className="text-[11px] text-neutral-400 tabular-nums" data-testid="vedit-mt-box">{t('vedit_mt_box')}：x {pct(host.box.x)} · y {pct(host.box.y)} · {pct(host.box.w)} × {pct(host.box.h)}</div>}
      {host.run ? (
        <div className="flex items-center gap-2" data-testid="vedit-mt-progress">
          <div className="flex-1 h-1.5 rounded bg-neutral-800 overflow-hidden"><div className="h-full bg-cyan-500" style={{ width: `${(host.run.done / Math.max(1, host.run.total)) * 100}%` }} /></div>
          <span className="text-[11px] tabular-nums text-neutral-300">{t('vedit_mt_running').replace('{p}', String(Math.round((host.run.done / Math.max(1, host.run.total)) * 100)))}</span>
          <button type="button" data-testid="vedit-mt-cancel" onClick={host.onCancel} className={`${btn} bg-red-700 text-white hover:bg-red-600`}>{t('vedit_mt_cancel')}</button>
        </div>
      ) : (
        <div className="flex gap-1.5">
          <button type="button" data-testid="vedit-mt-start" disabled={!host.box} onClick={() => host.onStart('fwd')} className={`${btn} flex-1 bg-cyan-600 text-white hover:bg-cyan-500 disabled:opacity-40`}>{t('vedit_mt_start')}</button>
          <button type="button" data-testid="vedit-mt-start-back" disabled={!host.box} onClick={() => host.onStart('back')} className={`${btn} flex-1 bg-neutral-800 text-neutral-200 hover:bg-neutral-700 disabled:opacity-40`}>{t('vedit_mt_start_back')}</button>
        </div>
      )}
      {list.length > 0 && (
        <div className="flex flex-col gap-1" data-testid="vedit-mt-list">
          {list.map((m, i) => (
            <div key={m.id} data-testid="vedit-mt-item" data-id={m.id} className="flex items-center gap-2 rounded px-2 h-8 bg-neutral-800/70">
              <span className="text-neutral-200">{t('vedit_mt_item').replace('{n}', String(i + 1))}</span>
              <span className="flex-1 truncate text-[11px] text-neutral-500 tabular-nums">{fmt(m.pts[0][0])}–{fmt(m.pts[m.pts.length - 1][0])} · {m.pts.length}</span>
              <button type="button" title={t('vedit_mt_retrack')} aria-label={t('vedit_mt_retrack')} data-testid="vedit-mt-retrack" disabled={!host.box || !!host.run} onMouseDown={(e) => e.preventDefault()}
                onClick={() => host.onStart('fwd', m.id)} className="h-6 w-6 rounded text-neutral-400 hover:bg-cyan-700 hover:text-white disabled:opacity-30">↻</button>
              <button type="button" title={t('vedit_mt_del')} aria-label={t('vedit_mt_del')} data-testid="vedit-mt-del" onMouseDown={(e) => e.preventDefault()}
                onClick={() => onPatch({ mtrack: list.filter((x) => x.id !== m.id) }, true)} className="h-6 w-6 rounded text-neutral-400 hover:bg-red-700 hover:text-white">✕</button>
            </div>
          ))}
        </div>
      )}
      <div className="text-[11px] text-neutral-500 leading-relaxed">{t('vedit_mt_hint')}</div>
    </div>
  )
}

/** 文字／贴纸：跟随跟踪＋四角透视。onBind(clip, track)＝绑到某条路径（宿主照播放头算 at）·null＝解除 */
export function VeditFollowPinPanel({ clip, tracks, now, onPatch, onBind, onCancel }: { clip: TlClip; tracks: Tracks; now: number; onPatch: (p: ClipPatch, commit: boolean) => void; onBind: (v: { clip: string; track: string } | null) => void; onCancel: () => void }) {
  const t = useStudioT()
  const choices = followChoices(tracks)
  const cur = clip.follow ? `${clip.follow.clip}|${clip.follow.track}` : ''
  const p = lookOf(clip, now).pin
  const put = (q: Partial<ClipPin> | null, commit = true) => onPatch({ look: { pin: q } }, commit)
  return (
    <div className="flex flex-col gap-2.5" data-testid="vedit-ts-extra">
      <div className="flex flex-col gap-2 pt-2 border-t border-neutral-800" data-testid="vedit-follow" data-on={clip.follow ? '1' : '0'}>
        <Row label={t('vedit_mt_follow')}>
          <select value={choices.some((c) => `${c.clip}|${c.track}` === cur) ? cur : ''} data-testid="vedit-follow-select" aria-label={t('vedit_mt_follow')} disabled={!choices.length}
            onChange={(e) => { const [c, k] = e.target.value.split('|'); onBind(e.target.value ? { clip: c, track: k } : null) }}
            className="ml-auto flex-1 h-7 rounded bg-neutral-800 text-neutral-200 px-1">
            <option value="">{t('vedit_mt_follow_none')}</option>
            {choices.map((c) => <option key={c.track} value={`${c.clip}|${c.track}`}>{t('vedit_mt_item').replace('{n}', String(c.n))} · {fmt(c.span[0])}–{fmt(c.span[1])}</option>)}
          </select>
          {clip.follow && <button type="button" data-testid="vedit-follow-unbind" onClick={() => onBind(null)} className="h-7 px-2 rounded bg-neutral-800 text-neutral-300 hover:bg-neutral-700">{t('vedit_mt_unbind')}</button>}
        </Row>
        <div className="text-[11px] text-neutral-500 leading-relaxed">{t(choices.length ? 'vedit_mt_follow_hint' : 'vedit_mt_no_tracks')}</div>
      </div>
      <div className="flex flex-col gap-2.5 pt-2 border-t border-neutral-800" data-testid="vedit-ci-pin" data-on={p ? '1' : '0'}>
        <div className="flex items-center gap-2 text-neutral-300">
          <span className="flex-1">{t('vedit_ci_pin')}</span>
          {p && <button type="button" title={t('vedit_man_reset')} aria-label={t('vedit_man_reset')} data-testid="vedit-ci-pin-reset" onClick={() => put({ ...PIN_ZERO })} className="h-6 w-6 rounded text-neutral-400 hover:text-white hover:bg-neutral-700">↺</button>}
        </div>
        <Row label={t('vedit_ci_pin_on')}>
          <label className="ml-auto inline-flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={!!p} data-testid="vedit-ci-pin-on" onChange={(e) => put(e.target.checked ? { ...PIN_ZERO } : null)} className="accent-cyan-500" />
          </label>
        </Row>
        {p && ([['0', 'vedit_ci_pin_tl'], ['1', 'vedit_ci_pin_tr'], ['2', 'vedit_ci_pin_br'], ['3', 'vedit_ci_pin_bl']] as const).map(([i, label]) => (
          <Row key={i} label={t(label)}>
            {(['x', 'y'] as const).map((ax) => { const k = `${ax}${i}` as PinKey; return (
              <Fragment key={ax}>
                <span className="text-[10px] text-neutral-500">{ax.toUpperCase()}</span>
                <NumField value={Math.round(p[k] * 1000) / 10} min={-PIN_LIM * 100} max={PIN_LIM * 100} step={0.5} suffix="%" label={`${t(label)} ${ax.toUpperCase()}`} testid={`vedit-ci-pin-${k}`}
                  onLive={(n) => put({ [k]: n / 100 }, false)} onCommit={(n) => put({ [k]: n / 100 })} onCancel={onCancel} />
              </Fragment>
            ) })}
          </Row>
        ))}
        {p && <div className="text-[11px] text-neutral-500 leading-relaxed">{t('vedit_ci_pin_hint')}</div>}
      </div>
    </div>
  )
}

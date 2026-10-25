'use client'
// 网页剪辑页·右栏「跟踪」页＝追踪打码：
// 开「追踪打码」⇒ 预览上按住要打码的地方跟着拖（自动播、放手停）·记成一条打码轨；清单点选一条 ⇒ 再拖就只重记拖过的那段；样式改了照存（角色改工程档同一份）。
// 算法在 _lib/mosaic.pure.ts；改动交宿主 onPatch({ mosaic })。
import { useStudioT } from '../../shared/StudioT'
import type { VideoKey as TKey } from '../i18n'
import { MOSAIC_MODES, MOSAIC_SHAPES, mosaicSpan, patchMosaic, type Mosaic, type MosaicMode, type MosaicShape } from '../lib/mosaic.pure'
import { Row, Slider } from './ManualPane'
import type { ClipHost } from './ClipInspector'

export type MosaicHost = { rec: boolean; setRec: (v: boolean) => void; active: string | null; setActive: (id: string | null) => void }
const SHAPE_LABEL: Record<MosaicShape, TKey> = { rect: 'vedit_mosaic_shape_rect', round: 'vedit_mosaic_shape_round', ellipse: 'vedit_mosaic_shape_ellipse' }
const MODE_LABEL: Record<MosaicMode, TKey> = { pixel: 'vedit_mosaic_mode_pixel', blur: 'vedit_mosaic_mode_blur', solid: 'vedit_mosaic_mode_solid' }
const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`

export default function VeditMosaicPanel({ host }: { host: ClipHost }) {
  const t = useStudioT()
  const mh = host.mosaic
  const list = host.state.clip.mosaic ?? []
  const cur = list.find((m) => m.id === mh?.active) ?? null
  const put = (p: Partial<Omit<Mosaic, 'id'>> | null, commit = true) => { if (cur) host.onPatch({ mosaic: patchMosaic(list, cur.id, p) ?? null }, commit) }
  const pill = (on: boolean) => `flex-1 h-7 rounded text-[11px] ${on ? 'bg-cyan-600/30 text-cyan-300 ring-1 ring-cyan-500' : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'}`
  if (!mh) return null
  return (
    <div className="flex flex-col gap-2.5" data-testid="vedit-mosaic-panel" data-rec={mh.rec ? '1' : '0'}>
      <button type="button" data-testid="vedit-mosaic-rec" aria-pressed={mh.rec} onMouseDown={(e) => e.preventDefault()} onClick={() => mh.setRec(!mh.rec)}
        className={`h-9 rounded-md text-[13px] ${mh.rec ? 'bg-red-600 text-white hover:bg-red-500' : 'bg-cyan-600 text-white hover:bg-cyan-500'}`}>
        {t(mh.rec ? 'vedit_mosaic_rec_off' : 'vedit_mosaic_rec_on')}
      </button>
      <div className="text-[11px] text-neutral-500 leading-relaxed">{t(mh.rec ? (cur ? 'vedit_mosaic_hint_redo' : 'vedit_mosaic_hint_new') : 'vedit_mosaic_hint')}</div>
      {list.length > 0 && (
        <div className="flex flex-col gap-1" data-testid="vedit-mosaic-list">
          {list.map((m, i) => {
            const sp = mosaicSpan(m)
            return (
              <div key={m.id} data-testid="vedit-mosaic-item" data-id={m.id} data-active={cur?.id === m.id ? '1' : '0'}
                className={`flex items-center gap-2 rounded px-2 h-8 cursor-pointer ${cur?.id === m.id ? 'bg-cyan-900/40 ring-1 ring-cyan-600' : 'bg-neutral-800/70 hover:bg-neutral-800'}`}
                onClick={() => mh.setActive(cur?.id === m.id ? null : m.id)}>
                <span className="text-neutral-200">{t('vedit_mosaic_item').replace('{n}', String(i + 1))}</span>
                <span className="flex-1 truncate text-[11px] text-neutral-500 tabular-nums">{sp ? `${fmt(sp[0])}–${fmt(sp[1])}` : ''} · {t(MODE_LABEL[m.mode])}</span>
                <button type="button" title={t('vedit_mosaic_del')} aria-label={t('vedit_mosaic_del')} data-testid="vedit-mosaic-del" onMouseDown={(e) => e.preventDefault()}
                  onClick={(e) => { e.stopPropagation(); host.onPatch({ mosaic: patchMosaic(list, m.id, null) ?? null }, true); if (cur?.id === m.id) mh.setActive(null) }}
                  className="h-6 w-6 rounded text-neutral-400 hover:bg-red-700 hover:text-white">✕</button>
              </div>
            )
          })}
          {cur && <button type="button" data-testid="vedit-mosaic-new" onClick={() => mh.setActive(null)} className="self-start text-[11px] text-cyan-400 hover:underline">{t('vedit_mosaic_new')}</button>}
        </div>
      )}
      {cur && (
        <div className="flex flex-col gap-2.5 pt-2 border-t border-neutral-800" data-testid="vedit-mosaic-style">
          <Row label={t('vedit_mosaic_shape')}>
            <div className="flex-1 flex gap-1">{MOSAIC_SHAPES.map((s) => <button key={s} type="button" data-testid="vedit-mosaic-shape" data-v={s} onMouseDown={(e) => e.preventDefault()} onClick={() => put({ shape: s })} className={pill(cur.shape === s)}>{t(SHAPE_LABEL[s])}</button>)}</div>
          </Row>
          <Row label={t('vedit_mosaic_mode')}>
            <div className="flex-1 flex gap-1">{MOSAIC_MODES.map((s) => <button key={s} type="button" data-testid="vedit-mosaic-mode" data-v={s} onMouseDown={(e) => e.preventDefault()} onClick={() => put({ mode: s })} className={pill(cur.mode === s)}>{t(MODE_LABEL[s])}</button>)}</div>
          </Row>
          <Row label={t('vedit_mosaic_w')}>
            <Slider value={Math.round(cur.w * 100)} min={1} max={100} label={t('vedit_mosaic_w')} testid="vedit-mosaic-w" onLive={(n) => put({ w: n / 100 }, false)} onCommit={(n) => put({ w: n / 100 })} />
            <span className="w-9 text-right tabular-nums text-neutral-300">{Math.round(cur.w * 100)}%</span>
          </Row>
          <Row label={t('vedit_mosaic_h')}>
            <Slider value={Math.round(cur.h * 100)} min={1} max={100} label={t('vedit_mosaic_h')} testid="vedit-mosaic-h" onLive={(n) => put({ h: n / 100 }, false)} onCommit={(n) => put({ h: n / 100 })} />
            <span className="w-9 text-right tabular-nums text-neutral-300">{Math.round(cur.h * 100)}%</span>
          </Row>
          {cur.mode === 'solid' ? (
            <Row label={t('vedit_mosaic_color')}>
              <input type="color" value={cur.color} data-testid="vedit-mosaic-color" aria-label={t('vedit_mosaic_color')} onChange={(e) => put({ color: e.target.value })} className="ml-auto h-7 w-12 rounded bg-transparent" />
            </Row>
          ) : (
            <Row label={t('vedit_mosaic_strength')}>
              <Slider value={cur.strength} min={1} max={100} label={t('vedit_mosaic_strength')} testid="vedit-mosaic-strength" onLive={(n) => put({ strength: n }, false)} onCommit={(n) => put({ strength: n })} />
              <span className="w-9 text-right tabular-nums text-neutral-300">{cur.strength}</span>
            </Row>
          )}
          {cur.mode === 'pixel' && <div className="text-[11px] text-neutral-500 leading-relaxed">{t('vedit_mosaic_pixel_note')}</div>}
        </div>
      )}
      <div className="text-[11px] text-neutral-500 leading-relaxed">{t('vedit_mosaic_agent_note')}</div>
    </div>
  )
}

'use client'
// 网页剪辑页·「特效」「轉場」页签右边内容（标在原有素材上的点缀）：
// 上方＝选中的那段身上有哪些特效（各一条强度拉杆＋拿掉）／选中的那个接缝转场（长短拉杆＋拿掉）；
// 下面＝自写库的缩图格（照剪映那排分类·收藏）·点一款 ⇒ 宿主套到选中的片段／接缝（没选就找播放头那段／最近的接缝）·也能拖到轨道上的片段／接缝。
import { useStudioLang, useStudioT } from '../../shared/StudioT'
import { FX_DRAG_MIME, TRANS_DRAG_MIME, TRANS_MIN, fxById, fxIn, fxName, fxThumb, type FxLang } from '../lib/fx.pure'
import type { FxKind } from '../lib/fx.data'

export type FxHost = {
  favs: readonly string[]
  onFav: (id: string) => void
  onPick: (id: string) => void
  /** 特效页签：选中的素材片段身上的特效 */
  selClip?: { name: string; effects: ReadonlyArray<{ fx: string; strength: number }>; locked: boolean } | null
  onStrength?: (fx: string, v: number, commit: boolean) => void
  onRemove?: (fx: string) => void
  /** 转场页签：选中的接缝转场 */
  selTrans?: { tr: string; length: number; max: number; locked: boolean } | null
  onLength?: (v: number, commit: boolean) => void
  onRemoveTrans?: () => void
}

function Star({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" data-testid="vedit-fav-star" data-on={on ? '1' : '0'} title={label} aria-label={label} aria-pressed={on}
      onMouseDown={(e) => e.preventDefault()} onClick={(e) => { e.stopPropagation(); onClick() }}
      className={`absolute top-0.5 right-0.5 z-10 w-5 h-5 rounded flex items-center justify-center bg-black/40 hover:bg-black/70 ${on ? 'text-amber-300' : 'text-neutral-300 opacity-0 group-hover:opacity-100 focus:opacity-100'}`}>
      <svg viewBox="0 0 20 20" className="w-3.5 h-3.5" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5" aria-hidden><path d="m10 2.8 2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L2.8 8.1l5-.7L10 2.8Z" strokeLinejoin="round" /></svg>
    </button>
  )
}

const slider = (on: (v: number, commit: boolean) => void, toV: (x: number) => number) => ({
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => on(toV(Number(e.target.value)), false),
  onPointerUp: (e: React.PointerEvent<HTMLInputElement>) => on(toV(Number((e.target as HTMLInputElement).value)), true),
  onKeyUp: (e: React.KeyboardEvent<HTMLInputElement>) => on(toV(Number((e.target as HTMLInputElement).value)), true),
})

export default function VeditFxPane({ kind, cat, host }: { kind: FxKind; cat: string; host: FxHost }) {
  const t = useStudioT()
  const language = useStudioLang()
  const lang = language as FxLang
  const list = cat === 'fav' ? host.favs.map((id) => fxById(id)).filter((x): x is NonNullable<typeof x> => !!x && x.kind === kind) : fxIn(kind, cat)
  const mime = kind === 'effect' ? FX_DRAG_MIME : TRANS_DRAG_MIME
  const sc = host.selClip, st = host.selTrans
  const activeIds = kind === 'effect' ? (sc?.effects.map((e) => e.fx) ?? []) : st ? [st.tr] : []
  return (
    <>
      {kind === 'effect' && sc && (
        /* 选中的素材片段：身上的特效（强度＋拿掉） */
        <div className="px-2 py-1.5 rounded-md bg-neutral-800/80 flex flex-col gap-1" data-testid="vedit-fx-panel">
          <div className="flex items-center gap-2"><span className="text-[11px] text-neutral-400 shrink-0">{t('vedit_fx_sel')}</span><span className="text-xs text-neutral-200 truncate min-w-0">{sc.name}</span></div>
          {sc.effects.length === 0 ? <div className="text-[11px] text-neutral-500">{t('vedit_fx_none_on_clip')}</div> : sc.effects.map((e) => (
            <div key={e.fx} className="flex items-center gap-2" data-testid="vedit-fx-row" data-fx={e.fx}>
              <span className="text-xs text-neutral-200 w-20 truncate shrink-0">{fxName(e.fx, lang)}</span>
              <input type="range" min={0} max={100} step={1} value={Math.round(e.strength * 100)} disabled={sc.locked} aria-label={t('vedit_fx_strength')} data-testid="vedit-fx-strength"
                {...slider((v, c) => host.onStrength?.(e.fx, v, c), (x) => x / 100)} className="flex-1 min-w-0 accent-cyan-500" />
              <span className="w-8 text-right text-[11px] tabular-nums text-neutral-300">{Math.round(e.strength * 100)}</span>
              <button type="button" disabled={sc.locked} onClick={() => host.onRemove?.(e.fx)} title={t('vedit_fx_remove')} aria-label={t('vedit_fx_remove')} data-testid="vedit-fx-remove"
                className="w-5 h-5 rounded text-neutral-400 hover:text-white hover:bg-neutral-700 disabled:opacity-40">×</button>
            </div>
          ))}
        </div>
      )}
      {kind === 'transition' && st && (
        /* 选中的接缝：转场长短＋拿掉 */
        <div className="px-2 py-1.5 rounded-md bg-neutral-800/80 flex items-center gap-2" data-testid="vedit-tr-panel" data-tr={st.tr}>
          <span className="text-[11px] text-neutral-400 shrink-0">{t('vedit_tr_sel')}</span>
          <span className="text-xs text-neutral-200 truncate min-w-0">{fxName(st.tr, lang)}</span>
          <span className="ml-auto text-[11px] text-neutral-400 shrink-0">{t('vedit_tr_length')}</span>
          <input type="range" min={TRANS_MIN} max={Math.max(TRANS_MIN, st.max)} step={0.1} value={st.length} disabled={st.locked || st.max <= TRANS_MIN} aria-label={t('vedit_tr_length')} data-testid="vedit-tr-length"
            {...slider((v, c) => host.onLength?.(v, c), (x) => x)} className="w-24 accent-cyan-500" />
          <span className="w-9 text-right text-[11px] tabular-nums text-neutral-300" data-testid="vedit-tr-length-val">{st.length.toFixed(1)}s</span>
          <button type="button" disabled={st.locked} onClick={() => host.onRemoveTrans?.()} title={t('vedit_tr_remove')} aria-label={t('vedit_tr_remove')} data-testid="vedit-tr-remove"
            className="w-5 h-5 rounded text-neutral-400 hover:text-white hover:bg-neutral-700 disabled:opacity-40">×</button>
        </div>
      )}
      {list.length === 0 ? (
        <div className="flex-1 min-h-24 flex items-center justify-center text-center px-4 text-xs text-neutral-500" data-testid={cat === 'fav' ? 'vedit-fav-empty' : 'vedit-asset-soon'}>{t(cat === 'fav' ? 'vedit_fav_empty' : 'vedit_asset_soon')}</div>
      ) : <>
        <div className="text-[11px] text-neutral-500 -mt-1">{t(kind === 'effect' ? 'vedit_fx_hint' : 'vedit_tr_hint')}</div>
        <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))' }} data-testid={kind === 'effect' ? 'vedit-fx-grid' : 'vedit-tr-grid'} data-cat={cat}>
          {list.map((it) => {
            const nm = fxName(it.id, lang)
            const on = activeIds.includes(it.id)
            return (
              <div key={it.id} className="relative group">
                <button type="button" data-testid={kind === 'effect' ? 'vedit-fx-item' : 'vedit-tr-item'} data-fx-id={it.id} data-active={on ? '1' : '0'} draggable
                  onDragStart={(e) => { e.dataTransfer.setData(mime, it.id); e.dataTransfer.effectAllowed = 'copy' }}
                  title={nm} aria-label={nm} onClick={() => host.onPick(it.id)}
                  className={`w-full rounded-md bg-neutral-800 hover:bg-neutral-700 overflow-hidden cursor-grab text-left ${on ? 'ring-2 ring-cyan-400' : ''}`}>
                  <img src={fxThumb(it.id)} alt="" loading="lazy" draggable={false} className="w-full aspect-video object-cover pointer-events-none" />
                  <span className="block px-1.5 py-1 text-[11px] text-neutral-300 truncate">{nm}</span>
                </button>
                <Star on={host.favs.includes(it.id)} onClick={() => host.onFav(it.id)} label={t(host.favs.includes(it.id) ? 'vedit_fav_remove' : 'vedit_fav_add')} />
              </div>
            )
          })}
        </div>
      </>}
    </>
  )
}

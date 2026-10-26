'use client'
// 网页剪辑页·素材区顶 bar 的「文本／特效／转场／字幕」四个页签（「文本 特效 转场 字幕 先把前端照抄
//   包含左边那个竖清单 内容先留空 前端先出来」·附四张剪映专业版截图）。
// 版面照剪映：左竖清单（分类名照截图逐字抄·分组带箭头能展开收起）＋窄栏拉条＋右内容区（特效、转场顶上有搜寻框＋商用筛选钮）。
// 内容先留空：右边只写所选分类名＋「即將推出」·搜寻框与钮按了不做事。清单与开关算法在 _lib/asset-tabs.pure.ts。
import { useState, type DragEvent, type ReactNode } from 'react'
import { useStudioLang, useStudioT } from '../../shared/StudioT'
import { TEXT_DRAG_MIME, TEXT_DRAG_PLAIN, fancyCatOf, fancyIn } from '../lib/text.pure'
import VeditFancyText from './FancyText'
import { STICKER_DRAG_MIME, stickerById, stickerCatOf, stickerSrc, stickersIn } from '../lib/sticker.pure'
import { SHAPE_KINDS, SOLID_PRESETS, VECTOR_DRAG_MIME, type ShapeKind } from '../lib/shape.pure'
import { BGFX_KINDS, type BgfxKind } from '../lib/bgfx.pure' // 动态背景
import VeditProgramPane, { type ProgramHost } from './ProgramPane'
import VeditAudioLib, { type AudioLibHost } from './AudioLib'
import VeditFxPane, { type FxHost } from './FxPane'
import { FILTER_DRAG_MIME, filterById, filterCatOf, filterThumb, filtersIn } from '../lib/filter.pure'
import { ASSET_TAB_SPEC, findCat, initialSide, pickCat, sideRows, toggleOpen, type AssetSideState, type AssetTab } from '../lib/asset-tabs.pure'

/** 顶 bar 小图示（照剪映：文本＝TI·特效＝星星·转场＝⋈·字幕＝框里两行字） */
export function AssetTabIcon({ tab }: { tab: AssetTab }) {
  const p = { viewBox: '0 0 20 20', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, className: 'w-4 h-4', 'aria-hidden': true }
  switch (tab) {
    // 喇叭＋声波（编曲页签已用音符·这里换喇叭免得两颗一样）
    case 'audio': return <svg {...p}><path d="M3.5 7.5h3l4-3.5v12l-4-3.5h-3z" /><path d="M13.5 7.5a3.5 3.5 0 0 1 0 5M15.5 5a7 7 0 0 1 0 10" /></svg>
    case 'text': return <svg {...p}><path d="M2.5 4.5h8M6.5 4.5V16M14.5 4.5V16M12.5 4.5h4M12.5 16h4" /></svg>
    case 'sticker': return <svg {...p}><path d="M16.5 10.5V5A1.5 1.5 0 0 0 15 3.5H5A1.5 1.5 0 0 0 3.5 5v10A1.5 1.5 0 0 0 5 16.5h5.5l6-6Z" /><path d="M10.5 16.5v-4.5a1.5 1.5 0 0 1 1.5-1.5h4.5M7.5 8h.01M12.5 8h.01" /></svg>
    case 'program': return <svg {...p}><path d="m7 6-4 4 4 4M13 6l4 4-4 4M11 4 9 16" /></svg>
    case 'filter': return <svg {...p}><circle cx="7.5" cy="8" r="4.5" /><circle cx="12.5" cy="8" r="4.5" /><circle cx="10" cy="12.5" r="4.5" /></svg>
    case 'fx': return <svg {...p}><path d="m9 3 1.9 4 4.4.6-3.2 3 .8 4.4L9 12.9 5.1 15l.8-4.4-3.2-3 4.4-.6L9 3Z" /><path d="M15.5 13.5 17.5 17M16 2.5v2M15 3.5h2" /></svg>
    case 'transition': return <svg {...p}><path d="M3 3.5v13L10 10 3 3.5ZM17 3.5v13L10 10l7-6.5Z" /></svg>
    case 'caption': return <svg {...p}><rect x="2.5" y="4" width="15" height="12" rx="1.5" /><path d="M5.5 10.5h9M7 13h6" /></svg>
  }
}

function Chevron({ up }: { up: boolean }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={`w-3.5 h-3.5 shrink-0 transition-transform ${up ? 'rotate-180' : ''}`} aria-hidden>
      <path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
    </svg>
  )
}

/** 花字库：onPick＝点一款（宿主套到选中的文字·没选就在播放头新加一段）；active＝选中那段文字正套着的款式 */
export type FancyHost = { onPick: (id: string) => void; active: string | null }
/** 「新建文本」两张卡：onDefault＝播放头加一段默认文本；onImport＝选好的字幕档（SRT／VTT／ASS） */
export type TextNewHost = { onDefault: () => void; onImport: (file: File) => void }
/** 贴纸库：onPick＝点一张（宿主放在播放头）；拖一张 ⇒ 带 STICKER_DRAG_MIME（宿主轨道区接）；
 *  favs／onFav＝收藏（卡片右上角星星·宿主存帐号） */
export type StickerHost = { onPick: (id: string) => void; favs: readonly string[]; onFav: (id: string) => void }
/** 滤镜库：同贴纸；selected＝选中的那段滤镜（有 ⇒ 格子上方出强度拉杆·onStrength 拉动／放手 commit） */
export type FilterHost = { onPick: (id: string) => void; favs: readonly string[]; onFav: (id: string) => void
  selected: { filter: string; strength: number; locked: boolean; /** 强度关键帧那颗菱形（宿主画好） */ kf?: ReactNode } | null; onStrength: (v: number, commit: boolean) => void }

function FavStar({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" data-testid="vedit-fav-star" data-on={on ? '1' : '0'} title={label} aria-label={label} aria-pressed={on}
      onMouseDown={(e) => e.preventDefault()} onClick={(e) => { e.stopPropagation(); onClick() }}
      className={`absolute top-0.5 right-0.5 z-10 w-5 h-5 rounded flex items-center justify-center bg-black/40 hover:bg-black/70 ${on ? 'text-amber-300' : 'text-neutral-300 opacity-0 group-hover:opacity-100 focus:opacity-100'}`}>
      <svg viewBox="0 0 20 20" className="w-3.5 h-3.5" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5" aria-hidden><path d="m10 2.8 2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L2.8 8.1l5-.7L10 2.8Z" strokeLinejoin="round" /></svg>
    </button>
  )
}

/** 四个页签共用的面板：sideW＝左竖清单宽（与素材页的窄栏同一个量·同一条拉条调）；splitter＝宿主给的那条竖拉条 */
/** 形状／纯色（贴纸页签顶上那一排）：点一张 ⇒ 宿主放在播放头（画面轨）；拖一张 ⇒ 带 VECTOR_DRAG_MIME（值 shape:<种类>／solid:#rrggbb） */
/** 形状名字的字典键（写成字面·字典题扫得到） */
export const SHAPE_LABEL: Record<ShapeKind, string> = { rect: 'vedit_shape_rect', ellipse: 'vedit_shape_ellipse', arrow: 'vedit_shape_arrow', line: 'vedit_shape_line' }
/** 动态背景名字的字典键 */
export const BGFX_LABEL: Record<BgfxKind, string> = { stars: 'vedit_bgfx_stars', bokeh: 'vedit_bgfx_bokeh' }
export type VectorHost = { onShape: (k: ShapeKind) => void; onSolid: (color: string) => void; /** 动态背景（星空粒子／光斑漂移） */ onBgfx?: (k: BgfxKind) => void
  /** 空物件／摄影机／灯光（放在播放头·画面轨·自己不画） */ onRig?: (k: 'null' | 'camera' | 'light') => void }
/** 空物件／摄影机／灯光名字的字典键 */
const RIG_LABEL = { null: 'vedit_rig_add_null', camera: 'vedit_rig_add_camera', light: 'vedit_rig_add_light' } as const
function VectorRow({ host }: { host: VectorHost }) {
  const t = useStudioT()
  const [color, setColor] = useState('#3b82f6')
  const drag = (v: string) => (e: DragEvent) => { e.dataTransfer.setData(VECTOR_DRAG_MIME, v); e.dataTransfer.effectAllowed = 'copy' }
  const icon: Record<ShapeKind, ReactNode> = {
    rect: <rect x="3" y="5" width="14" height="10" rx="1" />, ellipse: <ellipse cx="10" cy="10" rx="7" ry="5.5" />,
    arrow: <path d="M3 10h13M12 6l4 4-4 4" />, line: <path d="M3 10h14" />,
  }
  const btn = 'h-8 rounded-md bg-neutral-800 hover:bg-neutral-700 flex items-center justify-center cursor-grab'
  return (
    <div className="flex flex-col gap-1" data-testid="vedit-vector-row">
      <div className="text-[11px] text-neutral-500">{t('vedit_vector_hint')}</div>
      <div className="grid grid-cols-7 gap-1">
        {SHAPE_KINDS.map((k) => (
          <button key={k} type="button" draggable data-testid="vedit-shape-item" data-shape={k} title={t(SHAPE_LABEL[k])} aria-label={t(SHAPE_LABEL[k])} onDragStart={drag(`shape:${k}`)} onClick={() => host.onShape(k)} className={btn}>
            <svg viewBox="0 0 20 20" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{icon[k]}</svg>
          </button>
        ))}
        {SOLID_PRESETS.map((c) => (
          <button key={c} type="button" draggable data-testid="vedit-solid-item" data-color={c} title={t(c === '#000000' ? 'vedit_solid_black' : 'vedit_solid_white')} aria-label={t(c === '#000000' ? 'vedit_solid_black' : 'vedit_solid_white')} onDragStart={drag(`solid:${c}`)} onClick={() => host.onSolid(c)} className={btn}>
            <span className="w-4 h-4 rounded-sm border border-neutral-500" style={{ background: c }} />
          </button>
        ))}
        <span className={`${btn} relative`} title={t('vedit_solid_custom')}>
          <button type="button" draggable data-testid="vedit-solid-item" data-color={color} aria-label={t('vedit_solid_custom')} onDragStart={drag(`solid:${color}`)} onClick={() => host.onSolid(color)} className="w-4 h-4 rounded-sm border border-neutral-500" style={{ background: color }} />
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label={t('vedit_solid_custom')} className="absolute -right-0.5 -bottom-0.5 w-3 h-3 opacity-80 cursor-pointer p-0 border-0" />
        </span>
        {host.onBgfx && BGFX_KINDS.map((k) => (
          <button key={k} type="button" draggable data-testid="vedit-bgfx-item" data-kind={k} title={t(BGFX_LABEL[k])} aria-label={t(BGFX_LABEL[k])} onDragStart={drag(`bgfx:${k}`)} onClick={() => host.onBgfx!(k)} className={btn}>
            {k === 'stars'
              ? <svg viewBox="0 0 20 20" className="w-4 h-4" aria-hidden><rect width="20" height="20" rx="2" fill="#05070f" /><circle cx="5" cy="6" r="1" fill="#fff" /><circle cx="13" cy="4" r="0.7" fill="#fff" /><circle cx="15" cy="12" r="1.2" fill="#fff" /><circle cx="8" cy="14" r="0.7" fill="#fff" /><circle cx="10" cy="9" r="0.5" fill="#fff" /></svg>
              : <svg viewBox="0 0 20 20" className="w-4 h-4" aria-hidden><rect width="20" height="20" rx="2" fill="#0b1020" /><circle cx="7" cy="8" r="4.5" fill="#ffc36b" opacity="0.45" /><circle cx="14" cy="13" r="3.5" fill="#ffc36b" opacity="0.35" /><circle cx="14" cy="5" r="2" fill="#ffc36b" opacity="0.3" /></svg>}
          </button>
        ))}
        {host.onRig && (['null', 'camera', 'light'] as const).map((k) => (
          <button key={k} type="button" data-testid="vedit-rig-item" data-kind={k} title={t(RIG_LABEL[k])} aria-label={t(RIG_LABEL[k])} onClick={() => host.onRig!(k)} className={btn.replace('cursor-grab', 'cursor-pointer')}>
            <svg viewBox="0 0 20 20" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              {k === 'null' ? <rect x="4" y="4" width="12" height="12" strokeDasharray="2.5 2" /> : k === 'camera' ? <><rect x="2.5" y="6" width="10" height="8" rx="1" /><path d="M12.5 9l5-2.5v7l-5-2.5" /></> : <><circle cx="10" cy="10" r="3.2" /><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4" /></>}
            </svg>
          </button>
        ))}
      </div>
    </div>
  )
}

export default function VeditAssetPane({ vector, tab, sideW, splitter, fancy, sticker, filter, program, fx, transition, textNew, notice, asr, audio }: { /** 形状／纯色 */ vector?: VectorHost; /** 「音频」页签 */ audio?: AudioLibHost; tab: AssetTab; sideW: number; splitter: ReactNode; /** 字幕→識別字幕（网页里用显卡识别） */ asr?: ReactNode; /** 页面那行提示（导入字幕结果、特效放不上去的原因…·原先只画在素材页·这几个页签看不到） */ notice?: string | null; fancy?: FancyHost; textNew?: TextNewHost; sticker?: StickerHost; filter?: FilterHost; program?: ProgramHost; fx?: FxHost; transition?: FxHost }) {
  const t = useStudioT()
  const language = useStudioLang()
  const nameKey = language === 'zh-CN' ? 'cn' : language === 'en' ? 'en' : 'tw'
  // 四个页签之间切换各记各的（切到素材／技能页签再回来＝回到截图那样的初始）
  const [sides, setSides] = useState<Partial<Record<AssetTab, AssetSideState>>>({})
  const side = sides[tab] ?? initialSide(tab)
  const setSide = (f: (s: AssetSideState) => AssetSideState) => setSides((m) => ({ ...m, [tab]: f(m[tab] ?? initialSide(tab)) }))
  const spec = ASSET_TAB_SPEC[tab]
  const picked = findCat(tab, side.pick)
  const fancyCat = tab === 'text' ? fancyCatOf(side.pick) : null
  const stickerCat = tab === 'sticker' ? stickerCatOf(side.pick) : null
  const filterCat = tab === 'filter' ? filterCatOf(side.pick) : null
  // 收藏那一格：照收藏先后列·认不得的（资料档拿掉了）不列
  const stickerList = stickerCat ? stickersIn(stickerCat) : tab === 'sticker' && side.pick === 'sticker-fav' ? (sticker?.favs ?? []).map((id) => stickerById(id)).filter((x) => !!x) : null
  const filterList = filterCat ? filtersIn(filterCat) : tab === 'filter' && side.pick === 'filter-fav' ? (filter?.favs ?? []).map((id) => filterById(id)).filter((x) => !!x) : null
  const empty = <div className="flex-1 min-h-24 flex items-center justify-center text-center px-4 text-xs text-neutral-500" data-testid="vedit-fav-empty">{t('vedit_fav_empty')}</div>
  return (
    <div className="flex-1 min-h-0 flex" data-testid="vedit-asset-pane" data-tab={tab}>
      {/* 左竖清单（照剪映）：顶层一格一格带底色·分组带箭头·展开后子项无底色缩排 */}
      <div className="shrink-0 min-h-0 flex flex-col gap-1 py-2 overflow-y-auto border-r border-neutral-800" style={{ width: sideW }} data-testid="vedit-asset-side">
        {sideRows(tab, side).map((r) => r.soon ? (
          <div key={r.id} className="mx-1.5 px-2 py-1 text-xs text-neutral-600 truncate" data-testid="vedit-asset-cat-soon">{t(r.label)}</div>
        ) : (
          <button key={r.id} type="button" data-testid="vedit-asset-cat" data-cat-id={r.id} data-active={r.active ? '1' : '0'}
            {...(r.group ? { 'aria-expanded': r.expanded } : { 'aria-pressed': r.active })}
            onClick={() => setSide((s) => (r.group ? toggleOpen(s, r.id) : pickCat(tab, s, r.id)))}
            className={`mx-1.5 flex items-center gap-1 px-2 py-1.5 rounded text-left text-xs ${r.depth === 0 ? 'bg-neutral-800 hover:bg-neutral-700' : 'hover:bg-neutral-800'} ${r.active ? 'text-cyan-400' : 'text-neutral-300 hover:text-neutral-100'}`}>
            <span className="flex-1 min-w-0 truncate">{t(r.label)}</span>
            {r.group && <Chevron up={r.expanded} />}
          </button>
        ))}
      </div>
      {splitter}
      {/* 右内容区：框架照剪映·内容先留空 */}
      <div className="flex-1 min-w-0 min-h-0 flex flex-col p-3 gap-3 overflow-auto" data-testid="vedit-asset-content">
        {notice && <div className="sticky top-0 z-10 rounded bg-neutral-800 px-2 py-1 text-[11px] text-amber-300" role="status" data-testid="vedit-asset-notice">{notice}</div>}
        {spec.search && (
          <div className="flex items-center gap-2">
            <label className="flex-1 min-w-0 h-8 flex items-center gap-1.5 px-2 rounded-md bg-neutral-800 border border-neutral-700/60 text-neutral-500">
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="w-3.5 h-3.5 shrink-0" aria-hidden><circle cx="9" cy="9" r="5.5" /><path d="m13 13 4 4" /></svg>
              <input type="search" readOnly aria-disabled placeholder={t(spec.search)} aria-label={t(spec.search)} data-testid="vedit-asset-search"
                className="flex-1 min-w-0 bg-transparent text-xs text-neutral-300 placeholder:text-neutral-500 outline-none cursor-default" />
            </label>
            <button type="button" aria-disabled title={t('vedit_asset_biz')} aria-label={t('vedit_asset_biz')} data-testid="vedit-asset-biz" onMouseDown={(e) => e.preventDefault()}
              className="h-7 w-7 shrink-0 flex flex-col items-center justify-center rounded-full border border-neutral-500 text-neutral-400 leading-none cursor-default">
              <span className="text-[9px]">商</span><span className="text-[6px] -mt-px">OFF</span>
            </button>
          </div>
        )}
        {picked && <div className="text-xs text-neutral-300" data-testid="vedit-asset-heading">{t(picked.label)}</div>}
        {tab === 'caption' && side.pick === 'smart-recognize' && asr ? (
          asr
        ) : tab === 'text' && side.pick === 'new' && textNew ? (
          /* 新建文本（照剪映那格·「添加口播稿」不做）：默认文本｜导入本地字幕 */
          <div className="flex flex-wrap gap-3" data-testid="vedit-text-new">
            <button type="button" data-testid="vedit-text-default" draggable onDragStart={(e) => { e.dataTransfer.setData(TEXT_DRAG_MIME, TEXT_DRAG_PLAIN); e.dataTransfer.effectAllowed = 'copy' }} onClick={() => textNew.onDefault()}
              className="w-28 h-28 rounded-lg bg-neutral-800 hover:bg-neutral-700 flex items-center justify-center text-sm text-neutral-100">{t('vedit_text_default')}</button>
            <label data-testid="vedit-text-import" title={t('vedit_sub_import_hint')}
              className="w-28 h-28 rounded-lg bg-neutral-800 hover:bg-neutral-700 flex flex-col items-center justify-center gap-2 text-xs text-neutral-400 hover:text-neutral-200 cursor-pointer">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" className="w-8 h-8" aria-hidden><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5v-11Z" /><path d="M9 13h6" strokeLinecap="round" /></svg>
              <span>{t('vedit_sub_import')}</span>
              <input type="file" accept=".srt,.vtt,.ass,.ssa,application/x-subrip,text/vtt" className="hidden" data-testid="vedit-text-import-input"
                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) textNew.onImport(f) }} />
            </label>
          </div>
        ) : fancyCat ? (
          /* 花字库（照剪映那格）：一类一格格款式·字是「花字」两字现画（同播放器那支画法）·点一款 ⇒ 宿主套用 */
          <>
            <div className="text-[11px] text-neutral-500 -mt-1">{t('vedit_fancy_hint')}</div>
            <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(84px, 1fr))' }} data-testid="vedit-fancy-grid" data-cat={fancyCat}>
              {fancyIn(fancyCat).map((f) => (
                <button key={f.id} type="button" data-testid="vedit-fancy-item" data-fancy-id={f.id} data-active={fancy?.active === f.id ? '1' : '0'} draggable
                  onDragStart={(e) => { e.dataTransfer.setData(TEXT_DRAG_MIME, f.id); e.dataTransfer.effectAllowed = 'copy' }}
                  title={f.name[nameKey]} aria-label={f.name[nameKey]} onClick={() => fancy?.onPick(f.id)}
                  className={`aspect-square rounded-md bg-neutral-800 hover:bg-neutral-700 flex items-center justify-center overflow-hidden ${fancy?.active === f.id ? 'ring-2 ring-cyan-400' : ''}`}>
                  <VeditFancyText text={t('vedit_fancy_sample')} fancy={f.style} style={{ fontSize: 26 }} className="pointer-events-none" />
                </button>
              ))}
            </div>
          </>
        ) : stickerList ? (
          /* 贴纸库（照剪映那格）：一类一格格贴纸（自画 SVG）·点一张 ⇒ 宿主放在播放头·也能拖进轨道；右上角星星＝收藏 */
          <>{vector && <VectorRow host={vector} />}{stickerList.length === 0 ? empty : <>
            <div className="text-[11px] text-neutral-500 -mt-1">{t('vedit_sticker_hint')}</div>
            <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))' }} data-testid="vedit-sticker-grid" data-cat={stickerCat ?? 'fav'}>
              {stickerList.map((s) => (
                <div key={s.id} className="relative group">
                  <button type="button" data-testid="vedit-sticker-item" data-sticker-id={s.id} draggable
                    onDragStart={(e) => { e.dataTransfer.setData(STICKER_DRAG_MIME, s.id); e.dataTransfer.effectAllowed = 'copy' }}
                    title={s.name[nameKey]} aria-label={s.name[nameKey]} onClick={() => sticker?.onPick(s.id)}
                    className="w-full aspect-square rounded-md bg-neutral-800 hover:bg-neutral-700 flex items-center justify-center overflow-hidden p-1.5 cursor-grab">
                    <img src={stickerSrc(s)} alt="" loading="lazy" draggable={false} className="max-w-full max-h-full object-contain pointer-events-none" />
                  </button>
                  {sticker && <FavStar on={sticker.favs.includes(s.id)} onClick={() => sticker.onFav(s.id)} label={t(sticker.favs.includes(s.id) ? 'vedit_fav_remove' : 'vedit_fav_add')} />}
                </div>
              ))}
            </div>
          </>}</>
        ) : filterList ? (
          /* 滤镜库（照剪映那格）：缩图＋名字·点一款 ⇒ 宿主放在播放头（套到底下的画面）·也能拖进轨道；选中滤镜片段 ⇒ 上方强度拉杆 */
          <>
            {filter?.selected && (
              <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-neutral-800/80" data-testid="vedit-filter-strength-row">
                <span className="text-[11px] text-neutral-400 shrink-0">{t('vedit_filter_sel')}</span>
                <span className="text-xs text-neutral-200 truncate min-w-0">{filterById(filter.selected.filter)?.name[nameKey] ?? filter.selected.filter}</span>
                <span className="ml-auto text-[11px] text-neutral-400 shrink-0">{t('vedit_filter_strength')}</span>
                <input type="range" min={0} max={100} step={1} value={Math.round(filter.selected.strength * 100)} disabled={filter.selected.locked}
                  data-testid="vedit-filter-strength" aria-label={t('vedit_filter_strength')}
                  onChange={(e) => filter.onStrength(Number(e.target.value) / 100, false)}
                  onPointerUp={(e) => filter.onStrength(Number((e.target as HTMLInputElement).value) / 100, true)}
                  onKeyUp={(e) => filter.onStrength(Number((e.target as HTMLInputElement).value) / 100, true)}
                  className="w-28 accent-cyan-500" />
                <span className="w-8 text-right text-[11px] tabular-nums text-neutral-300" data-testid="vedit-filter-strength-pct">{Math.round(filter.selected.strength * 100)}</span>
                {filter.selected.kf}
              </div>
            )}
            {filterList.length === 0 ? empty : <>
              <div className="text-[11px] text-neutral-500 -mt-1">{t('vedit_filter_hint')}</div>
              <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(76px, 1fr))' }} data-testid="vedit-filter-grid" data-cat={filterCat ?? 'fav'}>
                {filterList.map((f) => (
                  <div key={f.id} className="relative group">
                    <button type="button" data-testid="vedit-filter-item" data-filter-id={f.id} data-active={filter?.selected?.filter === f.id ? '1' : '0'} draggable
                      onDragStart={(e) => { e.dataTransfer.setData(FILTER_DRAG_MIME, f.id); e.dataTransfer.effectAllowed = 'copy' }}
                      title={f.name[nameKey]} aria-label={f.name[nameKey]} onClick={() => filter?.onPick(f.id)}
                      className={`w-full rounded-md bg-neutral-800 hover:bg-neutral-700 overflow-hidden cursor-grab text-left ${filter?.selected?.filter === f.id ? 'ring-2 ring-cyan-400' : ''}`}>
                      <img src={filterThumb(f.id)} alt="" loading="lazy" draggable={false} className="w-full aspect-square object-cover pointer-events-none" />
                      <span className="block px-1.5 py-1 text-[11px] text-neutral-300 truncate">{f.name[nameKey]}</span>
                    </button>
                    {filter && <FavStar on={filter.favs.includes(f.id)} onClick={() => filter.onFav(f.id)} label={t(filter.favs.includes(f.id) ? 'vedit_fav_remove' : 'vedit_fav_add')} />}
                  </div>
                ))}
              </div>
            </>}
          </>
        ) : (tab === 'fx' && fx) || (tab === 'transition' && transition) ? (
          /* 特效／转场（标在素材片段身上／接缝上）：选中的那段／那个接缝的面板＋库缩图格（VeditFxPane） */
          <VeditFxPane kind={tab === 'fx' ? 'effect' : 'transition'} cat={side.pick} host={(tab === 'fx' ? fx : transition)!} />
        ) : tab === 'audio' && audio ? (
          /* 音频：内建音效＋录音（VeditAudioLib） */
          <VeditAudioLib host={audio} pick={side.pick} />
        ) : tab === 'program' && program ? (
          /* 程序片段：参数面板＋程序包格＋上传（VeditProgramPane） */
          <VeditProgramPane host={program} mine={side.pick === 'program-mine'} />
        ) : (
          <div className="flex-1 min-h-24 flex items-center justify-center text-xs text-neutral-500" data-testid="vedit-asset-soon">{t('vedit_asset_soon')}</div>
        )}
      </div>
    </div>
  )
}

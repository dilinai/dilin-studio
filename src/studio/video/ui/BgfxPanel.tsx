'use client'
// 网页剪辑页·动态背景片段（星空粒子／光斑漂移）的属性面板：颜色、底色、密度、速度、视差、换一组（新种子）。
// 改动交宿主 onPatch（Partial<BgfxBody>·宿主走 shape.pure patchBgfx·验值同读档）；拖滑杆时面板先显示·放手才写进工程（一步复原）。
import { useState } from 'react'
import { useStudioT } from '../../shared/StudioT'
import { bgfxSeed, type BgfxBody } from '../lib/bgfx.pure'
import { BGFX_LABEL } from './AssetTabs'
import { ColorField, Row, Slider, Toggle } from './ManualPane'

export default function VeditBgfxPanel({ body, onPatch }: { body: BgfxBody; onPatch: (p: Partial<BgfxBody>) => void }) {
  const t = useStudioT()
  const [live, setLive] = useState<Partial<BgfxBody>>({})
  const b = { ...body, ...live }
  const put = (p: Partial<BgfxBody>) => { setLive({}); onPatch(p) }
  return (
    <div className="h-full overflow-y-auto p-2.5 bg-neutral-900 text-neutral-200 text-xs flex flex-col gap-2.5" data-testid="vedit-bgfx-panel" data-kind={body.kind}>
      <div className="text-neutral-300">{t(BGFX_LABEL[body.kind])}</div>
      <Row label={t('vedit_bgfx_color')}>
        <ColorField value={b.color} label={t('vedit_bgfx_color')} testid="vedit-bgfx-color" onLive={(v) => setLive((o) => ({ ...o, color: v }))} onCommit={(v) => put({ color: v })} />
      </Row>
      <Row label={t('vedit_bgfx_bg')}>
        <ColorField value={b.bg} label={t('vedit_bgfx_bg')} testid="vedit-bgfx-bg" onLive={(v) => setLive((o) => ({ ...o, bg: v }))} onCommit={(v) => put({ bg: v })} />
      </Row>
      <Row label={t('vedit_bgfx_density')}>
        <Slider value={Math.round(b.density * 100)} min={0} max={100} label={t('vedit_bgfx_density')} testid="vedit-bgfx-density" onLive={(n) => setLive((o) => ({ ...o, density: n / 100 }))} onCommit={(n) => put({ density: n / 100 })} />
        <span className="w-9 text-right tabular-nums text-neutral-400">{Math.round(b.density * 100)}%</span>
      </Row>
      <Row label={t('vedit_bgfx_speed')}>
        <Slider value={Math.round(b.speed * 100)} min={0} max={200} label={t('vedit_bgfx_speed')} testid="vedit-bgfx-speed" onLive={(n) => setLive((o) => ({ ...o, speed: n / 100 }))} onCommit={(n) => put({ speed: n / 100 })} />
        <span className="w-9 text-right tabular-nums text-neutral-400">{b.speed.toFixed(2)}×</span>
      </Row>
      <Row label={t('vedit_bgfx_parallax')}>
        <Toggle on={!!b.parallax} label={t('vedit_bgfx_parallax')} testid="vedit-bgfx-parallax" onClick={() => put({ parallax: !b.parallax })}><span aria-hidden>⤢</span></Toggle>
      </Row>
      <button type="button" data-testid="vedit-bgfx-reseed" onMouseDown={(e) => e.preventDefault()} onClick={() => put({ seed: bgfxSeed(Math.random()) })}
        className="h-8 rounded-md bg-neutral-800 text-neutral-200 hover:bg-neutral-700">{t('vedit_bgfx_reseed')}</button>
      <div className="text-[11px] text-neutral-500 leading-relaxed">{t('vedit_bgfx_hint')}</div>
    </div>
  )
}

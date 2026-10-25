'use client'

/**
 * 本页设定面板：组件清单上方一条可收合的设定列，编辑本页的页底与换页切换
 *   頁面背景：底色／底图／底片（影片·静音；循环可选·不循环＝播一次停在最后一格·起点／终点秒数）／封面；
 *   切換（换到这一页时）：无／淡出／推入／擦除／缩放／平滑＋时间＋方向；「預覽」弹窗用同一份执行器（transition.ts）跑上一页 ⇒ 本页；
 *     「套用到全部頁」＝transition_all。
 *   改动走组件操作同一条（page_update／transition_all·进撤销栈）。
 */

import { useEffect, useRef, useState } from 'react'
import type { ColorValue, ComponentOp, PageBackground, PageTransition, SlideAnimation, SlideComponent, TransitionType } from '../kit/components/types'
import { COMPONENT_LIMITS, TRANSITION_TYPES } from '../kit/components/types'
import { ComponentSlideView } from '../kit/components/render'
import { skTransitionFactory } from '../kit/components/transition'
import { resolveColor, type ResolveCtx } from '../kit/components/resolve'
import type { PageType, Theme } from '../kit/types'
import { useStudioT as useT } from '../../shared/StudioT'
/** 字串键（字典在 ../i18n-site.ts 与 ../i18n.ts） */
type TKey = string
import { alertDialog, promptDialog } from '../../shared/dialog-store'
import { useSlidesHost, type MediaAttachment as Attachment } from './host'
import { cssColorToHex } from './richtext'

type PreviewPage = { components: readonly SlideComponent[]; animations?: readonly SlideAnimation[]; background?: PageBackground; pageType: PageType }

export type PageSettingsPanelProps = {
  pageIndex: number
  pageId?: string
  background?: PageBackground
  transition?: PageTransition
  ctx: ResolveCtx
  theme: Theme
  onOp: (op: ComponentOp) => void
  uploadMedia: (files: FileList) => Promise<Attachment[]>
  onMediaShown: (url: string, displayUrl?: string) => void
  mediaUrl?: (src: string) => string
  /** 预览用：上一页（没有＝第一页·拿本页自己当上一页）与本页 */
  prev: PreviewPage | null
  cur: PreviewPage
  busy?: boolean
}

const DEFAULT_MS: Record<TransitionType, number> = { none: 0, fade: 700, push: 700, wipe: 700, zoom: 700, morph: 2000 }

export default function PageSettingsPanel(p: PageSettingsPanelProps) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [preview, setPreview] = useState(false)
  const ref = { pageIndex: p.pageIndex, ...(p.pageId ? { pageId: p.pageId } : {}) }
  const bg = p.background ?? {}
  const tr: PageTransition = p.transition ?? { type: 'none', durationMs: 0 }
  const setBg = (patch: Partial<Record<keyof PageBackground, unknown>>) => {
    const next: Record<string, unknown> = { ...bg }
    for (const [k, v] of Object.entries(patch)) { if (v === null || v === undefined || v === '') delete next[k]; else next[k] = v }
    p.onOp({ kind: 'page_update', ...ref, patch: { background: Object.keys(next).length ? (next as PageBackground) : null } })
  }
  const setTr = (next: PageTransition | null) => p.onOp({ kind: 'page_update', ...ref, patch: { transition: next } })
  const shownColor = (cssColorToHex(bg.color ? resolveColor(bg.color, p.ctx, '#ffffff') : p.ctx.palette.bg) ?? '#ffffff').slice(0, 7)
  const dirOk = tr.type === 'push' || tr.type === 'wipe'

  return (
    <div className="px-3 pt-2" data-testid="slc-page-settings">
      <button type="button" className="flex items-center gap-1 text-xs font-medium text-gray-600" data-testid="slc-page-settings-toggle" onClick={() => setOpen((v) => !v)}>
        <span className="w-4 text-[11px] text-gray-400">{open ? '▾' : '▸'}</span>{t('slc_page_settings')}
        <span className="ml-2 text-[11px] font-normal text-gray-400">
          {t(`slc_tr_${tr.type}` as TKey)}{bg.videoUrl ? ` · ${t('slc_bg_video')}` : bg.imageUrl ? ` · ${t('slc_bg_image')}` : ''}
        </span>
      </button>
      {open && (
        <div className="mt-1.5 space-y-2 rounded-lg bg-white/70 ring-1 ring-gray-200 px-2 py-2">
          {/* ── 切換 ── */}
          <div className="flex items-center gap-2 flex-wrap" data-testid="slc-tr-fields">
            <span className="text-[11px] font-medium text-gray-600 w-14">{t('slc_tr')}</span>
            <select value={tr.type} data-testid="slc-tr-type" disabled={p.busy}
              className="border border-gray-200 rounded px-1 py-0.5 bg-white text-[11px] text-gray-700"
              onChange={(e) => {
                const type = e.target.value as TransitionType
                setTr(type === 'none' ? null : { type, durationMs: tr.type === 'none' || tr.type === 'morph' || type === 'morph' ? DEFAULT_MS[type] : tr.durationMs, ...(type === 'push' || type === 'wipe' ? { direction: tr.direction ?? 'right' } : {}) })
              }}>
              {TRANSITION_TYPES.map((k) => <option key={k} value={k}>{t(`slc_tr_${k}` as TKey)}</option>)}
            </select>
            {tr.type !== 'none' && (
              <label className="flex items-center gap-1 text-[11px] text-gray-500">{t('slc_tr_duration')}
                <input type="number" min={COMPONENT_LIMITS.transitionMinMs / 1000} max={COMPONENT_LIMITS.transitionMaxMs / 1000} step={0.1}
                  key={`${p.pageId}:${tr.durationMs}`} defaultValue={tr.durationMs / 1000} data-testid="slc-tr-duration"
                  className="w-14 border border-gray-200 rounded px-1 py-0.5 bg-white text-gray-700"
                  onBlur={(e) => { const s = Number(e.target.value); if (Number.isFinite(s) && Math.round(s * 1000) !== tr.durationMs) setTr({ ...tr, durationMs: Math.round(Math.max(0.1, Math.min(10, s)) * 1000) }) }}
                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
              </label>
            )}
            {dirOk && (
              <select value={tr.direction ?? 'right'} className="border border-gray-200 rounded px-1 py-0.5 bg-white text-[11px] text-gray-700" data-testid="slc-tr-dir"
                onChange={(e) => setTr({ ...tr, direction: e.target.value as PageTransition['direction'] })}>
                {(['right', 'left', 'down', 'up'] as const).map((d) => <option key={d} value={d}>{t(`slc_dir_${d}` as TKey)}</option>)}
              </select>
            )}
            <button type="button" className="px-2 py-0.5 text-[11px] rounded-md border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 disabled:opacity-40" data-testid="slc-tr-preview"
              disabled={tr.type === 'none'} onClick={() => setPreview(true)}>▶ {t('slc_tr_preview')}</button>
            <button type="button" className="px-2 py-0.5 text-[11px] rounded-md border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 disabled:opacity-40" data-testid="slc-tr-apply-all"
              disabled={p.busy} onClick={() => p.onOp({ kind: 'transition_all', ...ref, transition: tr.type === 'none' ? null : tr })}>{t('slc_tr_apply_all')}</button>
          </div>
          {tr.type === 'morph' && <div className="text-[10.5px] text-gray-400 leading-snug">{t('slc_tr_morph_hint')}</div>}
          {/* ── 頁面背景 ── */}
          <div className="flex items-center gap-2 flex-wrap" data-testid="slc-bg-fields">
            <span className="text-[11px] font-medium text-gray-600 w-14">{t('slc_bg')}</span>
            <label className="flex items-center gap-1 text-[11px] text-gray-500">{t('slc_bg_color')}
              <input type="color" value={shownColor} data-testid="slc-bg-color" className="w-7 h-6 p-0 border border-gray-200 rounded bg-white"
                onChange={(e) => setBg({ color: e.target.value.toUpperCase() as ColorValue })} />
            </label>
            <MediaPick {...p} kind="image" label={t('slc_bg_image')} testid="slc-bg-image" onPicked={(u) => setBg({ imageUrl: u })} />
            {bg.imageUrl && <button type="button" className="text-[10px] px-1 rounded border border-gray-200 text-gray-400" onClick={() => setBg({ imageUrl: null })}>{t('slc_bg_clear')}</button>}
            <label className="flex items-center gap-1 text-[11px] text-gray-500">{t('slc_fit')}
              <select value={bg.fit ?? 'cover'} className="border border-gray-200 rounded px-1 py-0.5 bg-white text-gray-700" onChange={(e) => setBg({ fit: e.target.value })}>
                <option value="cover">{t('slc_fit_cover')}</option><option value="contain">{t('slc_fit_contain')}</option>
              </select>
            </label>
          </div>
          <div className="flex items-center gap-2 flex-wrap" data-testid="slc-bg-video-fields">
            <span className="w-14" />
            <MediaPick {...p} kind="video" label={t('slc_bg_video')} testid="slc-bg-video" onPicked={(u) => setBg({ videoUrl: u })} />
            {bg.videoUrl && (<>
              <button type="button" className="text-[10px] px-1 rounded border border-gray-200 text-gray-400" data-testid="slc-bg-video-clear" onClick={() => setBg({ videoUrl: null, poster: null, loop: null, startSec: null, endSec: null })}>{t('slc_bg_clear')}</button>
              <MediaPick {...p} kind="image" label={t('slc_bg_poster')} testid="slc-bg-poster" onPicked={(u) => setBg({ poster: u })} />
              <label className="flex items-center gap-1 text-[11px] text-gray-600">
                <input type="checkbox" checked={!!bg.loop} data-testid="slc-bg-loop" onChange={(e) => setBg({ loop: e.target.checked || null })} />{t('slc_bg_loop')}
              </label>
              <SecField label={t('slc_bg_start')} value={bg.startSec} testid="slc-bg-start" onCommit={(v) => setBg({ startSec: v })} />
              <SecField label={t('slc_bg_end')} value={bg.endSec} testid="slc-bg-end" onCommit={(v) => setBg({ endSec: v })} />
            </>)}
          </div>
          {bg.videoUrl && <div className="text-[10.5px] text-gray-400 leading-snug">{t('slc_bg_video_note')}</div>}
        </div>
      )}
      {preview && tr.type !== 'none' && <TransitionPreview {...p} spec={tr} onClose={() => setPreview(false)} />}
    </div>
  )
}

function SecField(props: { label: string; value?: number; testid: string; onCommit: (v: number | null) => void }) {
  return (
    <label className="flex items-center gap-1 text-[11px] text-gray-500">{props.label}
      <input type="number" min={0} step={0.1} key={String(props.value ?? '')} defaultValue={props.value ?? ''} data-testid={props.testid}
        className="w-14 border border-gray-200 rounded px-1 py-0.5 bg-white text-gray-700"
        onBlur={(e) => { const raw = e.target.value.trim(); const v = raw === '' ? null : Number(raw); if (v === null || Number.isFinite(v)) { if (v !== (props.value ?? null)) props.onCommit(v) } }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
    </label>
  )
}

/** 选图／选片（雲端硬碟＋本机上传·与元件清单同一颗）＋贴网址 */
function MediaPick(props: PageSettingsPanelProps & { kind: 'image' | 'video'; label: string; testid: string; onPicked: (url: string) => void }) {
  const t = useT()
  const { MediaUploader: AttachmentUploader } = useSlidesHost()
  return (
    <div className="flex items-center gap-1" data-testid={props.testid}>
      <span className="text-[11px] text-gray-500">{props.label}</span>
      <AttachmentUploader size="sm" accept={props.kind === 'image' ? 'image/*' : 'video/mp4,video/webm'} customLocalHandler={props.uploadMedia}
        onAttach={async (atts) => {
          const a = atts[0]
          if (!a?.url) return
          if (a.mime && !a.mime.startsWith(props.kind === 'image' ? 'image/' : 'video/')) { await alertDialog(t(props.kind === 'image' ? 'slc_not_image' : 'slc_not_video')); return }
          props.onMediaShown(a.url, a.displayUrl)
          props.onPicked(a.url)
        }} />
      <button type="button" className="px-1.5 py-0.5 text-[10.5px] rounded-md border border-gray-200 bg-white hover:bg-gray-50 text-gray-600" data-testid={`${props.testid}-url`}
        onClick={async () => {
          const u = (await promptDialog({ message: t('slc_media_url_prompt'), defaultValue: '' }))?.trim()
          if (!u) return
          if (!/^https:\/\/\S+$/i.test(u)) { await alertDialog(t('slc_media_url_bad')); return }
          props.onPicked(u)
        }}>{t('slc_media_url')}</button>
    </div>
  )
}

/** 切换预览：上一页 ⇒ 本页·同一份执行器（放映用的那份）·播完停在本页；再按一次重播 */
function TransitionPreview(props: PageSettingsPanelProps & { spec: PageTransition; onClose: () => void }) {
  const t = useT()
  const boxRef = useRef<HTMLDivElement>(null)
  const [epoch, setEpoch] = useState(0)
  const W = 640
  const from = props.prev ?? props.cur
  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    const [outC, inC] = Array.from(box.querySelectorAll('[data-sk-canvas]')) as HTMLElement[]
    if (!outC || !inC) return
    const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let ctl: { finish: () => void } | null = null
    const outLayer = box.querySelector('[data-layer="out"]') as HTMLElement | null
    const inLayer = box.querySelector('[data-layer="in"]') as HTMLElement | null
    // 先只露旧页·停一下再开始（新页那层在 run 的第一格才亮出来）
    const id = window.setTimeout(() => {
      if (inLayer) inLayer.style.visibility = 'visible'
      ctl = skTransitionFactory().run(outC, inC, props.spec, { reduced, onDone: () => { if (outLayer) outLayer.style.visibility = 'hidden' } })
    }, 350)
    return () => { window.clearTimeout(id); ctl?.finish() }
  }, [epoch, props.spec])
  // Esc 关：挂 window 捕获阶段·先于编辑器那几把（Esc 取消选取…）·不往下传
  const { onClose } = props
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault(); e.stopPropagation(); onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])
  // 点遮罩关·点小窗本体不关（本体拦住冒泡）
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" role="dialog" aria-modal="true" data-testid="slc-tr-preview-dialog" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl p-3 space-y-2" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <div className="text-sm font-medium text-gray-700 flex-1">{t('slc_tr_preview_title')} · {t(`slc_tr_${props.spec.type}` as TKey)}</div>
          <button type="button" className="px-2 py-0.5 text-[11px] rounded-md border border-gray-200" data-testid="slc-tr-replay" onClick={() => setEpoch((n) => n + 1)}>▶ {t('slc_tr_preview')}</button>
          <button type="button" className="px-2 py-0.5 text-[11px] rounded-md border border-gray-200" onClick={props.onClose}>{t('slc_close')}</button>
        </div>
        <div key={epoch} ref={boxRef} className="relative overflow-hidden bg-black" style={{ width: W, height: W * 0.5625 }} data-testid="slc-tr-preview-stage">
          <div data-layer="out" className="absolute inset-0" style={{ zIndex: 0 }}>
            <ComponentSlideView components={from.components} animations={from.animations} background={from.background} theme={props.theme} pageType={from.pageType} mode="editor" width={W} mediaUrl={props.mediaUrl} />
          </div>
          <div data-layer="in" className="absolute inset-0" style={{ zIndex: 1, visibility: 'hidden' }}>
            <ComponentSlideView components={props.cur.components} animations={props.cur.animations} background={props.cur.background} theme={props.theme} pageType={props.cur.pageType} mode="editor" width={W} mediaUrl={props.mediaUrl} />
          </div>
        </div>
      </div>
    </div>
  )
}

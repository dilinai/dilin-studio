'use client'
// 网页剪辑页·那一格：
// 范围（整条时间轴／选中的片段）＋语言＋开始；跑的时候显示「下载模型 x%／整理声音／识别第几段」与取消；
// 浏览器没有 WebGPU ⇒ 说明换新版 Chrome／Edge；这一站还没有模型来源（陆版连不上 Hugging Face）⇒ 说明暂不开放。逻辑在 page.tsx（宿主）。
import { useState } from 'react'
import { useStudioLang, useStudioT } from '../../shared/StudioT'
import { ASR_MODEL_BYTES, asrDefaultLang, asrLoadRatio, type AsrAvail, type AsrLang, type AsrScope } from '../lib/asr.pure'
import { shellChoices, type MediaDevice } from '../lib/shell-media.pure'
import type { ShellPhase, VeditShellApi } from '../lib/shell-job'

export type AsrPhase =
  | { kind: 'idle' }
  | { kind: 'model'; loaded: number; total: number }
  | { kind: 'mix'; done: number; of: number }
  | { kind: 'run'; done: number; of: number }
/** 雲端識別进度：混声／第几段 */
export type CloudAsrPhase = { kind: 'mix' } | { kind: 'run'; done: number; of: number }
export type CloudAsrEstimate = { sec: number; freeSec: number; overSec: number; credits: number }
export type AsrHost = { avail: AsrAvail; phase: AsrPhase; hasSel: boolean; onStart: (scope: AsrScope, lang: AsrLang) => void; onCancel: () => void
  /** 「有壳给壳」：各台终端报的识别能力·交给那台跑 */
  shell?: { devices: MediaDevice[] | null; phase: ShellPhase | null; onRun: (dev: MediaDevice, scope: AsrScope, lang: AsrLang) => void; onCancel: () => void; picker: VeditShellApi['renderPicker'] }
  /** 「雲端識別」（登入版）：quota＝今天还剩几秒免费（null 还没问·false 这站没开）；超出免费要耗用点数 ⇒ 先给估价、按确定才跑（expect＝给人看过的点数） */
  cloud?: { quota: { left: number; daily: number } | false | null; phase: CloudAsrPhase | null; estimate: (scope: AsrScope) => CloudAsrEstimate | null; onRun: (scope: AsrScope, lang: AsrLang, expect: number) => void; onCancel: () => void } }

const mb = (b: number) => Math.round(b / 1024 / 1024)
/** 秒 ⇒「x 小時 y 分」（ceil＝不足一分算一分·估价用；否则去尾·剩余额度用） */
function durText(t: (k: 'vedit_asr_cloud_hm' | 'vedit_asr_cloud_m') => string, sec: number, ceil: boolean): string {
  const m = ceil ? Math.ceil(Math.max(0, sec) / 60) : Math.floor(Math.max(0, sec) / 60)
  const h = Math.floor(m / 60)
  return h > 0 ? t('vedit_asr_cloud_hm').replace('{h}', String(h)).replace('{m}', String(m % 60)) : t('vedit_asr_cloud_m').replace('{m}', String(m))
}
/** 转圈小图示（识别中·页签上也用） */
export function AsrSpinner({ className = 'w-3.5 h-3.5' }: { className?: string }) {
  return <svg viewBox="0 0 24 24" className={`${className} animate-spin text-cyan-400 shrink-0`} fill="none" aria-hidden data-testid="vedit-asr-spinner"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" /><path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg>
}

export default function VeditAsrPane({ host }: { host: AsrHost }) {
  const t = useStudioT()
  const language = useStudioLang()
  const [scope, setScope] = useState<AsrScope>('all')
  const [lang, setLang] = useState<AsrLang>(asrDefaultLang(language))
  const [confirm, setConfirm] = useState<CloudAsrEstimate | null>(null)
  const webBusy = host.phase.kind !== 'idle'
  const sh = host.shell
  const cl = host.cloud
  const cloudOn = !!cl?.quota
  const hasShell = !!sh?.devices && shellChoices(sh.devices, 'asr').length > 0
  const busy = webBusy || !!sh?.phase || !!cl?.phase
  const showForm = host.avail === 'ok' || hasShell || cloudOn
  const pickScope = (): AsrScope => (scope === 'sel' && !host.hasSel ? 'all' : scope)
  const est = cloudOn && !busy ? cl!.estimate(pickScope()) : null
  const runCloud = () => {
    if (!cl) return
    const e = cl.estimate(pickScope())
    if (e && e.credits > 0) { setConfirm(e); return }
    cl.onRun(pickScope(), lang, 0)
  }
  const ph = host.phase
  const ratio = ph.kind === 'model' ? asrLoadRatio(ph.loaded, ph.total) : ph.kind === 'mix' || ph.kind === 'run' ? (ph.of ? ph.done / ph.of : 0) : 0
  const status = ph.kind === 'model' ? t('vedit_asr_loading').replace('{p}', String(Math.round(ratio * 100))).replace('{mb}', String(mb(Math.max(ph.total, ASR_MODEL_BYTES))))
    : ph.kind === 'mix' ? t('vedit_asr_mixing')
    : ph.kind === 'run' ? t('vedit_asr_running').replace('{n}', String(Math.min(ph.done + 1, ph.of))).replace('{of}', String(ph.of)) : ''
  return (
    <div className="flex flex-col gap-3 max-w-md" data-testid="vedit-asr" data-avail={host.avail} data-phase={ph.kind}>
      <p className="text-xs text-neutral-300 leading-relaxed">{t('vedit_asr_intro')}</p>
      {host.avail === 'no-webgpu' && <p className="text-xs text-amber-300 leading-relaxed" data-testid="vedit-asr-no-webgpu">{t('vedit_asr_no_webgpu')}</p>}
      {host.avail === 'no-model' && <p className="text-xs text-amber-300 leading-relaxed" data-testid="vedit-asr-no-model">{t('vedit_asr_no_model')}</p>}
      {/*  没壳又跑不了网页那条 ⇒ 推荐装终端（接口单第六节②） */}
      {(host.avail === 'no-webgpu' || host.avail === 'no-model') && sh && sh.devices !== null && !hasShell && <p className="text-xs text-neutral-300 leading-relaxed" data-testid="vedit-asr-need-term">{t('vedit_shell_need_term')}</p>}
      {showForm && <>
        <div className="flex items-center gap-3 text-xs text-neutral-300" role="radiogroup" aria-label={t('vedit_asr_scope')}>
          <span className="text-neutral-500 shrink-0">{t('vedit_asr_scope')}</span>
          <label className="flex items-center gap-1 cursor-pointer"><input type="radio" name="vedit-asr-scope" checked={scope === 'all'} disabled={busy} onChange={() => setScope('all')} data-testid="vedit-asr-scope-all" />{t('vedit_asr_scope_all')}</label>
          <label className={`flex items-center gap-1 ${host.hasSel ? 'cursor-pointer' : 'opacity-40'}`}><input type="radio" name="vedit-asr-scope" checked={scope === 'sel'} disabled={busy || !host.hasSel} onChange={() => setScope('sel')} data-testid="vedit-asr-scope-sel" />{t('vedit_asr_scope_sel')}</label>
        </div>
        <div className="flex items-center gap-3 text-xs text-neutral-300">
          <span className="text-neutral-500 shrink-0">{t('vedit_asr_lang')}</span>
          <select value={lang} disabled={busy} onChange={(e) => setLang(e.target.value as AsrLang)} data-testid="vedit-asr-lang"
            className="rounded bg-neutral-800 border border-neutral-700 px-2 py-1 text-xs text-neutral-200">
            <option value="zh">{t('vedit_asr_lang_zh')}</option>
            <option value="en">{t('vedit_asr_lang_en')}</option>
          </select>
        </div>
        {host.avail !== 'ok' ? null : !webBusy ? (
          <button type="button" data-testid="vedit-asr-start" disabled={busy} onClick={() => host.onStart(scope === 'sel' && !host.hasSel ? 'all' : scope, lang)}
            className="self-start rounded-md bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 px-4 py-1.5 text-sm text-white">{t('vedit_asr_start')}</button>
        ) : (
          <div className="flex flex-col gap-1.5" data-testid="vedit-asr-progress">
            {/* 已完成的部分实色·正在跑的那段一条会动的光带（一段跑多久看不出来·别让人以为卡住） */}
            <style>{'@keyframes vedit-asr-slide{0%{transform:translateX(-100%)}100%{transform:translateX(400%)}}'}</style>
            <div className="relative h-1.5 rounded bg-neutral-800 overflow-hidden">
              <div className="absolute inset-y-0 left-0 bg-cyan-500 transition-[width]" style={{ width: `${Math.round(ratio * 100)}%` }} />
              <div className="absolute inset-y-0 left-0 w-1/4 bg-gradient-to-r from-transparent via-cyan-300/80 to-transparent" style={{ animation: 'vedit-asr-slide 1.4s ease-in-out infinite' }} data-testid="vedit-asr-anim" />
            </div>
            <div className="flex items-center gap-2 text-[11px] text-neutral-400">
              <AsrSpinner />
              <span data-testid="vedit-asr-status">{status}</span>
              <button type="button" onClick={host.onCancel} data-testid="vedit-asr-cancel" className="ml-auto rounded px-2 py-0.5 text-neutral-300 hover:bg-neutral-700">{t('vedit_asr_cancel')}</button>
            </div>
          </div>
        )}
        {busy && <p className="text-[11px] text-cyan-300/90 leading-relaxed" data-testid="vedit-asr-bg">{t('vedit_asr_bg')}</p>}
        {host.avail === 'ok' && <p className="text-[11px] text-neutral-500 leading-relaxed">{t('vedit_asr_first').replace('{mb}', String(mb(ASR_MODEL_BYTES)))}</p>}
        {/*  有壳给壳：那台装好了 ⇒「交給終端」（同上面的范围、语言）；没装 ⇒ 装的钮 */}
        {hasShell && sh && sh.picker({ kind: 'asr', devices: sh.devices, phase: sh.phase, disabled: webBusy || !!cl?.phase, onRun: (d) => sh.onRun(d, scope === 'sel' && !host.hasSel ? 'all' : scope, lang), onCancel: sh.onCancel })}
        {/*  雲端識別（阿里国际站 3.1）：今天还剩多少免费·这次估价·超出免费先确认再扣 */}
        {cloudOn && cl && cl.quota && (
          <div className="flex flex-col gap-1.5 border-t border-neutral-800 pt-3" data-testid="vedit-asr-cloud" data-phase={cl.phase?.kind ?? 'idle'}>
            <div className="text-xs text-neutral-200">{t('vedit_asr_cloud_title')}</div>
            <p className="text-[11px] text-neutral-400 leading-relaxed" data-testid="vedit-asr-cloud-left" data-left={cl.quota.left}>
              {t('vedit_asr_cloud_left').replace('{daily}', durText(t, cl.quota.daily, false)).replace('{left}', durText(t, cl.quota.left, false))}
            </p>
            {est && !confirm && (
              <p className="text-[11px] text-neutral-400 leading-relaxed" data-testid="vedit-asr-cloud-est" data-credits={est.credits}>
                {est.credits > 0
                  ? t('vedit_asr_cloud_est_paid').replace('{dur}', durText(t, est.sec, true)).replace('{over}', durText(t, est.overSec, true)).replace('{c}', String(est.credits))
                  : t('vedit_asr_cloud_est_free').replace('{dur}', durText(t, est.sec, true))}
              </p>
            )}
            {confirm ? (
              <div className="flex flex-col gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 p-2" data-testid="vedit-asr-cloud-confirm">
                <p className="text-[11px] text-amber-200 leading-relaxed">{t('vedit_asr_cloud_confirm').replace('{over}', durText(t, confirm.overSec, true)).replace('{c}', String(confirm.credits))}</p>
                <div className="flex gap-2">
                  <button type="button" data-testid="vedit-asr-cloud-confirm-ok" onClick={() => { const c = confirm; setConfirm(null); cl.onRun(pickScope(), lang, c.credits) }}
                    className="rounded-md bg-cyan-600 hover:bg-cyan-500 px-3 py-1 text-xs text-white">{t('vedit_asr_cloud_confirm_ok')}</button>
                  <button type="button" data-testid="vedit-asr-cloud-confirm-no" onClick={() => setConfirm(null)} className="rounded-md px-3 py-1 text-xs text-neutral-300 hover:bg-neutral-700">{t('vedit_asr_cancel')}</button>
                </div>
              </div>
            ) : !cl.phase ? (
              <button type="button" data-testid="vedit-asr-cloud-start" disabled={busy} onClick={runCloud}
                className="self-start rounded-md border border-cyan-600 text-cyan-300 hover:bg-cyan-600/20 disabled:opacity-40 px-4 py-1.5 text-sm">{t('vedit_asr_cloud_start')}</button>
            ) : (
              <div className="flex items-center gap-2 text-[11px] text-neutral-400" data-testid="vedit-asr-cloud-progress">
                <AsrSpinner />
                <span>{cl.phase.kind === 'mix' ? t('vedit_asr_mixing') : t('vedit_asr_cloud_running').replace('{n}', String(Math.min(cl.phase.done + 1, cl.phase.of))).replace('{of}', String(cl.phase.of))}</span>
                <button type="button" onClick={cl.onCancel} data-testid="vedit-asr-cloud-cancel" className="ml-auto rounded px-2 py-0.5 text-neutral-300 hover:bg-neutral-700">{t('vedit_asr_cancel')}</button>
              </div>
            )}
          </div>
        )}
      </>}
      {host.avail === 'checking' && <p className="text-xs text-neutral-500">{t('vedit_asr_checking')}</p>}
    </div>
  )
}

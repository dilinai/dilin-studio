'use client'
// 网页剪辑页·「網頁截圖」小对话框：网址、倍率 2x／3x、浅色／深色、整页长图／只截首屏 ⇒ 开始（进行中可取消）·失败照原因码出白话。
// 真截图由宿主做（登入版 /api/vedit/web-shot·服务器无头浏览器）；参数验值同服务端（lib/web-shot.pure parseWebShotOpts）。截好交 onDone(档) 进素材区。
import { useRef, useState } from 'react'
import { useStudioT } from '../../shared/StudioT'
import type { VideoKey as TKey } from '../i18n'
import type { VideoWebShotHost } from '../page/host'
import { WEB_SHOT_DEFAULTS, normalizeShotUrl, parseWebShotOpts, type WebShotFailCode, type WebShotScale, type WebShotTheme } from '../lib/web-shot.pure'

export const WEB_SHOT_ERR: Record<WebShotFailCode, TKey> = {
  bad_param: 'vedit_ws_err_url', blocked: 'vedit_ws_err_blocked', dns: 'vedit_ws_err_dns', unreachable: 'vedit_ws_err_unreachable', timeout: 'vedit_ws_err_timeout',
  too_large: 'vedit_ws_err_large', busy: 'vedit_ws_err_busy', rate: 'vedit_ws_err_rate', unauthorized: 'vedit_ws_err', failed: 'vedit_ws_err', cancelled: 'vedit_ws_cancelled',
}

export default function VeditWebShotDialog({ host, onClose, onDone }: { host: VideoWebShotHost; onClose: () => void; onDone: (f: File, truncated: boolean) => Promise<void> | void }) {
  const t = useStudioT()
  const [url, setUrl] = useState('')
  const [scale, setScale] = useState<WebShotScale>(WEB_SHOT_DEFAULTS.scale)
  const [theme, setTheme] = useState<WebShotTheme>(WEB_SHOT_DEFAULTS.theme)
  const [full, setFull] = useState(WEB_SHOT_DEFAULTS.full)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const ac = useRef<AbortController | null>(null)
  const start = async () => {
    const p = parseWebShotOpts({ url: normalizeShotUrl(url), scale, theme, full, width: WEB_SHOT_DEFAULTS.width })
    if (!p.ok) { setErr(t('vedit_ws_err_url')); return }
    setBusy(true); setErr(null)
    const c = new AbortController(); ac.current = c
    try {
      const r = await host.shot(p.opts, c.signal)
      if (!r.ok) { setErr(t(WEB_SHOT_ERR[r.code] ?? 'vedit_ws_err')); return }
      await onDone(r.file, r.truncated)
      onClose()
    } catch { setErr(t(c.signal.aborted ? 'vedit_ws_cancelled' : 'vedit_ws_err')) } finally { setBusy(false); ac.current = null }
  }
  const seg = (on: boolean) => `flex-1 h-7 rounded text-xs ${on ? 'bg-cyan-600 text-white' : 'bg-neutral-700 text-neutral-200 hover:bg-neutral-600'} disabled:opacity-50`
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => { if (!busy) onClose() }} data-testid="vedit-ws">
      <div role="dialog" aria-modal="true" aria-label={t('vedit_ws_title')} onClick={(e) => e.stopPropagation()} className="w-80 rounded-xl bg-neutral-800 p-4 shadow-xl border border-neutral-700 flex flex-col gap-2.5 text-neutral-100">
        <p className="text-sm">{t('vedit_ws_title')}</p>
        <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" aria-label={t('vedit_ws_url')} data-testid="vedit-ws-url" disabled={busy} autoFocus
          onKeyDown={(e) => { if (e.key === 'Enter' && !busy) void start() }}
          className="h-8 rounded-md bg-neutral-900 border border-neutral-700 focus:border-cyan-600 outline-none px-2 text-xs" />
        <div className="flex gap-1.5" role="group" aria-label={t('vedit_ws_scale')}>
          {([2, 3] as const).map((s) => <button key={s} type="button" disabled={busy} data-testid={`vedit-ws-scale-${s}`} aria-pressed={scale === s} onClick={() => setScale(s)} className={seg(scale === s)}>{s}x</button>)}
        </div>
        <div className="flex gap-1.5" role="group" aria-label={t('vedit_ws_theme')}>
          {(['light', 'dark'] as const).map((m) => <button key={m} type="button" disabled={busy} data-testid={`vedit-ws-theme-${m}`} aria-pressed={theme === m} onClick={() => setTheme(m)} className={seg(theme === m)}>{t(m === 'light' ? 'vedit_ws_light' : 'vedit_ws_dark')}</button>)}
        </div>
        <div className="flex gap-1.5" role="group" aria-label={t('vedit_ws_range')}>
          {([true, false] as const).map((f) => <button key={String(f)} type="button" disabled={busy} data-testid={`vedit-ws-full-${f ? 'on' : 'off'}`} aria-pressed={full === f} onClick={() => setFull(f)} className={seg(full === f)}>{t(f ? 'vedit_ws_full' : 'vedit_ws_first')}</button>)}
        </div>
        <p className="text-[11px] text-neutral-400 leading-relaxed">{t('vedit_ws_hint')}</p>
        {err && <p className="text-[11px] text-amber-300" role="status" data-testid="vedit-ws-err">{err}</p>}
        <div className="flex gap-2">
          {busy
            ? <button type="button" data-testid="vedit-ws-cancel" onClick={() => ac.current?.abort()} className="flex-1 h-8 rounded-md bg-neutral-700 hover:bg-neutral-600 text-xs">{t('vedit_ws_busy')} · {t('vedit_cancel')}</button>
            : <>
              <button type="button" data-testid="vedit-ws-start" disabled={!url.trim()} onClick={() => { void start() }} className="flex-1 h-8 rounded-md bg-cyan-600 hover:bg-cyan-500 text-white text-xs disabled:opacity-40">{t('vedit_ws_start')}</button>
              <button type="button" onClick={onClose} className="h-8 px-3 rounded-md text-xs text-neutral-400 hover:text-neutral-200">{t('vedit_cancel')}</button>
            </>}
        </div>
      </div>
    </div>
  )
}

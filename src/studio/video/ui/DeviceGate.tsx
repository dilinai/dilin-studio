'use client'
// 剪辑页·装置闸：
//   进剪辑页先量这台（WebCodecs 在不在、指针、屏幕）⇒ renderCapability（_lib/vedit-export-client.pure·判法与题在那）⇒ 不行就整页「請用電腦開」·⛔ 载编辑器。
//   只挂在剪辑主页面；无头导出页（/video-edit/export）是另一支页面·不经这里。
import { useEffect, useState } from 'react'
import { useStudioT } from '../../shared/StudioT'
import { renderCapability, type RenderProbe, type RenderVerdict } from '../lib/export-client.pure'

/** 量这台（只在浏览器里调）·量不到的项当「不挡」那边 */
export function readRenderProbe(): RenderProbe {
  const mq = (q: string) => { try { return typeof window.matchMedia === 'function' && window.matchMedia(q).matches } catch { return false } }
  const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } }
  const sw = typeof screen !== 'undefined' ? Math.min(screen.width || 0, screen.height || 0) : 0
  return {
    videoEncoder: typeof VideoEncoder !== 'undefined',
    videoFrame: typeof VideoFrame !== 'undefined',
    pointerCoarse: mq('(pointer: coarse)'),
    // matchMedia 不认 any-pointer ⇒ 当有精确指针（⛔ 误挡）
    anyPointerFine: mq('(any-pointer: fine)') || !mq('(any-pointer: coarse), (any-pointer: fine), (any-pointer: none)'),
    uaMobile: typeof nav.userAgentData?.mobile === 'boolean' ? nav.userAgentData.mobile : null,
    screenShort: sw,
    touchPoints: Number(nav.maxTouchPoints) || 0,
  }
}

/** 量好才放编辑器（量的那一拍画空底·同 gate checking） */
export function useRenderVerdict(): RenderVerdict | null {
  const [v, setV] = useState<RenderVerdict | null>(null)
  useEffect(() => { try { setV(renderCapability(readRenderProbe())) } catch { setV({ ok: true }) } }, [])
  return v
}

/** homeHref＝「回首頁」去哪（登入版网站首页·游客版 /studio 总页） */
export default function VeditDeviceGate({ reason, homeHref }: { reason: Exclude<RenderVerdict, { ok: true }>['reason']; homeHref: string }) {
  const t = useStudioT()
  return (
    <div className="h-screen bg-neutral-900 text-neutral-300 flex flex-col items-center justify-center gap-4 px-6 text-center" data-testid="vedit-device-gate" data-reason={reason}>
      <p className="text-lg font-semibold text-neutral-100">{t('vedit_device_gate_title')}</p>
      <p className="text-sm text-neutral-400 max-w-md leading-relaxed">{t(reason === 'no_encoder' ? 'vedit_device_gate_hint_encoder' : 'vedit_device_gate_hint')}</p>
      <a href={homeHref} className="px-4 py-2 rounded-lg bg-neutral-700 hover:bg-neutral-600 text-sm">{t('vedit_back_home')}</a>
    </div>
  )
}

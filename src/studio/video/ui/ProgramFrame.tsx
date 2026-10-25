'use client'
// 网页剪辑页·播放器上一层程序片段（程序片段轨）：沙盒 iframe（只给 allow-scripts·无网络、无存储、无同源 上传包同样关在里面）
// 载程序包入口页（已插桥 withBridge）·按播放头 postMessage 叫 window.dilinProgram.render(t, params, size)；背景透明叠在下面画面上·不吃滑鼠。
// 画面尺寸＝这一层的实际像素（CSS 尺寸×装置像素比）。
import { useEffect, useMemo, useRef } from 'react'
import { withBridge, type ProgramParamValue } from '../lib/program.pure'

export default function VeditProgramFrame({ html, t, params, clipId }: { html: string; t: number; params: Record<string, ProgramParamValue>; clipId: string }) {
  const ref = useRef<HTMLIFrameElement>(null)
  const ready = useRef(false)
  const doc = useMemo(() => withBridge(html), [html])
  const live = useRef({ t, params })
  live.current = { t, params }
  const send = () => {
    const f = ref.current
    if (!f?.contentWindow || !ready.current) return
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
    const size = { w: Math.max(1, Math.round(f.clientWidth * dpr)), h: Math.max(1, Math.round(f.clientHeight * dpr)) }
    f.contentWindow.postMessage({ type: 'dilin-program-render', t: live.current.t, params: live.current.params, size }, '*')
  }
  useEffect(() => {
    ready.current = false
    const on = (e: MessageEvent) => {
      if (e.source !== ref.current?.contentWindow || (e.data as { type?: string } | null)?.type !== 'dilin-program-ready') return
      ready.current = true
      send()
    }
    window.addEventListener('message', on)
    const f = ref.current
    const ro = f ? new ResizeObserver(() => send()) : null
    if (f && ro) ro.observe(f)
    return () => { window.removeEventListener('message', on); ro?.disconnect() }
  }, [doc]) // eslint-disable-line react-hooks/exhaustive-deps
  const pkey = JSON.stringify(params)
  useEffect(() => { send() }, [t, pkey]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <iframe ref={ref} srcDoc={doc} sandbox="allow-scripts" title="program" data-testid="vedit-program-frame" data-clip-id={clipId} data-t={t.toFixed(3)}
      className="absolute inset-0 w-full h-full border-0 pointer-events-none" style={{ background: 'transparent', colorScheme: 'normal' }} />
  )
}

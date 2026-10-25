'use client'
// 网页剪辑页·素材区「音频」页签：内建音效（自己写的合成音效·_lib/sfx-lib.pure.ts）＋录音（麦克风·MediaRecorder）。
// 点音效格左边 ▶ 先试听；按「＋」⇒ 宿主算成 WAV、进素材区、放在播放头的音频轨。录音停下 ⇒ 宿主照本机汇入、放在播放头。
import { useEffect, useRef, useState } from 'react'
import { useStudioLang, useStudioT } from '../../shared/StudioT'
import { SFX_RATE, sfxIn, type SfxCat, type SfxDef } from '../lib/sfx-lib.pure'

export type AudioLibHost = { onAddSfx: (id: string) => void; onRecorded: (f: File) => void }

function playPreview(d: SfxDef, ctxRef: { current: AudioContext | null }) {
  const ctx = ctxRef.current ?? (ctxRef.current = new AudioContext())
  void ctx.resume().catch(() => {})
  const pcm = d.f(SFX_RATE)
  const b = ctx.createBuffer(1, pcm.length, SFX_RATE); b.copyToChannel(pcm as Float32Array<ArrayBuffer>, 0)
  const s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.destination); s.start()
}

export default function VeditAudioLib({ host, pick }: { host: AudioLibHost; pick: string }) {
  const t = useStudioT()
  const language = useStudioLang()
  const nk = language === 'zh-CN' ? 'cn' : language === 'en' ? 'en' : 'tw'
  const ctxRef = useRef<AudioContext | null>(null)
  if (pick === 'audio-rec') return <Recorder host={host} />
  const cat = (pick.startsWith('audio-sfx-') ? pick.slice(10) : 'transition') as SfxCat
  return (
    <div className="flex flex-col gap-1.5" data-testid="vedit-audio-lib" data-cat={cat}>
      <div className="text-[11px] text-neutral-500">{t('vedit_audio_sfx_hint')}</div>
      {sfxIn(cat).map((d) => (
        <div key={d.id} className="flex items-center gap-2 rounded-md bg-neutral-800/60 hover:bg-neutral-800 px-2 py-1.5" data-testid="vedit-audio-sfx" data-id={d.id}>
          <button type="button" title={t('vedit_audio_preview')} aria-label={t('vedit_audio_preview')} data-testid="vedit-audio-sfx-play" onClick={() => playPreview(d, ctxRef)} className="h-6 w-6 rounded-full bg-neutral-700 text-neutral-200 hover:bg-cyan-700">▶</button>
          <span className="flex-1 min-w-0 truncate text-xs text-neutral-200">{d.name[nk]}</span>
          <span className="text-[11px] text-neutral-500 tabular-nums">{d.seconds}s</span>
          <button type="button" title={t('vedit_audio_add')} aria-label={t('vedit_audio_add')} data-testid="vedit-audio-sfx-add" onClick={() => host.onAddSfx(d.id)} className="h-6 w-6 rounded bg-cyan-700/70 text-white hover:bg-cyan-600">＋</button>
        </div>
      ))}
    </div>
  )
}

function Recorder({ host }: { host: AudioLibHost }) {
  const t = useStudioT()
  const [state, setState] = useState<'idle' | 'rec' | 'denied' | 'unsupported'>(() => (typeof window !== 'undefined' && typeof MediaRecorder === 'undefined' ? 'unsupported' : 'idle'))
  const [sec, setSec] = useState(0)
  const rec = useRef<{ mr: MediaRecorder; stream: MediaStream; chunks: Blob[]; t0: number; timer: number } | null>(null)
  useEffect(() => () => { const r = rec.current; if (r) { clearInterval(r.timer); r.stream.getTracks().forEach((x) => x.stop()) } }, [])
  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      const type = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find((x) => MediaRecorder.isTypeSupported(x))
      const mr = new MediaRecorder(stream, type ? { mimeType: type } : undefined)
      const chunks: Blob[] = []
      mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
      mr.onstop = () => {
        stream.getTracks().forEach((x) => x.stop())
        const mime = mr.mimeType || 'audio/webm'
        const ext = mime.includes('ogg') ? 'ogg' : mime.includes('mp4') ? 'm4a' : 'webm'
        const d = new Date(), p = (n: number) => String(n).padStart(2, '0')
        if (chunks.length) host.onRecorded(new File(chunks, `${t('vedit_audio_rec_name')}-${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.${ext}`, { type: mime.split(';')[0] }))
      }
      mr.start(250)
      const t0 = performance.now()
      rec.current = { mr, stream, chunks, t0, timer: window.setInterval(() => setSec((performance.now() - t0) / 1000), 200) }
      setSec(0); setState('rec')
    } catch { setState('denied') }
  }
  const stop = () => { const r = rec.current; if (!r) return; clearInterval(r.timer); r.mr.stop(); rec.current = null; setState('idle') }
  const mm = `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`
  return (
    <div className="flex flex-col items-center gap-3 py-6" data-testid="vedit-audio-rec" data-state={state}>
      <button type="button" disabled={state === 'unsupported'} data-testid="vedit-audio-rec-btn" onClick={() => (state === 'rec' ? stop() : void start())}
        className={`h-16 w-16 rounded-full flex items-center justify-center text-white disabled:opacity-40 ${state === 'rec' ? 'bg-red-600 animate-pulse' : 'bg-neutral-700 hover:bg-red-600'}`}
        aria-label={t(state === 'rec' ? 'vedit_audio_rec_stop' : 'vedit_audio_rec_start')}>
        {state === 'rec' ? <span className="h-5 w-5 rounded-sm bg-white" /> : <span className="h-6 w-6 rounded-full bg-red-500 ring-2 ring-white" />}
      </button>
      <div className="text-sm tabular-nums text-neutral-200" data-testid="vedit-audio-rec-time">{state === 'rec' ? mm : t('vedit_audio_rec_start')}</div>
      <div className="text-[11px] text-neutral-500 text-center px-4 leading-relaxed">
        {t(state === 'denied' ? 'vedit_audio_rec_denied' : state === 'unsupported' ? 'vedit_audio_rec_unsupported' : 'vedit_audio_rec_hint')}
      </div>
    </div>
  )
}

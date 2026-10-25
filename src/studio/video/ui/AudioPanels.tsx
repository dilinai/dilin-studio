'use client'
// 网页剪辑页·右栏「音频」页的声音处理：基础页底下的降噪／响度统一／变调／声道·「声音效果」分页的场景效果。
// 值与节点的算法在 _lib/audio.pure.ts、video-edit/vedit-audio-fx.ts；改动交宿主 onPatch（aud 几项并上去·null＝那一项拿掉）。
import { useStudioT } from '../../shared/StudioT'
import type { VideoKey as TKey } from '../i18n'
import { AUDIO_CHANS, AUDIO_SFX, type AudioChan, type AudioSfx } from '../lib/audio.pure'
import { Row, Slider } from './ManualPane'
import type { ClipHost } from './ClipInspector'

const CHAN_LABEL: Record<AudioChan, TKey> = { stereo: 'vedit_ci_chan_stereo', left: 'vedit_ci_chan_left', right: 'vedit_ci_chan_right', mono: 'vedit_ci_chan_mono', swap: 'vedit_ci_chan_swap' }
const SFX_LABEL: Record<AudioSfx, TKey> = { echo: 'vedit_ci_sfx_echo', hall: 'vedit_ci_sfx_hall', phone: 'vedit_ci_sfx_phone', radio: 'vedit_ci_sfx_radio', robot: 'vedit_ci_sfx_robot', underwater: 'vedit_ci_sfx_underwater', megaphone: 'vedit_ci_sfx_megaphone' }
const SFX_ICON: Record<AudioSfx, string> = { echo: '〰', hall: '⛪', phone: '☎', radio: '📻', robot: '🤖', underwater: '🌊', megaphone: '📣' }

export function AudioProcSection({ host }: { host: ClipHost }) {
  const t = useStudioT()
  const a = host.state.clip.aud ?? {}
  const put = (p: Record<string, unknown>, commit = true) => host.onPatch({ aud: p }, commit)
  return (
    <div className="flex flex-col gap-2.5" data-testid="vedit-ci-audio-proc">
      <div className="pt-2 border-t border-neutral-800 text-neutral-300">{t('vedit_ci_audio_proc')}</div>
      <Row label={t('vedit_ci_denoise')}>
        <Slider value={a.denoise ?? 0} min={0} max={100} label={t('vedit_ci_denoise')} testid="vedit-ci-denoise" onLive={(n) => put({ denoise: n }, false)} onCommit={(n) => put({ denoise: n })} />
        <span className="w-7 text-right tabular-nums text-neutral-300">{a.denoise ?? 0}</span>
      </Row>
      <Row label={t('vedit_ci_norm')}>
        <label className="ml-auto inline-flex items-center cursor-pointer" title={t('vedit_ci_norm_hint')}>
          <input type="checkbox" checked={!!a.norm} data-testid="vedit-ci-norm" onChange={(e) => put({ norm: e.target.checked ? true : null })} className="accent-cyan-500" />
        </label>
      </Row>
      <Row label={t('vedit_ci_semi')}>
        <Slider value={a.semi ?? 0} min={-12} max={12} label={t('vedit_ci_semi')} testid="vedit-ci-semi" onLive={(n) => put({ semi: n }, false)} onCommit={(n) => put({ semi: n })} />
        <span className="w-9 text-right tabular-nums text-neutral-300">{(a.semi ?? 0) > 0 ? `+${a.semi}` : a.semi ?? 0}</span>
      </Row>
      <Row label={t('vedit_ci_chan')}>
        <select value={a.chan ?? 'stereo'} data-testid="vedit-ci-chan" aria-label={t('vedit_ci_chan')} onChange={(e) => put({ chan: e.target.value === 'stereo' ? null : e.target.value })}
          className="ml-auto h-7 rounded bg-neutral-800 text-neutral-200 px-1.5">
          {AUDIO_CHANS.map((c) => <option key={c} value={c}>{t(CHAN_LABEL[c])}</option>)}
        </select>
      </Row>
      <div className="text-[11px] text-neutral-500 leading-relaxed">{t('vedit_ci_audio_proc_hint')}</div>
    </div>
  )
}

export function AudioSfxPanel({ host }: { host: ClipHost }) {
  const t = useStudioT()
  const cur = host.state.clip.aud?.sfx ?? null
  const pick = (s: AudioSfx | null) => host.onPatch({ aud: { sfx: s } }, true)
  return (
    <div className="flex flex-col gap-2.5" data-testid="vedit-ci-sfx" data-sfx={cur ?? 'none'}>
      <div className="grid grid-cols-4 gap-1.5">
        {([null, ...AUDIO_SFX] as const).map((s) => (
          <button key={s ?? 'none'} type="button" data-testid="vedit-ci-sfx-item" data-sfx={s ?? 'none'} data-active={cur === s ? '1' : '0'} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(s)}
            className={`flex flex-col items-center gap-1 rounded-md py-2 ${cur === s ? 'ring-2 ring-cyan-400 bg-neutral-800 text-white' : 'bg-neutral-800/60 hover:bg-neutral-800 text-neutral-300'}`}>
            <span className="text-lg leading-none" aria-hidden>{s ? SFX_ICON[s] : '⊘'}</span>
            <span className="text-[11px]">{t(s ? SFX_LABEL[s] : 'vedit_ci_sfx_none')}</span>
          </button>
        ))}
      </div>
      <div className="text-[11px] text-neutral-500 leading-relaxed">{t('vedit_ci_sfx_hint')}</div>
    </div>
  )
}

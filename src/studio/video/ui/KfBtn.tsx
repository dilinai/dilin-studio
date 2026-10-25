'use client'
// 网页剪辑页·关键帧菱形钮（剪映右栏数值旁那颗◇·两边箭头跳上一颗／下一颗）——影片片段属性、文字面板、滤镜强度共用。
// 只管画：哪几秒有关键帧（times·时间轴秒）、播放头上有没有（on）由宿主算好（_lib/clip-look.pure.ts clipKfTimes／kfOnAt 或 text-kf.pure.ts）。
import { useStudioT } from '../../shared/StudioT'
import { kfNext, kfPrev } from '../lib/keyframe.pure'

export function Diamond({ on }: { on: boolean }) {
  return <svg viewBox="0 0 12 12" className="w-3 h-3" aria-hidden><path d="M6 1l5 5-5 5-5-5z" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.3} strokeLinejoin="round" /></svg>
}
export const kfArrowCls = 'h-6 w-4 flex items-center justify-center rounded text-neutral-400 hover:text-white disabled:opacity-30 disabled:hover:text-neutral-400'
/** 实心＝播放头上有关键帧（按＝拿掉）·空心＝没有（按＝照当下的值放一颗）；打过关键帧 ⇒ 两边出箭头 */
export default function VeditKfBtn({ times, on, now, onSeek, onToggle, testid, disabled }: { times: readonly number[]; on: boolean; now: number; onSeek: (t: number) => void; onToggle: () => void; testid: string; disabled?: boolean }) {
  const t = useStudioT()
  const prev = kfPrev(times, now), next = kfNext(times, now)
  return (
    <span className="shrink-0 inline-flex items-center" data-testid={testid} data-on={on ? '1' : '0'} data-count={times.length}>
      {times.length > 0 && <button type="button" className={kfArrowCls} disabled={prev === null} title={t('vedit_ci_kf_prev')} aria-label={t('vedit_ci_kf_prev')} data-testid={`${testid}-prev`}
        onMouseDown={(e) => e.preventDefault()} onClick={() => prev !== null && onSeek(prev)}>‹</button>}
      <button type="button" disabled={disabled} title={t(on ? 'vedit_ci_kf_del' : 'vedit_ci_kf_add')} aria-label={t(on ? 'vedit_ci_kf_del' : 'vedit_ci_kf_add')} aria-pressed={on} data-testid={`${testid}-btn`}
        onMouseDown={(e) => e.preventDefault()} onClick={onToggle}
        className={`h-6 w-6 flex items-center justify-center rounded disabled:opacity-30 ${on ? 'text-cyan-300' : times.length ? 'text-cyan-500/70 hover:text-cyan-300' : 'text-neutral-500 hover:text-neutral-200'}`}><Diamond on={on} /></button>
      {times.length > 0 && <button type="button" className={kfArrowCls} disabled={next === null} title={t('vedit_ci_kf_next')} aria-label={t('vedit_ci_kf_next')} data-testid={`${testid}-next`}
        onMouseDown={(e) => e.preventDefault()} onClick={() => next !== null && onSeek(next)}>›</button>}
    </span>
  )
}

'use client'

/**
 * 「基礎動畫」对话框（画布右键进来·第一版动画清单）
 *   进场／强调／退场三格：效果、方向（飞入／擦除才有）、触发（单击时／与上一项同时／上一项之后）、时长 0.1–5 秒、延迟 0–10 秒；
 *   「預覽」＝在小画布上照设定播一遍（编辑画布平时不自动播）；下方列出本页动画顺序，可上下调。
 *   套用＝一笔 animation_set（三格一起·没选效果＝删掉那一格）；调顺序＝一笔 animation_order。
 *   影片多一格「影片步驟」（单击时播放／暂停／跳到某秒·整组＝animation_set.media）；
 *   程序动画多一格「程序步驟」（每行＝程序走一步的位置与触发·整组＝animation_set.program·不加＝隐式排在本页最后）。
 */

import { useMemo, useState } from 'react'
import { ComponentSlideView, COMPONENT_ANIMATION_CSS } from '../kit/components/render'
import {
  ANIM_EFFECTS, COMPONENT_LIMITS, DIRECTIONAL_EFFECTS,
  type AnimDirection, type AnimPhase, type AnimSpec, type AnimTrigger, type AnimationSetInput, type BasicSlideAnimation, type SlideAnimation, type SlideComponent,
} from '../kit/components/types'
import { MEDIA_ANIM_EFFECTS, type MediaAnimEffect } from '../kit/components/program-types'
import type { PageType, Theme } from '../kit/types'
import { useStudioT as useT } from '../../shared/StudioT'
/** 字串键（字典在 ../i18n-site.ts 与 ../i18n.ts） */
type TKey = string
import { editorShell } from '../../shared/theme/editor-shell-theme'
import { mediaStepsOf, programStepsOf } from './history'

const PHASES: AnimPhase[] = ['enter', 'emphasis', 'exit']
const TRIGGERS: AnimTrigger[] = ['click', 'with', 'after']
const DIRS: AnimDirection[] = ['left', 'right', 'up', 'down']

type Draft = { effect: string; direction: AnimDirection; trigger: AnimTrigger; duration: number; delay: number }
/** 影片步骤一行／程序步骤一行（秒为单位·套用时换毫秒） */
type MediaDraft = { effect: MediaAnimEffect; seek: string; trigger: AnimTrigger; delay: number }
type ProgDraft = { trigger: AnimTrigger; delay: number }

/** 页动画表一条的显示名（基础／影片步骤／程序步骤） */
export function animLabel(a: SlideAnimation, t: (k: TKey) => string): string {
  const fx = t(`slc_fx_${a.phase}_${a.effect}` as TKey)
  const sec = a.phase === 'media' && typeof a.seekSec === 'number' ? ` ${a.seekSec}${t('slc_seconds')}` : ''
  return `${t(`slc_phase_${a.phase}` as TKey)} · ${fx}${sec} · ${t(`slc_trig_${a.trigger}` as TKey)}`
}

function draftOf(a: BasicSlideAnimation | undefined, phase: AnimPhase): Draft {
  return {
    effect: a?.effect ?? '',
    direction: a?.direction ?? (phase === 'enter' && a?.effect === 'wipe' ? 'left' : 'down'),
    trigger: a?.trigger ?? 'click',
    duration: a ? a.durationMs / 1000 : 0.5,
    delay: a ? a.delayMs / 1000 : 0,
  }
}

function specOf(d: Draft): AnimSpec | null {
  if (!d.effect) return null
  const dur = Math.round(Math.max(COMPONENT_LIMITS.durationMinMs, Math.min(COMPONENT_LIMITS.durationMaxMs, d.duration * 1000)))
  const delay = Math.round(Math.max(0, Math.min(COMPONENT_LIMITS.delayMaxMs, d.delay * 1000)))
  return {
    effect: d.effect as AnimSpec['effect'],
    ...(DIRECTIONAL_EFFECTS.includes(d.effect) ? { direction: d.direction } : {}),
    trigger: d.trigger, durationMs: dur, delayMs: delay,
  }
}

export type AnimationDialogProps = {
  component: SlideComponent
  components: readonly SlideComponent[]
  animations: readonly SlideAnimation[]
  theme: Theme
  pageType: PageType
  nameOf: (id: string) => string
  onApply: (set: AnimationSetInput) => void
  onReorder: (order: string[]) => void
  onClose: () => void
  mediaUrl?: (src: string) => string
}

export default function AnimationDialog(p: AnimationDialogProps) {
  const t = useT()
  const mine = (phase: AnimPhase) => p.animations.find((a): a is BasicSlideAnimation => a.componentId === p.component.id && a.phase === phase)
  const [drafts, setDrafts] = useState<Record<AnimPhase, Draft>>(() => ({
    enter: draftOf(mine('enter'), 'enter'), emphasis: draftOf(mine('emphasis'), 'emphasis'), exit: draftOf(mine('exit'), 'exit'),
  }))
  // 影片：单击时播放／暂停／跳秒；程序：程序步骤（不加＝隐式排在本页最后）
  const isVideo = p.component.type === 'video'
  const isProgram = p.component.type === 'program'
  const hadMedia = useMemo(() => mediaStepsOf(p.animations, p.component.id), [p.animations, p.component.id])
  const hadProg = useMemo(() => programStepsOf(p.animations, p.component.id), [p.animations, p.component.id])
  const [media, setMedia] = useState<MediaDraft[]>(() => (hadMedia ?? []).map((m) => ({ effect: m.effect, seek: typeof m.seekSec === 'number' ? String(m.seekSec) : '', trigger: m.trigger, delay: m.delayMs / 1000 })))
  const [prog, setProg] = useState<ProgDraft[]>(() => (hadProg ?? []).map((s) => ({ trigger: s.trigger, delay: s.delayMs / 1000 })))
  const declaredSteps = p.component.type === 'program' ? (p.component.steps ?? 0) : 0
  const ms = (sec: number, max: number) => Math.round(Math.max(0, Math.min(max, (Number(sec) || 0) * 1000)))
  const [playKey, setPlayKey] = useState(0)
  const set = (phase: AnimPhase, patch: Partial<Draft>) => setDrafts((d) => ({ ...d, [phase]: { ...d[phase], ...patch } }))

  // 预览：本组件的三格按「进场→强调→退场」接着播（都改成自动接续·不等单击）
  const preview = useMemo<SlideAnimation[]>(() => {
    const out: SlideAnimation[] = []
    PHASES.forEach((phase, i) => {
      const s = specOf(drafts[phase])
      if (s) out.push({ ...s, trigger: i === 0 || out.length === 0 ? 'with' : 'after', id: `pv-${phase}`, componentId: p.component.id, phase })
    })
    return out
  }, [drafts, p.component.id])

  const apply = () => {
    const input: AnimationSetInput = {}
    for (const phase of PHASES) {
      const s = specOf(drafts[phase])
      const had = !!mine(phase)
      if (s) input[phase] = s
      else if (had) input[phase] = null
    }
    if (isVideo && (media.length || hadMedia)) {
      input.media = media.length ? media.map((m) => {
        const raw = m.seek.trim()
        const sec = raw === '' ? undefined : Math.max(0, Math.min(COMPONENT_LIMITS.seekMaxSec, Number(raw) || 0))
        return {
          effect: m.effect, trigger: m.trigger, delayMs: ms(m.delay, COMPONENT_LIMITS.delayMaxMs),
          ...(m.effect === 'seek' ? { seekSec: sec ?? 0 } : m.effect === 'play' && sec !== undefined ? { seekSec: sec } : {}),
        }
      }) : null
    }
    if (isProgram && (prog.length || hadProg)) {
      input.program = prog.length ? prog.map((s) => ({ trigger: s.trigger, delayMs: ms(s.delay, COMPONENT_LIMITS.delayMaxMs) })) : null
    }
    p.onApply(input)
    p.onClose()
  }

  const move = (i: number, d: -1 | 1) => {
    const ids = p.animations.map((a) => a.id)
    const j = i + d
    if (j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    p.onReorder(ids)
  }

  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center ${editorShell.modalMaskColor}`} onPointerDown={p.onClose} data-testid="slc-anim-dialog">
      <style>{COMPONENT_ANIMATION_CSS}</style>
      <div className={`${editorShell.modalCard} p-5 w-[720px] max-w-[95vw] max-h-[90vh] overflow-y-auto text-gray-800`} onPointerDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-3">
          <div className="text-sm font-semibold">{t('slc_anim_title')}</div>
          <div className="text-xs text-gray-400 truncate">{p.nameOf(p.component.id)}</div>
          <button type="button" className="ml-auto text-gray-400 hover:text-gray-700 px-2" onClick={p.onClose} aria-label={t('slc_close')}>✕</button>
        </div>
        <div className="flex gap-4 flex-wrap">
          <div className="flex-1 min-w-[300px] space-y-3">
            {PHASES.map((phase) => {
              const d = drafts[phase]
              const directional = DIRECTIONAL_EFFECTS.includes(d.effect)
              return (
                <div key={phase} className="rounded-lg border border-gray-200 p-2.5" data-testid={`slc-anim-${phase}`}>
                  <div className="text-xs font-medium text-gray-600 mb-1.5">{t(`slc_phase_${phase}` as TKey)}</div>
                  <div className="grid grid-cols-2 gap-1.5 text-xs">
                    <label className="flex items-center gap-1">{t('slc_anim_effect')}
                      <select className="flex-1 border border-gray-200 rounded px-1 py-0.5 bg-white" value={d.effect} data-testid={`slc-anim-${phase}-effect`}
                        onChange={(e) => set(phase, { effect: e.target.value })}>
                        <option value="">{t('slc_anim_none')}</option>
                        {(ANIM_EFFECTS[phase] as readonly string[]).map((fx) => <option key={fx} value={fx}>{t(`slc_fx_${phase}_${fx}` as TKey)}</option>)}
                      </select>
                    </label>
                    <label className="flex items-center gap-1">{t('slc_anim_direction')}
                      <select className="flex-1 border border-gray-200 rounded px-1 py-0.5 bg-white disabled:opacity-40" value={d.direction} disabled={!d.effect || !directional}
                        onChange={(e) => set(phase, { direction: e.target.value as AnimDirection })}>
                        {DIRS.map((x) => <option key={x} value={x}>{t(`slc_dir_${x}` as TKey)}</option>)}
                      </select>
                    </label>
                    <label className="flex items-center gap-1">{t('slc_anim_trigger')}
                      <select className="flex-1 border border-gray-200 rounded px-1 py-0.5 bg-white disabled:opacity-40" value={d.trigger} disabled={!d.effect} data-testid={`slc-anim-${phase}-trigger`}
                        onChange={(e) => set(phase, { trigger: e.target.value as AnimTrigger })}>
                        {TRIGGERS.map((x) => <option key={x} value={x}>{t(`slc_trig_${x}` as TKey)}</option>)}
                      </select>
                    </label>
                    <label className="flex items-center gap-1">{t('slc_anim_duration')}
                      <input type="number" min={0.1} max={5} step={0.1} className="w-16 border border-gray-200 rounded px-1 py-0.5 disabled:opacity-40" disabled={!d.effect}
                        value={d.duration} onChange={(e) => set(phase, { duration: Number(e.target.value) || 0.1 })} />
                      {t('slc_seconds')}
                    </label>
                    <label className="flex items-center gap-1">{t('slc_anim_delay')}
                      <input type="number" min={0} max={10} step={0.1} className="w-16 border border-gray-200 rounded px-1 py-0.5 disabled:opacity-40" disabled={!d.effect}
                        value={d.delay} onChange={(e) => set(phase, { delay: Math.max(0, Number(e.target.value) || 0) })} />
                      {t('slc_seconds')}
                    </label>
                  </div>
                </div>
              )
            })}
            {isVideo && (
              <div className="rounded-lg border border-gray-200 p-2.5" data-testid="slc-anim-media">
                <div className="text-xs font-medium text-gray-600 mb-1">{t('slc_phase_media')}</div>
                <div className="text-[11px] text-gray-400 mb-1.5">{t('slc_anim_media_hint')}</div>
                <div className="space-y-1">
                  {media.map((m, i) => (
                    <div key={i} className="flex items-center gap-1.5 text-xs flex-wrap" data-testid="slc-anim-media-row">
                      <span className="text-gray-400 w-4">{i + 1}</span>
                      <select className="border border-gray-200 rounded px-1 py-0.5 bg-white" value={m.effect} data-testid="slc-anim-media-effect"
                        onChange={(e) => setMedia((l) => l.map((x, k) => (k === i ? { ...x, effect: e.target.value as MediaAnimEffect, seek: e.target.value === 'seek' && x.seek === '' ? '0' : x.seek } : x)))}>
                        {MEDIA_ANIM_EFFECTS.map((fx) => <option key={fx} value={fx}>{t(`slc_fx_media_${fx}` as TKey)}</option>)}
                      </select>
                      {m.effect !== 'pause' && (
                        <label className="flex items-center gap-1">{t('slc_anim_seek_sec')}
                          <input type="number" min={0} step={0.1} className="w-16 border border-gray-200 rounded px-1 py-0.5" value={m.seek} data-testid="slc-anim-media-seek"
                            placeholder={m.effect === 'play' ? t('slc_anim_seek_keep') : '0'}
                            onChange={(e) => setMedia((l) => l.map((x, k) => (k === i ? { ...x, seek: e.target.value } : x)))} />
                        </label>
                      )}
                      <select className="border border-gray-200 rounded px-1 py-0.5 bg-white" value={m.trigger}
                        onChange={(e) => setMedia((l) => l.map((x, k) => (k === i ? { ...x, trigger: e.target.value as AnimTrigger } : x)))}>
                        {TRIGGERS.map((x) => <option key={x} value={x}>{t(`slc_trig_${x}` as TKey)}</option>)}
                      </select>
                      <label className="flex items-center gap-1">{t('slc_anim_delay')}
                        <input type="number" min={0} max={10} step={0.1} className="w-14 border border-gray-200 rounded px-1 py-0.5" value={m.delay}
                          onChange={(e) => setMedia((l) => l.map((x, k) => (k === i ? { ...x, delay: Math.max(0, Number(e.target.value) || 0) } : x)))} />
                      </label>
                      <button type="button" className="px-1 text-gray-400 hover:text-red-500" aria-label={t('slc_anim_step_remove')} title={t('slc_anim_step_remove')}
                        onClick={() => setMedia((l) => l.filter((_, k) => k !== i))}>✕</button>
                    </div>
                  ))}
                </div>
                <button type="button" className="mt-1.5 px-2 py-0.5 text-[11px] rounded-md border border-gray-200 bg-white hover:bg-gray-50 text-gray-600" data-testid="slc-anim-media-add"
                  onClick={() => setMedia((l) => [...l, { effect: l.length && l[l.length - 1].effect === 'play' ? 'pause' : 'play', seek: '', trigger: 'click', delay: 0 }])}>{t('slc_anim_step_add')}</button>
              </div>
            )}
            {isProgram && (
              <div className="rounded-lg border border-gray-200 p-2.5" data-testid="slc-anim-program">
                <div className="text-xs font-medium text-gray-600 mb-1">{t('slc_phase_program')}</div>
                <div className="text-[11px] text-gray-400 mb-1.5">{t('slc_anim_program_hint').replace(/\{n\}/g, String(declaredSteps))}</div>
                <div className="space-y-1">
                  {prog.map((s, i) => (
                    <div key={i} className="flex items-center gap-1.5 text-xs flex-wrap" data-testid="slc-anim-program-row">
                      <span className="text-gray-400 w-16">{t('slc_fx_program_step')} {i + 1}</span>
                      <select className="border border-gray-200 rounded px-1 py-0.5 bg-white" value={s.trigger}
                        onChange={(e) => setProg((l) => l.map((x, k) => (k === i ? { ...x, trigger: e.target.value as AnimTrigger } : x)))}>
                        {TRIGGERS.map((x) => <option key={x} value={x}>{t(`slc_trig_${x}` as TKey)}</option>)}
                      </select>
                      <label className="flex items-center gap-1">{t('slc_anim_delay')}
                        <input type="number" min={0} max={10} step={0.1} className="w-14 border border-gray-200 rounded px-1 py-0.5" value={s.delay}
                          onChange={(e) => setProg((l) => l.map((x, k) => (k === i ? { ...x, delay: Math.max(0, Number(e.target.value) || 0) } : x)))} />
                      </label>
                      <button type="button" className="px-1 text-gray-400 hover:text-red-500" aria-label={t('slc_anim_step_remove')} title={t('slc_anim_step_remove')}
                        onClick={() => setProg((l) => l.filter((_, k) => k !== i))}>✕</button>
                    </div>
                  ))}
                </div>
                <div className="flex gap-1.5 mt-1.5">
                  <button type="button" className="px-2 py-0.5 text-[11px] rounded-md border border-gray-200 bg-white hover:bg-gray-50 text-gray-600" data-testid="slc-anim-program-add"
                    onClick={() => setProg((l) => [...l, { trigger: 'click', delay: 0 }])}>{t('slc_anim_step_add')}</button>
                  {declaredSteps > 0 && prog.length < declaredSteps && (
                    <button type="button" className="px-2 py-0.5 text-[11px] rounded-md border border-gray-200 bg-white hover:bg-gray-50 text-gray-600" data-testid="slc-anim-program-fill"
                      onClick={() => setProg((l) => [...l, ...Array.from({ length: declaredSteps - l.length }, () => ({ trigger: 'click' as AnimTrigger, delay: 0 }))])}>{t('slc_anim_program_fill').replace('{n}', String(declaredSteps))}</button>
                  )}
                </div>
              </div>
            )}
          </div>
          <div className="w-[300px] shrink-0 space-y-2">
            <div className="rounded-lg overflow-hidden border border-gray-200" data-testid="slc-anim-preview">
              <ComponentSlideView key={playKey} components={p.components} animations={preview} theme={p.theme} pageType={p.pageType}
                mode="editor" playAnimations width={300} mediaUrl={p.mediaUrl} />
            </div>
            <button type="button" className="w-full text-xs py-1.5 rounded-md bg-gray-100 hover:bg-gray-200 disabled:opacity-40" disabled={preview.length === 0}
              data-testid="slc-anim-preview-btn" onClick={() => setPlayKey((k) => k + 1)}>▶ {t('slc_anim_preview')}</button>
            <div className="text-xs font-medium text-gray-600 pt-1">{t('slc_anim_order')}</div>
            <div className="space-y-1 max-h-48 overflow-y-auto" data-testid="slc-anim-order">
              {p.animations.length === 0 && <div className="text-xs text-gray-400">{t('slc_anim_order_empty')}</div>}
              {p.animations.map((a, i) => (
                <div key={a.id} className={`flex items-center gap-1 text-[11px] rounded px-1.5 py-1 ${a.componentId === p.component.id ? 'bg-blue-50' : 'bg-gray-50'}`}>
                  <span className="text-gray-400 w-4">{i + 1}</span>
                  <span className="truncate flex-1">{p.nameOf(a.componentId)} · {animLabel(a, t)}</span>
                  <button type="button" className="px-1 text-gray-500 hover:text-gray-900 disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} aria-label={t('slc_move_up')}>↑</button>
                  <button type="button" className="px-1 text-gray-500 hover:text-gray-900 disabled:opacity-30" disabled={i === p.animations.length - 1} onClick={() => move(i, 1)} aria-label={t('slc_move_down')}>↓</button>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button type="button" className="px-3 py-1.5 text-xs rounded-md text-gray-600 hover:bg-gray-100" onClick={p.onClose}>{t('slc_cancel')}</button>
          <button type="button" className="px-3 py-1.5 text-xs rounded-md bg-blue-600 hover:bg-blue-500 keep-white" data-testid="slc-anim-apply" onClick={apply}>{t('slc_apply')}</button>
        </div>
      </div>
    </div>
  )
}

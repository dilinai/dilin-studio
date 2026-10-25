'use client'
// 网页剪辑页·时间轴片段右键「分离人声」：
//   useClipStems：右键选的那几段（能分的·一段一段来）⇒ 挑怎么拆（有装好 AI 分轨的终端 ⇒ 交终端·这个浏览器那台优先；没有 ⇒ 编曲「拆人声」那支浏览器模型）⇒
//   拆好人声、伴奏两份进素材区（同汇入：背景上传）⇒ 原片段这段期间没被改过 ⇒ 各放一段到音频轨对齐原片段·原片段静音；改过 ⇒ 只进素材区、说一声。
// 「自動調配算力」：开着时交终端失败（非取消）⇒ 换本帐号另一台装好 AI 分轨的（⛔ 再找失败过的）→ 都不行改这台浏览器；关着照旧只报错。
//   ClipStemsPanel：跑着的时候右下角一张小卡——进度条＋那台报的白话（或下载模型／拆分中）＋取消（样式同编曲拆曲／交給終端那块）。
import { useCallback, useEffect, useRef, useState } from 'react'
import { useStudioT } from '../../shared/StudioT'
import type { AsrEnv } from '../lib/asr.pure'
import { placeStems, stemsSourceRange, stemsTargets } from '../lib/clip-stems.pure'
import { clipsSnapshot } from '../lib/offload.pure'
import { defaultChoice, shellChoices } from '../lib/shell-media.pure'
import { SPLIT_SR, splitFileNames, splitModelUrl, splitOrtUrl, splitRatio } from '../lib/split.pure'
import * as T from '../lib/timeline.pure'
import { separateRange, type ClipStemsPhase, type StemsVia } from './clip-stems'
import { computeSwitchText } from '../lib/compute-failover.pure'
import { SplitEngine } from './split-client'
import { ShellJobError, shellErrText, shellPhasePct, type VeditShellApi } from '../lib/shell-job'

type TKey = string
const noLocal = (): string | null => null

const uid = () => crypto.randomUUID()

export type ClipStemsEnv = {
  tracks: () => T.Tracks
  mediaOf: (id: string) => { id: string; name: string; duration: number } | undefined
  kindOf: (mediaId: string) => T.MediaKindLike | undefined
  /** 素材的声音从哪读（同合成子素材／识别字幕：剪辑用的那份） */
  readBlob: (mediaId: string) => Promise<Blob | null>
  /** 进素材区（同汇入本机素材）·回加进去的那几份 */
  addFiles: (files: File[]) => Promise<Array<{ id: string }>>
  /** 改好的轨道进复原栈·选起新放的两段 */
  apply: (tracks: T.Tracks, sel: string[]) => void
  /** 交终端时那截先传云盘（同编曲交終端） */
  put: (f: File, onP: (p: number) => void) => Promise<{ fileId: string; folderId: string | null }>
  notice: (text: string) => void
  /** 交终端那条（宿主给·没有 ⇒ 只用浏览器模型） */
  shell: VeditShellApi | null
  /** 浏览器模型从哪下 */
  asr: AsrEnv
}
export type ClipStemsJob = { k: number; of: number; name: string; device: string | null; phase: ClipStemsPhase }

export function useClipStems(env: ClipStemsEnv) {
  const t = useStudioT()
  // 宿主一开页就定了（登入版有、游客版没有）⇒ 每次渲染叫的 hook 都一样
  const local = (env.shell?.useLocalDeviceId ?? noLocal)()
  const envRef = useRef(env)
  envRef.current = env
  const [job, setJob] = useState<ClipStemsJob | null>(null)
  const runRef = useRef(0)
  const busyRef = useRef(false)
  const engRef = useRef<SplitEngine | null>(null)
  const dropEngine = () => { engRef.current?.dispose(); engRef.current = null }
  useEffect(() => () => { runRef.current++; dropEngine() }, [])
  const cancel = useCallback(() => {
    runRef.current++ // 交终端那条：runShellJob 看到 cancelled() ⇒ 发 media_cancel
    busyRef.current = false
    dropEngine()
    setJob(null)
    envRef.current.notice(t('vedit_shell_cancelled'))
  }, [t])
  const start = useCallback(async (ids: readonly string[]) => {
    const e = envRef.current
    if (busyRef.current) { e.notice(t('vedit_stems_busy')); return }
    const targets = stemsTargets(e.tracks(), ids, e.kindOf)
    if (!targets.length) return
    const run = ++runRef.current
    const live = () => runRef.current === run
    busyRef.current = true
    setJob({ k: 0, of: targets.length, name: '', device: null, phase: { kind: 'prep' } })
    let web = false
    try {
      // 有装好 AI 分轨的终端 ⇒ 交终端（这个浏览器那台优先）；没有 ⇒ 浏览器模型；两样都没有 ⇒ 说明
      const devs = e.shell ? await e.shell.fetchMediaDevices() : null
      let dev = defaultChoice(shellChoices(devs ?? [], 'stems').filter((d) => d.view.stems.state === 'ready'), local)
      const modelUrl = splitModelUrl(e.asr.modelHost)
      if (!live()) return
      if (!dev && !modelUrl) { setJob(null); e.notice(t('vedit_stems_no_way')); return }
      web = !dev
      /** 「自動調配算力」：这一趟交过、失败了的那几台（⛔ 再交给它） */
      const tried: string[] = []
      let placed = 0, kept = 0, unread = ''
      for (let k = 0; k < targets.length; k++) {
        const id = targets[k]
        const tr0 = e.tracks()
        const f = T.findClip(tr0, id)
        if (!f || !T.canSeparateVocals(tr0, id, e.kindOf)) continue
        const m = e.mediaOf(f.clip.mediaId)
        const range = m ? stemsSourceRange(f.clip, m.duration, SPLIT_SR) : null
        if (!m || !range) continue
        setJob({ k, of: targets.length, name: m.name, device: dev?.name ?? null, phase: { kind: 'prep' } })
        const snap = clipsSnapshot(tr0, [id])
        const blob = await e.readBlob(m.id)
        if (!live()) return
        if (!blob) { unread = m.name; continue }
        const names = splitFileNames(m.name, { vocals: t('bf_varr_split_vocals'), inst: t('bf_varr_split_inst') })
        let r: Awaited<ReturnType<typeof separateRange>>
        for (;;) {
          const via: StemsVia = dev ? { shell: { dev, put: e.put, api: e.shell! } }
            : { web: engRef.current ?? (engRef.current = new SplitEngine(splitOrtUrl(e.asr.npmBase), modelUrl!, (loaded, total) => { if (live()) setJob((j) => j && { ...j, phase: { kind: 'model', loaded, total } }) })) }
          try {
            r = await separateRange({ blob, range, name: m.name.replace(/\.[^.\/\\]{1,8}$/, '').trim() || 'clip', via, onPhase: (p) => { if (live()) setJob((j) => j && { ...j, phase: p }) }, cancelled: () => !live() })
            break
          } catch (err) {
            // 「自動調配算力」开着：交终端失败（非取消）⇒ 换本帐号另一台装好的 → 都不行改这台浏览器；关着／取消／浏览器那条失败 ⇒ 照旧报错
            if (!live() || !dev || !e.shell) throw err
            tried.push(dev.deviceId)
            const step = await e.shell.computeFailover(err, { kind: 'stems', tried, local, web: () => !!modelUrl })
            if (!live()) return
            if (!step) throw err
            dev = step.to === 'device' ? step.dev : null
            web = !dev
            e.notice(computeSwitchText(t, step))
            setJob((j) => j && { ...j, device: dev?.name ?? null, phase: { kind: 'prep' } })
          }
        }
        if (!live()) return
        const added = await e.addFiles([new File([r.vocals as BlobPart], names.vocals, { type: 'audio/wav' }), new File([r.inst as BlobPart], names.inst, { type: 'audio/wav' })])
        if (!live()) return
        if (added.length < 2) throw new Error('add')
        // 拆的期间这段被改过（挪了／剪了／删了／换素材）⇒ ⛔ 照旧位置放（会对不上）·只留在素材区
        const tr1 = e.tracks()
        const out = clipsSnapshot(tr1, [id]) === snap ? placeStems(tr1, id, range.from, { vocals: { mediaId: added[0].id }, inst: { mediaId: added[1].id } }, e.kindOf, uid, uid) : null
        if (out) { e.apply(out.tracks, out.ids); placed++ } else kept++
      }
      if (!live()) return
      setJob(null)
      if (unread && !placed && !kept) e.notice(t('vedit_stems_read_fail').replace('{name}', unread))
      else if (kept) e.notice(t('vedit_stems_changed'))
      else if (placed) e.notice(t('vedit_stems_done'))
    } catch (err) {
      if (!live()) return
      setJob(null)
      const msg = String((err as Error)?.message || err).slice(0, 120)
      e.notice(err instanceof ShellJobError ? shellErrText(t, err) : t('bf_varr_split_fail').replace('{msg}', msg))
      if (web) dropEngine()
      console.warn('[vedit-clip-stems]', err)
    } finally {
      if (live()) { busyRef.current = false; dropEngine() }
    }
  }, [t, local])
  return { job, start, cancel, busy: job !== null }
}

/** 进度条那格的百分比与那句白话 */
export function clipStemsStatus(t: (k: TKey) => string, p: ClipStemsPhase): { pct: number; text: string } {
  if (p.kind === 'prep') return { pct: 0, text: t('vedit_stems_prep') }
  if (p.kind === 'finish') return { pct: 100, text: t('vedit_stems_finish') }
  if (p.kind === 'shell') {
    const ph = p.ph
    const text = ph.kind === 'upload' ? t('vedit_shell_uploading').replace('{p}', String(Math.round(ph.p * 100)))
      : ph.kind === 'send' ? t('vedit_shell_sending') : ph.job?.stage || t('vedit_shell_waiting')
    return { pct: shellPhasePct(ph), text }
  }
  const pct = Math.round(splitRatio(p) * 100)
  return { pct, text: t(p.kind === 'model' ? 'bf_varr_split_loading' : 'bf_varr_split_running').replace('{p}', String(pct)) }
}

export default function ClipStemsPanel({ job, onCancel }: { job: ClipStemsJob | null; onCancel: () => void }) {
  const t = useStudioT()
  if (!job) return null
  const { pct, text } = clipStemsStatus(t, job.phase)
  const shell = job.device !== null
  return (
    <div role="status" className="fixed right-4 bottom-4 z-[55] w-72 flex flex-col gap-1.5 rounded-lg border border-neutral-700 bg-neutral-800/95 p-3 shadow-xl" data-testid="vedit-stems-job" data-via={shell ? 'shell' : 'web'} data-phase={job.phase.kind}>
      <div className="flex items-center gap-2 text-xs text-neutral-100">
        <span className="shrink-0">{t('vedit_menu_stems')}</span>
        {job.of > 1 && <span className="shrink-0 text-neutral-400 tabular-nums">{job.k + 1}／{job.of}</span>}
        <span className="min-w-0 truncate text-neutral-400" data-testid="vedit-stems-name">{job.name}</span>
      </div>
      <p className="text-[11px] text-neutral-500 truncate">{shell ? t('vedit_stems_on_shell').replace('{device}', job.device!) : t('vedit_stems_on_web')}</p>
      <div className="h-1.5 rounded bg-neutral-900 overflow-hidden" data-testid="vedit-stems-progress" data-p={pct}>
        <div className={`h-full transition-[width] ${shell ? 'bg-violet-500' : 'bg-cyan-500'}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="flex items-center gap-2 text-[11px] text-neutral-400">
        <span className="min-w-0 truncate" data-testid="vedit-stems-status">{text}</span>
        <button type="button" onClick={onCancel} data-testid="vedit-stems-cancel" className="ml-auto shrink-0 rounded px-2 py-0.5 text-neutral-300 hover:bg-neutral-700">{t('vedit_shell_cancel')}</button>
      </div>
      {/* 浏览器那条用 UVR 的模型：其 README 要求署名（同编曲拆曲） */}
      {!shell && <p className="text-[10px] text-neutral-600">{t('bf_varr_split_credit')}</p>}
    </div>
  )
}

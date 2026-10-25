'use client'
// 剪辑页「匯出」弹窗：选档名、解析度、帧率、背景（不透明 MP4／透明 WebM）、范围（整条／只汇出选中段）→ 进度＋取消 → 下载；底下另可汇出音频（WAV）、字幕（SRT）、静帧（PNG）。
//   存雲盤（边编边传／编完再传）与「用哪台电脑导出」要网站后端：宿主给 drive（与 cloud）才出现；游客版不给 ⇒ 只有这台浏览器导出、下载。
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { useStudioT } from '../../shared/StudioT'
import { EXPORT_FPS, EXPORT_FPS_OPTS, EXPORT_RES, exportNameDefault, exportNameFrom, exportSize, resLabel, selectionRange, type ExportFps, type ExportRange, type ExportRes } from '../lib/export.pure'
import { tracksToSrt } from '../lib/clip-ops.pure'
import { tracksToAss, tracksToVtt } from '../lib/subtitle-io.pure'
import type { ArrCloud } from './Arrange'
import { teeSink, type RenderStream } from '../lib/export-tee'
import { DRIVE_OFF, EXPORT_TARGET_HERE, driveButtonShown, driveFlow, exportPartBody, keepTarget, remoteActive, remoteFromJob, remotePartVerdict, stallGiveUp, nextStalledSince, type ExportTargetOption, type RemoteView } from '../lib/export-client.pure'
import { alphaGate, exportSpec, type AlphaSupport } from '../lib/export-alpha.pure'
import { renderVideo as renderCore, type RenderOpts, type RenderResult, type ExportEnv, alphaExportSupport, canExportVideo, downloadBlob, fmtDur, renderAudio, renderStill } from './export-render'
export type { RenderStream }

/** 同名包一层：stream（边编边传）⇒ teeSink 造好 sink 交给核心（两个调用方照旧传 stream） */
export function renderVideo(env: ExportEnv, opts: Omit<RenderOpts, 'sink'> & { stream?: RenderStream }): Promise<RenderResult> {
  const { stream, ...rest } = opts
  return renderCore(env, stream ? { ...rest, sink: teeSink(stream) } : rest)
}

/** 「匯出」弹窗：选解析度、帧率、范围（整条／只汇选中段）→ 进度＋取消 → 下载·可存云盘；底下另有汇出音频／字幕／静帧 */
/** 边编边传那只上传器（网站的分片上传口）：状态回报、收尾、取消、断线再试 */
export type ExportStreamUpload = { write: (position: number, data: Uint8Array) => void; end: () => void; cancel: () => void; retry: () => void; done: Promise<{ id: string }> }
export type ExportStreamStatus = { phase: string; uploadedBytes: number; producedBytes: number }
/** 存雲盤／别台导出要宿主帮忙的（缺 ⇒ 不出「匯出並存雲盤」与「用哪台电脑导出」） */
export type ExportDrive = {
  /** 成片存哪个夹（先等草稿建好·同素材上传那个夹） */ folder: () => Promise<string | null>
  /** 云盘档案的打开链接（读不到 ⇒ null） */ fileUrl: (id: string) => Promise<string | null>
  /** 别台导出读的是已存的工程档 ⇒ 先把手上的改动存进去·回工程档号（没存成 ⇒ null） */ saveProject: () => Promise<string | null>
  /** 云盘那个夹的网址（新分页打开） */ folderHref: (folderId: string | null) => string
  /** 本人在线、能导出的电脑（第一项这台）；取不到 ⇒ null */ targets: (hereLabel: string) => Promise<ExportTargetOption[] | null>
  /** 开一只边编边传的上传器 */ stream: (o: { fileName: string; folderId: string | null; bound: { durationSec: number; width: number; height: number; fps: number; audio: boolean }; onStatus: (s: ExportStreamStatus) => void }) => ExportStreamUpload
  /** 别台导出：下单（回 HTTP 状态与回包）·问状态（回包；取不到 ⇒ null）·取消 */
  remoteStart: (body: Record<string, unknown>) => Promise<{ ok: boolean; status: number; j: Record<string, unknown> }>
  remotePoll: (jobId: string) => Promise<unknown | null>
  remoteCancel: (jobId: string) => void
}
const isFullErr = (e: unknown) => { const x = e as { full?: boolean; code?: string } | null; return !!x && (x.full === true || x.code === 'quota_exceeded' || x.code === 'storage_full') }
/** 别台导出轮询间隔 */
const REMOTE_POLL_MS = 3000
/** 断线时多久催一次再试（online 事件不一定来） */
const STALL_RETRY_MS = 20_000

export default function VeditExportDialog({ env, ratio, title, end, cloud, onClose, sel = [], now = 0, drive = null }: {
  env: ExportEnv
  /** 播放器比例（宽／高·null ⇒ 16:9） */ ratio: number | null
  title: string
  /** 时间轴多长（秒） */ end: number
  cloud: ArrCloud | null
  onClose: () => void
  /** 选中的片段（有 ⇒ 可选「只汇出选中段」）·播放头（静帧取这一帧） */ sel?: readonly string[]; now?: number
  drive?: ExportDrive | null
}) {
  const t = useStudioT()
  const [res, setRes] = useState<ExportRes>('1080')
  // 檔名栏·默认＝原自动档名（<工程名>-月日-时分）·可改；MP4／存雲盤／WAV／SRT／PNG 都用它
  const [fileName, setFileName] = useState(() => exportNameDefault(title, new Date()))
  const [fps, setFps] = useState<ExportFps>(EXPORT_FPS)
  // 「透明背景」：没放素材的地方保留透明·出 WebM（VP9 透明＋Opus）；浏览器编不了 ⇒ 白话说明、不给选
  const [alpha, setAlpha] = useState(false)
  const [alphaOk, setAlphaOk] = useState<AlphaSupport | null>(null)
  const spec = exportSpec(alpha)
  const selRange = useMemo(() => selectionRange(env.tracks, sel), [env.tracks, sel])
  const [part, setPart] = useState<'all' | 'sel'>('all')
  const range: ExportRange = part === 'sel' && selRange ? selRange : { from: 0, to: end }
  const [side, setSide] = useState<{ kind: 'wav' | 'srt' | 'vtt' | 'ass' | 'png'; state: 'busy' | 'none' | 'fail' | 'done'; msg?: string } | null>(null)
  const sideOut = async (kind: 'wav' | 'srt' | 'vtt' | 'ass' | 'png') => {
    setSide({ kind, state: 'busy' })
    try {
      let blob: Blob | null = null
      if (kind === 'srt' || kind === 'vtt' || kind === 'ass') {
        const o = { only: range.only, from: range.from }
        const txt = kind === 'srt' ? tracksToSrt(env.tracks, o) : kind === 'vtt' ? tracksToVtt(env.tracks, o) : tracksToAss(env.tracks, size, { ...o, title })
        blob = txt ? new Blob([(kind === 'vtt' ? '' : '\ufeff') + txt], { type: kind === 'srt' ? 'application/x-subrip' : kind === 'vtt' ? 'text/vtt' : 'text/x-ssa' }) : null
      }
      else if (kind === 'wav') blob = await renderAudio(env, range)
      else blob = (await renderStill(env, Math.min(Math.max(0, now), Math.max(0, end - 1 / 30)), size.w, size.h, { alpha })).blob
      if (!blob) { setSide({ kind, state: 'none' }); return }
      downloadBlob(blob, exportNameFrom(fileName, title, new Date(), kind))
      setSide({ kind, state: 'done' })
    } catch (e) { const c = e as { code?: string; list?: string }; setSide({ kind, state: 'fail', ...(c.code === 'audio_unreadable' ? { msg: t('vedit_export_audio_unreadable').replace('{list}', c.list ?? '') } : {}) }) }
  }
  const size = useMemo(() => exportSize(ratio, res), [ratio, res])
  useEffect(() => {
    let live = true
    setAlphaOk(null)
    void alphaExportSupport(size.w, size.h, fps).then((s) => { if (live) setAlphaOk(s) })
    return () => { live = false }
  }, [size.w, size.h, fps])
  const [phase, setPhase] = useState<'idle' | 'run' | 'done' | 'fail'>('idle')
  const [prog, setProg] = useState(0)
  const [err, setErr] = useState('')
  const [result, setResult] = useState<{ file: File; audio: boolean; audioLost: boolean; skipped: number; downloaded: boolean; noAlphaArea?: boolean } | null>(null)
  // 存雲盤那条：边渲染边传 ⇒ 失败不打断渲染、成片留本机、可再按一次存雲盤（整份传本机那份）
  const [drv, dispatchDrv] = useReducer(driveFlow, DRIVE_OFF)
  const [driveLink, setDriveLink] = useState<string | null>(null)
  // 存进云盘后那个夹的网址（成片存的夹＝drive.folder·同素材上传夹）
  const [folderHref, setFolderHref] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const upCancel = useRef<(() => void) | null>(null)
  const streamRef = useRef<ExportStreamUpload | null>(null)
  const stalledSince = useRef<number | null>(null)
  const lastUploaded = useRef(0)
  const renderDone = useRef(false)
  // 第一项这台·其余本人在线实体电脑（⛔ 雲電腦）
  const [targets, setTargets] = useState<ExportTargetOption[]>(() => [{ value: EXPORT_TARGET_HERE, label: t('vedit_export_target_here') }])
  const [target, setTarget] = useState<string>(EXPORT_TARGET_HERE)
  const [remote, setRemote] = useState<RemoteView | null>(null)
  const remoteStop = useRef<(() => void) | null>(null)
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false; abortRef.current?.abort(); upCancel.current?.(); streamRef.current?.cancel(); remoteStop.current?.() }, [])
  const loadTargets = useCallback(() => {
    if (!drive) return
    void drive.targets(t('vedit_export_target_here')).then((opts) => {
      if (!alive.current || !opts) return
      setTargets(opts)
      setTarget((cur) => keepTarget(cur, opts))
    }).catch(() => { /* 取不到 ⇒ 只剩这台 */ })
  }, [drive, t])
  useEffect(() => { loadTargets() }, [loadTargets])
  const here = target === EXPORT_TARGET_HERE
  // 别台也能只导选中段：范围（range／only）随任务带去那台（⛔ 再强制整条）
  // 透明背景：这台导出 ⇒ 要这台浏览器编得了（VP9 透明）；别台导出 ⇒ 那台的导出页自己核（编不了会回白话失败）
  const alphaAllowed = alphaGate(here, alphaOk)
  useEffect(() => { if (!alphaAllowed) setAlpha(false) }, [alphaAllowed])
  // 断线（stalled）：每 STALL_RETRY_MS 催一次再试；渲染完了还断着超过 STALL_GIVE_UP_MS ⇒ 当彻底失败（成片在本机·可再按一次存雲盤）
  const stalled = drv.k === 'streaming' && drv.stalled
  useEffect(() => {
    if (!stalled) return
    const iv = setInterval(() => {
      const up = streamRef.current
      if (!up) return
      if (stallGiveUp({ renderDone: renderDone.current, stalledSince: stalledSince.current, now: Date.now() })) {
        streamRef.current = null; up.cancel(); dispatchDrv({ t: 'up_fail', full: false }); return
      }
      up.retry()
    }, STALL_RETRY_MS)
    return () => clearInterval(iv)
  }, [stalled])
  useEffect(() => {
    const id = drv.k === 'done' ? drv.fileId : null
    setDriveLink(null)
    if (id && drive) void drive.fileUrl(id).then((u) => { if (alive.current) setDriveLink(u) }, () => {})
  }, [drv, drive])
  const savedToDrive = drv.k === 'done' || remote?.phase === 'done'
  useEffect(() => {
    if (!savedToDrive || !drive) { setFolderHref(null); return }
    void drive.folder().then((f) => { if (alive.current) setFolderHref(drive.folderHref(f)) }, () => { if (alive.current) setFolderHref(drive.folderHref(null)) })
  }, [savedToDrive, drive])
  const folderBtn = folderHref && <a href={folderHref} target="_blank" rel="noreferrer" data-testid="vedit-export-drive-folder" className="inline-block mt-1 px-2.5 py-1 rounded-md bg-neutral-800 hover:bg-neutral-700 text-xs text-neutral-200 no-underline">{t('vedit_export_open_folder')}</a>
  const supported = canExportVideo()
  const start = async (withDrive = false) => {
    const ac = new AbortController()
    abortRef.current = ac
    setPhase('run'); setProg(0); setErr(''); setResult(null); dispatchDrv({ t: 'reset' }); renderDone.current = false; stalledSince.current = null; lastUploaded.current = 0
    const sp = exportSpec(alpha)
    const name = exportNameFrom(fileName, title, new Date(), sp.ext)
    let up: ExportStreamUpload | null = null
    // 透明 WebM 要回头写片长与索引 ⇒ 不边编边传：整份编完再整份存雲盤（同「存雲盤」钮那条）
    const wholeAfter = withDrive && !!drive && !!cloud && !sp.streamable
    try {
      if (withDrive && drive && sp.streamable) {
        const folderId = await drive.folder()
        if (ac.signal.aborted) throw Object.assign(new Error('canceled'), { name: 'AbortError' })
        const bound = { durationSec: range.to - range.from, width: size.w, height: size.h, fps, audio: true }
        const u = drive.stream({
          fileName: name, folderId, bound,
          onStatus: (s) => {
            stalledSince.current = nextStalledSince({ prev: stalledSince.current, phase: s.phase, uploaded: s.uploadedBytes, lastUploaded: lastUploaded.current, now: Date.now() })
            lastUploaded.current = Math.max(lastUploaded.current, s.uploadedBytes)
            if (streamRef.current === u) dispatchDrv({ t: 'up_status', phase: s.phase, uploaded: s.uploadedBytes, produced: s.producedBytes })
          },
        })
        up = u
        streamRef.current = u
        dispatchDrv({ t: 'stream_start' })
        // 上传彻底失败 ⇒ 只记下（渲染照跑·uploadFailPolicy('dialog')＝keep_rendering）
        u.done.then((r) => { if (streamRef.current === u) { streamRef.current = null; dispatchDrv({ t: 'up_done', fileId: r.id }) } }, (e: Error) => {
          if (streamRef.current !== u || e.name === 'AbortError') return
          streamRef.current = null
          dispatchDrv({ t: 'up_fail', full: isFullErr(e) })
        })
      }
      const r = await renderVideo(env, { range, w: size.w, h: size.h, fps, signal: ac.signal, onProgress: (p) => setProg(p), ...(up ? { stream: { upload: up, keepLocal: true } } : {}), ...(sp.alpha ? { alpha: true } : {}) })
      renderDone.current = true
      const file = new File([r.blob], name, { type: r.mime })
      // 存雲盤那条：成片留在这台给下载（不自动下载）；纯导出 ⇒ 照旧自动下载
      setResult({ file, audio: r.audio, audioLost: r.audioLost, skipped: r.skipped, downloaded: !up && !wholeAfter, ...(r.noAlphaArea ? { noAlphaArea: true } : {}) })
      setPhase('done')
      if (wholeAfter) toDrive(file)
      else if (!up) downloadBlob(file, file.name)
    } catch (e) {
      if (up) { if (streamRef.current === up) streamRef.current = null; up.cancel(); dispatchDrv({ t: 'render_fail' }) }
      if ((e as Error).name === 'AbortError') { setPhase('idle'); return }
      const code = (e as { code?: string }).code
      setErr(code === 'unsupported' ? t('vedit_export_unsupported') : code === 'alpha_unsupported' ? t('vedit_export_alpha_unsupported') : code === 'encoder_stalled' ? t('vedit_export_stalled') : code === 'audio_unreadable' ? t('vedit_export_audio_unreadable').replace('{list}', (e as { list?: string }).list ?? '') : code === 'video_unreadable' ? t('vedit_export_video_unreadable').replace('{list}', (e as { list?: string }).list ?? '') : String((e as Error).message || e).slice(0, 160))
      setPhase('fail')
    } finally { abortRef.current = null }
  }
  /** 「存雲盤」（纯导出之后·或边传失败后再按一次）：整份传本机那份 */
  const toDrive = (f: File | null = result?.file ?? null) => {
    if (!cloud || !f) return
    dispatchDrv({ t: 'press_drive' })
    const job = cloud.start(f, (p) => dispatchDrv({ t: 'reup_progress', p }))
    upCancel.current = job.cancel
    job.done.then((d) => dispatchDrv({ t: 'reup_done', fileId: d.driveId }), (e: Error & { full?: boolean }) => dispatchDrv(e.name === 'AbortError' ? { t: 'reup_cancel' } : { t: 'reup_fail', full: isFullErr(e) })).finally(() => { upCancel.current = null })
  }
  /** 别台导出：先存工程 ⇒ POST /api/vedit/export（device＝那台）⇒ 每 3 秒问一次状态 */
  const startRemote = async () => {
    if (!drive) return
    remoteStop.current?.()
    const dev = targets.find((o) => o.value === target)
    setRemote({ phase: 'saving', progress: 0, jobId: null, device: dev?.label ?? null, fileId: null, error: null })
    const fail = (msg: string) => { if (alive.current) setRemote((r) => ({ ...(r ?? remoteFromJob({})), phase: 'failed', error: msg })) }
    try {
      const id = await drive.saveProject()
      if (!id) { fail(t('vedit_export_remote_unsaved')); return }
      const folder = await drive.folder().catch(() => null)
      // 只导选中段 ⇒ 带 range／only（那台照范围只画那一段）
      const partBody = part === 'sel' && selRange ? exportPartBody(selRange) : {}
      const sentPart = 'range' in partBody
      const r = await drive.remoteStart({ id, res, fps, device: target, folder_id: folder ?? 'root', ...(alpha ? { alpha: true } : {}), ...partBody })
      const j = r.j
      if (!r.ok) { fail(String(j.message ?? j.error ?? `HTTP ${r.status}`).slice(0, 200)); return }
      // 服务端没回 part ⇒ 旧版不认得范围（会导整条）⇒ 取消任务、白话（⛔ 静默导整条）
      if (remotePartVerdict(sentPart, j) === 'server_old') {
        if (typeof j.job_id === 'string') drive.remoteCancel(j.job_id)
        fail(t('vedit_export_remote_part_server_old')); return
      }
      let view = remoteFromJob(j, { phase: 'queued', progress: 0, jobId: null, device: dev?.label ?? null, fileId: null, error: null })
      if (!alive.current) return
      setRemote(view)
      if (!remoteActive(view) || !view.jobId) return
      const jobId = view.jobId
      let stop = false
      const iv = setInterval(() => {
        void drive.remotePoll(jobId).then((g) => {
          if (stop || !g || !alive.current) return
          view = remoteFromJob(g, view)
          // 那台没照范围导（旧版导出页／run 口）⇒ 成品是整条 ⇒ 白话（服务端读状态时也会把还在跑的判 page_outdated）
          if (remotePartVerdict(sentPart, g) === 'ignored') view = { ...view, phase: 'failed', error: t('vedit_export_remote_part_ignored') }
          setRemote(view)
          if (!remoteActive(view)) remoteStop.current?.()
        }).catch(() => { /* 下一拍再问 */ })
      }, REMOTE_POLL_MS)
      remoteStop.current = () => { stop = true; clearInterval(iv); remoteStop.current = null }
    } catch (e) { fail(String((e as Error).message || e).slice(0, 160)) }
  }
  const cancelRemote = () => {
    const id = remote?.jobId
    remoteStop.current?.()
    setRemote((r) => (r ? { ...r, phase: 'cancelled' } : r))
    if (id && drive) drive.remoteCancel(id)
  }
  const [remoteLink, setRemoteLink] = useState<string | null>(null)
  useEffect(() => {
    setRemoteLink(null)
    const id = remote?.phase === 'done' ? remote.fileId : null
    if (id && drive) void drive.fileUrl(id).then((u) => { if (alive.current) setRemoteLink(u) }, () => {})
  }, [remote?.phase, remote?.fileId, drive]) // eslint-disable-line react-hooks/exhaustive-deps
  const busy = phase === 'run'
  const remoteBusy = remoteActive(remote)
  // 渲染完了上传还在收尾 ⇒ 关弹窗会把上传一起取消 ⇒ 等它传完（或失败）才给关
  const closeLocked = busy || drv.k === 'streaming'
  const mb1 = (n: number) => (n / (1024 * 1024)).toFixed(1)
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 px-4" onClick={() => { if (!closeLocked) onClose() }} data-testid="vedit-export">
      <div className="w-full max-w-md rounded-xl bg-neutral-900 border border-neutral-700 shadow-2xl p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center mb-3">
          <span className="text-base font-semibold text-neutral-100">{t('vedit_export_title')}</span>
          {!closeLocked && <button type="button" onClick={onClose} aria-label={t('vedit_export_close')} className="ml-auto w-7 h-7 rounded-md text-neutral-400 hover:bg-neutral-800">×</button>}
        </div>
        {!supported ? <p className="text-sm text-amber-300" data-testid="vedit-export-unsupported">{t('vedit_export_unsupported')}</p> : end <= 0 ? <p className="text-sm text-neutral-400">{t('vedit_export_empty')}</p> : (
          <>
            {/* 这台／本人在线实体电脑（⛔ 雲電腦）·没在线的 ⇒ 只剩这台 */}
            {drive && (
              <div className="flex items-center gap-2 text-sm text-neutral-300 mb-2">
                <span className="w-16 shrink-0 text-neutral-400">{t('vedit_export_target')}</span>
                <select value={target} disabled={busy || remoteBusy} onFocus={loadTargets} onChange={(e) => { setTarget(e.target.value); setRemote(null) }} data-testid="vedit-export-target" data-n={targets.length}
                  className="flex-1 min-w-0 px-2 py-1 rounded-md border border-neutral-700 bg-neutral-900 text-sm text-neutral-200 disabled:opacity-60">
                  {targets.map((o) => <option key={o.value} value={o.value}>{o.label}{'weak' in o && o.weak ? ` ${t('vedit_export_target_weak')}` : ''}</option>)}
                </select>
              </div>
            )}
            <div className="flex items-center gap-2 text-sm text-neutral-300 mb-2">
              <span className="w-16 shrink-0 text-neutral-400">{t('vedit_export_name')}</span>
              <input type="text" value={fileName} maxLength={120} disabled={busy || !here} onChange={(e) => setFileName(e.target.value)} placeholder={exportNameDefault(title, new Date())}
                data-testid="vedit-export-name" spellCheck={false}
                className="flex-1 min-w-0 px-2 py-1 rounded-md border border-neutral-700 bg-neutral-900 text-sm text-neutral-200 focus:border-cyan-400 outline-none disabled:opacity-60" />
              <span className="shrink-0 text-xs text-neutral-500" data-testid="vedit-export-ext">.{spec.ext}</span>
            </div>
            {!here && <p className="-mt-1 mb-2 pl-[4.5rem] text-xs text-neutral-500" data-testid="vedit-export-name-remote">{t('vedit_export_name_remote')}</p>}
            <div className="flex items-center gap-2 text-sm text-neutral-300 mb-2">
              <span className="w-16 shrink-0 text-neutral-400">{t('vedit_export_res')}</span>
              {EXPORT_RES.map((k) => (
                <button key={k} type="button" disabled={busy} onClick={() => setRes(k)} data-testid={`vedit-export-res-${k}`}
                  className={`px-3 py-1 rounded-md border text-sm ${res === k ? 'border-cyan-400 text-cyan-300 bg-cyan-500/10' : 'border-neutral-700 text-neutral-300 hover:bg-neutral-800'} disabled:opacity-60`}>{resLabel(k)}</button>
              ))}
            </div>
            <div className="flex items-center gap-2 text-sm text-neutral-300 mb-2">
              <span className="w-16 shrink-0 text-neutral-400">{t('vedit_export_fps')}</span>
              {EXPORT_FPS_OPTS.map((k) => (
                <button key={k} type="button" disabled={busy} onClick={() => setFps(k)} data-testid={`vedit-export-fps-${k}`}
                  className={`px-3 py-1 rounded-md border text-sm ${fps === k ? 'border-cyan-400 text-cyan-300 bg-cyan-500/10' : 'border-neutral-700 text-neutral-300 hover:bg-neutral-800'} disabled:opacity-60`}>{k} fps</button>
              ))}
            </div>
            {/* 透明背景：不透明 MP4／透明 WebM（VP9 透明＋Opus）·这台编不了 ⇒ 不给选＋白话 */}
            <div className="flex items-center gap-2 text-sm text-neutral-300 mb-2" data-testid="vedit-export-bg" data-alpha={alpha ? '1' : '0'} data-support={alphaOk ?? ''}>
              <span className="w-16 shrink-0 text-neutral-400">{t('vedit_export_bg')}</span>
              {([false, true] as const).map((k) => (
                <button key={String(k)} type="button" disabled={busy || remoteBusy || (k && !alphaAllowed)} onClick={() => setAlpha(k)} data-testid={`vedit-export-bg-${k ? 'alpha' : 'solid'}`}
                  className={`px-3 py-1 rounded-md border text-sm ${alpha === k ? 'border-cyan-400 text-cyan-300 bg-cyan-500/10' : 'border-neutral-700 text-neutral-300 hover:bg-neutral-800'} disabled:opacity-40`}>{t(k ? 'vedit_export_bg_alpha' : 'vedit_export_bg_solid')}</button>
              ))}
            </div>
            {here && alphaOk !== null && alphaOk !== 'ok' && <p className="-mt-1 mb-2 pl-[4.5rem] text-xs text-neutral-500" data-testid="vedit-export-alpha-unsupported">{t('vedit_export_alpha_unsupported')}</p>}
            {alpha && <p className="-mt-1 mb-2 pl-[4.5rem] text-xs text-neutral-500" data-testid="vedit-export-alpha-note">{t('vedit_export_alpha_note')}</p>}
            <div className="flex items-center gap-2 text-sm text-neutral-300 mb-2">
              <span className="w-16 shrink-0 text-neutral-400">{t('vedit_export_range')}</span>
              {(['all', 'sel'] as const).map((k) => (
                <button key={k} type="button" disabled={busy || remoteBusy || (k === 'sel' && !selRange)} onClick={() => setPart(k)} data-testid={`vedit-export-range-${k}`}
                  className={`px-3 py-1 rounded-md border text-sm ${part === k ? 'border-cyan-400 text-cyan-300 bg-cyan-500/10' : 'border-neutral-700 text-neutral-300 hover:bg-neutral-800'} disabled:opacity-40`}>{t(k === 'all' ? 'vedit_export_range_all' : 'vedit_export_range_sel')}</button>
              ))}
            </div>
            <p className="text-xs text-neutral-500 mb-3" data-testid="vedit-export-size" data-w={size.w} data-h={size.h}>
              {t('vedit_export_size').replace('{w}', String(size.w)).replace('{h}', String(size.h)).replace('{fps}', String(fps)).replace('{dur}', fmtDur(range.to - range.from))}
            </p>
            {busy && (
              <div className="mb-3">
                <div className="h-2 rounded-full bg-white/10 overflow-hidden"><div className="h-full bg-cyan-500 transition-[width]" style={{ width: `${Math.round(prog * 100)}%` }} /></div>
                <div className="mt-1 text-xs text-neutral-400 tabular-nums" data-testid="vedit-export-progress" data-p={prog.toFixed(3)}>{Math.round(prog * 100)}%</div>
              </div>
            )}
            {phase === 'done' && result && (
              <div className="mb-3 text-sm text-neutral-300 space-y-1" data-testid="vedit-export-done" data-size={result.file.size} data-audio={result.audio ? '1' : '0'}>
                <p className="text-emerald-300">{t(result.downloaded ? 'vedit_export_done' : 'vedit_export_done_kept').replace('{name}', result.file.name)}</p>
                {result.audioLost && <p className="text-xs text-neutral-500">{t('vedit_export_no_audio')}</p>}
                {result.skipped > 0 && <p className="text-xs text-amber-300">{t('vedit_export_skipped').replace('{n}', String(result.skipped))}</p>}
                {result.noAlphaArea && <p className="text-xs text-amber-300" data-testid="vedit-export-no-alpha-area">{t('vedit_export_no_alpha_area')}</p>}
              </div>
            )}
            {/*  存雲盤那条（边传／再按一次存雲盤）：渲染中、渲染完都显示 */}
            {(phase === 'run' || phase === 'done') && drv.k !== 'off' && (
              <div className="mb-3 text-xs space-y-1" data-testid="vedit-export-drive-state" data-k={drv.k}>
                {drv.k === 'streaming' && (drv.stalled
                  ? <p className="text-amber-300">{t('vedit_export_drive_stalled')}</p>
                  : <p className="text-neutral-400 tabular-nums">{t('vedit_export_drive_stream').replace('{mb}', mb1(drv.uploaded))}</p>)}
                {drv.k === 'reup' && <p className="text-neutral-400 tabular-nums">{t('vedit_export_drive_busy').replace('{p}', String(Math.round(drv.p * 100)))}</p>}
                {drv.k === 'done' && <p className="text-emerald-300">{t('vedit_export_drive_done')}{driveLink && <> · <a href={driveLink} target="_blank" rel="noreferrer" className="underline" data-testid="vedit-export-drive-link">{t('vedit_export_remote_open')}</a></>}</p>}
                {drv.k === 'done' && folderBtn}
                {drv.k === 'failed' && <p className="text-amber-300" data-testid="vedit-export-drive-fail">{t(drv.full ? 'vedit_up_drive_full' : 'vedit_export_drive_fail')}</p>}
              </div>
            )}
            {/*  别台导出的进度 */}
            {remote && (
              <div className="mb-3 text-sm space-y-1" data-testid="vedit-export-remote" data-phase={remote.phase} data-p={remote.progress}>
                {remote.phase === 'saving' && <p className="text-neutral-400">{t('vedit_export_remote_saving')}</p>}
                {remote.phase === 'queued' && <p className="text-neutral-400">{t('vedit_export_remote_queued').replace('{device}', remote.device ?? '')}</p>}
                {remote.phase === 'running' && (
                  <>
                    <div className="h-2 rounded-full bg-white/10 overflow-hidden"><div className="h-full bg-cyan-500 transition-[width]" style={{ width: `${remote.progress}%` }} /></div>
                    <p className="text-xs text-neutral-400 tabular-nums">{t('vedit_export_remote_running').replace('{device}', remote.device ?? '').replace('{p}', String(Math.round(remote.progress)))}</p>
                  </>
                )}
                {remote.phase === 'done' && <p className="text-emerald-300">{t('vedit_export_remote_done').replace('{device}', remote.device ?? '')}{' '}<a href={remoteLink ?? '/my-drive'} target="_blank" rel="noreferrer" className="underline" data-testid="vedit-export-remote-link">{t(remoteLink ? 'vedit_export_remote_open' : 'vedit_export_remote_drive')}</a></p>}
                {remote.phase === 'done' && folderBtn}
                {remote.phase === 'failed' && <p className="text-amber-300 break-all">{t('vedit_export_remote_fail').replace('{msg}', remote.error ?? '')}</p>}
                {remote.phase === 'cancelled' && <p className="text-neutral-400">{t('vedit_export_remote_cancelled')}</p>}
              </div>
            )}
            {phase === 'fail' && <p className="mb-3 text-sm text-amber-300 break-all" data-testid="vedit-export-fail">{t('vedit_export_fail').replace('{msg}', err)}</p>}
            {/*  另外汇出音频（WAV）、字幕（SRT／VTT／ASS·文字轨上的字）、静帧（播放头那一帧 PNG·照上面选的解析度） */}
            <div className="mb-3 flex flex-wrap items-center gap-2 text-xs" data-testid="vedit-export-side" data-kind={side?.kind ?? ''} data-state={side?.state ?? ''}>
              <span className="w-16 shrink-0 text-neutral-400">{t('vedit_export_other')}</span>
              {(['wav', 'srt', 'vtt', 'ass', 'png'] as const).map((k) => (
                <button key={k} type="button" disabled={busy || side?.state === 'busy'} onClick={() => { void sideOut(k) }} data-testid={`vedit-export-${k}`}
                  className="px-2.5 py-1 rounded-md border border-neutral-700 text-neutral-300 hover:bg-neutral-800 disabled:opacity-50">{t(k === 'wav' ? 'vedit_export_audio' : k === 'png' ? 'vedit_export_still' : k === 'srt' ? 'vedit_export_srt' : k === 'vtt' ? 'vedit_export_vtt' : 'vedit_export_ass')}</button>
              ))}
              {side?.state === 'busy' && <span className="text-neutral-400">{t('vedit_export_side_busy')}</span>}
              {side?.state === 'none' && <span className="text-amber-300">{t(side.kind === 'wav' || side.kind === 'png' ? 'vedit_export_no_sound' : 'vedit_export_no_text')}</span>}
              {side?.state === 'fail' && <span className="text-amber-300" data-testid="vedit-export-side-fail">{side.msg ?? t('vedit_export_side_fail')}</span>}
              {side?.state === 'done' && <span className="text-emerald-300">{t('vedit_export_side_done')}</span>}
            </div>
            <p className="mb-3 text-[11px] leading-relaxed text-neutral-500">{t(!here ? 'vedit_export_remote_note' : alpha ? 'vedit_export_note_alpha' : 'vedit_export_note')}</p>
            <div className="flex items-center justify-end gap-2">
              {busy ? (
                <button type="button" onClick={() => abortRef.current?.abort()} data-testid="vedit-export-cancel" className="px-3 py-1.5 rounded-md bg-neutral-800 hover:bg-neutral-700 text-sm text-neutral-200">{t('vedit_export_cancel')}</button>
              ) : remoteBusy ? (
                <button type="button" onClick={cancelRemote} data-testid="vedit-export-remote-cancel" className="px-3 py-1.5 rounded-md bg-neutral-800 hover:bg-neutral-700 text-sm text-neutral-200">{t('vedit_export_remote_cancel')}</button>
              ) : !here ? (
                <button type="button" onClick={() => { void startRemote() }} data-testid="vedit-export-remote-start" className="px-3 py-1.5 rounded-md bg-cyan-600 hover:bg-cyan-500 text-sm text-white">{t('vedit_export_start')}</button>
              ) : phase === 'done' && result ? (
                <>
                  {cloud && driveButtonShown(drv) && <button type="button" onClick={() => toDrive()}data-testid="vedit-export-drive" className="px-3 py-1.5 rounded-md bg-neutral-800 hover:bg-neutral-700 text-sm text-neutral-200">{t('vedit_export_drive')}</button>}
                  <button type="button" onClick={() => { downloadBlob(result.file, result.file.name); setResult({ ...result, downloaded: true }) }} data-testid="vedit-export-download" className="px-3 py-1.5 rounded-md bg-neutral-800 hover:bg-neutral-700 text-sm text-neutral-200">{t(result.downloaded ? 'vedit_export_download' : 'vedit_export_download_first')}</button>
                  {!closeLocked && <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-md bg-cyan-600 hover:bg-cyan-500 text-sm text-white">{t('vedit_export_close')}</button>}
                </>
              ) : (
                <>
                  {cloud && drive && <button type="button" onClick={() => { void start(true) }} data-testid="vedit-export-start-drive" className="px-3 py-1.5 rounded-md bg-neutral-800 hover:bg-neutral-700 text-sm text-neutral-200">{t('vedit_export_start_drive')}</button>}
                  <button type="button" onClick={() => { void start() }} data-testid="vedit-export-start" className="px-3 py-1.5 rounded-md bg-cyan-600 hover:bg-cyan-500 text-sm text-white">{t('vedit_export_start')}</button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

'use client'
// 网页剪辑页·「编曲」页签与钢琴弹窗（·
// 附华为音悦家截图：上排播放／录音／速度／拍号·中间格子时间轴·下排一排能弹的琴键）。
// 弹窗：滑鼠或电脑键盘弹琴（A 排白键、上一排黑键·Z／X 换八度）；按录音边播边弹 ⇒ 落进格子；格子点空格加音符、拖着拉长、拖音符挪、拖右缘改长短、点一下删；
// 播放／暂停（空白键）、回开头、循环、节拍器、速度、小节数、复原（Ctrl+Z）、清空；「放进轨道」＝离线算成 WAV 交给宿主（宿主放成音频片段）。
// （附音悦家截图）：格子上面是好几条音轨，每条选一种乐器（钢琴／笛子）·不管哪种都用同一排琴键弹·出那条的乐器声；
// 点选哪条 ⇒ 弹的、录的、格子编的都是那条（别条淡淡画在格子里当参考）；按录音 ⇒ 播放头走、录进选中那条；每条有静音／独奏／音量。
// （附音悦家工作室截图）照它的版面：上排 工程名｜走带｜速度·拍号·调号｜节拍器▾（预备拍）｜复原·重做；中间大音轨区（选中那条亮蓝·M／S／音量／录音预备）；
// 下面「编辑器」（钢琴卷帘·可开关·自己一排工具：吸附、量化、关闭）；最底下琴键。调号选了 ⇒ 格子里调外那几行淡掉。
// （点头「音频音轨＋导入一首歌」）：第二排「导入音频」⇒ 歌解成声音、存进本机储存（OPFS·同素材区）、加一条音频音轨画波形；
// 播放／汇出跟音符轨一起放（静音／独奏／音量照样管）；导入的歌比曲子长 ⇒ 小节自动加到放得下（最多 128 小节）。
// （先换钢琴 Salamander 和笛子，再加二胡、古筝（越南筝代）；网页角落附署名）：四种乐器放真录音（vedit-piano-synth loadSamples）·开窗就先载用到的·
// 载着时顶栏标「载入音色中」（载好前弹的照旧是合成音）；弹窗右下角一行音色出处（CC BY 那份连授权页）。
// 编曲内容存本机（VEDIT_ARRANGE_KEY）。值与算法在 _lib/vedit-arrange.pure.ts·发声在 vedit-piano-synth.ts。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStudioT } from '../../shared/StudioT'
import {
  BARS_CHOICES, BASE_DEFAULT, BEATS_PER_BAR, BPM_MAX, BPM_MIN, INSTRUMENTS, KEY_SEMITONE, KEYBOARD_SPAN, MAX_TRACKS, PITCH_HI, PITCH_LO, STEPS_PER_BAR, STEPS_PER_BEAT,
  CLIP_MAX_SEC, KEY_CHOICES, SNAP_CHOICES, addAudioTrack, arrangeSeconds, barsToFit, VEDIT_ARRANGE_KEY, addNote, setClipDrive, stemTracks, trackArrangement, tracksWithDrive, addTrack, inKey, keySigName, parseKeySig, quantizeNotes, snapDown, audibleTracks, exportName, fitBarsAll, instrumentOf, isBlack, keyLabel, moveNote, noteCount, noteName, parseArrangement,
  patchTrack, pitchOfKey, recordNote, removeNote, removeTrack, renderSeconds, resizeNote, selectedTrack, setTrackNotes, shiftBase, stepSec, totalSteps,
  copySeg, moveSeg, nudgeStep, pasteSeg, canMergeSegs, encodeWav, recTarget, layoutPieces, mergedFileName, mergeAudioPieces, mergeParts, mergeSpan, recordTake, piecePlan, piecesOf, removeSegs, segArrangement, segAt, segExportName, segsOf, splitSeg, trimSeg,
  type ArrLang, type ArrTrack, type Arrangement, type InstrumentId, type Note, type RecTake, type SegCopy, type Snap,
} from '../lib/arrange.pure'
import { click, loadSamples, makeBus, renderWav, samplesReady, strike, type Voice } from './piano-synth'
import { readStored, storeLocalOriginal } from '../lib/opfs-cache'
import { stemFileName } from '../lib/group.pure'
import { origName } from '../lib/store.pure'
import { PEAKS_PER_SEC, accumulatePeaks, peaksWindow, waveHeight } from '../lib/timeline.pure'
import type { AsrEnv } from '../lib/asr.pure' // 拆曲模型跟识别字幕同一个下载站（宿主给）
import { SPLIT_MODEL, splitFileNames, splitModelUrl, splitOrtUrl, splitRatio } from '../lib/split.pure'
import { SplitEngine, decodeStereo, splitSong } from './split-client'
import { hasWebGpu } from './asr-client'
import { STEM_NAMES, shellChoices, stemFileNamesFor, type MediaDevice, type StemName } from '../lib/shell-media.pure' // 有壳给壳
import { type VeditShellApi } from '../lib/shell-job'
import type { SongStemsRunner, SongStemsState } from './song-stems'

type TKey = string

const ROW_H = 14
const METRO_KEY = 'dilin.videoEdit.arrange.metro.v1'
const COUNT_IN_KEY = 'dilin.videoEdit.arrange.countIn.v1'
/** 复原栈一笔＝编曲的内容（不含选中哪条音轨）·sameSnap＝没改到东西 */
type HistSnap = Pick<Arrangement, 'tracks' | 'bpm' | 'bars' | 'key'>
const histSnap = (a: Arrangement): HistSnap => ({ tracks: a.tracks, bpm: a.bpm, bars: a.bars, key: a.key })
const sameSnap = (x: HistSnap, y: HistSnap) => x.tracks === y.tracks && x.bpm === y.bpm && x.bars === y.bars && x.key === y.key
const STEP_W = 20
/** 左栏宽：格子左边的音名栏＝音轨头那栏（同宽·上下对齐） */
const KEYS_W = 176
const TRACK_H = 56
const SNAP_LABEL: Record<Snap, 'bf_varr_snap_16' | 'bf_varr_snap_8' | 'bf_varr_snap_beat' | 'bf_varr_snap_bar'> = { 1: 'bf_varr_snap_16', 2: 'bf_varr_snap_8', 4: 'bf_varr_snap_beat', 16: 'bf_varr_snap_bar' }
/** 每种乐器一个颜色（音轨头、格子里的音符、音轨上的小音符） */
const INST_TONE: Record<InstrumentId, { note: string; mini: string; bar: string }> = {
  piano: { note: 'bg-emerald-400 border-emerald-200/70', mini: 'bg-emerald-400', bar: 'bg-emerald-400' },
  flute: { note: 'bg-sky-400 border-sky-200/70', mini: 'bg-sky-400', bar: 'bg-sky-400' },
  erhu: { note: 'bg-rose-400 border-rose-200/70', mini: 'bg-rose-400', bar: 'bg-rose-400' },
  zheng: { note: 'bg-amber-400 border-amber-200/70', mini: 'bg-amber-400', bar: 'bg-amber-400' },
}
/** 音轨上的片段颜色 */
const SEG_TONE: Record<InstrumentId, string> = {
  piano: 'bg-emerald-500/75 border-emerald-200/50', flute: 'bg-sky-500/75 border-sky-200/50', erhu: 'bg-rose-500/75 border-rose-200/50', zheng: 'bg-amber-500/75 border-amber-200/50',
}
/** 裁刀游标 */
const KNIFE_CURSOR = `url("data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round"><circle cx="6" cy="6" r="3" fill="black"/><circle cx="6" cy="18" r="3" fill="black"/><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12"/></svg>')}") 12 12, crosshair`
const KEYS_H_KEY = 'vedit-arrange-keyh'
const KEYS_H_DEFAULT = 144
const LOOKAHEAD = 0.12
// 弹窗挂在 body 上（不在剪辑页里）·网站浅色主题会把 input 字压成深色 ⇒ 深底深字·直接写死字色
const BPM_INK = { color: '#f5f5f5', caretColor: '#f5f5f5' } as const
const uid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `n${Date.now()}-${Math.random().toString(36).slice(2)}`)
type ImportMsg = 'bf_varr_import_fail' | 'bf_varr_import_long' | 'bf_varr_audio_unsaved' | 'vedit_up_drive_full' | 'vedit_up_fail'
/** 解声音（用离线音讯·不用等使用者点一下才能开）：解不开 ⇒ null */
async function decodeAudio(blob: Blob): Promise<AudioBuffer | null> {
  try {
    const C = window.OfflineAudioContext ?? (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext
    if (!C) return null
    return await new C(2, 1, 44100).decodeAudioData(await blob.arrayBuffer())
  } catch { return null }
}
/** 解好的声音 ⇒ 波形峰值表（同剪辑页·每秒 50 格） */
function peaksOf(b: AudioBuffer): Float32Array {
  const p = new Float32Array(Math.ceil(b.duration * PEAKS_PER_SEC) + 1)
  accumulatePeaks(p, b.sampleRate, 0, Array.from({ length: Math.min(2, b.numberOfChannels) }, (_, c) => b.getChannelData(c)))
  return p
}
/** 音频音轨里的波形（画法同剪辑页片段波形·按分贝画·跟着音量变高变矮） */
function ArrWave({ peaks, off = 0, dur, widthPx, gain }: { peaks: Float32Array | undefined; off?: number; dur: number; widthPx: number; gain: number }) {
  const bars = Math.max(1, Math.min(4000, Math.floor(widthPx / 3)))
  const w = peaksWindow(peaks, off, dur, bars)
  if (!w.length) return null
  const d = w.map((p, i) => { const h = Math.max(0.02, waveHeight(p, gain)); return `M${i} ${(0.5 - h / 2).toFixed(3)}h0.7v${h.toFixed(3)}h-0.7z` }).join('')
  return (
    <svg viewBox={`0 0 ${bars} 1`} preserveAspectRatio="none" className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden data-testid="vedit-piano-wave">
      <path d={d} fill="currentColor" />
    </svg>
  )
}

/** 编曲页签的内容区：左清单（乐器 › 钢琴／笛子）｜右边每种乐器一张卡·点开弹窗（选中那种乐器的音轨·没有就加一条） */
// ── 导入的歌上云盘──
// 真上传由剪辑页给（cloud·同汇入素材那套：设定的自动上传开关、上传位置、草稿夹、云盘满了关自动）；
// 进度与取消记在模块里（关掉弹窗、切页签照样传）·传好直接改本机存的编曲（记上云盘编号与网址）再通知开着的弹窗
export type ArrCloud = {
  /** 设定里「本机素材自动上传云盘」开着没 */
  auto: () => boolean
  /** 传一份：onProgress 0～1；失败抛（name='AbortError'＝取消·full=true＝云盘满了） */
  start: (f: File, onProgress: (p: number) => void) => { done: Promise<{ driveId: string; url: string }>; cancel: () => void }
  /** 本机储存没有、云盘有的那首 ⇒ 下载一份进本机储存（取不到 ⇒ null） */
  cache: (file: string, url: string) => Promise<File | null>
}
type UpEvt = { file: string; drive?: { driveId: string; url: string }; msg?: 'vedit_up_drive_full' | 'vedit_up_fail'; name?: string }
const arrUps = new Map<string, { p: number; cancel: () => void }>()
const upSubs = new Set<(e: UpEvt | null) => void>()
const upEmit = (e: UpEvt | null) => { for (const f of upSubs) f(e) }
/** 开传一首（同一个档只传一次）·传好写进本机存的编曲 */
function startArrUpload(cloud: ArrCloud, file: string, blob: Blob, name: string) {
  if (arrUps.has(file)) return
  let job: ReturnType<ArrCloud['start']>
  try { job = cloud.start(blob instanceof File && blob.name === name ? blob : new File([blob], name, { type: blob.type }), (p) => { const u = arrUps.get(file); if (u) { u.p = p; upEmit(null) } }) } catch { upEmit({ file, msg: 'vedit_up_fail', name }); return }
  arrUps.set(file, { p: 0, cancel: job.cancel })
  upEmit(null)
  job.done.then((drive) => {
    arrUps.delete(file)
    try {
      const a = parseArrangement(window.localStorage.getItem(VEDIT_ARRANGE_KEY))
      const n = setClipDrive(a, file, drive)
      if (n !== a) window.localStorage.setItem(VEDIT_ARRANGE_KEY, JSON.stringify(n))
    } catch { /* 存不了就靠开着的弹窗那份 */ }
    upEmit({ file, drive })
  }, (e: { name?: string; full?: boolean }) => {
    arrUps.delete(file)
    upEmit(e?.name === 'AbortError' ? null : { file, msg: e?.full ? 'vedit_up_drive_full' : 'vedit_up_fail', name })
  })
}
/** 订阅上传进度（重画用）·cb 收传好／失败的事件 */
function useArrUps(cb?: (e: UpEvt) => void) {
  const [, tick] = useState(0)
  const cbRef = useRef(cb); cbRef.current = cb
  useEffect(() => {
    const f = (e: UpEvt | null) => { tick((n) => n + 1); if (e) cbRef.current?.(e) }
    upSubs.add(f)
    return () => { upSubs.delete(f) }
  }, [])
  return arrUps
}

/** 左栏分组的箭头（照特效页·展开＝朝上） */
function ArrChevron({ up }: { up: boolean }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={`w-3.5 h-3.5 shrink-0 transition-transform ${up ? 'rotate-180' : ''}`} aria-hidden>
      <path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
    </svg>
  )
}
/** 左栏两组的展开状态记在这台浏览器 */
const ARR_SIDE_KEY = 'vedit-arrange-side-v1'

/** 「有壳就AI分轨」：各台终端报的能力＋传云盘（结果夹同一个） */
export type ArrShell = { devices: MediaDevice[] | null; put: (f: File, onP: (p: number) => void) => Promise<{ fileId: string; folderId: string | null }>; api: VeditShellApi
  /** 拆曲交终端那条由剪辑页拿着（切分页照跑·回来接得上） */
  stems: { runner: SongStemsRunner; state: SongStemsState } }
/** asr＝拆曲模型从哪下；creditUrl＝音色授权全文网址（宿主给·没有 ⇒ 只写授权名） */
export default function VeditArrangePane({ lang, onExport, onAddMedia, cloud, shell, asr, creditUrl }: { lang: ArrLang; onExport: (f: File) => Promise<void> | void; onAddMedia?: (f: File, stems?: File[]) => Promise<void> | void; cloud?: ArrCloud; shell?: ArrShell; asr: AsrEnv; creditUrl?: string }) {
  const t = useStudioT()
  const [open, setOpen] = useState(false)
  const [arr, setArrRaw] = useState<Arrangement>(() => {
    try { return parseArrangement(typeof window === 'undefined' ? null : window.localStorage.getItem(VEDIT_ARRANGE_KEY)) } catch { return parseArrangement(null) }
  })
  const setArr = useCallback((a: Arrangement) => {
    setArrRaw(a)
    try { window.localStorage.setItem(VEDIT_ARRANGE_KEY, JSON.stringify(a)) } catch { /* 存不了就只在这页 */ }
  }, [])
  // 导入的歌传好了 ⇒ 这份编曲也记上云盘编号（本机存的那份上传模块已经改过）
  useArrUps((e) => { const d = e.drive; if (d) setArrRaw((a) => setClipDrive(a, e.file, d)) })
  const openWith = (inst: InstrumentId) => {
    const hit = arr.tracks.find((x) => x.inst === inst)
    setArr(hit ? { ...arr, sel: hit.id } : addTrack(arr, inst, uid()))
    setOpen(true)
  }
  const total = noteCount(arr)
  // 左栏两组（樂器／拆曲）照特效页那样可折叠·右边照选的那组换内容
  const [side, setSideRaw] = useState<{ view: 'inst' | 'split'; inst: boolean; split: boolean }>(() => {
    try { const s = JSON.parse(window.localStorage.getItem(ARR_SIDE_KEY) || 'null'); if (s && typeof s === 'object') return { view: s.view === 'split' ? 'split' : 'inst', inst: s.inst !== false, split: s.split !== false } } catch { /* 读不到照缺省 */ }
    return { view: 'inst', inst: true, split: true }
  })
  const setSide = (f: (s: typeof side) => typeof side) => setSideRaw((s) => { const n = f(s); try { window.localStorage.setItem(ARR_SIDE_KEY, JSON.stringify(n)) } catch { /* 存不了就这次 */ } return n })
  const groupCls = (active: boolean) => `flex items-center gap-1 px-2 py-1.5 rounded text-left bg-neutral-800 hover:bg-neutral-700 ${active ? 'text-cyan-400' : 'text-neutral-300 hover:text-neutral-100'}`
  return (
    <div className="flex-1 min-h-0 flex" data-testid="vedit-arrange-pane">
      <div className="w-28 shrink-0 border-r border-neutral-800 p-1.5 flex flex-col gap-1 text-xs overflow-y-auto" data-testid="vedit-arrange-side">
        <button type="button" aria-expanded={side.inst} onClick={() => setSide((s) => ({ ...s, inst: !s.inst, view: 'inst' }))} className={groupCls(side.view === 'inst')} data-testid="vedit-arrange-group-inst">
          <span className="flex-1 min-w-0 truncate">{t('bf_varr_cat')}</span><ArrChevron up={side.inst} />
        </button>
        {side.inst && INSTRUMENTS.map((ins) => (
          <button key={ins.id} type="button" onClick={() => { setSide((s) => ({ ...s, view: 'inst' })); openWith(ins.id) }} className="text-left px-2 py-1 rounded hover:bg-neutral-800 text-neutral-300" data-testid={`vedit-arrange-cat-${ins.id}`}>{t(ins.label)}</button>
        ))}
        <button type="button" aria-expanded={side.split} onClick={() => setSide((s) => ({ ...s, split: !s.split, view: 'split' }))} className={groupCls(side.view === 'split')} data-testid="vedit-arrange-group-split">
          <span className="flex-1 min-w-0 truncate">{t('bf_varr_split')}</span><ArrChevron up={side.split} />
        </button>
        {side.split && (
          <button type="button" onClick={() => setSide((s) => ({ ...s, view: 'split' }))} className={`text-left px-2 py-1 rounded hover:bg-neutral-800 ${side.view === 'split' ? 'text-cyan-400' : 'text-neutral-300'}`} data-testid="vedit-arrange-cat-split-vocal">{t('bf_varr_split_vocal')}</button>
        )}
      </div>
      {side.view === 'split' ? <SplitPane onAddMedia={onAddMedia} shell={shell} asr={asr} /> : (
      <div className="flex-1 min-w-0 p-3 overflow-y-auto flex flex-wrap content-start gap-3">
        {INSTRUMENTS.map((ins) => {
          const n = arr.tracks.filter((x) => x.inst === ins.id).reduce((s, x) => s + x.notes.length, 0)
          return (
            <button key={ins.id} type="button" onClick={() => openWith(ins.id)} data-testid={`vedit-arrange-${ins.id}`} title={t('bf_varr_hint')}
              className="w-32 rounded-lg bg-neutral-800 hover:bg-neutral-700 overflow-hidden text-left">
              <div className="h-20 flex items-end justify-center gap-px bg-gradient-to-b from-indigo-950 to-neutral-900 px-2 pb-2" aria-hidden>
                {ins.id === 'erhu'
                  ? <div className="relative mb-1 w-16 h-16" data-testid="vedit-arrange-art-erhu"><span className="absolute left-7 top-0 w-1 h-16 rounded bg-amber-700" /><span className="absolute left-5 bottom-0 w-5 h-4 rounded bg-amber-900" /><span className="absolute left-0 top-9 w-16 h-0.5 bg-neutral-200 -rotate-12" /></div>
                  : ins.id === 'zheng'
                  ? <div className="relative mb-3 w-24 h-7 rounded-md bg-gradient-to-r from-amber-700 to-amber-500 -rotate-6" data-testid="vedit-arrange-art-zheng">{[0, 1, 2, 3, 4, 5, 6].map((k) => <span key={k} className="absolute left-1 right-1 h-px bg-neutral-100/80" style={{ top: 3 + k * 3 }} />)}</div>
                  : ins.id === 'flute'
                  ? <div className="relative mb-4 w-24 h-3 rounded-full bg-gradient-to-r from-amber-200 to-amber-400 -rotate-12">{[0, 1, 2, 3, 4, 5].map((k) => <span key={k} className="absolute top-1 w-1.5 h-1.5 rounded-full bg-neutral-800" style={{ left: 30 + k * 10 }} />)}</div>
                  : Array.from({ length: 8 }, (_, i) => (
                    <div key={i} className="relative w-3 h-12 rounded-b-sm bg-neutral-100">{[0, 1, 3, 4, 5].includes(i) && <div className="absolute -right-1 top-0 w-2 h-7 rounded-b-sm bg-neutral-900 z-10" />}</div>
                  ))}
              </div>
              <div className="px-2 py-1.5 text-xs text-neutral-100">{t(ins.label)}{n ? <span className="ml-1 text-[10px] text-cyan-400">♪{n}</span> : null}</div>
            </button>
          )
        })}
        <p className="basis-full text-[11px] text-neutral-500 leading-relaxed max-w-xs">{t('bf_varr_hint')}</p>
      </div>
      )}
      {open && <PianoStudio lang={lang} arr={arr} setArr={setArr} onClose={() => setOpen(false)} onExport={onExport} onAddMedia={onAddMedia} cloud={cloud} creditUrl={creditUrl} />}
    </div>
  )
}

/** 拆曲只出人声、纯伴奏两轨。
 * 选「直接在网页里拆…两个都做：有壳走壳，没壳走网页（先做网页那条）」⇒ 这里是网页那条：模型在这台浏览器跑（vedit-split-client）·
 * 拆好原曲＋人声＋纯伴奏走 onAddMedia 进素材区成一组（拖上轨道＝两条分开的音轨·同编曲素材）。壳那条候接通道 */
type SplitPhase = { kind: 'idle' } | { kind: 'model'; loaded: number; total: number } | { kind: 'run'; done: number; of: number } | { kind: 'done' } | { kind: 'err'; msg: string }
const STEM_LABEL: Record<StemName, TKey> = { vocals: 'bf_varr_split_vocals', drums: 'vedit_stem_drums', bass: 'vedit_stem_bass', guitar: 'vedit_stem_guitar', piano: 'vedit_stem_piano', other: 'vedit_stem_other' }
function SplitPane({ onAddMedia, shell, asr }: { onAddMedia?: (f: File, stems?: File[]) => Promise<void> | void; shell?: ArrShell; asr: AsrEnv }) {
  const t = useStudioT()
  const fileRef = useRef<HTMLInputElement>(null)
  const [song, setSong] = useState<File | null>(null)
  const [phase, setPhase] = useState<SplitPhase>({ kind: 'idle' })
  const [gpu, setGpu] = useState<boolean | null>(null)
  const engineRef = useRef<SplitEngine | null>(null)
  const stopRef = useRef(false)
  const modelUrl = splitModelUrl(asr.modelHost)
  useEffect(() => { let on = true; void hasWebGpu().then((g) => { if (on) setGpu(g) }); return () => { on = false; engineRef.current?.dispose(); engineRef.current = null } }, [])
  const busy = phase.kind === 'model' || phase.kind === 'run'
  const go = async () => {
    if (!song || !modelUrl || !onAddMedia || busy) return
    stopRef.current = false
    setPhase({ kind: 'model', loaded: 0, total: 0 })
    try {
      const eng = engineRef.current ?? (engineRef.current = new SplitEngine(splitOrtUrl(asr.npmBase), modelUrl, (loaded, total) => setPhase({ kind: 'model', loaded, total })))
      const [[L, R]] = await Promise.all([decodeStereo(song), eng.load()])
      if (stopRef.current) throw new Error('cancelled')
      const r0 = await splitSong(eng, L, R, { onStep: (done, of) => setPhase({ kind: 'run', done, of }), cancelled: () => stopRef.current })
      const names = splitFileNames(song.name, { vocals: t('bf_varr_split_vocals'), inst: t('bf_varr_split_inst') })
      const base = names.inst.slice(0, -`-${t('bf_varr_split_inst')}.wav`.length)
      const r = {
        mix: song.type.startsWith('audio/') ? song : new File([encodeWav([L, R], 44100) as BlobPart], `${base}.wav`, { type: 'audio/wav' }),
        vocals: new File([r0.vocals as BlobPart], names.vocals, { type: 'audio/wav' }),
        inst: new File([r0.inst as BlobPart], names.inst, { type: 'audio/wav' }),
      }
      await onAddMedia(r.mix, [r.vocals, r.inst])
      setPhase({ kind: 'done' })
    } catch (e) {
      const msg = (e as Error)?.message || String(e)
      if (msg === 'cancelled') { setPhase({ kind: 'idle' }); return }
      engineRef.current?.dispose(); engineRef.current = null
      setPhase({ kind: 'err', msg: msg.slice(0, 120) })
    }
  }
  const cancel = () => { stopRef.current = true; engineRef.current?.dispose(); engineRef.current = null; setPhase({ kind: 'idle' }) }
  // 有壳给壳：交给那台终端用 htdemucs_6s 拆成六轨（人声、鼓、贝斯、吉他、钢琴、其他）·原曲＋六轨进素材区成一组（同网页那条）
  //   那趟由剪辑页拿着（song-stems.ts）：这块面板关掉（切去别的分页）⛔ 取消·回来照样显示进度与结果
  const shellPh = shell?.stems.state.phase ?? null
  const shellMsg = shell?.stems.state.msg ?? null
  const goShell = (dev: MediaDevice) => {
    if (!song || !shell || !onAddMedia || shellPh) return
    setPhase({ kind: 'idle' })
    const labels = Object.fromEntries(STEM_NAMES.map((k) => [k, t(STEM_LABEL[k])])) as Record<StemName, string>
    // 影片档先抽成立体声 WAV（壳那头只收声音）
    const mix = async () => (song.type.startsWith('audio/') ? song : await (async () => { const [L, R] = await decodeStereo(song); return new File([encodeWav([L, R], 44100) as BlobPart], `${song.name.replace(/\.[^.]+$/, '') || 'song'}.wav`, { type: 'audio/wav' }) })())
    void shell.stems.runner.start(dev, song, { mix, names: stemFileNamesFor(song.name, labels) })
  }
  const cancelShell = () => shell?.stems.runner.cancel()
  const hasShell = !!shell?.devices && shellChoices(shell.devices, 'stems').length > 0
  const pct = busy ? Math.round(splitRatio(phase) * 100) : 0
  const mb = Math.round(SPLIT_MODEL.bytes / 1e6)
  return (
    <div className="flex-1 min-w-0 p-3 overflow-y-auto flex flex-col gap-3" data-testid="vedit-arrange-split">
      <div className="w-64 rounded-lg bg-neutral-800 overflow-hidden">
        <div className="h-20 flex items-center justify-center gap-3 bg-gradient-to-b from-indigo-950 to-neutral-900" aria-hidden>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="w-9 h-9 text-pink-300"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
          <span className="text-neutral-500 text-lg">＋</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="w-9 h-9 text-cyan-300"><path d="M9 18V5l11-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="17" cy="16" r="3" /></svg>
        </div>
        <div className="px-2 py-1.5 text-xs text-neutral-100">{t('bf_varr_split_vocal')}</div>
      </div>
      <p className="text-[11px] text-neutral-500 leading-relaxed max-w-xs">{t('bf_varr_split_hint')}</p>
      {!modelUrl ? <p className="text-[11px] text-amber-300 max-w-xs" data-testid="vedit-arrange-split-nomodel">{t('bf_varr_split_nomodel')}</p> : (
        <>
          <p className="text-[11px] text-neutral-500 max-w-xs">{t('bf_varr_split_first').replace('{mb}', String(mb))}</p>
          {gpu === false && <p className="text-[11px] text-amber-300 max-w-xs" data-testid="vedit-arrange-split-slow">{t('bf_varr_split_slow')}</p>}
        </>
      )}
      <input ref={fileRef} type="file" accept="audio/*,video/*" className="hidden" data-testid="vedit-arrange-split-file" onChange={(e) => { setSong(e.target.files?.[0] ?? null); setPhase({ kind: 'idle' }); e.target.value = '' }} />
      <div className="flex items-center gap-2 flex-wrap">
        <button type="button" disabled={busy || !!shellPh} onClick={() => fileRef.current?.click()} className="px-3 py-1.5 rounded-md bg-neutral-700 hover:bg-neutral-600 disabled:opacity-50 text-xs text-neutral-100" data-testid="vedit-arrange-split-pick">{t('bf_varr_split_pick')}</button>
        {song && <span className="text-xs text-neutral-300 truncate max-w-[16rem]" data-testid="vedit-arrange-split-song">{song.name}</span>}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <button type="button" disabled={!song || !modelUrl || !onAddMedia || busy || !!shellPh} onClick={() => void go()} className="px-3 py-1.5 rounded-md bg-cyan-700 hover:bg-cyan-600 disabled:bg-cyan-700/40 disabled:text-neutral-400 disabled:cursor-not-allowed text-xs text-white" data-testid="vedit-arrange-split-go">{t('bf_varr_split_go')}</button>
        {busy && <button type="button" onClick={cancel} className="px-3 py-1.5 rounded-md bg-neutral-700 hover:bg-neutral-600 text-xs text-neutral-100" data-testid="vedit-arrange-split-cancel">{t('bf_varr_split_cancel')}</button>}
      </div>
      {busy && (
        <div className="w-64 flex flex-col gap-1" role="status" data-testid="vedit-arrange-split-progress" data-p={pct}>
          <div className="h-1.5 rounded bg-neutral-800 overflow-hidden"><div className="h-full bg-cyan-500 transition-[width]" style={{ width: `${pct}%` }} /></div>
          <span className="text-[11px] text-neutral-400">{t(phase.kind === 'model' ? 'bf_varr_split_loading' : 'bf_varr_split_running').replace('{p}', String(pct))}</span>
        </div>
      )}
      {hasShell && shell && shell.api.renderPicker({ kind: 'stems', devices: shell.devices, phase: shellPh, disabled: !song || !onAddMedia || busy, onRun: (d) => void goShell(d), onCancel: cancelShell })}
      {shellMsg && <p className={`text-[11px] max-w-xs break-words ${shellMsg.ok ? 'text-emerald-400' : 'text-red-400'}`} role="status" data-testid="vedit-arrange-split-shell-msg">{shellMsg.text}</p>}
      {phase.kind === 'done' && <p className="text-[11px] text-emerald-400" role="status" data-testid="vedit-arrange-split-done">{t('bf_varr_split_done')}</p>}
      {phase.kind === 'err' && <p className="text-[11px] text-red-400 max-w-xs break-words" role="alert" data-testid="vedit-arrange-split-err">{t('bf_varr_split_fail').replace('{msg}', phase.msg)}</p>}
      {/* 模型出自 UVR：其 README 要求用其模型须给 UVR 与其开发者署名 */}
      <p className="text-[10px] text-neutral-600 max-w-xs" data-testid="vedit-arrange-split-credit">{t('bf_varr_split_credit')}</p>
    </div>
  )
}

type Drag = { mode: 'new' | 'move' | 'size'; id: string; p0: number; s0: number; grabStep: number; grabPitch: number; moved: boolean; base: readonly Note[] }

function PianoStudio({ lang, arr, setArr, onClose, onExport, onAddMedia, cloud, creditUrl }: { lang: ArrLang; arr: Arrangement; setArr: (a: Arrangement) => void; onClose: () => void; onExport: (f: File) => Promise<void> | void; onAddMedia?: (f: File, stems?: File[]) => Promise<void> | void; cloud?: ArrCloud; creditUrl?: string }) {
  const t = useStudioT()
  const total = totalSteps(arr)
  const st = stepSec(arr.bpm)
  const [playing, setPlaying] = useState(false)
  const [rec, setRec] = useState(false)
  // 录音模式（按过录音、还没按左边方块）⇒ 左钮变方块＝全停；
  // 中间＝暂停播放与录音（再点接着播、接着录同一段）；右钮＝录着时停录音继续播、停着录音时从播放头另起一段接着录
  const [session, setSession] = useState(false)
  const sessionRef = useRef(false); sessionRef.current = session
  const pausedRec = useRef(false)
  const [loop, setLoop] = useState(true)
  // 缺省开着·开关记在这台浏览器（节拍器只进喇叭·不进录音、不进汇出）
  const [metro, setMetroRaw] = useState(() => { try { return window.localStorage.getItem(METRO_KEY) !== '0' } catch { return true } })
  const setMetro = (f: boolean | ((v: boolean) => boolean)) => setMetroRaw((v) => { const n = typeof f === 'function' ? f(v) : f; try { window.localStorage.setItem(METRO_KEY, n ? '1' : '0') } catch { /* 存不了就这次 */ } return n })
  // 预备拍缺省关（按录音就开录）·▾ 里还能勾回来·记在这台浏览器
  const [countIn, setCountInRaw] = useState(() => { try { return window.localStorage.getItem(COUNT_IN_KEY) === '1' } catch { return false } })
  const setCountIn = (v: boolean) => { setCountInRaw(v); try { window.localStorage.setItem(COUNT_IN_KEY, v ? '1' : '0') } catch { /* 存不了就这次 */ } }
  const [metroMenu, setMetroMenu] = useState(false)
  const popRef = useRef(false)
  // 音符格编辑器缺省收起（音轨区撑满）·右上「编辑器」钮还能打开
  const [editorOpen, setEditorOpen] = useState(false)
  const [snap, setSnap] = useState<Snap>(1)
  const future = useRef<HistSnap[]>([])
  const tracksRef = useRef<HTMLDivElement>(null)
  const syncing = useRef(false)
  const [pos, setPos] = useState(0) // 格（可带小数）
  const [base, setBase] = useState(BASE_DEFAULT)
  const [down, setDown] = useState<ReadonlySet<number>>(new Set())
  const [busy, setBusy] = useState(false)
  const [noAudio, setNoAudio] = useState(false)
  const lastLen = useRef(2)
  // 复原栈记整份（音轨＋速度＋小节＋调号·不含选中哪条）·换乐器／静音／独奏／音量／删轨／速度／调号也记
  const hist = useRef<HistSnap[]>([])
  const arrRef = useRef(arr); arrRef.current = arr
  const ctxRef = useRef<AudioContext | null>(null)
  const busRef = useRef<AudioNode | null>(null)
  const live = useRef(new Map<string, { voice: Voice; p: number; songT0: number; ctxT0: number }>())
  const tp = useRef<{ anchor: number; step0: number; pre: number; k: number; timer: number; raf: number } | null>(null)
  const flags = useRef({ playing, rec, loop, metro, snap }); flags.current = { playing, rec, loop, metro, snap }
  const gridRef = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)
  // ── 音频音轨：解好的声音按档编号放记忆体·波形峰值表·正在放的声音源·每条音频音轨一个音量钮 ──
  const bufs = useRef(new Map<string, AudioBuffer>())
  const asked = useRef(new Set<string>())
  const [peaks, setPeaks] = useState<Record<string, Float32Array>>({})
  const [missing, setMissing] = useState<ReadonlySet<string>>(new Set())
  const [fetching, setFetching] = useState<ReadonlySet<string>>(new Set())
  // 上云盘：进度圈点开的那条（confirm＝在问要不要取消）·传好补记进复原栈里的旧版（复原回去也不丢云盘编号）
  const [upPop, setUpPop] = useState<{ file: string; confirm: boolean } | null>(null)
  const ups = useArrUps((e) => {
    const d = e.drive
    if (d) { hist.current = hist.current.map((x) => ({ ...x, tracks: tracksWithDrive(x.tracks, e.file, d) })); future.current = future.current.map((x) => ({ ...x, tracks: tracksWithDrive(x.tracks, e.file, d) })); setUpPop((u) => (u?.file === e.file ? null : u)); return }
    if (e.msg) setImportMsg(e.msg)
    if (e.name) setUpFailName(e.name)
  })
  const [upFailName, setUpFailName] = useState('')
  /** ☁ 手动传（自动上传关着、取消过、或上次失败）：从本机储存读那首歌 */
  const uploadClip = async (c: { file: string; name: string }) => {
    if (!cloud || arrUps.has(c.file)) return
    const f = await readStored(origName(c.file))
    if (!f) { setUpFailName(c.name); setImportMsg('vedit_up_fail'); return }
    startArrUpload(cloud, c.file, f, c.name)
  }
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState<ImportMsg | null>(null)
  const fileIn = useRef<HTMLInputElement>(null)
  const srcs = useRef(new Set<AudioBufferSourceNode>())
  const clipGain = useRef(new Map<string, GainNode>())
  // ── 片段：选中哪一段·裁刀·右键选单·剪贴簿·拖段 ──
  const [selSeg, setSelSeg] = useState<{ track: string; id: string } | null>(null)
  const selSegRef = useRef(selSeg); selSegRef.current = selSeg
  // Ctrl／⌘／Shift＋点同一条轨上别的段 ⇒ 加进选取（anchor＝那时选中的那段·选中换了就作废）
  const [multi, setMulti] = useState<{ track: string; anchor: string; ids: string[] } | null>(null)
  const selIds = (s: { track: string; id: string } | null = selSeg): string[] => (!s ? [] : multi && multi.track === s.track && multi.anchor === s.id ? [s.id, ...multi.ids.filter((x) => x !== s.id)] : [s.id])
  const selIdsRef = useRef(selIds); selIdsRef.current = selIds
  /** 一趟录音：按一次录音钮起一趟·这趟录进来的音符自成一段 */
  const takeRef = useRef<(RecTake & { ids: Set<string> }) | null>(null)
  const [knife, setKnife] = useState(false)
  const knifeRef = useRef(knife); knifeRef.current = knife
  const [menu, setMenu] = useState<{ x: number; y: number; track: string; id: string } | null>(null)
  const menuRef = useRef(menu); menuRef.current = menu
  const segClip = useRef<{ c: SegCopy; track: string } | null>(null)
  const [hasClip, setHasClip] = useState(false)
  const [segMsg, setSegMsg] = useState<'bf_varr_seg_added' | 'bf_varr_seg_no_room' | 'bf_varr_seg_empty' | 'bf_varr_merge_fail' | null>(null)
  useEffect(() => { if (!segMsg) return; const k = window.setTimeout(() => setSegMsg(null), 3000); return () => window.clearTimeout(k) }, [segMsg])
  const segDrag = useRef<{ mode: 'move' | 'l' | 'r'; track: string; id: string; x0: number; s0: number; base: Arrangement; moved: boolean } | null>(null)
  // 预备拍倒数：4、3、2、1
  const [countdown, setCountdown] = useState(0)
  const cdRef = useRef(0)
  // 音轨区／琴键之间的横条：琴键高度存本机；编辑器开着时上面那条调音轨区高度
  const [keyH, setKeyH] = useState(() => { try { const v = Number(window.localStorage.getItem(KEYS_H_KEY)); return v >= 80 && v <= 400 ? v : KEYS_H_DEFAULT } catch { return KEYS_H_DEFAULT } })
  const [tracksH, setTracksH] = useState<number | null>(null)

  const ensure = useCallback((): AudioContext | null => {
    if (ctxRef.current) { void ctxRef.current.resume().catch(() => {}); return ctxRef.current }
    try {
      const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!C) { setNoAudio(true); return null }
      const c = new C()
      ctxRef.current = c; busRef.current = makeBus(c)
      return c
    } catch { setNoAudio(true); return null }
  }, [])

  // 开窗（或复原回来一条音频音轨）⇒ 从本机储存读回那段声音解好；读不到 ⇒ 那条标「找不到」
  useEffect(() => {
    for (const tr of arr.tracks) {
      const c = tr.audio
      if (!c || asked.current.has(c.file)) continue
      asked.current.add(c.file)
      void (async () => {
        let f = await readStored(origName(c.file))
        // 本机没有（换了电脑／清过浏览器）但传过云盘 ⇒ 从云盘拉回来（顺手存一份进本机）
        if (!f && c.url && cloud) { setFetching((s) => new Set(s).add(c.file)); f = await cloud.cache(c.file, c.url); setFetching((s) => { const n = new Set(s); n.delete(c.file); return n }) }
        const b = f ? await decodeAudio(f) : null
        if (!b) { setMissing((m) => new Set(m).add(c.file)); return }
        bufs.current.set(c.file, b)
        setPeaks((p) => ({ ...p, [c.file]: peaksOf(b) }))
      })()
    }
  }, [arr.tracks])
  /** 每条音频音轨的音量（静音／独奏／音量）·播放中每一帧对一次 ⇒ 播着改也马上听得到 */
  const mixClips = useCallback((a: Arrangement) => {
    const on = new Set(audibleTracks(a).map((x) => x.id))
    for (const [id, g] of clipGain.current) { const tr = a.tracks.find((x) => x.id === id); g.gain.value = tr && on.has(id) ? tr.vol : 0 }
  }, [])
  /** 曲子第 s 格在 at 时刻响 ⇒ 每条音频音轨从对应的地方开始放（放到曲尾为止） */
  const startClips = useCallback((c: AudioContext, a: Arrangement, s: number, at: number) => {
    const s1 = stepSec(a.bpm), end = arrangeSeconds(a)
    for (const tr of a.tracks) {
      const b = tr.audio ? bufs.current.get(tr.audio.file) : undefined
      if (!b) continue
      for (const pc of piecesOf(tr)) { // 音频轨剪成好几段 ⇒ 一段一段放
        const plan = piecePlan(pc, s * s1, end)
        if (!plan) continue
        let g = clipGain.current.get(tr.id)
        if (!g) { g = c.createGain(); g.connect(c.destination); clipGain.current.set(tr.id, g) }
        const src = c.createBufferSource()
        src.buffer = b; src.connect(g)
        src.onended = () => { srcs.current.delete(src) }
        src.start(at + plan.delay, plan.offset, plan.len)
        srcs.current.add(src)
      }
    }
    mixClips(a)
  }, [mixClips])
  const stopClips = () => { for (const s of srcs.current) { try { s.stop() } catch { /* 还没开始或已停 */ } } srcs.current.clear() }

  // 选中的那条音轨（弹、录、编都是它）
  const cur = selectedTrack(arr)
  const curNotes = () => selectedTrack(arrRef.current).notes
  /** 复原栈记整组音轨（删音轨也退得回来） */
  const pushHist = useCallback(() => { const s = histSnap(arrRef.current), last = hist.current[hist.current.length - 1]; if (!last || !sameSnap(last, s)) hist.current = [...hist.current, s].slice(-100); future.current = [] }, [])
  const commit = useCallback((notes: readonly Note[], from: readonly Note[] = selectedTrack(arrRef.current).notes) => {
    if (notes === from) return
    pushHist()
    const a = arrRef.current
    setArr(setTrackNotes(a, selectedTrack(a).id, notes))
  }, [setArr, pushHist])
  const setNotesLive = useCallback((notes: readonly Note[]) => { const a = arrRef.current; setArr(setTrackNotes(a, selectedTrack(a).id, notes)) }, [setArr])
  const undo = useCallback(() => {
    const a = arrRef.current, cur = histSnap(a)
    let prev = hist.current.pop()
    while (prev && sameSnap(prev, cur)) prev = hist.current.pop() // 没改到东西的那几笔跳过（免得按了像没反应）
    if (prev) { future.current = [...future.current, cur]; setArr({ ...a, ...prev, sel: prev.tracks.some((x) => x.id === a.sel) ? a.sel : prev.tracks[0].id }) }
  }, [setArr])
  /** 重做（音悦家上排 ↷）：复原过的再做回来；有新改动 ⇒ 清掉 */
  const redo = useCallback(() => {
    const nx = future.current.pop()
    if (nx) { const a = arrRef.current; hist.current = [...hist.current, histSnap(a)].slice(-100); setArr({ ...a, ...nx, sel: nx.tracks.some((x) => x.id === a.sel) ? a.sel : nx.tracks[0].id }) }
  }, [setArr])
  const selectTrack = (id: string) => { if (id !== arrRef.current.sel) setArr({ ...arrRef.current, sel: id }) }
  const editTrack = (a: Arrangement, withHist = false) => { if (a === arrRef.current) return; if (withHist) pushHist(); setArr(a) }

  // ── 走带：排程（往前看 0.12 秒把要响的音排进去）＋播放头（每帧读音讯时钟） ──
  const songPos = useCallback((): number => {
    const c = ctxRef.current, t = tp.current
    if (!c || !t) return pos
    const a = arrRef.current
    // 预备拍＝播放头不动·先空打 pre 格（只有节拍器）·打完才从 step0 走；预备拍里回负数（录音不落）
    const virt = (c.currentTime - t.anchor) / stepSec(a.bpm) - t.pre
    if (virt < 0) return virt
    const raw = t.step0 + virt
    const tot = totalSteps(a)
    return flags.current.loop ? ((raw % tot) + tot) % tot : raw
  }, [pos])
  /** 录音停下（停播、再按录音钮、录音中改速度重起）⇒ 这趟那段收在停下那一格（不对齐小节）；这趟没录到音 ⇒ 不留段 */
  const endTake = useCallback((at: number) => {
    const tk = takeRef.current, a = arrRef.current
    const tr = tk && tk.ids.size ? a.tracks.find((x) => x.id === tk.track) : undefined
    if (!tk || !tr) return
    tk.to = at >= tk.from ? at : totalSteps(a) // 循环绕回开头 ⇒ 录到曲尾
    const recorded = recordTake(a, tr.notes, tk)
    arrRef.current = recorded; setArr(recorded)
  }, [setArr])
  const stop = useCallback((rewind = false) => {
    const t = tp.current
    if (t) { window.clearInterval(t.timer); cancelAnimationFrame(t.raf) }
    const at = songPos()
    if (flags.current.rec) endTake(at)
    tp.current = null
    stopClips()
    setPlaying(false); setRec(false)
    cdRef.current = 0; setCountdown(0)
    setPos(rewind ? 0 : Math.min(at, totalSteps(arrRef.current)))
    for (const [k, v] of live.current) { v.voice.release(); live.current.delete(k) }
  }, [songPos, endTake])
  const start = useCallback((from: number, pre = 0) => {
    const c = ensure(), bus = busRef.current
    if (!c || !bus) return
    const a0 = arrRef.current
    const step0 = Math.floor(from >= totalSteps(a0) ? 0 : from)
    const t = { anchor: c.currentTime + 0.06, step0, pre: Math.max(0, Math.round(pre)), k: 0, timer: 0, raf: 0 }
    tp.current = t
    const tick = () => {
      const a = arrRef.current, s1 = stepSec(a.bpm), tot = totalSteps(a)
      while (t.anchor + t.k * s1 < c.currentTime + LOOKAHEAD) {
        const virt = t.k - t.pre // 负的＝预备拍（只打节拍器）
        let s = virt < 0 ? virt : t.step0 + virt
        if (s >= tot) { if (!flags.current.loop) break; s %= tot }
        const at = t.anchor + t.k * s1
        if (s >= 0 && (virt === 0 || s === 0)) startClips(c, a, s, at) // 一开始放、或循环回到开头 ⇒ 音频音轨从这里放起
        for (const tr of audibleTracks(a)) for (const n of tr.notes) if (n.s === s) strike(c, bus, n.p, n.v, at, n.l * s1, tr.inst, tr.vol)
        if ((flags.current.metro || s < 0) && s % STEPS_PER_BEAT === 0) click(c, bus, at, s % STEPS_PER_BAR === 0) // 预备拍一定响
        t.k++
      }
    }
    tick()
    t.timer = window.setInterval(tick, 25)
    const frame = () => {
      if (tp.current !== t) return
      const a = arrRef.current
      const virt = (c.currentTime - t.anchor) / stepSec(a.bpm) - t.pre
      const raw = virt < 0 ? t.step0 : t.step0 + virt
      if (!flags.current.loop && raw >= totalSteps(a)) { stop(true); return }
      setPos(Math.max(0, flags.current.loop ? raw % totalSteps(a) : raw))
      const cd = virt < 0 ? Math.ceil(-virt / STEPS_PER_BEAT) : 0
      if (cd !== cdRef.current) { cdRef.current = cd; setCountdown(cd) }
      mixClips(a)
      t.raf = requestAnimationFrame(frame)
    }
    t.raf = requestAnimationFrame(frame)
    setPlaying(true)
  }, [ensure, stop, startClips, mixClips])
  const toggle = useCallback(() => {
    if (flags.current.playing) { pausedRec.current = sessionRef.current && flags.current.rec; stop(); return } // 录音模式里暂停 ⇒ 记住刚才在不在录
    if (sessionRef.current && pausedRec.current && takeRef.current) { pausedRec.current = false; setRec(true); start(pos); return } // 接着播、接着录同一段
    start(pos)
  }, [pos, start, stop])
  // 速度、小节一改 ⇒ 播着的话从现在的位置重新起（排程照新的格长）
  // 播放头跳回第一拍·正在播就从头接着播（不停）
  const toStart = useCallback(() => { if (flags.current.playing) { stop(); start(0) } else setPos(0) }, [start, stop])
  /** 录音模式的左钮（方块）＝停止播放并停止录音·离开录音模式 */
  const stopAll = useCallback(() => { if (flags.current.playing) stop(); else if (flags.current.rec) setRec(false); pausedRec.current = false; takeRef.current = null; setSession(false) }, [stop])
  // 「录音的时候……可以调节奏」：录音中改速度／改段 ⇒ 照新的格长接着录（不停录音·同一趟）
  const restartIfPlaying = useCallback(() => { if (flags.current.playing) { const at = songPos(), wasRec = flags.current.rec; stop(); start(at); if (wasRec) setRec(true) } }, [songPos, start, stop])

  // ── 弹琴（键盘／滑鼠同一套）：录音中且在播 ⇒ 放开时落进格子 ──
  const noteOn = useCallback((key: string, p: number) => {
    if (live.current.has(key)) return
    const c = ensure(), bus = busRef.current
    if (!c || !bus) return
    const tr = selectedTrack(arrRef.current)
    const voice = strike(c, bus, p, 0.8, c.currentTime, undefined, tr.inst, tr.vol)
    live.current.set(key, { voice, p, songT0: songPos() * stepSec(arrRef.current.bpm), ctxT0: c.currentTime })
    setDown((d) => new Set(d).add(p))
  }, [ensure, songPos])
  const noteOff = useCallback((key: string) => {
    const v = live.current.get(key)
    if (!v) return
    live.current.delete(key)
    v.voice.release()
    setDown((d) => { const n = new Set(d); if (![...live.current.values()].some((x) => x.p === v.p)) n.delete(v.p); return n })
    const c = ctxRef.current
    if (flags.current.rec && flags.current.playing && c) {
      const a = arrRef.current, tr = selectedTrack(a)
      if (tr.audio) return
      const id = uid()
      const next = recordNote(tr.notes, v.p, v.songT0, v.songT0 + (c.currentTime - v.ctxT0), a.bpm, totalSteps(a), id, 0.8, flags.current.snap)
      if (next === tr.notes) return
      // 这趟录的音符自成一段（录到一半换了音轨 ⇒ 那条另起一趟）
      let tk = takeRef.current
      if (!tk || tk.track !== tr.id) tk = takeRef.current = { track: tr.id, part: uid(), from: Math.max(0, Math.floor(v.songT0 / stepSec(a.bpm))), ids: new Set() }
      tk.ids.add(id)
      const at = songPos()
      tk.to = at >= tk.from ? at : totalSteps(a) // 段尾跟到播放头（不跳到小节尾）
      pushHist()
      const recorded = recordTake(a, next, tk)
      arrRef.current = recorded; setArr(recorded)
    }
  }, [pushHist, setArr, songPos])

  // ── 片段动作（右键选单、快捷键共用）──
  const posRef = useRef(pos); posRef.current = pos
  const segOf = (s: { track: string; id: string }) => { const a = arrRef.current, tr = a.tracks.find((x) => x.id === s.track); return tr ? segsOf(tr, a.bpm).find((g) => g.id === s.id) ?? null : null }
  const segCopy = (s: { track: string; id: string }) => { const c = copySeg(arrRef.current, s.track, s.id); if (c) { segClip.current = { c, track: s.track }; setHasClip(true) } }
  const segDelete = (s: { track: string; id: string }) => { const ids = selIdsRef.current(); editTrack(removeSegs(arrRef.current, s.track, ids.includes(s.id) ? ids : [s.id]), true); setSelSeg(null); setMulti(null); restartIfPlaying() }
  /** 合并：同一条轨上选中那几段（不用相邻）并成一段·中间空的没声音；乐器段只改段·音频段要先把这条轨照曲子时间重排成新档（layoutPieces）再换上 */
  const segMerge = async (track: string, ids: readonly string[]) => {
    const a = arrRef.current, tr = a.tracks.find((x) => x.id === track)
    if (!tr || !canMergeSegs(a, track, ids)) return
    const first = segsOf(tr, a.bpm).filter((g) => ids.includes(g.id)).sort((x, y) => x.s - y.s)[0].id
    if (!tr.audio) { editTrack(mergeParts(a, track, ids), true); setSelSeg({ track, id: first }); setMulti(null); restartIfPlaying(); return }
    const b = bufs.current.get(tr.audio.file)
    if (!mergeSpan(tr, ids) || !b || busy) { if (!b) setSegMsg('bf_varr_merge_fail'); return }
    setBusy(true)
    try {
      const pieces = piecesOf(tr)
      const chans = layoutPieces(Array.from({ length: b.numberOfChannels }, (_, i) => b.getChannelData(i)), b.sampleRate, pieces)
      const nb = new AudioBuffer({ length: chans[0].length, numberOfChannels: chans.length, sampleRate: b.sampleRate })
      chans.forEach((ch, i) => nb.copyToChannel(ch as Float32Array<ArrayBuffer>, i))
      const file = `arr-${uid()}`, name = tr.audio.name
      const f = new File([encodeWav(chans, b.sampleRate) as BlobPart], mergedFileName(name, lang), { type: 'audio/wav' })
      asked.current.add(file); bufs.current.set(file, nb)
      setPeaks((p) => ({ ...p, [file]: peaksOf(nb) }))
      if (!(await storeLocalOriginal(file, f))) setImportMsg('bf_varr_audio_unsaved')
      if (cloud && cloud.auto()) startArrUpload(cloud, file, f, f.name)
      const cur = arrRef.current, now = cur.tracks.find((x) => x.id === track)
      if (!now || JSON.stringify(piecesOf(now)) !== JSON.stringify(pieces)) return // 合的时候这条轨又被改过 ⇒ 不换（免得对不上）
      pushHist(); setArr(mergeAudioPieces(cur, track, ids, { file, name, dur: nb.duration, at: 0 }))
      setSelSeg({ track, id: first }); setMulti(null); restartIfPlaying()
    } finally { setBusy(false) }
  }
  const segCut = (s: { track: string; id: string }) => { segCopy(s); segDelete(s) }
  /** 贴到播放头：先贴选中的那条音轨·种类不合就贴回复制来的那条 */
  const segPaste = () => {
    const cb = segClip.current
    if (!cb) return
    const a = arrRef.current, at = Math.max(0, Math.floor(posRef.current))
    for (const track of [...new Set([a.sel, cb.track])]) {
      const r = pasteSeg(a, track, cb.c, at, uid)
      if (r) { editTrack(r.arr, true); setSelSeg({ track, id: r.segId }); restartIfPlaying(); return }
    }
    setSegMsg('bf_varr_seg_no_room')
  }
  const segSplitAt = (track: string, id: string, at: number) => { editTrack(splitSeg(arrRef.current, track, id, at, uid), true); restartIfPlaying() }
  /** Ctrl+B：选中的段压着播放头 ⇒ 裁它；否则裁选中那条音轨上播放头压着的段 */
  const segSplitHead = () => {
    const a = arrRef.current, at = posRef.current, s = selSegRef.current
    const g = s ? segOf(s) : null
    if (s && g && at > g.s && at < g.s + g.l) { segSplitAt(s.track, s.id, at); return }
    const tr = selectedTrack(a), h = segAt(tr, a.bpm, at)
    if (h) segSplitAt(tr.id, h.id, at)
  }
  const segNudge = (dir: -1 | 1, big: boolean) => {
    const s = selSegRef.current, g = s ? segOf(s) : null, step = nudgeStep(flags.current.snap, big)
    if (s && g) { editTrack(moveSeg(arrRef.current, s.track, s.id, g.s + dir * step), true); return }
    if (!flags.current.playing) setPos((p) => Math.max(0, Math.min(totalSteps(arrRef.current) - 1, Math.round(p) + dir * step)))
  }
  /** 添加到素材：只算这一段（挪到开头）汇出成 WAV·放进剪辑页素材区（不放轨道） */
  const segToMedia = async (s: { track: string; id: string }) => {
    if (!onAddMedia || busy) return
    const a = arrRef.current, sub = segArrangement(a, s.track, s.id), tr = a.tracks.find((x) => x.id === s.track)
    const sec = sub ? renderSeconds(sub) : 0
    if (!sub || !tr || !sec) { setSegMsg('bf_varr_seg_empty'); return }
    setBusy(true)
    try {
      const bytes = await renderWav(sub, sec, bufs.current)
      const label = tr.audio ? (tr.audio.name.replace(/\.[^.]+$/, '') || t('bf_varr_audio_track')) : t(instrumentOf(tr.inst).label)
      await onAddMedia(new File([bytes as BlobPart], segExportName(lang, label, new Date()), { type: 'audio/wav' }))
      setSegMsg('bf_varr_seg_added')
    } finally { setBusy(false) }
  }
  const segKeys = useRef({ split: segSplitHead, copy: segCopy, cut: segCut, paste: segPaste, del: segDelete, nudge: segNudge })
  segKeys.current = { split: segSplitHead, copy: segCopy, cut: segCut, paste: segPaste, del: segDelete, nudge: segNudge }

  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA')
      e.stopPropagation() // 弹窗开着：剪辑页的快捷键（空白键、Delete、Ctrl+Z…）一律不吃
      if (e.key === 'Escape') { if (popRef.current) { setMetroMenu(false); setExportMenu(false) } else if (menuRef.current) setMenu(null); else if (knifeRef.current) setKnife(false); else onClose(); return }
      if (typing) return
      if ((e.ctrlKey || e.metaKey) && (e.code === 'KeyY' || (e.code === 'KeyZ' && e.shiftKey))) { e.preventDefault(); redo(); return }
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { e.preventDefault(); undo(); return }
      // 片段快捷键：Ctrl+B 在播放头裁开·Ctrl+C／X／V 复制剪下贴上·Delete 删·←→ 照吸附单位挪（Shift 一小节；没选段 ⇒ 挪播放头）
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.code === 'KeyB') { e.preventDefault(); segKeys.current.split(); return }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.code === 'KeyC' && selSegRef.current) { e.preventDefault(); segKeys.current.copy(selSegRef.current); return }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.code === 'KeyX' && selSegRef.current) { e.preventDefault(); segKeys.current.cut(selSegRef.current); return }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.code === 'KeyV') { e.preventDefault(); segKeys.current.paste(); return }
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if ((e.key === 'Delete' || e.key === 'Backspace') && selSegRef.current) { e.preventDefault(); segKeys.current.del(selSegRef.current); return }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); segKeys.current.nudge(e.key === 'ArrowLeft' ? -1 : 1, e.shiftKey); return }
      if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) toggle(); return }
      if (e.code === 'KeyZ' || e.code === 'KeyX') { if (!e.repeat) setBase((b) => shiftBase(b, e.code === 'KeyZ' ? -1 : 1)); return }
      const p = pitchOfKey(e.code, base)
      if (p !== null) { e.preventDefault(); if (!e.repeat) noteOn(`k:${e.code}`, p) }
    }
    const onUp = (e: KeyboardEvent) => { e.stopPropagation(); if (KEY_SEMITONE[e.code] !== undefined) noteOff(`k:${e.code}`) }
    const onBlur = () => { for (const k of [...live.current.keys()]) noteOff(k) }
    window.addEventListener('keydown', onDown, true)
    window.addEventListener('keyup', onUp, true)
    window.addEventListener('blur', onBlur)
    return () => { window.removeEventListener('keydown', onDown, true); window.removeEventListener('keyup', onUp, true); window.removeEventListener('blur', onBlur) }
  }, [base, noteOn, noteOff, onClose, toggle, undo, redo])

  // 真乐器录音：开窗先载用到的那几种（换乐器、加音轨也跟着载）；载着时顶栏标一下·载好前弹的是合成音
  const usedInsts = useMemo(() => [...new Set(arr.tracks.filter((x) => !x.audio).map((x) => x.inst))].sort().join(','), [arr.tracks])
  const [soundsLoading, setSoundsLoading] = useState(false)
  useEffect(() => {
    const need = (usedInsts ? usedInsts.split(',') : []).filter((x): x is InstrumentId => INSTRUMENTS.some((i) => i.id === x) && !samplesReady(x as InstrumentId))
    if (!need.length) return
    let live = true
    setSoundsLoading(true)
    void Promise.all(need.map(loadSamples)).finally(() => { if (live) setSoundsLoading(false) })
    return () => { live = false }
  }, [usedInsts])

  // 关窗：停走带、关音讯
  useEffect(() => () => {
    const t = tp.current
    if (t) { window.clearInterval(t.timer); cancelAnimationFrame(t.raf) }
    void ctxRef.current?.close().catch(() => {})
  }, [])
  // 一打开把格子卷到琴键那一段（C4～E6）·刚弹进去的音看得到
  const curIsAudio = !!cur.audio
  useEffect(() => { const g = gridRef.current; if (g && editorOpen) { g.scrollTop = (PITCH_HI - 88) * ROW_H; if (tracksRef.current) g.scrollLeft = tracksRef.current.scrollLeft } }, [editorOpen, curIsAudio])
  /** 音轨区与编辑器横向一起捲（同一条时间轴） */
  // 音轨区上滚滚轮 ⇒ 左右捲（触控板横滑、Shift＋滚轮照浏览器原样）；
  // 滑鼠在左边音轨头那栏 ⇒ 照旧上下捲（音轨多时还翻得到）；Ctrl／⌘＋滚轮留给浏览器缩放
  useEffect(() => {
    const el = tracksRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey || e.shiftKey || Math.abs(e.deltaX) >= Math.abs(e.deltaY) || !e.deltaY) return
      if ((e.target as HTMLElement).closest('[data-testid="vedit-piano-track-head"]')) return
      if (el.scrollWidth <= el.clientWidth) return
      e.preventDefault()
      el.scrollLeft += e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientWidth : 1)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])
  const syncX = (from: HTMLDivElement | null, to: HTMLDivElement | null) => {
    if (!from || !to || syncing.current || to.scrollLeft === from.scrollLeft) return
    syncing.current = true; to.scrollLeft = from.scrollLeft; requestAnimationFrame(() => { syncing.current = false })
  }

  // ── 格子：按下 ⇒ 空格加音符（拖着拉长）／音符本体挪（没挪就删）／右缘改长短 ──
  const cellAt = (e: React.PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    return { s: Math.floor((e.clientX - r.left) / STEP_W), p: PITCH_HI - Math.floor((e.clientY - r.top) / ROW_H) }
  }
  const preview = (p: number) => { const c = ensure(), bus = busRef.current, tr = selectedTrack(arrRef.current); if (c && bus) strike(c, bus, p, 0.7, c.currentTime, 0.25, tr.inst, tr.vol) }
  const onGridDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    const { s: s0, p } = cellAt(e)
    if (p < PITCH_LO || p > PITCH_HI || s0 < 0 || s0 >= total) return
    const tgt = (e.target as HTMLElement).closest('[data-note-id]')
    const notes = curNotes()
    e.currentTarget.setPointerCapture(e.pointerId)
    if (tgt) {
      const id = tgt.getAttribute('data-note-id')!
      const n = notes.find((x) => x.id === id)
      if (!n) return
      const edge = !!(e.target as HTMLElement).closest('[data-note-edge]')
      pushHist()
      drag.current = { mode: edge ? 'size' : 'move', id, p0: n.p, s0: n.s, grabStep: s0, grabPitch: p, moved: false, base: notes }
      return
    }
    const id = uid()
    const s = snapDown(s0, snap) // 新音符的开头吸到吸附格
    const next = addNote(notes, { id, p, s, l: Math.max(snap, snap > 1 ? snap : lastLen.current) }, total)
    if (next === notes) return
    commit(next, notes)
    preview(p)
    drag.current = { mode: 'new', id, p0: p, s0: s, grabStep: s, grabPitch: p, moved: false, base: next }
  }
  const onGridMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    const { s, p } = cellAt(e)
    const notes = curNotes()
    if (d.mode === 'new' || d.mode === 'size') {
      if (s !== d.grabStep) d.moved = true
      const n = notes.find((x) => x.id === d.id)
      if (!n) return
      const next = resizeNote(notes, d.id, snap > 1 ? Math.max(snap, snapDown(s - n.s, snap) + snap) : s - n.s + 1, total)
      setNotesLive(next)
    } else {
      if (s === d.grabStep && p === d.grabPitch) return
      d.moved = true
      const next = moveNote(notes, d.id, d.p0 + (p - d.grabPitch), snapDown(d.s0 + (s - d.grabStep), snap), total)
      if (next !== notes) { const n = next.find((x) => x.id === d.id); if (n && n.p !== notes.find((x) => x.id === d.id)?.p) preview(n.p) }
      setNotesLive(next)
    }
  }
  const onGridUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    drag.current = null
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* 已放 */ }
    if (!d) return
    const notes = curNotes()
    const n = notes.find((x) => x.id === d.id)
    if (d.mode === 'move' && !d.moved) { setNotesLive(removeNote(notes, d.id)); return }
    if (d.mode === 'size' && !d.moved && hist.current.length) hist.current.pop()
    if (n && (d.mode === 'new' || d.mode === 'size')) lastLen.current = n.l
  }

  const bpmHistAt = useRef(0)
  const setBpm = (v: number) => {
    if (!Number.isFinite(v)) return
    const bpm = Math.min(BPM_MAX, Math.max(BPM_MIN, Math.round(v)))
    if (bpm === arrRef.current.bpm) return
    const at = songPos(), wasPlaying = flags.current.playing, wasRec = flags.current.rec
    // 用舊速度收妥正在按的音符，才清音源與重建時鐘；放鍵不會重複錄。
    if (wasPlaying) { for (const key of [...live.current.keys()]) noteOff(key); stop() }
    if (Date.now() - bpmHistAt.current > 1000) pushHist()
    bpmHistAt.current = Date.now()
    const next = { ...arrRef.current, bpm }
    arrRef.current = next; setArr(next)
    if (wasPlaying) { start(at); if (wasRec) setRec(true) }
  }
  const setBars = (b: number) => {
    const a = arrRef.current
    const next = fitBarsAll(a, b)
    if (next.bars !== a.bars) pushHist()
    setArr(next)
    if (pos >= b * STEPS_PER_BAR) setPos(0)
  }
  // 停着或正在播都先数一小节（四拍）再录·节拍器的声音不进录音也不进汇出
  const startRec = () => {
    if (rec) { endTake(songPos()); setRec(false); takeRef.current = null; return } // 停录音·继续播放（还在录音模式）
    const from = Math.max(0, Math.floor(flags.current.playing ? songPos() : pos))
    if (session && flags.current.playing) { // 录音模式里播着没在录 ⇒ 从现在播放的位置接着录（另起一段·不停播放）
      const tgt = recTarget(arrRef.current, uid())
      if (!tgt) return
      if (tgt !== arrRef.current) editTrack(tgt, !tgt.tracks.every((x) => arrRef.current.tracks.includes(x)))
      takeRef.current = { track: selectedTrack(arrRef.current).id, part: uid(), from, ids: new Set() }
      pausedRec.current = false; setRec(true)
      return
    }
    // 选中音频音轨也能按录音 ⇒ 录进第一条乐器音轨（没有就加一条钢琴）
    const tgt = recTarget(arrRef.current, uid())
    if (!tgt) return
    if (tgt !== arrRef.current) editTrack(tgt, !tgt.tracks.every((x) => arrRef.current.tracks.includes(x)))
    if (flags.current.playing) stop()
    pausedRec.current = false; setSession(true)
    setRec(true)
    takeRef.current = { track: selectedTrack(arrRef.current).id, part: uid(), from, ids: new Set() } // 每按一次录音＝新的一段
    start(from, countIn ? STEPS_PER_BAR : 0) // 开了预备拍 ⇒ 播放头不动·先空打四拍；缺省关 ⇒ 直接开录
  }
  /** 导入音频：解得开才收·太长不收；存进本机储存（存不进 ⇒ 这次开页能用·明说重新整理要再导入）·加一条音频音轨·小节不够自动加 */
  const importAudio = async (f: File) => {
    if (importing) return
    setImportMsg(null); setImporting(true)
    try {
      const b = await decodeAudio(f)
      if (!b || !(b.duration > 0)) { setImportMsg('bf_varr_import_fail'); return }
      if (b.duration > CLIP_MAX_SEC) { setImportMsg('bf_varr_import_long'); return }
      const file = `arr-${uid()}`
      asked.current.add(file); bufs.current.set(file, b)
      setPeaks((p) => ({ ...p, [file]: peaksOf(b) }))
      if (!(await storeLocalOriginal(file, f))) setImportMsg('bf_varr_audio_unsaved')
      // 照剪辑页设定自动在背景传上云盘（进度圈可点开取消）
      if (cloud && cloud.auto()) startArrUpload(cloud, file, f, f.name)
      const a = arrRef.current
      const next = addAudioTrack(fitBarsAll(a, barsToFit(b.duration, a.bpm, a.bars)), uid(), { file, name: f.name, dur: b.duration, at: 0 })
      if (next.tracks.length === a.tracks.length) return
      pushHist(); setArr(next); restartIfPlaying()
    } finally { setImporting(false) }
  }
  const quantize = () => { const notes = curNotes(); commit(quantizeNotes(notes, snap, total), notes) }
  const [exportMenu, setExportMenu] = useState(false)
  popRef.current = metroMenu || exportMenu // Esc 先收下拉（⛔ 关掉整个编曲窗）
  const projIn = useRef<HTMLInputElement>(null)
  const download = (blob: Blob, name: string) => {
    const u = URL.createObjectURL(blob), el = document.createElement('a')
    el.href = u; el.download = name; document.body.appendChild(el); el.click(); el.remove()
    window.setTimeout(() => URL.revokeObjectURL(u), 4000)
  }
  const renderAll = async (): Promise<Uint8Array | null> => {
    const a = arrRef.current
    if (!renderSeconds(a) || busy) return null
    if (flags.current.playing) stop()
    setBusy(true)
    try { return await renderWav(a, renderSeconds(a), bufs.current) } finally { setBusy(false) }
  }
  const doExport = async (kind: 'project' | 'audio' | 'media') => {
    setExportMenu(false)
    if (kind === 'project') { download(new Blob([JSON.stringify(arrRef.current)], { type: 'application/json' }), exportName(lang, new Date(), 'json')); return }
    const bytes = await renderAll()
    if (!bytes) return
    const f = new File([bytes as BlobPart], exportName(lang, new Date()), { type: 'audio/wav' })
    if (kind === 'audio') { download(f, f.name); return }
    // 另外每条音轨各算一份（长度同整首·对齐开头）一起交出去
    const a = arrRef.current, sec = renderSeconds(a)
    const stems: File[] = []
    const plan = stemTracks(a, (tr) => (tr.audio ? (tr.audio.name.replace(/\.[^.]+$/, '') || t('bf_varr_audio_track')) : t(instrumentOf(tr.inst).label)))
    if (plan.length) {
      setBusy(true)
      try {
        for (const [i, s] of plan.entries()) {
          const one = trackArrangement(a, s.id)
          if (one) stems.push(new File([(await renderWav(one, sec, bufs.current)) as BlobPart], stemFileName(f.name, s.label, i), { type: 'audio/wav' }))
        }
      } finally { setBusy(false) }
    }
    if (onAddMedia) await onAddMedia(f, stems); else await onExport(f)
    setSegMsg('bf_varr_seg_added')
  }
  /** 开启工程文件（导出的那份 .json）：读得懂才换上·能复原 */
  const openProject = async (f: File) => {
    try {
      const a = parseArrangement(await f.text())
      if (flags.current.playing) stop()
      pushHist(); setArr(a); setSelSeg(null)
    } catch { setSegMsg('bf_varr_seg_empty') }
  }


  // 屏幕琴键：底音起 KEYBOARD_SPAN 个半音
  const keys = useMemo(() => Array.from({ length: KEYBOARD_SPAN }, (_, i) => base + i).filter((p) => p <= PITCH_HI), [base])
  const whites = keys.filter((p) => !isBlack(p))
  const keyHint = useMemo(() => {
    const m = new Map<number, string>()
    for (const [code, semi] of Object.entries(KEY_SEMITONE)) m.set(base + semi, keyLabel(code))
    return m
  }, [base])
  const mouseKey = useRef<number | null>(null)
  const keyDown = (p: number) => (e: React.PointerEvent) => { if (e.button !== 0) return; e.preventDefault(); mouseKey.current = p; noteOn('mouse', p) }
  const keyEnter = (p: number) => (e: React.PointerEvent) => { if (mouseKey.current === null || !(e.buttons & 1) || mouseKey.current === p) return; noteOff('mouse'); mouseKey.current = p; noteOn('mouse', p) }
  useEffect(() => {
    const up = () => { if (mouseKey.current !== null) { mouseKey.current = null; noteOff('mouse') } }
    window.addEventListener('pointerup', up)
    return () => window.removeEventListener('pointerup', up)
  }, [noteOff])

  const rows = useMemo(() => Array.from({ length: PITCH_HI - PITCH_LO + 1 }, (_, i) => PITCH_HI - i), [])
  const gridH = rows.length * ROW_H
  const gridW = total * STEP_W
  const btn = 'h-8 min-w-8 px-2 rounded-md flex items-center justify-center text-xs'
  const tool = 'h-7 px-2 rounded-md flex items-center gap-1 text-xs'
  const anySolo = arr.tracks.some((x) => x.solo)
  const songSec = arrangeSeconds(arr)
  const curLabel = cur.audio ? (cur.audio.name || t('bf_varr_audio_track')) : t(instrumentOf(cur.inst).label)
  /** 播放头跳到第 s 格（正在播 ⇒ 从那里接着播） */
  const seekStep = (s0: number) => {
    const s = Math.max(0, Math.min(total - 1, Math.round(s0)))
    if (flags.current.playing) { stop(); start(s) } else setPos(s)
  }
  // 刻度尺；按住拖＝拖播放头
  const scrub = useRef<{ was: boolean } | null>(null)
  const rulerStep = (e: React.PointerEvent<HTMLDivElement>) => { const r = e.currentTarget.getBoundingClientRect(); return Math.max(0, Math.min(total - 1, Math.round((e.clientX - r.left) / STEP_W))) }
  const onRulerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    const was = flags.current.playing
    if (was) stop()
    scrub.current = { was }
    setPos(rulerStep(e))
  }
  const onRulerMove = (e: React.PointerEvent<HTMLDivElement>) => { if (scrub.current) setPos(rulerStep(e)) }
  const onRulerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const sc = scrub.current
    scrub.current = null
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* 已放 */ }
    if (sc?.was) start(rulerStep(e))
  }
  const ruler = (testid?: string) => (
    <div className="relative cursor-pointer h-full select-none touch-none" style={{ width: gridW }} data-testid={testid} onPointerDown={onRulerDown} onPointerMove={onRulerMove} onPointerUp={onRulerUp} onPointerCancel={onRulerUp}>
      {Array.from({ length: arr.bars * BEATS_PER_BAR }, (_, k) => {
        const bar = k % BEATS_PER_BAR === 0
        return <span key={k} className={`absolute bottom-0 w-px ${bar ? 'h-3 bg-white/45' : 'h-1.5 bg-white/25'}`} style={{ left: k * STEPS_PER_BEAT * STEP_W }} data-testid={testid ? (bar ? 'vedit-piano-tick-bar' : 'vedit-piano-tick-beat') : undefined} />
      })}
      {Array.from({ length: arr.bars }, (_, b) => <span key={b} className="absolute top-0.5 text-[10px] font-medium text-neutral-300 pl-1" style={{ left: b * STEPS_PER_BAR * STEP_W }}>{b + 1}</span>)}
      <div className="absolute top-0 bottom-0 w-px bg-rose-500 pointer-events-none" style={{ left: Math.max(0, pos) * STEP_W }} />
      <div className="absolute top-0.5 w-3 h-3.5 -ml-1.5 rounded-t-sm bg-rose-500 shadow cursor-ew-resize" style={{ left: Math.max(0, pos) * STEP_W, clipPath: 'polygon(0 0,100% 0,100% 65%,50% 100%,0 65%)' }} data-testid={testid ? 'vedit-piano-playhead' : undefined} aria-label={t('bf_varr_playhead')} />
    </div>
  )
  // ── 音轨区的片段：点选／同轨拖动／拉两端裁／裁刀模式点哪裁哪／空白处点＝移播放头 ──
  const laneStep = (e: { clientX: number }, el: HTMLElement) => (e.clientX - el.getBoundingClientRect().left) / STEP_W
  const onLaneDown = (tr: ArrTrack) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    setMenu(null)
    const lane = e.currentTarget, x = laneStep(e, lane), q = flags.current.snap
    const segEl = (e.target as HTMLElement).closest('[data-seg-id]')
    selectTrack(tr.id)
    if (knifeRef.current) {
      e.preventDefault()
      const g = segAt(tr, arrRef.current.bpm, x)
      if (g) segSplitAt(tr.id, g.id, tr.audio ? x : Math.round(x / q) * q)
      return
    }
    if (!segEl) { setSelSeg(null); seekStep(x); return }
    e.preventDefault()
    const id = segEl.getAttribute('data-seg-id')!
    const g = segsOf(tr, arrRef.current.bpm).find((s) => s.id === id)
    if (!g) return
    // Ctrl／⌘／Shift＋点同一条轨的段 ⇒ 加进／移出选取（不拖）
    const cur = selSegRef.current
    if ((e.ctrlKey || e.metaKey || e.shiftKey) && cur && cur.track === tr.id) {
      const have = selIdsRef.current(cur)
      const ids = have.includes(id) ? have.filter((x) => x !== id) : [...have, id]
      if (!ids.length) { setSelSeg(null); setMulti(null); return }
      setSelSeg({ track: tr.id, id: ids[0] }); setMulti({ track: tr.id, anchor: ids[0], ids: ids.slice(1) })
      return
    }
    setSelSeg({ track: tr.id, id }); setMulti(null)
    const edge = (e.target as HTMLElement).closest('[data-seg-edge]')?.getAttribute('data-seg-edge')
    pushHist()
    segDrag.current = { mode: edge === 'l' || edge === 'r' ? edge : 'move', track: tr.id, id, x0: x, s0: g.s, base: arrRef.current, moved: false }
    lane.setPointerCapture(e.pointerId)
  }
  const onLaneMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = segDrag.current
    if (!d) return
    const x = laneStep(e, e.currentTarget), q = flags.current.snap
    if (d.mode === 'move') {
      const dx = Math.round((x - d.x0) / q) * q
      if (!dx && !d.moved) return
      d.moved = true
      setArr(moveSeg(d.base, d.track, d.id, d.s0 + dx))
    } else {
      d.moved = true
      setArr(trimSeg(d.base, d.track, d.id, d.mode, Math.round(x / q) * q))
    }
  }
  const onLaneUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = segDrag.current
    segDrag.current = null
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* 已放 */ }
    if (!d) return
    if (!d.moved || arrRef.current === d.base) { hist.current.pop(); return }
    restartIfPlaying()
  }
  const onLaneMenu = (tr: ArrTrack) => (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    if (knifeRef.current) { setKnife(false); return }
    const segEl = (e.target as HTMLElement).closest('[data-seg-id]')
    if (!segEl) { setMenu(null); return }
    const id = segEl.getAttribute('data-seg-id')!
    selectTrack(tr.id)
    const cur = selSegRef.current
    if (!(cur && cur.track === tr.id && selIdsRef.current(cur).includes(id))) { setSelSeg({ track: tr.id, id }); setMulti(null) } // 点在多选里 ⇒ 选取不动（好合并）
    setMenu({ x: e.clientX, y: e.clientY, track: tr.id, id })
  }
  /** 横条拖动：keys＝琴键高度·tracks＝编辑器开着时音轨区高度 */
  const onSplitDown = (kind: 'keys' | 'tracks') => (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    const el = e.currentTarget, y0 = e.clientY
    el.setPointerCapture(e.pointerId)
    const h0 = kind === 'keys' ? keyH : (tracksRef.current?.getBoundingClientRect().height ?? 200)
    let last = h0
    const move = (ev: PointerEvent) => {
      const dy = ev.clientY - y0
      last = kind === 'keys' ? Math.min(400, Math.max(80, h0 - dy)) : Math.min(window.innerHeight * 0.7, Math.max(60, h0 + dy))
      if (kind === 'keys') setKeyH(last); else setTracksH(last)
    }
    const up = () => {
      el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up)
      if (kind === 'keys') { try { window.localStorage.setItem(KEYS_H_KEY, String(Math.round(last))) } catch { /* 存不了就这次 */ } }
    }
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up)
  }
  const splitBar = (kind: 'keys' | 'tracks') => (
    <div role="separator" aria-orientation="horizontal" aria-label={t('bf_varr_resize')} title={t('bf_varr_resize')} data-testid={`vedit-piano-split-${kind}`} onPointerDown={onSplitDown(kind)}
      className="h-2 shrink-0 cursor-row-resize touch-none flex items-center justify-center bg-[#14141f] hover:bg-indigo-500/40 group">
      <span className="w-10 h-0.5 rounded bg-white/25 group-hover:bg-white/70" />
    </div>
  )

  return createPortal(
    <div className="fixed inset-0 z-[80] bg-black/60 flex items-center justify-center p-4" data-testid="vedit-piano" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="relative w-full max-w-6xl h-full max-h-[52rem] rounded-xl bg-[#1b1b2b] text-neutral-200 shadow-2xl flex flex-col overflow-hidden border border-white/10" onPointerDown={(e) => {
        const el = e.target as HTMLElement
        if (exportMenu && !el.closest('[data-testid="vedit-piano-export-menu"],[data-testid="vedit-piano-export"]')) setExportMenu(false)
        if (metroMenu && !el.closest('[data-testid="vedit-piano-metro-pop"],[data-testid="vedit-piano-metro-menu"]')) setMetroMenu(false)
      }}>
        {upPop && (() => {
          // 上传进度弹窗（照剪辑页素材那个）：进度条＋取消上传（再问一次·取消后换电脑会找不到）
          const u = ups.get(upPop.file)
          const c = arr.tracks.find((x) => x.audio?.file === upPop.file)?.audio
          const close = () => setUpPop(null)
          return (
            <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/40" onPointerDown={(e) => { if (e.target === e.currentTarget) close() }} data-testid="vedit-piano-up-dialog">
              <div className="w-80 rounded-lg bg-[#26263a] border border-white/10 shadow-xl p-4 text-sm flex flex-col gap-3">
                <div className="font-medium">{t('vedit_up_title')}</div>
                <div className="text-xs text-neutral-400 truncate">{c?.name}</div>
                {!u ? <div className="text-xs text-emerald-300">{t(c?.driveId ? 'vedit_up_done' : 'vedit_up_stopped')}</div>
                  : upPop.confirm ? <div className="text-xs text-amber-200 leading-relaxed" data-testid="vedit-piano-up-warn">{t('bf_varr_up_warn')}</div>
                  : <div className="h-2 rounded bg-white/10 overflow-hidden"><div className="h-full bg-cyan-400" style={{ width: `${Math.round(u.p * 100)}%` }} /></div>}
                <div className="flex justify-end gap-2">
                  {u && !upPop.confirm && <button type="button" onClick={() => setUpPop({ ...upPop, confirm: true })} data-testid="vedit-piano-up-cancel" className="px-3 h-8 rounded bg-white/10 hover:bg-white/20">{t('vedit_up_cancel')}</button>}
                  {u && upPop.confirm && <>
                    <button type="button" onClick={() => setUpPop({ ...upPop, confirm: false })} data-testid="vedit-piano-up-keep" className="px-3 h-8 rounded bg-white/10 hover:bg-white/20">{t('vedit_up_keep')}</button>
                    <button type="button" onClick={() => { u.cancel(); close() }} data-testid="vedit-piano-up-cancel-ok" className="px-3 h-8 rounded bg-rose-600 hover:bg-rose-500 text-white">{t('vedit_up_cancel_ok')}</button>
                  </>}
                  {(!u || !upPop.confirm) && <button type="button" onClick={close} className="px-3 h-8 rounded bg-cyan-600 hover:bg-cyan-500 text-white" data-testid="vedit-piano-up-close">{t('bf_varr_close')}</button>}
                </div>
              </div>
            </div>
          )
        })()}
        {countdown > 0 && <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center"><span className="text-8xl font-bold text-rose-400/90 drop-shadow-lg" data-testid="vedit-piano-countdown">{countdown}</span></div>}
        {/* 上排（照音悦家）：工程名｜■ ▶ ●｜⟳｜速度·拍号·调号｜节拍器▾｜↶ ↷ 小节 清空 放进轨道 ✕ */}
        <div className="h-12 shrink-0 flex items-center gap-2 px-3 border-b border-white/10">
          {soundsLoading && <span className="text-[11px] text-amber-300 animate-pulse" data-testid="vedit-piano-sounds-loading">{t('bf_varr_sounds_loading')}</span>}
          <span className="text-sm font-medium mr-1 truncate max-w-[9rem]" data-testid="vedit-piano-title">{t('bf_varr_tab')} · {curLabel}</span>
          <div className="mx-auto flex items-center gap-2">
            <div className="flex items-center rounded-lg bg-white/10 p-0.5">
              <button type="button" className={`${btn} hover:bg-white/10`} title={t(session ? 'bf_varr_stop_all' : 'bf_varr_stop')} aria-label={t(session ? 'bf_varr_stop_all' : 'bf_varr_stop')} onClick={session ? stopAll : toStart} data-testid="vedit-piano-stop" data-session={session ? '1' : '0'}>{session ? <svg viewBox="0 0 20 20" className="w-4 h-4 mx-auto" fill="currentColor" aria-hidden><rect x="4.5" y="4.5" width="11" height="11" rx="2" /></svg> : <svg viewBox="0 0 20 20" className="w-4 h-4 mx-auto" fill="currentColor" aria-hidden><rect x="4" y="4" width="2.2" height="12" rx="0.6" /><path d="M16 4.6v10.8a.6.6 0 01-.92.5L7.4 10.5a.6.6 0 010-1L15.08 4.1a.6.6 0 01.92.5z" /></svg>}</button>
              <button type="button" className={`${btn} w-12 ${playing ? 'bg-emerald-500 text-black' : 'hover:bg-white/10'}`} title={t(playing ? 'bf_varr_pause' : 'bf_varr_play')} aria-label={t(playing ? 'bf_varr_pause' : 'bf_varr_play')} onClick={toggle} data-testid="vedit-piano-play" data-playing={playing ? '1' : '0'}>{playing ? '❚❚' : '▶'}</button>
              <button type="button" className={`${btn} disabled:opacity-30 ${rec ? 'bg-rose-500 text-white' : 'hover:bg-white/10 text-rose-500'}`} title={t(rec ? 'bf_varr_rec_pause' : 'bf_varr_record')} aria-label={t(rec ? 'bf_varr_rec_pause' : 'bf_varr_record')} data-testid="vedit-piano-rec" data-rec={rec ? '1' : '0'}
                disabled={!rec && !!cur.audio && !arr.tracks.some((x) => !x.audio) && arr.tracks.length >= MAX_TRACKS} onClick={startRec}>●</button>
            </div>
            <button type="button" className={`${btn} ${loop ? 'bg-sky-500/30 text-sky-300' : 'bg-white/10 text-neutral-400'}`} title={t('bf_varr_loop')} onClick={() => setLoop((v) => !v)} data-testid="vedit-piano-loop">⟳</button>
            {/* 速度｜拍号｜调号（一格三段·照音悦家「120.0｜4/4｜E maj」） */}
            <div className="flex items-center h-8 rounded-lg bg-white/10 text-xs divide-x divide-white/10">
              <input type="number" min={BPM_MIN} max={BPM_MAX} value={arr.bpm} onChange={(e) => setBpm(Number(e.target.value))} data-testid="vedit-piano-bpm" title={t('bf_varr_bpm')} aria-label={t('bf_varr_bpm')}
                style={BPM_INK} className="w-16 h-full bg-transparent px-2 text-center" />
              <span className="px-3 text-neutral-300" title={t('bf_varr_tsig')}>4/4</span>
              <select value={`${arr.key.root}:${arr.key.minor ? 1 : 0}`} onChange={(e) => { const [r, m] = e.target.value.split(':'); pushHist(); setArr({ ...arrRef.current, key: parseKeySig({ root: Number(r), minor: m === '1' }) }) }}
                title={t('bf_varr_key')} aria-label={t('bf_varr_key')} data-testid="vedit-piano-key-sig" style={BPM_INK} className="h-full bg-transparent px-2">
                {KEY_CHOICES.map((k) => <option key={`${k.root}:${k.minor}`} value={`${k.root}:${k.minor ? 1 : 0}`} style={{ color: '#111' }}>{keySigName(k)}</option>)}
              </select>
            </div>
            {/* 节拍器▾：节拍器开关＋预备拍（录音前先数一小节） */}
            <div className="relative flex items-center rounded-lg bg-white/10">
              <button type="button" className={`${btn} ${metro ? 'text-amber-300' : 'text-neutral-400'}`} title={t('bf_varr_metro')} onClick={() => setMetro((v) => !v)} data-testid="vedit-piano-metro" data-on={metro ? '1' : '0'}>♩</button>
              <button type="button" className="h-8 px-1 text-[10px] text-neutral-400" aria-label={t('bf_varr_metro')} onClick={() => setMetroMenu((v) => !v)} data-testid="vedit-piano-metro-menu">▾</button>
              {metroMenu && (
                <div className="absolute top-9 right-0 z-30 w-48 rounded-lg bg-[#26263a] border border-white/10 shadow-xl p-2 flex flex-col gap-1.5 text-xs" data-testid="vedit-piano-metro-pop">
                  <label className="flex items-center gap-2"><input type="checkbox" checked={metro} onChange={(e) => setMetro(e.target.checked)} />{t('bf_varr_metro')}</label>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={countIn} onChange={(e) => setCountIn(e.target.checked)} data-testid="vedit-piano-count-in" />{t('bf_varr_count_in')}</label>
                  {/* 「可以调节奏」：节拍器这里也能改速度（同上排那格·录音中改了照新速度接着录） */}
                  <label className="flex items-center gap-2">{t('bf_varr_bpm')}
                    <input type="number" min={BPM_MIN} max={BPM_MAX} value={arr.bpm} onChange={(e) => setBpm(Number(e.target.value))} data-testid="vedit-piano-metro-bpm" style={BPM_INK} className="w-16 h-6 rounded bg-black/30 px-1 text-center" /></label>
                  <span className="text-[10px] leading-snug text-neutral-500">{t('bf_varr_metro_note')}</span>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button type="button" className={`${btn} bg-white/10 hover:bg-white/15`} title={t('bf_varr_undo')} aria-label={t('bf_varr_undo')} onClick={undo} data-testid="vedit-piano-undo">↶</button>
            <button type="button" className={`${btn} bg-white/10 hover:bg-white/15`} title={t('bf_varr_redo')} aria-label={t('bf_varr_redo')} onClick={redo} data-testid="vedit-piano-redo">↷</button>
            <select value={arr.bars} onChange={(e) => setBars(Number(e.target.value))} data-testid="vedit-piano-bars" title={t('bf_varr_bars')} aria-label={t('bf_varr_bars')} style={BPM_INK} className="h-8 rounded-md bg-white/10 px-1 text-xs">
              {BARS_CHOICES.map((b) => <option key={b} value={b} style={{ color: '#111' }}>{b} {t('bf_varr_bars')}</option>)}
            </select>
            <div className="relative">
              <button type="button" disabled={busy} onClick={() => setExportMenu((v) => !v)} data-testid="vedit-piano-export" aria-haspopup="menu" aria-expanded={exportMenu}
                className={`${btn} px-3 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white`}>{t(busy ? 'bf_varr_exporting' : 'bf_varr_export')} ▾</button>
              {exportMenu && (
                <div role="menu" className="absolute top-9 right-0 z-40 w-44 rounded-lg bg-[#26263a] border border-white/10 shadow-xl py-1 text-xs" data-testid="vedit-piano-export-menu">
                  <button type="button" role="menuitem" className="w-full text-left px-3 py-1.5 hover:bg-white/10" onClick={() => { void doExport('project') }} data-testid="vedit-piano-export-project">{t('bf_varr_export_project')}</button>
                  <button type="button" role="menuitem" disabled={!renderSeconds(arr)} className="w-full text-left px-3 py-1.5 hover:bg-white/10 disabled:opacity-40" onClick={() => { void doExport('audio') }} data-testid="vedit-piano-export-audio">{t('bf_varr_export_audio')}</button>
                  <button type="button" role="menuitem" disabled={!renderSeconds(arr)} className="w-full text-left px-3 py-1.5 hover:bg-white/10 disabled:opacity-40" onClick={() => { void doExport('media') }} data-testid="vedit-piano-export-media">{t('bf_varr_export_media')}</button>
                </div>
              )}
            </div>
            <button type="button" className={`${btn} text-neutral-400 hover:bg-white/10`} aria-label={t('bf_varr_close')} title={t('bf_varr_close')} onClick={onClose} data-testid="vedit-piano-close">✕</button>
          </div>
        </div>
        {/* 第二排工具（照音悦家）：左＋音轨｜右 编辑器开关 */}
        <div className="h-9 shrink-0 flex items-center gap-2 px-3 border-b border-white/10 text-neutral-300">
          <button type="button" disabled={arr.tracks.length >= MAX_TRACKS} onClick={() => editTrack(addTrack(arrRef.current, 'piano', uid()), true)} data-testid="vedit-piano-track-add"
            className={`${tool} hover:bg-white/10 disabled:opacity-30`}>＋ {t('bf_varr_track_add')}</button>
          {/* 导入音频：一首歌或一段录音 ⇒ 一条音频音轨（波形） */}
          <button type="button" disabled={arr.tracks.length >= MAX_TRACKS || importing} onClick={() => fileIn.current?.click()} data-testid="vedit-piano-import" title={t('bf_varr_import_tip')}
            className={`${tool} hover:bg-white/10 disabled:opacity-30`}>〰 {t(importing ? 'bf_varr_importing' : 'bf_varr_import_audio')}</button>
          <input ref={fileIn} type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.flac,.ogg,.opus,.mp4" className="hidden" data-testid="vedit-piano-import-file"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importAudio(f) }} />
          <button type="button" onClick={() => projIn.current?.click()} data-testid="vedit-piano-open-project" className={`${tool} hover:bg-white/10`}>📂 {t('bf_varr_open_project')}</button>
          <input ref={projIn} type="file" accept=".json,application/json" className="hidden" data-testid="vedit-piano-open-project-file"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void openProject(f) }} />
          {importMsg && <span className="text-xs text-amber-300 truncate" data-testid="vedit-piano-import-msg">{t(importMsg).replace('{name}', upFailName)}</span>}
          {knife && <span className="flex items-center gap-1 text-xs text-amber-300" data-testid="vedit-piano-knife-hint">✂ {t('bf_varr_knife_on')}
            <button type="button" onClick={() => setKnife(false)} className="px-1.5 rounded bg-white/10 hover:bg-white/20 text-neutral-200">{t('bf_varr_knife_exit')}</button></span>}
          {segMsg && <span className="text-xs text-emerald-300 truncate" data-testid="vedit-piano-seg-msg">{t(segMsg)}</span>}
          <label className="ml-auto flex items-center gap-1 text-xs text-neutral-400">{t('bf_varr_snap')}
            <select value={snap} onChange={(e) => setSnap(Number(e.target.value) as Snap)} data-testid="vedit-piano-track-snap" style={BPM_INK} className="h-7 rounded bg-black/30 px-1 text-xs">
              {SNAP_CHOICES.map((q) => <option key={q} value={q} style={{ color: '#111' }}>{t(SNAP_LABEL[q])}</option>)}
            </select></label>
          <button type="button" onClick={() => setEditorOpen((v) => !v)} data-testid="vedit-piano-editor-toggle" data-on={editorOpen ? '1' : '0'}
            className={`${tool} ${editorOpen ? 'bg-white/15 text-white' : 'hover:bg-white/10'}`}>✎ {t('bf_varr_editor')}</button>
        </div>
        {noAudio && <div className="px-3 py-1 text-xs text-amber-300 bg-amber-900/30">{t('bf_varr_no_audio')}</div>}
        {/* 音轨区（照音悦家：左边音轨头＝乐器／删／M／S／音量／录音预备·右边那条画它的音符；选中那条亮蓝·点哪条就选哪条） */}
        <div ref={tracksRef} onScroll={(e) => syncX(e.currentTarget, gridRef.current)} data-testid="vedit-piano-tracks"
          className={`${editorOpen ? 'shrink-0 max-h-[40%]' : 'flex-1'} min-h-0 overflow-auto border-b border-white/10 relative`} style={editorOpen && tracksH ? { height: tracksH, maxHeight: 'none' } : undefined}>
          <div style={{ width: gridW + KEYS_W }} className="relative">
            <div className="sticky top-0 z-20 h-7 flex bg-[#1b1b2b] border-b border-white/10">
              <div className="sticky left-0 z-10 shrink-0 bg-[#1b1b2b]" style={{ width: KEYS_W }} />
              {ruler('vedit-piano-ruler')}
            </div>
            {arr.tracks.map((tr, ix) => {
              const on = tr.id === cur.id
              const tone = INST_TONE[tr.inst]
              const quiet = tr.mute || (anySolo && !tr.solo)
              return (
                <div key={tr.id} className="flex border-b border-black/30" style={{ height: TRACK_H }} data-testid="vedit-piano-track" data-track-id={tr.id} data-inst={tr.inst} data-sel={on ? '1' : '0'}>
                  <div className={`sticky left-0 z-10 shrink-0 flex flex-col justify-center gap-1 pl-3 pr-2 border-r border-white/10 cursor-pointer ${on ? 'bg-[#33334d]' : 'bg-[#23233a]'}`} style={{ width: KEYS_W }}
                    onPointerDown={(e) => { if ((e.target as HTMLElement).closest('[data-testid="vedit-piano-track-del"]')) return; selectTrack(tr.id) }} data-testid="vedit-piano-track-head">
                    <span className={`absolute left-0 top-0 bottom-0 w-1 ${on ? 'bg-indigo-500' : 'bg-transparent'}`} aria-hidden />
                    <span className="absolute left-1 top-0.5 text-[9px] text-neutral-500">{ix + 1}</span>
                    <div className="flex items-center gap-1">
                      {tr.audio ? (
                        <span className="h-6 flex-1 min-w-0 flex items-center gap-1 text-xs text-violet-200" title={tr.audio.name} data-testid="vedit-piano-track-audio">〰 <span className="truncate">{tr.audio.name || t('bf_varr_audio_track')}</span></span>
                      ) : null}
                      {tr.audio ? (() => {
                        // 上云盘的状态——传着＝进度圈（点开看进度、取消）·传好＝☁✓·还没传＝☁（点了传）
                        const c = tr.audio, u = ups.get(c.file)
                        if (u) return <button type="button" title={t('vedit_up_title')} aria-label={t('vedit_up_title')} onClick={() => setUpPop({ file: c.file, confirm: false })} data-testid="vedit-piano-track-up" data-p={u.p.toFixed(2)}
                          className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center hover:bg-white/10" style={{ background: `conic-gradient(#22d3ee ${Math.round(u.p * 360)}deg, rgba(255,255,255,0.12) 0)` }}>
                          <span className="w-4 h-4 rounded-full bg-[#23233a] text-[8px] leading-4 text-center text-cyan-200">{Math.round(u.p * 100)}</span></button>
                        if (c.driveId) return <span className="shrink-0 w-6 text-center text-[11px] text-emerald-300" title={t('vedit_up_done')} data-testid="vedit-piano-track-up-done">☁✓</span>
                        if (fetching.has(c.file)) return <span className="shrink-0 text-[10px] text-cyan-300 animate-pulse" data-testid="vedit-piano-track-fetching">{t('bf_varr_fetching')}</span>
                        return cloud ? <button type="button" title={t('vedit_up_title')} aria-label={t('vedit_up_title')} onClick={() => { void uploadClip(c) }} data-testid="vedit-piano-track-up-start"
                          className="shrink-0 w-6 h-6 rounded text-[12px] text-neutral-400 hover:bg-white/10 hover:text-white">☁</button> : null
                      })() : null}
                      {tr.audio ? null : (
                      <select value={tr.inst} onChange={(e) => { editTrack(patchTrack(arrRef.current, tr.id, { inst: e.target.value as InstrumentId }), true); selectTrack(tr.id) }} aria-label={t('bf_varr_track_inst')} data-testid="vedit-piano-track-inst"
                        style={BPM_INK} className="h-6 flex-1 min-w-0 rounded bg-black/30 px-1 text-xs">
                        {INSTRUMENTS.map((ins) => <option key={ins.id} value={ins.id} style={{ color: '#111' }}>{t(ins.label)}</option>)}
                      </select>
                      )}
                      <button type="button" disabled={arr.tracks.length <= 1} title={t('bf_varr_track_del')} aria-label={t('bf_varr_track_del')} onClick={() => editTrack(removeTrack(arrRef.current, tr.id), true)} data-testid="vedit-piano-track-del"
                        className="w-6 h-6 rounded text-[11px] text-neutral-400 hover:bg-white/10 disabled:opacity-20">✕</button>
                    </div>
                    <div className="flex items-center gap-1">
                      <button type="button" title={t('bf_varr_mute')} onClick={() => editTrack(patchTrack(arrRef.current, tr.id, { mute: !tr.mute }), true)} data-testid="vedit-piano-track-mute" data-on={tr.mute ? '1' : '0'}
                        className={`w-6 h-5 rounded text-[10px] font-bold ${tr.mute ? 'bg-amber-400 text-black' : 'bg-white/10 text-neutral-300'}`}>M</button>
                      <button type="button" title={t('bf_varr_solo')} onClick={() => editTrack(patchTrack(arrRef.current, tr.id, { solo: !tr.solo }), true)} data-testid="vedit-piano-track-solo" data-on={tr.solo ? '1' : '0'}
                        className={`w-6 h-5 rounded text-[10px] font-bold ${tr.solo ? 'bg-yellow-400 text-black' : 'bg-white/10 text-neutral-300'}`}>S</button>
                      <input type="range" min={0} max={100} value={Math.round(tr.vol * 100)} onPointerDown={pushHist} onKeyDown={pushHist} onChange={(e) => editTrack(patchTrack(arrRef.current, tr.id, { vol: Number(e.target.value) / 100 }))}
                        aria-label={t('bf_varr_track_vol')} title={t('bf_varr_track_vol')} data-testid="vedit-piano-track-vol" className="flex-1 min-w-0 h-3 accent-emerald-500" />
                      {/* 录音预备：亮着的那条＝录音录进去的那条（就是选中那条） */}
                      <button type="button" title={t('bf_varr_rec_arm')} aria-label={t('bf_varr_rec_arm')} onClick={() => selectTrack(tr.id)} data-testid="vedit-piano-track-arm" data-on={on && !tr.audio ? '1' : '0'}
                        className={`w-6 h-5 rounded flex items-center justify-center ${tr.audio ? 'invisible' : ''} ${on ? 'text-rose-400' : 'text-neutral-500 hover:text-neutral-300'}`}>
                        <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5" aria-hidden><path d="M8 1a2.5 2.5 0 0 0-2.5 2.5v4a2.5 2.5 0 0 0 5 0v-4A2.5 2.5 0 0 0 8 1Z" /><path d="M3.5 7a.5.5 0 0 1 1 0 3.5 3.5 0 0 0 7 0 .5.5 0 0 1 1 0 4.5 4.5 0 0 1-4 4.47V13.5h1.5a.5.5 0 0 1 0 1h-4a.5.5 0 0 1 0-1h1.5v-2.03A4.5 4.5 0 0 1 3.5 7Z" /></svg>
                      </button>
                    </div>
                  </div>
                  {/* 这条轨上一段一段的片段（点选·同轨拖·两端拉裁·右键选单·裁刀） */}
                  <div className={`relative select-none touch-none ${on ? 'bg-indigo-500/15' : 'bg-[#1f1f30]'} ${quiet ? 'opacity-40' : ''}`} style={{ width: gridW, ...(knife ? { cursor: KNIFE_CURSOR } : {}) }}
                    onPointerDown={onLaneDown(tr)} onPointerMove={onLaneMove} onPointerUp={onLaneUp} onPointerCancel={onLaneUp} onContextMenu={onLaneMenu(tr)} data-testid="vedit-piano-track-lane" data-knife={knife ? '1' : '0'}>
                    {segsOf(tr, arr.bpm).map((g) => {
                      const picked = !!selSeg && selSeg.track === tr.id && selIds().includes(g.id)
                      const pc = tr.audio ? piecesOf(tr).find((x) => x.id === g.id) : undefined
                      const vis = pc ? Math.max(0, Math.min(pc.at + pc.len, songSec) - pc.at) : 0
                      const w = Math.max(4, (pc ? vis / st : g.l) * STEP_W)
                      return (
                        <div key={g.id} data-seg-id={g.id} data-testid="vedit-piano-seg" data-s={g.s.toFixed(3)} data-l={g.l.toFixed(3)} data-sel={picked ? '1' : '0'}
                          className={`absolute top-1 bottom-1 rounded-md overflow-hidden border ${tr.audio ? 'bg-violet-500/40 border-violet-200/40 text-violet-100' : SEG_TONE[tr.inst]} ${picked ? 'ring-2 ring-white z-[1]' : ''} ${knife ? '' : 'cursor-grab active:cursor-grabbing'}`}
                          style={{ left: g.s * STEP_W, width: w }}>
                          <span className="absolute left-1.5 top-0.5 text-[10px] text-white/90 truncate max-w-[90%] pointer-events-none">{tr.audio ? (tr.audio.name || t('bf_varr_audio_track')) : t(instrumentOf(tr.inst).label)}</span>
                          {tr.audio && pc ? (
                            <div className="absolute inset-x-0 top-3.5 bottom-0 pointer-events-none" data-testid="vedit-piano-clip" data-file={tr.audio.file}>
                              {missing.has(tr.audio.file)
                                ? <span className="absolute inset-0 flex items-center px-2 text-[10px] text-amber-300 whitespace-nowrap" data-testid="vedit-piano-clip-missing">{t('bf_varr_audio_missing')}</span>
                                : <ArrWave peaks={peaks[tr.audio.file]} off={pc.off} dur={vis} widthPx={w} gain={tr.vol} />}
                            </div>
                          ) : tr.notes.filter((n) => n.s >= g.s && n.s < g.s + g.l).map((n) => (
                            <div key={n.id} className="absolute rounded-[1px] bg-white/90 pointer-events-none" style={{ left: (n.s - g.s) * STEP_W, width: Math.max(2, n.l * STEP_W - 1), height: 3, top: 15 + ((PITCH_HI - n.p) / (PITCH_HI - PITCH_LO)) * (TRACK_H - 26) }} />
                          ))}
                          {!knife && <>
                            <div data-seg-edge="l" data-testid="vedit-piano-seg-edge-l" title={t('bf_varr_seg_trim')} className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-white/35" />
                            <div data-seg-edge="r" data-testid="vedit-piano-seg-edge-r" title={t('bf_varr_seg_trim')} className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-white/35" />
                          </>}
                        </div>
                      )
                    })}
                    {/* 录音中这趟那段从开录那格画到播放头（每帧跟着长） */}
                    {rec && playing && !tr.audio && takeRef.current?.track === tr.id && pos > takeRef.current.from && (
                      <div data-testid="vedit-piano-rec-seg" className={`absolute top-1 bottom-1 rounded-md border pointer-events-none z-[1] ${SEG_TONE[tr.inst]}`}
                        style={{ left: takeRef.current.from * STEP_W, width: (pos - takeRef.current.from) * STEP_W }}>
                        {tr.notes.filter((n) => takeRef.current!.ids.has(n.id)).map((n) => (
                          <div key={n.id} className="absolute rounded-[1px] bg-white/90" style={{ left: (n.s - takeRef.current!.from) * STEP_W, width: Math.max(2, n.l * STEP_W - 1), height: 3, top: 15 + ((PITCH_HI - n.p) / (PITCH_HI - PITCH_LO)) * (TRACK_H - 26) }} />
                        ))}
                      </div>
                    )}
                    <div className="absolute top-0 bottom-0 w-px bg-rose-500 pointer-events-none z-[2]" style={{ left: Math.max(0, pos) * STEP_W }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
        {/* 编辑器（钢琴卷帘·照音悦家下半部）：自己一排工具（吸附、量化、关闭）·左边琴键（纵轴＝音高）·上面小节（横轴＝时间） */}
        {editorOpen && splitBar('tracks')}
        {editorOpen && (
          <div className="flex-1 min-h-0 flex flex-col" data-testid="vedit-piano-editor">
            <div className="h-9 shrink-0 flex items-center gap-2 px-3 border-b border-white/10 bg-[#202034] text-neutral-300">
              <span className="text-xs text-neutral-400">✎ {t('bf_varr_editor')} · {curLabel}</span>
              <label className="ml-auto flex items-center gap-1 text-xs text-neutral-400">{t('bf_varr_snap')}
                <select value={snap} onChange={(e) => setSnap(Number(e.target.value) as Snap)} data-testid="vedit-piano-snap" style={BPM_INK} className="h-7 rounded bg-black/30 px-1 text-xs">
                  {SNAP_CHOICES.map((q) => <option key={q} value={q} style={{ color: '#111' }}>{t(SNAP_LABEL[q])}</option>)}
                </select></label>
              <button type="button" disabled={snap <= 1 || !cur.notes.length} onClick={quantize} data-testid="vedit-piano-quantize" title={t('bf_varr_quantize_tip')}
                className={`${tool} bg-sky-600 hover:bg-sky-500 text-white disabled:opacity-30`}>{t('bf_varr_quantize')}</button>
              <button type="button" onClick={() => { if (cur.notes.length && window.confirm(t('bf_varr_clear_ask'))) commit([]) }} data-testid="vedit-piano-clear" className={`${tool} hover:bg-white/10`}>{t('bf_varr_clear')}</button>
              <button type="button" onClick={() => setEditorOpen(false)} aria-label={t('bf_varr_close')} title={t('bf_varr_close')} data-testid="vedit-piano-editor-close" className={`${tool} hover:bg-white/10`}>✕</button>
            </div>
            {cur.audio ? (
              <div className="flex-1 min-h-0 flex items-center justify-center px-6 text-center text-xs text-neutral-400" data-testid="vedit-piano-audio-note">{t('bf_varr_audio_no_edit')}</div>
            ) : (
            <div ref={gridRef} onScroll={(e) => syncX(e.currentTarget, tracksRef.current)} className="flex-1 min-h-0 overflow-auto relative" data-testid="vedit-piano-scroll">
              <div style={{ width: gridW + KEYS_W, height: gridH + 24 }} className="relative">
                <div className="sticky top-0 z-20 h-6 flex bg-[#1b1b2b] border-b border-white/10" data-testid="vedit-piano-top">
                  <div className="sticky left-0 z-10 shrink-0 bg-[#1b1b2b]" style={{ width: KEYS_W }} />
                  {ruler()}
                </div>
                <div className="flex">
                  <div className="sticky left-0 z-10 shrink-0 bg-[#15151f] flex" style={{ width: KEYS_W }}>
                    <div className="flex-1" />
                    <div className="w-16">
                      {rows.map((p) => (
                        <div key={p} style={{ height: ROW_H }} className={`text-[9px] leading-[14px] pr-1 text-right border-b border-black/40 ${isBlack(p) ? 'bg-neutral-800 text-neutral-500' : 'bg-neutral-200 text-neutral-600'} ${down.has(p) ? '!bg-emerald-400 !text-black' : ''}`}>{p % 12 === 0 ? noteName(p) : ''}</div>
                      ))}
                    </div>
                  </div>
                  <div className="relative select-none touch-none" style={{ width: gridW, height: gridH }} data-testid="vedit-piano-grid"
                    onPointerDown={onGridDown} onPointerMove={onGridMove} onPointerUp={onGridUp} onPointerCancel={onGridUp}>
                    {/* 调外的音那几行淡掉（选了调号才看得出差别·C 大调＝黑键那几行） */}
                    {rows.map((p, i) => inKey(p, arr.key) ? null : <div key={p} data-testid="vedit-piano-offkey" className="absolute left-0 right-0 bg-black/35 pointer-events-none" style={{ top: i * ROW_H, height: ROW_H }} />)}
                    <div className="absolute inset-0 pointer-events-none" style={{
                      backgroundImage: `linear-gradient(to right, rgba(255,255,255,0.22) 1px, transparent 1px), linear-gradient(to right, rgba(255,255,255,0.09) 1px, transparent 1px), linear-gradient(to right, rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(to bottom, rgba(0,0,0,0.35) 1px, transparent 1px)`,
                      backgroundSize: `${STEPS_PER_BAR * STEP_W}px 100%, ${STEPS_PER_BEAT * STEP_W}px 100%, ${STEP_W}px 100%, 100% ${ROW_H}px`,
                    }} />
                    {arr.tracks.filter((x) => x.id !== cur.id).map((x) => x.notes.map((n) => (
                      <div key={`${x.id}:${n.id}`} data-testid="vedit-piano-ghost" className={`absolute rounded-sm opacity-25 pointer-events-none ${INST_TONE[x.inst].mini}`}
                        style={{ left: n.s * STEP_W + 1, top: (PITCH_HI - n.p) * ROW_H + 3, width: n.l * STEP_W - 2, height: ROW_H - 6 }} />
                    )))}
                    {cur.notes.map((n) => (
                      <div key={n.id} data-testid="vedit-piano-note" data-note-id={n.id} data-p={n.p} data-s={n.s} data-l={n.l}
                        className={`absolute rounded-sm border shadow-sm cursor-grab ${INST_TONE[cur.inst].note}`} style={{ left: n.s * STEP_W + 1, top: (PITCH_HI - n.p) * ROW_H + 1, width: n.l * STEP_W - 2, height: ROW_H - 2 }}>
                        <div data-note-edge="1" className="absolute right-0 top-0 bottom-0 w-1.5 cursor-ew-resize" />
                      </div>
                    ))}
                    <div className="absolute top-0 bottom-0 w-px bg-white/80 pointer-events-none" style={{ left: Math.max(0, pos) * STEP_W }} data-testid="vedit-piano-head" data-pos={pos.toFixed(2)} />
                  </div>
                </div>
              </div>
              {!cur.notes.length && <div className="pointer-events-none absolute left-1/2 top-1/3 -translate-x-1/2 text-xs text-neutral-500 bg-black/40 rounded px-3 py-1.5" data-testid="vedit-piano-empty">{t('bf_varr_empty')}</div>}
            </div>
            )}
            <div className="shrink-0 px-3 py-1 text-[11px] text-neutral-500 border-t border-white/10">{t('bf_varr_grid_help')}</div>
          </div>
        )}
        {splitBar('keys')}
        {/* 最底下：琴键（滑鼠按、拖过去会滑奏；电脑键盘 A 排白键·字母标在键上）·高度照上面那条横条 */}
        <div className="shrink-0 flex items-stretch gap-2 px-3 pb-3 pt-1 bg-[#14141f]" style={{ height: keyH }} data-testid="vedit-piano-keyboard">
          <div className="flex flex-col justify-center gap-1">
            <button type="button" className={`${btn} bg-white/10 hover:bg-white/15`} title={t('bf_varr_oct_up')} onClick={() => setBase((b) => shiftBase(b, 1))} data-testid="vedit-piano-oct-up">›</button>
            <span className="text-[10px] text-center text-neutral-400" data-testid="vedit-piano-base">{noteName(base)}</span>
            <button type="button" className={`${btn} bg-white/10 hover:bg-white/15`} title={t('bf_varr_oct_down')} onClick={() => setBase((b) => shiftBase(b, -1))} data-testid="vedit-piano-oct-down">‹</button>
          </div>
          <div className="relative flex-1 select-none touch-none" data-testid="vedit-piano-keys">
            {whites.map((p, i) => (
              <div key={p} data-testid="vedit-piano-key" data-p={p} onPointerDown={keyDown(p)} onPointerEnter={keyEnter(p)}
                className={`absolute top-0 bottom-0 rounded-b-md border border-neutral-400 flex flex-col items-center justify-end pb-1 text-[10px] ${down.has(p) ? 'bg-emerald-300' : 'bg-neutral-50 hover:bg-white'}`}
                style={{ left: `${(i / whites.length) * 100}%`, width: `${100 / whites.length}%` }}>
                {keyHint.has(p) && <span className="text-neutral-400">{keyHint.get(p)}</span>}
                {p % 12 === 0 && <span className="text-neutral-500">{noteName(p)}</span>}
              </div>
            ))}
            {keys.filter(isBlack).map((p) => {
              const i = whites.filter((w) => w < p).length
              return (
                <div key={p} data-testid="vedit-piano-key" data-p={p} onPointerDown={keyDown(p)} onPointerEnter={keyEnter(p)}
                  className={`absolute top-0 z-10 rounded-b-md flex items-end justify-center pb-1 text-[9px] ${down.has(p) ? 'bg-emerald-500' : 'bg-neutral-900 hover:bg-neutral-700'} text-neutral-400`}
                  style={{ left: `calc(${(i / whites.length) * 100}% - ${100 / whites.length / 3}%)`, width: `${(100 / whites.length) * 0.62}%`, height: '62%' }}>
                  {keyHint.get(p)}
                </div>
              )
            })}
          </div>
        </div>
        {menu && (() => {
          const s = { track: menu.track, id: menu.id }
          const items: Array<{ k: string; label: string; key?: string; on: boolean; run: () => void }> = [
            { k: 'copy', label: t('bf_varr_seg_copy'), key: 'Ctrl+C', on: true, run: () => segCopy(s) },
            { k: 'cut', label: t('bf_varr_seg_cut'), key: 'Ctrl+X', on: true, run: () => segCut(s) },
            { k: 'paste', label: t('bf_varr_seg_paste'), key: 'Ctrl+V', on: hasClip, run: segPaste },
            { k: 'split', label: t('bf_varr_seg_split'), key: 'Ctrl+B', on: true, run: () => setKnife(true) },
            { k: 'delete', label: t('bf_varr_seg_delete'), key: 'Del', on: true, run: () => segDelete(s) },
            { k: 'merge', label: t('bf_varr_seg_merge'), on: !busy && canMergeSegs(arr, s.track, selIds()), run: () => { void segMerge(s.track, selIds()) } },
            { k: 'media', label: t('bf_varr_seg_to_media'), on: !!onAddMedia && !busy, run: () => { void segToMedia(s) } },
          ]
          return (
            <>
              <div className="fixed inset-0 z-[90]" onPointerDown={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null) }} data-testid="vedit-piano-seg-menu-backdrop" />
              <div role="menu" className="fixed z-[91] w-48 rounded-lg bg-[#26263a] border border-white/10 shadow-xl py-1 text-xs" data-testid="vedit-piano-seg-menu"
                style={{ left: Math.min(menu.x, (typeof window === 'undefined' ? 9999 : window.innerWidth) - 200), top: Math.min(menu.y, (typeof window === 'undefined' ? 9999 : window.innerHeight) - 220) }}>
                {items.map((it) => (
                  <button key={it.k} type="button" role="menuitem" disabled={!it.on} data-testid={`vedit-piano-seg-${it.k}`} onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { setMenu(null); it.run() }} className="w-full flex items-center px-3 py-1.5 hover:bg-white/10 disabled:opacity-35 disabled:hover:bg-transparent">
                    <span className="flex-1 text-left">{it.label}</span>{it.key && <span className="text-[10px] text-neutral-500">{it.key}</span>}
                  </button>
                ))}
              </div>
            </>
          )
        })()}
        {/* 右下角一行音色出处（Salamander 是 CC BY 3.0 ⇒ 写作者、授权、已转档） */}
        <div className="shrink-0 px-3 pb-1 -mt-1 bg-[#14141f] text-right text-[10px] leading-4 text-neutral-500 truncate" data-testid="vedit-piano-credits" title={t('bf_varr_credits')}>
          {t('bf_varr_credits')} · {creditUrl ? <a href={creditUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-neutral-300" data-testid="vedit-piano-credits-license">CC BY 3.0</a> : <span data-testid="vedit-piano-credits-license">CC BY 3.0</span>}
        </div>
      </div>
    </div>,
    document.body,
  )
}

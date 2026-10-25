'use client'
// 网页剪辑页·编曲「拆曲」交給終端那条（整首歌拆成人声、鼓、贝斯、吉他、钢琴、其他六轨）：
//   SongStemsRunner 由剪辑页本身拿着（不跟着编曲分页走）⇒ 跑到一半切去别的分页照跑、回来接得上进度；
//   只有按取消（cancel）或关掉剪辑页（dispose）才算取消（runShellJob 看到 cancelled() ⇒ 发 media_cancel）。
//   离开编曲分页时进度显示在右下角那张小卡（剪辑页拿 asClipJob 给 ClipStemsPanel）。
import { useEffect, useRef, useSyncExternalStore } from 'react'
import { STEM_NAMES, type MediaDevice, type StemName } from '../lib/shell-media.pure'
import { ShellJobError, shellErrText, type ShellPhase, type VeditShellApi } from '../lib/shell-job'
import type { ClipStemsJob } from './ClipStems'

type TFn = (k: string) => string
export type SongStemsState = { phase: ShellPhase | null; msg: { ok: boolean; text: string } | null; song: string | null; device: string | null }
export type SongStemsEnv = {
  api: Pick<VeditShellApi, 'runShellJob' | 'fetchDriveBlob'>
  put: (f: File, onP: (p: number) => void) => Promise<{ fileId: string; folderId: string | null }>
  /** 原曲＋六轨进素材区（同编曲拆曲：原曲已在素材区就只加分轨） */
  addMedia: (mix: File, stems: File[]) => Promise<void> | void
  t: TFn
}
/** 编曲面板开跑时给的：mix＝交出去的那份声音（影片先抽成 WAV）·names＝六轨档名 */
export type SongStemsJob = { mix: () => Promise<File>; names: Record<StemName, string> }

const IDLE: SongStemsState = { phase: null, msg: null, song: null, device: null }

export class SongStemsRunner {
  private run = 0
  private state: SongStemsState = IDLE
  private subs = new Set<() => void>()
  constructor(private env: () => SongStemsEnv) {}
  get = (): SongStemsState => this.state
  subscribe = (fn: () => void) => { this.subs.add(fn); return () => { this.subs.delete(fn) } }
  private set(s: Partial<SongStemsState>) { this.state = { ...this.state, ...s }; this.subs.forEach((f) => f()) }
  get busy() { return this.state.phase !== null }
  /** 交终端拆这首（已经在跑 ⇒ 不收） */
  start = async (dev: Pick<MediaDevice, 'role' | 'deviceId'> & { name?: string }, song: File, job: SongStemsJob) => {
    if (this.busy) return
    const run = ++this.run
    const live = () => this.run === run
    const e0 = this.env()
    this.set({ phase: { kind: 'upload', p: 0 }, msg: null, song: song.name, device: dev.name ?? null })
    try {
      const mix = await job.mix()
      if (!live()) return
      const res = await e0.api.runShellJob({ dev, kind: 'stems', file: mix, put: e0.put, onPhase: (p) => { if (live()) this.set({ phase: p }) }, cancelled: () => !live() })
      if (res.kind !== 'stems') throw new ShellJobError('failed')
      const files = await Promise.all(STEM_NAMES.map(async (k) => new File([await e0.api.fetchDriveBlob(res.files[k])], job.names[k], { type: 'audio/mpeg' })))
      if (!live()) return
      await this.env().addMedia(mix, files)
      if (!live()) return
      this.set({ phase: null, msg: { ok: true, text: this.env().t('vedit_shell_stems_done') } })
    } catch (err) {
      if (!live()) return
      this.set({ phase: null, msg: { ok: false, text: shellErrText(this.env().t, err) } })
    }
  }
  /** 用户按取消 */
  cancel = () => { this.run++; this.set({ phase: null }) }
  /** 关掉剪辑页 */
  dispose = () => { this.run++ }
  /** 右下角小卡用（离开编曲分页时） */
  asClipJob = (): ClipStemsJob | null => {
    const s = this.state
    return s.phase ? { k: 0, of: 1, name: s.song ?? '', device: s.device ?? '', phase: { kind: 'shell', ph: s.phase } } : null
  }
}

/** 剪辑页拿一只（整页活多久它活多久·关页才取消） */
export function useSongStems(env: SongStemsEnv) {
  const envRef = useRef(env)
  envRef.current = env
  const ref = useRef<SongStemsRunner | null>(null)
  const r = ref.current ?? (ref.current = new SongStemsRunner(() => envRef.current))
  useEffect(() => () => r.dispose(), [r])
  const state = useSyncExternalStore(r.subscribe, r.get, r.get)
  return { runner: r, state }
}

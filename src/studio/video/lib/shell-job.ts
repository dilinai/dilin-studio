// 剪辑「交给终端」（识别字幕、拆曲、转剪辑用小档交给用户自己电脑上的终端跑）那条路的共用型别与错误。
//   真正下单、盯进度、取回结果要网站后端，由宿主（页面的 host.shell）提供；游客版没有这条路（host.shell＝null）。
import type { MediaDevice, MediaJob, MediaKind, MediaResult } from './shell-media.pure'
import type { ComputeStep } from './compute-failover.pure'

/** 跑着的样子：upload＝传云盘（0～1）·send＝下单中·job＝那台报的进度 */
export type ShellPhase = { kind: 'upload'; p: number } | { kind: 'send' } | { kind: 'job'; job: MediaJob | null }

/** 失败原因（页面照它挑字）：upload＝传云盘失败·send＝下单没送出·pickup＝那台没接到·failed＝那台跑失败（msg＝它报的白话）·cancelled＝取消 */
export class ShellJobError extends Error {
  constructor(public why: 'upload' | 'send' | 'pickup' | 'failed' | 'cancelled', msg = '') { super(msg || why) }
}

/** 进度条那一格：传云盘占头 15% */
export function shellPhasePct(p: ShellPhase | null): number {
  if (!p) return 0
  if (p.kind === 'upload') return Math.round(p.p * 15)
  if (p.kind === 'send') return 15
  return 15 + Math.round(((p.job?.pct ?? 0) * 85) / 100)
}

/** 交给终端失败那句（那台报的白话原因照字带上） */
export function shellErrText(t: (k: string) => string, e: unknown): string {
  const why = e instanceof ShellJobError ? e.why : 'failed'
  if (why === 'cancelled') return t('vedit_shell_cancelled')
  if (why === 'upload') return t('vedit_shell_err_upload')
  if (why === 'send') return t('vedit_shell_send_fail')
  if (why === 'pickup') return t('vedit_shell_err_pickup')
  const msg = e instanceof ShellJobError && e.message !== 'failed' ? e.message : ''
  return msg ? t('vedit_shell_err_failed_msg').replace('{msg}', msg) : t('vedit_shell_err_failed')
}

export type ShellPut = (f: File, onP: (p: number) => void) => Promise<{ fileId: string; folderId: string | null }>
export type ShellJobOpts = {
  dev: Pick<MediaDevice, 'role' | 'deviceId'>; kind: MediaKind; lang?: string
  onPhase: (p: ShellPhase) => void; cancelled: () => boolean
} & ({ file: File; put: ShellPut } | { have: { fileId: string; folderId: string | null } })

/** 「挑哪台、交給終端／安装」那一块的属性（画面由宿主给） */
export type ShellPickerProps = {
  kind: MediaKind; devices: MediaDevice[] | null; phase: ShellPhase | null; disabled?: boolean
  onRun: (dev: MediaDevice) => void; onCancel: () => void
}

/** 宿主提供的「交给终端」整组（登入版＝网站后端；游客版没有）。两只 use… 是 React hook，页面每次渲染都会叫。 */
export interface VeditShellApi {
  useMediaDevices(active: boolean): MediaDevice[] | null
  useLocalDeviceId(): string | null
  fetchMediaDevices(): Promise<MediaDevice[] | null>
  runShellJob(o: ShellJobOpts): Promise<MediaResult>
  /** 结果档（云盘编号）取回 */
  fetchDriveBlob(id: string): Promise<Blob>
  /** 交终端失败后下一步换哪台／改浏览器（宿主读开关与电脑清单） */
  computeFailover(e: unknown, o: { kind: MediaKind; tried: readonly string[]; local: string | null; web: () => boolean | Promise<boolean> }): Promise<ComputeStep>
  /** 挑哪台电脑那一块 */
  renderPicker(p: ShellPickerProps): import('react').ReactNode
}

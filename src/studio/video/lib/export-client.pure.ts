// ── 剪辑导出·网页端下一版·纯逻辑──────────────────────
// 本档只放没有 IO 的部分（题：vedit-export-client.test.ts）：
//   ① LocalCopy：边渲染边传时另留一份整档在这台浏览器（上传彻底失败 ⇒ 照样给下载、再按一次存雲盤用它整份传）；
// ② renderCapability：这台装置能不能在网页里渲染；
//   ③ exportTargetOptions：导出弹窗「用哪台电脑导出」下拉（第一项这台·其余本人在线实体电脑·⛔ 雲電腦）；
//   ④ driveFlow：存雲盤那条的状态机（边渲染边传失败 ⇒ 不中断渲染、留本机、可再按一次存雲盤走整份上传）；
//   ⑤ uploadFailPolicy／stallGiveUp／streamFailDetail：上传失败时渲染要不要停、断线多久算彻底失败、无头页回报的白话。

// ── ① 本机整档 ─────────────────────────────────────────────────────────────────
/**
 * 收 StreamTarget 的 (position, data) 写入拼成整档：接在尾巴 ⇒ 照接；落在已写范围 ⇒ 原地改（跨块也改）；跳过尾巴 ⇒ 中间补 0。
 * 每块都复制一份（写入方之后可能重用那块记忆体）。clear() 放掉全部引用（失败／取消时调）。
 */
export class LocalCopy {
  private chunks: Uint8Array<ArrayBuffer>[] = []
  private starts: number[] = []
  private len = 0
  get size(): number { return this.len }
  write(position: number, data: Uint8Array): void {
    if (!Number.isSafeInteger(position) || position < 0) throw new RangeError('position')
    if (position > this.len) this.push(new Uint8Array(position - this.len))
    const end = position + data.length
    // 已写范围内的那段 ⇒ 原地改
    if (position < this.len) {
      const upto = Math.min(end, this.len)
      for (let i = this.findChunk(position); i < this.chunks.length && this.starts[i] < upto; i++) {
        const c = this.chunks[i], s = this.starts[i]
        const a = Math.max(position, s), b = Math.min(upto, s + c.length)
        if (b > a) c.set(data.subarray(a - position, b - position), a - s)
      }
    }
    if (end > this.len) this.push(data.slice(this.len - position))
  }
  private push(bytes: Uint8Array<ArrayBuffer>) {
    if (!bytes.length) return
    this.starts.push(this.len); this.chunks.push(bytes); this.len += bytes.length
  }
  private findChunk(pos: number): number {
    let lo = 0, hi = this.chunks.length - 1
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (this.starts[mid] <= pos) lo = mid; else hi = mid - 1 }
    return lo
  }
  toBlob(type = 'video/mp4'): Blob { return new Blob(this.chunks, { type }) }
  clear(): void { this.chunks = []; this.starts = []; this.len = 0 }
}

// ── ② 装置能不能渲染 ───────────────────────────────────────────────────────────
export type RenderProbe = {
  /** typeof VideoEncoder !== 'undefined' */ videoEncoder: boolean
  /** typeof VideoFrame !== 'undefined' */ videoFrame: boolean
  /** matchMedia('(pointer: coarse)')——主要指针是手指 */ pointerCoarse: boolean
  /** matchMedia('(any-pointer: fine)')——接着滑鼠／触控板（平板接键盘触控板也算） */ anyPointerFine: boolean
  /** navigator.userAgentData?.mobile（Chromium 才有·不知道＝null） */ uaMobile: boolean | null
  /** screen 短边（CSS px） */ screenShort: number
  /** navigator.maxTouchPoints */ touchPoints: number
}
export type RenderVerdict = { ok: true } | { ok: false; reason: 'no_encoder' | 'mobile' | 'touch_only' | 'small_touch' }
/** 手机那级的触控屏短边（CSS px）·平板直放 ≥ 744 */
export const SMALL_TOUCH_SCREEN = 600
/**
 * 。判法保守（宁可放进来、不误挡电脑）——只有下面任一条成立才挡：
 *  1. 没有 WebCodecs（VideoEncoder 或 VideoFrame 不在）⇒ 根本编不了影片（no_encoder）；
 *  2. 浏览器自报是手机（userAgentData.mobile === true·只 Chromium 有）⇒ mobile；
 *  3. 主要指针是手指、且没接任何精确指针（滑鼠／触控板）⇒ 手机／没接键盘的平板（touch_only）；
 *  4. 有触控、且屏幕短边 < 600 ⇒ 手机大小（small_touch·就算接了滑鼠也不够放剪辑页）。
 * 带触控屏的笔电（主要指针是触控板＝fine）、接了触控板键盘的平板、窗口拉小的电脑 ⇒ 都放行。
 */
export function renderCapability(p: RenderProbe): RenderVerdict {
  if (!p.videoEncoder || !p.videoFrame) return { ok: false, reason: 'no_encoder' }
  if (p.uaMobile === true) return { ok: false, reason: 'mobile' }
  if (p.pointerCoarse && !p.anyPointerFine) return { ok: false, reason: 'touch_only' }
  if (p.touchPoints > 0 && p.screenShort > 0 && p.screenShort < SMALL_TOUCH_SCREEN) return { ok: false, reason: 'small_touch' }
  return { ok: true }
}

// ── ③ 「用哪台电脑导出」下拉 ─────────────────────────────────────────────────────
/** GET /api/device/terminal/devices 那一列（只取用得到的栏） */
export type DeviceRowLike = { device_id: string; name: string | null; machine_name?: string | null; online: boolean; cloud_pc?: boolean; os?: string | null; arch?: string | null }
export type ExportTargetOption = { value: 'here'; label: string } | { value: string; label: string; deviceId: string; weak: boolean }
export const EXPORT_TARGET_HERE = 'here' as const
/** 别台导出那笔任务在弹窗里的样子（POST／GET /api/vedit/export 回的 jobView）·认不出的状态当 queued；进度只进不退 */
export type RemoteView = { phase: 'saving' | 'queued' | 'running' | 'done' | 'failed' | 'cancelled'; progress: number; jobId: string | null; device: string | null; fileId: string | null; error: string | null }
export function remoteFromJob(j: unknown, prev?: RemoteView | null): RemoteView {
  const o = (j && typeof j === 'object' ? j : {}) as Record<string, unknown>
  const st = String(o.status ?? '')
  const phase: RemoteView['phase'] = st === 'running' || st === 'done' || st === 'failed' || st === 'cancelled' ? st : 'queued'
  const p = Number(o.progress)
  const progress = phase === 'done' ? 100 : Math.max(prev?.progress ?? 0, Number.isFinite(p) ? Math.min(100, Math.max(0, p)) : 0)
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null)
  return { phase, progress, jobId: str(o.job_id) ?? prev?.jobId ?? null, device: str(o.device) ?? prev?.device ?? null, fileId: str(o.drive_file_id), error: phase === 'failed' ? str(o.error) ?? str(o.error_code) ?? '' : null }
}
export const remoteActive = (r: RemoteView | null) => !!r && (r.phase === 'saving' || r.phase === 'queued' || r.phase === 'running')

// ── ③b 别台导出「一段」────────────────────────
/** POST /api/vedit/export 要带的范围（ExportRange ⇒ range＋only）；整条 ⇒ {}（⛔ 带 range） */
export function exportPartBody(r: { from: number; to: number; only?: ReadonlySet<string> | readonly string[] } | null | undefined): { range?: { from: number; to: number }; only?: string[] } {
  if (!r) return {}
  const only = r.only ? [...r.only] : null
  return { range: { from: r.from, to: r.to }, ...(only && only.length ? { only } : {}) }
}
/**
 * 要了一段的任务，回包认不认得范围：
 *   ok         没要一段，或服务端回了 part、那台照办（或还没开跑）
 *   server_old 要了一段而回包没有 part ⇒ 服务端是旧版（不认得 range／only·会导整条）⇒ 叫的那头取消任务、白话说明
 *   ignored    part.honored === false ⇒ 那台是旧版导出页／旧版 run 口收的、导的是整条 ⇒ ⛔ 把成品当那一段收
 */
export function remotePartVerdict(sentPart: boolean, j: unknown): 'ok' | 'server_old' | 'ignored' {
  if (!sentPart) return 'ok'
  const p = (j && typeof j === 'object' ? (j as Record<string, unknown>).part : undefined) as { honored?: unknown } | undefined
  if (!p || typeof p !== 'object') return 'server_old'
  return p.honored === false ? 'ignored' : 'ok'
}

/** 选着的那台已经不在清单里（下线了）⇒ 退回「这台电脑」 */
export const keepTarget = (cur: string, opts: readonly ExportTargetOption[]) => (opts.some((o) => o.value === cur) ? cur : EXPORT_TARGET_HERE)

// ── ④ 存雲盤状态机 ─────────────────────────────────────────────────────────────
/**
 * off       没在存（纯导出·或还没按存雲盤）
 * streaming 边渲染边传（stalled＝断线等恢复）
 * done      存好了（fileId）
 * failed    边传那条彻底失败（full＝云盘满）——渲染照跑完、成片留在本机；可「再按一次存雲盤」⇒ reup
 * reup      整份上传本机那份 blob（p 0～1）
 */
export type DriveFlow =
  | { k: 'off' }
  | { k: 'streaming'; stalled: boolean; uploaded: number; produced: number }
  | { k: 'done'; fileId: string | null }
  | { k: 'failed'; full: boolean }
  | { k: 'reup'; p: number }
export type DriveEvt =
  | { t: 'reset' }              // 重新开始导出
  | { t: 'stream_start' }
  | { t: 'up_status'; phase: string; uploaded: number; produced: number }
  | { t: 'up_done'; fileId: string | null }
  | { t: 'up_fail'; full: boolean }
  | { t: 'render_fail' }        // 渲染失败／取消 ⇒ 这次的上传一并作废（调用方 cancel 上传）
  | { t: 'press_drive' }        // 按「存雲盤」（渲染完之后）
  | { t: 'reup_progress'; p: number }
  | { t: 'reup_done'; fileId: string | null }
  | { t: 'reup_fail'; full: boolean }
  | { t: 'reup_cancel' }
export const DRIVE_OFF: DriveFlow = { k: 'off' }
export function driveFlow(s: DriveFlow, e: DriveEvt): DriveFlow {
  switch (e.t) {
    case 'reset': return DRIVE_OFF
    case 'stream_start': return { k: 'streaming', stalled: false, uploaded: 0, produced: 0 }
    case 'up_status': return s.k === 'streaming' ? { k: 'streaming', stalled: e.phase === 'stalled', uploaded: e.uploaded, produced: e.produced } : s
    case 'up_done': return s.k === 'streaming' ? { k: 'done', fileId: e.fileId } : s
    // 边传途中彻底失败 ⇒ 记下失败（渲染不动）·之后可再按一次存雲盤
    case 'up_fail': return s.k === 'streaming' ? { k: 'failed', full: e.full } : s
    case 'render_fail': return s.k === 'streaming' ? DRIVE_OFF : s
    case 'press_drive': return s.k === 'off' || s.k === 'failed' ? { k: 'reup', p: 0 } : s
    case 'reup_progress': return s.k === 'reup' ? { k: 'reup', p: Math.max(s.p, Math.min(1, e.p)) } : s
    case 'reup_done': return s.k === 'reup' ? { k: 'done', fileId: e.fileId } : s
    case 'reup_fail': return s.k === 'reup' ? { k: 'failed', full: e.full } : s
    case 'reup_cancel': return s.k === 'reup' ? DRIVE_OFF : s
  }
}
/** 这时候显示「存雲盤」钮吗（渲染完·手上有成片） */
export const driveButtonShown = (s: DriveFlow) => s.k === 'off' || s.k === 'failed'

/**
 * 上传彻底失败时渲染怎么办：
 *  弹窗与无头远端导出页一律 keep：照样渲染完、成片留在那台浏览器那一页给下载；
 *  无头页另把任务记 failed（白话写明成片留在哪台的导出页）、⛔ 关那一页。
 */
export function uploadFailPolicy(_where: 'dialog' | 'headless'): 'keep_rendering' {
  return 'keep_rendering'
}

/** 断线（stalled）多久算彻底失败：渲染还在跑 ⇒ 一直等（渲染完再说）；渲染完了还断着超过 giveUpMs ⇒ 放弃 */
export const STALL_GIVE_UP_MS = 2 * 60_000
export function stallGiveUp(p: { renderDone: boolean; stalledSince: number | null; now: number; giveUpMs?: number }): boolean {
  if (!p.renderDone || p.stalledSince === null) return false
  return p.now - p.stalledSince >= (p.giveUpMs ?? STALL_GIVE_UP_MS)
}

/**
 * 断线计时（stalledSince）怎么更新：每次自动重试会把上传器 phase 拨回 uploading，
 * 若一见非 stalled 就清零，下一次断线又从头计 ⇒ 2 分钟放弃永远到不了、对话框一直关不掉。
 * ⇒ 只有真的多确认了字节（uploadedBytes 变大）或传完才清零；重试拨回 uploading 不算恢复。
 * 药：DILIN_NEG 含 export_stall_reset_on_retry ⇒ 退回「非 stalled 就清零」。
 */
export function nextStalledSince(p: { prev: number | null; phase: string; uploaded: number; lastUploaded: number; now: number }): number | null {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.DILIN_NEG ?? ''
  if (env.split(',').map((x) => x.trim()).includes('export_stall_reset_on_retry')) return p.phase === 'stalled' ? (p.prev ?? p.now) : null
  if (p.phase === 'done' || p.uploaded > p.lastUploaded) return p.phase === 'stalled' ? p.now : null
  if (p.phase === 'stalled') return p.prev ?? p.now
  return p.prev
}

export type PageLang = 'tw' | 'cn' | 'en'
/** 无头导出页用哪种字：陆站简；台站按浏览器语言（英文 ⇒ en·其余繁）——无头页没登入、读不到账号语言 */
export const headlessLang = (cn: boolean, navLang: string | null | undefined): PageLang => (cn ? 'cn' : /^en\b/i.test(navLang ?? '') ? 'en' : 'tw')
/** 无头导出页：边传失败回报任务的白话原因 */
export function streamFailDetail(e: { code?: string; full?: boolean; message?: string; status?: number } | null | undefined, lang: PageLang): string {
  const T = (tw: string, zh: string, en: string) => (lang === 'cn' ? zh : lang === 'en' ? en : tw)
  const code = e?.code ?? ''
  if (e?.full || code === 'quota_exceeded' || code === 'storage_full' || code === 'vedit_export_quota_exceeded') return T('雲端硬碟空間不夠，成片存不進去', '云盘空间不够，成片存不进去', 'Not enough drive space to save the video')
  if (code === 'err_upload_stream_over_bound' || code === 'vedit_export_too_large') return T('成片比預估的大太多，存不進雲端硬碟', '成片比预估的大太多，存不进云盘', 'The video is much larger than estimated and could not be saved to the drive')
  if (code === 'err_upload_stream_unsupported') return T('伺服器還不支援邊導出邊上傳', '服务器还不支持边导出边上传', 'The server does not support uploading while exporting yet')
  if (code === 'stalled') return T('網路斷了太久，成片傳不上雲端硬碟', '网络断了太久，成片传不上云盘', 'The connection was down too long to upload the video')
  const m = String(e?.message ?? '').slice(0, 120)
  return T(`成片傳不上雲端硬碟${m ? `：${m}` : ''}`, `成片传不上云盘${m ? `：${m}` : ''}`, `The video could not be uploaded to the drive${m ? `: ${m}` : ''}`)
}
/** 无头页上传失败但成片留在页上：任务 error 里补一句在哪再存／下载 */
export function keptHint(lang: PageLang): string {
  return lang === 'cn' ? '成片已导出完，留在那台电脑的导出页上：可在那一页按「再存一次云盘」（那台的浏览器要登入同一个账号），或按「下载成片」存下来。'
    : lang === 'en' ? 'The video was exported and is kept on the export page on that computer — press "Save to drive again" there (that browser must be signed in to the same account), or "Download video" to save it.'
    : '成片已導出完，留在那台電腦的導出頁上：可在那一頁按「再存一次雲端硬碟」（那台的瀏覽器要登入同一個帳號），或按「下載成片」存下來。'
}

/**
 * 无头页回报进度被拒（403 票已结／409 任务变了）时算不算「使用者取消」：
 *  只认回包里任务现状真是 cancelled；上传判败（quota／夹失效／落档失败先记 failed 清票）、done、读不到 ⇒ ⛔ 当取消——
 *  渲染照跑、已出的本机成片照留，晚到的进度回包抹不掉它。
 */
export function progressRejectIsCancel(e: { status?: number; body?: Record<string, unknown> } | null | undefined): boolean {
  return (e?.status === 403 || e?.status === 409) && e?.body?.status === 'cancelled'
}

/** 无头页「再存一次云盘」：走这台浏览器的登入（票已结·⛔ 凭票）——没登入／登的不是任务主人 ⇒ 不传（免得存进别人的云盘） */
// F10：target 给了而 folder 为 null、又不是建任务时就指定根目录 ⇒ 原夹已失效 ⇒ 'folder_gone'
export type ResaveBlock = 'login' | 'other' | 'folder_gone'
export function resaveGate(loginUid: string | null | undefined, owner: string | null | undefined, target?: { folder: string | null; toRoot: boolean }): 'ok' | ResaveBlock {
  if (target && target.folder == null && !target.toRoot) return 'folder_gone'
  if (!loginUid) return 'login'
  return owner && loginUid === owner ? 'ok' : 'other'
}
export type ResaveView = { k: 'idle' } | { k: 'saving'; p: number } | { k: 'done' } | { k: 'fail'; msg: string }
/** 无头页留片区的字（三语） */
export function resaveText(lang: PageLang, v: ResaveView | { k: 'button' } | { k: 'download' } | { k: 'blocked'; why: ResaveBlock }): string {
  const T = (tw: string, zh: string, en: string) => (lang === 'cn' ? zh : lang === 'en' ? en : tw)
  switch (v.k) {
    case 'button': return T('再存一次雲端硬碟', '再存一次云盘', 'Save to drive again')
    case 'download': return T('下載成片', '下载成片', 'Download video')
    case 'saving': return T(`正在存進雲端硬碟… ${v.p}%`, `正在存进云盘… ${v.p}%`, `Saving to the drive… ${v.p}%`)
    case 'done': return T('已存進雲端硬碟。這一頁可以關掉了。', '已存进云盘。这一页可以关掉了。', 'Saved to the drive. You can close this page.')
    case 'blocked': return v.why === 'folder_gone'
      ? T('原本要存的資料夾已經不在了，不會改存到別處：請按「下載成片」存下來。', '原本要存的资料夹已经不在了，不会改存到别处：请按「下载成片」存下来。', 'The folder this export was meant to save into no longer exists, so it will not be saved elsewhere. Press "Download video" to keep it.')
      : v.why === 'login'
      ? T('這台電腦的瀏覽器沒登入堤麟，存不進雲端硬碟：請先在這台登入同一個帳號再按一次，或按「下載成片」。', '这台电脑的浏览器没登入堤麟，存不进云盘：请先在这台登入同一个账号再按一次，或按「下载成片」。', 'This browser is not signed in, so the video cannot be saved to the drive. Sign in to the same account on this computer and press again, or press "Download video".')
      : T('這台電腦的瀏覽器登入的不是建這個導出的帳號，存不進去：請換成同一個帳號登入再按一次，或按「下載成片」。', '这台电脑的浏览器登入的不是建这个导出的账号，存不进去：请换成同一个账号登入再按一次，或按「下载成片」。', 'This browser is signed in to a different account than the one that started this export. Sign in to the same account and press again, or press "Download video".')
    case 'fail': return v.msg
    default: return ''
  }
}

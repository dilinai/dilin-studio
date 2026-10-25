// 剪辑远端导出——纯函数：
//   · 工具参数解析（video_edit_export：id／res／folder_id／device）
//   · 挑机器（指定 ⇒ 认那台；没指定 ⇒ 角色执行机 ⇒ 角色窗所在那台 ⇒ 最近活跃那台；都不在线 ⇒ 白话拒；雲電腦一律不用）
//   · 导出票的校验（票只存 sha256·比对、到期、任务已终了都不认；同任务 6 小时内可多次委派·⛔ 首次用即耗尽）
//   · 任务状态机（queued → running → done／failed／cancelled·终态不再变·进度只进不退）与「多久没回报算断了」
//   · 给角色／使用者看的白话错误
// ⛔ IO：杂凑、随机数、库、设备通道都由调用方（lib/vedit-export-job.ts·/api/vedit/export*）做。
import type { ExportRes } from './export.pure'

export const EXPORT_JOB_STATUSES = ['queued', 'running', 'done', 'failed', 'cancelled'] as const
export type ExportJobStatus = (typeof EXPORT_JOB_STATUSES)[number]
export const isTerminal = (s: ExportJobStatus): boolean => s === 'done' || s === 'failed' || s === 'cancelled'

/** 票多久有效（从建任务算）：4K 长片在一般显卡上可能要跑一两个小时 ⇒ 6 小时；任务一到终态票就失效（不必等到期） */
export const EXPORT_TICKET_TTL_MS = 6 * 60 * 60 * 1000
/** 派出去后多久还没开跑（导出页没回报过）⇒ 当那台没打开导出页 */
export const EXPORT_START_TIMEOUT_MS = 3 * 60 * 1000
/** 跑着时多久没回报 ⇒ 当那台的导出页断了（背景分页的计时器可能被浏览器压到一分钟一次 ⇒ 留宽） */
export const EXPORT_HEARTBEAT_STALE_MS = 5 * 60 * 1000
/** 导出页回报节奏（毫秒·最快） */
export const EXPORT_REPORT_EVERY_MS = 1000
/** 成片分片大小（16MB·最多 10000 片 ⇒ 远超单档上限） */
export const EXPORT_PART_BYTES = 16 * 1024 * 1024
/** 成片单档上限（同云盘大档上传 8GB） */
export const EXPORT_MAX_BYTES = 8 * 1024 * 1024 * 1024
/** 票：32 字节随机·hex 64 字 */
export const EXPORT_TICKET_RE = /^[0-9a-f]{64}$/
/** 无头导出页路径（登入闸放行·只认票） */
export const EXPORT_PAGE_PATH = '/video-edit/export'
/** 导出页带票的请求头 */
export const EXPORT_TICKET_HEADER = 'x-vedit-export-ticket'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v)

// ── 工具参数 ──
/** alpha＝透明背景：那台出 WebM（VP9 透明＋Opus）而不是 MP4；part＝只导一段（null＝整条） */
export type ExportArgs = { id: string; res: ExportRes; fps: 30 | 60; folderId: string | null; device: string | null; alpha: boolean; part: ExportPart | null }

//   别台读的是存好的整份工程 ⇒ 范围随任务带过去（迁移 445 的 part 栏）·那台的导出页照范围只画那一段。
//   from／to＝时间轴第几秒（同 ExportRange）；only＝只画哪几段片段（片段 id·缺＝那段时间里全部轨都画）。
export type ExportPart = { from: number; to: number; only?: string[] }
/** 一段最长（秒）·only 最多几段·片段 id 最长几个字 */
export const EXPORT_PART_MAX_SEC = 24 * 60 * 60
export const EXPORT_ONLY_MAX = 500
const ONLY_ID_MAX = 100
const ms = (v: number) => Math.round(v * 1000) / 1000
/** 工具参数 range={from,to}（秒）＋only=[片段 id]；都没给 ⇒ null（整条）；only 一定要配 range（头尾由叫的那头算好·⛔ 那台自己猜） */
export function parseExportPart(range: unknown, only: unknown): { ok: true; part: ExportPart | null } | { ok: false; error: string } {
  const none = (v: unknown) => v === undefined || v === null
  if (none(range) && none(only)) return { ok: true, part: null }
  if (none(range) || typeof range !== 'object' || Array.isArray(range)) return { ok: false, error: 'range must be { from, to } in timeline seconds (only needs range too).' }
  const r = range as Record<string, unknown>
  if (typeof r.from !== 'number' || typeof r.to !== 'number') return { ok: false, error: 'range.from and range.to must be numbers of seconds.' }
  const from = r.from, to = r.to
  if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to > EXPORT_PART_MAX_SEC || ms(to) <= ms(from)) return { ok: false, error: `range must satisfy 0 ≤ from < to ≤ ${EXPORT_PART_MAX_SEC}.` }
  const part: ExportPart = { from: ms(from), to: ms(to) }
  if (!none(only)) {
    if (!Array.isArray(only) || only.length < 1 || only.length > EXPORT_ONLY_MAX) return { ok: false, error: `only must be a list of 1–${EXPORT_ONLY_MAX} clip ids.` }
    const ids: string[] = []
    for (const x of only) {
      const s = typeof x === 'string' ? x.trim() : ''
      if (!s || s.length > ONLY_ID_MAX) return { ok: false, error: 'only must contain clip ids (non-empty strings).' }
      if (!ids.includes(s)) ids.push(s)
    }
    part.only = ids
  }
  return { ok: true, part }
}
/** 库里 part 栏读回来（迁移 445·jsonb）：形状不对 ⇒ null；ack＝那台的导出页认得范围、开跑时盖的章 */
export function readPartColumn(v: unknown): (ExportPart & { ack: boolean }) | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const o = v as Record<string, unknown>
  const p = parseExportPart({ from: o.from, to: o.to }, o.only ?? null)
  return p.ok && p.part ? { ...p.part, ack: o.ack === true } : null
}
/** 导出页开跑时报的本事（op:'start' caps）：这一版认得「只导一段」 */
export const EXPORT_PAGE_CAPS = ['part'] as const
/** 开跑闸：任务要一段而那台的导出页没报认得 part（旧版页） ⇒ page_outdated（⛔ 让它开跑——它会静默导整条） */
export function startGate(part: ExportPart | null, caps: unknown): 'ok' | 'page_outdated' {
  if (!part) return 'ok'
  return Array.isArray(caps) && caps.includes('part') ? 'ok' : 'page_outdated'
}
/**
 * 范围有没有被那台照办：没要一段 ⇒ null；开跑之后（running／done）没盖 ack ⇒ false（开跑那一下是旧版 run 口处理的·那台在导整条）；
 * 还没开跑 ⇒ null（还不知道）。新版 run 口开跑与盖章同一笔写入 ⇒ ⛔ 误判。
 */
export function partHonored(part: { ack?: boolean } | null, status: ExportJobStatus): boolean | null {
  if (!part) return null
  if (part.ack) return true
  return status === 'running' || status === 'done' ? false : null
}
/** 给本人／角色看的 part（回包附在 jobView 旁：叫的那头据此认出服务端认不认得、那台有没有照办） */
export function partView(part: (ExportPart & { ack?: boolean }) | null, status: ExportJobStatus): { from: number; to: number; only: number | null; honored: boolean | null } | null {
  return part ? { from: part.from, to: part.to, only: part.only ? part.only.length : null, honored: partHonored(part, status) } : null
}
/**
 * 那台的导出页把任务的 part 落成要画的范围：没 part ⇒ 整条；only 里有片段在存好的工程里找不到 ⇒ part_clips_missing（⛔ 改画别的）；
 * 头已在时间轴尾巴之后 ⇒ part_outside；尾超出 ⇒ 截到时间轴尾。
 */
export function resolveExportPart(part: ExportPart | null | undefined, tracks: ReadonlyArray<{ clips: ReadonlyArray<{ id: string }> }>, end: number):
  { ok: true; range: { from: number; to: number; only?: Set<string> } } | { ok: false; code: 'part_clips_missing' | 'part_outside'; missing?: number } {
  if (!part) return { ok: true, range: { from: 0, to: end } }
  if (part.only) {
    const have = new Set(tracks.flatMap((l) => l.clips.map((c) => c.id)))
    const missing = part.only.filter((id) => !have.has(id)).length
    if (missing) return { ok: false, code: 'part_clips_missing', missing }
  }
  const to = Math.min(part.to, end)
  if (!(to - part.from > 1e-6)) return { ok: false, code: 'part_outside' }
  return { ok: true, range: { from: part.from, to, ...(part.only ? { only: new Set(part.only) } : {}) } }
}
/** 透明背景写法：true／false（也认 "true"／"false"、1／0）；没给 ⇒ false；别的 ⇒ null（拒） */
export function parseExportAlpha(v: unknown): boolean | null {
  if (v === undefined || v === null || v === '' || v === false || v === 0 || v === 'false' || v === '0') return false
  if (v === true || v === 1 || v === 'true' || v === '1') return true
  return null
}
/** 解析度写法：720／1080／4K（＝2160）；也认 720p、1080p、2160、2160p、4k、uhd、2K／1440（编码器本来就有这档） */
export function parseExportRes(v: unknown): ExportRes | null {
  if (v === undefined || v === null || v === '') return '1080'
  const s = String(v).trim().toLowerCase().replace(/\s+/g, '')
  if (s === '720' || s === '720p' || s === 'hd') return '720'
  if (s === '1080' || s === '1080p' || s === 'fhd' || s === 'fullhd') return '1080'
  if (s === '1440' || s === '1440p' || s === '2k') return '1440'
  if (s === '2160' || s === '2160p' || s === '4k' || s === 'uhd') return '2160'
  return null
}
export function parseExportArgs(a: unknown): { ok: true; args: ExportArgs } | { ok: false; error: string } {
  const o = (a && typeof a === 'object' ? a : {}) as Record<string, unknown>
  const id = typeof o.id === 'string' ? o.id.trim() : ''
  if (!isUuid(id)) return { ok: false, error: 'id must be the .dvedit file id (a UUID) — get it from create_video_edit, list_drive or the editor line.' }
  const res = parseExportRes(o.res)
  if (!res) return { ok: false, error: 'res must be 720, 1080 or 4K.' }
  const fpsRaw = o.fps === undefined || o.fps === null ? 30 : Number(o.fps)
  if (fpsRaw !== 30 && fpsRaw !== 60) return { ok: false, error: 'fps must be 30 or 60.' }
  let folderId: string | null = null
  if (o.folder_id !== undefined && o.folder_id !== null && o.folder_id !== '') {
    const f = typeof o.folder_id === 'string' ? o.folder_id.trim() : ''
    if (f !== 'root' && !isUuid(f)) return { ok: false, error: 'folder_id must be a folder id from list_drive (or omit it to save next to the project).' }
    folderId = f === 'root' ? 'root' : f
  }
  let device: string | null = null
  if (o.device !== undefined && o.device !== null && o.device !== '') {
    if (typeof o.device !== 'string' || !o.device.trim() || o.device.trim().length > 200) return { ok: false, error: 'device must be a computer name or device id (or omit it to pick an online computer).' }
    device = o.device.trim()
  }
  const alpha = parseExportAlpha(o.alpha)
  if (alpha === null) return { ok: false, error: 'alpha must be true (transparent background, saved as WebM) or false (default, MP4).' }
  const pp = parseExportPart(o.range, o.only)
  if (!pp.ok) return { ok: false, error: pp.error }
  return { ok: true, args: { id, res, fps: fpsRaw, folderId, device, alpha, part: pp.part } }
}

// ── 挑机器 ──
export type OnlineDevice = { deviceId: string; name: string | null; lastUp: number; /** 雲電腦沙箱（没真显卡·不自动挑） */ cloudSandbox?: boolean; /** dilin_term_devices 登记的系统／架构（没登记＝不知道） */ os?: string | null; arch?: string | null }
/** Linux ARM 电脑上的浏览器多半解不了 H.264 ⇒ 导出读不到 mp4 画面·自动挑时排在别台后面（只剩它才挑它） */
export function weakVideoDecoder(d: Pick<OnlineDevice, 'os' | 'arch'>): boolean {
  const os = (d.os ?? '').toLowerCase(), arch = (d.arch ?? '').toLowerCase()
  return os === 'linux' && (arch === 'aarch64' || arch === 'arm64' || arch.startsWith('arm'))
}
export type DevicePick =
  | { ok: true; deviceId: string; name: string | null; why: 'asked' | 'executor' | 'role_host' | 'recent' }
  | { ok: false; code: 'device_offline' | 'device_unknown' | 'no_device_online' | 'device_cloud_not_allowed'; asked?: string }
/**
 * 指定 device ⇒ 按设备号或名字（不分大小写）认；认得出但不在线 ⇒ device_offline；认不出 ⇒ device_unknown；
 *  指到雲電腦 ⇒ device_cloud_not_allowed。
 * 没指定 ⇒ 角色执行机（role settings 里设定的那台）在线就用它 ⇒ 否则这只角色开着窗的那台 ⇒ 否则最近活跃（常驻最近回报）那台；雲電腦沙箱不自动挑。
 * known＝本账号认得的电脑（含离线）·只用来分 offline／unknown。
 */
export function pickExportDevice(p: { asked: string | null; online: readonly OnlineDevice[]; known?: ReadonlyArray<{ deviceId: string; name: string | null }>; executorDeviceId?: string | null; roleHostIds?: readonly string[] }): DevicePick {
  const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()
  if (p.asked) {
    const want = norm(p.asked)
    // 同名时先认实体电脑（雲電腦同名不该挡住实体那台）
    const hit = p.online.find((d) => d.deviceId === p.asked) ?? p.online.find((d) => norm(d.name) === want && !d.cloudSandbox) ?? p.online.find((d) => norm(d.name) === want)
    if (hit?.cloudSandbox) return { ok: false, code: 'device_cloud_not_allowed', asked: p.asked }
    if (hit) return { ok: true, deviceId: hit.deviceId, name: hit.name, why: 'asked' }
    const knownHit = (p.known ?? []).some((d) => d.deviceId === p.asked || norm(d.name) === want)
    return { ok: false, code: knownHit ? 'device_offline' : 'device_unknown', asked: p.asked }
  }
  const auto = p.online.filter((d) => !d.cloudSandbox)
  if (p.executorDeviceId) { const d = auto.find((x) => x.deviceId === p.executorDeviceId); if (d) return { ok: true, deviceId: d.deviceId, name: d.name, why: 'executor' } }
  for (const id of p.roleHostIds ?? []) { const d = auto.find((x) => x.deviceId === id); if (d) return { ok: true, deviceId: d.deviceId, name: d.name, why: 'role_host' } }
  const recent = [...auto].sort((a, b) => Number(weakVideoDecoder(a)) - Number(weakVideoDecoder(b)) || b.lastUp - a.lastUp)[0]
  if (recent) return { ok: true, deviceId: recent.deviceId, name: recent.name, why: 'recent' }
  return { ok: false, code: 'no_device_online' }
}
export const deviceTarget = (deviceId: string) => `device:${deviceId}`
export const targetDeviceId = (target: string): string | null => (target.startsWith('device:') ? target.slice(7) : null)

// ── 票 ──
export type TicketRow = { status: ExportJobStatus; ticket_hash: string | null; ticket_expires_at: string | null }
export type TicketVerdict = { ok: true } | { ok: false; reason: 'missing' | 'bad' | 'expired' | 'finished' }
/** 定长比对（两边都是 hex 64） */
export function sameHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}
/** presented＝导出页带来的票；hashOf＝sha256 hex（调用方注入·node crypto）。任务已终了 ⇒ 票就作废（⛔ 再写进度／再存档） */
export function verifyExportTicket(row: TicketRow | null, presented: unknown, hashOf: (t: string) => string, now: number): TicketVerdict {
  if (typeof presented !== 'string' || !presented) return { ok: false, reason: 'missing' }
  if (!row || !row.ticket_hash || !EXPORT_TICKET_RE.test(presented)) return { ok: false, reason: 'bad' }
  if (!sameHex(hashOf(presented), row.ticket_hash)) return { ok: false, reason: 'bad' }
  const exp = row.ticket_expires_at ? Date.parse(row.ticket_expires_at) : NaN
  if (!Number.isFinite(exp) || now >= exp) return { ok: false, reason: 'expired' }
  if (isTerminal(row.status)) return { ok: false, reason: 'finished' }
  return { ok: true }
}
/** 派给那台电脑的网址（票在 t） */
export function exportPageUrl(origin: string, jobId: string, ticket: string): string {
  return `${origin.replace(/\/+$/, '')}${EXPORT_PAGE_PATH}?export_job=${encodeURIComponent(jobId)}&t=${encodeURIComponent(ticket)}`
}
/** 导出页读网址：缺一样 ⇒ null（⛔ 跑） */
export function parseExportPageQuery(search: string): { job: string; ticket: string } | null {
  const q = new URLSearchParams(search)
  const job = q.get('export_job') ?? '', ticket = q.get('t') ?? ''
  return isUuid(job) && EXPORT_TICKET_RE.test(ticket) ? { job, ticket } : null
}

// ── 状态机 ──
export type JobState = { status: ExportJobStatus; progress: number }
export type JobEvent =
  | { type: 'start' }
  | { type: 'progress'; progress: number }
  | { type: 'done' }
  | { type: 'fail' }
  | { type: 'cancel' }
/** 下一个状态；不合法（终态再动、done 之前没跑过…）⇒ null（调用方 409） */
export function nextJobState(s: JobState, e: JobEvent): JobState | null {
  if (isTerminal(s.status)) return null
  const clamp = (p: number) => Math.max(0, Math.min(100, Math.round(Number.isFinite(p) ? p : 0)))
  switch (e.type) {
    case 'start': return { status: 'running', progress: s.progress }
    case 'progress': return { status: 'running', progress: Math.min(99, Math.max(s.progress, clamp(e.progress))) }
    case 'done': return s.status === 'running' ? { status: 'done', progress: 100 } : null
    case 'fail': return { status: 'failed', progress: s.progress }
    case 'cancel': return { status: 'cancelled', progress: s.progress }
  }
}
/** 读状态时顺手判：派了太久没开跑／跑着太久没回报 ⇒ 该判失败（回错误码）；否则 null */
export function staleVerdict(j: { status: ExportJobStatus; created_at: string; heartbeat_at: string | null }, now: number): 'never_started' | 'stalled' | null {
  if (j.status === 'queued') return now - Date.parse(j.created_at) > EXPORT_START_TIMEOUT_MS ? 'never_started' : null
  if (j.status === 'running') {
    const hb = j.heartbeat_at ? Date.parse(j.heartbeat_at) : Date.parse(j.created_at)
    return now - hb > EXPORT_HEARTBEAT_STALE_MS ? 'stalled' : null
  }
  return null
}
/** 成片分几片 */
export function partPlan(size: number): { ok: true; parts: number; partSize: number } | { ok: false; code: 'empty' | 'too_large' } {
  if (!(Number.isInteger(size) && size > 0)) return { ok: false, code: 'empty' }
  if (size > EXPORT_MAX_BYTES) return { ok: false, code: 'too_large' }
  return { ok: true, parts: Math.max(1, Math.ceil(size / EXPORT_PART_BYTES)), partSize: EXPORT_PART_BYTES }
}
/** 完成合并时交上来的分片清单：恰好 1..parts 各一次、递增、ETag 非空 */
export function checkParts(parts: unknown, total: number): { ok: true; parts: Array<{ PartNumber: number; ETag: string }> } | { ok: false } {
  if (!Array.isArray(parts) || parts.length !== total) return { ok: false }
  const out: Array<{ PartNumber: number; ETag: string }> = []
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i] as { n?: unknown; etag?: unknown } | null
    if (!p || p.n !== i + 1 || typeof p.etag !== 'string' || !p.etag || p.etag.length > 200) return { ok: false }
    out.push({ PartNumber: i + 1, ETag: p.etag })
  }
  return { ok: true, parts: out }
}

/** 串流上传完成时的分片清单：片号正好 1..k 连续（1 ≤ k ≤ 上限片数）、ETag 非空 */
export function checkStreamParts(parts: unknown, maxParts: number): { ok: true; parts: Array<{ PartNumber: number; ETag: string }> } | { ok: false } {
  if (!Array.isArray(parts) || parts.length < 1 || parts.length > maxParts) return { ok: false }
  return checkParts(parts, parts.length)
}

// ── 白话 ──
export type ExportErrCode =
  | 'device_offline' | 'device_unknown' | 'no_device_online' | 'device_cloud_not_allowed' | 'open_failed' | 'tab_limit'
  | 'never_started' | 'stalled' | 'page_closed' | 'render_failed' | 'upload_failed' | 'quota_exceeded' | 'too_large' | 'folder_gone' | 'cancelled'
  | 'page_outdated'
/** 写进任务 error 栏的白话（台繁／陆简／英）·detail＝导出页带回的原因（编码器的话）。服务端按站别给 tw／cn；en 给日后英文面用 */
export function exportErrorText(code: ExportErrCode, region: 'tw' | 'cn' | 'en', o: { device?: string | null; detail?: string } = {}): string {
  const tw = region === 'tw', en = region === 'en'
  const dev = o.device ? (en ? `"${o.device}"` : `「${o.device}」`) : (en ? 'That computer' : tw ? '那台電腦' : '那台电脑')
  const T = (a: string, b: string, c: string) => (en ? c : tw ? a : b)
  switch (code) {
    case 'device_offline': return T(`${dev}現在不在線（沒開堤麟殼的常駐），沒辦法用它導出。請開機並打開堤麟殼，或換一台在線的電腦。`, `${dev}现在不在线（没开堤麟壳的常驻），没办法用它导出。请开机并打开堤麟壳，或换一台在线的电脑。`, `${dev} is offline (the Dilin shell isn't running there), so it can't export. Turn it on and open the Dilin shell, or pick another online computer.`)
    case 'device_unknown': return T(`找不到叫${dev}的電腦。請用電腦名稱或設備號，或不指定讓系統挑一台在線的。`, `找不到叫${dev}的电脑。请用电脑名称或设备号，或不指定让系统挑一台在线的。`, `Can't find a computer called ${dev}. Use the computer's name or device id, or leave it out to pick an online one.`)
    case 'no_device_online': return T('現在沒有在線的電腦可以導出（要有一台開著堤麟殼常駐的電腦）。請先打開一台，再試一次。', '现在没有在线的电脑可以导出（要有一台开着堤麟壳常驻的电脑）。请先打开一台，再试一次。', 'No computer is online to export on (one needs the Dilin shell running). Turn one on and try again.')
    case 'device_cloud_not_allowed': return T('不用雲電腦導出，請選實體電腦。', '不用云电脑导出，请选实体电脑。', "Cloud PCs aren't used for exporting — please pick a physical computer.")
    case 'open_failed': return T(`${dev}的瀏覽器沒能打開導出頁。請確認那台的堤麟殼常駐正常，再試一次。`, `${dev}的浏览器没能打开导出页。请确认那台的堤麟壳常驻正常，再试一次。`, `${dev}'s browser couldn't open the export page. Check the Dilin shell there and try again.`)
    case 'tab_limit': return T(`${dev}的瀏覽器分頁開太多了，先關掉幾頁再試。`, `${dev}的浏览器分页开太多了，先关掉几页再试。`, `${dev} has too many browser tabs open. Close a few and try again.`)
    case 'never_started': return T(`${dev}一直沒開始導出（導出頁沒回報）。可能那台的瀏覽器沒打開頁面，請再試一次。`, `${dev}一直没开始导出（导出页没回报）。可能那台的浏览器没打开页面，请再试一次。`, `${dev} never started the export (the export page didn't report back). Its browser may not have opened the page — try again.`)
    case 'stalled': return T(`${dev}的導出頁很久沒回報進度，當作中斷了。請再試一次。`, `${dev}的导出页很久没回报进度，当作中断了。请再试一次。`, `${dev}'s export page stopped reporting progress, so it's treated as interrupted. Try again.`)
    case 'page_closed': return T(`${dev}上的導出頁被關掉了，導出沒做完。`, `${dev}上的导出页被关掉了，导出没做完。`, `The export page on ${dev} was closed before the export finished.`)
    case 'render_failed': return T(`導出失敗：${o.detail || '編碼時出錯'}`, `导出失败：${o.detail || '编码时出错'}`, `Export failed: ${o.detail || 'encoding error'}`)
    case 'upload_failed': return T(`成片做好了，但存進雲端硬碟失敗：${o.detail || '上傳出錯'}`, `成片做好了，但存进云盘失败：${o.detail || '上传出错'}`, `The video was rendered but saving it to the drive failed: ${o.detail || 'upload error'}`)
    case 'quota_exceeded': return T('雲端硬碟空間不夠，成片存不進去。請清出空間或升級方案後再導出。', '云盘空间不够，成片存不进去。请清出空间或升级方案后再导出。', 'Not enough drive space to save the video. Free up space or upgrade, then export again.')
    case 'too_large': return T('成片超過 8GB，存不進雲端硬碟。請改用較低解析度或縮短片長。', '成片超过 8GB，存不进云盘。请改用较低分辨率或缩短片长。', 'The video is over 8GB and can\'t be saved to the drive. Use a lower resolution or a shorter cut.')
    case 'folder_gone': return T('目標資料夾已不存在，成片沒有存。請換一個資料夾再導出。', '目标文件夹已不存在，成片没有存。请换一个文件夹再导出。', 'The target folder no longer exists, so the video wasn\'t saved. Pick another folder and export again.')
    case 'cancelled': return T('導出已取消。', '导出已取消。', 'Export cancelled.')
    // ①：要一段而那台的导出页是旧版（不认得范围）⇒ 停下（⛔ 静默导整条）
    case 'page_outdated': return T(`${dev}打開的導出頁是舊版，不認得「只導出一段」，為了不把整條導出去已經停下。請稍後再試（網站剛更新時會這樣）；一直這樣請重開那台的堤麟殼再試。`, `${dev}打开的导出页是旧版，不认得「只导出一段」，为了不把整条导出去已经停下。请稍后再试（网站刚更新时会这样）；一直这样请重开那台的堤麟壳再试。`, `The export page opened on ${dev} is an older version that doesn't understand "export a section", so it was stopped instead of exporting the whole timeline. Try again in a moment (this happens right after a site update); if it keeps happening, restart the Dilin shell on that computer.`)
  }
}

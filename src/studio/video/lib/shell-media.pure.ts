// 网页剪辑页「有壳给壳」（识别字幕＋AI 分轨交给用户自己电脑上的堤麟終端跑）的纯函数。
// 合同＝接口单 安装由网页按钮触发）：
//   壳→网站：工作态 caps.media（各台各角色上报·GET /api/agent/media 列出来）；网站→壳：/api/agent/control 的 media_job／media_cancel／media_install；
//   档案进出一律走云盘（网页先传云盘拿 file_id 再下单·壳跑完把结果传回云盘报 file_id）。
// 本档只放类型、校形与判据（题直接跑）·⛔ 碰 fetch／DOM。
import type { SubtitleCue } from './text.pure'

// proxy＝代理档（剪辑用小档＋缩图拼图＋波形·借识别字幕／分轨环境里的 PyAV·没得装·判法在 cloud-proxy.pure）
export const MEDIA_KINDS = ['asr', 'stems', 'proxy'] as const
export type MediaKind = (typeof MEDIA_KINDS)[number]
// installable＝没装但接第一单时会自己装（目前只有 proxy 报：代理档自带只装 PyAV 的小环境）
export const MEDIA_CAP_STATES = ['absent', 'installable', 'installing', 'ready', 'broken'] as const
export type MediaCapState = (typeof MEDIA_CAP_STATES)[number]
export type MediaAccel = 'cuda' | 'metal' | 'cpu'
export type MediaCap = { state: MediaCapState; model?: string; size_mb?: number; accel?: MediaAccel }
export const MEDIA_JOB_STATES = ['queued', 'downloading', 'running', 'uploading', 'done', 'failed', 'cancelled'] as const
export type MediaJobState = (typeof MEDIA_JOB_STATES)[number]
export const MEDIA_JOB_ENDED: readonly MediaJobState[] = ['done', 'failed', 'cancelled']
/** AI 分轨出的六轨（htdemucs_6s） */
export const STEM_NAMES = ['vocals', 'drums', 'bass', 'guitar', 'piano', 'other'] as const
export type StemName = (typeof STEM_NAMES)[number]
export type MediaResult = { kind: 'asr'; file_id: string; lang: string; n_segments: number } | { kind: 'stems'; files: Record<StemName, string> }
  /** 代理档：proxy＝剪辑用小档（skip＝原档本来就小·没转）·peaks＝波形 JSON·thumbs＝缩图拼图 */
  | { kind: 'proxy'; proxy: string | null; skip: boolean; peaks: string | null; thumbs: { file_id: string; every: number; cols: number; n: number } | null }
export type MediaJob = { id: string; kind: MediaKind; state: MediaJobState; pct: number; stage: string; result?: MediaResult; error?: string }
export type MediaInstall = { kind: MediaKind; pct: number; stage: string }
export type MediaView = { asr: MediaCap; stems: MediaCap; /** 旧壳没这栏 ⇒ absent */ proxy: MediaCap; install: MediaInstall | null; jobs: MediaJob[] }
/** 一台电脑（某只角色的窗）上报的那一格 */
export type MediaDevice = { role: string; deviceId: string; name: string; view: MediaView }

/** 壳没报 size_mb 时安装钮上写的大小（接口单第四节：识别字幕约 550MB、AI 分轨约 2GB） */
export const MEDIA_SIZE_MB: Record<MediaKind, number> = { asr: 550, stems: 2000, proxy: 0 }
/** 送出后那台多久还没把这件列进 jobs ⇒ 当它没接到（窗关了、壳没收到） */
export const MEDIA_PICKUP_MS = 90_000
/** 跑着的时候多久问一次进度 */
export const MEDIA_POLL_MS = 2000
export const MEDIA_STR_MAX = 200
export const MEDIA_JOBS_MAX = 8

const CTRL = /[\x00-\x1f\x7f]/g
const str = (v: unknown, max = MEDIA_STR_MAX): string | null => {
  if (typeof v !== 'string') return null
  const s = v.replace(CTRL, ' ').trim()
  return s ? s.slice(0, max) : null
}
const pct = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : 0)
const isKind = (v: unknown): v is MediaKind => (MEDIA_KINDS as readonly unknown[]).includes(v)
/** 云盘档编号（uuid 形·别的一律不收·免得拿去打别的口） */
const FILE_ID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i
const fileId = (v: unknown): string | null => (typeof v === 'string' && FILE_ID.test(v.trim()) ? v.trim() : null)

function parseCap(v: unknown): MediaCap {
  const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  const state = (MEDIA_CAP_STATES as readonly unknown[]).includes(o.state) ? (o.state as MediaCapState) : 'absent'
  const out: MediaCap = { state }
  const model = str(o.model, 80); if (model) out.model = model
  if (typeof o.size_mb === 'number' && Number.isFinite(o.size_mb) && o.size_mb > 0) out.size_mb = Math.round(o.size_mb)
  if (o.accel === 'cuda' || o.accel === 'metal' || o.accel === 'cpu') out.accel = o.accel
  return out
}
function parseResult(kind: MediaKind, v: unknown): MediaResult | undefined {
  if (!v || typeof v !== 'object') return undefined
  const o = v as Record<string, unknown>
  if (kind === 'asr') {
    const id = fileId(o.file_id)
    if (!id) return undefined
    return { kind: 'asr', file_id: id, lang: str(o.lang, 16) ?? '', n_segments: typeof o.n_segments === 'number' && o.n_segments >= 0 ? Math.round(o.n_segments) : 0 }
  }
  if (kind === 'proxy') {
    const proxy = fileId(o.proxy)
    const skip = o.skip === true
    if (!proxy && !skip) return undefined
    const th = o.thumbs && typeof o.thumbs === 'object' ? (o.thumbs as Record<string, unknown>) : null
    const n = (v: unknown, max: number) => (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= max ? v : null)
    const tid = th ? fileId(th.file_id) : null
    const every = th ? n(th.every, 3600) : null, cols = th ? n(th.cols, 100) : null, cnt = th ? n(th.n, 100_000) : null
    return { kind: 'proxy', proxy, skip, peaks: fileId(o.peaks), thumbs: tid && every && cols && cnt ? { file_id: tid, every, cols, n: cnt } : null }
  }
  const f = o.files && typeof o.files === 'object' ? (o.files as Record<string, unknown>) : null
  if (!f) return undefined
  const files = {} as Record<StemName, string>
  for (const k of STEM_NAMES) { const id = fileId(f[k]); if (!id) return undefined; files[k] = id }
  return { kind: 'stems', files }
}
/** caps.media 校形：v≠1／不是物件 ⇒ null（＝那台没这能力·当旧壳） */
export function parseMediaCaps(raw: unknown): MediaView | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const b = raw as Record<string, unknown>
  if (b.v !== 1) return null
  let install: MediaInstall | null = null
  if (b.install && typeof b.install === 'object') {
    const i = b.install as Record<string, unknown>
    if (isKind(i.kind)) install = { kind: i.kind, pct: pct(i.pct), stage: str(i.stage) ?? '' }
  }
  const jobs: MediaJob[] = []
  if (Array.isArray(b.jobs)) for (const x of b.jobs.slice(0, MEDIA_JOBS_MAX * 2)) {
    if (!x || typeof x !== 'object') continue
    const j = x as Record<string, unknown>
    const id = str(j.id, 80)
    if (!id || !isKind(j.kind) || jobs.some((y) => y.id === id)) continue
    const state = (MEDIA_JOB_STATES as readonly unknown[]).includes(j.state) ? (j.state as MediaJobState) : 'queued'
    const job: MediaJob = { id, kind: j.kind, state, pct: pct(j.pct), stage: str(j.stage) ?? '' }
    const r = parseResult(j.kind, j.result); if (r) job.result = r
    const err = str(j.error, 400); if (err) job.error = err
    jobs.push(job)
    if (jobs.length >= MEDIA_JOBS_MAX) break
  }
  return { asr: parseCap(b.asr), stems: parseCap(b.stems), proxy: parseCap(b.proxy), install, jobs }
}

/** 工作态各行（同一账号·各角色各台）⇒ 报了 caps.media 的那几格（没 device_id 的旧行不算·同角色同台只留最新·新的在前） */
export function mediaDevices(rows: ReadonlyArray<{ role?: unknown; caps?: unknown; device_id?: unknown; updated_at?: unknown }>): MediaDevice[] {
  const sorted = [...rows].sort((a, b) => String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')))
  const out: MediaDevice[] = []
  for (const r of sorted) {
    const deviceId = typeof r.device_id === 'string' ? r.device_id.trim() : ''
    const role = typeof r.role === 'string' ? r.role.trim() : ''
    if (!deviceId || !role || out.some((d) => d.deviceId === deviceId && d.role === role)) continue
    const caps = r.caps && typeof r.caps === 'object' ? (r.caps as Record<string, unknown>) : null
    const view = caps ? parseMediaCaps(caps.media) : null
    if (!view) continue
    out.push({ role, deviceId, name: str(caps!.device, 80) ?? deviceId.slice(0, 8), view })
  }
  return out
}

const RANK: Record<MediaCapState, number> = { ready: 0, installable: 1, installing: 2, absent: 3, broken: 4 }
/** 列给用户挑的电脑：一台只列一次（同台几只角色的窗挑那项最能用的一扇·同分取最新上报）·能用的排前面 */
export function shellChoices(devs: readonly MediaDevice[], kind: MediaKind): MediaDevice[] {
  const best = new Map<string, MediaDevice>()
  for (const d of devs) {
    const cur = best.get(d.deviceId)
    if (!cur || RANK[d.view[kind].state] < RANK[cur.view[kind].state]) best.set(d.deviceId, d)
  }
  return [...best.values()].sort((a, b) => RANK[a.view[kind].state] - RANK[b.view[kind].state])
}
/** 默认挑哪台：这个浏览器所在那台（桌面版报得出设备号）→ 第一台能用的 → 第一台 */
export function defaultChoice(choices: readonly MediaDevice[], localDeviceId: string | null): MediaDevice | null {
  return (localDeviceId ? choices.find((d) => d.deviceId === localDeviceId) : undefined) ?? choices[0] ?? null
}
/** 这件在那台（同一台任一扇窗）报到哪了；还没列出来 ⇒ null */
export function jobOn(devs: readonly MediaDevice[], deviceId: string, jobId: string): MediaJob | null {
  for (const d of devs) if (d.deviceId === deviceId) { const j = d.view.jobs.find((x) => x.id === jobId); if (j) return j }
  return null
}
/** 有没有一台这项能用（识别字幕页据它出「交給終端」） */
export const anyReady = (devs: readonly MediaDevice[] | null, kind: MediaKind) => !!devs?.some((d) => d.view[kind].state === 'ready')
/** 安装钮上写几 MB */
export const installSizeMb = (cap: MediaCap, kind: MediaKind) => cap.size_mb ?? MEDIA_SIZE_MB[kind]

/** control 帖 media_job 的 value（JSON 字串） */
export function mediaJobValue(p: { job_id: string; kind: MediaKind; file_id: string; folder_id: string | null; lang?: string }): string {
  return JSON.stringify({ job_id: p.job_id, kind: p.kind, file_id: p.file_id, folder_id: p.folder_id, ...(p.kind === 'asr' ? { lang: p.lang ?? 'auto' } : {}) })
}
/** 找这只角色的双人群用哪个查询（同画布投影／导入登入那套 dilin-liaison）：堤麟按 agent_key·其余按壳侧名 */
export function pairGroupQuery(role: string): string {
  if (role === '堤麟') return 'agent_key=dilin'
  return `cli_role=${encodeURIComponent(role.replace(/^cli:/, ''))}`
}

/** 识别结果 JSON（{ v:1, lang, segments:[{start,end,text}] }·秒）⇒ 字幕句（加上送去那段在时间轴的起点）；坏形 ⇒ null；空句丢掉 */
export const ASR_RESULT_MAX_SEGS = 20000
export function parseAsrResult(json: unknown, base: number, maxLen = Infinity): SubtitleCue[] | null {
  if (!json || typeof json !== 'object') return null
  const o = json as Record<string, unknown>
  if (o.v !== 1 || !Array.isArray(o.segments)) return null
  const out: SubtitleCue[] = []
  for (const s of o.segments.slice(0, ASR_RESULT_MAX_SEGS)) {
    if (!s || typeof s !== 'object') continue
    const g = s as Record<string, unknown>
    const text = typeof g.text === 'string' ? g.text.replace(/\s+/g, ' ').trim() : ''
    const a = Number(g.start), b = Number(g.end)
    if (!text || !Number.isFinite(a) || !Number.isFinite(b)) continue
    const st = Math.max(0, Math.min(maxLen, a)), en = Math.max(0, Math.min(maxLen, b))
    if (en <= st) continue
    const r3 = (x: number) => Math.round(x * 1000) / 1000
    out.push({ start: r3(base + st), end: r3(base + en), text })
  }
  return out
}
/** 识别的语言：中文／英文（繁简由网页按站别转·壳出原文） */
export const shellAsrLang = (lang: 'zh' | 'en') => lang

/** 分轨结果的档名：〈歌名〉-〈轨名〉.mp3 */
export function stemFileNamesFor(song: string, labels: Record<StemName, string>): Record<StemName, string> {
  const base = (song.replace(/\.[^.]+$/, '').trim() || 'song').slice(0, 80)
  const out = {} as Record<StemName, string>
  for (const k of STEM_NAMES) out[k] = `${base}-${labels[k]}.mp3`
  return out
}

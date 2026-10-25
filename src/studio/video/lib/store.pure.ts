// 网页剪辑页·素材存本机与预览档（
//   06af46a4「汇入时复制一份进这个浏览器的本机储存，重新整理还在、播放顺；不自动上传，要换电脑或给角色用时再按「存到雲端硬碟」」）。
// 本档只放纯函数（题直接跑）：素材清单存档的形状与读回校验、要不要转预览档与转成多大、本机空间够不够、本机档名。
// 真 I/O（浏览器本机储存 OPFS、下载云盘档、转预览档）在 vedit-store.ts。

import { parseCloudProxy, type CloudProxy } from './cloud-proxy.pure'

export type VeditMediaKind = 'video' | 'audio' | 'image'

/** 存进 localStorage 的一条素材（只存说明·档本身在 OPFS）：
 *  local＝从电脑汇入（原档一定在本机储存里·读不回就丢掉这条）；drive＝云盘素材（url＝云盘链接·本机有缓存就用缓存）；
 *  driveId＝本机素材按过「存到雲端硬碟」或本来就是云盘档。 */
export type StoredMedia = {
  id: string
  name: string
  kind: VeditMediaKind
  duration: number
  from: 'local' | 'drive'
  driveId?: string
  url?: string
  /** 编曲素材：stems＝藏着的分轨编号·stemOf＝我是哪份的分轨（素材区不列） */
  stems?: string[]
  stemOf?: string
  /** 终端转好、存在云盘的剪辑用小档／波形／缩图（cloud-proxy.pure） */
  cloudProxy?: CloudProxy
}

export const VEDIT_MEDIA_KEY = 'dilin.videoEdit.media.v1'
/** 本机储存里这一页用的资料夹名 */
export const VEDIT_OPFS_DIR = 'dilin-video-edit'
/** 预览档长边（卡顿：原档 1080p／4K 解码重·剪辑时放这个就够看） */
export const PROXY_LONG_SIDE = 960
/** 预览档码率与关键帧间隔（每秒一个关键帧 ⇒ 拖播放头、逐帧跳都快） */
export const PROXY_BITRATE = 1_500_000
export const PROXY_KEYFRAME_SEC = 1
/** 原档已经够小（长边不超过这个、码率也不高）⇒ 不转·直接放原档 */
export const PROXY_SKIP_LONG_SIDE = 1000
export const PROXY_SKIP_BITRATE = 4_000_000
/** 本机储存留一成余量（存满了浏览器会整个清掉这一站的储存） */
export const STORE_HEADROOM = 0.1

const KINDS: readonly VeditMediaKind[] = ['video', 'audio', 'image']
const ID_RE = /^[A-Za-z0-9-]{8,64}$/

/** 编曲素材的指向：stems＝分轨编号清单（最多 32 份）·stemOf＝我是哪份的分轨；格式不对的丢 */
export function linkOf(m: Record<string, unknown>): { stems?: string[]; stemOf?: string } {
  const out: { stems?: string[]; stemOf?: string } = {}
  if (Array.isArray(m.stems)) { const s = [...new Set(m.stems.filter((x): x is string => typeof x === 'string' && LINK_RE.test(x)))].slice(0, 32); if (s.length) out.stems = s }
  if (typeof m.stemOf === 'string' && LINK_RE.test(m.stemOf)) out.stemOf = m.stemOf
  return out
}
const LINK_RE = /^[A-Za-z0-9_-]{1,64}$/
/** 读完整份素材清单后：stems 只留指得到、而且对方也认我的；stemOf 指不到的拿掉（原地改） */
export function fixStemLinks<M extends { id: string; stems?: string[]; stemOf?: string }>(list: M[]): M[] {
  const byId = new Map(list.map((m) => [m.id, m]))
  for (const m of list) {
    if (m.stems) { const s = m.stems.filter((id) => id !== m.id && byId.has(id)); if (s.length) m.stems = s; else delete m.stems }
    if (m.stemOf && (!byId.has(m.stemOf) || m.stemOf === m.id)) delete m.stemOf
  }
  return list
}

/** 读回存档（坏的、旧形的整条丢掉·⛔ 抛） */
export function parseStoredMedia(raw: string | null): StoredMedia[] {
  if (!raw) return []
  let v: unknown
  try { v = JSON.parse(raw) } catch { return [] }
  if (!Array.isArray(v)) return []
  const out: StoredMedia[] = []
  const seen = new Set<string>()
  for (const x of v) {
    if (!x || typeof x !== 'object') continue
    const o = x as Record<string, unknown>
    if (typeof o.id !== 'string' || !ID_RE.test(o.id) || seen.has(o.id)) continue
    if (typeof o.name !== 'string' || !o.name) continue
    if (!KINDS.includes(o.kind as VeditMediaKind)) continue
    if (typeof o.duration !== 'number' || !Number.isFinite(o.duration) || o.duration <= 0) continue
    if (o.from !== 'local' && o.from !== 'drive') continue
    const driveId = typeof o.driveId === 'string' && o.driveId ? o.driveId : undefined
    const url = typeof o.url === 'string' && /^https:\/\//.test(o.url) ? o.url : undefined
    if (o.from === 'drive' && (!driveId || !url)) continue
    seen.add(o.id)
    const cloudProxy = parseCloudProxy(o.cloudProxy, driveId)
    out.push({ id: o.id, name: o.name, kind: o.kind as VeditMediaKind, duration: o.duration, from: o.from, ...(driveId ? { driveId } : {}), ...(url && driveId ? { url } : {}), ...linkOf(o), ...(cloudProxy ? { cloudProxy } : {}) }) // 本机素材传过云盘 ⇒ 云盘链接也读回
  }
  return fixStemLinks(out)
}

/** 要存的那几条：本机素材只存原档已落进本机储存的（还没存好的·重新整理后读不回）；云盘素材都存（存云盘链接 remote·⛔ 存页面这次开的本机暂时链接） */
export function storableMedia<M extends Omit<StoredMedia, 'url'> & { stored?: boolean; remote?: string }>(list: readonly M[]): StoredMedia[] {
  const cp = (m: M) => { const c = parseCloudProxy(m.cloudProxy, m.driveId); return c ? { cloudProxy: c } : {} }
  return list
    // 本机素材传过云盘 ⇒ 连云盘链接一起记（本机那份没了照样从云盘开）
    .filter((m) => m.from === 'drive' ? !!m.remote : m.stored === true || (!!m.driveId && !!m.remote))
    .map((m) => ({ id: m.id, name: m.name, kind: m.kind, duration: m.duration, from: m.from, ...(m.driveId ? { driveId: m.driveId } : {}), ...(m.remote ? { url: m.remote } : {}), ...(m.stems?.length ? { stems: [...m.stems] } : {}), ...(m.stemOf ? { stemOf: m.stemOf } : {}), ...cp(m) }))
}

//（报修「剪辑页同 mediaId 播错音档」）：本机储存（OPFS 原档／预览档／波形）原本只按素材编号当键 ⇒
//   工程 A 的 m_vo（云盘档 X）存成 o-m_vo；开工程 B 的 m_vo（云盘档 Y）直接读到 X、播出别份工程的旧配音、波形也是 X 的。
//   改成按「这份内容」当键：
//   · 有云盘档编号 ⇒ d.<driveId>（云盘影音档同一编号内容不变：档案改内容只开放文字档·转码另起一行新编号）——不同工程、同名素材编号也分得开；
//     同一份云盘档用在哪份工程都是同一份内容 ⇒ 共用一份快取；⛔ 带工程编号（草稿是动手后才建的 ⇒ 建好那一刻键会变、刚下载的那份就读不回）。
//   · 本机汇入（from=local 且编号是汇入那一刻 crypto.randomUUID 发的）⇒ 编号本身就是这份档的指纹（别处不会再发同一个）⇒ 照旧用编号
//     （⛔ 换键：没传云盘的本机素材只有这一份原档·换了键就读不回＝素材丢了）。
//   · 都不是（角色写进工程档的自订编号又没云盘档）⇒ p.<工程编号>.<编号>·只在这份工程里认。
//   旧键（o-m_vo 这类）不再有人读·不会再被误用。
const LOCAL_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const keyPart = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, '')
/** 一份素材在本机储存里的键（档名由 origName／proxyName／peaksName 再套前缀）；projectId＝开着的工程档编号（没开 ⇒ null） */
export function mediaStoreKey(m: { id: string; from: 'local' | 'drive'; driveId?: string }, projectId: string | null): string {
  if (m.from === 'local' && LOCAL_UUID_RE.test(m.id)) return m.id
  if (m.driveId && keyPart(m.driveId)) return `d.${keyPart(m.driveId)}`
  return `p.${(projectId && keyPart(projectId)) || '_'}.${keyPart(m.id) || '_'}`
}

/** 本机储存里的档名：原档 o-<键>·预览档 p-<键>.mp4·声音波形峰值表 w-<键>.f32——键＝mediaStoreKey（⛔ 直接拿素材编号） */
export const origName = (id: string) => `o-${id}`
export const proxyName = (id: string) => `p-${id}.mp4`
export const peaksName = (id: string) => `w-${id}.f32`
/** 终端做好的缩图拼图（云盘下载回来的那份） */
export const thumbsName = (id: string) => `t-${id}.jpg`

/** 这支影片要不要转预览档·转成多大（宽高取偶数·⛔ 放大）。读不到尺寸 ⇒ 照长边 960 转。 */
export function proxyPlan(v: { kind: VeditMediaKind; width?: number; height?: number; sizeBytes?: number; duration?: number }): { width: number } | { height: number } | null {
  if (v.kind !== 'video') return null
  const w = v.width ?? 0, h = v.height ?? 0
  const long = Math.max(w, h)
  const bps = v.sizeBytes && v.duration && v.duration > 0 ? (v.sizeBytes * 8) / v.duration : null
  if (long > 0 && long <= PROXY_SKIP_LONG_SIDE && (bps === null || bps <= PROXY_SKIP_BITRATE)) return null
  if (long > 0 && long <= PROXY_LONG_SIDE) return null // 尺寸已经小（只是码率高）·再缩也省不了多少解码
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)
  return h > w ? { height: even(PROXY_LONG_SIDE) } : { width: even(PROXY_LONG_SIDE) }
}

/** 这么大的档放不放得进本机储存（estimate 读不到 ⇒ 放·真写满了 I/O 那头会报错再退回云端链接） */
export function canStore(sizeBytes: number, est: { quota?: number; usage?: number } | null): boolean {
  if (!est || !est.quota || est.quota <= 0) return true
  const free = est.quota * (1 - STORE_HEADROOM) - (est.usage ?? 0)
  return sizeBytes <= free
}

//（台版 Safari 27「The I/O read operation failed.」未处理拒绝）：选进来的本机原档后来被移走／改写，或在 iCloud 还没下载完 ⇒
// 浏览器手上的档案引用读不动（Safari 回 NotReadableError·Chrome 回 NotReadableError／NotFoundError）。
/** 这个错是不是「档案读不动了」（⛔ 当成解不开、存不下） */
export function isReadFail(e: unknown): boolean {
  const x = e as { name?: unknown; message?: unknown } | null
  if (!x || typeof x !== 'object') return false
  return x.name === 'NotReadableError' || x.name === 'NotFoundError' || /I\/O read operation failed|could not be read|requested file could not be/i.test(String(x.message ?? ''))
}
/** 给 mediabunny 来源的选项：读档器后台预读出的错（当下没有等着那段资料的读）原本变成未处理拒绝 ⇒ 交给 onFail（没给就吞掉·前台那一读自己会抛） */
export const quietSource = (onFail?: (e: unknown) => void) => ({ handleUnhandledError: (e: unknown) => { onFail?.(e) } })

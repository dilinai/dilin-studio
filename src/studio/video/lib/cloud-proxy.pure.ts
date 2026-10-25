// 代理档（编辑用小档）交给终端转、存云盘，换电脑共用——纯判断：
//   · 有壳（哪台终端装好了识别字幕或 AI 分轨＝有 PyAV ⇒ caps.media.proxy ready）：云盘原档交给那台转剪辑用小档＋缩图拼图＋波形，三份传回云盘，
//     工程档那份素材记 cloudProxy（of＝从哪份云盘原档转的·原档换了就作废）⇒ 任何一台打开都只下载小档（⛔ 拉整支原档）；
//   · 没壳／那台转不成／素材没进云盘（自动上传关了）⇒ 照旧在这个浏览器本机转（vedit-store makeProxy）。
//   · 汇出一律用原档：本机储存没原档 ⇒ 用云盘原档链接（⛔ 拿剪辑用小档出片）。
// ⛔ IO：下单／盯进度在 video-edit/vedit-shell-media.ts·下载进本机储存在 _lib/vedit-store.ts·接线在 video-edit/page.tsx。
import { defaultChoice, shellChoices, type MediaDevice, type MediaResult } from './shell-media.pure'

const UUID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i
const fid = (v: unknown): string | undefined => (typeof v === 'string' && UUID.test(v.trim()) ? v.trim() : undefined)
const posInt = (v: unknown, max: number): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= max ? v : null)

/** 缩图拼图：每 every 秒一格·一列 cols 格（由左到右、由上到下）·共 n 格（壳 runner.py THUMB_*） */
export type CloudThumbs = { id: string; every: number; cols: number; n: number }
/** 工程档素材上记的云盘代理档：of＝从哪份云盘原档转的；v＝剪辑用小档（没有＝原档本来就是小的一般 H.264·直接放原档）；w＝波形 JSON；t＝缩图拼图 */
export type CloudProxy = { of: string; v?: string; w?: string; t?: CloudThumbs }

function parseThumbs(raw: unknown, idKey: 'id' | 'file_id'): CloudThumbs | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as Record<string, unknown>
  const id = fid(o[idKey]), every = posInt(o.every, 3600), cols = posInt(o.cols, 100), n = posInt(o.n, 100_000)
  return id && every && cols && n ? { id, every, cols, n } : undefined
}

/** 工程档／本机清单读回的 cloudProxy 校形：形状不对、或不是从这份云盘原档（driveId）转的 ⇒ undefined（角色把素材改指别的云盘档 ⇒ 旧代理档作废） */
export function parseCloudProxy(raw: unknown, driveId: string | undefined): CloudProxy | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !driveId) return undefined
  const o = raw as Record<string, unknown>
  const of = fid(o.of)
  if (!of || of.toLowerCase() !== driveId.toLowerCase()) return undefined
  const v = fid(o.v), w = fid(o.w), t = parseThumbs(o.t, 'id')
  return { of, ...(v ? { v } : {}), ...(w ? { w } : {}), ...(t ? { t } : {}) }
}

/** 壳回的结果（kind proxy）⇒ 要记进素材的 cloudProxy；结果说要转却没给小档 ⇒ null（当失败·退回本机转） */
export function cloudProxyOf(r: MediaResult, of: string): CloudProxy | null {
  if (r.kind !== 'proxy') return null
  if (!r.skip && !r.proxy) return null
  return { of, ...(r.proxy ? { v: r.proxy } : {}), ...(r.peaks ? { w: r.peaks } : {}), ...(r.thumbs ? { t: { id: r.thumbs.file_id, every: r.thumbs.every, cols: r.thumbs.cols, n: r.thumbs.n } } : {}) }
}

/**
 * 这份影片的剪辑用小档怎么来：
 *   have＝这台本机储存已有 · fetch＝云盘有终端转好的 ⇒ 下载 · none＝终端看过、原档本来就小 ⇒ 不用转（直接放原档）·
 *   shell＝交给终端转（原档已在云盘·有一台能转）· wait＝等它传完云盘再交给终端（有终端能转·正在背景上传）· local＝这个浏览器本机转（照旧）
 * cloudFailed＝云盘那份这次取不到（删了／没权限）；shellFailed＝这份交给终端已经失败过一次（⛔ 一直重送）。
 */
export type ProxyRoute = 'have' | 'fetch' | 'none' | 'shell' | 'wait' | 'local'
export function proxyRoute(o: { kind: 'video' | 'audio' | 'image'; proxied: boolean; driveId?: string; cloud?: CloudProxy; cloudFailed?: boolean; shellReady: boolean; shellFailed?: boolean; uploading?: boolean }): ProxyRoute | null {
  if (o.kind !== 'video') return null
  if (o.proxied) return 'have'
  const cloud = o.cloud && o.driveId && o.cloud.of.toLowerCase() === o.driveId.toLowerCase() ? o.cloud : undefined
  if (cloud && !o.cloudFailed) return cloud.v ? 'fetch' : 'none'
  if (o.shellReady && !o.shellFailed) {
    if (o.driveId) return 'shell'
    if (o.uploading) return 'wait'
  }
  return 'local'
}
/** 要不要把整支原档下载进这台（云盘素材）：影片的小档走云盘（下载中／交终端转中／已换上云盘那份）⇒ ⛔ 拉原档（换电脑只拉小档·汇出用云盘原档链接）；其余照旧。
 *  cloudSmall＝这份记着云盘小档（cloudProxy.v） */
export const needOriginalDownload = (route: ProxyRoute | null, cloudSmall: boolean) => !(route === 'fetch' || route === 'shell' || route === 'wait' || (route === 'have' && cloudSmall))

/** 交给哪台转：能转（proxy ready）的那几台里·这个浏览器所在那台优先；都没有 ⇒ 接单会自己装小环境（installable·壳 f29ce16e 起）的那几台里挑；一台都没有 ⇒ null。
 *  原先只认 ready ⇒ 没装识别字幕／AI 分轨的电脑永远不收代理档。 */
export function proxyDevice(devs: readonly MediaDevice[] | null, localDeviceId: string | null): MediaDevice | null {
  if (!devs) return null
  const choices = shellChoices(devs, 'proxy')
  return defaultChoice(choices.filter((d) => d.view.proxy.state === 'ready'), localDeviceId)
    ?? defaultChoice(choices.filter((d) => d.view.proxy.state === 'installable'), localDeviceId)
}

/** 一页同时交给终端转的代理档至多几件：壳那头没做完的至多排 7 件（再送当场「沒排上」）——
 *  汇入一批影片就把 7 格全占满 ⇒ 用户按的识别字幕／拆曲送过去被拒·又被后面的代理档挤出 jobs 清单 ⇒ 留空位给有人在等的那几样 */
export const SHELL_PROXY_INFLIGHT = 2
/** 排队闸：同时至多 max 件在跑·其余照先来后到等（做完一件直接把位子交给下一件·⛔ 半路被新来的插队超量） */
export function slotGate(max: number) {
  let busy = 0
  const wait: Array<() => void> = []
  return {
    async run<T>(fn: () => Promise<T>): Promise<T> {
      if (busy >= max) await new Promise<void>((r) => wait.push(r))
      else busy++
      try { return await fn() } finally { const next = wait.shift(); if (next) next(); else busy-- }
    },
    get busy() { return busy },
    get waiting() { return wait.length },
  }
}

/** 波形 JSON（壳 peaks.json：{ v:1, rate:50, n, q16:<base64·uint16 小端·峰值×65535> }）⇒ 峰值表（同 makePeaks 那份·0..1）；坏形 ⇒ null */
export const PEAKS_JSON_MAX = 2_000_000
export function decodePeaksJson(json: unknown, peaksPerSec: number): Float32Array | null {
  if (!json || typeof json !== 'object') return null
  const o = json as Record<string, unknown>
  if (o.v !== 1 || o.rate !== peaksPerSec || typeof o.q16 !== 'string') return null
  let bin: string
  try { bin = atob(o.q16) } catch { return null }
  if (bin.length % 2 || bin.length < 2 || bin.length / 2 > PEAKS_JSON_MAX) return null
  const n = bin.length / 2
  if (typeof o.n === 'number' && o.n !== n) return null
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = (bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8)) / 65535
  return out
}

/** 时间轴缩图那一格（素材第 t 秒）用拼图的哪一格：最近那格离 t 超过 tol 秒（拉很近时格子比拼图细）⇒ null（照旧自己抓） */
export const SPRITE_TOL = 0.26
export function spriteCell(t: number, th: { every: number; cols: number; n: number }, tol = SPRITE_TOL): { i: number; col: number; row: number } | null {
  if (!(t >= 0) || !(th.every > 0) || !(th.n > 0) || !(th.cols > 0)) return null
  const i = Math.round(t / th.every)
  if (i >= th.n || Math.abs(t - i * th.every) > tol + 1e-9) return null
  return { i, col: i % th.cols, row: Math.floor(i / th.cols) }
}

/** 汇出时这份影片的画面从哪几份读（依序试）：本机原档（呼叫端先放）→ 放着的是剪辑用小档且有云盘原档 ⇒ 云盘原档（按需分段读）→ 现在播放那份；⛔ 拿小档出片。
 *  声音照旧读播放那份（混音是整份取回来解·原档可能好几 GB；小档的声音＝原声或 AAC 128k） */
export function exportUrls(m: { url: string; proxied?: boolean; remote?: string }): string[] {
  const out: string[] = []
  if (m.proxied && m.remote) out.push(m.remote)
  if (m.url && !out.includes(m.url)) out.push(m.url)
  return out
}

// 网页剪辑页·「網頁截圖」：贴一个网址 ⇒ 服务器用无头浏览器截一张高清长图 ⇒ 进素材区（登入版照本机汇入那条路·会背景上传云盘；游客版留在这台电脑）。
// 本档只放纯函数（页面、宿主、服务端路由、角色命令共用·题直接跑）：参数的形状与缺省、验值、截多高（高度上限与像素预算）、档名。
// 网址能不能连（只收 http/https、解析后拒内网…）是服务端的事：core/lib/web-shot-guard.ts；真截图在 core/lib/web-shot.ts。⛔ 碰 DOM／网路。

/** 倍率（截图的 deviceScaleFactor）：2x／3x */
export const WEB_SHOT_SCALES = [2, 3] as const
export type WebShotScale = (typeof WEB_SHOT_SCALES)[number]
export const WEB_SHOT_THEMES = ['light', 'dark'] as const
export type WebShotTheme = (typeof WEB_SHOT_THEMES)[number]

/** 视窗宽（CSS px） */
export const WEB_SHOT_WIDTH_DEFAULT = 1280
export const WEB_SHOT_WIDTH_MIN = 320
export const WEB_SHOT_WIDTH_MAX = 1920
/** 首屏模式的视窗高（CSS px）：宽 × 10/16（1280 ⇒ 800） */
export const firstScreenHeight = (width: number): number => Math.round(width * 10 / 16)
/** 整页最高截到多少（CSS px）：超过就截断、告诉使用者 */
export const WEB_SHOT_MAX_CSS_HEIGHT = 16000
/** 一张图最多几个装置像素（宽×高·按倍率算）：挡记忆体（Chromium 截图整张放在记忆体里·RGBA 4 位元组／像素） */
export const WEB_SHOT_MAX_DEVICE_PIXELS = 82_000_000
/** 一张图最高几个装置像素（Chromium 下 32000 高的长图正常） */
export const WEB_SHOT_MAX_DEVICE_HEIGHT = 32000
/** 网址最长几个字 */
export const WEB_SHOT_URL_MAX = 2048

export type WebShotOpts = { url: string; scale: WebShotScale; theme: WebShotTheme; width: number; full: boolean }
export const WEB_SHOT_DEFAULTS: Omit<WebShotOpts, 'url'> = { scale: 2, theme: 'light', width: WEB_SHOT_WIDTH_DEFAULT, full: true }

/** 验值失败的原因码（页面照码出白话·服务端回 400 带这个码） */
export type WebShotParamCode = 'bad_body' | 'url_missing' | 'url_too_long' | 'url_invalid' | 'url_protocol' | 'bad_scale' | 'bad_theme' | 'bad_width' | 'bad_full'

/**
 * 页面输入框里打的字 ⇒ 网址：去空白；没写协议 ⇒ 补 https://（只认 http/https·其余协议原样留着给 parse 拒）。
 * 例：「example.com」⇒「https://example.com」；「file:///etc/passwd」原样（parse 会拒）。
 */
export function normalizeShotUrl(raw: string): string {
  const s = raw.trim()
  if (!s) return ''
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^[^:/]+:\d+(\/|$)/.test(s)) return s // 有协议（host:port 那种不算协议）
  return `https://${s.replace(/^\/+/, '')}`
}

/** 验一份参数（服务端路由、角色命令、页面开始前都过这一道）：缺的用缺省、错的回原因码 */
export function parseWebShotOpts(raw: unknown): { ok: true; opts: WebShotOpts } | { ok: false; code: WebShotParamCode } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, code: 'bad_body' }
  const o = raw as Record<string, unknown>
  if (typeof o.url !== 'string' || !o.url.trim()) return { ok: false, code: 'url_missing' }
  const url = o.url.trim()
  if (url.length > WEB_SHOT_URL_MAX) return { ok: false, code: 'url_too_long' }
  let u: URL
  try { u = new URL(url) } catch { return { ok: false, code: 'url_invalid' } }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, code: 'url_protocol' }
  if (!u.hostname) return { ok: false, code: 'url_invalid' }
  const scale = o.scale === undefined ? WEB_SHOT_DEFAULTS.scale : o.scale
  if (!(WEB_SHOT_SCALES as readonly unknown[]).includes(scale)) return { ok: false, code: 'bad_scale' }
  const theme = o.theme === undefined ? WEB_SHOT_DEFAULTS.theme : o.theme
  if (!(WEB_SHOT_THEMES as readonly unknown[]).includes(theme)) return { ok: false, code: 'bad_theme' }
  const width = o.width === undefined ? WEB_SHOT_DEFAULTS.width : o.width
  if (typeof width !== 'number' || !Number.isInteger(width) || width < WEB_SHOT_WIDTH_MIN || width > WEB_SHOT_WIDTH_MAX) return { ok: false, code: 'bad_width' }
  const full = o.full === undefined ? WEB_SHOT_DEFAULTS.full : o.full
  if (typeof full !== 'boolean') return { ok: false, code: 'bad_full' }
  return { ok: true, opts: { url: u.toString(), scale: scale as WebShotScale, theme: theme as WebShotTheme, width, full } }
}

/** 这个宽、这个倍率下最多截多高（CSS px）：取 16000、像素预算、装置像素高上限三者最小 */
export function maxCssHeight(width: number, scale: number): number {
  const byPixels = Math.floor(WEB_SHOT_MAX_DEVICE_PIXELS / (width * scale * scale))
  const byDevice = Math.floor(WEB_SHOT_MAX_DEVICE_HEIGHT / scale)
  return Math.max(1, Math.min(WEB_SHOT_MAX_CSS_HEIGHT, byPixels, byDevice))
}

/**
 * 截多高：首屏＝视窗高（页面比视窗矮就截页面高）；整页＝页面高、超过上限就截到上限并标 truncated。
 * pageHeight 量不到（NaN／0／负）⇒ 当成视窗高。
 */
export function planShotHeight(o: { pageHeight: number; width: number; scale: number; full: boolean }): { height: number; truncated: boolean; cap: number } {
  const cap = maxCssHeight(o.width, o.scale)
  const vh = Math.min(firstScreenHeight(o.width), cap)
  const ph = Number.isFinite(o.pageHeight) && o.pageHeight > 0 ? Math.ceil(o.pageHeight) : vh
  if (!o.full) return { height: Math.max(1, Math.min(vh, ph)), truncated: false, cap }
  if (ph > cap) return { height: cap, truncated: true, cap }
  return { height: Math.max(1, ph), truncated: false, cap }
}

/** 档名：「網頁截圖-<主机>.png」（主机里不能当档名的字换掉·最长 80） */
export function webShotFileName(url: string, ext: 'png' | 'jpg', prefix: string): string {
  let host = 'page'
  try { host = new URL(url).hostname || 'page' } catch { /* 用 page */ }
  const safe = host.replace(/[^A-Za-z0-9.-]/g, '_').slice(0, 80) || 'page'
  return `${prefix}-${safe}.${ext}`
}

/** 服务端回的失败原因码（页面照码出白话） */
export const WEB_SHOT_FAIL_CODES = ['bad_param', 'blocked', 'dns', 'unreachable', 'timeout', 'too_large', 'busy', 'rate', 'unauthorized', 'failed'] as const
export type WebShotFailCode = (typeof WEB_SHOT_FAIL_CODES)[number] | 'cancelled'
/** 服务端回包的 code ⇒ 页面认得的原因码（不认得 ⇒ failed） */
export function webShotFailCode(code: unknown, status?: number): WebShotFailCode {
  if (status === 429) return 'rate'
  if (typeof code === 'string' && (WEB_SHOT_FAIL_CODES as readonly string[]).includes(code)) return code as WebShotFailCode
  if (typeof code === 'string' && /^(url_|bad_)/.test(code)) return 'bad_param'
  if (status === 401) return 'unauthorized'
  if (status === 503) return 'busy'
  return 'failed'
}

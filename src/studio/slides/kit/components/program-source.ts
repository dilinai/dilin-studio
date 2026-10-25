/**
 * 简报程序动画「死循环计时闸」·来源规范编码与完整 key。
 *
 * 一份码、两端共用：服务端编译（compileProgram）与客户端算 key（决定能不能跑 compiled）都 import 这一档。
 *   canonicalProgramSource({html, css, steps})：有型别、有边界的规范编码（固定键序 JSON·字串自带边界与转义）；
 *     型别不对一律抛 ProgramSourceError ⇒ 服务端拒收 program_bad_input、客户端算不出 key ⇒ 该框静态。⛔ 两端各自猜转型。
 *   programSourceKey(...)：'sha256:' + 完整 64 位十六进制（同步纯 JS SHA-256·不靠 WebCrypto 的 async·两端结果逐字同）。
 * 纯函数·无依赖·客户端／服务端共用。
 */

/** 编译器版本：插检查的规则、分类、产物格式变了就加一 ⇒ 旧 compiled 的 key 自动对不上 ⇒ 重编或静态 */
export const PROGRAM_COMPILER_VERSION = 1
/** 运行时（programRuntimeJs）版本 */
export const PROGRAM_RUNTIME_VERSION = 1
/** 守卫与 CSP 政策版本：决定检查函式名后缀 K 与守卫正文（ K 改政策常量） */
export const PROGRAM_POLICY_VERSION = 3
/** compiled 产物格式版本（客户端只认现行） */
export const PROGRAM_COMPILED_V = 1
/** 检查函式名（Object.prototype 上不可写不可配置的属性）·随政策版本·⛔ 由来源派生 */
export const PROGRAM_CHECK_NAME = `__dlg_p${PROGRAM_POLICY_VERSION}` as const
/** steps 合法范围（与 COMPONENT_LIMITS.programStepsMax 同·另有题钉住两者一致） */
export const PROGRAM_SOURCE_STEPS_MAX = 50

/** 命名空间（script／事件属性所在元素） */
export type ProgramNs = 'html' | 'svg' | 'mathml'
/** 编译记录：组装后逐段核（program-verify.ts）照这份比 */
export type CompiledScript =
  | { kind: 'classic' | 'module'; ns: ProgramNs; type: string | null; text: string; hash: string }
  | { kind: 'data'; ns: ProgramNs; type: string | null; text: string }
export type CompiledAttr = { ns: ProgramNs; el: string; name: string; value: string; hash: string }
/** 服务端编译产物（只存作者片段·外层框文件每次由 program-assemble.ts 可信重建） */
export type CompiledProgram = {
  v: typeof PROGRAM_COMPILED_V
  key: string
  /** 编译后的作者 html */
  html: string
  css: string
  /** 这份作者片段的 CSP 名单（可执行 script 与事件属性的 'sha256-…'·去重有序） */
  hashes: string[]
  scripts: CompiledScript[]
  attrs: CompiledAttr[]
  /** 编译时拿掉的东西（外部 src／importmap 等不支援的 script）·一条一句（繁中白话）；没拿掉就没有这栏。只给编辑页提示用·⛔ 进组装／核对 */
  notices?: string[]
}

export class ProgramSourceError extends Error {
  readonly code = 'program_bad_input' as const
  constructor(readonly field: 'html' | 'css' | 'steps', message: string) { super(message) }
}

export type ProgramSourceInput = { html: unknown; css?: unknown; steps?: unknown }
export type ProgramSourceNormalized = { html: string; css: string; steps: number }

/** 规范化（ 规范编码合同）：html 必须字串；css 字串或 null／undefined ⇒ ""；steps 缺省 0、否则必须 0–50 的整数（Number.isInteger）。 */
export function normalizeProgramSource(src: ProgramSourceInput): ProgramSourceNormalized {
  const { html, css, steps } = src
  if (typeof html !== 'string') throw new ProgramSourceError('html', '程序的 html 必須是文字')
  let c: string
  if (css === undefined || css === null) c = ''
  else if (typeof css === 'string') c = css
  else throw new ProgramSourceError('css', '程序的 css 必須是文字')
  let s: number
  if (steps === undefined) s = 0
  else if (typeof steps === 'number' && Number.isInteger(steps) && steps >= 0 && steps <= PROGRAM_SOURCE_STEPS_MAX) s = steps === 0 ? 0 : steps // -0 ⇒ 0
  else throw new ProgramSourceError('steps', `程序的步數必須是 0～${PROGRAM_SOURCE_STEPS_MAX} 的整數`)
  return { html, css: c, steps: s }
}

/** 规范编码：固定键序 {"v":1,"html","css","steps","compiler","runtime","policy"}·JSON.stringify 产生 */
export function canonicalProgramSource(src: ProgramSourceInput): string {
  const n = normalizeProgramSource(src)
  return JSON.stringify({
    v: 1,
    html: n.html,
    css: n.css,
    steps: n.steps,
    compiler: PROGRAM_COMPILER_VERSION,
    runtime: PROGRAM_RUNTIME_VERSION,
    policy: PROGRAM_POLICY_VERSION,
  })
}

/** 完整 key：'sha256:'＋64 位小写十六进制（对规范编码的 UTF-8 字节） */
export function programSourceKey(src: ProgramSourceInput): string {
  return 'sha256:' + sha256Hex(canonicalProgramSource(src))
}

/** 不抛的版本：型别不对 ⇒ null（客户端用：null ⇒ 静态） */
export function tryProgramSourceKey(src: ProgramSourceInput): string | null {
  try { return programSourceKey(src) } catch { return null }
}

/**
 * 编辑页提示：这份 compiled 是现行版本、且 key 对得上现在的原文，才回它记的「拿掉了什么」；
 * 否则（没编、改了还没存回、旧版本产物）回空——⛔ 拿上一版的提示说这一版。
 */
export function compiledProgramNotices(c: ProgramSourceInput & { compiled?: unknown }): string[] {
  return compiledProgramRemoved(c).list
}

/** 提示明细最多列几条（总数另给·F-COMPILE-NOTICE-COUNT-CAP：⛔ 拿截过的明细长度当总数） */
export const PROGRAM_NOTICES_LIST_MAX = 20

/** 同 compiledProgramNotices，另回总数：count＝这次真拿掉几段（不截）、list＝前 PROGRAM_NOTICES_LIST_MAX 条明细。 */
export function compiledProgramRemoved(c: ProgramSourceInput & { compiled?: unknown }): { count: number; list: string[] } {
  const cp = c.compiled as Partial<CompiledProgram> | null | undefined
  if (!cp || typeof cp !== 'object' || cp.v !== PROGRAM_COMPILED_V || !Array.isArray(cp.notices)) return { count: 0, list: [] }
  if (cp.key !== tryProgramSourceKey({ html: c.html, css: c.css, steps: c.steps })) return { count: 0, list: [] }
  const all = cp.notices.filter((x): x is string => typeof x === 'string' && x !== '')
  return { count: all.length, list: all.slice(0, PROGRAM_NOTICES_LIST_MAX) }
}

/* ------------------------------------------------------------------ */
/* 同步 SHA-256（FIPS 180-4·对字串的 UTF-8 字节）                        */
/* ------------------------------------------------------------------ */

const K256 = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

/** 字串 ⇒ UTF-8 字节（孤立代理一律换成 U+FFFD·与 TextEncoder 同） */
export function utf8Bytes(s: string): Uint8Array {
  const out: number[] = []
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i)
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = i + 1 < s.length ? s.charCodeAt(i + 1) : 0
      if (d >= 0xdc00 && d <= 0xdfff) { c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00); i++ } else c = 0xfffd
    } else if (c >= 0xdc00 && c <= 0xdfff) c = 0xfffd
    if (c < 0x80) out.push(c)
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63))
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
  }
  return Uint8Array.from(out)
}

export function sha256Bytes(msg: Uint8Array): Uint8Array {
  const len = msg.length
  const total = (((len + 9 + 63) >> 6) << 6)
  const buf = new Uint8Array(total)
  buf.set(msg)
  buf[len] = 0x80
  const bits = len * 8
  const hi = Math.floor(bits / 0x100000000), lo = bits >>> 0
  buf[total - 8] = hi >>> 24; buf[total - 7] = (hi >>> 16) & 255; buf[total - 6] = (hi >>> 8) & 255; buf[total - 5] = hi & 255
  buf[total - 4] = lo >>> 24; buf[total - 3] = (lo >>> 16) & 255; buf[total - 2] = (lo >>> 8) & 255; buf[total - 1] = lo & 255
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19])
  const W = new Uint32Array(64)
  for (let off = 0; off < total; off += 64) {
    for (let t = 0; t < 16; t++) W[t] = (buf[off + 4 * t] << 24) | (buf[off + 4 * t + 1] << 16) | (buf[off + 4 * t + 2] << 8) | buf[off + 4 * t + 3]
    for (let t = 16; t < 64; t++) {
      const a = W[t - 15], b = W[t - 2]
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3)
      const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10)
      W[t] = (W[t - 16] + s0 + W[t - 7] + s1) >>> 0
    }
    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7]
    for (let t = 0; t < 64; t++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))
      const ch = (e & f) ^ (~e & g)
      const t1 = (h + S1 + ch + K256[t] + W[t]) >>> 0
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))
      const mj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (S0 + mj) >>> 0
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0
  }
  const out = new Uint8Array(32)
  for (let i = 0; i < 8; i++) { out[4 * i] = H[i] >>> 24; out[4 * i + 1] = (H[i] >>> 16) & 255; out[4 * i + 2] = (H[i] >>> 8) & 255; out[4 * i + 3] = H[i] & 255 }
  return out
}

export function sha256Hex(s: string): string {
  const b = sha256Bytes(utf8Bytes(s))
  let x = ''
  for (let i = 0; i < b.length; i++) x += (b[i] < 16 ? '0' : '') + b[i].toString(16)
  return x
}

/** CSP 用：'sha256-<base64>'（对字串 UTF-8 字节·与浏览器对 script 文字算法同） */
export function cspSha256(s: string): string {
  const b = sha256Bytes(utf8Bytes(s))
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let o = ''
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0)
    o += A[(n >> 18) & 63] + A[(n >> 12) & 63] + (i + 1 < b.length ? A[(n >> 6) & 63] : '=') + (i + 2 < b.length ? A[n & 63] : '=')
  }
  return `'sha256-${o}'`
}

/**
 * 简报程序动画「死循环计时闸」·框文件唯一组装函数。
 *
 * 文件结构固定（一个字都不由作者决定，作者内容一律在 CSP meta 之后）：
 *   <!DOCTYPE html><html><head><meta charset="UTF-8">
 *   ＋前置脚本（＝回暗号脚本 ALIVE_HEAD＋gen＋ALIVE_TAIL·在 CSP 之前所以不受政策管、不进名单·只有 gen 一处变量）
 *   ＋<meta http-equiv="Content-Security-Policy">（script-src 只认 'unsafe-hashes'＋hash 名单·⛔ unsafe-inline／unsafe-eval）
 *   ＋关 DNS 预取＋守卫＋网路／Worker／Blob 守卫＋色彩与底样式（尺寸／背景／字型栈·白名单格式）＋作者 css＋运行时
 *   </head><body>＋编译后作者 html＋</body></html>
 * 名单＝固定名单（守卫、三个网路守卫、运行时·随 steps）＋compiled.hashes。
 * arm（放成 allow-scripts 时换一次性暗号）只换 gen 那一段：rearmProgramDoc；
 * 现行 injectProgramAliveProbe／盯 load 脚本的 strip＋inject 对组装文件结果相同（另有题钉住）。
 * 本档不 import parse5（客户端首包可用）；读回逐段核在 program-verify.ts。纯函数·客户端／服务端共用。
 */
import {
  ALIVE_HEAD, ALIVE_TAIL, PROGRAM_BLOB_GUARD, PROGRAM_NET_GUARD, PROGRAM_STOP_NOTICE, PROGRAM_WORKER_GUARD, SLIDES_PROGRAM_CSP, type ProgramStopWhy,
} from '../../../shared/program-sandbox'
import { cspSha256, PROGRAM_SOURCE_STEPS_MAX, type CompiledProgram } from './program-source'
import { PROGRAM_GEN_RE, PROGRAM_GUARD_JS } from './program-guard'
import { programRuntimeJs } from './program'

export const PROGRAM_DOC_HEAD0 = '<!DOCTYPE html><html><head><meta charset="UTF-8">'
export const PROGRAM_DOC_TAIL = '</body></html>'

export class ProgramAssembleError extends Error {
  readonly code = 'program_assemble_error' as const
}

/** 框外观（不进 compiled·每次组装现场给）：设计尺寸、已解出的背景色、字型栈、组件 steps 栏 */
export type ProgramFrameProps = { w: number; h: number; bg: string; font: string; steps: number }

const BG_RE = /^(?:transparent|#[0-9a-fA-F]{3,8}|[a-zA-Z]{1,32}|(?:rgba?|hsla?)\([0-9.,%\s/+-]{1,64}\))$/
const FONT_RE = /^[^<>{};\\\r\n]{1,400}$/

export function checkFrameProps(p: ProgramFrameProps): ProgramFrameProps {
  const dim = (v: unknown, k: string) => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v > 100000) throw new ProgramAssembleError(`框尺寸 ${k} 不合格式`)
    return v
  }
  if (typeof p.bg !== 'string' || !BG_RE.test(p.bg)) throw new ProgramAssembleError('框背景色不合格式')
  if (typeof p.font !== 'string' || !FONT_RE.test(p.font)) throw new ProgramAssembleError('框字型不合格式')
  if (!Number.isInteger(p.steps) || p.steps < 0 || p.steps > PROGRAM_SOURCE_STEPS_MAX) throw new ProgramAssembleError('步數不合格式')
  return { w: dim(p.w, 'w'), h: dim(p.h, 'h'), bg: p.bg, font: p.font, steps: p.steps }
}

const inner = (tag: string): string => {
  const m = /^<script>([\s\S]*)<\/script>$/.exec(tag)
  if (!m) throw new Error('固定守卫不是单一 <script>')
  return m[1]
}
/** 固定可信脚本（守卫与三个网路守卫）·依文件顺序；运行时另随 steps */
export const PROGRAM_FIXED_SCRIPTS: readonly string[] = [PROGRAM_GUARD_JS, inner(PROGRAM_NET_GUARD), inner(PROGRAM_WORKER_GUARD), inner(PROGRAM_BLOB_GUARD)]

/** 前置脚本（含标签）：只有 gen 一处变量 */
export function programPrefixScript(gen: string): string {
  if (!PROGRAM_GEN_RE.test(gen)) throw new ProgramAssembleError('世代暗號不合格式')
  return ALIVE_HEAD + gen + ALIVE_TAIL
}

/** CSP 名单：固定（守卫、网路守卫、运行时）＋这份作者片段的·去重保序 */
export function programHashList(compiled: Pick<CompiledProgram, 'hashes'>, steps: number): string[] {
  const fixed = [...PROGRAM_FIXED_SCRIPTS, programRuntimeJs(steps)].map(cspSha256)
  return [...new Set([...fixed, ...compiled.hashes])]
}

/** CSP：照 SLIDES_PROGRAM_CSP，只把 script-src 换成 'unsafe-hashes'＋名单 */
export function programCsp(hashes: readonly string[]): string {
  for (const h of hashes) if (!/^'sha256-[A-Za-z0-9+/]{43}='$/.test(h)) throw new ProgramAssembleError('名單裡有不合格式的 hash')
  return SLIDES_PROGRAM_CSP.split('; ').map((d) => (d.startsWith('script-src ') ? ["script-src 'unsafe-hashes'", ...hashes].join(' ') : d)).join('; ')
}

/** 可信段：文件开头到 <body>（含作者 css·css 已在编译时拒 </style）——读回核逐字比这段 */
export function programTrustedHead(compiled: CompiledProgram, props: ProgramFrameProps, gen: string): string {
  const p = checkFrameProps(props)
  if (/<\/style/i.test(compiled.css)) throw new ProgramAssembleError('樣式裡不能出現 </style')
  const csp = programCsp(programHashList(compiled, p.steps))
  const base = `*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}:root{color-scheme:light}html,body{width:${p.w}px;height:${p.h}px;overflow:hidden;background:${p.bg}}body{font-family:${p.font}}`
  return PROGRAM_DOC_HEAD0
    + programPrefixScript(gen)
    + `<meta http-equiv="Content-Security-Policy" content="${csp}">`
    + '<meta http-equiv="x-dns-prefetch-control" content="off">'
    + PROGRAM_FIXED_SCRIPTS.map((s) => `<script>${s}</script>`).join('')
    + `<meta name="color-scheme" content="light"><style>${base}</style>`
    + (compiled.css ? `<style>${compiled.css}</style>` : '')
    + `<script>${programRuntimeJs(p.steps)}</script>`
    + '</head><body>'
}

/** 唯一组装函数 */
export function assembleProgramDoc(compiled: CompiledProgram, props: ProgramFrameProps, gen: string): string {
  return programTrustedHead(compiled, props, gen) + compiled.html + PROGRAM_DOC_TAIL
}

/** 从组装文件读出 gen（开头不是 HEAD0＋前置模板头、或 gen 不合格式 ⇒ null） */
export function programDocGen(doc: string): string | null {
  const head = PROGRAM_DOC_HEAD0 + ALIVE_HEAD
  if (!doc.startsWith(head)) return null
  const end = doc.indexOf('"', head.length)
  if (end < 0) return null
  const gen = doc.slice(head.length, end)
  return PROGRAM_GEN_RE.test(gen) && doc.startsWith(ALIVE_TAIL, end) ? gen : null
}

/** arm：只换 gen 那一段（其余字节逐字不动）·原文件读不出 gen ⇒ 抛 */
export function rearmProgramDoc(doc: string, gen: string): string {
  const old = programDocGen(doc)
  if (old === null) throw new ProgramAssembleError('不是組裝過的程序框文件')
  if (!PROGRAM_GEN_RE.test(gen)) throw new ProgramAssembleError('世代暗號不合格式')
  const at = PROGRAM_DOC_HEAD0.length + ALIVE_HEAD.length
  return doc.slice(0, at) + gen + doc.slice(at + old.length)
}

/* 计时闸：程序框「为什么没在跑」那句（编辑画布／放映的 ProgramView 与旧存稿补护 program-harden 共用） */
export type ProgramNoticeLang = 'zh-TW' | 'zh-CN' | 'en'
export type ProgramNotStarted = 'uncompiled' | 'pending' | 'error' | 'frame' | 'unverified' | ProgramStopWhy
const PROGRAM_NOTICE: Record<ProgramNotStarted, Record<ProgramNoticeLang, string>> = {
  uncompiled: { 'zh-TW': '這段程序要重新存一次才會播放', 'zh-CN': '这段程序要重新存一次才会播放', en: 'Save this program again to play it' },
  pending: { 'zh-TW': '程序改過了，存好後才會播放', 'zh-CN': '程序改过了，存好后才会播放', en: 'Program changed; it will play once saved' },
  error: { 'zh-TW': '程序有錯，播放不了', 'zh-CN': '程序有错，播放不了', en: 'This program has an error and cannot play' },
  frame: { 'zh-TW': '程序框的外觀設定不合格式，播放不了', 'zh-CN': '程序框的外观设定不合格式，播放不了', en: 'Program frame settings are invalid' },
  unverified: { 'zh-TW': '程序核對沒過，播放不了', 'zh-CN': '程序核对没过，播放不了', en: 'Program check failed; not playing' },
  ...PROGRAM_STOP_NOTICE,
}
export function programNoticeText(why: ProgramNotStarted, lang: ProgramNoticeLang = 'zh-TW', detail?: string): string {
  const t = PROGRAM_NOTICE[why][lang] ?? PROGRAM_NOTICE[why]['zh-TW']
  return detail ? `${t}：${detail.slice(0, 160)}` : t
}

/** 旧存稿补护／静态框用：srcdoc 是不是本档组装出来的那种文件（回暗号脚本拿掉后＝HEAD0＋只认 hash 的 CSP meta） */
export function isAssembledProgramDoc(doc: string): boolean {
  const d = doc.startsWith(PROGRAM_DOC_HEAD0 + ALIVE_HEAD) ? (() => { const e = doc.indexOf('</script>', PROGRAM_DOC_HEAD0.length); return e < 0 ? doc : PROGRAM_DOC_HEAD0 + doc.slice(e + 9) })() : doc
  const lead = PROGRAM_DOC_HEAD0 + '<meta http-equiv="Content-Security-Policy" content="'
  if (!d.startsWith(lead)) return false
  const end = d.indexOf('"', lead.length)
  if (end < 0) return false
  const csp = d.slice(lead.length, end)
  // 只看 script-src 那条（style-src 本来就带 unsafe-inline）
  const ss = csp.split('; ').filter((x) => x.startsWith('script-src '))
  return ss.length === 1 && ss[0].startsWith("script-src 'unsafe-hashes' ") && !/unsafe-inline|unsafe-eval|strict-dynamic|\*|https?:|data:|blob:/.test(ss[0])
}

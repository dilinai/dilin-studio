/**
 * 简报程序动画「死循环计时闸」·组装后逐段核。
 * 任一不符 ⇒ { ok:false, reason }＝整份静态（⛔ 退回跑原文）。会 import parse5 ⇒ 客户端用动态 import 载入（不进首包），核过前框静态。
 *
 * 核三层：
 *   ① 可信段逐字：文件开头到 <body> ＝ programTrustedHead(compiled, props, gen)（gen 由前置模板读出·格式不合即不符）；
 *      整份 ＝ 可信段＋compiled.html＋</body></html>。
 *   ② parse5 读回整份文件（scripting 开·与 allow-scripts 框同一语境），按文件顺序（含 <template> 内容、SVG）：
 *      CSP meta 恰一份、就是可信段那一份（内容逐字同）；
 *      script：前 6 段＝前置＋守卫＋三个网路守卫＋运行时（HTML·无属性·文字逐字同）；其后按 compiled.scripts 逐段核——
 *        可执行：分类（classic／module）、namespace、type 属性、文字逐字同记录，sha256 同记录且在名单；
 *        资料：分类、namespace、type、文字逐字同记录（不要求 hash）；
 *        任何带 src（SVG 含 href）或分类为不支援的 script、或段数不符 ⇒ 不符。
 *   ③ 事件属性（无命名空间的 on*）：按文件顺序逐个同 compiled.attrs（namespace、元素名、属性名、解码后值），hash 同记录且在名单；个数相同。
 */
import { parse } from 'parse5'
import { cspSha256, type CompiledProgram } from './program-source'
import { ALIVE_HEAD, ALIVE_TAIL, PROGRAM_ALIVE_ID } from '../../../shared/program-sandbox'
import {
  PROGRAM_DOC_TAIL, PROGRAM_FIXED_SCRIPTS, programCsp, programDocGen, programHashList, programTrustedHead, type ProgramFrameProps,
} from './program-assemble'
import { programRuntimeJs } from './program'
import { attrOf, classifyScript, hasSrc, isEventAttrName, nsOf, textOf, walkElements, type P5Element } from './program-html'

export type ProgramVerifyResult = { ok: true; gen: string } | { ok: false; reason: string }

export function verifyProgramDoc(doc: string, compiled: CompiledProgram, props: ProgramFrameProps): ProgramVerifyResult {
  const no = (reason: string): ProgramVerifyResult => ({ ok: false, reason })
  if (typeof doc !== 'string') return no('文件不是文字')
  const gen = programDocGen(doc)
  if (gen === null) return no('前置腳本不合模板或世代暗號不合格式')
  let head: string
  try { head = programTrustedHead(compiled, props, gen) } catch (e) { return no(`組裝參數不合：${(e as Error).message}`) }
  if (!doc.startsWith(head)) return no('可信段（文件開頭到 <body>）與模板不符')
  if (doc !== head + compiled.html + PROGRAM_DOC_TAIL) return no('作者片段與編譯記錄不符')

  const list = programHashList(compiled, props.steps)
  const allowed = new Set(list)
  const csp = programCsp(list)
  const fixed = [ALIVE_HEAD.slice(ALIVE_HEAD.indexOf('>') + 1) + gen + ALIVE_TAIL.slice(0, -'</script>'.length), ...PROGRAM_FIXED_SCRIPTS, programRuntimeJs(props.steps)]

  const tree = parse(doc, { scriptingEnabled: true })
  const scripts: P5Element[] = []
  const handlers: Array<{ el: P5Element; name: string; value: string }> = []
  let cspMetas = 0, cspOk = false
  walkElements(tree, (el) => {
    if (el.tagName === 'script') scripts.push(el)
    if (el.tagName === 'meta' && (attrOf(el, 'http-equiv') ?? '').trim().toLowerCase() === 'content-security-policy') {
      cspMetas++
      cspOk = attrOf(el, 'content') === csp && nsOf(el) === 'html' && el.parentNode?.nodeName === 'head'
    }
    for (const a of el.attrs) if (!a.namespace && isEventAttrName(a.name)) handlers.push({ el, name: a.name, value: a.value })
  })
  if (cspMetas !== 1 || !cspOk) return no(`CSP meta 應恰一份且與名單相符（讀回 ${cspMetas} 份）`)

  const recs = compiled.scripts
  if (scripts.length !== fixed.length + recs.length) return no(`script 段數不符（讀回 ${scripts.length}、應為 ${fixed.length + recs.length}）`)
  for (let i = 0; i < fixed.length; i++) {
    const el = scripts[i]
    // 前置脚本带 id（回暗号脚本的辨识）；其余可信脚本无属性
    const attrsOk = i === 0
      ? el.attrs.length === 1 && el.attrs[0].name === 'id' && el.attrs[0].value === PROGRAM_ALIVE_ID && !el.attrs[0].namespace
      : el.attrs.length === 0
    if (nsOf(el) !== 'html' || !attrsOk || textOf(el) !== fixed[i]) return no(`第 ${i + 1} 段可信腳本與模板不符`)
    if (i > 0 && !allowed.has(cspSha256(fixed[i]))) return no(`第 ${i + 1} 段可信腳本不在名單`)
  }
  for (let j = 0; j < recs.length; j++) {
    const el = scripts[fixed.length + j], rec = recs[j], where = `作者第 ${j + 1} 段腳本`
    if (hasSrc(el)) return no(`${where}帶 src／href（外部腳本一律不跑）`)
    const { cls, type } = classifyScript(el)
    if (cls === 'unsupported') return no(`${where}的類型不支援`)
    if ((cls === 'data') !== (rec.kind === 'data') || (cls !== 'data' && cls !== rec.kind)) return no(`${where}的類型與編譯記錄不符`)
    if (nsOf(el) !== rec.ns || type !== rec.type) return no(`${where}的命名空間或 type 與編譯記錄不符`)
    const text = textOf(el)
    if (text !== rec.text) return no(`${where}的文字與編譯記錄不符`)
    if (rec.kind !== 'data') {
      const h = cspSha256(text)
      if (h !== rec.hash || !allowed.has(h)) return no(`${where}的 hash 不在名單`)
    }
  }
  if (handlers.length !== compiled.attrs.length) return no(`事件屬性個數不符（讀回 ${handlers.length}、應為 ${compiled.attrs.length}）`)
  for (let k = 0; k < handlers.length; k++) {
    const got = handlers[k], rec = compiled.attrs[k], where = `第 ${k + 1} 個事件屬性`
    if (nsOf(got.el) !== rec.ns || got.el.tagName !== rec.el || got.name !== rec.name || got.value !== rec.value) return no(`${where}與編譯記錄不符`)
    const h = cspSha256(got.value)
    if (h !== rec.hash || !allowed.has(h)) return no(`${where}的 hash 不在名單`)
  }
  return { ok: true, gen }
}

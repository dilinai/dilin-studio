// 编辑公式时的纯函数
//   ① 点格带入：光标处能不能插引用／插入或替换刚插的那段／F4 在 A1→$A$1→A$1→$A1→A1 间循环
//   ② 引用上色：公式里每个引用一种颜色（网格虚框同色）
//   ③ 语法检查（即时）：括号不配对／未知函数名／参数个数不对／引用格式错／运算符连用／结尾缺数值…⇒ 错在哪一段＋哪一类
//   ④ 函数名自动补全：打到函数名一半 ⇒ 前缀相符的函数清单·选中插入「SUM(」
//
// ── 出处与授权 ──
// univer（https://github.com/dream-num/univer ·commit 511bfd2）·Apache License 2.0·Copyright 2023-present DreamNum Co., Ltd.：
//   · packages/engine-formula/src/formula-editor-helpers.ts —— isFormulaReferenceAddingTextContext（前一字是「可插引用记号」且后一字为空或是
//       非左括号的记号 ⇒ 能插）、resolveFormulaReferenceEditingContext（光标落在已有引用上 ⇒ 替换那段）、getFormulaReplaceResult
//       （补全选中后换成函数名·后面不是「(」就补「(」）、searchFormulaFunctions（前 10 条）
//   · packages/engine-formula/src/basics/match-token.ts matchRefDrawToken —— 可插引用记号＝全部运算符／比较符＋( , : { [ ; % # @＋空格·
//       排除 ) } 与引号
//   · packages/engine-formula/src/services/formula/description.service.ts getSearchListByNameFirstLetter —— 补全＝函数名前缀相符·不分大小写
//   · packages/sheets-formula-ui/src/commands/utils/reference-absolute.ts —— F4：_getNextAbsoluteRefType（NONE→ALL→ROW→COLUMN→NONE
//       ＝A1→$A$1→A$1→$A1）·区间：光标在冒号前只切起点、冒号后只切终点、正在冒号上两端一起切
//   · packages/engine-formula/src/engine/analysis/lexer-tree-builder.ts —— 语法错的判法：_checkErrorState（括号没闭）、
//       _formulaErrorLastTokenCheck（结尾是运算符／运算符后直接接「)」或「,」）、_suffixExpressionHandler（运算符连用 =-(2)+*9·
//       缺运算符 =(1+3)9）、FunctionNode 参数个数 minParams／maxParams（SUM 1..255）、未知函数 #NAME?
//   · packages/engine-formula/src/formula-editor-helpers.ts buildFormulaTextRuns —— 引用上色：同一段字同一色·按出现序轮流取色
//   · packages/themes/src/default.ts loop-color.1～12 —— 引用轮色 12 色
// fortune-sheet（https://github.com/ruilisi/fortune-sheet ·commit 9434660）·MIT License·Copyright (c) 2022 Suzhou Ruilisi Technology Co., Ltd：
//   · packages/core/src/modules/formula.ts rangeSetValue —— 刚点格插进去的那段（rangestart）没被打字打断前·再点别格＝换掉它·一打字就重置
// 已修改（Apache-2.0 §4(b) 修改声明）：univer 这些都架在它自己的词法树（sequenceNodes）上；本仓引擎（formula.ts）只有四则／括号／引用／区间／
//   SUM AVERAGE MIN MAX COUNT NA ⇒ 这里按本仓文法重写一个带位置的小扫描器＋递归下降检查器（报第一个错与它的起止位置）；
//   语法错 univer 一律落 #VALUE!·这里分成 11 类各给一句中文说明；不支援的符号（{ } ! ; 等）直接报「不支援的符號」。
//   引擎多了字串 "…"、比较 = <> < > <= >=、串接 &、乘方 ^、百分 %、TRUE／FALSE、整列 A:A ⇒ 检查器同步认这些（函数清单仍读 FUNCTION_SPECS）。

import { FUNCTION_SPECS, REF_AT_RE, sheetPrefixAt, sheetKey, quoteSheetName } from './formula'
import { scanRefs, refPartText, type RefSpan } from './formula-refs'
import type { Rect } from './style'

// ═════════════ ① 点格带入 ═════════════
/** univer matchRefDrawToken：这个字后面可以接一个引用 */
const REF_DRAW_TOKENS = new Set(['+', '-', '*', '/', '&', '^', '=', '<', '>', '(', ',', ':', '{', '[', ';', '%', '#', '@', ' '])
/** univer FORMULA_LEXER_TOKENS（比较符／运算符／配对记号／后缀／前缀·单字） */
const LEXER_TOKENS = new Set(['+', '-', '*', '/', '&', '^', '=', '<', '>', '(', ')', ',', "'", '"', '{', '}', ':', '[', ']', '%', '#', '@'])
/** 光标（caret＝字元位移）处能不能插引用：公式（= 开头）·前一字是可插记号·后一字为空或是非「(」的记号（univer isFormulaReferenceAddingTextContext） */
export function canInsertRefAt(text: string, caret: number): boolean {
  if (!text.startsWith('=') || caret < 1 || caret > text.length) return false
  const prev = text[caret - 1]
  const next = text[caret]
  if (!REF_DRAW_TOKENS.has(prev)) return false
  return next === undefined || (LEXER_TOKENS.has(next) && next !== '(')
}

/** 格区 ⇒ 引用字（单格 B3·多格 B3:D7） */
export function rectRefText(r: Rect): string {
  const a = refPartText({ col: r.c0, row: r.r0, colAbs: false, rowAbs: false })
  if (r.r0 === r.r1 && r.c0 === r.c1) return a
  return `${a}:${refPartText({ col: r.c1, row: r.r1, colAbs: false, rowAbs: false })}`
}

/**
 * 插入或替换：live＝上一次点格插进去、还没被打字打断的那段 [start,end)（有 ⇒ 替换它·照 Excel「再点别格替换刚插的那段」）；
 * 否则插在 caret。返回新字串、新光标、这次插入的那段（供下一次替换）
 */
export function insertRef(text: string, caret: number, ref: string, live: { start: number; end: number } | null): { text: string; caret: number; live: { start: number; end: number } } {
  if (live && live.start >= 0 && live.end <= text.length && live.start <= live.end) {
    const t = text.slice(0, live.start) + ref + text.slice(live.end)
    const end = live.start + ref.length
    return { text: t, caret: end, live: { start: live.start, end } }
  }
  const t = text.slice(0, caret) + ref + text.slice(caret)
  return { text: t, caret: caret + ref.length, live: { start: caret, end: caret + ref.length } }
}

/** F4：光标所在（或紧贴其后）的引用切下一种绝对型；不在引用上 ⇒ null */
export function toggleAbsoluteAt(text: string, caret: number): { text: string; caret: number } | null {
  if (!text.startsWith('=')) return null
  const sp = scanRefs(text).find(s => caret >= s.start && caret <= s.end)
  if (!sp) return null
  const next = (p: { colAbs: boolean; rowAbs: boolean }) => {
    // NONE(A1) → ALL($A$1) → ROW(A$1) → COLUMN($A1) → NONE
    if (!p.colAbs && !p.rowAbs) return { colAbs: true, rowAbs: true }
    if (p.colAbs && p.rowAbs) return { colAbs: false, rowAbs: true }
    if (!p.colAbs && p.rowAbs) return { colAbs: true, rowAbs: false }
    return { colAbs: false, rowAbs: false }
  }
  let a = sp.a, b = sp.b
  if (!b) a = { ...a, ...next(a) }
  else {
    const colon = sp.a.end
    const target = caret === colon || caret === colon + 1 ? 'both' : caret < colon ? 'start' : 'end'
    if (target !== 'end') a = { ...a, ...next(a) }
    if (target !== 'start') b = { ...b, ...next(b) }
  }
  const tok = refPartText(a) + (b ? ':' + refPartText(b) : '')
  const t = text.slice(0, sp.start) + tok + text.slice(sp.end)
  return { text: t, caret: sp.start + tok.length }
}

// ═════════════ ①b 跨页签点格带入（Excel：编公式时点别的分页 ⇒ 切过去、不结束编辑；在那张点格／拖选 ⇒ 插 表名!A1／表名!A1:B5；
//                Enter ⇒ 回原表原格提交·Esc ⇒ 取消回原表·点回原表分页 ⇒ 回原格接着编）═════════════
/** 别张的格区 ⇒ 带页签前缀的引用字（要加引号的照 quoteSheetName）；就是原表（不分大小写）⇒ 不带前缀 */
export function sheetRectRefText(sheet: string, r: Rect, home?: string | null): string {
  const ref = rectRefText(r)
  return home != null && sheetKey(home) === sheetKey(sheet) ? ref : `${quoteSheetName(sheet)}!${ref}`
}
/** 编辑中的字能不能带着切分页：公式＋光标处能插引用（或刚点格插的那段还活着·光标在它尾巴） */
export function canCarryFormula(text: string, caret: number, live: { start: number; end: number } | null): boolean {
  return text.startsWith('=') && ((!!live && caret === live.end) || canInsertRefAt(text, caret))
}
/** 借去别张点格的那条公式：原表（homeId）哪一格（key）·字·光标·刚插的那段·现在画面上是哪张（sheetId） */
export type XrefEdit = { homeId: string; key: string; text: string; caret: number; live: { start: number; end: number } | null; sheetId: string }
export type XrefAction =
  | { t: 'tab'; id: string }                    // 点分页
  | { t: 'pick'; sheet: string; rect: Rect }    // 在画面那张点格／拖选（拖着每动一格送一次·刚插那段跟着换）
  | { t: 'type'; text: string; caret: number }  // 在公式栏打字
  | { t: 'enter' } | { t: 'esc' }
/** 回原表那一下要原格做什么：edit＝接着编（光标照旧）·commit＝照 Enter 提交·cancel＝不存 */
export type XrefResume = { homeId: string; key: string; text: string; caret: number; mode: 'edit' | 'commit' | 'cancel' }
/** 开始：在 homeId 编着 key 格的公式、点了别张 toId ⇒ 带过去；带不了（不是公式／光标处不能插／点的就是原表）⇒ null */
export function xrefBegin(homeId: string, key: string, text: string, caret: number, live: { start: number; end: number } | null, toId: string): XrefEdit | null {
  if (toId === homeId || !canCarryFormula(text, caret, live)) return null
  return { homeId, key, text, caret, live: live && caret === live.end ? live : null, sheetId: toId }
}
/** 状态机一步：回新状态（null＝结束）、画面该显示哪张、回原表要做的事 */
export function xrefStep(x: XrefEdit, a: XrefAction, homeName: string): { xref: XrefEdit | null; show: string; resume?: XrefResume } {
  const back = (mode: XrefResume['mode']) => ({ xref: null, show: x.homeId, resume: { homeId: x.homeId, key: x.key, text: x.text, caret: x.caret, mode } })
  switch (a.t) {
    case 'tab': return a.id === x.homeId ? back('edit') : { xref: { ...x, sheetId: a.id }, show: a.id }
    case 'enter': return back('commit')
    case 'esc': return back('cancel')
    case 'type': return { xref: { ...x, text: a.text, caret: a.caret, live: null }, show: x.sheetId }
    case 'pick': {
      if (!canCarryFormula(x.text, x.caret, x.live)) return { xref: x, show: x.sheetId }
      const r = insertRef(x.text, x.caret, sheetRectRefText(a.sheet, a.rect, homeName), x.live)
      return { xref: { ...x, text: r.text, caret: r.caret, live: r.live }, show: x.sheetId }
    }
  }
}

// ═════════════ ② 引用上色 ═════════════
/** univer loop-color.1～12（themes/src/default.ts 默认主题解析值） */
export const REF_COLORS: readonly string[] = ['#AC94FA', '#0DA471', '#3F83F8', '#F1B312', '#F8B4D9', '#047481', '#FF8A4C', '#1F2124', '#466AF7', '#F8B4B4', '#057A55', '#9A6D15']
export type RefHighlight = { start: number; end: number; text: string; rect: Rect; color: string }
/** 公式里的引用＋颜色（同一段字同一色·按出现序轮流）；不是公式 ⇒ [] */
export function refHighlights(text: string): RefHighlight[] {
  if (!text.startsWith('=')) return []
  const colorOf = new Map<string, string>()
  const out: RefHighlight[] = []
  for (const sp of scanRefs(text)) {
    if (sp.sheet !== undefined) continue   // 别张表的引用不在这张网格上框
    const tok = text.slice(sp.start, sp.end).toUpperCase()
    if (!colorOf.has(tok)) colorOf.set(tok, REF_COLORS[colorOf.size % REF_COLORS.length])
    out.push({ start: sp.start, end: sp.end, text: tok, rect: spanRect(sp), color: colorOf.get(tok)! })
  }
  return out
}
function spanRect(sp: RefSpan): Rect {
  const b = sp.b ?? sp.a
  return { r0: Math.min(sp.a.row, b.row), r1: Math.max(sp.a.row, b.row), c0: Math.min(sp.a.col, b.col), c1: Math.max(sp.a.col, b.col) }
}

// ═════════════ ③ 语法检查 ═════════════
export type FormulaIssueCode =
  | 'unclosedParen' | 'extraParen' | 'unknownFunc' | 'argCount' | 'badRef' | 'operatorRun'
  | 'missingOperand' | 'missingOperator' | 'emptyArg' | 'unknownName' | 'badChar'
/** 错在 [start,end)（字元位移·含开头 =）·a＝说明里要填的字（函数名／符号／参数个数范围） */
export type FormulaIssue = { code: FormulaIssueCode; start: number; end: number; a?: string }

type T = { k: 'num' | 'str' | 'ref' | 'col' | 'badref' | 'id' | 'op' | 'pct' | 'lp' | 'rp' | 'comma' | 'colon' | 'err' | 'sheet' | 'bad' | 'end'; s: number; e: number; v: string }
const ERR_LITS = ['#REF!', '#DIV/0!', '#CYCLE!', '#NAME?', '#VALUE!', '#ERROR!', '#N/A', '#NUM!']
/** 二元运算子（比较／串接／乘方也认了·跟引擎同一套）；+ - 兼一元 */
const BIN_OPS = new Set(['+', '-', '*', '/', '^', '&', '=', '<>', '<', '>', '<=', '>='])
const COL_RE = /^\$?[A-Za-z]{1,3}$/
function lex(src: string, base: number): T[] {
  const out: T[] = []
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { i++; continue }
    const at = base + i
    if (ch === '"') {   // 字串（"" 是引号）·没闭 ⇒ 坏字元（错在开头引号）
      let j = i + 1, closed = false
      while (j < src.length) { if (src[j] === '"') { if (src[j + 1] === '"') { j += 2; continue } closed = true; j++; break } j++ }
      if (!closed) { out.push({ k: 'bad', s: at, e: at + 1, v: '"' }); i = src.length; continue }
      out.push({ k: 'str', s: at, e: base + j, v: src.slice(i, j) }); i = j; continue
    }
    if (/[0-9.]/.test(ch)) {
      const m = /^(\d+\.?\d*|\.\d+)(e[-+]?\d+)?/i.exec(src.slice(i))
      if (!m) { out.push({ k: 'bad', s: at, e: at + 1, v: ch }); i++; continue }
      // 数字后面紧接字母（如 1A）⇒ 引用格式错
      const tail = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(src.slice(i + m[0].length))
      if (tail) { out.push({ k: 'badref', s: at, e: at + m[0].length + tail[0].length, v: m[0] + tail[0] }); i += m[0].length + tail[0].length; continue }
      out.push({ k: 'num', s: at, e: at + m[0].length, v: m[0] }); i += m[0].length; continue
    }
    if (ch === '#') {
      const lit = ERR_LITS.find(x => src.startsWith(x, i))
      if (lit) { out.push({ k: 'err', s: at, e: at + lit.length, v: lit }); i += lit.length; continue }
      out.push({ k: 'bad', s: at, e: at + 1, v: ch }); i++; continue
    }
    if (ch === "'" || /[A-Za-z_ -￿]/.test(ch)) {   // 跨表前缀 表格2!／'销售 表'!（页签在不在不查·求值时找不到 ⇒ #REF!）
      const pre = sheetPrefixAt(src, i)
      if (pre) { out.push({ k: 'sheet', s: at, e: base + pre.end, v: src.slice(i, pre.end) }); i = pre.end; continue }
      if (!/[A-Za-z_]/.test(ch)) { out.push({ k: 'bad', s: at, e: at + 1, v: ch }); i++; continue }
    }
    if (ch === '$' || /[A-Za-z_]/.test(ch)) {
      const ref = REF_AT_RE.exec(src.slice(i))
      if (ref && src[i + ref[0].length] !== '(' && Number(ref[4]) >= 1) { out.push({ k: 'ref', s: at, e: at + ref[0].length, v: ref[0] }); i += ref[0].length; continue }
      const w = /^[$A-Za-z_][$A-Za-z0-9_.]*/.exec(src.slice(i))!
      const word = w[0]
      // 整列 A:A／$A:$C：纯字母（可带 $）且紧接冒号、或前一个记号是接在整列后的冒号
      const prev = out[out.length - 1], prev2 = out[out.length - 2]
      if (COL_RE.test(word) && (/^\s*:/.test(src.slice(i + word.length)) || (prev?.k === 'colon' && prev2?.k === 'col'))) {
        out.push({ k: 'col', s: at, e: at + word.length, v: word }); i += word.length; continue
      }
      const kind: T['k'] = src[i + word.length] === '(' ? 'id' : (/^\$?[A-Za-z]+\$?\d+$/.test(word) || word.includes('$')) ? 'badref' : 'id'
      out.push({ k: kind, s: at, e: at + word.length, v: word }); i += word.length; continue
    }
    const two = src.slice(i, i + 2)
    if (two === '<>' || two === '>=' || two === '<=') { out.push({ k: 'op', s: at, e: at + 2, v: two }); i += 2; continue }
    if ('+-*/^&=<>'.includes(ch)) { out.push({ k: 'op', s: at, e: at + 1, v: ch }); i++; continue }
    if (ch === '%') { out.push({ k: 'pct', s: at, e: at + 1, v: ch }); i++; continue }
    if (ch === '(') { out.push({ k: 'lp', s: at, e: at + 1, v: ch }); i++; continue }
    if (ch === ')') { out.push({ k: 'rp', s: at, e: at + 1, v: ch }); i++; continue }
    if (ch === ',') { out.push({ k: 'comma', s: at, e: at + 1, v: ch }); i++; continue }
    if (ch === ':') { out.push({ k: 'colon', s: at, e: at + 1, v: ch }); i++; continue }
    out.push({ k: 'bad', s: at, e: at + 1, v: ch }); i++
  }
  out.push({ k: 'end', s: base + src.length, e: base + src.length, v: '' })
  return out
}
class Issue extends Error { constructor(public issue: FormulaIssue) { super(issue.code) } }

/**
 * 检查一条公式（text＝格里／函数栏里的整串·含开头 =）。不是公式 ⇒ null；没错 ⇒ null；有错 ⇒ 第一个错。
 * 文法＝本仓引擎（只查对错·不分优先序）：expr := factor (二元运算子 factor)* ·factor := ('+'|'-') factor | primary '%'* ·
 *   primary := 数字 | "字串" | TRUE | FALSE | 引用 [':' 引用] | 列 ':' 列 | 函数名 '(' [expr (',' expr)*] ')' | '(' expr ')' | 错误字面
 */
export function checkFormula(text: string): FormulaIssue | null {
  if (!text.trim().startsWith('=')) return null
  const lead = text.indexOf('=') + 1
  const src = text.slice(lead)
  if (!src.trim()) return null
  const toks = lex(src, lead)
  let p = 0
  const peek = () => toks[p]
  const take = () => toks[p++]
  const fail = (code: FormulaIssueCode, t: { s: number; e: number }, a?: string): never => { throw new Issue({ code, start: t.s, end: Math.max(t.e, t.s + 1), ...(a !== undefined ? { a } : {}) }) }
  const firstFatal = () => { for (const t of toks) { if (t.k === 'bad') fail('badChar', t, t.v); if (t.k === 'badref') fail('badRef', t, t.v) } }
  let depth = 0
  // 优先序只影响算值不影响「对不对」·检查器用一层「运算元 (二元运算子 运算元)*」就够（引擎 formula.ts 才分层）
  function expr() {
    factor()
    while (peek().k === 'op' && BIN_OPS.has(peek().v)) { take(); operand(); factor() }
  }
  /** 运算符后面：不能再接 + - 以外的运算子（连用）·不能接 ) , 结尾（缺数值） */
  function operand() {
    const t = peek()
    if (t.k === 'op' && t.v !== '+' && t.v !== '-') fail('operatorRun', { s: toks[p - 1].s, e: t.e }, toks[p - 1].v + t.v)
    if (t.k === 'rp' || t.k === 'comma' || t.k === 'end' || t.k === 'colon' || t.k === 'pct') fail('missingOperand', toks[p - 1], toks[p - 1].v)
  }
  function factor() {
    if (peek().k === 'op' && (peek().v === '-' || peek().v === '+')) { take(); operand(); factor(); return }
    primary()
    while (peek().k === 'pct') take()
  }
  function primary() {
    const t = take()
    switch (t.k) {
      case 'num': case 'err': case 'str': return
      case 'sheet': {   // 前缀后面要接格位或整列（表格2!A1／表格2!A1:B5／表格2!A:A）·或 #REF!（插删行列删掉的跨表引用：表格2!#REF!）
        const n = peek()
        if (n.k === 'err' && n.v === '#REF!') { take(); return }
        if (n.k !== 'ref' && n.k !== 'col') return fail('badRef', { s: t.s, e: n.k === 'end' ? t.e : n.e }, t.v + (n.k === 'end' ? '' : n.v))
        return primary()
      }
      case 'col': {   // 整列 A:A
        const c = peek()
        if (c.k !== 'colon') return fail('badRef', t, t.v)
        take()
        const b = peek()
        if (b.k !== 'col') return fail('badRef', { s: t.s, e: b.k === 'end' ? c.e : b.e }, t.v + ':' + (b.k === 'end' ? '' : b.v))
        take()
        return
      }
      case 'ref':
        if (peek().k === 'colon') {
          const c = take()
          if (peek().k === 'sheet' && toks[p - 3]?.k === 'sheet') take()   // 表格2!A1:表格2!B5（第二端再写一次前缀）
          const b = peek()
          if (b.k !== 'ref') fail('badRef', { s: t.s, e: b.k === 'end' ? c.e : b.e }, t.v + ':' + (b.k === 'end' ? '' : b.v))
          take()
        }
        return
      case 'badref': return fail('badRef', t, t.v)
      case 'id': {
        if (peek().k !== 'lp') { if (/^(TRUE|FALSE)$/i.test(t.v)) return; return fail('unknownName', t, t.v) }
        const name = t.v.toUpperCase()
        const spec = FUNCTION_SPECS[name]
        if (!spec) fail('unknownFunc', t, t.v)
        const lp = take(); depth++
        let n = 0
        if (peek().k !== 'rp') {
          for (;;) {
            if (peek().k === 'comma' || peek().k === 'rp') fail('emptyArg', peek(), name)
            if (peek().k === 'end') fail('unclosedParen', lp, name)
            expr(); n++
            if (peek().k === 'comma') { take(); continue }
            break
          }
        }
        if (peek().k !== 'rp') { if (peek().k === 'end') fail('unclosedParen', lp, name); fail('missingOperator', peek(), peek().v) }
        take(); depth--
        if (n < spec.min || n > spec.max) fail('argCount', t, spec.min === spec.max ? String(spec.min) : `${spec.min}–${spec.max}`)
        return
      }
      case 'lp': {
        depth++
        if (peek().k === 'rp') fail('missingOperand', peek(), '(')
        expr()
        if (peek().k !== 'rp') { if (peek().k === 'end') fail('unclosedParen', t, '('); fail('missingOperator', peek(), peek().v) }
        take(); depth--
        return
      }
      case 'rp': return fail(depth > 0 ? 'missingOperand' : 'extraParen', t, ')')
      case 'op': return fail(t.v !== '+' && t.v !== '-' ? 'missingOperand' : 'operatorRun', t, t.v)
      case 'pct': return fail('missingOperand', t, t.v)
      case 'comma': return fail(depth > 0 ? 'emptyArg' : 'badChar', t, ',')
      case 'colon': return fail('badRef', t, ':')
      case 'end': return fail('missingOperand', { s: t.s - 1, e: t.s }, '')
      case 'bad': return fail('badChar', t, t.v)
    }
  }
  try {
    firstFatal()
    expr()
    const t = peek()
    if (t.k === 'rp') fail('extraParen', t, ')')
    if (t.k !== 'end') fail('missingOperator', t, t.v)
    return null
  } catch (e) {
    if (e instanceof Issue) return e.issue
    throw e
  }
}

// ═════════════ ④ 函数名补全 ═════════════
export const FUNCTION_NAMES: readonly string[] = Object.keys(FUNCTION_SPECS)
/** 打字中的即时提示别吵：错在「还没打完的函数名」（前缀对得上某个函数·补全清单正开着）⇒ 先不报；Enter 提交时照严格检查 */
export function issueWhileTyping(text: string): FormulaIssue | null {
  const i = checkFormula(text)
  if (i && i.code === 'unknownName' && i.a && FUNCTION_NAMES.some(n => n.startsWith(i.a!.toUpperCase()))) return null
  return i
}
export type FnSuggest = { start: number; end: number; prefix: string; items: string[] }
/**
 * 光标前正在打的那个词（字母开头·前面是 = 或可插记号·后面不是「(」）⇒ 前缀相符的函数（不分大小写·最多 10 条）；不在打函数名 ⇒ null
 */
export function functionSuggestions(text: string, caret: number, limit = 10): FnSuggest | null {
  if (!text.startsWith('=') || caret < 2) return null
  const before = text.slice(0, caret)
  const m = /[A-Za-z_][A-Za-z0-9_.]*$/.exec(before)
  if (!m) return null
  const start = caret - m[0].length
  if (start < 1 || !REF_DRAW_TOKENS.has(text[start - 1])) return null
  // 词还连着后面的字（光标在词中间）⇒ 整个词
  const rest = /^[A-Za-z0-9_.]*/.exec(text.slice(caret))![0]
  const end = caret + rest.length
  if (text[end] === '(') return null
  const prefix = m[0].toUpperCase()
  const items = FUNCTION_NAMES.filter(n => n.indexOf(prefix) === 0).slice(0, limit)
  return items.length ? { start, end, prefix, items } : null
}
/** 选中一个函数 ⇒ 换掉那个词·后面不是「(」就补「(」·光标落在括号里 */
export function applySuggestion(text: string, sug: { start: number; end: number }, name: string): { text: string; caret: number } {
  const hasParen = text[sug.end] === '('
  const ins = hasParen ? name : name + '('
  return { text: text.slice(0, sug.start) + ins + text.slice(sug.end), caret: sug.start + name.length + 1 }
}

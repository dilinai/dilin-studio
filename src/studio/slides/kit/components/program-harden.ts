/**
 * slide-kit · 程序动画 · 旧存稿载入补护
 *
 *  存进库的 html_content 里，程序 iframe 是当时的样子：sandbox="allow-scripts"、没有 data-sk-lazy、
 *   srcdoc 里没有 SLIDES_PROGRAM_HEAD_GUARD（强制 CSP＋守卫）；内嵌的放映执行器（__sk_steps__）也是旧版（不认 lazy、不走盯 load）。
 *   读／分享／播放／预览时不会自己补 ⇒ 这里把整份（或一段）HTML 里的程序框一律补成新规矩（库里的不动·只改给 iframe 的那份）：
 *     ① 每个 <iframe data-sk-prog>：sandbox=""（静态·作者码不跑）＋data-sk-lazy（放映执行器进页才放成 allow-scripts）；
 *     ② srcdoc 里 <meta charset> 后面紧接的不是现行 SLIDES_PROGRAM_HEAD_GUARD ⇒ 补插在 <meta charset> 之后（没有就插在 <head> 后／最前面）；
 *        srcdoc 里带着放映时塞的回暗号脚本（__sk_alive__）⇒ 拿掉；
 *     ③ 有程序框 ⇒ 内嵌执行器换成现行 stepsScript()；<head> 里放现行「盯 load」脚本（PROGRAM_FRAME_WATCH_SCRIPT·已有旧的就原地换）。
 *   不在 <script>／<style>／注释里找 iframe 开标签（字串里拼的不算）。没有程序框 ⇒ 原样回（一字不动）。幂等。
 *   接在：aislides-utils injectEditScript（编辑框·分享页）、aislides-generate-postprocess normalizeDeckHtmlForExport（播放／html 下载／
 *   云盘下载／登入读口 GET）、canvas-helpers buildSlidesPreview（画布小窗／云盘预览）、render.tsx htmlComponentDoc（手动排版层进沙盒框）、
 *   deck-html buildDeckHtml（服务端重渲：htmlOverride 里带进来的旧程序框）。
 * 纯字串处理·客户端／服务端共用（⛔ DOMParser）。
 */

import { PROGRAM_ALIVE_ID, PROGRAM_FRAME_WATCH_SCRIPT, SLIDES_PROGRAM_HEAD_GUARD, stripProgramAliveProbe } from '../../../shared/program-sandbox'
import { stepsScript } from './steps'
import { isAssembledProgramDoc, programNoticeText, type ProgramNoticeLang, type ProgramNotStarted } from './program-assemble'
import type { ProgramSealWhy } from './program-watchdog'

// 开标签照浏览器的切法认（⛔ 用 \b 认标签名·⛔ 属性值要求非空）——
//   ① 标签名碰到 HTML 空白／「/」／「>」才算完：<script-box>、<style-box> 是一般标签（⛔ 当成 script／style）；收尾标签同理（</script-box> 不收 script）；
//   ② 属性：名字是「不含空白／/／>／=」的一串（首字可以是 =），值可省；= 后面可以是双／单引号、或一串不含空白与 > 的字（可以是空的·例 defer=>）；
//      属性之间的空白与「/」逐个字吃（自闭合的 / 也是）。
//   每段只有一种切法（名字吃到分隔才停、名字后面跟着 = 就一定是带值、无引号值不以空白／引号起头）。HTML 空白只认 \t \n \f \r 和空格。
// 旧执行器／盯 load 脚本按 id 认——单／双／无引号、大小写、多带别的属性都算（⛔ 只认一字不差那种：认不出就换不掉·程序全留静态）
// 开标签按属性逐个吃（引号里的 > 不算结束·例 data-note=">" 在 id 前），再看 id 属性值
// 注释与原样文字元素（style／textarea／title／xmp／noembed／noframes／noscript）里写的 <script id=…> 不是标签——整块跳过（⛔ 当成真标签：把现行塞进注释、真的那份反而删掉）。
// 没收尾的 <!-- 一路到档尾都是注释。⛔ 当通用 HTML 解析器用：只管这几种语境
// 语境起点只认真的标签起点——一般开标签（含属性值）整块吃下原样留，属性值里写的 <!-- ／<textarea> 不会启动跳过
// （近二次方）：上面这套规矩原先写成几条大正则（IFRAME_OPEN／SKIP_BLOCKS／SCRIPT_BLOCK／ATTR）用 matchAll 扫——每个 < 起点失败时都重扫到档尾
//   （没收尾的 <div <div …：TAG_ATTRS 把后面整串吃成属性才发现没有 >；<script> 没收尾：[\s\S]*? 找 </script 找到档尾；<a<a<a…：标签名吃到档尾…）⇒ 40KB 约 2 秒、长度加倍耗时四倍。
//   现改成手写扫描器（Scanner），切法与原正则逐字一致（单测拿旧正则版当对照比对），只是：属性段从某一位置起吃到哪里记下来（别的起点吃到同一位置直接接上）、
//   往后找某个字／收尾标签用「最后一次出现」先判没有、有就往前找并记住，没收尾的东西不再每个起点重扫。
// 原样文字元素：里面写的标签都只是字（script／style 跑码·其余 textarea／title／xmp／noembed／noframes／noscript 只显示字）
const RAW_TEXT = ['script', 'style', 'textarea', 'title', 'xmp', 'noembed', 'noframes', 'noscript']
const RAW_SET = new Set(RAW_TEXT)
const STEPS_TAG = '__sk_steps__'
const WATCH_TAG = '__sk_progwatch__'
const scriptIdOf = (attrsSrc: string) => { const a = parseAttrs(attrsSrc).find((x) => x.name === 'id'); return a ? a.value : null }
// 合法的 <meta charset> 写法（大小写、单／双／无引号、自闭合）——补守卫与「已补没」用同一个认法（⛔ 一边宽一边严＝补了还认不出·第二遍再补一份）
const CHARSET_RE = /<meta\s+charset\s*=\s*["']?[\w-]+["']?\s*\/?>/i

type Attr = { name: string; raw: string; value: string | null }

const isWs = (c: number) => c === 32 || c === 9 || c === 10 || c === 12 || c === 13
// 标签名到此为止（空白／「/」／「>」）
const isNameEnd = (c: number) => isWs(c) || c === 47 || c === 62
const isAttrNameEnd = (c: number) => isNameEnd(c) || c === 61
const isValEnd = (c: number) => isWs(c) || c === 62
const notWs = (c: number) => !isWs(c)
const isAsciiLetter = (c: number) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122)
/** s[a,b) 的 ASCII 小写（正则 i 旗只把 ASCII 字母对应大小写）；长过 8 字（最长的 noframes／noscript／textarea）回空字串＝一般标签 */
function shortLower(s: string, a: number, b: number): string {
  if (b - a > 8) return ''
  let r = ''
  for (let i = a; i < b; i++) { const c = s.charCodeAt(i); r += String.fromCharCode(c >= 65 && c <= 90 ? c + 32 : c) }
  return r
}
type AttrTok = { nameEnd: number; vs: number; ve: number }
type Hit = { kind: 'iframe' | 'script'; at: number; end: number; attrs: string }

/** 一份字串上的扫描器：切法同档头规矩；各种「往后找」都有记忆，整份扫一遍近线性（closeEnd 在多个开标签后接多个没收尾的闭标签时每次二分＝n log n·⛔ 写成严格线性）*/
class Scanner {
  readonly n: number
  private finds = new Map<string, { last: number; from: number; at: number }>()
  private attrsMemo: Int32Array | null = null
  private path: number[] = []
  private closes: Map<string, number[]> | null = null
  constructor(readonly s: string) { this.n = s.length }

  /** from 起第一个合 pred 的字的位置（没有回 -1）。先比「最后一个在哪」判没有；有就往前找、记下这一段（下一次从这段里起找直接回） */
  private nextChar(key: string, pred: (c: number) => boolean, from: number): number {
    let f = this.finds.get(key)
    if (!f) { let last = this.n - 1; while (last >= 0 && !pred(this.s.charCodeAt(last))) last--; f = { last, from: -1, at: -1 }; this.finds.set(key, f) }
    if (from > f.last) return -1
    if (from >= f.from && from <= f.at) return f.at
    let i = from
    while (!pred(this.s.charCodeAt(i))) i++
    f.from = from; f.at = i
    return i
  }
  /** 同上·找一串字（indexOf） */
  private nextStr(needle: string, from: number): number {
    const key = 's:' + needle
    let f = this.finds.get(key)
    if (!f) { f = { last: this.s.lastIndexOf(needle), from: -1, at: -1 }; this.finds.set(key, f) }
    if (from > f.last) return -1
    if (from >= f.from && from <= f.at) return f.at
    const at = this.s.indexOf(needle, from)
    f.from = from; f.at = at
    return at
  }

  /** j 起的一段属性语法：分隔字（空白／「/」）或一个属性（名字＋可省的值）。回这段的结尾；吃不成（「>」、引号没收尾）回 -1 */
  attrToken(j: number, d?: AttrTok): number {
    const s = this.s, n = this.n, c = s.charCodeAt(j)
    if (isWs(c) || c === 47) return j + 1
    if (c === 62) return -1
    // 名字：首字不是空白／/／>（可以是 =）·之后吃到空白／/／>／=
    let e = this.nextChar('an', isAttrNameEnd, j + 1)
    if (e < 0) e = n
    if (d) { d.nameEnd = e; d.vs = -1; d.ve = -1 }
    let k = e
    if (k < n && isWs(s.charCodeAt(k))) { k = this.nextChar('nw', notWs, k); if (k < 0) k = n }
    if (k >= n || s.charCodeAt(k) !== 61) return e   // 后面不是 = ⇒ 不带值（空白另算分隔字）
    k++
    if (k < n && isWs(s.charCodeAt(k))) { k = this.nextChar('nw', notWs, k); if (k < 0) k = n }
    const q = s.charCodeAt(k)
    let v: number
    if (q === 34 || q === 39) {
      const z = this.nextStr(q === 34 ? '"' : "'", k + 1)
      if (z < 0) return -1   // 引号没收尾 ⇒ 这个属性吃不成（名字后面有 = 就一定要带值）
      v = z + 1
    } else {
      v = this.nextChar('ve', isValEnd, k)
      if (v < 0) v = n
    }
    if (d) { d.vs = k; d.ve = v }
    return v
  }
  /** i 起的属性段一路吃到哪里（第一个吃不成的位置）。途经的每个段落起点都记下结尾：别的起点吃到同一位置直接接上（⛔ 每个 < 起点重吃到档尾） */
  private attrsEnd(i: number): number {
    // 记的是「结尾＋1」（0＝还没算）
    const memo = this.attrsMemo ?? (this.attrsMemo = new Int32Array(this.n + 1)), path = this.path
    let j = i, e: number
    path.length = 0
    for (;;) {
      if (j >= this.n) { e = this.n; break }
      const m = memo[j]
      if (m) { e = m - 1; break }
      path.push(j)
      const t = this.attrToken(j)
      if (t < 0) { e = j; break }
      j = t
    }
    for (let k = 0; k < path.length; k++) memo[path[k]] = e + 1
    return e
  }
  /** 标签名后面（ne）接属性段再接「>」：回开标签结尾（「>」之后）；不成回 -1 */
  private openTagEnd(ne: number): number {
    const e = this.attrsEnd(ne)
    return e < this.n && this.s.charCodeAt(e) === 62 ? e + 1 : -1
  }
  /** from 起第一个 </名字（后面接空白／/／>）之后再到第一个「>」：回整块结尾；没有回 -1 */
  private closeEnd(name: string, from: number): number {
    if (!this.closes) {
      const m = new Map<string, number[]>(), s = this.s, n = this.n
      for (let k = s.indexOf('</'); k >= 0; k = s.indexOf('</', k + 2)) {
        let e = k + 2
        const lim = Math.min(n, k + 11)
        while (e < lim && !isNameEnd(s.charCodeAt(e))) e++
        if (e >= n || e === k + 2 || !isNameEnd(s.charCodeAt(e))) continue
        const nm = shortLower(s, k + 2, e)
        if (!RAW_SET.has(nm)) continue
        const arr = m.get(nm)
        if (arr) arr.push(k); else m.set(nm, [k])
      }
      this.closes = m
    }
    const arr = this.closes.get(name)
    if (!arr) return -1
    let lo = 0, hi = arr.length
    while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] < from) lo = mid + 1; else hi = mid }
    if (lo >= arr.length) return -1
    const gt = this.nextStr('>', arr[lo] + 2 + name.length)
    return gt < 0 ? -1 : gt + 1
  }

  /**
   * p（是「<」）起的一块：回块尾（认不成回 -1·往下一个字再找），种类记在 kind（0 跳过／1 iframe 开标签／2 script 整块）、属性段记在 [attrsFrom, attrsTo)。
   * scripts=false：找程序框那趟——原样文字元素整块、注释（要收尾）、别的开标签都跳过，<iframe …> 是 iframe；
   * scripts=true：找 <script> 那趟——注释（没收尾到档尾）、style 等原样文字元素整块、script 以外的开标签（含没收尾的 <style …> 开标签本身）都跳过，<script …>…</script> 是 script。
   */
  private kind = 0
  private attrsFrom = 0
  private attrsTo = 0
  private blockAt(p: number, scripts: boolean): number {
    const s = this.s
    const c1 = s.charCodeAt(p + 1)
    this.kind = 0
    if (c1 === 33 && s.startsWith('!--', p + 1)) {
      const z = this.nextStr('-->', p + 4)
      return z >= 0 ? z + 3 : scripts ? this.n : -1
    }
    if (!isAsciiLetter(c1)) return -1
    const ne = this.nextChar('ne', isNameEnd, p + 1)
    if (ne < 0) return -1
    const nm = shortLower(s, p + 1, ne)
    if (RAW_SET.has(nm) && (!scripts || nm !== 'script')) {
      const o = this.openTagEnd(ne)
      if (o >= 0) { const cl = this.closeEnd(nm, o); if (cl >= 0) return cl }
      return scripts ? o : -1   // 没收尾：找程序框那趟不认（往下一个字再找）；找 script 那趟当一般开标签跳过
    }
    const o = this.openTagEnd(ne)
    if (o < 0) return -1
    this.attrsFrom = ne; this.attrsTo = o - 1
    if (scripts && nm === 'script') { this.kind = 2; return this.closeEnd('script', o) }
    if (!scripts && nm === 'iframe') this.kind = 1
    return o
  }
  /** 由左往右整份切块（块与块之间不认的字原样跳过）·回 iframe 开标签（scripts=false）或 script 整块（scripts=true） */
  blocks(scripts: boolean): Hit[] {
    const out: Hit[] = [], s = this.s
    for (let p = s.indexOf('<'); p >= 0;) {
      const end = this.blockAt(p, scripts)
      if (end < 0) { p = s.indexOf('<', p + 1); continue }
      if (this.kind) out.push({ kind: this.kind === 1 ? 'iframe' : 'script', at: p, end, attrs: s.slice(this.attrsFrom, this.attrsTo) })
      p = s.indexOf('<', end)
    }
    return out
  }
}

/** 第一个 <head…>（\b 之后吃到第一个「>」）：回 { index, end }；没有回 null。等同 /<head\b[^>]*>/i（⛔ 那条在每个没收尾的 <head 起点都重扫到档尾） */
function headOpen(s: string): { index: number; end: number } | null {
  const m = /<head\b/i.exec(s)
  if (!m) return null
  // 第一个 <head 后面没有「>」⇒ 后面的 <head 也都没有
  const gt = s.indexOf('>', m.index + 5)
  return gt < 0 ? null : { index: m.index, end: gt + 1 }
}

/** 属性值解码（只为判读用·不拿去重写） */
function decodeAttr(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|quot|amp|lt|gt|apos|nbsp);/gi, (m, e: string) => {
    const k = e.toLowerCase()
    if (k === 'quot') return '"'
    if (k === 'amp') return '&'
    if (k === 'lt') return '<'
    if (k === 'gt') return '>'
    if (k === 'apos') return "'"
    if (k === 'nbsp') return ' '
    const n = k.startsWith('#x') ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10)
    return Number.isFinite(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m
  })
}
/** 放进属性值的编码（双／单引号都安全） */
function encodeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
/** 逐个属性（前面的空白／「/」算进 raw·重拼时原样留）。只拿开标签切下来的属性段来切（每段都吃得成） */
function parseAttrs(s: string): Attr[] {
  const out: Attr[] = []
  const sc = new Scanner(s), d: AttrTok = { nameEnd: 0, vs: -1, ve: -1 }
  let i = 0, rawStart = 0
  while (i < s.length) {
    const c = s.charCodeAt(i)
    if (isWs(c) || c === 47) { i++; continue }
    const end = sc.attrToken(i, d)
    if (end < 0) break
    const rawV = d.vs < 0 ? undefined : s.slice(d.vs, d.ve)
    const value = rawV === undefined ? null : decodeAttr(rawV[0] === '"' || rawV[0] === "'" ? rawV.slice(1, -1) : rawV)
    out.push({ name: s.slice(i, d.nameEnd).toLowerCase(), raw: s.slice(rawStart, end), value })
    i = rawStart = end
  }
  return out
}

/** srcdoc 那份文件：<meta charset> 之后紧接现行守卫没？ */
export function programDocHasGuard(doc: string): boolean {
  // 与 guardRawSrcdoc 插的位置同一顺序：<meta charset> 之后 → <head> 之后 → 最前面
  const cm = CHARSET_RE.exec(doc)
  if (cm) return doc.startsWith(SLIDES_PROGRAM_HEAD_GUARD, cm.index + cm[0].length)
  const head = headOpen(doc)
  if (head) return doc.startsWith(SLIDES_PROGRAM_HEAD_GUARD, head.end)
  return doc.startsWith(SLIDES_PROGRAM_HEAD_GUARD)
}

/** 原始（还编码着的）srcdoc 值里补守卫：插在编码后的 <meta charset> 之后（没有就 <head> 之后·再没有就最前面） */
function guardRawSrcdoc(rawInner: string): string {
  const enc = encodeAttr(SLIDES_PROGRAM_HEAD_GUARD)
  const LT = '(?:<|&lt;|&#0*60;|&#x0*3c;)', GT = '(?:>|&gt;|&#0*62;|&#x0*3e;)', Q = '(?:"|\'|&quot;|&#0*34;|&#x0*22;|&#0*39;|&#x0*27;|&apos;)?'
  const charset = new RegExp(`${LT}meta\\s+charset\\s*=\\s*${Q}[\\w-]+${Q}\\s*/?${GT}`, 'i').exec(rawInner)
  if (charset) { const at = charset.index + charset[0].length; return rawInner.slice(0, at) + enc + rawInner.slice(at) }
  // 等同 ${LT}head\b(?:(?!${GT})[\s\S])*${GT}：第一个编码后的 <head 之后第一个编码后的 >（第一个后面没有 ⇒ 后面的 <head 也都没有·⛔ 每个起点重扫到尾）
  const head = new RegExp(`${LT}head\\b`, 'i').exec(rawInner)
  if (head) {
    const gtRe = new RegExp(GT, 'gi')
    gtRe.lastIndex = head.index + head[0].length
    const gt = gtRe.exec(rawInner)
    if (gt) { const at = gt.index + gt[0].length; return rawInner.slice(0, at) + enc + rawInner.slice(at) }
  }
  return enc + rawInner
}

/** 一个程序 iframe 开标签补成新规矩（其余属性原字原样） */
/**
 * 计时闸：框分三种——
 *   组装框（srcdoc＝program-assemble 组装的那种：只认 hash 的 CSP·守卫在前）＝原样留（⛔ 再插旧守卫／拿掉前置脚本）·sandbox=""＋lazy；
 *   已标静态（data-sk-prog-static·渲染当时就判不能跑）＝sandbox=""、拿掉 lazy（⛔ 放成 allow-scripts）；
 *   旧框（计时闸以前存的、手改 html 带进来的）＝照旧补守卫，但一律静态：拿掉 lazy、标 data-sk-prog-static="uncompiled"、框上盖一句「要重新存一次」。
 *   ⚠️ 组装框里的 CSP 名单写在文件里——存进 html_content 后作者能手改（刻意伪造＝C 层·不在承诺内）；不小心改到脚本字 ⇒ hash 对不上 ⇒ 浏览器不跑那段。
 */
function frameKind(attrs: Attr[]): 'assembled' | 'static' | 'legacy' {
  if (attrs.some((a) => a.name === 'data-sk-prog-static')) return 'static'
  const sd = attrs.find((a) => a.name === 'srcdoc')
  return sd && sd.value !== null && isAssembledProgramDoc(sd.value) ? 'assembled' : 'legacy'
}

function noticeHtml(lang: ProgramNoticeLang, why: ProgramNotStarted = 'uncompiled'): string {
  return '<div data-sk-prog-notice="' + why + '" style="position:absolute;left:6px;bottom:6px;z-index:1;max-width:calc(100% - 12px);padding:3px 8px;border-radius:6px;background:rgba(15,23,42,0.78);color:#F8FAFC;font:500 12px/1.4 system-ui,sans-serif;pointer-events:none">'
    + encodeAttr(programNoticeText(why, lang)) + '</div>'
}

function hardenTag(tag: string, attrsSrc: string, lang: ProgramNoticeLang = 'zh-TW'): string {
  const attrs = parseAttrs(attrsSrc)
  const kind = frameKind(attrs)
  let changed = false
  const parts: string[] = []
  let hasSandbox = false, hasLazy = false
  for (const a of attrs) {
    if (a.name === 'sandbox') {
      if (hasSandbox) { changed = true; continue }   // 重复的 sandbox 只留第一个（浏览器也只认第一个）
      hasSandbox = true
      if (a.value !== '') { changed = true; parts.push(' sandbox=""'); continue }
    } else if (a.name === 'data-sk-lazy') {
      if (kind !== 'assembled') { changed = true; continue }   // 不能跑的框 ⇒ 执行器不放（只认带 lazy 的）
      hasLazy = true
    } else if (kind === 'assembled' && a.name === 'srcdoc') {
      // 组装框原样：前置脚本就是回暗号脚本兼交世代——放映时执行器 strip＋inject＝只换暗号那段（program-assemble rearm 同结果）
    } else if (a.name === 'srcdoc' && a.value !== null && a.value.includes(PROGRAM_ALIVE_ID)) {
      // 放映时塞进去的回暗号脚本被存下来了（编辑层序列化 DOM）⇒ 拿掉（暗号只在那次载入有效）·重新编码整个值
      const d = stripProgramAliveProbe(a.value)
      changed = true
      parts.push(` srcdoc="${programDocHasGuard(d) ? encodeAttr(d) : guardRawSrcdoc(encodeAttr(d))}"`)
      continue
    } else if (a.name === 'srcdoc' && a.value !== null && !programDocHasGuard(a.value)) {
      const rawV = a.raw.slice(a.raw.indexOf('=') + 1).trim()
      const inner = rawV[0] === '"' || rawV[0] === "'" ? rawV.slice(1, -1) : rawV
      const q = rawV[0] === "'" ? "'" : '"'
      changed = true
      parts.push(` srcdoc=${q}${guardRawSrcdoc(inner)}${q}`)
      continue
    }
    // 空的无引号值（a= ）重拼时写成 a=""——⛔ 原样留：后面补的属性会被浏览器吃成它的值（真 Chrome 比对：<iframe … a=> 补的 data-sk-lazy 没生效）
    parts.push(a.value === '' && !/["']$/.test(a.raw) ? a.raw.replace(/=[\t\n\f\r ]*$/, '=""') : a.raw)
  }
  if (!hasSandbox) { changed = true; parts.unshift(' sandbox=""') }
  if (kind === 'assembled' && !hasLazy) { changed = true; parts.push(' data-sk-lazy=""') }
  if (kind === 'legacy') { changed = true; parts.push(' data-sk-prog-static="uncompiled"') }
  if (!changed) return tag
  return `${kind === 'legacy' ? noticeHtml(lang) : ''}<iframe${parts.join('')}>`
}

/** 整份 html 的语言（<html lang=…>）·给旧框那句提示用 */
function docLang(html: string): ProgramNoticeLang {
  const m = /<html\b[^>]*\blang\s*=\s*["']?([\w-]+)/i.exec(html.slice(0, 2000))
  const l = m ? m[1].toLowerCase() : ''
  return l === 'zh-cn' || l === 'zh-hans' ? 'zh-CN' : l.startsWith('en') ? 'en' : 'zh-TW'
}

/**
 * 真的 <script …>…</script> 块（注释、原样文字元素、别的开标签里写的不算）里 id＝id 的：第一份换成现行、其余拿掉（两份执行器会把同一步走两遍）。
 * 一份都没有回 null（＝原先 hasTag 为假）。
 */
function replaceTags(html: string, id: string, now: string): string | null {
  let first = true, out = '', last = 0
  for (const h of new Scanner(html).blocks(true)) {
    if (scriptIdOf(h.attrs) !== id) continue
    out += html.slice(last, h.at) + (first ? now : '')
    first = false
    last = h.end
  }
  return first ? null : out + html.slice(last)
}

/** 整份／一段 HTML 里的程序 iframe 补护（见档头）。回补好的那份；没有程序框原样回。 */
export function hardenProgramFramesHtml(html: string): string {
  if (!html || !/data-sk-prog\b/i.test(html)) return html
  // 由左往右扫：<script>／<style>／注释整块跳过；iframe 开标签整个吃下（引号里的 < > 不再往里扫）
  let out = '', last = 0, firstAt = -1, n = 0
  const lang = docLang(html)
  for (const h of new Scanner(html).blocks(false)) {
    if (h.kind !== 'iframe') continue
    const at = h.at
    const attrsSrc = h.attrs
    if (!parseAttrs(attrsSrc).some((a) => a.name === 'data-sk-prog')) continue
    n++
    if (firstAt < 0) firstAt = out.length + (at - last)
    out += html.slice(last, at) + hardenTag(html.slice(at, h.end), attrsSrc, lang)
    last = h.end
  }
  if (!n) return html
  out += html.slice(last)
  // ③ 盯 load 脚本：已有（任何版本）原地换；没有 ⇒ <head> 里 <meta charset> 之后（下载档的 charset 要留在前 字节）·再没有 <head> 就放第一个程序框前面
  const watched = replaceTags(out, WATCH_TAG, PROGRAM_FRAME_WATCH_SCRIPT)
  if (watched !== null) out = watched
  else {
    const headM = headOpen(out)
    let at = firstAt
    if (headM && headM.index < firstAt) {
      const hs = headM.end
      const he = out.slice(hs).search(/<\/head\s*>/i)
      const cm = /<meta\s+charset\s*=\s*["']?[\w-]+["']?\s*\/?>/i.exec(he >= 0 ? out.slice(hs, hs + he) : '')
      at = cm ? hs + cm.index + cm[0].length : hs
    }
    out = out.slice(0, at) + PROGRAM_FRAME_WATCH_SCRIPT + out.slice(at)
  }
  // ③ 执行器换现行（旧版不认 lazy／不走盯 load）
  const stepped = replaceTags(out, STEPS_TAG, stepsScript())
  if (stepped !== null) out = stepped
  return out
}

/**
 * 计时闸 B 层：deck 文件里每个 iframe 开标签（注释／script／style／原样文字元素里写的不算）按文件顺序——程序框给组件 id，别的框给 null。
 * 顶层拿它对 deckWindow.frames[i]：数目对不上就不启 B（见 program-watchdog）。⚠️ 只看顶层文件本身：<template> 里的、srcdoc 里的都不是 deck 的直系子框。
 */
export function deckIframeProgIds(html: string): Array<string | null> {
  const out: Array<string | null> = []
  if (!html) return out
  for (const h of new Scanner(html).blocks(false)) {
    if (h.kind !== 'iframe') continue
    const a = parseAttrs(h.attrs).find((x) => x.name === 'data-sk-prog')
    out.push(a ? (a.value ?? '') : null)
  }
  return out
}

/**
 * 重建放映用：名单里的程序框标静态＋盖一句原因；再过一遍补护（拿掉 lazy＝执行器不会放成 allow-scripts）。名单空＝原样回。
 *   名单＝这次放映的封锁名单（ProgramSeals·id ⇒ 原因：nav 导走／hang／guard／stuck）——各框盖各自的原因（⛔ 一律写「卡住了」）；
 *   给 Set（旧呼叫法）＝全当 stuck。
 */
export function blockProgramFramesHtml(html: string, ids: ReadonlyMap<string, ProgramSealWhy> | ReadonlySet<string>): string {
  if (!html || !ids.size) return html
  const whyOf = (id: string): ProgramSealWhy | null => (ids instanceof Map ? ids.get(id) ?? null : ids.has(id) ? 'stuck' : null)
  const lang = docLang(html)
  let out = '', last = 0
  for (const h of new Scanner(html).blocks(false)) {
    if (h.kind !== 'iframe') continue
    const attrs = parseAttrs(h.attrs)
    const id = attrs.find((x) => x.name === 'data-sk-prog')
    const why = id && id.value !== null ? whyOf(id.value) : null
    if (!why || attrs.some((x) => x.name === 'data-sk-prog-static')) continue
    out += html.slice(last, h.at) + noticeHtml(lang, why) + `<iframe data-sk-prog-static="${why}"` + html.slice(h.at + '<iframe'.length, h.end)
    last = h.end
  }
  return hardenProgramFramesHtml(out + html.slice(last))
}

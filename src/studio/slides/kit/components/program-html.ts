/**
 * 简报程序动画「死循环计时闸」·HTML 侧共用小工具（parse5 树）：script 分类、按文件顺序走元素（含 <template>）、事件属性辨认。
 * 编译器（program-compile.server.ts）与组装后逐段核（program-verify.ts）都 import 这一档 ⇒ 两边分类规则逐字同一份。
 * 只依赖 parse5 的型别（执行期不 import parse5）。
 */
import type { DefaultTreeAdapterMap } from 'parse5'
import type { ProgramNs } from './program-source'

export type P5Node = DefaultTreeAdapterMap['node']
export type P5Element = DefaultTreeAdapterMap['element']
export type P5Parent = DefaultTreeAdapterMap['parentNode']

export const NS_HTML = 'http://www.w3.org/1999/xhtml'
export const NS_SVG = 'http://www.w3.org/2000/svg'

export type { ProgramNs } from './program-source'
export type ScriptClass = 'classic' | 'module' | 'data' | 'unsupported'

const JS_MIME = new Set([
  'application/ecmascript', 'application/javascript', 'application/x-ecmascript', 'application/x-javascript', 'text/ecmascript',
  'text/javascript', 'text/javascript1.0', 'text/javascript1.1', 'text/javascript1.2', 'text/javascript1.3', 'text/javascript1.4',
  'text/javascript1.5', 'text/jscript', 'text/livescript', 'text/x-ecmascript', 'text/x-javascript',
])
const ASCII_WS = /^[\t\n\f\r ]+|[\t\n\f\r ]+$/g

export function attrOf(el: P5Element, name: string): string | null {
  const a = el.attrs.find((x) => x.name === name && !x.namespace)
  return a ? a.value : null
}
export function nsOf(el: P5Element): ProgramNs {
  return el.namespaceURI === NS_SVG ? 'svg' : el.namespaceURI === NS_HTML ? 'html' : 'mathml'
}
export function isEventAttrName(name: string): boolean {
  return /^on/i.test(name)
}
/** 会去外面载入的 script：HTML 的 src；SVG 的 href 与 xlink:href 也算（SVG script 靠它们载外部档） */
export function hasSrc(el: P5Element): boolean {
  const svg = nsOf(el) === 'svg'
  return el.attrs.some((a) => (a.name === 'src' && !a.namespace) || (svg && a.name === 'href'))
}
/** 浏览器给事件属性的参数表（片段里出不了 body／frameset ⇒ 不需要 onerror 五参那一格） */
export function handlerParams(el: P5Element): string {
  return nsOf(el) === 'svg' ? 'evt' : 'event'
}

/** 照 HTML 规范「准备 script 元素」算 type 字串再分类；SVG 里只认 classic，其余一律当不支援拿掉 */
export function classifyScript(el: P5Element): { cls: ScriptClass; type: string | null } {
  const type = attrOf(el, 'type'), lang = attrOf(el, 'language')
  let ts: string
  if (type !== null) ts = type
  else if (lang !== null && lang !== '') ts = `text/${lang}`
  else ts = ''
  ts = ts.replace(ASCII_WS, '')
  const low = ts.toLowerCase()
  if (nsOf(el) === 'svg') return { cls: ts === '' || JS_MIME.has(low) ? 'classic' : 'unsupported', type }
  if (ts === '' || JS_MIME.has(low)) return { cls: 'classic', type }
  if (low === 'module') return { cls: 'module', type }
  if (low === 'importmap' || low === 'speculationrules') return { cls: 'unsupported', type }
  return { cls: 'data', type }
}

export function textOf(el: P5Element): string {
  return el.childNodes.map((c) => (c.nodeName === '#text' ? (c as { value: string }).value : '')).join('')
}

/** 按文件顺序走（含 <template> 的 content） */
export function walkElements(root: P5Parent, fn: (el: P5Element) => void) {
  const kids = (root as { childNodes?: P5Node[] }).childNodes ?? []
  for (const n of [...kids]) {
    if ('tagName' in n) {
      fn(n as P5Element)
      walkElements(n as P5Element, fn)
      const content = (n as { content?: P5Parent }).content
      if ((n as P5Element).tagName === 'template' && content) walkElements(content, fn)
    }
  }
}

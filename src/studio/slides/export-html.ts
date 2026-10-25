// 旧整页 HTML 简报（存量简报仍在）出站前的机械校正。纯函数·无依赖·单测＝同目录 aislides-generate-postprocess.test.ts。
//   现在只剩出口这一层：服务端生成简报的路由、排队区简报单与组装期校正都已删。
//
//   ④ 出口校正（normalizeDeckHtmlForExport）：整份简报 html 被拿出站外用的几个出口（简报页「html」下载、云盘下载、
//      `GET /api/aislides/slides?id=`＝MCP get_slides 两版与 CLI 读回）——外层只让第 1 页带 active、变量名底线改连字号、
//      没标准导航补标准导航（与「html」钮同一份·⑤）、有导航才补「非当前页隐藏」。只改出口给出去的那份，库里的 html 不动。
//      为什么要这层：旧简报的各页常各自写着 class="slide active"（导航脚本 go() 只清当前页 ⇒ 别页叠着显示），
//      主题键 text_muted／font_title 被照抄成 var(--text_muted)（而样式定义的是 --text-muted ⇒ 变量无效）。
//
// 局限（写明）：只认 `var(--x)` 与 `--x:` 两种写法；页内脚本里用字串写的变量名（setProperty('--x_y')）不改。

import { hardenProgramFramesHtml } from './kit/components/program-harden'   // 旧存稿程序框补护

// ─── ② 变量名统一连字号 ─────────────────────────────────────────────────────────

// 引用：var( --text_muted  → var( --text-muted（只改名字里含底线、且以字母开头的；--_x 这类私有写法不动）
const VAR_REF_UNDERSCORE = /(var\(\s*)--([A-Za-z][A-Za-z0-9-]*_[A-Za-z0-9_-]*)/g
// 定义：--text_muted:  （前一个字不能是字母数字底线连字号或 !——排除 BEM 的 a--b_c 与 HTML 注释 <!--x_y:）
const VAR_DECL_UNDERSCORE = /(?<![A-Za-z0-9_!-])--([A-Za-z][A-Za-z0-9-]*_[A-Za-z0-9_-]*)(?=\s*:)/g

/** 把自定义属性名里的底线改成连字号（定义与 var() 引用都改）。回传新文字与改过的原名（去重）。 */
export function normalizeCssVarNames(text: string): { text: string; renamed: string[] } {
  if (!text) return { text, renamed: [] }
  const renamed = new Set<string>()
  const out = text
    .replace(VAR_REF_UNDERSCORE, (_m, pre: string, name: string) => {
      renamed.add(`--${name}`)
      return `${pre}--${name.replace(/_/g, '-')}`
    })
    .replace(VAR_DECL_UNDERSCORE, (_m, name: string) => {
      renamed.add(`--${name}`)
      return `--${name.replace(/_/g, '-')}`
    })
  return { text: out, renamed: [...renamed] }
}

/**
 * ①b 非当前页一律隐藏：单页模型常在自己的 <style> 里写 `.slide[data-title="…"]{display:flex}`（优先级 0,2,0）
 * 盖过全局 `section.slide{display:none}`（0,1,1）⇒ 就算 class 里只有第 1 页带 active，那几页照样一直显示、叠在一起
 * （本机站真生 3 份里 3 份都有·class 校正拦不住这一路）。
 * `:where()` 把优先级压到 (0,1,0)：缩略图（THUMB_OVERRIDE）、画布预览（__pv_reset__）、pptx 导出那几处
 * `section.slide,div.slide{display:flex!important}`（0,1,1）照样盖得过；编辑器／分享页用行内 !important 也盖得过。
 */
export const HIDE_INACTIVE_SLIDES_CSS = `/* 只显示当前页（:where 压低优先级·强制显示全部页的缩略／导出样式照样盖得过） */\n:where(section.slide,div.slide):not(.active){display:none!important}`

// ─── 出口校正共用的开标签解析 ─────────────────────────────────────────────────────

// 开标签（属性值里可含 >）
const OPEN_TAG = /<(section|div)\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi
const CLASS_ATTR = /\sclass\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i

function classTokens(tag: string): string[] | null {
  const m = tag.match(CLASS_ATTR)
  if (!m) return null
  return (m[1] ?? m[2] ?? m[3] ?? '').split(/\s+/).filter(Boolean)
}

function rewriteClass(tag: string, tokens: string[]): string {
  const value = `class="${tokens.join(' ')}"`
  if (CLASS_ATTR.test(tag)) return tag.replace(CLASS_ATTR, ` ${value}`)
  return tag.replace(/^<(section|div)\b/i, (m) => `${m} ${value}`)
}

// ─── ④ 出口校正（整份 html）────────────────────────────────────────────────────

/** 「非当前页隐藏」规则本体（不含注释）——判「这份已经有了没」用它。 */
export const HIDE_INACTIVE_SLIDES_RULE = ':where(section.slide,div.slide):not(.active){display:none!important}'
const HIDE_STYLE_ID = '__slides_hide_inactive__'
const HAS_STD_NAV = /<script\b[^>]*\bid=["']__slides_nav__["']/i

// 不在这些区块里找投影片开标签：<script>（字串里可能拼 <section class="slide">）、<style>、HTML 注释
const SKIP_BLOCKS = /<script\b[\s\S]*?<\/script\s*>|<style\b[\s\S]*?<\/style\s*>|<!--[\s\S]*?-->/gi

/**
 * 整份简报 html 出站前校正（库里的不动·只改给出去的那份）：
 *   - class 带 slide 的 <section>/<div>：第一个带 active，其余拿掉（旧简报常见第 1、3、5 页都带 active；编辑器存档后
 *     active 落在「存档时正在看的那页」，而导航脚本从第 1 页算起）；
 *   - 自定义属性名里的底线改连字号（旧简报的 var(--text_muted)／var(--font_title) 对上 :root 的 --text-muted）；
 *   - 没有标准导航（id=__slides_nav__）就补上与「html」钮同一份（ensureStandaloneNavScript）；
 *   - 没有「非当前页隐藏」规则就在 </head> 前补一段 <style>（没有 </head> 就放 <body> 后／最前面）——
 *     **只在标准导航在场时补**：没导航又隐藏别页＝只看得到第 1 页还翻不了，比叠着更差。
 * 一份里找不到任何 .slide 就原样回（不是简报形状·不碰）。幂等。
 */
export function normalizeDeckHtmlForExport(html: string): string {
  if (!html) return html
  // 旧存稿里的程序框（allow-scripts·没守卫·旧执行器）出口一律补护（slide-kit/components/program-harden.ts）
  html = hardenProgramFramesHtml(html)
  const skip: Array<[number, number]> = []
  for (const m of html.matchAll(SKIP_BLOCKS)) skip.push([m.index ?? 0, (m.index ?? 0) + m[0].length])
  const inSkip = (i: number) => skip.some(([a, b]) => i >= a && i < b)

  const hits: Array<{ start: number; end: number; tag: string; tokens: string[] }> = []
  for (const m of html.matchAll(OPEN_TAG)) {
    const start = m.index ?? 0
    if (inSkip(start)) continue
    const tokens = classTokens(m[0]) ?? []
    if (tokens.includes('slide')) hits.push({ start, end: start + m[0].length, tag: m[0], tokens })
  }
  if (!hits.length) return html

  let out = ''
  let last = 0
  hits.forEach((h, i) => {
    const want = i === 0
    const has = h.tokens.includes('active')
    const dup = h.tokens.filter(t => t === 'active').length > 1
    if (has === want && !dup) return
    const next = h.tokens.filter(t => t !== 'active')
    if (want) next.push('active')
    out += html.slice(last, h.start) + rewriteClass(h.tag, next)
    last = h.end
  })
  out += html.slice(last)

  out = normalizeCssVarNames(out).text
  if (!HAS_STD_NAV.test(out)) out = ensureStandaloneNavScript(out)
  if (!HAS_STD_NAV.test(out)) return out // 标准导航补不进去 ⇒ 不加隐藏规则
  if (out.includes(HIDE_INACTIVE_SLIDES_RULE)) return out
  const style = `<style id="${HIDE_STYLE_ID}">${HIDE_INACTIVE_SLIDES_CSS}</style>`
  const headClose = out.search(/<\/head\s*>/i)
  if (headClose >= 0) return out.slice(0, headClose) + style + '\n' + out.slice(headClose)
  const body = out.match(/<body\b[^>]*>/i)
  if (body && body.index !== undefined) {
    const at = body.index + body[0].length
    return out.slice(0, at) + '\n' + style + out.slice(at)
  }
  return style + '\n' + out
}

// ─── ⑤ 标准导航（「html」钮下载与出口校正共用这一份·aislides-utils 从这里取）────────────────────

/** 标准导航脚本（id=__slides_nav__·go() 清所有页的 active）。 */
export const STANDALONE_NAV_SCRIPT = `<script id="__slides_nav__">
var cur=0,step=0,slides=document.querySelectorAll('.slide');
function stepValue(el){var raw=el.getAttribute('data-step');var n=Number(raw);return Number.isFinite(n)?n:null;}
function getGroups(sl){var items=Array.from(sl.querySelectorAll('[data-step]'));if(items.length===0)return[];var values=items.map(stepValue).filter(function(v){return v!==null;});var unique=Array.from(new Set(values)).sort(function(a,b){return a-b;});if(unique.length<=1)return items.map(function(el){return[el];});return unique.map(function(v){return items.filter(function(el){return stepValue(el)===v;});});}
function showGroup(sl,i){var groups=getGroups(sl);if(!groups[i])return false;groups[i].forEach(function(el){el.classList.add('visible');});return true;}
function go(n){if(typeof n!=='number'||n!==Math.floor(n)||n<0||n>=slides.length)return;for(var k=0;k<slides.length;k++)slides[k].classList.remove('active');cur=n;step=0;slides[cur].classList.add('active');showGroup(slides[cur],0);window.parent.postMessage({type:'slideChange',index:cur},'*');}
function nextStep(){var groups=getGroups(slides[cur]);if(groups.length===0)return false;if(step<groups.length-1){step++;showGroup(slides[cur],step);return true;}return false;}
function prevStep(){var groups=getGroups(slides[cur]);if(step>0&&groups[step]){groups[step].forEach(function(el){el.classList.remove('visible');});step--;return true;}return false;}
window.addEventListener('message',function(e){if(e.source!==window.parent||!e.data)return;if(e.data.type==='goto')go(e.data.index);if(e.data.type==='nextStep'){if(!nextStep())go(cur+1);}if(e.data.type==='prevStep'){if(!prevStep())go(cur-1);}});
document.addEventListener('keydown',function(e){if(e.key==='ArrowRight'||e.key==='ArrowDown'){e.preventDefault();if(!nextStep())go(cur+1);}if(e.key==='ArrowLeft'||e.key==='ArrowUp'){e.preventDefault();if(!prevStep())go(cur-1);}});
if(slides.length>0)showGroup(slides[0],0);
</script>`

/** 拿掉标准导航与早期无 id 的内联导航。 */
export function stripStandaloneNavScript(html: string): string {
  return html
    .replace(/<script id="__slides_nav__">[\s\S]*?<\/script>\n?/g, '')
    .replace(/<script>\s*var cur=0,step=0,slides=document\.querySelectorAll\(['"]\.slide['"]\);[\s\S]*?showStep\(slides\[0\],0\);\s*<\/script>\n?/g, '')
}

/** 有 .slide 的份：拿掉旧导航、在 </body> 前（没有就接在最后）放标准导航。 */
export function ensureStandaloneNavScript(html: string): string {
  if (!html || !/<(?:section|div)\b[^>]*class=["'][^"']*\bslide\b/i.test(html)) return html
  const withoutOldNav = stripStandaloneNavScript(html)
  if (withoutOldNav.includes('</body>')) return withoutOldNav.replace('</body>', STANDALONE_NAV_SCRIPT + '\n</body>')
  return withoutOldNav + STANDALONE_NAV_SCRIPT
}

/**
 * slide-kit pipeline · version:2 渲染产物（静态整份 HTML）
 *
 * aislides 落库存两份：
 *   - deck_data：{version:2, outline, pages}（结构化·可改可回滚·权威）
 *   - html_content：本文件产出的静态整份 HTML（渲染产物·旧查看器/分享页/编辑器
 *     零改动照渲——与旧「AI 直出 HTML」简报同为 .slide/.active 结构）
 *
 * 版式在 1000×562.5 逻辑画布 SSR（SlideView 同一入口=三缩放同源），
 * 视口适配由 __sk_fit__ 脚本按 min(vw/1000, vh/562.5) 缩放舞台。
 * 导航脚本 id 沿用 __slides_nav__——aislides-utils 的 strip/inject 按该 id
 * 换成同语义标准导航·行为不变。
 */

import * as React from 'react'
import { CANVAS_HEIGHT, CANVAS_WIDTH } from '../types'
import type { Theme } from '../types'
import { fontStack, SINGLE_WEIGHT_FONTS, themeCssFontIds, themeGoogleFamilies } from '../themes'
import type { ComposedPage } from '../engine'
import { fontLinkTags } from '../../../shared/fonts/catalog'
import { pageComponents } from '../components/derive'
import { catalogFontIdsOf } from '../components/resolve'
import { COMPONENT_ANIMATION_CSS, ComponentSlideView } from '../components/render'
import type { PageComponentFields } from '../components/types'
import { transitionScript } from '../components/transition'
import { stepsScript } from '../components/steps'
import { hardenProgramFramesHtml } from '../components/program-harden'

/** 一页＝引擎产物（版式＋draft＋图槽）＋组件栏（已物化的页）＋pid（组件编号前缀） */
export type DeckHtmlPage = ComposedPage & PageComponentFields & { pid?: string; /** */ skinId?: string }

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 页标题（section data-title·左栏缩略/导航用）——静态兜底跟 lang 走 */
function pageTitle(page: ComposedPage, index: number, lang: PipelineHtmlLang): string {
  const d = page.draft
  const cn = lang === 'zh-CN'
  if (d.type === 'contents') return cn ? '目录' : '目錄'
  if (d.type === 'end') return d.title ?? (cn ? '谢谢观看' : '謝謝觀看')
  return d.title || (cn ? `第 ${index + 1} 页` : `第 ${index + 1} 頁`)
}

/** 视口适配：舞台按 min(vw/1000, vh/562.5) 等比缩放（独立脚本·不与导航脚本混装） */
const FIT_SCRIPT = `<script id="__sk_fit__">
(function(){
  function fit(){
    var s=Math.min(window.innerWidth/${CANVAS_WIDTH},window.innerHeight/${CANVAS_HEIGHT});
    document.querySelectorAll('.sk-stage').forEach(function(el){el.style.transform='scale('+s+')';});
  }
  window.addEventListener('resize',fit);
  fit();
})();
</script>`

/** 标准导航（与 aislides-generate-postprocess STANDALONE_NAV_SCRIPT 同语义·同 id 可被其 strip/替换） */
const NAV_SCRIPT = `<script id="__slides_nav__">
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

/**
 * ComposedPage[] + 主题 → 静态整份 HTML（渲染产物）。
 * react-dom/server 动态 import（route bundle 静态 import 会被 Next 的
 * RSC 条件拦·动态载入在 route handler 运行时合法）。
 */
export async function buildDeckHtml(opts: {
  title: string
  lang: PipelineHtmlLang
  theme: Theme
  pages: DeckHtmlPage[]
}): Promise<string> {
  const { renderToStaticMarkup } = await import('react-dom/server')

  // 每页一律走组件渲染器：已物化＝page.components；手动排版层＝包成 html 组件（与旧口径同内容）；
  //   其余＝版式蓝图派生（components/blueprints.ts）。data-title 仍取 draft 标题（标题组件改字会回写 draft）。
  const fontIds = new Set<string>()
  const sections = opts.pages
    .map((page, i) => {
      const components = pageComponents(page, i, opts.lang)
      for (const id of catalogFontIdsOf(components)) fontIds.add(id)
      const markup = renderToStaticMarkup(
        React.createElement(ComponentSlideView, {
          components,
          animations: page.animations,
          background: page.background,
          theme: opts.theme,
          pageType: page.draft.type,
          mode: 'deck',
        }),
      )
      // 换到这一页的切换写在 section 上（transition.ts install 读）
      const tr = page.transition && page.transition.type !== 'none'
        ? ` data-tr="${escapeHtml(page.transition.type)}" data-tr-dur="${Math.round(page.transition.durationMs)}"${page.transition.direction ? ` data-tr-dir="${escapeHtml(page.transition.direction)}"` : ''}`
        : ''
      return `<section class="slide${i === 0 ? ' active' : ''}" data-title="${escapeHtml(pageTitle(page, i, opts.lang))}"${tr}><div class="sk-stage">${markup}</div></section>`
    })
    .join('\n')

  // 单字重族（Huninn／Iansui）不能带 wght 轴（Google css2 会整条 400·连正文字体一起失效）⇒ 裸族名；
  //   其余照旧 `:wght@…`（既有 Noto 两族的链接串一字不变）
  const fam = (name: string, weights: string) =>
    SINGLE_WEIGHT_FONTS.has(name) ? encodeURIComponent(name) : `${encodeURIComponent(name)}:wght@${weights}`
  // 不在 Google 上的主题字族（霞鹜文楷）改挂字体表样式表·Google 链只拼其余的（既有主题两族都在 Google ⇒ 串不变）
  const gf = themeGoogleFamilies(opts.theme)
  const googleFams = [gf.heading ? fam(gf.heading, '400;600;700') : null, gf.body ? fam(gf.body, '400;500') : null].filter(Boolean)
  for (const id of themeCssFontIds(opts.theme)) fontIds.add(id)

  // 最后过一道程序框补护——组件版程序本来就是静态＋lazy＋守卫（只多 <head> 里的盯 load 脚本）；
  //   手动排版层（htmlOverride）带进来的旧程序框（allow-scripts·没守卫）在这里补成同样规矩。没有程序框＝一字不动。
  return hardenProgramFramesHtml(`<!DOCTYPE html>
<html lang="${opts.lang}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(opts.title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
${googleFams.length ? `<link href="https://fonts.googleapis.com/css2?${googleFams.map((f) => `family=${f}`).join('&')}&display=swap" rel="stylesheet">\n` : ''}${fontIds.size ? fontLinkTags([...fontIds]) + '\n' : ''}<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body{width:100%;height:100%;overflow:hidden;background:#111}
body{font-family:${fontStack(opts.theme.fontPair.body)}}
section.slide{display:none;width:100vw;height:100vh;align-items:center;justify-content:center;position:relative;overflow:hidden}
section.slide.active{display:flex}
.sk-stage{width:${CANVAS_WIDTH}px;height:${CANVAS_HEIGHT}px;flex:none;transform-origin:center center}
${COMPONENT_ANIMATION_CSS}
</style>
</head>
<body>
${sections}
${FIT_SCRIPT}
${NAV_SCRIPT}
${transitionScript()}
${stepsScript()}
</body>
</html>`)
}

export type PipelineHtmlLang = 'zh-TW' | 'zh-CN'

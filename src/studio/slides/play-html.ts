// 全屏放映那份 HTML（deck 整份 HTML ⇒ 去掉不该在放映里的、补标准导航与字体、换页时把步骤归零）。纯字串。
import { normalizeDeckHtmlForExport } from './export-html'
import { injectFontLinks } from '../shared/fonts/html-links'

/** 播放专用：标准导航换页时只把 step 归零、上一趟亮过的步不熄 ⇒ 翻回看过的页全都亮着、→ 要空按几下才走。
 *  换页前先把目标页（与其余页）亮过的步熄掉，再交给原 go()（导航脚本本体一字不动·只在播放那份外包一层）。 */
export const PLAY_STEP_RESET_SCRIPT = `<script id="__play_step_reset__">
(function(){
  if(typeof window.go!=='function'||!window.slides)return;
  var orig=window.go;
  window.go=function(n){
    var sl=window.slides;
    if(n>=0&&n<sl.length){ for(var k=0;k<sl.length;k++){ sl[k].querySelectorAll('[data-step].visible').forEach(function(el){el.classList.remove('visible');}); } }
    return orig(n);
  };
})();
</script>`

/** 有标准导航的整份 HTML ⇒ 在 </body> 前补上换页归零脚本（没有导航 ⇒ 原样） */
export function withPlayStepReset(out: string): string {
  if (!out.includes('id="__slides_nav__"')) return out
  return out.includes('</body>') ? out.replace(/<\/body>(?![\s\S]*<\/body>)/, PLAY_STEP_RESET_SCRIPT + '\n</body>') : out + PLAY_STEP_RESET_SCRIPT
}

/** 游客编辑器：deck 刚渲出的整份 HTML ⇒ 放映那份（没有编辑层、没有云盘签名链要换） */
export function playHtmlOf(deckHtml: string): string {
  return withPlayStepReset(injectFontLinks(normalizeDeckHtmlForExport(deckHtml)))
}

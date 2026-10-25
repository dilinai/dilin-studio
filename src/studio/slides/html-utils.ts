// 简报整页 HTML 的浏览器端小工具：编辑框的编辑层脚本、拆页、下载与放映那份的出口校正。
import { injectFontLinks } from '../shared/fonts/html-links'
import { stripMediaResignScript, withMediaResignScript } from './media-resign-frame'
import { hardenProgramFramesHtml } from './kit/components/program-harden'
import { normalizeDeckHtmlForExport, stripStandaloneNavScript, ensureStandaloneNavScript } from './export-html'
import { withPlayStepReset } from './play-html'

export type SlideTitleLabel = (key: 'bf_aislides_deck_fallback' | 'bf_slides_page_n') => string
const DEFAULT_SLIDE_TITLE_LABEL: SlideTitleLabel = (k) => (k === 'bf_slides_page_n' ? '第 {n} 頁' : '投影片')
let slideTitleLabel: SlideTitleLabel = DEFAULT_SLIDE_TITLE_LABEL
export function setSlideTitleLabel(fn: SlideTitleLabel | null): void { slideTitleLabel = fn ?? DEFAULT_SLIDE_TITLE_LABEL }

export const EDIT_SCRIPT = `<script id="__edit_layer__">
(function(){
  var SKIP=['SCRIPT','STYLE','NOSCRIPT','IFRAME','CANVAS','SVG','INPUT','TEXTAREA','SELECT','OPTION','TITLE','HEAD','META','LINK'];  // <title> 也有直系文本·曾被打成 contenteditable（不可见元素）
  var targets=[];
  var curIdx=0, stepIdx=0;
  function hasDirectText(el){
    for(var i=0;i<el.childNodes.length;i++){
      var n=el.childNodes[i];
      if(n.nodeType===3&&n.textContent.trim().length>0) return true;
    }
    return false;
  }
  function getSlides(){
    var sls=document.querySelectorAll('section.slide,div.slide');
    if(sls.length===0) sls=document.querySelectorAll('[class*="slide"]');
    return sls;
  }
  function applyActive(slides,n){
    slides.forEach(function(sl,i){
      if(i===n){
        sl.classList.add('active');
        sl.style.setProperty('display','flex','important');
      }else{
        sl.classList.remove('active');
        sl.style.setProperty('display','none','important');
      }
    });
  }
  function stepValue(el){
    var raw=el.getAttribute('data-step');
    var n=Number(raw);
    return Number.isFinite(n)?n:null;
  }
  function getStepGroups(sl){
    var items=Array.from(sl.querySelectorAll('[data-step]'));
    if(items.length===0) return [];
    var values=items.map(stepValue).filter(function(v){return v!==null;});
    var unique=Array.from(new Set(values)).sort(function(a,b){return a-b;});
    if(unique.length<=1) return items.map(function(el){return [el];});
    return unique.map(function(v){
      return items.filter(function(el){return stepValue(el)===v;});
    });
  }
  function clearStepState(sl){
    sl.querySelectorAll('[data-step]').forEach(function(el){
      el.classList.remove('visible');
      el.style.animationPlayState='paused';
    });
  }
  function revealGroup(sl,i){
    var groups=getStepGroups(sl);
    if(groups.length===0) return false;
    groups[i].forEach(function(el){
      el.classList.add('visible');
      el.style.animationPlayState='';
    });
    return true;
  }
  function resetAllSteps(slides){
    slides.forEach(function(sl){
      clearStepState(sl);
    });
  }
  function gotoSlide(n){
    var sls=getSlides();
    if(typeof n!=='number'||n!==Math.floor(n)||n<0||n>=sls.length) return;
    curIdx=n; stepIdx=0;
    resetAllSteps(sls);
    applyActive(sls,n);
    revealGroup(sls[n],0);
    try{ window.cur=n; window.step=0; }catch(err){}
    window.parent.postMessage({type:'slideChange',index:n},'*');
  }
  function nextStep(){
    var sls=getSlides();
    if(curIdx>=sls.length) return false;
    var groups=getStepGroups(sls[curIdx]);
    if(groups.length===0) return false;
    if(stepIdx<groups.length-1){
      stepIdx++;
      revealGroup(sls[curIdx],stepIdx);
      try{ window.step=stepIdx; }catch(err){}
      return true;
    }
    return false;
  }
  function prevStep(){
    var sls=getSlides();
    if(curIdx>=sls.length) return false;
    var groups=getStepGroups(sls[curIdx]);
    if(stepIdx>0&&groups.length>0){
      groups[stepIdx].forEach(function(el){
        el.classList.remove('visible');
        el.style.animationPlayState='paused';
      });
      stepIdx--;
      try{ window.step=stepIdx; }catch(err){}
      return true;
    }
    return false;
  }
  function cleanForSerialize(){
    var sls=getSlides();
    sls.forEach(function(sl){
      sl.style.removeProperty('display');
      sl.querySelectorAll('[data-step]').forEach(function(el){ el.classList.remove('visible'); });
    });
    var mr=document.getElementById('__margin_reset__'); if(mr) mr.remove();
    var sr=document.getElementById('__edit_step_reset__'); if(sr) sr.remove();
  }
  /* ── [简报工具栏] 编辑态格式动作／格式刷／插图插视频／脏页收集 ──
   * 父页工具栏只发消息（format/copyFormat/insertMedia）·真动作全在本文档内做（选区在这里）。
   * 文本样式一律落成 inline style 的 <span>（execCommand fontSize=7 → <font size=7> 换成 span 的老法子·
   * 跨浏览器最稳）；块级（对齐/分散/列表样式/缩进）落在选区所在块元素的 style 上。
   * 改动只标「脏页」（data-sk-dirty）·disableEdit 时把脏页 innerHTML 逐页交回父页（v2 走 edit_page_html·
   * 旧 HTML 简报照旧整份 html）。 */
  var savedRange=null, painter=null, editing=false, selectedMedia=null, selTimer=0;
  function curSlideEl(){ var s=getSlides(); return s[curIdx]||null; }
  function stageOf(sl){ return (sl&&sl.querySelector('.sk-stage'))||sl; }
  function slideOf(el){
    while(el&&el!==document.body){
      if(el.nodeType===1&&(el.matches('section.slide,div.slide'))) return el;
      el=el.parentNode;
    }
    return curSlideEl();
  }
  function markDirty(el){ var sl=slideOf(el); if(sl) sl.setAttribute('data-sk-dirty','1'); }
  function selAnchorEl(){
    var sel=document.getSelection(); if(!sel||sel.rangeCount===0) return null;
    var n=sel.getRangeAt(0).commonAncestorContainer;
    return n.nodeType===1?n:n.parentElement;
  }
  function blockOf(el){
    while(el&&el!==document.body){
      var d=getComputedStyle(el).display;
      if(d!=='inline'&&d!=='inline-block'&&d!=='contents') return el;
      el=el.parentElement;
    }
    return el;
  }
  function restoreSel(){
    var sel=document.getSelection(); if(!sel) return false;
    if(sel.rangeCount>0&&!sel.isCollapsed) return true;
    if(savedRange){ try{ sel.removeAllRanges(); sel.addRange(savedRange); return true; }catch(err){} }
    return sel.rangeCount>0;
  }
  function styleEl(el,styles){ Object.keys(styles).forEach(function(k){ el.style[k]=styles[k]; }); }
  /* 给选区包一层带 inline style 的 span；选区折叠时改光标所在元素的 style（下一段输入沿用） */
  function wrapSelection(styles){
    if(!restoreSel()) return false;
    var sel=document.getSelection();
    if(sel.isCollapsed){ var el=selAnchorEl(); if(!el) return false; styleEl(el,styles); markDirty(el); return true; }
    document.execCommand('styleWithCSS',false,'false');
    document.execCommand('fontSize',false,'7');
    var fonts=Array.prototype.slice.call(document.querySelectorAll('font[size="7"]'));
    fonts.forEach(function(f){
      var sp=document.createElement('span');
      while(f.firstChild) sp.appendChild(f.firstChild);
      if(f.getAttribute('style')) sp.setAttribute('style',f.getAttribute('style'));
      styleEl(sp,styles); f.parentNode.replaceChild(sp,f); markDirty(sp);
    });
    document.execCommand('styleWithCSS',false,'true');
    return true;
  }
  function exec(cmd,val){ if(!restoreSel()) return false; document.execCommand('styleWithCSS',false,'true'); var ok=document.execCommand(cmd,false,val===undefined?null:val); var el=selAnchorEl(); if(el) markDirty(el); return ok; }
  function blockStyle(styles){ if(!restoreSel()) return false; var el=blockOf(selAnchorEl()); if(!el||el===document.body) return false; styleEl(el,styles); markDirty(el); return true; }
  function curFontPx(){ var el=selAnchorEl(); if(!el) return 24; var v=parseFloat(getComputedStyle(el).fontSize); return isFinite(v)?v:24; }
  /* [选字体] 字体 stylesheet 挂进本文档 <head>（同 id 只挂一次·随本体 HTML 一起序列化 ⇒ 旧 HTML 简报重载自带；v2 按页存的由 injectEditScript 按页内容重扫补挂） */
  function ensureFontLink(id,href){
    if(!id||!href) return;
    if(document.head.querySelector('link[data-font-id="'+id+'"]')) return;
    var l=document.createElement('link'); l.rel='stylesheet'; l.href=href; l.setAttribute('data-font-id',id); l.crossOrigin='anonymous'; document.head.appendChild(l);
  }
  function fmt(cmd,val,fontId,fontHref){
    switch(cmd){
      case 'bold': case 'italic': case 'underline': case 'strikeThrough': case 'superscript': case 'subscript':
      case 'indent': case 'outdent': case 'removeFormat':
      case 'justifyLeft': case 'justifyCenter': case 'justifyRight': case 'justifyFull':
        if(cmd==='removeFormat'){ exec('removeFormat'); var b=blockOf(selAnchorEl()); if(b&&b!==document.body){ b.style.textAlign=''; b.style.textAlignLast=''; } return; }
        if(cmd.indexOf('justify')===0){ var bb=blockOf(selAnchorEl()); if(bb&&bb!==document.body) bb.style.textAlignLast=''; }
        exec(cmd); return;
      case 'justifyDistribute': blockStyle({textAlign:'justify',textAlignLast:'justify'}); return;
      case 'fontName': ensureFontLink(fontId,fontHref); wrapSelection({fontFamily:String(val||'')}); return;   /* [选字体] value=CSS 栈·fontId/fontHref 由父页按 lib/fonts/catalog 解出·先把 stylesheet 挂进本文档再套 */
      case 'fontSize': wrapSelection({fontSize:parseFloat(val)+'px'}); return;
      case 'sizeStep': var px=curFontPx()+(Number(val)||0); px=Math.max(8,Math.min(200,Math.round(px))); wrapSelection({fontSize:px+'px'}); return;
      case 'foreColor': wrapSelection({color:String(val)}); return;
      case 'hiliteColor': wrapSelection({backgroundColor:String(val)}); return;
      case 'shadow': { var a=selAnchorEl(); var has=a&&getComputedStyle(a).textShadow!=='none'; wrapSelection({textShadow:has?'none':'2px 2px 4px rgba(0,0,0,0.45)'}); return; }
      case 'list': {
        var ordered=String(val).indexOf('ol:')===0; var style=String(val).split(':')[1]||'';
        exec(ordered?'insertOrderedList':'insertUnorderedList');
        var el=selAnchorEl(); var list=el&&el.closest?el.closest('ul,ol'):null;
        if(list){ list.style.listStyleType=style||''; list.style.paddingLeft=list.style.paddingLeft||'1.5em'; list.style.listStylePosition='outside'; markDirty(list); }
        return;
      }
      default: return;
    }
  }
  /* 格式刷：记选区处 8 项计算样式 → 下一次放开鼠标时套到新选区（或点到的文字元素）·Esc 取消 */
  function copyFormat(){
    var el=selAnchorEl(); if(!el){ painter=null; return false; }
    var cs=getComputedStyle(el);
    painter={fontFamily:cs.fontFamily,fontSize:cs.fontSize,fontWeight:cs.fontWeight,fontStyle:cs.fontStyle,textDecorationLine:cs.textDecorationLine,color:cs.color,backgroundColor:cs.backgroundColor,textShadow:cs.textShadow};
    document.body.style.cursor='copy';
    return true;
  }
  function endPainter(){ painter=null; document.body.style.cursor=''; window.parent.postMessage({type:'painterState',active:false},'*'); }
  document.addEventListener('mouseup',function(e){
    if(!painter) return;
    var st=painter;
    setTimeout(function(){
      var sel=document.getSelection();
      if(sel&&sel.rangeCount>0&&!sel.isCollapsed){ wrapSelection(st); }
      else { var t=e.target&&e.target.nodeType===1?e.target:(e.target&&e.target.parentElement); if(t&&t!==document.body&&hasDirectText(t)){ styleEl(t,st); markDirty(t); } }
      endPainter(); postSelState();
    },0);
  },true);
  document.addEventListener('keydown',function(e){ if(e.key==='Escape'&&painter) endPainter(); });
  /* 选区状态回报（工具栏高亮用） */
  function postSelState(){
    if(!editing) return;
    if(selTimer) return;
    selTimer=setTimeout(function(){
      selTimer=0;
      var sel=document.getSelection(); var el=selAnchorEl(); var cs=el?getComputedStyle(el):null; var b=el?blockOf(el):null; var bcs=b?getComputedStyle(b):null;
      var q=function(c){ try{ return document.queryCommandState(c); }catch(err){ return false; } };
      window.parent.postMessage({type:'selState',hasSel:!!(sel&&sel.rangeCount>0&&!sel.isCollapsed),inText:!!(el&&el.isContentEditable),
        b:q('bold'),i:q('italic'),u:q('underline'),s:q('strikeThrough'),sup:q('superscript'),sub:q('subscript'),ul:q('insertUnorderedList'),ol:q('insertOrderedList'),
        align:bcs?(bcs.textAlignLast==='justify'?'distribute':bcs.textAlign):'',font:cs?cs.fontFamily.split(',')[0].replace(/["']/g,'').trim():'',size:cs?Math.round(parseFloat(cs.fontSize)):0,
        shadow:!!(cs&&cs.textShadow!=='none'),media:!!selectedMedia},'*');
    },60);
  }
  document.addEventListener('selectionchange',function(){
    var sel=document.getSelection();
    if(sel&&sel.rangeCount>0){ var r=sel.getRangeAt(0); if(r.startContainer!==document&&document.body.contains(r.startContainer)) savedRange=r.cloneRange(); }
    postSelState();
  });
  document.addEventListener('input',function(e){ if(editing&&e.target) markDirty(e.target); });
  /* 插图／插视频：落成 <div data-sk-media> 绝对定位在舞台里（百分比坐标·随舞台缩放）；编辑态可拖动／缩放／删 */
  function insertMedia(kind,src,key,display){
    var sl=curSlideEl(); if(!sl) return;
    var stage=stageOf(sl);
    if(getComputedStyle(stage).position==='static') stage.style.position='relative';
    var wrap=document.createElement('div');
    wrap.setAttribute('data-sk-media',kind);
    var n=stage.querySelectorAll('[data-sk-media]').length;   // 第 n 件错开 4%·别叠在同一点
    wrap.style.cssText='position:absolute;left:'+(30+4*(n%8))+'%;top:'+(28+4*(n%8))+'%;width:40%;z-index:5;';
    var m=document.createElement(kind==='video'?'video':'img');
    m.setAttribute('src',display||src); m.setAttribute('data-src',src); if(key) m.setAttribute('data-r2-key',key);
    m.style.cssText='display:block;width:100%;height:auto;';
    if(kind==='video'){ m.setAttribute('controls',''); m.setAttribute('playsinline',''); m.setAttribute('preload','metadata'); }
    else { m.setAttribute('draggable','false'); m.setAttribute('alt',''); }
    wrap.appendChild(m); stage.appendChild(wrap); markDirty(wrap);
    if(editing) armMedia(wrap);
    selectMedia(wrap);
  }
  function selectMedia(w){
    if(selectedMedia&&selectedMedia!==w) selectedMedia.removeAttribute('data-sk-selected');
    selectedMedia=w; if(w) w.setAttribute('data-sk-selected','1');
    postSelState();
  }
  function stageScale(stage){ var r=stage.getBoundingClientRect(); return stage.offsetWidth?r.width/stage.offsetWidth:1; }
  function armMedia(w){
    if(w.querySelector('.__mh')) return;
    var del=document.createElement('button'); del.className='__mh __mh-del'; del.type='button'; del.textContent='×'; del.title='delete';
    del.style.cssText='position:absolute;top:-12px;right:-12px;width:24px;height:24px;border-radius:12px;border:0;background:#ef4444;color:#fff;font:bold 16px/24px sans-serif;cursor:pointer;z-index:7;padding:0;';
    var rs=document.createElement('div'); rs.className='__mh __mh-rs';
    rs.style.cssText='position:absolute;right:-6px;bottom:-6px;width:14px;height:14px;background:#2563eb;border:2px solid #fff;border-radius:3px;cursor:nwse-resize;z-index:7;';
    w.appendChild(del); w.appendChild(rs);
    w.style.cursor='move';
    del.addEventListener('mousedown',function(e){ e.preventDefault(); e.stopPropagation(); });
    del.addEventListener('click',function(e){ e.preventDefault(); e.stopPropagation(); var sl=slideOf(w); w.parentNode.removeChild(w); if(sl) sl.setAttribute('data-sk-dirty','1'); if(selectedMedia===w) selectMedia(null); });
    var drag=null;
    function onMove(e){
      if(!drag) return;
      var stage=drag.stage, sc=drag.scale, sw=stage.offsetWidth||1, sh=stage.offsetHeight||1;
      var dx=(e.clientX-drag.x)/sc, dy=(e.clientY-drag.y)/sc;
      if(drag.mode==='move'){
        w.style.left=Math.max(-50,Math.min(100,(drag.left+dx)/sw*100)).toFixed(2)+'%';
        w.style.top=Math.max(-50,Math.min(100,(drag.top+dy)/sh*100)).toFixed(2)+'%';
      } else {
        w.style.width=Math.max(5,Math.min(100,(drag.w+dx)/sw*100)).toFixed(2)+'%';
      }
      e.preventDefault();
    }
    function onUp(){ if(drag){ markDirty(w); drag=null; document.removeEventListener('mousemove',onMove); document.removeEventListener('mouseup',onUp); } }
    w.addEventListener('mousedown',function(e){
      if(!editing) return;
      var isRs=e.target===rs;
      if(e.target.classList&&e.target.classList.contains('__mh-del')) return;
      var stage=stageOf(slideOf(w));
      drag={mode:isRs?'resize':'move',x:e.clientX,y:e.clientY,left:w.offsetLeft,top:w.offsetTop,w:w.offsetWidth,stage:stage,scale:stageScale(stage)};
      selectMedia(w);
      e.preventDefault(); e.stopPropagation();
      document.addEventListener('mousemove',onMove); document.addEventListener('mouseup',onUp);
    });
  }
  function disarmMedia(){
    document.querySelectorAll('.__mh').forEach(function(h){ h.parentNode.removeChild(h); });
    document.querySelectorAll('[data-sk-media]').forEach(function(w){ w.style.cursor=''; w.removeAttribute('data-sk-selected'); });
    selectedMedia=null;
  }
  document.addEventListener('mousedown',function(e){ if(selectedMedia&&!(e.target.closest&&e.target.closest('[data-sk-media]'))) selectMedia(null); },true);
  document.addEventListener('keydown',function(e){
    if(!editing||!selectedMedia) return;
    if((e.key==='Delete'||e.key==='Backspace')&&!(e.target&&e.target.isContentEditable)){
      e.preventDefault(); var w=selectedMedia; var sl=slideOf(w); w.parentNode.removeChild(w); if(sl) sl.setAttribute('data-sk-dirty','1'); selectMedia(null);
    }
  });
  /* 序列化前：摘编辑把手·恢复媒体 canonical src（父页可能换成了签名链）·摘选中标记 */
  function cleanMediaForSerialize(){
    disarmMedia();
    document.querySelectorAll('[data-src]').forEach(function(m){ var c=m.getAttribute('data-src'); if(c) m.setAttribute('src',c); });
  }
  /* 只收真正宿主（window.parent）的命令——页里程序 iframe（作者码）
     * 送来的 appendSlide／patchSlide／goto／disableEdit… 一律不理（⛔ 让作者码借外层 deck 改页、翻页、交回 htmlUpdated）。 */
  function pageIdx(n,len){ return typeof n==='number'&&n===Math.floor(n)&&n>=0&&n<len; }
  window.addEventListener('message',function(e){
    if(e.source!==window.parent) return;
    if(!e.data) return;
    if(e.data.type==='format'){ fmt(String(e.data.cmd||''),e.data.value,e.data.fontId?String(e.data.fontId):'',e.data.fontHref?String(e.data.fontHref):''); postSelState(); return; }
    if(e.data.type==='copyFormat'){ var ok=copyFormat(); window.parent.postMessage({type:'painterState',active:!!ok},'*'); return; }
    if(e.data.type==='cancelPainter'){ endPainter(); return; }
    if(e.data.type==='insertMedia'&&e.data.src){ insertMedia(e.data.kind==='video'?'video':'image',String(e.data.src),e.data.key?String(e.data.key):'',e.data.display?String(e.data.display):''); return; }
    if(e.data.type==='patchSlide'){
      var sls=getSlides();
      var ni=e.data.index;
      if(pageIdx(ni,sls.length)){
        var tmp=document.createElement('div');
        tmp.innerHTML=e.data.html;
        var ns=tmp.querySelector('section')||tmp.querySelector('div.slide');
        if(ns){
          var wa=sls[ni].classList.contains('active');
          ns.classList.toggle('active',wa);
          ns.style.removeProperty('display');
          sls[ni].replaceWith(ns);
          applyActive(getSlides(),curIdx);
        }
      }
      return;
    }
    if(e.data.type==='appendSlide'){
      var tmp=document.createElement('div');
      tmp.innerHTML=e.data.html;
      var ns=tmp.querySelector('section.slide,div.slide')||tmp.querySelector('[class*="slide"]')||tmp.firstElementChild;
      if(!ns) return;
      ns.style.removeProperty('display');
      var bodyScripts=Array.from(document.body.querySelectorAll('script'));
      if(bodyScripts.length>0) document.body.insertBefore(ns,bodyScripts[0]);
      else document.body.appendChild(ns);
      var sls=getSlides();
      if(sls.length===1) gotoSlide(0);
      window.parent.postMessage({type:'slideAppended',count:sls.length},'*');
      return;
    }
    if(e.data.type==='goto'){ gotoSlide(e.data.index); return; }
    if(e.data.type==='nextStep'){ if(!nextStep()) gotoSlide(curIdx+1); return; }
    if(e.data.type==='prevStep'){ if(!prevStep()) gotoSlide(curIdx-1); return; }
    if(e.data.type==='enableEdit'){
      editing=true;
      document.querySelectorAll('[data-sk-media]').forEach(armMedia);
      document.querySelectorAll('*').forEach(function(el){
        if(SKIP.indexOf(el.tagName)!==-1) return;
        if(el.isContentEditable) return;
        if(!hasDirectText(el)) return;
        el.contentEditable='true'; el.dataset.edited='1';
        el.style.outline='1.5px dashed rgba(99,179,237,0.55)';
        el.style.borderRadius='2px'; el.style.cursor='text';
        targets.push(el);
      });
    }
    // [套模板先问] 只读查询：哪几页有还没回写的改动（脏页标记）——不动编辑态·不清标记·父页据此决定弹不弹问句
    if(e.data.type==='queryDirty'){
      var dirty=[]; getSlides().forEach(function(sl,i){ if(sl.hasAttribute('data-sk-dirty')) dirty.push(i); });
      window.parent.postMessage({type:'dirtyPages',indexes:dirty,reqId:e.data.reqId,editing:!!editing},'*');
      return;
    }
    if(e.data.type==='disableEdit'){
      targets.forEach(function(el){
        el.contentEditable='false'; el.style.outline=''; el.style.cursor='';
        delete el.dataset.edited;
      });
      targets=[];
      editing=false; if(painter) endPainter();
      cleanMediaForSerialize();
      cleanForSerialize();
      // [简报工具栏] 脏页逐页交回（v2 结构化简报按页存 htmlOverride·旧 HTML 简报父页仍用整份 html）
      // 程序 iframe 存档一律是静态（sandbox=""）·进页才由放映执行器换成 allow-scripts——⛔ 把「正在跑」的状态存进库
      var lazy=[]; document.querySelectorAll('iframe[data-sk-lazy]').forEach(function(f){ lazy.push([f,f.getAttribute('sandbox')]); f.setAttribute('sandbox',''); });
      var pages=[];
      getSlides().forEach(function(sl,i){ if(sl.hasAttribute('data-sk-dirty')){ sl.removeAttribute('data-sk-dirty'); pages.push({index:i,html:sl.innerHTML}); } });
      var full='<!DOCTYPE html>'+document.documentElement.outerHTML;
      lazy.forEach(function(x){ if(x[1]!==null) x[0].setAttribute('sandbox',x[1]); });
      applyActive(getSlides(),curIdx);
      window.parent.postMessage({type:'htmlUpdated',html:full,pages:pages},'*');
    }
  });
  /* [简报播放] 上下键跳页、左右键跳步——焦点落在本文档里时同一套键位（父页那份见 deck-editor/playKeys.ts）；
     在改字（contenteditable）／输入框里不接·按着 Ctrl／⌘／Alt 不接 */
  document.addEventListener('keydown',function(e){
    var t=e.target;
    if(t&&(t.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName||''))) return;
    if(e.ctrlKey||e.metaKey||e.altKey) return;
    if(e.key==='ArrowDown'){ e.preventDefault(); gotoSlide(curIdx+1); }
    else if(e.key==='ArrowUp'){ e.preventDefault(); gotoSlide(curIdx-1); }
    else if(e.key==='ArrowRight'){ e.preventDefault(); if(!nextStep()) gotoSlide(curIdx+1); }
    else if(e.key==='ArrowLeft'){ e.preventDefault(); if(!prevStep()) gotoSlide(curIdx-1); }
  });
  (function(){
    var sls=getSlides();
    if(sls.length===0) return;
    var initialIdx=0;
    for(var i=0;i<sls.length;i++){
      if(sls[i].classList.contains('active')){ initialIdx=i; break; }
    }
    curIdx=initialIdx; stepIdx=0;
    resetAllSteps(sls);
    applyActive(sls,initialIdx);
    revealGroup(sls[initialIdx],0);
    try{ window.cur=initialIdx; window.step=0; }catch(err){}
  })();
})();
</script>`


export interface Slide { title: string; index: number; fallback?: boolean }

const MARGIN_RESET = `<style id="__margin_reset__">html,body{margin:0!important;padding:0!important;overflow:hidden!important}</style>`

const EDIT_STEP_RESET = `<style id="__edit_step_reset__">
section.slide [data-step]:not(.visible),div.slide [data-step]:not(.visible){
  opacity:0!important;
  visibility:hidden!important;
  pointer-events:none!important;
  transform:none!important;
  animation:none!important;
  transition:none!important;
}
section.slide [data-step].visible,div.slide [data-step].visible{
  opacity:1!important;
  visibility:visible!important;
  pointer-events:auto!important;
}
section.slide [data-step],div.slide [data-step]{
  animation:none!important;
}
</style>`

export function injectEditScript(html: string): string {
  if (!html) return html
  const cleanHtml = injectFontLinks(stripStandaloneNavScript(stripEditLayer(sanitizeSvgAutoAttributes(hardenProgramFramesHtml(html)))))
  const withReset = cleanHtml.includes('</head>')
    ? cleanHtml.replace('</head>', MARGIN_RESET + '\n' + EDIT_STEP_RESET + '\n</head>')
    : cleanHtml.replace(/(<body[^>]*>)/i, (m) => m + '\n' + MARGIN_RESET + '\n' + EDIT_STEP_RESET)
  return withMediaResignScript(withReset.includes('</body>') ? withReset.replace('</body>', EDIT_SCRIPT + '\n</body>') : withReset + EDIT_SCRIPT)
}

function stripEditLayer(html: string): string {
  return sanitizeSvgAutoAttributes(stripMediaResignScript(html)
    .replace(/<script id="__edit_layer__">[\s\S]*?<\/script>\n?/g, '')
    .replace(/<style id="__margin_reset__">[\s\S]*?<\/style>\n?/g, '')
    .replace(/<style id="__edit_step_reset__">[\s\S]*?<\/style>\n?/g, ''))
}



export function stripEditScript(html: string): string {
  return ensureStandaloneNavScript(stripEditLayer(html))
}

export function exportSlidesHtml(html: string): string {
  return normalizeDeckHtmlForExport(stripEditScript(html))
}

export function playSlidesHtml(html: string): string {
  return withPlayStepReset(withMediaResignScript(injectFontLinks(exportSlidesHtml(html))))
}



export function sanitizeSvgAutoAttributes(html: string): string {
  if (!html) return html
  return html.replace(/(<svg\b[^>]*?)\s(width|height)=(["'])auto\3/gi, '$1')
}

export function extractSlides(html: string): Slide[] {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    let els = doc.querySelectorAll('section.slide')
    if (els.length === 0) els = doc.querySelectorAll('div.slide')
    if (els.length === 0) els = doc.querySelectorAll('[class*="slide"]:not(style):not(script)')
    if (els.length === 0) return [{ title: slideTitleLabel('bf_aislides_deck_fallback'), index: 0, fallback: true }]
    return Array.from(els).map((el, i) => ({ title: el.getAttribute('data-title') || slideTitleLabel('bf_slides_page_n').replace('{n}', String(i + 1)), index: i }))
  } catch { return [{ title: slideTitleLabel('bf_aislides_deck_fallback'), index: 0, fallback: true }] }
}

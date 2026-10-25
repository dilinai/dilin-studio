// 沙盒框里的图／影片网址过期时向父页要新网址的自救脚本（注进编辑框与放映框）＋父页那头的收发。
export const MEDIA_RESIGN_REQUEST = 'mediaResignRequest'
export const MEDIA_RESIGNED = 'mediaResigned'

export const MEDIA_RESIGN_SCRIPT_ID = '__media_resign__'

export const VIDEO_STALL_MS = 3000

type VideoLike = { paused: boolean; ended: boolean; readyState: number; currentTime: number }

export function videoPlayingSmoothly(v: VideoLike): boolean {
  return !v.paused && !v.ended && v.readyState >= 3
}

export function videoStallLooksBroken(t0: number, v: VideoLike): boolean {
  return v.currentTime === t0 && v.readyState < 3 && !v.ended
}

export const MEDIA_RESIGN_FRAME_SCRIPT = `<script id="${MEDIA_RESIGN_SCRIPT_ID}">
(function(){
  if(window.__mrsOn) return; window.__mrsOn=1;
  function canon(el){
    if(!el||!el.getAttribute) return null;
    var tg=el.tagName; if(tg!=='IMG'&&tg!=='VIDEO') return null;
    var u=el.getAttribute('data-src'); return (u&&/^https?:\\/\\//i.test(u))?u:null;
  }
  function broken(el){
    if(el.tagName==='IMG') return !!el.complete&&!(el.naturalWidth>0)&&!!el.getAttribute('src');
    return !!el.error;
  }
  function smooth(el){ return !el.paused&&!el.ended&&el.readyState>=3; }
  function ask(el){
    var u=canon(el); if(!u) return;
    if(el.__mrsAsked) return;
    el.__mrsAsked=1;
    try{ window.parent.postMessage({type:'${MEDIA_RESIGN_REQUEST}',src:u},'*'); }catch(_){}
  }
  document.addEventListener('error',function(e){ ask(e.target); },true);
  function ok(e){ var el=e.target; if(el&&el.__mrsAsked&&canon(el)) el.__mrsAsked=0; }
  document.addEventListener('load',ok,true);
  document.addEventListener('loadeddata',ok,true);
  function unstall(el){ if(el.__mrsStallT){ try{ window.clearTimeout(el.__mrsStallT); }catch(_){} el.__mrsStallT=0; } }
  function stall(e){
    var el=e.target; if(!el||el.tagName!=='VIDEO'||!canon(el)||el.__mrsStallT) return;
    var t0=el.currentTime;
    el.__mrsStallT=window.setTimeout(function(){
      el.__mrsStallT=0;
      if(el.currentTime===t0&&el.readyState<3&&!el.ended) ask(el);
    },${VIDEO_STALL_MS});
  }
  document.addEventListener('stalled',stall,true);
  document.addEventListener('waiting',stall,true);
  function swap(el,s){
    if(el.tagName!=='VIDEO'){ el.setAttribute('src',s); return; }
    unstall(el);
    var t=el.currentTime||0, play=!el.paused&&!el.ended;
    el.setAttribute('src',s);
    if(t>0||play){
      var h=function(){ el.removeEventListener('loadedmetadata',h); try{ if(t>0) el.currentTime=t; }catch(_){} if(play&&el.play){ var p=el.play(); if(p&&p.catch) p.catch(function(){}); } };
      el.addEventListener('loadedmetadata',h);
    }
  }
  window.addEventListener('message',function(e){
    var d=e.data; if(!d||d.type!=='${MEDIA_RESIGNED}'||!d.urls||typeof d.urls!=='object') return;
    if(e.source!==window.parent) return;
    var els=document.querySelectorAll('img[data-src],video[data-src]');
    for(var i=0;i<els.length;i++){
      var el=els[i], u=canon(el); if(!u) continue;
      var s=d.urls[u]; if(typeof s!=='string'||!s||el.getAttribute('src')===s) continue;
      var bad=broken(el);
      if(el.tagName==='IMG'){ if(!bad&&el.complete&&el.naturalWidth>0) continue; }
      else if(!bad&&smooth(el)) continue;
      swap(el,s);
    }
  });
})();
</script>`

export function withMediaResignScript(html: string): string {
  if (!html || html.includes(`id="${MEDIA_RESIGN_SCRIPT_ID}"`)) return html
  return html.includes('</body>') ? html.replace(/<\/body>(?![\s\S]*<\/body>)/, MEDIA_RESIGN_FRAME_SCRIPT + '\n</body>') : html + MEDIA_RESIGN_FRAME_SCRIPT
}

export function stripMediaResignScript(html: string): string {
  return html.replace(new RegExp(`<script id="${MEDIA_RESIGN_SCRIPT_ID}">[\\s\\S]*?<\\/script>\\n?`, 'g'), '')
}

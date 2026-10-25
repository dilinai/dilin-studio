/**
 * 作者程序的沙盒页「断网」规则（简报程序动画·网页剪辑程序片段共用）。
 *
 *   来由：剪辑程序片段先发现——只有 sandbox="allow-scripts"（opaque origin）挡不住打外网：
 *   fetch／XHR／WebSocket／外链图字档照样出得去；WebRTC 不归 CSP 管（能绕 connect-src）。
 *   简报程序动画也要同等措施 ⇒ 抽到这里两边共用。
 *
 *   用法：放在整份文件 <head> 最前面（<meta charset> 之后、任何作者 css／html 之前）：
 *     · CSP 用 <meta http-equiv>：作者在后面再写一张 CSP 只会「叠加」（两张都要过＝只能更严）、松不开；
 *     · 守卫脚本比作者程序先跑，把 RTC 建构子拿掉、把子框 contentWindow／contentDocument 封成 null（都不可再改）。
 *   已知管不到（报告里写明）：框自己导到别的网址（location／<meta refresh>／点连结）——CSP 没有管自身导航的指令
 *   （Chrome 155 对 navigate-to／webrtc 两个指令都报「Unrecognized」）。
 *   宿主那一侧补「盯 load」：程序框第一次载入之后又触发 load＝它把自己导走了 ⇒ 当场换回静态
 *   （放映产物＝PROGRAM_FRAME_WATCH_SCRIPT；编辑画布＝render.tsx ProgramView）。⚠️ 那一笔导航请求在 load 之前就已经送出——
 *   盯 load 只能「第一笔之后不再有」，挡不住第一笔；导到 data: 新文件那一下，新文件在 load 之前也跑得到一小段（新 global 有 RTC）。
 * 纯字串常量·客户端／服务端共用。
 */

/** WebRTC 不归 CSP 管（能绕开 connect-src 打外网）⇒ 程序跑之前先拿掉 RTC 那几只建构子；
 *  另封子框的 contentWindow／contentDocument（免得开个空白子框从它身上再拿一份 RTC）。都设成不可再改。 */
export const PROGRAM_NET_GUARD = `<script>(function(){var d=function(o,k,v){try{Object.defineProperty(o,k,{value:v,writable:false,configurable:false})}catch(e){}};['RTCPeerConnection','webkitRTCPeerConnection','RTCDataChannel','RTCIceCandidate','RTCSessionDescription'].forEach(function(k){d(window,k,undefined)});try{var P=HTMLIFrameElement.prototype;Object.defineProperty(P,'contentWindow',{get:function(){return null},configurable:false});Object.defineProperty(P,'contentDocument',{get:function(){return null},configurable:false})}catch(e){}})()</script>`

/** 简报程序动画另加：Worker／SharedWorker 建构子也拿掉（CSP worker-src 'none' 已拒·这层是纵深）。 */
export const PROGRAM_WORKER_GUARD = `<script>(function(){['Worker','SharedWorker'].forEach(function(k){try{Object.defineProperty(window,k,{value:undefined,writable:false,configurable:false})}catch(e){}})})()</script>`

/**
 * 自己导到作者拼的 blob: 文件 ⇒ 新 global 里 RTC／Worker 建构子又回来了（守卫只在原文件跑过）。
 * 这层把 URL.createObjectURL 收窄成只给图（不含 svg）／影音／字档的 Blob——作者拼不出能当网页载入的 blob: 网址。
 * MediaSource 等非 Blob 物件照放。⚠️ 管不到 data: 网址（location 不可改写）——那条靠宿主盯 load 换回静态。
 */
export const PROGRAM_BLOB_GUARD = `<script>(function(){var ok=/^(image\\/(png|jpe?g|gif|webp|avif|bmp|x-icon|vnd\\.microsoft\\.icon)|audio\\/[\\w.+-]+|video\\/[\\w.+-]+|font\\/[\\w.+-]+)$/i;[window.URL,window.webkitURL].forEach(function(U){try{if(!U||!U.createObjectURL||U.createObjectURL.__sk)return;var o=U.createObjectURL;var f=function(b){if(typeof Blob!=='undefined'&&b instanceof Blob&&!ok.test(String(b.type||'')))throw new TypeError('blocked: only image/audio/video/font blobs');return o.call(U,b)};f.__sk=1;Object.defineProperty(U,'createObjectURL',{value:f,writable:false,configurable:false})}catch(e){}})})()</script>`

/**
 * 简报程序动画的 CSP：一律不准连网（fetch／XHR／WebSocket／EventSource／外链图字档／预取全拒）·不准开 Worker 与子框·
 * 只准页内脚本与样式、data:／blob: 的图与影音、data: 字档。
 * 程序组件现在没有「引用云盘图／外部图」的路（编辑面板、MCP 说明都只给 HTML＋JS／canvas；图要用就嵌成 data:）⇒ 不开任何外部来源白名单。
 */
export const SLIDES_PROGRAM_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  'media-src data: blob:',
  "connect-src 'none'",
  "worker-src 'none'",
  "child-src 'none'",
  "frame-src 'none'",
  // Chrome 认得的另一个开框指令也明写（不靠 frame-src 后备）；navigate-to／webrtc Chrome 155 不认·不写（只会多一行警告）
  "fenced-frame-src 'none'",
  "object-src 'none'",
  "manifest-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ')

/** 简报程序动画 iframe 文件 <head> 开头那一段（CSP＋关 DNS 预取＋网路守卫＋Worker 守卫）——⛔ 往它前面塞任何东西 */
export const SLIDES_PROGRAM_HEAD_GUARD =
  `<meta http-equiv="Content-Security-Policy" content="${SLIDES_PROGRAM_CSP}">`
  + '<meta http-equiv="x-dns-prefetch-control" content="off">'
  + PROGRAM_NET_GUARD
  + PROGRAM_WORKER_GUARD
  + PROGRAM_BLOB_GUARD

/**
 * 载完前就导走：只靠「第几次 load」分不出——作者在 srcdoc 载完之前就 location 导走 ⇒ 原文件的 load 根本不来，
 *   来的第一个 load 是导过去那页的，被当成「我们发起的正当载入」放过（框留 allow-scripts·翻页回来再送第二笔）。
 * 改成「载完回暗号」：宿主每次把程序框放成 allow-scripts 时，往 srcdoc 最前面（<meta charset> 之后·任何作者内容之前）塞这段脚本，
 *   带一次性随机暗号；它先把自己从 DOM 拿掉（作者码读不到暗号）、在原文件真的 load（isTrusted·作者 dispatch 的假 load 不算）时把暗号回给宿主。
 *   宿主那次 load 之后 PROGRAM_ALIVE_WAIT_MS 内没收到这个暗号 ⇒ 那次 load 不是原文件的＝载完前就导走 ⇒ 换回静态、记一笔。
 *   判定还没出来时宿主要重载（翻页）⇒ 先排着、判定出来再做（⛔ 没判定就放回 allow-scripts＝翻页回来又送一笔）。
 *   作者自己挡掉 window load（stopImmediatePropagation）只会把自己判成导走（回静态）·不会放过。
 */
export const PROGRAM_ALIVE_ID = '__sk_alive__'
export const PROGRAM_ALIVE_WAIT_MS = 2000
/*
 * 简报程序计时闸：同一段也是计时闸的「可信前置脚本」——暗号兼世代 gen，
 *   另把它交给守卫：Object.defineProperty(window,'__dlgen',{value:k,configurable:true})（守卫第一步读走并 delete）。
 *   组装层逐字核「文件开头到 CSP meta」＝这段模板＋gen（slide-kit/components/program-assemble.ts）⇒ 改这两行要连那边的题一起看。
 */
export const ALIVE_HEAD = `<script id="${PROGRAM_ALIVE_ID}">(function(){var s=document.currentScript;if(s&&s.parentNode)s.parentNode.removeChild(s);var P=window.parent,k="`
export const ALIVE_TAIL = `";try{Object.defineProperty(window,"__dlgen",{value:k,configurable:true})}catch(x){}window.addEventListener("load",function(e){if(!e||e.isTrusted!==true)return;try{P.postMessage({__dlp:1,type:"alive",k:k},"*")}catch(x){}})})()</script>`
const ALIVE_TAG = /<script id="__sk_alive__">[\s\S]*?<\/script>/g

/** 一次性暗号（只用 [0-9a-z]） */
export function programAliveNonce(): string {
  let s = ''
  try { const a = new Uint32Array(4); globalThis.crypto.getRandomValues(a); for (const x of a) s += x.toString(36) } catch { /* 没有 crypto */ }
  while (s.length < 16) s += Math.floor(Math.random() * 0x7fffffff).toString(36)
  return s
}
/** srcdoc 里拿掉回暗号脚本（存档／补护时用：暗号只在这次载入有效） */
export function stripProgramAliveProbe(doc: string): string {
  // 避免近二次方：只在最后一个 </script> 以前换——每一处都以某个 </script> 收尾·结果同整份换；
  //   ⛔ 整份换：最后一个 </script> 后面每个没收尾的 <script id="__sk_alive__"> 都重扫到档尾
  const cut = doc.lastIndexOf('</script>')
  if (cut < 0) return doc
  return doc.slice(0, cut + 9).replace(ALIVE_TAG, '') + doc.slice(cut + 9)
}
/**
 * 回暗号脚本塞在哪：结果同 `(/<meta\s+charset[^>]*>/i.exec(d) || /<head\b[^>]*>/i.exec(d))` 的收尾（都没有＝0）。
 * 近二次方：⛔ 直接用那两条——每个没收尾的 <meta charset／<head 都重扫到档尾。
 *   改：先找第一个起点、再找它后面第一个 >；第一个起点后面没有 > ⇒ 后面的起点也不会有（各起点互不重叠）⇒ 整条没中。
 *   放映产物里内嵌的同一套（PROGRAM_FRAME_WATCH_SCRIPT 的 at0）逐字照这里写。
 */
function aliveProbeAt(d: string): number {
  for (const re of [/<meta\s+charset/i, /<head\b/i]) {
    const m = re.exec(d)
    if (!m) continue
    const gt = d.indexOf('>', m.index + m[0].length)
    if (gt >= 0) return gt + 1
  }
  return 0
}
/** srcdoc 最前面（<meta charset> 之后·没有就 <head> 之后·再没有就最前面）塞回暗号脚本（先拿掉旧的） */
export function injectProgramAliveProbe(doc: string, k: string): string {
  if (!/^[0-9a-z]+$/.test(k)) throw new Error('bad alive nonce')
  const d = stripProgramAliveProbe(doc)
  const at = aliveProbeAt(d)
  return d.slice(0, at) + ALIVE_HEAD + k + ALIVE_TAIL + d.slice(at)
}

/**
 * 计时闸：程序框被停下时盖在框上的那句（放映产物的盯 load 脚本与网站页面的 ProgramView 共用·program-assemble 的提示表也引这份）。
 * hang＝框内守卫判连续占用太久；guard＝守卫没装上或 2 秒内没回「装好了」；stuck＝顶层看门狗（B 层）3 秒没收到心跳、重建放映后留静态；
 * nav＝盯 load 判它自己导走了（含载完前就导走）——⛔ 再写成「卡住了」（导走后心跳当然停·B 层以前把它当卡住重建）。
 */
export const PROGRAM_STOP_NOTICE = {
  hang: { 'zh-TW': '這段程序跑太久沒停，已換成靜態', 'zh-CN': '这段程序跑太久没停，已换成静态', en: 'This program ran too long without pausing; switched to a still image' },
  guard: { 'zh-TW': '程序的保護沒裝上，播放不了', 'zh-CN': '程序的保护没装上，播放不了', en: 'The program safety check did not start; not playing' },
  stuck: { 'zh-TW': '這段程序卡住了，已換成靜態', 'zh-CN': '这段程序卡住了，已换成静态', en: 'This program got stuck; switched to a still image' },
  nav: { 'zh-TW': '這段動畫想打開別的網頁，已被擋下，先顯示靜止畫面。', 'zh-CN': '这段动画想打开别的网页，已被挡下，先显示静止画面。', en: 'This animation tried to open another web page. It was blocked, so a still image is shown.' },
} as const
export type ProgramStopWhy = keyof typeof PROGRAM_STOP_NOTICE

// 放进 <script> 里的 JS 字串字面量（⛔ 出现 </script 把外层脚本截断）
const jsStr = (v: string) => JSON.stringify(v).replace(/<\//g, '<\\/')

/**
 * 自身导航：放映产物（整份 deck html）<head> 里的「盯 load」脚本——
 *   要在任何程序 iframe 之前（document 捕获阶段收 load：iframe 的 load 不冒泡、但捕获阶段看得到）。
 *   每个 iframe[data-sk-prog]：
 *     · __skBusy：我们（解析时的首载／宿主重载）发起的那次载入还没完 ⇒ 这一次 load 是我们的；
 *     · 宿主要重载（放映执行器换 sandbox 进页／离页）一律走 window.__skProgWatch.reload(el)：上一次还没载完就先记着、载完再重载
 *       （⛔ 两次载入叠在一起——Chrome 下叠了会多出一次 load·分不清哪次是导航）；
 *     · 重载成 allow-scripts 时 srcdoc 带回暗号脚本（见上）：那次 load 后等不到暗号＝载完前就导走 ⇒ 同下；
 *     · 不是我们发起的 load＝程序把自己导走了（location／meta refresh／点连结／blob:／data:）⇒ 当场 sandbox=""＋重设 srcdoc（回静态·作者码不跑）、
 *       标 __skBlocked（这次放映里不再放回 allow-scripts）、记一笔（window.__skProgNavLog＋console.warn）、标 data-sk-prog-static="nav"＋框上盖一句原因；
 *     · A 层封下的（nav／hang／guard）一律往上一层（网站页面的放映器）报 {__dlp:1,type:'sealed',id,why}——
 *       宿主把它并进这次放映的封锁名单（与 B 层判卡住共用一份），B 层不再盯它（⛔ 当卡住重建），别的框触发重建时它照样留静态
 *       （⛔ 重建＝新元素·__skBlocked 跟着丢·翻回该页又放成 allow-scripts＝再送一笔）。没有上一层（离线下载档在顶层开）＝不报。
 *   ⚠️ 界线：导航请求在 load 之前就送出了 ⇒ 每个框第一笔挡不住（之后不再有）；解析时就是 allow-scripts 的框（没过补护的）首载没有暗号可核；
 *   sandbox="" 的静态框 Chrome 不执行 meta refresh。
 */
export const PROGRAM_FRAME_WATCH_SCRIPT = '<script id="__sk_progwatch__">' + [
  '(function(){if(window.__skProgWatch)return;',
  `var log=window.__skProgNavLog=[],stops=window.__skProgStopLog=[],fr=[],AH=${jsStr(ALIVE_HEAD)},AT=${jsStr(ALIVE_TAIL)},WAIT=${PROGRAM_ALIVE_WAIT_MS},TX=${jsStr(JSON.stringify(PROGRAM_STOP_NOTICE))};`,
  "function prog(el){return !!(el&&el.tagName==='IFRAME'&&el.hasAttribute&&el.hasAttribute('data-sk-prog'))}",
  "function nonce(){var s='';try{var a=new Uint32Array(4);window.crypto.getRandomValues(a);for(var i=0;i<4;i++)s+=a[i].toString(36)}catch(e){}while(s.length<16)s+=Math.floor(Math.random()*2147483647).toString(36);return s}",
  // strip／inject 与上面 stripProgramAliveProbe／aliveProbeAt 同一写法（有界·结果同旧整串正则）——⛔ 两份分开改
  "function strip(d){var c=d.lastIndexOf('<\\/script>');return c<0?d:d.slice(0,c+9).replace(/<script id=\"__sk_alive__\">[\\s\\S]*?<\\/script>/g,'')+d.slice(c+9)}",
  "function at0(d){var R=[/<meta\\s+charset/i,/<head\\b/i];for(var i=0;i<2;i++){var m=R[i].exec(d);if(!m)continue;var g=d.indexOf('>',m.index+m[0].length);if(g>=0)return g+1}return 0}",
  'function inject(d,k){var at=at0(d);return d.slice(0,at)+AH+k+AT+d.slice(at)}',
  // 计时闸：放成 allow-scripts 的那次要两样都到——前置脚本的暗号（载完·没导走）＋守卫的 guard_ready（守卫装上了·世代＝暗号）
  'function ok(el,k){return !!(el.__skOk&&el.__skOk[k]&&el.__skRdy&&el.__skRdy[k])}',
  // 真正重设 srcdoc：放成 allow-scripts 的那次带一次性暗号
  "function arm(el){var d=el.__skDoc0;if(d===undefined){d=el.getAttribute('srcdoc');if(d!==null)d=strip(d);el.__skDoc0=d}if(d===null)return;var k=null;if(el.getAttribute('sandbox')==='allow-scripts'){k=nonce();(el.__skKs||(el.__skKs={}))[k]=1;if(fr.indexOf(el)<0)fr.push(el)}el.__skK=k;el.__skG=k;el.setAttribute('srcdoc',k?inject(d,k):d)}",
  // A 层封下的往上一层报（宿主并进封锁名单·B 层不再盯·重建后照样静态）；没有上一层＝不报
  "function up(el,why){try{var P=window.parent;if(P&&P!==window)P.postMessage({__dlp:1,type:'sealed',id:el.getAttribute('data-sk-prog'),why:why},'*')}catch(x){}}",
  "function flag(el){el.__skBlocked=(el.__skBlocked||0)+1;el.__skRun=false;var id=el.getAttribute('data-sk-prog');log.push({id:id,at:Date.now()});try{console.warn('[dilinai] program animation \"'+id+'\" navigated itself away; switched back to static')}catch(x){}var p=el.__skp;if(p){p.ready=false;p.cur=0;p.n=0}el.setAttribute('sandbox','');if(el.getAttribute('data-sk-prog-static')!=='nav'){el.setAttribute('data-sk-prog-static','nav');note(el,'nav')}up(el,'nav')}",
  // 判定还没出来（__skChk）⇒ 先排着
  'function reload(el){if(el.__skChk||el.__skBusy!==false){el.__skPend=true;return}el.__skBusy=true;arm(el)}',
  'function pend(el){if(el.__skPend){el.__skPend=false;reload(el)}}',
  'function block(el){el.__skPend=false;el.__skChk=null;flag(el);reload(el)}',
  // 计时闸：守卫判停（hang）／守卫没装上（guard）⇒ 这次放映里留静态＋框上盖一句原因（语言照 <html lang>）
  "function lang(){var l=String((document.documentElement&&document.documentElement.lang)||'').toLowerCase();return l==='zh-cn'||l==='zh-hans'?'zh-CN':l.indexOf('en')===0?'en':'zh-TW'}",
  "function note(el,why){try{var t=JSON.parse(TX)[why][lang()],p=el.parentNode;if(!p||!document.createElement)return;var o=p.querySelector&&p.querySelector('[data-sk-prog-notice]');if(o)o.parentNode.removeChild(o);var n=document.createElement('div');n.setAttribute('data-sk-prog-notice',why);n.setAttribute('style','position:absolute;left:6px;bottom:6px;z-index:1;max-width:calc(100% - 12px);padding:3px 8px;border-radius:6px;background:rgba(15,23,42,0.78);color:#F8FAFC;font:500 12px/1.4 system-ui,sans-serif;pointer-events:none');n.textContent=t;p.appendChild(n)}catch(x){}}",
  "function stop(el,why){if(el.__skStop)return;el.__skStop=why;el.__skBlocked=(el.__skBlocked||0)+1;el.__skRun=false;stops.push({id:el.getAttribute('data-sk-prog'),why:why,at:Date.now()});try{console.warn('[dilinai] program animation \"'+el.getAttribute('data-sk-prog')+'\" stopped ('+why+'); switched to static')}catch(x){}var p=el.__skp;if(p){p.ready=false;p.cur=0;p.n=0}el.setAttribute('sandbox','');el.setAttribute('data-sk-prog-static',why);note(el,why);up(el,why);el.__skPend=false;el.__skChk=null;reload(el)}",
  'window.__skProgWatch={reload:reload,log:log};',
  // alive{k}（前置脚本·载完）／guard_ready{g}（守卫装好）：只认这框发过的暗号；hang／guard_failed{g}：只认这框当前世代（换过的旧世代一律丢）
  "window.addEventListener('message',function(e){var d=e&&e.data;if(!d||d.__dlp!==1)return;var ty=d.type;",
  "if(ty==='alive'||ty==='guard_ready'){var k=ty==='alive'?d.k:d.g;if(typeof k!=='string')return;for(var i=0;i<fr.length;i++){var f=fr[i];if(e.source!==f.contentWindow||!f.__skKs||!f.__skKs[k])continue;if(ty==='alive')(f.__skOk||(f.__skOk={}))[k]=1;else(f.__skRdy||(f.__skRdy={}))[k]=1;if(f.__skChk===k&&ok(f,k)){f.__skChk=null;pend(f)}}return}",
  "if(ty==='hang'||ty==='guard_failed'){if(typeof d.g!=='string')return;for(var j=0;j<fr.length;j++){var g=fr[j];if(e.source===g.contentWindow&&g.__skG===d.g&&g.getAttribute('sandbox')==='allow-scripts')stop(g,ty==='hang'?'hang':'guard')}}});",
  "document.addEventListener('load',function(e){var el=e.target;if(!prog(el))return;",
  'if(el.__skBusy!==false){el.__skBusy=false;var k=el.__skK;el.__skK=null;',
  // 等不到：连暗号都没有＝载完前就导走（同导航）；有暗号没 guard_ready＝守卫没装上（静态＋原因）
  'if(k&&!ok(el,k)){el.__skChk=k;setTimeout(function(){if(el.__skChk!==k)return;el.__skChk=null;if(el.__skOk&&el.__skOk[k])stop(el,"guard");else block(el)},WAIT);return}',
  'pend(el);return}',
  'block(el)},true)})()',
].join('') + '</script>'

/**
 * 简报程序动画「死循环计时闸」·框内守卫。
 *
 * 守卫正文对同一 POLICY_VERSION 逐字固定（检查名 K 也是政策常量）⇒ CSP hash 在这里算定、进固定名单；
 * 世代暗号 gen 由 CSP meta 之前的可信前置脚本交接（window.__dlgen·configurable）·守卫第一步读走并 delete。
 * 守卫在作者码之前跑，依序：
 *   ① 读走 gen（不合 ^[0-9a-z]{16,32}$ ⇒ 装不上）；封存要用的原生（performance.now、MessageChannel 与端口 postMessage、
 *      addEventListener、Reflect.apply／construct、Object.defineProperty／getOwnPropertyDescriptor）；
 *   ② 计量状态机：L＝上次检查时刻（未开始＝null·⛔ 0 当哨兵）、B＝累计占用、A＝私有清零讯息已送出未处理、X＝已停；
 *      检查：X ⇒ 抛；L===null ⇒ 起算（L=t、B=0、未送就送私有讯息）不计入；否则 B+=min(t−L,200)、L=t；B>1000 ⇒ X、发 hang、抛。
 *      私有讯息被处理（端口在闭包里·作者拿不到）、可信生命期事件（pageshow、resume·isTrusted）、或「从隐藏回到前景」⇒ 清零。
 *      前景判定读 Document.prototype.hidden 的原生 getter（守卫装时封存·作者改 document.hidden 改不到）：每次检查看一次、守卫另每 250ms 看一次。
 *      ⛔ 挂 visibilitychange／pagehide／unload（Chrome 155：框里挂了这三种之一，框卡死后宿主拿掉它，Chrome 要等它跑完离开事件，
 *      这期间新的同站程序框被塞进这个卡住的程序、一直载不起来 ⇒ B 层「换掉」不可达）。
 *   ②b 作者挂的同三种也拦：visibilitychange（addEventListener／document.onvisibilitychange）改挂成私有事件名（原生 addEventListener·
 *      once／signal／passive／去重照原生）、前景变化时由那个 250ms 计时对 document 原生 dispatchEvent 一个 bubbles 的私有事件（type 读起来＝visibilitychange）
 *      ⇒ capture／bubble 路径（document→window）、target／currentTarget／this、stopPropagation、例外回报都走 DOM。
 *      已知差异：isTrusted=false；document.onvisibilitychange 一律排在 document 上非 capture 监听的最前（原生按第一次设值的先后）；
 *      作者自己 dispatchEvent('visibilitychange') 到不了这些监听。pagehide／unload（addEventListener、window／body／frameset 的 on 属性）丢掉不挂——程序框只会被宿主整个拿掉，用不到。
 *   ③ 包住会排微任务的公开口：Promise 静态／原型方法、queueMicrotask（方法简写·不可 new·Reflect.apply 原样转·length／name 设回·
 *      只包环境里真有的）；MutationObserver 建构子（回调先过检查·new.target／prototype／constructor 照原）。
 *   ④ B 层应答：只认 e.source===top 的可信 ping{ch,epoch} ⇒ top.postMessage beat{ch,epoch,g}（已停就不回）；装好先给 top 一声 hello{g}、
 *      停下时另给 top 一声 stopped{g}（顶层不再盯这框·免得 A 层自己停下的框被 B 层当卡住）。
 *   ⑤ 定义 Object.prototype[K]＝检查（不可写不可配置）并读回核；
 *   任一步抛错 ⇒ 清空 documentElement、回 guard_failed（后面的作者 script 因为叫不到检查会当场 TypeError）；成功 ⇒ 回 guard_ready。
 * 送给外层的讯号都带 __dlp:1 与 g（gen）·一律整个物件字面量（⛔ 先建再赋值——会撞作者在 Object.prototype 上挂的 setter）。
 * 纯字串常量·客户端／服务端共用。
 */
import { PROGRAM_CHECK_NAME, cspSha256 } from './program-source'

export const PROGRAM_GUARD_CAP_MS = 200
export const PROGRAM_GUARD_LIMIT_MS = 1000
/** 世代暗号格式（前置脚本交接·alive 暗号同一个） */
export const PROGRAM_GEN_RE = /^[0-9a-z]{16,32}$/
export const PROGRAM_GEN_PROP = '__dlgen'
export const PROGRAM_STOP_MESSAGE = 'dilinai: program stopped (ran too long without yielding)'

/** 守卫正文（<script> 里面那段·hash 对它算） */
export const PROGRAM_GUARD_JS = [
  "(function(){'use strict';",
  'var W=window,O=Object,OP=O.prototype,dp=O.defineProperty,gd=O.getOwnPropertyDescriptor,gp=O.getPrototypeOf,',
  `RA=Reflect.apply,RC=Reflect.construct,E=Error,TE=TypeError,NM=${JSON.stringify(PROGRAM_CHECK_NAME)},gen='',P=null,T=null,D=null;`,
  "function bad(){try{D.documentElement.innerHTML=''}catch(x){}try{P.postMessage({__dlp:1,type:'guard_failed',g:gen},'*')}catch(x){}}",
  'try{P=W.parent;T=W.top;D=W.document;',
  `var gv=gd(W,${JSON.stringify(PROGRAM_GEN_PROP)});if(gv&&typeof gv.value==='string')gen=gv.value;delete W.${PROGRAM_GEN_PROP};`,
  `if(!${PROGRAM_GEN_RE.toString()}.test(gen))throw 0;`,
  "var PF=W.performance,PN=PF&&PF.now,MC=W.MessageChannel,AEL=W.addEventListener;",
  "if(typeof PN!=='function'||typeof MC!=='function'||typeof AEL!=='function')throw 0;",
  'var now=function(){return RA(PN,PF,[])};',
  'var mc=new MC(),p1=mc.port1,p2=mc.port2,PM=p2.postMessage;',
  `var L=null,B=0,A=false,X=false,HP=0,CAP=${PROGRAM_GUARD_CAP_MS},LIM=${PROGRAM_GUARD_LIMIT_MS};`,
  // 停下讯号：在很深的递归里判停时 postMessage 本身可能爆栈（Chrome 下 try/catch 递归收不到 hang）⇒ 没送成就记着，下次检查／250ms 计时补送
  "var sendStop=function(){try{P.postMessage({__dlp:1,type:'hang',g:gen},'*');HP&=2}catch(x){HP|=1}try{T.postMessage({__dlp:1,type:'stopped',g:gen},'*');HP&=1}catch(x){HP|=2}};",
  'var clr=function(){L=null;B=0;A=false};',
  'var chk=function(){',
  `if(X){if(HP)sendStop();throw new E(${JSON.stringify(PROGRAM_STOP_MESSAGE)})}`,
  'vis();var t=now();',
  'if(L===null){L=t;B=0;if(!A){A=true;RA(PM,p2,[0])}return}',
  'var d=t-L;if(d>CAP)d=CAP;else if(!(d>0))d=0;',
  'B+=d;L=t;',
  "if(B>LIM){X=true;HP=3;sendStop();",
  `throw new E(${JSON.stringify(PROGRAM_STOP_MESSAGE)})}};`,
  // 可信生命期事件清零（作者 dispatch 的假事件 isTrusted=false·不算）；⛔ visibilitychange（见档头）
  "var life=function(e){if(!e||e.isTrusted!==true)return;if(!X)clr()};",
  "RA(AEL,W,['pageshow',life,true]);RA(AEL,W,['resume',life,true]);",
  // 前景判定（原生 getter）＋作者 visibilitychange 代发
  "var DP=W.Document&&W.Document.prototype,hd=DP&&gd(DP,'hidden'),HG=hd&&hd.get,SI=W.setInterval,ST=W.setTimeout,EV=W.Event;",
  "if(typeof HG!=='function'||typeof SI!=='function'||typeof ST!=='function'||typeof EV!=='function')throw 0;",
  "var hid=function(){return RA(HG,D,[])===true},HS=hid(),VH=HS,VO=null,DE=null,PV='dlp:visibilitychange';",
  "var vis=function(){if(hid()){HS=true;return true}if(HS){HS=false;if(!X)clr()}return false};",
  // 代发走原生 dispatchEvent（作者的监听以私有事件名 PV 原生挂着）⇒ once／signal／去重／capture-bubble 路径／target／currentTarget／this／
  //   stopPropagation／例外回报全照 DOM；读得到的 type 盖成 visibilitychange（派发配对用的是内部事件名）。
  "var fire=function(){var ev=new EV(PV,{bubbles:true});dp(ev,'type',{value:'visibilitychange',enumerable:true,configurable:true});RA(DE,D,[ev])};",
  "RA(SI,W,[function(){if(X&&HP)sendStop();var h=vis();if(h!==VH){VH=h;fire()}},250]);",
  // B 层：只认 top 直接发来的可信 ping
  "var ping=function(e){if(X||!e||e.isTrusted!==true||e.source!==T)return;var d=e.data;",
  "if(!d||d.__dlp!==1||d.type!=='ping'||typeof d.ch!=='string'||typeof d.epoch!=='number')return;",
  "try{T.postMessage({__dlp:1,type:'beat',ch:d.ch,epoch:d.epoch,g:gen},'*')}catch(x){}};",
  "RA(AEL,W,['message',ping,true]);",
  // 包公开口
  'var own=function(o,k){while(o){var r=gd(o,k);if(r)return [o,r];o=gp(o)}return null};',
  "var wrap=function(o,k){var h=own(o,k);if(!h||typeof h[1].value!=='function')return;var f=h[1].value,r=h[1];",
  'var w=({[k](...a){chk();return RA(f,this,a)}})[k];',
  "dp(w,'length',{value:f.length,configurable:true});dp(w,'name',{value:f.name,configurable:true});",
  'dp(h[0],k,{value:w,writable:r.writable,enumerable:r.enumerable,configurable:r.configurable})};',
  'var Pr=W.Promise,i,ks;',
  "if(typeof Pr==='function'){ks=['resolve','reject','all','allSettled','any','race','withResolvers','try'];",
  'for(i=0;i<ks.length;i++)if(gd(Pr,ks[i]))wrap(Pr,ks[i]);',
  "ks=['then','catch','finally'];for(i=0;i<ks.length;i++)if(gd(Pr.prototype,ks[i]))wrap(Pr.prototype,ks[i])}",
  "wrap(W,'queueMicrotask');",
  // ②b 拦作者挂的 visibilitychange／pagehide／unload
  "var ETP=W.EventTarget&&W.EventTarget.prototype,ah=ETP&&gd(ETP,'addEventListener'),rh=ETP&&gd(ETP,'removeEventListener'),dh=ETP&&own(ETP,'dispatchEvent');",
  "if(!ah||!rh||!dh||typeof ah.value!=='function'||typeof rh.value!=='function'||typeof dh[1].value!=='function')throw 0;",
  "var A0=ah.value,R0=rh.value,ty=function(t){return typeof t==='symbol'?t:String(t)};DE=dh[1].value;",
  // document.onvisibilitychange：装守卫时先在 document 上原生挂一支（PV）转给 VO（this＝currentTarget＝document）
  "RA(A0,D,[PV,function(e){if(typeof VO==='function')return RA(VO,this,[e])},false]);",
  "var nA=({addEventListener(t,f,o){chk();var s=ty(t);if(s==='visibilitychange')return RA(A0,this,[PV,f,o]);if(s==='pagehide'||s==='unload')return;return RA(A0,this,[s,f,o])}}).addEventListener;",
  "var nR=({removeEventListener(t,f,o){chk();var s=ty(t);if(s==='visibilitychange')return RA(R0,this,[PV,f,o]);return RA(R0,this,[s,f,o])}}).removeEventListener;",
  "dp(nA,'length',{value:A0.length,configurable:true});dp(nR,'length',{value:R0.length,configurable:true});",
  "dp(ETP,'addEventListener',{value:nA,writable:ah.writable,enumerable:ah.enumerable,configurable:ah.configurable});",
  "dp(ETP,'removeEventListener',{value:nR,writable:rh.writable,enumerable:rh.enumerable,configurable:rh.configurable});",
  "var od=DP&&gd(DP,'onvisibilitychange');if(od&&od.configurable)dp(DP,'onvisibilitychange',{get:function(){return VO},set:function(v){VO=typeof v==='function'?v:null},enumerable:od.enumerable,configurable:true});",
  "var nul=function(o,k){var h=own(o,k);if(h&&h[1].configurable&&h[1].set)dp(h[0],k,{get:function(){return null},set:function(){},enumerable:h[1].enumerable,configurable:true})};",
  "nul(W,'onpagehide');nul(W,'onunload');var BP=W.HTMLBodyElement&&W.HTMLBodyElement.prototype,FP=W.HTMLFrameSetElement&&W.HTMLFrameSetElement.prototype;",
  "if(BP){nul(BP,'onpagehide');nul(BP,'onunload')}if(FP){nul(FP,'onpagehide');nul(FP,'onunload')}",
  "var MO=W.MutationObserver,mh=own(W,'MutationObserver');",
  "if(typeof MO==='function'&&mh){var N=function MutationObserver(cb){",
  `if(new.target===undefined)throw new TE("Failed to construct 'MutationObserver': Please use the 'new' operator");`,
  "var w=cb;if(typeof cb==='function')w=function(...a){chk();return RA(cb,this,a)};return RC(MO,[w],new.target)};",
  "dp(N,'length',{value:MO.length,configurable:true});dp(N,'prototype',{value:MO.prototype,writable:false,enumerable:false,configurable:false});",
  "var cr=gd(MO.prototype,'constructor');if(cr)dp(MO.prototype,'constructor',{value:N,writable:cr.writable,enumerable:cr.enumerable,configurable:cr.configurable});",
  "dp(mh[0],'MutationObserver',{value:N,writable:mh[1].writable,enumerable:mh[1].enumerable,configurable:mh[1].configurable})}",
  // 定义检查并读回核
  'dp(OP,NM,{value:chk,writable:false,enumerable:false,configurable:false});',
  'var rb=gd(OP,NM);if(!rb||rb.value!==chk||rb.writable!==false||rb.configurable!==false||rb.enumerable!==false)throw 0;',
  'p1.onmessage=function(){if(!X)clr()};',
  '}catch(x){bad();return}',
  "try{P.postMessage({__dlp:1,type:'guard_ready',g:gen},'*')}catch(x){}",
  // B 层：装好就先跟顶层打一声招呼（作者码还没跑）⇒ 顶层从这一刻起盯这框；之后靠 ping→beat
  "try{T.postMessage({__dlp:1,type:'hello',g:gen},'*')}catch(x){}",
  '})()',
].join('')

/** 守卫的 CSP hash（编译期定·随政策版本） */
export const PROGRAM_GUARD_HASH = cspSha256(PROGRAM_GUARD_JS)

// 组件版 pptx 导出 · 拆不开的程序动画「每一步录成一小段影片」（C3）
//
//   录在哪：就在导出那一页（浏览器）里。程序组件放映时在 opaque origin 的沙盒 iframe 里，父页读不到它的画面 ⇒
//     导出时另开一个同样 sandbox="allow-scripts" 的录制 iframe（照样隔离·程序拿不到本站任何东西），里面除了程序本身，
//     先注一段小运行时（dilinProgram.setSteps／onStep／done·与 program-types PROGRAM_RUNTIME_API 同口）＋录制器：
//       把 requestAnimationFrame 包一层：每一格程序画完、当场把页上最大的那块 canvas 抄进合成画布（WebGL 不留缓冲也抄得到）；
//       合成画布先垫底色（PowerPoint for Windows 不吃透明影片·浏览器也录不出 PowerPoint 认得的透明格式）；
//       合成画布 captureStream(30)＋MediaRecorder 录 MP4（H.264）·录好的 Blob 用 postMessage 传回父页。
//   逐步：先「跳到第 k−1 步的样子」（animate=false）稍等 ⇒ 开录 ⇒ 送「第 k 步」（animate=true）⇒ 等程序回报 stepDone(k)（没回报＝最多录 maxStepMs）⇒ 停。
//   第 1 步开录前另抓一张「第 0 步的样子」当起始画面。
//   限制（写进导出报告）：只录得到 canvas 画的（纯 DOM／CSS 的程序录不了）；浏览器要支援 MediaRecorder 录 MP4（新版 Chrome／Edge／Safari）；
//     透明背景一律垫底色（要 Mac 版 HEVC alpha .mov 得另用 ffmpeg 转）。
//   只在浏览器跑。

import type { ProgramComponentLike } from './pptx-program'
import { SLIDES_PROGRAM_HEAD_GUARD } from '../../shared/program-sandbox'

export type RecordedClip = { bytes: Uint8Array; mime: string; ext: 'mp4'; durationMs: number; timedOut: boolean }
export type RecordResult =
  | { ok: false; reason: 'noCanvas' | 'noMp4' | 'load' | 'noSteps' }
  /** ends[k-1]＝第 k 步结束时的画面（PNG data URL·截不到＝null）：叠在那段影片上、播完那一刻现身（WPS 播下一段会把前面的片打回首帧） */
  | { ok: true; poster: string | null; clips: Array<RecordedClip | null>; ends: Array<string | null>; w: number; h: number }

/** iframe 里的运行时＋录制器（纯 ES5·不依赖任何东西） */
function recorderScript(declaredSteps: number): string {
  return `(function(){
var P=parent,TAG='__dlp';
function post(m){m[TAG]=1;try{P.postMessage(m,'*')}catch(e){}}
var handlers=[],declared=${Math.max(0, Math.floor(declaredSteps) || 0)};
var nativeRaf=window.requestAnimationFrame.bind(window);
var queue=[],scheduled=false,seq=0,rec=null;
function bigCanvas(){var best=null,area=0,l=document.querySelectorAll('canvas');for(var i=0;i<l.length;i++){var r=l[i].getBoundingClientRect(),a=r.width*r.height;if(a>area){area=a;best=l[i]}}return best}
function draw(){if(!rec)return;var g=rec.g,c=rec.cv;g.clearRect(0,0,c.width,c.height);if(rec.bg){g.fillStyle=rec.bg;g.fillRect(0,0,c.width,c.height)}var s=bigCanvas();if(s){var r=s.getBoundingClientRect();try{g.drawImage(s,r.left*rec.kx,r.top*rec.ky,r.width*rec.kx,r.height*rec.ky)}catch(e){}}}
function pump(ts){scheduled=false;var q=queue;queue=[];for(var i=0;i<q.length;i++){try{q[i].fn(ts)}catch(e){}}draw();if(rec)ensure()}
function ensure(){if(!scheduled){scheduled=true;nativeRaf(pump)}}
window.requestAnimationFrame=function(fn){var id=++seq;queue.push({id:id,fn:fn});ensure();return id};
window.cancelAnimationFrame=function(id){queue=queue.filter(function(q){return q.id!==id})};
window.dilinProgram={setSteps:function(n){declared=n;post({type:'steps',steps:n})},onStep:function(fn){handlers.push(fn)},done:function(i){post({type:'stepDone',index:i})}};
window.addEventListener('message',function(e){
if(e.source!==P)return;var d=e.data;if(!d||d[TAG]!==1)return;
if(d.type==='step'){for(var i=0;i<handlers.length;i++){try{handlers[i](d.index,d.animate)}catch(err){}}return}
if(d.type==='recPrep'){
if(!bigCanvas()){post({type:'recErr',reason:'noCanvas'});return}
var ms=['video/mp4;codecs=avc1.640028','video/mp4;codecs=avc1.42E01F','video/mp4;codecs=avc1','video/mp4'],mime=null;
if(window.MediaRecorder&&HTMLCanvasElement.prototype.captureStream){for(var j=0;j<ms.length;j++){if(MediaRecorder.isTypeSupported(ms[j])){mime=ms[j];break}}}
if(!mime){post({type:'recErr',reason:'noMp4'});return}
var cv=document.createElement('canvas');cv.width=d.w;cv.height=d.h;
rec={cv:cv,g:cv.getContext('2d'),kx:d.w/Math.max(1,innerWidth),ky:d.h/Math.max(1,innerHeight),bg:d.bg,mime:mime,mr:null,chunks:[]};
ensure();post({type:'recReady'});return}
if(d.type==='poster'){draw();var u=null;try{u=rec.cv.toDataURL('image/png')}catch(e){}post({type:'poster',data:u});return}
if(d.type==='recStart'){var st=rec.cv.captureStream(30),mr=new MediaRecorder(st,{mimeType:rec.mime,videoBitsPerSecond:8000000});rec.chunks=[];
mr.ondataavailable=function(ev){if(ev.data&&ev.data.size)rec.chunks.push(ev.data)};
mr.onstop=function(){st.getTracks().forEach(function(t){t.stop()});post({type:'clip',blob:new Blob(rec.chunks,{type:'video/mp4'})})};
rec.mr=mr;mr.start(250);post({type:'recStarted'});return}
if(d.type==='recStop'){if(rec&&rec.mr&&rec.mr.state!=='inactive')rec.mr.stop();return}
});
window.addEventListener('load',function(){post({type:'ready'});post({type:'steps',steps:declared})});
})();`
}

const escStyle = (s: string) => s.replace(/<\/style/gi, '<\\/style')

/** 录制用的整份文件（运行时放 head 最前面：程序自己的 <script> 一跑就找得到 dilinProgram） */
export function recorderDoc(p: Pick<ProgramComponentLike, 'html' | 'css' | 'steps'>): string {
  // 录制那份也先套断网规则（与放映同一份·在作者码之前）
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">${SLIDES_PROGRAM_HEAD_GUARD}<script>${recorderScript(p.steps ?? 0)}</script>`
    + `<style>html,body{margin:0;padding:0;background:transparent;overflow:hidden;width:100%;height:100%}</style>`
    + (p.css ? `<style>${escStyle(p.css)}</style>` : '')
    + `</head><body>${p.html}</body></html>`
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)

/**
 * 录一个程序组件的每一步。bg＝合成画布垫的底色（CSS 颜色）。
 * maxStepMs＝程序没回报 stepDone 时一步最多录多久；tailMs＝回报做完后多录一点（停在最后一格）。
 */
export async function recordProgramSteps(p: ProgramComponentLike, opts: { bg: string; maxStepMs?: number; tailMs?: number; settleMs?: number }): Promise<RecordResult> {
  const maxStepMs = opts.maxStepMs ?? 5000
  const tailMs = opts.tailMs ?? 300
  const settleMs = opts.settleMs ?? 400
  const dw = p.designW && p.designW > 0 ? p.designW : p.frame.w
  const dh = p.designH && p.designH > 0 ? p.designH : p.frame.h
  const k = Math.min(2, 1920 / dw, 1080 / dh)
  const W = even(dw * k), H = even(dh * k)
  const ifr = document.createElement('iframe')
  ifr.setAttribute('sandbox', 'allow-scripts')
  ifr.setAttribute('aria-hidden', 'true')
  // 要在可视范围里（跨源 iframe 不在画面上 Chrome 会停它的 requestAnimationFrame）·几乎全透明、点不到
  Object.assign(ifr.style, { position: 'fixed', left: '0', top: '0', width: `${dw}px`, height: `${dh}px`, border: '0', opacity: '0.01', pointerEvents: 'none', zIndex: '2147483000', background: 'transparent' })
  const inbox: Array<Record<string, unknown>> = []
  const waiters: Array<() => void> = []
  const onMsg = (e: MessageEvent) => {
    if (e.source !== ifr.contentWindow) return
    const d = e.data as Record<string, unknown> | null
    if (!d || d.__dlp !== 1) return
    inbox.push(d)
    waiters.splice(0).forEach((w) => w())
  }
  const take = async (pred: (d: Record<string, unknown>) => boolean, ms: number): Promise<Record<string, unknown> | null> => {
    const end = Date.now() + ms
    for (;;) {
      const i = inbox.findIndex(pred)
      if (i >= 0) return inbox.splice(i, 1)[0]
      const left = end - Date.now()
      if (left <= 0) return null
      await new Promise<void>((r) => { const t = setTimeout(r, left); waiters.push(() => { clearTimeout(t); r() }) })
    }
  }
  const send = (m: Record<string, unknown>) => ifr.contentWindow?.postMessage({ ...m, __dlp: 1 }, '*')
  window.addEventListener('message', onMsg)
  try {
    ifr.srcdoc = recorderDoc(p)
    document.body.appendChild(ifr)
    if (!(await take((d) => d.type === 'ready', 10000))) return { ok: false, reason: 'load' }
    await sleep(100)
    // 步数：以程序回报为准（最后一次）
    let steps = Math.max(0, Math.floor(p.steps ?? 0))
    for (const d of inbox.filter((x) => x.type === 'steps')) steps = Math.max(0, Math.floor(Number(d.steps) || 0))
    if (!steps) return { ok: false, reason: 'noSteps' }
    send({ type: 'recPrep', w: W, h: H, bg: opts.bg })
    const prep = await take((d) => d.type === 'recReady' || d.type === 'recErr', 5000)
    if (!prep) return { ok: false, reason: 'load' }
    if (prep.type === 'recErr') return { ok: false, reason: prep.reason === 'noCanvas' ? 'noCanvas' : 'noMp4' }
    let poster: string | null = null
    const clips: Array<RecordedClip | null> = []
    const ends: Array<string | null> = []
    const snap = async () => { send({ type: 'poster' }); const got = await take((d) => d.type === 'poster', 3000); return typeof got?.data === 'string' ? got.data : null }
    for (let s = 1; s <= steps; s++) {
      send({ type: 'step', index: s - 1, animate: false })
      await sleep(settleMs)
      if (s === 1) {
        send({ type: 'poster' })
        const got = await take((d) => d.type === 'poster', 3000)
        poster = typeof got?.data === 'string' ? got.data : null
      }
      send({ type: 'recStart' })
      if (!(await take((d) => d.type === 'recStarted', 3000))) { clips.push(null); ends.push(null); continue }
      const t0 = Date.now()
      inbox.splice(0, inbox.length, ...inbox.filter((d) => d.type !== 'stepDone'))
      send({ type: 'step', index: s, animate: true })
      const done = await take((d) => d.type === 'stepDone' && Number(d.index) === s, maxStepMs)
      await sleep(tailMs)
      send({ type: 'recStop' })
      const durationMs = Date.now() - t0
      const clip = await take((d) => d.type === 'clip', 8000)
      const blob = clip?.blob instanceof Blob ? clip.blob : null
      if (!blob || !blob.size) { clips.push(null); ends.push(null); continue }
      ends.push(await snap())
      clips.push({ bytes: new Uint8Array(await blob.arrayBuffer()), mime: 'video/mp4', ext: 'mp4', durationMs, timedOut: !done })
    }
    return { ok: true, poster, clips, ends, w: W, h: H }
  } finally {
    window.removeEventListener('message', onMsg)
    ifr.remove()
  }
}

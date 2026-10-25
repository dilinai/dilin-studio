// 网页剪辑页·程序片段轨（一种轨道种类）。
// 程序片段＝放在程序轨上的一段（TlClip.program·mediaId 空）：存「哪个程序包＋一组参数」；参数照程序包 manifest 自动长成面板让人改。
// 程序看的秒＝片段自己的秒（片段开头 0）＋offset（剪开后后段 offset＝切点在原段里的秒 ⇒ 接着播；拉片头修剪 offset 归 0）。
// 画法：沙盒 iframe（只给 allow-scripts·无网络、无存储、无同源）载程序包的 index.html，按播放头 postMessage 叫 window.dilinProgram.render(t, params, size)。
// 特效、转场不进程序轨（它们挂在素材上）。本档只放纯函数（题直接跑）；画在 video-edit/page.tsx、VeditAssetTabs.tsx、VeditProgramFrame.tsx。⛔ 碰 DOM。
import { applyDrop, findClip, planDrop, snapFrame, type ProgramBody, type TlClip, type Tracks } from './timeline.pure'
import { PROGRAM_NET_GUARD } from '../../shared/program-sandbox'

export type L10n = string | { tw: string; cn: string; en: string }
export type ProgramParamValue = string | number | boolean
export type ProgramParamSpec =
  | { key: string; label: L10n; type: 'text'; default: string }
  | { key: string; label: L10n; type: 'color'; default: string }
  | { key: string; label: L10n; type: 'number'; default: number; min?: number; max?: number; step?: number }
  | { key: string; label: L10n; type: 'select'; default: string; options: Array<string | { value: string; label: L10n }> }
  | { key: string; label: L10n; type: 'bool'; default: boolean }
export type ProgramManifest = { name: L10n; version: string; engine: 'html'; entry: string; defaultLength: number; alpha: boolean; params: ProgramParamSpec[] }
/** 一个能用的程序包：html＝入口页（资源已内嵌成 data: 网址）；builtin＝网站自带 */
export type ProgramBundle = { id: string; manifest: ProgramManifest; html: string; builtin: boolean }

export const PROGRAM_DRAG_MIME = 'application/x-dilin-vedit-program'
/** 使用者上传的程序包清单（本机）·包本体存 OPFS g-<id>.json */
export const VEDIT_PROGRAMS_KEY = 'dilin.videoEdit.programs.v1'
export const PROGRAM_ZIP_MAX = 20 * 1024 * 1024
export const programBundleName = (id: string) => `g-${id}.json`

export type Lang = 'zh-TW' | 'zh-CN' | 'en'
export function l10n(v: L10n | undefined, lang: Lang): string {
  if (v === undefined) return ''
  if (typeof v === 'string') return v
  return lang === 'zh-CN' ? v.cn : lang === 'en' ? v.en : v.tw
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const isL10n = (v: unknown): v is L10n => (typeof v === 'string' && !!v.trim()) || (isObj(v) && ['tw', 'cn', 'en'].every((k) => typeof v[k] === 'string' && !!(v[k] as string).trim()))
const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,40}$/
const COLOR_RE = /^#[0-9a-fA-F]{6}$/

/** 读 manifest（上传时校验·不合 ⇒ 回第一条毛病·白话中文） */
export function parseManifest(raw: unknown): { ok: true; manifest: ProgramManifest } | { ok: false; err: string } {
  let v = raw
  if (typeof v === 'string') { try { v = JSON.parse(v) } catch { return { ok: false, err: 'manifest.json 不是合法的 JSON' } } }
  if (!isObj(v)) return { ok: false, err: 'manifest.json 不是一个物件' }
  if (!isL10n(v.name)) return { ok: false, err: '缺 name' }
  const version = typeof v.version === 'number' ? String(v.version) : v.version
  if (typeof version !== 'string' || !version.trim()) return { ok: false, err: '缺 version' }
  if ((v.engine ?? 'html') !== 'html') return { ok: false, err: '目前只支持 engine＝html' }
  const entry = typeof v.entry === 'string' && v.entry.trim() ? v.entry.trim().replace(/^\.\//, '') : 'index.html'
  if (entry.includes('..') || entry.startsWith('/')) return { ok: false, err: 'entry 只能是包里的相对路径' }
  const dl = Number(v.defaultLength ?? 3)
  if (!Number.isFinite(dl) || dl <= 0 || dl > 3600) return { ok: false, err: 'defaultLength 要是 0～3600 秒' }
  const ps = v.params ?? []
  if (!Array.isArray(ps)) return { ok: false, err: 'params 要是阵列' }
  const params: ProgramParamSpec[] = []
  const seen = new Set<string>()
  for (const p of ps) {
    if (!isObj(p) || typeof p.key !== 'string' || !KEY_RE.test(p.key)) return { ok: false, err: '有一项参数的 key 不合法' }
    if (seen.has(p.key)) return { ok: false, err: `参数 ${p.key} 重复` }
    seen.add(p.key)
    const label: L10n = isL10n(p.label) ? p.label : p.key
    if (p.type === 'text') params.push({ key: p.key, label, type: 'text', default: typeof p.default === 'string' ? p.default : '' })
    else if (p.type === 'color') params.push({ key: p.key, label, type: 'color', default: typeof p.default === 'string' && COLOR_RE.test(p.default) ? p.default : '#ffffff' })
    else if (p.type === 'number') {
      const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : undefined)
      const min = num(p.min), max = num(p.max), step = num(p.step)
      if (min !== undefined && max !== undefined && min > max) return { ok: false, err: `参数 ${p.key} 的 min 大于 max` }
      params.push({ key: p.key, label, type: 'number', default: num(p.default) ?? min ?? 0, ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}), ...(step !== undefined && step > 0 ? { step } : {}) })
    } else if (p.type === 'select') {
      const opts = Array.isArray(p.options) ? p.options.filter((o) => typeof o === 'string' || (isObj(o) && typeof o.value === 'string' && isL10n(o.label))) as Array<string | { value: string; label: L10n }> : []
      if (!opts.length) return { ok: false, err: `参数 ${p.key} 没有 options` }
      const vals = opts.map(optValue)
      params.push({ key: p.key, label, type: 'select', default: typeof p.default === 'string' && vals.includes(p.default) ? p.default : vals[0], options: opts })
    } else if (p.type === 'bool' || p.type === 'boolean') params.push({ key: p.key, label, type: 'bool', default: p.default === true })
    else return { ok: false, err: `参数 ${p.key} 的 type 不认得（text／number／color／select／bool）` }
  }
  return { ok: true, manifest: { name: v.name as L10n, version: version.trim(), engine: 'html', entry, defaultLength: dl, alpha: v.alpha !== false, params } }
}
export const optValue = (o: string | { value: string }) => (typeof o === 'string' ? o : o.value)

/** 这一项参数现在的值：片段存的（合规才算）·不合 ⇒ 包里默认；数字夹在 min～max */
export function paramValue(spec: ProgramParamSpec, v: unknown): ProgramParamValue {
  switch (spec.type) {
    case 'text': return typeof v === 'string' ? v : spec.default
    case 'color': return typeof v === 'string' && COLOR_RE.test(v) ? v : spec.default
    case 'bool': return typeof v === 'boolean' ? v : spec.default
    case 'select': return typeof v === 'string' && spec.options.some((o) => optValue(o) === v) ? v : spec.default
    case 'number': {
      const n = typeof v === 'number' && Number.isFinite(v) ? v : spec.default
      return Math.min(spec.max ?? Infinity, Math.max(spec.min ?? -Infinity, n))
    }
  }
}
/** 交给程序的整组参数（每项都有值） */
export function effectiveParams(m: ProgramManifest, params: Readonly<Record<string, unknown>>): Record<string, ProgramParamValue> {
  const out: Record<string, ProgramParamValue> = {}
  for (const s of m.params) out[s.key] = paramValue(s, params[s.key])
  return out
}

// ── 程序片段 ──
export function newProgramClip(id: string, b: Pick<ProgramBundle, 'id' | 'manifest'>): TlClip {
  return { id, mediaId: '', start: 0, length: snapFrame(b.manifest.defaultLength) || snapFrame(3), offset: 0, program: { pkg: b.id, version: b.manifest.version, params: {} } }
}
/** 点一个程序包 ⇒ 放在播放头（程序轨照落点规划：主轨上面离主轨最近那条程序轨·那段被占／锁了 ⇒ 往上新增一条·可多条叠） */
export function addProgramAt(tr: Tracks, b: Pick<ProgramBundle, 'id' | 'manifest'>, at: number, mk: { id: () => string; laneId: () => string }): { tracks: Tracks; id: string } {
  const c = newProgramClip(mk.id(), b)
  return { tracks: applyDrop(tr, planDrop(tr, 'program', null, snapFrame(Math.max(0, at)), c.length), c, mk.laneId()), id: c.id }
}
/** 改一项参数（锁了的轨不改·值不合规不改·没变不出新轨道） */
export function setProgramParam(tr: Tracks, id: string, spec: ProgramParamSpec, value: unknown): Tracks {
  const hit = findClip(tr, id)
  if (!hit || hit.lane.locked || !hit.clip.program) return tr
  const v = paramValue(spec, value)
  if (spec.type !== 'number' && v !== value) return tr
  const cur = hit.clip.program.params[spec.key]
  if (cur === v) return tr
  const program: ProgramBody = { ...hit.clip.program, params: { ...hit.clip.program.params, [spec.key]: v } }
  return tr.map((l) => (l !== hit.lane ? l : { ...l, clips: l.clips.map((c) => (c.id === id ? { ...c, program } : c)) }))
}
/** 程序收到的秒（＋15）：片段内秒＋offset（剪开后的后段接着播） */
export const programTime = (c: Pick<TlClip, 'offset'>, local: number): number => Math.max(0, c.offset + local)

// ── 包本体 ──
/** 入口页插上桥：收 postMessage 叫 render（一次一笔·算着时来的只留最后一笔）；载好回一声 ready */
export const PROGRAM_BRIDGE = `<script>(function(){var busy=false,pend=null;function run(m){var p=window.dilinProgram;if(!p||typeof p.render!=='function'){return}busy=true;Promise.resolve().then(function(){return p.render(m.t,m.params,m.size)}).catch(function(){}).then(function(){busy=false;if(pend){var n=pend;pend=null;run(n)}})}addEventListener('message',function(e){var m=e.data;if(!m||m.type!=='dilin-program-render')return;if(busy){pend=m;return}run(m)});parent.postMessage({type:'dilin-program-ready'},'*')})()</script>`
/** 沙盒页的安全规则（只有 sandbox 挡不住打外网）：一律不准连网（fetch／XHR／WebSocket／外链图字档全拒）·
 *  只准页内与 data:／blob: 资源（上传包的资源都已嵌成 data:）。放在整页最前面 ⇒ 包里任何程序都在它之后跑、松不开。 */
export const PROGRAM_CSP = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' data: blob:; style-src 'unsafe-inline' data:; img-src data: blob:; font-src data:; media-src data: blob:; worker-src blob: data:; connect-src 'none'; form-action 'none'; base-uri 'none'"
export const PROGRAM_CSP_META = `<meta http-equiv="Content-Security-Policy" content="${PROGRAM_CSP}">`
/** WebRTC 不归 CSP 管 ⇒ 包里程序跑之前先拿掉 RTC 建构子、封子框 contentWindow（实作在 lib/program-sandbox.ts·简报程序动画同一份） */
export { PROGRAM_NET_GUARD }
export function withBridge(html: string): string {
  const i = html.toLowerCase().lastIndexOf('</body>')
  const body = i >= 0 ? html.slice(0, i) + PROGRAM_BRIDGE + html.slice(i) : html + PROGRAM_BRIDGE
  return PROGRAM_CSP_META + PROGRAM_NET_GUARD + body
}
/** 包里的资源（字体、图…）换成 data: 网址嵌进入口页（沙盒没有同源·读不到相对路径）：认引号里与 url() 里的相对路径 */
export function inlineAssets(html: string, assets: ReadonlyMap<string, string>): string {
  let out = html
  const keys = [...assets.keys()].sort((a, b) => b.length - a.length)
  for (const k of keys) {
    const url = assets.get(k)!
    for (const p of [k, `./${k}`]) {
      const esc = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      out = out.replace(new RegExp(`(["'(])${esc}(["')])`, 'g'), (_m, a: string, b: string) => `${a}${url}${b}`)
    }
  }
  return out
}
/** 包里档案的路径：去掉共同的最上层夹（zip 常整个包一层夹）·统一斜线 */
export function stripCommonRoot(paths: readonly string[]): { root: string; rel: (p: string) => string } {
  const norm = paths.map((p) => p.replace(/\\/g, '/')).filter((p) => !p.endsWith('/') && !p.startsWith('__MACOSX/'))
  const firsts = new Set(norm.map((p) => (p.includes('/') ? p.split('/')[0] : '')))
  const root = firsts.size === 1 && !firsts.has('') && !norm.some((p) => p === [...firsts][0]) ? `${[...firsts][0]}/` : ''
  return { root, rel: (p) => { const n = p.replace(/\\/g, '/'); return root && n.startsWith(root) ? n.slice(root.length) : n } }
}

/** 存在本机清单里的上传包（只记名字与版本·本体在 OPFS） */
export type StoredProgram = { id: string; name: L10n; version: string }
export function parseStoredPrograms(raw: string | null): StoredProgram[] {
  if (!raw) return []
  let v: unknown
  try { v = JSON.parse(raw) } catch { return [] }
  if (!Array.isArray(v)) return []
  const out: StoredProgram[] = []
  for (const x of v) if (isObj(x) && typeof x.id === 'string' && /^u-[A-Za-z0-9-]{8,64}$/.test(x.id) && isL10n(x.name) && typeof x.version === 'string' && !out.some((o) => o.id === x.id)) out.push({ id: x.id, name: x.name, version: x.version })
  return out
}

/** 工程档内嵌的程序包跟本机那份比——版本或内容不同就算新版（要换上·不能因同 id 已在本机就跳过）；本机没有 ⇒ 也要收 */
export function embeddedProgramNewer(cur: Pick<ProgramBundle, 'manifest' | 'html'> | null | undefined, incoming: Pick<ProgramBundle, 'manifest' | 'html'>): boolean {
  if (!cur) return true
  return cur.manifest.version !== incoming.manifest.version || cur.html !== incoming.html
}

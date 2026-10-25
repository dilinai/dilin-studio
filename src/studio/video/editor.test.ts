// 游客剪辑题：整页（page/VideoEditPage.tsx）两站共用·游客版宿主（page/guest.tsx）不碰网站后端——
//   编辑器目录里没有 /api、没有对外请求（读素材只读这台电脑给的链接·模型／音色库走宿主给的站或同站静态档）；
//   工程档读写走 store（素材写进 assets/、不碰网站的本机素材清单）、登记了 flush；要后端的几组给 null；白名单闸不走。
// 跑法（在 studio 根目录跑）：node -e "require('sucrase/register/ts');require('sucrase/register/tsx');require('./video/editor.test.ts')"
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const files: string[] = []
const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.tsx?$/.test(f) && !/\.test\./.test(f)) files.push(p) } }
walk(__dirname)
const src = (rel: string) => readFileSync(join(__dirname, rel), 'utf8')

/** 去掉注释（注释里提到 /api 不算） */
function code(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
}
/** 已知的 fetch：读素材（游客版＝这台电脑给的 blob: 链接）、混音／导出读图、识别字幕与拆曲的模型（宿主给的站）、编曲音色（同站 /vedit/samples） */
const FETCH_OK: Record<string, readonly string[]> = {
  'ui/mix.ts': ['url'],
  'ui/export-render.ts': ['src', 'c'],
  'page/VideoEditPage.tsx': ['m.url'],
  'ui/asr-client.ts': ['url'],
  'lib/split.pure.ts': ['m.model'],
  'ui/piano-synth.ts': ['sampleUrl(inst'],
}
/** 一份源码里的网路违规：/api 路径、XHR／WebSocket／EventSource／sendBeacon、fetch 打的不是上面那几个已知变数 */
export function netViolations(name: string, s: string): string[] {
  const c = code(s)
  const out: string[] = []
  if (/['"`]\/api\//.test(c)) out.push(`${name}: 有 /api 路径`)
  if (/\bXMLHttpRequest\b|\bnew WebSocket\b|\bnew EventSource\b|\bsendBeacon\b/.test(c)) out.push(`${name}: 有 XHR／WebSocket／EventSource／sendBeacon`)
  for (const m of c.matchAll(/\bfetch\(\s*([^,)]+)/g)) {
    const arg = m[1].trim()
    const ok = Object.entries(FETCH_OK).some(([f, args]) => name.replace(/\\/g, '/').endsWith(f) && args.includes(arg))
    if (!ok) out.push(`${name}: fetch(${arg})`)
  }
  return out
}

/** 游客版宿主里要后端的那几组：都得是 null（或回 null 的函数） */
const BACKEND_NULL = ['drive', 'shell', 'tts', 'chat', 'startRelay', 'offload', 'renderProjectsDialog', 'renderHistoryDialog', 'renderDriveEye', 'head', 'create'] as const
export function guestBackendLeaks(s: string): string[] {
  const c = code(s)
  const out: string[] = []
  for (const k of BACKEND_NULL) if (!new RegExp(`\\b${k}: null,`).test(c)) out.push(k)
  if (!/exportDrive: \(\) => null,/.test(c)) out.push('exportDrive')
  if (/VEDIT_MEDIA_KEY|startDriveUpload|createClient|RoleSideChat|supabase|['"`]@\//.test(c)) out.push('网站模块')
  return out
}

let n = 0, bad = 0
function test(nm: string, fn: () => void) {
  try { fn(); n++; console.log('✓', nm) } catch (e) { bad++; console.log('✗', nm); console.log(' ', (e as Error).message.split('\n').slice(0, 10).join('\n ')) }
}

test('A 编辑器目录：没有 /api、没有对外请求（只剩已知那几处 fetch）；游客版另写的外壳已丢', () => {
  const v = files.flatMap((f) => netViolations(relative(__dirname, f), readFileSync(f, 'utf8')))
  assert.deepEqual(v, [])
  assert.ok(files.some((f) => f.endsWith(join('page', 'VideoEditPage.tsx'))), '扫不到整页·题本身坏了')
  assert.ok(!existsSync(join(__dirname, 'Editor.tsx')), '游客版另写的 Editor.tsx 要丢掉')
  assert.equal(src('lib/arrange.pure.ts').match(/export const VEDIT_SAMPLE_BASE = '([^']+)'/)?.[1], '/vedit/samples', '编曲音色是同站静态档')
})

test('B 药：塞进 /api 路径、XHR、打外网的 fetch、已知档换了变数 ⇒ 红', () => {
  assert.equal(netViolations('x.ts', "fetch('/api/vedit/tts')").length, 2)
  assert.equal(netViolations('x.ts', 'const x = new XMLHttpRequest()').length, 1)
  assert.equal(netViolations('x.ts', 'await fetch(remoteUrl)').length, 1)
  assert.equal(netViolations('ui/mix.ts', 'await fetch(other)').length, 1)
  assert.equal(netViolations('page/VideoEditPage.tsx', 'await fetch(`/x/${id}`)').length, 1)
  assert.deepEqual(netViolations('x.ts', "// fetch('/api/x') 注释里提到不算"), [])
})

test('C 游客版素材链接只有这台电脑的：开档不给云盘链接·页面没有本机档就是空（标缺素材）', () => {
  const G = code(src('page/guest.tsx'))
  assert.match(G, /media_urls: \{\}/)
  assert.doesNotMatch(G, /media_denied|cloudProxy:\s*(?!_)\S/)
  const P = code(src('page/VideoEditPage.tsx'))
  assert.match(P, /const url = px \? blobUrl\(px\) : orig \? blobUrl\(orig\) : remote \?\? ''/)
})

test('D 存档：素材原档写进 assets/、工程走 format.ts、等素材写好才存、登记 flush；不写网站的本机素材清单', () => {
  const G = src('page/guest.tsx')
  assert.match(G, /await store\.writeAsset\(file, blob\)/)
  assert.match(G, /await Promise\.all\(\[\.\.\.st\.writing\.values\(\)\]\)\n\s*const doc = docOf\(body\.project\)/)
  assert.match(G, /saveProjectSafe\(store, \(s\) => saveVideoDoc\(s, doc\), \{ force \}\)/)
  assert.match(G, /if \(!r\.written\) \{ props\.onSaveStateChange\?\.\('dirty'\); return \{ status: 412, j: \{\} \} \}/, '外面改过 project.json ⇒ 不盖')
  assert.match(G, /const doc = await loadVideoDoc\(store\)/)
  assert.match(G, /registerFlush: \(f\) => props\.registerFlush\?\.\(f\)/)
  assert.match(G, /rememberList: false/)
  // 登记的是会等在途那发、再补存最新改动的 flushProject（行为题见 flush-inflight.test.ts）
  assert.match(src('page/VideoEditPage.tsx'), /host\.project\.registerFlush\(\(\) => flushProjectRef\.current\(\)\)/)
})

test('E 游客版宿主：要后端的几组都给 null·白名单闸不走·功能表只开第三方授權（药：塞回一组 ⇒ 红）', () => {
  const G = src('page/guest.tsx')
  assert.deepEqual(guestBackendLeaks(G), [])
  assert.match(G, /checkGate: \(\) => Promise\.resolve\(true\)/)
  assert.match(G, /export const VIDEO_GUEST_FEATURES: Readonly<Record<string, boolean>> = \{ \[VEDIT_FEATURES\.licenses\]: true \}/)
  // 药
  assert.deepEqual(guestBackendLeaks(G.replace('drive: null,', 'drive: siteDrive,')), ['drive'])
  assert.deepEqual(guestBackendLeaks(G.replace('exportDrive: () => null,', 'exportDrive: (o) => mk(o),')), ['exportDrive'])
  assert.deepEqual(guestBackendLeaks(G + "\nimport x from '@/lib/supabase/client'"), ['网站模块'])
  const I = src('index.ts')
  assert.match(I, /guestPage: VideoGuestPage/)
  assert.match(I, /guestFeatures: VIDEO_GUEST_FEATURES/)
})

test('F 整页照宿主有没有画钮：云盘、加進對話、历史、最近草稿、授权；页签照登入版全留', () => {
  const P = src('page/VideoEditPage.tsx')
  assert.match(P, /const TOP_TABS: readonly TopTab\[\] = \['media', \.\.\.ASSET_TABS, 'arrange', 'skill'\]/)
  assert.match(P, /\.filter\(\(it\) => it\.act !== 'add-chat' \|\| !!host\.chat\)/)
  assert.match(P, /host\.renderHistoryDialog && host\.has\(VEDIT_FEATURES\.history\)/)
  assert.match(P, /\{licensesOpen && <LicensesDialog onClose=\{\(\) => setLicensesOpen\(false\)\} \/>\}/)
  assert.match(P, /if \(d\.note\) setNotice\(d\.note\)/, '读档问题（丢掉的条目、缺素材）照样说')
})

test('G 第三方授權小窗链到授权全文', () => {
  const L = src('LicensesDialog.tsx')
  for (const f of ['/vedit/licenses/MPL-2.0.txt', '/vedit/licenses/LGPL-2.1.txt', '/vedit/licenses/README.md']) assert.ok(L.includes(f), `授权小窗没链 ${f}`)
  assert.match(L, /github\.com\/FFmpeg\/FFmpeg/)
  assert.match(src('page/VideoEditPage.tsx'), /data-testid="vedit-licenses-open"/)
})

/** 静态档（public/vedit/…）网址：一律经 studioStaticHref（开源单页版走相对路径）。
 *  贴纸清单里的档名在 stickerSrc 包；编曲音色的根目录常数在 sampleUrl 包。 */
export function staticViolations(name: string, s: string): string[] {
  const c = code(s)
  const out: string[] = []
  const n = name.replace(/\\/g, '/')
  if (n.endsWith('lib/stickers.data.ts')) return out
  for (const line of c.split('\n')) {
    if (!/['"`]\/vedit\//.test(line)) continue
    if (/studioStaticHref\(\s*['"`]\/vedit\//.test(line)) continue
    if (n.endsWith('lib/arrange.pure.ts') && /^export const VEDIT_SAMPLE_BASE = '\/vedit\/samples'$/.test(line.trim())) continue
    out.push(`${name}: ${line.trim().slice(0, 100)}`)
  }
  if (/<img src=\{\w+\.file\}/.test(c) || /stickerImg\(\w+\.file\)/.test(c)) out.push(`${name}: 贴纸图没经 stickerSrc`)
  return out
}

test('I 静态档网址（贴纸、滤镜／特效缩图、编曲音色、授权全文）都经 studioStaticHref（药：直写绝对路径 ⇒ 红）', () => {
  const v = files.flatMap((f) => staticViolations(relative(__dirname, f), readFileSync(f, 'utf8')))
  assert.deepEqual(v, [])
  assert.match(src('lib/arrange.pure.ts'), /export const sampleUrl = [^\n]*=> studioStaticHref\(`\$\{VEDIT_SAMPLE_BASE\}\//)
  assert.match(src('lib/sticker.pure.ts'), /export const stickerSrc = [^\n]*=> studioStaticHref\(s\.file\)/)
  // 药
  assert.equal(staticViolations('lib/fx.pure.ts', 'export const fxThumb = (id: string) => `/vedit/fx/${id}.jpg`').length, 1)
  assert.equal(staticViolations('x.tsx', "const L = [{ href: '/vedit/licenses/README.md' }]").length, 1)
  assert.equal(staticViolations('x.tsx', '<img src={it.file} alt="" />').length, 1)
  assert.deepEqual(staticViolations('x.tsx', "const h = studioStaticHref('/vedit/licenses/README.md')"), [])
})

test('J 游客版不说「已存到雲端硬碟」「挑雲端硬碟的檔案」：那两句换成讲这台电脑的（药：换字表拿掉一条 ⇒ 回到登入版那句）', () => {
  const { guestWords, GUEST_WORDS } = require('./page/guest-words') as typeof import('./page/guest-words')
  const dict: Record<string, string> = { vedit_proj_saved: '已存到雲端硬碟', vedit_media_empty: '挑本機或雲端硬碟的檔案', vedit_guest_saved: '已儲存', vedit_guest_media_empty: '挑電腦裡的檔案', other: '別的' }
  const base = (k: string) => dict[k] ?? k
  const t = guestWords(base)
  assert.equal(t('vedit_proj_saved'), '已儲存')
  assert.equal(t('vedit_media_empty'), '挑電腦裡的檔案')
  assert.equal(t('other'), '別的', '其余照原字')
  const { GUEST_TW, GUEST_CN, GUEST_EN } = require('./i18n.guest') as typeof import('./i18n.guest')
  for (const d of [GUEST_TW, GUEST_CN, GUEST_EN] as Record<string, string>[]) for (const k of Object.values(GUEST_WORDS)) { assert.ok(d[k], k); assert.doesNotMatch(d[k], /雲端|云盘|云端|cloud/i, k) }
  // 药：换字表少了「已儲存」那条 ⇒ 游客版又说「已存到雲端硬碟」
  const { vedit_proj_saved: _drop, ...less } = GUEST_WORDS
  void _drop
  assert.equal(guestWords(base, less)('vedit_proj_saved'), '已存到雲端硬碟')
  // 游客剪辑的「存好了」与文件／表格／简报同一个词（台「已儲存」·陆「已保存」）（药：i18n.guest 改回「已存好」⇒ 红）
  //   （⛔ 跨编辑器 import·文件字表 saved_at 现值＝已儲存／已保存）
  assert.match(readFileSync(join(__dirname, '../docs/page/page-strings.ts'), 'utf8'), /saved_at: "已儲存"[\s\S]*saved_at: "已保存"/)
  assert.equal((GUEST_TW as Record<string, string>).vedit_guest_saved, '已儲存')
  assert.equal((GUEST_CN as Record<string, string>).vedit_guest_saved, '已保存')
  assert.match(src('page/guest.tsx'), /<StudioTProvider t=\{tGuest\} lang=\{lang\}><VideoEditPage host=\{host\} \/><\/StudioTProvider>/)
})

test('H 编辑器目录与 public/vedit 文字档里没有本机路径、帖号这类形状（具名字眼由底座 test:studio-base 的扫描管）', () => {
  const pat = /(^|[^\w.])~\/\w|\/home\/\w|\/Users\/\w|\bseq ?\d{4,}/
  const roots = [__dirname, ...['tw', 'cn'].map((a) => join(__dirname, `../../../apps/${a}/public/vedit`))]
  const hits: string[] = []
  const scan = (d: string) => { for (const f of readdirSync(d)) { const q = join(d, f); if (statSync(q).isDirectory()) scan(q); else if (/\.(tsx?|md|txt|json|svg|css|html)$/.test(f)) readFileSync(q, 'utf8').split('\n').forEach((l, k) => { if (pat.test(l)) hits.push(`${relative(join(__dirname, '../../..'), q)}:${k + 1}`) }) } }
  for (const r of roots) scan(r)
  assert.deepEqual(hits, [])
  for (const x of ['见 ~' + '/x', 'a /ho' + 'me/b', 'seq ' + '1234']) assert.ok(pat.test(x), `药：${x} 要认得出`)
  assert.ok(!pat.test('a/b ~ 1/2'), '药：一般路径不误报')
})

test('K 外面（使用者自己的 AI）改了工程档、手上没未存改动 ⇒ 外框只递增 revision、整页读回换上（不重挂：播放头、捲动、复原栈留着）；有未存改动照旧问', () => {
  const { outsideChangeAction } = require('../shared/session') as typeof import('../shared/session')
  // 剪辑登记了「外部改档读回」（药：拿掉 ⇒ 外框又整个重挂编辑页·看起来像整页重新载入）
  const flag = /\boutsideSoftReload: true\b/.test(code(src('index.ts')))
  assert.equal(outsideChangeAction(false, { outsideSoftReload: flag }), 'revision')
  assert.equal(outsideChangeAction(true, { outsideSoftReload: true }), 'ask')
  assert.equal(outsideChangeAction(false, {}), 'remount')
  assert.equal(outsideChangeAction(false, { softReload: true }), 'revision')
  // 外框照判定走：revision 那条只递增 revision、不动 editorKey（药：改回「没未存改动就 reloadEditor」⇒ 红）
  const S = code(readFileSync(join(__dirname, '../shared/session.ts'), 'utf8'))
  assert.match(S, /const act = outsideChangeAction\(dirtyRef\.current, appDef\)/)
  assert.match(S, /else if \(act === 'revision'\) \{ setExternalPending\(false\); setRevision\(r => r \+ 1\) \}/)
  // 游客宿主把 revision 变化转给整页；整页读回、进复原栈换上
  const G = code(src('page/guest.tsx'))
  assert.match(G, /if \(props\.revision === lastRev\.current\) return/)
  assert.match(G, /onOutsideChange: \(f: \(\) => void\) => \{ outside\.add\(f\)/)
  const P = code(src('page/VideoEditPage.tsx'))
  assert.match(P, /useEffect\(\(\) => host\.project\.onOutsideChange\?\.\(\(\) => \{ void outsideRef\.current\(\) \}\), \[\]\)/)
  assert.match(P, /const r = await host\.project\.get\(p\.id\)\s+if \(!r\.d\) \{ setNotice\(t\('vedit_guest_outside_bad'\)\); return \}[\s\S]{0,300}await applyProject\(r\.d, true\)\s+setNotice\(t\('vedit_guest_outside_applied'\)\)/)
})

console.log(bad ? `studio-video editor：${n}/${n + bad} 过` : `studio-video editor → ${n} 过`)
if (bad) process.exit(1)

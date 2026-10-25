#!/usr/bin/env node
// Dilin Studio 剪辑命令列版：不开浏览器，直接对工程资料夹（project.json＋assets/）做事。零依赖（node 内建）。
// 跟编辑页同一套程式（app/video-cli-core.mjs·npm run build 时从 src/studio/video/cli-core.ts 打出来）：
//   读档检查（编辑页开档时会丢掉／改掉的每一条都列出来）、剪辑命令（同 MCP video_run／网站 video_edit_run）、汇出 FCPXML／Premiere XML／剪映草稿。
//
// 跑法：
//   node tools/video-cli.mjs check <工程资料夹或 project.json>                     ⇒ 读档报告；有问题退出码 1
//   node tools/video-cli.mjs run <工程> [--steps <steps.json>] [--step '<{"command":…,"params":{…}}>' …] [--out <另存资料夹>]
//        ⇒ 全有或全无；成了写回 project.json（给 --out 就另存到那里，assets/ 不拷）；印出每步结果与读档报告
//   node tools/video-cli.mjs commands [--filter <字>]                             ⇒ 命令与参数规格（JSON）
//   node tools/video-cli.mjs export <工程> --format fcpxml|premiere|jianying|capcut|edl|otio|srt|vtt|ass [--out <资料夹>] ⇒ 汇出档写进 --out（缺省＝工程资料夹）
//   node tools/video-cli.mjs subs <工程> --file <字幕档.srt|.vtt|.ass> ⇒ 字幕一句一段排上一条文字轨、写回 project.json
//   node tools/video-cli.mjs import <别家工程档或资料夹> [--out <新工程资料夹>] [--media <素材资料夹>]
//        ⇒ 读 FCPXML（Final Cut／达芬奇·.fcpxml 或 .fcpxmld）、Premiere XML（.xml）、EDL（.edl）、OTIO（.otio）、剪映／CapCut 草稿（draft_content.json 或草稿资料夹·没加密的）
//          素材照原路径找，找不到再到 --media、工程档旁边、assets/ 按档名找；拷进新工程的 assets/，写 project.json（缺省＝工程档旁边「<名>-dilin」）
// 页面开着的话，写回后编辑页约 1.5 秒内会自己重新载入。

import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const CORE = join(HERE, '..', 'app', 'video-cli-core.mjs')

function die(msg, code = 2) { console.error(msg); console.error('用法：node tools/video-cli.mjs check|run|commands|export|import|subs …（見檔頭說明）'); process.exit(code) }

export function parse(argv) {
  const o = { cmd: argv[0], steps: [] }
  let i = 1
  if (o.cmd && o.cmd !== 'commands' && argv[1] && !argv[1].startsWith('--')) { o.project = argv[1]; i = 2 }
  for (; i < argv.length; i++) {
    const a = argv[i], v = () => { if (i + 1 >= argv.length) die(`${a} 後面要接值`); return argv[++i] }
    if (a === '--steps') o.stepsFile = v()
    else if (a === '--step') o.steps.push(JSON.parse(v()))
    else if (a === '--out') o.out = v()
    else if (a === '--format') o.format = v()
    else if (a === '--filter') o.filter = v()
    else if (a === '--media') o.media = v()
 else if (a === '--file') o.file = v()
    else die(`不認得的選項 ${a}`)
  }
  return o
}

/** 工程资料夹或 project.json ⇒ project.json 的完整路径 */
export function projectFile(p) {
  const f = statSync(p).isDirectory() ? join(p, 'project.json') : p
  if (!existsSync(f)) die(`找不到 ${f}`)
  return resolve(f)
}

async function main() {
  const o = parse(process.argv.slice(2))
  if (!['check', 'run', 'commands', 'export', 'import', 'subs'].includes(o.cmd)) die('第一個參數要是 check、run、commands、export、import 或 subs')
  if (!existsSync(CORE)) die(`缺 ${CORE}：先在這個資料夾跑 npm run build`)
  const core = await import(pathToFileURL(CORE).href)
  if (o.cmd === 'commands') { process.stdout.write(JSON.stringify(core.cliCommands(o.filter), null, 1) + '\n'); return }
  if (!o.project) die('要給工程資料夾或 project.json')
  if (o.cmd === 'import') { importOther(core, o); return }
  const file = projectFile(o.project)
  let loaded
  try { loaded = core.cliLoad(readFileSync(file, 'utf8')) } catch (e) { die(`讀不進 ${file}：${e.message}`, 1) }
  const report = (issues) => { if (issues.length) { console.error(`讀檔報告（${issues.length} 條·編輯頁開檔時會這樣處理）：`); for (const x of issues) console.error(`  - [${x.code}] ${x.text}`) } }
  if (o.cmd === 'check') {
    report(loaded.issues)
    if (!loaded.issues.length) console.log('讀檔檢查：0 條問題')
    process.exitCode = loaded.issues.length ? 1 : 0
    return
  }
  if (o.cmd === 'run') {
    if (o.stepsFile) { const s = JSON.parse(readFileSync(o.stepsFile, 'utf8')); if (!Array.isArray(s)) die('--steps 檔要是陣列'); o.steps.unshift(...s) }
    if (!o.steps.length) die('要給 --steps 或 --step')
    report(loaded.issues)
    const r = core.cliRun(loaded.doc, o.steps)
    if (!r.ok) { console.error(r.error); process.exitCode = 1; return }
    const out = o.out ? join(resolve(o.out), 'project.json') : file
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, core.cliSave(r.doc))
    process.stdout.write(JSON.stringify({ ok: true, results: r.results, saved: out }, null, 1) + '\n')
    report(r.doc.drops.map((d) => ({ code: d.code, text: d.code })))
    return
  }
  if (o.cmd === 'subs') {
    if (!o.file) die('要給 --file <字幕檔>')
    const r = core.cliAddSubtitles(loaded.doc, new Uint8Array(readFileSync(resolve(o.file))))
    if (!r.n) die(`${o.file} 裡讀不到字幕（支援 SRT、VTT、ASS）`, 1)
    writeFileSync(file, core.cliSave(r.doc))
    console.log(`已放 ${r.n} 句字幕 ⇒ ${file}`)
    return
  }
  if (!core.CLI_EXPORT_FORMATS.includes(o.format)) die(`--format 要是 ${core.CLI_EXPORT_FORMATS.join('、')}`)
  const dir = o.out ? resolve(o.out) : dirname(file)
  const r = core.cliExport(loaded.doc, o.format, { mediaRoot: join(dirname(file), 'assets'), os: process.platform === 'win32' ? 'windows' : 'mac', assetBase: pathToFileURL(join(dirname(file), 'assets')).href + '/' })
  mkdirSync(dir, { recursive: true })
  for (const f of r.files) writeFileSync(join(dir, f.name), f.text)
  report(loaded.issues)
  if (!r.files.length) die('文字軌上沒有字，沒有字幕可以匯出', 1)
  console.log(`已存：${r.files.map((f) => join(dir, f.name)).join('、')}`)
  if (r.notes.length) console.log(`帶不過去的：${r.notes.join('、')}`)
}

/** 汇入别家工程：读档 ⇒ 找素材、拷进新工程 assets/ ⇒ 写 project.json；印出几段、缺哪些素材、带不过来的 */
function importOther(core, o) {
  let src = resolve(o.project)
  if (!existsSync(src)) die(`找不到 ${src}`)
  if (statSync(src).isDirectory()) { // .fcpxmld 包、剪映草稿资料夹
    const hit = ['Info.fcpxml', 'draft_content.json', 'draft_info.json'].map((f) => join(src, f)).find((f) => existsSync(f))
    if (!hit) die(`${src} 裡找不到 Info.fcpxml 或 draft_content.json`)
    src = hit
  }
  let p
  try { p = core.cliImport(src, readFileSync(src, 'utf8')) } catch (e) { die(`讀不進 ${src}：${e.message}`, 1) }
  const here = dirname(src), dirOf = (f) => (/^(draft_content|draft_info|template)\.json/.test(f.replace(/^.*[\\/]/, '')) || /Info\.fcpxml$/.test(f) ? dirname(here) : here)
  const out = resolve(o.out ?? join(dirOf(src), `${(p.name || 'imported').replace(/[\\/:*?"<>|]/g, '_')}-dilin`))
  mkdirSync(join(out, 'assets'), { recursive: true })
  const roots = [o.media && resolve(o.media), here, join(here, 'assets'), dirname(here)].filter(Boolean)
  const files = {}, taken = new Set()
  for (const m of p.media) {
    const cands = [m.path && isAbsolute(m.path) ? m.path : null, m.path ? join(here, m.path) : null, ...roots.map((r) => join(r, m.file))]
    const hit = cands.find((c) => c && existsSync(c) && statSync(c).isFile())
    if (!hit) continue
    const name = core.assetNameFor(m.file, taken); taken.add(name)
    copyFileSync(hit, join(out, 'assets', name)); files[m.key] = name
  }
  const r = core.cliImportDoc(p, files)
  writeFileSync(join(out, 'project.json'), core.cliSave(r.doc))
  console.log(`已匯入 ${p.app}：${r.clips} 段片段、${Object.keys(files).length} 份素材 ⇒ ${join(out, 'project.json')}`)
  if (r.missing.length) console.log(`找不到素材（這些片段沒放進來；用 --media 指素材資料夾再跑一次）：${r.missing.map((m) => m.path || m.file).join('、')}`)
  if (r.notes.length) console.log(`帶不過來的：${r.notes.map((n) => core.importNoteText(n, 'zh-TW')).join('、')}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e && e.message ? e.message : e); process.exit(1) })

#!/usr/bin/env node
// Dilin Studio 简报命令列版：不开画面，直接对工程资料夹（project.json＋assets/）做事。零依赖（node 内建）。
// 跟简报页同一套程式（app/slides-cli-core.mjs·npm run build 时从 src/studio/slides/cli-core.ts 打出来）：
//   读档检查、读页与元件、跑操作（同 MCP slides_run：改字、移框、加删元件、加页、换版式、动画、切换）——这些纯算，不开浏览器；
//   网页版（.html）、PowerPoint（.pptx）要排版量字、烤图 ⇒ 用这台电脑的 Chrome／Edge／Chromium 在背景开一页简报页（同一套页面）做，
//   跟简报页「html」「pptx」那两颗同一条。每页 PNG、PDF：简报页本身没有这两种汇出，这里也不做。
//
// 跑法：
//   node tools/slides-cli.mjs check <工程资料夹或 project.json>     ⇒ 读档报告（开档时会丢掉、改成空白页的，assets/ 里找不到的档）；有问题退出码 1
//   node tools/slides-cli.mjs read <工程> [--page <页码·从 1 起>]    ⇒ 页清单；给 --page 再列那一页的元件、可用版式、动画（JSON·同 slides_read）
//   node tools/slides-cli.mjs commands [--filter <字>]              ⇒ run 的每一种操作与参数（JSON）
//   node tools/slides-cli.mjs run <工程> [--steps <steps.json>] [--step '<{"kind":…}>' …] [--out <另存资料夹>]
//        ⇒ 全有或全无；成了写回 project.json（给 --out 就另存到那里，assets/ 不拷）
//   node tools/slides-cli.mjs export <工程> --format html|pptx [--out <档或资料夹>]   ⇒ 缺省存进工程资料夹、档名＝简报名
// 开浏览器的选项：--chrome <浏览器执行档>（或环境变数 CHROME）、--port <埠>（缺省 41733）、--timeout <秒>（缺省 180）
// Windows PowerShell 会吃掉 --step 里 JSON 的引号 ⇒ 请把步骤写进 steps.json 用 --steps。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { fileBytes, openPage, outPath, projectFile } from './headless-page.mjs'
import { readProject } from './paint-cli.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const CORE = join(HERE, '..', 'app', 'slides-cli-core.mjs')
const CMDS = ['check', 'read', 'commands', 'run', 'export']

function die(msg, code = 2) { console.error(msg); console.error('用法：node tools/slides-cli.mjs check|read|commands|run|export …（見檔頭說明）'); process.exit(code) }

export function parse(argv) {
  const o = { cmd: argv[0], steps: [], port: 41733, timeout: 180 }
  let i = 1
  if (o.cmd && o.cmd !== 'commands' && argv[1] && !argv[1].startsWith('--')) { o.project = argv[1]; i = 2 }
  for (; i < argv.length; i++) {
    const a = argv[i], v = () => { if (i + 1 >= argv.length) die(`${a} 後面要接值`); return argv[++i] }
    if (a === '--steps') o.stepsFile = v()
    else if (a === '--step') { const s = v(); try { o.steps.push(JSON.parse(s)) } catch { die(`--step 不是 JSON：${s}（Windows PowerShell 請改用 --steps 檔）`) } }
    else if (a === '--out') o.out = v()
    else if (a === '--format') o.format = v()
    else if (a === '--filter') o.filter = v()
    else if (a === '--page') o.page = Number(v())
    else if (a === '--chrome') o.chrome = v()
    else if (a === '--port') o.port = Number(v())
    else if (a === '--timeout') o.timeout = Number(v())
    else die(`不認得的選項 ${a}`)
  }
  return o
}

async function main() {
  const o = parse(process.argv.slice(2))
  if (!CMDS.includes(o.cmd)) die(`第一個參數要是 ${CMDS.join('、')}`)
  if (!existsSync(CORE)) die(`缺 ${CORE}：先在這個資料夾跑 npm run build`)
  const core = await import(pathToFileURL(CORE).href)
  if (o.cmd === 'commands') { process.stdout.write(JSON.stringify(core.cliCommands(o.filter), null, 1) + '\n'); return }
  if (!o.project) die('要給工程資料夾或 project.json')
  const file = projectFile(o.project), dir = dirname(file)
  let loaded
  try { loaded = core.cliLoad(readFileSync(file, 'utf8')) } catch (e) { die(`讀不進 ${file}：${e.message}（簡報頁也開不了這份）`, 1) }
  const missing = loaded.assets.filter((n) => !existsSync(join(dir, 'assets', n)))
  const issues = [...loaded.issues, ...missing.map((n) => ({ code: 'asset_missing', text: `assets/${n} 找不到（有元件或背景引用了它）` }))]
  const report = () => { if (issues.length) { console.error(`讀檔報告（${issues.length} 條）：`); for (const x of issues) console.error(`  - [${x.code}] ${x.text}`) } }
  if (o.cmd === 'check') {
    report()
    if (!issues.length) console.log(`讀檔檢查：0 條問題（${loaded.doc.deck.pages.length} 頁）`)
    process.exitCode = issues.length ? 1 : 0
    return
  }
  if (o.cmd === 'read') {
    const r = core.cliRead(loaded.doc, o.page)
    process.stdout.write(JSON.stringify(r, null, 1) + '\n')
    if (r && r.ok === false) process.exitCode = 1
    return
  }
  if (o.cmd === 'run') {
    if (o.stepsFile) { let s; try { s = JSON.parse(readFileSync(o.stepsFile, 'utf8')) } catch (e) { die(`讀不進 ${o.stepsFile}：${e.message}`) } if (!Array.isArray(s)) die('--steps 檔要是陣列'); o.steps.unshift(...s) }
    if (!o.steps.length) die('要給 --steps 或 --step')
    report()
    const r = core.cliRun(loaded.doc, o.steps)
    if (!r.ok) { console.error(r.error); process.exitCode = 1; return }
    const out = o.out ? join(resolve(o.out), 'project.json') : file
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, core.cliSave(r.doc))
    process.stdout.write(JSON.stringify({ ok: true, changed: r.changed, results: r.results, saved: out }, null, 1) + '\n')
    return
  }
  // export：网页版／PowerPoint 都要浏览器
  if (!core.CLI_EXPORT_FORMATS.includes(o.format)) die(`--format 要是 ${core.CLI_EXPORT_FORMATS.join('、')}（每頁 PNG、PDF 簡報頁本身沒有，這裡也不做）`)
  const dest = outPath(o.out, dir, core.exportBaseName(loaded.doc), o.format)
  report()
  const page = await openPage({ app: 'slides', port: o.port, chrome: o.chrome, timeout: o.timeout, project: readProject(dir) })
  let code = 0
  try {
    const r = await page.job({ kind: 'export', format: o.format })
    if (!r || !r.ok) { console.error(`匯出失敗：${r && (r.message || r.error)}`); code = 1; return }
    const buf = fileBytes(r.result.files[0])
    mkdirSync(dirname(dest), { recursive: true }); writeFileSync(dest, buf)
    console.log(`已存：${dest}（${loaded.doc.deck.pages.length} 頁·${buf.length} 位元組）`)
    if (r.result.notes && r.result.notes.length) console.log(`帶不過去的：\n${r.result.notes.map((l) => `  · ${l}`).join('\n')}`)
  } finally { page.stop(); process.exitCode = code }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e && e.message ? e.message : e); process.exit(1) })

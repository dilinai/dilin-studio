#!/usr/bin/env node
// Dilin Studio 文件命令列版：不开画面，直接对工程资料夹（project.json＋assets/）做事。零依赖（node 内建）。
// 跟文件页同一套程式（app/docs-cli-core.mjs·npm run build 时从 src/studio/docs/cli-core.ts 打出来）：
//   读档检查、读正文、改正文（同 MCP docs_edit：接在最后、换掉唯一一段、改名）、汇出 Markdown——这些纯算，不开浏览器；
//   Word（.docx）、PDF 要排版 ⇒ 用这台电脑的 Chrome／Edge／Chromium 在背景开一页文件页（同一套页面）做：
//   Word＝文件页「Word」那颗同一条；PDF＝纸张视图的「列印」（工程的 paper 是 null＝不分页时，网页没有列印 ⇒ 这里也不出 PDF）。
//
// 跑法：
//   node tools/docs-cli.mjs check <工程资料夹或 project.json>          ⇒ 读档报告（开档时会丢掉／改回缺省的、assets/ 里找不到的档）；有问题退出码 1
//   node tools/docs-cli.mjs read <工程> [--offset <字>] [--limit <字>]  ⇒ 正文与纸张设定（JSON·同 docs_read）
//   node tools/docs-cli.mjs commands [--filter <字>]                   ⇒ run 的每一步怎么写（JSON）
//   node tools/docs-cli.mjs run <工程> [--steps <steps.json>] [--step '<{"append":"…"}>' …] [--out <另存资料夹>]
//        ⇒ 全有或全无；成了写回 project.json（给 --out 就另存到那里，assets/ 不拷）
//   node tools/docs-cli.mjs export <工程> --format md|docx|pdf [--out <档或资料夹>]   ⇒ 缺省存进工程资料夹、档名＝文件名
// 开浏览器的选项：--chrome <浏览器执行档>（或环境变数 CHROME）、--port <埠>（缺省 41732）、--timeout <秒>（缺省 120）
// Windows PowerShell 会吃掉 --step 里 JSON 的引号 ⇒ 请把步骤写进 steps.json 用 --steps。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { fileBytes, openPage, outPath, projectFile } from './headless-page.mjs'
import { readProject } from './paint-cli.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const CORE = join(HERE, '..', 'app', 'docs-cli-core.mjs')
const CMDS = ['check', 'read', 'commands', 'run', 'export']

function die(msg, code = 2) { console.error(msg); console.error('用法：node tools/docs-cli.mjs check|read|commands|run|export …（見檔頭說明）'); process.exit(code) }

export function parse(argv) {
  const o = { cmd: argv[0], steps: [], port: 41732, timeout: 120 }
  let i = 1
  if (o.cmd && o.cmd !== 'commands' && argv[1] && !argv[1].startsWith('--')) { o.project = argv[1]; i = 2 }
  for (; i < argv.length; i++) {
    const a = argv[i], v = () => { if (i + 1 >= argv.length) die(`${a} 後面要接值`); return argv[++i] }
    if (a === '--steps') o.stepsFile = v()
    else if (a === '--step') { const s = v(); try { o.steps.push(JSON.parse(s)) } catch { die(`--step 不是 JSON：${s}（Windows PowerShell 請改用 --steps 檔）`) } }
    else if (a === '--out') o.out = v()
    else if (a === '--format') o.format = v()
    else if (a === '--filter') o.filter = v()
    else if (a === '--offset') o.offset = Number(v())
    else if (a === '--limit') o.limit = Number(v())
    else if (a === '--chrome') o.chrome = v()
    else if (a === '--port') o.port = Number(v())
    else if (a === '--timeout') o.timeout = Number(v())
    else die(`不認得的選項 ${a}`)
  }
  return o
}

/** PDF 里有几页（数 /Type /Page·不算 /Pages） */
export const pdfPageCount = (buf) => (buf.toString('latin1').match(/\/Type\s*\/Page(?![a-zA-Z])/g) || []).length

async function main() {
  const o = parse(process.argv.slice(2))
  if (!CMDS.includes(o.cmd)) die(`第一個參數要是 ${CMDS.join('、')}`)
  if (!existsSync(CORE)) die(`缺 ${CORE}：先在這個資料夾跑 npm run build`)
  const core = await import(pathToFileURL(CORE).href)
  if (o.cmd === 'commands') { process.stdout.write(JSON.stringify(core.cliCommands(o.filter), null, 1) + '\n'); return }
  if (!o.project) die('要給工程資料夾或 project.json')
  const file = projectFile(o.project), dir = dirname(file)
  let loaded
  try { loaded = core.cliLoad(readFileSync(file, 'utf8')) } catch (e) { die(`讀不進 ${file}：${e.message}`, 1) }
  const missing = loaded.assets.filter((n) => !existsSync(join(dir, 'assets', n)))
  const issues = [...loaded.issues, ...missing.map((n) => ({ code: 'asset_missing', text: `assets/${n} 找不到（正文或組件引用了它）` }))]
  const report = () => { if (issues.length) { console.error(`讀檔報告（${issues.length} 條）：`); for (const x of issues) console.error(`  - [${x.code}] ${x.text}`) } }
  if (o.cmd === 'check') {
    report()
    if (!issues.length) console.log('讀檔檢查：0 條問題')
    process.exitCode = issues.length ? 1 : 0
    return
  }
  if (o.cmd === 'read') { process.stdout.write(JSON.stringify(core.cliRead(loaded.doc, { offset: o.offset, limit: o.limit }), null, 1) + '\n'); return }
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
  // export
  if (!core.CLI_EXPORT_FORMATS.includes(o.format)) die(`--format 要是 ${core.CLI_EXPORT_FORMATS.join('、')}`)
  const base = core.exportBaseName(loaded.doc)
  const dest = outPath(o.out, dir, base, o.format)
  report()
  if (o.format === 'md') {
    const r = core.cliExportMd(loaded.doc)
    mkdirSync(dirname(dest), { recursive: true }); writeFileSync(dest, r.text)
    console.log(`已存：${dest}`)
    if (r.notes.length) console.log(`帶不過去的：${r.notes.join('、')}`)
    return
  }
  if (o.format === 'pdf' && !loaded.doc.paper.paper) die('這份文件的紙張是「不分頁」（project.json 的 paper.paper 是 null），文件頁這時沒有「列印」，也就沒有 PDF。把 paper 設成 a4-portrait 之類再匯出。', 1)
  const page = await openPage({ app: 'docs', port: o.port, chrome: o.chrome, timeout: o.timeout, project: readProject(dir) })
  let code = 0
  try {
    if (o.format === 'docx') {
      const r = await page.job({ kind: 'export', format: 'docx' })
      if (!r || !r.ok) { console.error(`匯出失敗：${r && (r.message || r.error)}`); code = 1; return }
      const buf = fileBytes(r.result.files[0])
      mkdirSync(dirname(dest), { recursive: true }); writeFileSync(dest, buf)
      console.log(`已存：${dest}（${buf.length} 位元組）`)
      return
    }
    // PDF：等纸张视图排好（纸张出来、正文进编辑器、字型载完、页数连三次不变）再列印
    const want = loaded.doc.content.trim().length > 0
    let last = -1, same = 0
    for (let i = 0; ; i++) {
      const s = await page.evaluate(`(async () => { const sh = document.querySelector('[data-testid=doc-pg-sheets]'); const pm = document.querySelector('.ProseMirror'); await (document.fonts ? document.fonts.ready : null); return { n: sh ? Number(sh.getAttribute('data-page-count')) : 0, text: pm ? pm.textContent.length : 0, fonts: document.fonts ? document.fonts.status : 'loaded' } })()`)
      const ready = s.n > 0 && (!want || s.text > 0) && s.fonts === 'loaded'
      if (ready && s.n === last) same++; else same = 0
      last = ready ? s.n : -1
      if (same >= 3) break
      if (i * 0.4 > o.timeout) throw new Error('紙張視圖排不好（逾時）')
      await new Promise((r) => setTimeout(r, 400))
    }
    const r = await page.cdp.send('Page.printToPDF', { printBackground: true, preferCSSPageSize: true }, page.session)
    const buf = Buffer.from(r.data, 'base64')
    mkdirSync(dirname(dest), { recursive: true }); writeFileSync(dest, buf)
    console.log(`已存：${dest}（${pdfPageCount(buf)} 頁·文件頁上 ${last} 頁·${buf.length} 位元組）`)
  } finally { page.stop(); process.exitCode = code }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e && e.message ? e.message : e); process.exit(1) })

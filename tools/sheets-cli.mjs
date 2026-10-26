#!/usr/bin/env node
// Dilin Studio 表格命令列版：不开浏览器，直接对工程资料夹（project.json＋assets/）做事。零依赖（node 内建）。
// 跟表格页同一套程式（app/sheets-cli-core.mjs·npm run build 时从 src/studio/sheets/cli-core.ts 打出来）：
//   读档检查（表格页开档时会丢掉／改掉的每一条都列出来）、读格（公式算好）、改格与表格操作（同 MCP sheets_run／网站 update_cells）、汇出汇入 xlsx／csv。
//
// 跑法：
//   node tools/sheets-cli.mjs check <工程资料夹或 project.json>                 ⇒ 读档报告；有问题退出码 1
//   node tools/sheets-cli.mjs get <工程> [--sheet <名或 id>] [--range A1:D10] [--formats] [--offset N] [--limit N]
//        ⇒ 印出格子（JSON：input＝原文或公式、value＝算出来的值、display＝格子里显示的字）
//   node tools/sheets-cli.mjs set <工程> --range A1 (--values '<[["品項","金額"],["房租",12000],["合計","=SUM(B2:B2)"]]>' | --file <values.json>) [--sheet <名>] [--out <另存资料夹>]
//        ⇒ 写值／公式（"=" 开头是公式），重算后写回 project.json，印出写进去那块算好的值
//   node tools/sheets-cli.mjs run <工程> (--steps <steps.json> | --step '<{"op":…}>' …) [--sheet <名>] [--out <另存资料夹>]
//        ⇒ 照步骤跑表格操作（每步 {"op":…}，可带 "sheet"；op 见 commands），全有或全无；成了写回 project.json
//   node tools/sheets-cli.mjs commands [--filter <字>]                          ⇒ 操作与参数（JSON）
//   node tools/sheets-cli.mjs export <工程> --format xlsx|csv [--sheet <名>] [--out <档或资料夹>]
//        ⇒ xlsx＝整份（给 --sheet 只出那张）、csv＝一张（缺省第一张）；缺省存在工程资料夹
//   node tools/sheets-cli.mjs import <档.xlsx|.xls|.csv> [--out <新工程资料夹>] [--values-only]
//        ⇒ 读进来建一份新工程（缺省＝档旁边「<名>-dilin」）；图拷进 assets/
// Windows PowerShell 会吃掉 --values／--step 里 JSON 的引号：请把值写进 values.json 用 --file、步骤写进 steps.json 用 --steps。
// 页面开着的话，写回后表格页约 1.5 秒内会自己重新载入。

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const CORE = join(HERE, '..', 'app', 'sheets-cli-core.mjs')
const CMDS = ['check', 'get', 'set', 'run', 'commands', 'export', 'import']
const PS_HINT = '（Windows PowerShell 會吃掉 JSON 裡的引號：值寫進檔案用 --file、步驟寫進檔案用 --steps）'

function die(msg, code = 2) { console.error(msg); console.error('用法：node tools/sheets-cli.mjs check|get|set|run|commands|export|import …（見檔頭說明）'); process.exit(code) }

export function parse(argv) {
  const o = { cmd: argv[0], steps: [] }
  let i = 1
  if (o.cmd && o.cmd !== 'commands' && argv[1] && !argv[1].startsWith('--')) { o.project = argv[1]; i = 2 }
  const json = (a, s) => { try { return JSON.parse(s) } catch (e) { die(`${a} 不是合法的 JSON：${e.message}${PS_HINT}`) } }
  const int = (a, s) => { const n = Number(s); if (!Number.isInteger(n) || n < 0) die(`${a} 要是 0 以上的整數`); return n }
  for (; i < argv.length; i++) {
    const a = argv[i], v = () => { if (i + 1 >= argv.length) die(`${a} 後面要接值`); return argv[++i] }
    if (a === '--steps') o.stepsFile = v()
    else if (a === '--step') o.steps.push(json(a, v()))
    else if (a === '--values') o.values = json(a, v())
    else if (a === '--file') o.file = v()
    else if (a === '--range') o.range = v()
    else if (a === '--sheet') o.sheet = v()
    else if (a === '--out') o.out = v()
    else if (a === '--format') o.format = v()
    else if (a === '--filter') o.filter = v()
    else if (a === '--offset') o.offset = int(a, v())
    else if (a === '--limit') o.limit = int(a, v())
    else if (a === '--formats') o.formats = true
    else if (a === '--values-only') o.valuesOnly = true
    else die(`不認得的選項 ${a}`)
  }
  return o
}

/** 工程资料夹或 project.json ⇒ project.json 的完整路径 */
export function projectFile(p) {
  if (!existsSync(p)) die(`找不到 ${p}`)
  const f = statSync(p).isDirectory() ? join(p, 'project.json') : p
  if (!existsSync(f)) die(`找不到 ${f}`)
  return resolve(f)
}

const readJson = (f, what) => { try { return JSON.parse(readFileSync(resolve(f), 'utf8')) } catch (e) { die(`讀不進${what} ${f}：${e.message}`) } }
const print = (x) => process.stdout.write(JSON.stringify(x, null, 1) + '\n')

async function main() {
  const o = parse(process.argv.slice(2))
  if (!CMDS.includes(o.cmd)) die(`第一個參數要是 ${CMDS.join('、')}`)
  if (!existsSync(CORE)) die(`缺 ${CORE}：先在這個資料夾跑 npm run build`)
  const core = await import(pathToFileURL(CORE).href)
  if (o.cmd === 'commands') { print(core.cliCommands(o.filter)); return }
  if (!o.project) die(o.cmd === 'import' ? '要給 .xlsx／.xls／.csv 檔' : '要給工程資料夾或 project.json')
  if (o.cmd === 'import') { importFile(core, o); return }
  const file = projectFile(o.project)
  let loaded
  try { loaded = core.cliLoad(readFileSync(file, 'utf8')) } catch (e) { die(`讀不進 ${file}：${e.message}`, 1) }
  const report = (issues) => { if (issues.length) { console.error(`讀檔報告（${issues.length} 條·表格頁開檔時會這樣處理）：`); for (const x of issues) console.error(`  - [${x.code}] ${x.text}`) } }
  const save = (doc) => {
    const out = o.out ? join(resolve(o.out), 'project.json') : file
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, core.cliSave(doc))
    return out
  }
  if (o.cmd === 'check') {
    report(loaded.issues)
    if (!loaded.issues.length) console.log(`讀檔檢查：0 條問題（${loaded.doc.sheets.length} 張表：${loaded.doc.sheets.map((t) => t.name).join('、')}）`)
    process.exitCode = loaded.issues.length ? 1 : 0
    return
  }
  if (o.cmd === 'get') {
    report(loaded.issues)
    const r = core.cliGet(loaded.doc, { sheet: o.sheet, range: o.range, offset: o.offset, limit: o.limit, formats: o.formats })
    if (!r.ok) die(r.error, 1)
    print(r.result)
    return
  }
  if (o.cmd === 'set' || o.cmd === 'run') {
    let steps
    if (o.cmd === 'set') {
      if (!o.range) die('要給 --range（左上那格，例如 A1；或跟值一樣大的範圍）')
      const values = o.file ? readJson(o.file, '值檔') : o.values
      if (values === undefined) die(`要給 --values '[[…]]' 或 --file <values.json>${PS_HINT}`)
      if (!Array.isArray(values) || !values.every(Array.isArray)) die('值要是二維陣列，例如 [["品項","金額"],["房租",12000]]')
      steps = [{ op: 'set', range: o.range, values }]
    } else {
      steps = [...o.steps]
      if (o.stepsFile) { const s = readJson(o.stepsFile, '步驟檔'); if (!Array.isArray(s)) die('--steps 檔要是陣列（每項 {"op":…}）'); steps.unshift(...s) }
      if (!steps.length) die(`要給 --steps <steps.json> 或 --step '{"op":…}'${PS_HINT}`)
    }
    report(loaded.issues)
    const r = core.cliRun(loaded.doc, steps, { sheet: o.sheet })
    if (!r.ok) { console.error(r.error); process.exitCode = 1; return }
    const saved = r.changed || o.out ? save(r.doc) : null
    const out = { ok: true, changed: r.changed, results: r.results, ...(r.warnings.length ? { warnings: r.warnings } : {}), saved }
    if (o.cmd === 'set') {
      // 写进去那块重算后的值（公式算好）
      const res = r.results[0] || {}
      const back = core.cliGet(r.doc, { sheet: res.sheet, range: res.range || o.range })
      if (back.ok) out.cells = back.result.cells.map((c) => ({ cell: c.cell, input: c.input, value: c.value, display: c.display }))
    }
    print(out)
    return
  }
  // export
  if (!core.CLI_EXPORT_FORMATS.includes(o.format)) die(`--format 要是 ${core.CLI_EXPORT_FORMATS.join('、')}`)
  const assets = join(dirname(file), 'assets')
  const r = await core.cliExport(loaded.doc, o.format, {
    sheet: o.sheet,
    readAsset: (name) => { const p = join(assets, name); return !/[\\/]/.test(name) && existsSync(p) ? new Uint8Array(readFileSync(p)) : null },
  })
  if (!r.ok) die(r.error, 1)
  let dest
  if (o.out && extname(o.out).toLowerCase() === `.${o.format}`) dest = resolve(o.out)
  else dest = join(o.out ? resolve(o.out) : dirname(file), r.file.name)
  mkdirSync(dirname(dest), { recursive: true })
  writeFileSync(dest, r.file.bytes)
  report(loaded.issues)
  console.log(`已存：${dest}`)
  if (r.notes.length) console.log(`提醒：${r.notes.join('；')}`)
}

/** 汇入 xlsx／csv：读档 ⇒ 新工程资料夹（project.json＋assets/ 的图）；已有 project.json 的资料夹不覆盖 */
function importFile(core, o) {
  const src = resolve(o.project)
  if (!existsSync(src) || !statSync(src).isFile()) die(`找不到檔案 ${src}`)
  const r = core.cliImport(new Uint8Array(readFileSync(src)), basename(src), { formulas: o.valuesOnly ? 'values' : 'keep' })
  if (!r.ok) die(`讀不進 ${src}：${r.error}`, 1)
  const out = resolve(o.out ?? join(dirname(src), `${r.name.replace(/[\\/:*?"<>|]/g, '_')}-dilin`))
  if (existsSync(join(out, 'project.json'))) die(`${out} 裡已經有 project.json，不覆蓋（換一個 --out）`)
  mkdirSync(out, { recursive: true })
  if (r.assets.length) { mkdirSync(join(out, 'assets'), { recursive: true }); for (const a of r.assets) writeFileSync(join(out, 'assets', a.name), a.bytes) }
  writeFileSync(join(out, 'project.json'), r.json)
  const s = r.stats
  console.log(`已匯入：${s.sheets} 張表、${s.cells} 格（公式 ${s.formulas}）、${r.assets.length} 張圖 ⇒ ${join(out, 'project.json')}`)
  if (r.warnings.length) console.log(`提醒：${r.warnings.join('；')}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e && e.message ? e.message : e); process.exit(1) })

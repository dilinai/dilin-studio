// 表格列印：设定净化与存取往返、分页纯函数（五种缩放／标题列栏／栏列标题／方向／置中／筛选藏列）、选取范围、xlsx 版面设定写读往返（＋openpyxl 独立读者）、AI 读表带出 print。
// 跑法（在 studio 根目录跑）：node -e "require('sucrase/register/ts');require('./sheets/print.test.ts')"
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { sanitizePrint, resolvePrint, planPrint, printRect, printUsedRect, hfText, PRINT_DEFAULTS, MARGIN_PRESET_CM, cmToPx, type SheetPrint } from './engine/print'
import { printXmlParts, printDefinedNames, readPrintXml, readPrintDefinedNames } from './engine/print-xlsx'
import { sanitizeSheetContent } from './engine/content'
import { docFromJson, docToJson } from './format'
import { buildXlsxBytes, parseXlsx } from './engine/xlsx-io'
import { readRange, type AgentContent } from './engine/agent-ops'
import { SHEETS_I18N } from './i18n'

let passed = 0, failed = 0
const queue: Array<[string, () => void | Promise<void>]> = []
const t = (name: string, fn: () => void | Promise<void>) => { queue.push([name, fn]) }

const setup = (p: Partial<SheetPrint> = {}): SheetPrint => sanitizePrint({ ...PRINT_DEFAULTS, ...p })!
/** n 栏 × m 列、每格有值的表 */
function grid(cols: number, rows: number): AgentContent {
  const cells: AgentContent['cells'] = {}
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells![`${String.fromCharCode(65 + c)}${r + 1}`] = { v: String(r * cols + c) }
  return { cells }
}
const R = (r0: number, c0: number, r1: number, c1: number) => ({ r0, c0, r1, c1 })

// ── ① 设定净化／默认／存取往返 ─────────────────────────────────────────

t('①a 没设过 ⇒ 默认（A4 直式 标准边界 不缩放 整张表）', () => {
  const d = resolvePrint({ cells: {} } as never)
  assert.equal(d.paper, 'A4'); assert.equal(d.orientation, 'portrait'); assert.equal(d.scope, 'sheet'); assert.equal(d.scaleMode, 'none')
  assert.deepEqual(d.margins, MARGIN_PRESET_CM.normal)
  assert.equal(d.gridlines, false); assert.deepEqual(d.header, {})
  assert.equal(sanitizePrint(undefined), undefined); assert.equal(sanitizePrint('x'), undefined); assert.equal(sanitizePrint([1]), undefined)
})

t('①b 坏栏位回默认·不整份拒；预设边界不吃自带数字；自订夹 0–10 公分；缩放夹 10–400', () => {
  const p = sanitizePrint({ paper: 'A9', orientation: 'up', scope: 'range', marginPreset: 'wide', margins: { top: 99 }, scaleMode: 'custom', scale: 999, titleRows: '$1:$2', titleCols: 'b', gridlines: 'yes', headings: true, header: { l: 'sheet', c: 'bogus', r: 'page' } })!
  assert.equal(p.paper, 'A4'); assert.equal(p.orientation, 'portrait')
  assert.equal(p.scope, 'sheet', 'range 没给区间 ⇒ 退回整张表')
  assert.deepEqual(p.margins, MARGIN_PRESET_CM.wide)
  assert.equal(p.scale, 400)
  assert.equal(p.titleRows, '1:2'); assert.equal(p.titleCols, 'B:B')
  assert.equal(p.gridlines, false); assert.equal(p.headings, true)
  assert.deepEqual(p.header, { l: 'sheet', r: 'page' })
  const c = sanitizePrint({ marginPreset: 'custom', margins: { top: -3, bottom: 12, left: '1.5', right: 2.345, header: 0.5, footer: 0.5 }, scaleMode: 'custom', scale: 3, scope: 'range', range: 'f30:a1' })!
  assert.deepEqual(c.margins, { top: 0, bottom: 10, left: 1.5, right: 2.35, header: 0.5, footer: 0.5 })
  assert.equal(c.scale, 10)
  assert.equal(c.scope, 'range'); assert.equal(c.range, 'A1:F30')
})

t('①c 存库闸（sanitizeSheetContent）保留 print；旧档无此栏 ⇒ 不长出 print、读出默认', () => {
  const want = setup({ paper: 'A3', orientation: 'landscape', scaleMode: 'fitCols', titleRows: '1:1', gridlines: true, footer: { c: 'page' } })
  const saved = sanitizeSheetContent(JSON.parse(JSON.stringify({ cells: { A1: { v: 'x' } }, print: want })))!
  assert.deepEqual(saved.print, want)
  // 重开：存进库的 JSON 再读一次（再过一次闸）＝同一份
  assert.deepEqual(resolvePrint(sanitizeSheetContent(JSON.parse(JSON.stringify(saved)))), want)
  const old = sanitizeSheetContent({ cells: { A1: { v: 'x' } } })!
  assert.equal('print' in old, false)
  assert.deepEqual(resolvePrint(old), resolvePrint(null))
})

t('①d 游客版工程档 project.json 往返（每张分页各自一份）', () => {
  const a = setup({ paper: 'Letter', hCenter: true }), b = setup({ paper: 'B5', orientation: 'landscape', scaleMode: 'custom', scale: 75 })
  const doc = docFromJson({ format: 'dilin-studio/sheets', version: 1, name: 'x', sheets: [{ id: 's1', name: '甲', content: { cells: {}, print: a } }, { id: 's2', name: '乙', content: { cells: {}, print: b } }, { id: 's3', name: '丙', content: { cells: {} } }] })
  const back = docFromJson(JSON.parse(JSON.stringify(docToJson(doc))))
  assert.deepEqual(back.sheets[0].content.print, a)
  assert.deepEqual(back.sheets[1].content.print, b)
  assert.equal(back.sheets[2].content.print, undefined)
})

// ── ② 分页 ────────────────────────────────────────────────────────────

// A4 直式 标准边界：可印宽 21−1.78×2＝17.44cm≈659.2px（6 栏×96）·可印高 29.7−1.91×2＝25.88cm≈978.1px（34 列×28）
t('②a 不缩放：20 栏×100 列 ⇒ 每页 6 栏 34 列·4×3＝12 页·先往下再往右', () => {
  const c = grid(20, 100)
  const p = planPrint({ content: c, setup: setup(), rect: R(0, 0, 99, 19) })
  assert.equal(p.scale, 1)
  assert.equal(p.pages.length, 12)
  assert.deepEqual(p.pages[0].cols, [0, 1, 2, 3, 4, 5]); assert.equal(p.pages[0].rows.length, 34); assert.equal(p.pages[0].rows[0], 0)
  assert.deepEqual(p.pages[1].cols, [0, 1, 2, 3, 4, 5], '第 2 页＝同一组栏的下一段（先往下）'); assert.equal(p.pages[1].rows[0], 34)
  assert.equal(p.pages[3].cols[0], 6, '第 4 页才往右')
  assert.deepEqual(p.pages.at(-1)!.cols, [18, 19]); assert.equal(p.pages.at(-1)!.rows.length, 32)
  assert.ok(Math.abs(p.paperW - cmToPx(21)) < 0.01 && Math.abs(p.paperH - cmToPx(29.7)) < 0.01)
})

t('②b 整张塞进一页：一页·倍率＝两向较小者', () => {
  const p = planPrint({ content: grid(20, 100), setup: setup({ scaleMode: 'fitSheet' }), rect: R(0, 0, 99, 19) })
  assert.equal(p.pages.length, 1)
  const want = Math.min((cmToPx(21) - 2 * cmToPx(1.78)) / 1920, (cmToPx(29.7) - 2 * cmToPx(1.91)) / 2800)
  assert.ok(Math.abs(p.scale - want) < 1e-9, `scale ${p.scale} vs ${want}`)
  assert.equal(p.pages[0].cols.length, 20); assert.equal(p.pages[0].rows.length, 100)
  // 只缩不放：小表照 100%
  assert.equal(planPrint({ content: grid(2, 2), setup: setup({ scaleMode: 'fitSheet' }), rect: R(0, 0, 1, 1) }).scale, 1)
})

t('②c 所有栏塞进一页宽：栏不分页·列照分页', () => {
  const p = planPrint({ content: grid(20, 300), setup: setup({ scaleMode: 'fitCols' }), rect: R(0, 0, 299, 19) })
  assert.ok(p.pages.every(pg => pg.cols.length === 20))
  assert.ok(Math.abs(p.scale - (cmToPx(21) - 2 * cmToPx(1.78)) / 1920) < 1e-9)
  assert.equal(p.pages.length, Math.ceil(300 / Math.floor(p.areaH / 28)))
  assert.ok(p.pages.length > 1)
})

t('②d 所有列塞进一页高：列不分页·栏照分页', () => {
  const p = planPrint({ content: grid(20, 100), setup: setup({ scaleMode: 'fitRows' }), rect: R(0, 0, 99, 19) })
  assert.ok(p.pages.every(pg => pg.rows.length === 100))
  assert.ok(Math.abs(p.scale - (cmToPx(29.7) - 2 * cmToPx(1.91)) / 2800) < 1e-9)
  assert.equal(p.pages.length, 2)
})

t('②e 自订 50%：每页可放的栏列翻倍', () => {
  const p = planPrint({ content: grid(20, 100), setup: setup({ scaleMode: 'custom', scale: 50 }), rect: R(0, 0, 99, 19) })
  assert.equal(p.scale, 0.5)
  assert.equal(p.pages[0].cols.length, 13); assert.equal(p.pages[0].rows.length, 69)
  assert.equal(p.pages.length, 4)
})

t('②f 横式：纸宽高对调·每页栏多列少', () => {
  const p = planPrint({ content: grid(20, 100), setup: setup({ orientation: 'landscape' }), rect: R(0, 0, 99, 19) })
  assert.ok(Math.abs(p.paperW - cmToPx(29.7)) < 0.01)
  assert.equal(p.pages[0].cols.length, 10, '可印宽 29.7−3.56＝26.14cm≈988px'); assert.equal(p.pages[0].rows.length, 23, '可印高 21−3.82＝17.18cm≈649px')
})

t('②g 每页重复标题列／栏：第 2 页起补印·且占掉那页的空间', () => {
  const p = planPrint({ content: grid(20, 100), setup: setup({ titleRows: '1:1', titleCols: 'A:A' }), rect: R(0, 0, 99, 19) })
  assert.deepEqual(p.pages[0].titleRows, []); assert.deepEqual(p.pages[0].titleCols, [])
  assert.deepEqual(p.pages[1].titleRows, [0]); assert.equal(p.pages[1].rows.length, 33, '补印一列标题 ⇒ 少放一列')
  assert.deepEqual(p.pages[3].titleCols, [0]); assert.equal(p.pages[3].cols.length, 5)
  // 列印范围在标题之后（A10 起）⇒ 第 1 页也补
  const q = planPrint({ content: grid(5, 100), setup: setup({ titleRows: '1:2' }), rect: R(9, 0, 99, 4) })
  assert.deepEqual(q.pages[0].titleRows, [0, 1])
})

t('②h 印栏列标题：每页占掉一条标题宽高（塞进一页的倍率也算进去）', () => {
  const p = planPrint({ content: grid(20, 100), setup: setup({ headings: true }), rect: R(0, 0, 99, 19) })
  assert.equal(p.headW, 36); assert.equal(p.headH, 20)
  assert.equal(p.pages[0].rows.length, 34)
  assert.equal(planPrint({ content: grid(20, 100), setup: setup({ headings: true, scaleMode: 'fitCols' }), rect: R(0, 0, 99, 19) }).scale, (cmToPx(21) - 2 * cmToPx(1.78)) / (1920 + 36))
})

t('②i 水平／垂直置中：位移＝剩余空间一半', () => {
  const p = planPrint({ content: grid(2, 2), setup: setup({ hCenter: true, vCenter: true }), rect: R(0, 0, 1, 1) })
  assert.ok(Math.abs(p.pages[0].offsetX - (p.areaW - 192) / 2) < 1e-9)
  assert.ok(Math.abs(p.pages[0].offsetY - (p.areaH - 56) / 2) < 1e-9)
  const q = planPrint({ content: grid(2, 2), setup: setup(), rect: R(0, 0, 1, 1) })
  assert.equal(q.pages[0].offsetX, 0); assert.equal(q.pages[0].offsetY, 0)
})

t('②j 筛选藏起来的列不印；自订边界改变每页容量；列高栏宽照存的像素', () => {
  const c: AgentContent = { ...grid(3, 10), filter: { range: 'A1:C10', criteria: { A: { values: ['0', '3', '6'] } } } } as AgentContent
  const p = planPrint({ content: c, setup: setup(), rect: R(0, 0, 9, 2) })
  assert.deepEqual(p.pages[0].rows, [0, 1, 2], '只剩表头＋两列')
  const wide = planPrint({ content: { ...grid(20, 5), colWidths: { A: 300 } }, setup: setup({ marginPreset: 'custom', margins: { top: 1, bottom: 1, left: 0, right: 0, header: 0.5, footer: 0.5 } }), rect: R(0, 0, 4, 19) })
  assert.deepEqual(wide.pages[0].cols, [0, 1, 2, 3, 4, 5], '可印宽 21cm≈793px：300＋5×96＝780')
})

// ── ③ 列印范围 ─────────────────────────────────────────────────────────

t('③a 目前选取：只印选取那块（别的格一格都不进页面）', () => {
  const c = grid(10, 40)
  const s = setup({ scope: 'selection' })
  const rect = printRect(c, s, 'B2:C3')
  assert.deepEqual(rect, R(1, 1, 2, 2))
  const p = planPrint({ content: c, setup: s, rect })
  assert.equal(p.pages.length, 1)
  assert.deepEqual(p.pages[0].rows, [1, 2]); assert.deepEqual(p.pages[0].cols, [1, 2])
})

t('③b 自订范围 A1:F30 与整张表（有值／底色／框线／合并／浮图都算进外框）', () => {
  const c: AgentContent = { cells: { B2: { v: '1' }, H3: { s: { bg: '#ff0000' } }, C40: { s: { border: { b: { style: 'thin' } } } }, Z1: { s: { b: true } } }, merges: ['D5:E6'], images: [{ id: 'i', url: 'assets/y.png', cell: 'J10', w: 200, h: 30 }] }
  assert.deepEqual(printRect(c, setup({ scope: 'range', range: 'A1:F30' })), R(0, 0, 29, 5))
  // 只有粗体没有值的 Z1 不算；图从 J10 起 200px 宽 ⇒ 盖到 L 栏（96＋96＋8）
  assert.deepEqual(printUsedRect(c), R(1, 1, 39, 11))
  assert.deepEqual(printRect({ cells: {} }, setup()), R(0, 0, 0, 0))
})

t('③c 页首页尾字：表名／文件名／第 n 页共 m 页／日期（三语字典都有页码格式）', () => {
  const ctx = { sheet: '表格1', title: '月報', date: '2026/10/23', page: 2, pages: 5, pageFmt: SHEETS_I18N['zh-TW'].sheet_print_page_fmt }
  assert.equal(hfText('sheet', ctx), '表格1'); assert.equal(hfText('title', ctx), '月報'); assert.equal(hfText('date', ctx), '2026/10/23')
  assert.equal(hfText('page', ctx), '第 2 頁／共 5 頁')
  assert.equal(hfText(undefined, ctx), '')
  assert.equal(hfText('page', { ...ctx, pageFmt: SHEETS_I18N.en.sheet_print_page_fmt }), 'Page 2 of 5')
  assert.equal(hfText('page', { ...ctx, pageFmt: SHEETS_I18N['zh-CN'].sheet_print_page_fmt }), '第 2 页／共 5 页')
})

// ── ④ xlsx 写读往返 ────────────────────────────────────────────────────

const P1 = setup({ scope: 'range', range: 'A1:F30', paper: 'A3', orientation: 'landscape', marginPreset: 'narrow', scaleMode: 'fitCols', titleRows: '1:2', titleCols: 'A:A', gridlines: true, headings: true, hCenter: true, vCenter: true, header: { l: 'sheet', c: 'title' }, footer: { c: 'page', r: 'date' } })
const P2 = setup({ paper: 'Legal', scaleMode: 'custom', scale: 85, marginPreset: 'custom', margins: { top: 1, bottom: 1.5, left: 2, right: 2.5, header: 0.3, footer: 0.4 } })
const P3 = setup({ paper: 'B5', scaleMode: 'fitSheet', marginPreset: 'wide' })
const P4 = setup({ paper: 'Letter', scaleMode: 'fitRows', titleRows: '3:3' })
function workbook() {
  return [
    { name: '甲', content: { cells: { A1: { v: '標題' }, B2: { v: '5' } }, filter: { range: 'A1:B5' }, print: P1 } as AgentContent },
    { name: "乙's", content: { cells: { A1: { v: 'x' } }, print: P2 } as AgentContent },
    { name: '丙', content: { cells: { A1: { v: 'y' } } } as AgentContent },
    { name: '丁', content: { cells: { A1: { v: 'z' } }, print: P3 } as AgentContent },
    { name: '戊', content: { cells: { A1: { v: 'w' } }, print: P4 } as AgentContent },
  ]
}

t('④a 汇出再汇入：每张分页的列印设定原样回来；没设的那张仍没有', () => {
  const back = parseXlsx(buildXlsxBytes(workbook()))
  assert.deepEqual(back.sheets[0].content.print, P1)
  assert.deepEqual(back.sheets[1].content.print, P2)
  assert.equal(back.sheets[2].content.print, undefined)
  assert.deepEqual(back.sheets[3].content.print, P3)
  assert.deepEqual(back.sheets[4].content.print, P4)
  assert.ok(back.sheets[0].content.filter, '筛选的定义名并存不打架')
  // 汇入后过存库闸照样留着
  assert.deepEqual(sanitizeSheetContent(back.sheets[0].content)!.print, P1)
})

t('④b XML 形状：元素名与顺序照 ECMA-376（sheetPr 最前·printOptions→pageMargins→pageSetup→headerFooter 在 drawing 之前）', () => {
  const x = printXmlParts({ print: P1 })
  assert.equal(x.sheetPr, '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>')
  assert.match(x.tail, /^<printOptions horizontalCentered="1" verticalCentered="1" headings="1" gridLines="1"\/><pageMargins left="0\.252" right="0\.252" top="0\.752" bottom="0\.752" header="0\.2992" footer="0\.2992"\/><pageSetup paperSize="8" fitToWidth="1" fitToHeight="0" orientation="landscape"\/><headerFooter><oddHeader>&amp;L&amp;A&amp;C&amp;F<\/oddHeader><oddFooter>&amp;C&amp;P \/ &amp;N&amp;R&amp;D<\/oddFooter><\/headerFooter>$/)
  assert.equal(printXmlParts({ print: P2 }).sheetPr, '')
  assert.match(printXmlParts({ print: P2 }).tail, /<pageSetup paperSize="5" scale="85" orientation="portrait"\/>/)
  assert.deepEqual(printXmlParts({}), { sheetPr: '', tail: '' })
  const names = printDefinedNames([{ sheetName: "乙's", index: 1, content: { print: { ...P1 } } }])
  assert.equal(names, `<definedName name="_xlnm.Print_Area" localSheetId="1">'乙''s'!$A$1:$F$30</definedName><definedName name="_xlnm.Print_Titles" localSheetId="1">'乙''s'!$A:$A,'乙''s'!$1:$2</definedName>`)
  // 读回小工具：Excel 自己写的样子（有前缀 x:、属性单引号、只有 Print_Titles 行）
  const m = readPrintDefinedNames(`<x:workbook><x:definedNames><x:definedName name='_xlnm.Print_Titles' localSheetId='0'>Sheet1!$1:$1</x:definedName><x:definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">Sheet1!$A$1:$B$2</x:definedName></x:definedNames></x:workbook>`)
  assert.deepEqual(m.get(0), { titleRows: '1:1' })
  assert.equal(readPrintXml('<worksheet><pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>'), undefined, 'Excel 默认的空档 ⇒ 不长出 print')
})

t('④c 独立读者 openpyxl 读同一份档：纸张／方向／缩放／边界／列印范围／标题／格线／页首页尾（本机没 openpyxl ⇒ 照实报跳过）', () => {
  let py = ''
  try { execFileSync('python3', ['-c', 'import openpyxl'], { stdio: 'ignore' }); py = 'python3' } catch { console.log('  · 跳过：本机没有 openpyxl'); return }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sheet-print-'))
  const f = path.join(dir, 'p.xlsx')
  fs.writeFileSync(f, buildXlsxBytes(workbook()))
  const code = `
import json, sys, openpyxl
wb = openpyxl.load_workbook(sys.argv[1])
out = []
for ws in wb.worksheets:
    ps = ws.page_setup; pm = ws.page_margins; po = ws.print_options
    out.append(dict(name=ws.title, paper=ps.paperSize, orient=ps.orientation, scale=ps.scale, fw=ps.fitToWidth, fh=ps.fitToHeight,
      fit=bool(ws.sheet_properties.pageSetUpPr and ws.sheet_properties.pageSetUpPr.fitToPage),
      left=pm.left, top=pm.top, area=ws.print_area, trows=ws.print_title_rows, tcols=ws.print_title_cols,
      grid=bool(po.gridLines), head=bool(po.headings), hc=bool(po.horizontalCentered), vc=bool(po.verticalCentered),
      hl=ws.oddHeader.left.text, hcen=ws.oddHeader.center.text, fc=ws.oddFooter.center.text, fr=ws.oddFooter.right.text))
print(json.dumps(out))`
  const got = JSON.parse(execFileSync(py, ['-c', code, f], { encoding: 'utf8' })) as Array<Record<string, unknown>>
  assert.equal(got[0].paper, 8); assert.equal(got[0].orient, 'landscape'); assert.equal(got[0].fit, true); assert.equal(Number(got[0].fw), 1); assert.equal(Number(got[0].fh), 0)
  assert.match(String(got[0].area), /甲'?!\$A\$1:\$F\$30$/)
  assert.equal(got[0].trows, '$1:$2'); assert.equal(got[0].tcols, '$A:$A')
  assert.equal(got[0].grid, true); assert.equal(got[0].head, true); assert.equal(got[0].hc, true); assert.equal(got[0].vc, true)
  assert.equal(got[0].hl, '&A'); assert.equal(got[0].hcen, '&F'); assert.equal(got[0].fc, '&P / &N'); assert.equal(got[0].fr, '&D')
  assert.ok(Math.abs(Number(got[0].left) - 0.252) < 0.001)
  assert.equal(got[1].paper, 5); assert.equal(Number(got[1].scale), 85); assert.equal(got[1].fit, false)
  assert.ok(Math.abs(Number(got[1].top) - 1 / 2.54) < 0.001)
  assert.ok(!got[2].area, '没设列印范围那张 ⇒ 空')
  assert.equal(got[3].paper, 13); assert.equal(Number(got[3].fw), 1); assert.equal(Number(got[3].fh), 1)
  assert.equal(got[4].paper, 1); assert.equal(Number(got[4].fw), 0); assert.equal(Number(got[4].fh), 1); assert.equal(got[4].trows, '$3:$3')
  fs.rmSync(dir, { recursive: true, force: true })
})

// ── ⑤ AI 读表 ─────────────────────────────────────────────────────────

t('⑤ get_sheet（readRange）回包带出 print；没设过不回', () => {
  const c: AgentContent = { cells: { A1: { v: '1' } }, print: P2 } as AgentContent
  assert.deepEqual(readRange(c).print, P2)
  assert.deepEqual(readRange(c, { range: 'A1:A1' }).print, P2)
  assert.equal('print' in readRange({ cells: { A1: { v: '1' } } }), false)
})

;(async () => {
  for (const [name, fn] of queue) {
    try { await fn(); passed++; console.log('✓', name) } catch (e) { failed++; console.log('RED', name, '：', (e as Error).message) }
  }
  console.log(`print.test: passed=${passed} failed=${failed}`)
  if (failed) process.exitCode = 1
})()

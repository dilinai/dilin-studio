// 一张工作表 ⇒ CSV 文字（画面上看到的值：公式取算出的结果、数字格式照显示；RFC 4180 引号规则·CRLF 换行）。
//   只到有值的最后一行／最后一列为止；开头加 UTF-8 BOM 让 Excel 认得中文。
import { computeSheet, formatValue, isFormulaError, parseRef, type SheetContent, type EvaluatorOptions } from './formula'
import { formatWithNumFmt, type NumFmtLang } from './style'

const quote = (s: string) => (/[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)

/** opts.eval＝求值选项（跨表引用要带 book＋sheetName） */
export function sheetToCsv(content: SheetContent | null | undefined, opts: { lang?: NumFmtLang; bom?: boolean; eval?: EvaluatorOptions } = {}): string {
  const cells = content?.cells ?? {}
  const values = computeSheet(content, opts.eval)
  let maxR = -1, maxC = -1
  const grid = new Map<string, string>()
  for (const key of Object.keys(cells)) {
    const p = parseRef(key)
    if (!p) continue
    const v = values.get(key.toUpperCase())
    let text = v === undefined ? '' : formatValue(v)
    const nf = cells[key]?.s?.numFmt
    if (nf && v !== undefined && !isFormulaError(v)) {
      const f = formatWithNumFmt(nf, v, cells[key]?.v, { lang: opts.lang ?? 'zh' })
      if (f !== null) text = f
    }
    if (text === '') continue
    grid.set(`${p.row}:${p.col}`, text)
    if (p.row > maxR) maxR = p.row
    if (p.col > maxC) maxC = p.col
  }
  const lines: string[] = []
  for (let r = 0; r <= maxR; r++) {
    const row: string[] = []
    for (let c = 0; c <= maxC; c++) row.push(quote(grid.get(`${r}:${c}`) ?? ''))
    lines.push(row.join(','))
  }
  const body = lines.length ? lines.join('\r\n') + '\r\n' : ''
  return (opts.bom === false ? '' : '﻿') + body
}

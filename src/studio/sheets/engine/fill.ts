// 填充柄（右下角小点）：序列推断＋填充＋双击向下填
//
// ── 出处与授权 ──
// 本档算法抄自 univer（https://github.com/dream-num/univer ·commit 511bfd2）·Apache License 2.0·
//   Copyright 2023-present DreamNum Co., Ltd.（原档头：Licensed under the Apache License, Version 2.0 …）
//   · packages/sheets/src/services/auto-fill/tools.ts  —— 中文数字互转（chineseToNumber／numberToChinese／sectionToChinese）、isChnNumber、
//       matchExtendNumber、isChnWeek2／3、getLenS、isEqualDiff、getDataIndex、fillCopy、fillCopyStyles、isEqualRatio、forecast、fillSeries、
//       fillExtendNumber、fillChnWeek、fillChnNumber、LOOP_SERIES、isLoopSeries、getLoopSeriesInfo、fillLoopSeries
//   · packages/sheets/src/services/auto-fill/rules.ts  —— 规则表（日期／数字／带尾数字／中文数字／周X／星期X／循环序列／其他）与 isContinue 分段
//   · packages/sheets/src/controllers/auto-fill.controller.ts —— _getCopyData（按规则把一条线切成同类段）、_getApplyData（按段套函数再按
//       getDataIndex 摆回目标位）、_shouldDisableSeries（只有公式／其他 ⇒ 序列不可选）、_getPreferredApplyType（每段都是单个数字 ⇒ 预设复制）
//   · packages/sheets/src/services/auto-fill/type.ts   —— 四种套法 COPY／SERIES／ONLY_FORMAT／NO_FORMAT
//   · packages/sheets-ui/src/controllers/auto-fill-ui.controller.ts —— detectAutoFillRange（双击填充柄：先看左邻列、再看右邻列连续有值到哪一行·
//       途中目标区已有值就停在它上一行）
//   · packages/sheets-formula/src/controllers/formula-auto-fill.controller.ts —— 公式格复制时按位移平移引用（平移本体在 ./formula-refs.ts）
// 已修改（Apache-2.0 §4(b) 修改声明）：
//   1. 型别改成本仓 CellData（v 为字串·f 为公式原文·s 为格式）；数字写回 v 用 String()；
//   2. 往上／往左：univer 在各规则里各自 reverse；这里统一「镜像」——来源线倒过来（离目标最近那格在最后）、目标按离来源由近到远排，
//      套完再翻回；单个值往上／左时步长取 −1（与 univer isReverse 同义）。公式格带 __src（它在来源线里的位置）以算平移位移；
//   3. 日期：univer 只认「数字＋日期格式」；本仓日期常以字串「2026-09-24」存（style.ts autoNumFmtForInput 标短日期）⇒ 字串日期先转序列日再推·
//      写回时照原串的分隔符与补零；
//   4. 中文循环序列补繁体：週一…週日、臘月、子時…亥時；循环序列 univer 原码 `+ cycleIndex * 7` 对非 7 长序列有误 ⇒ 改 series.length；
//      chineseToNumber 开头的「十」univer 原码当 0（「十二」⇒ 2）⇒ 改成一十；numberToChinese 12 原码出「一十二」⇒ 去掉开头的「一」；
//   5. 不做 univer 的 hook／mutation／合并区 undo 物件——合并区在 fillMerges 另判；撤销由页面撤销栈整份快照管。
//   6. 数字序列照 Excel（微软〈Project values in a series〉：拖填充柄＝linear best-fit trend·最小二乘 y=mx+b·
//      等同 TREND 函数；等比只在右键「Growth Trend」才有）：拿掉 univer 的等比分支（isEqualRatio）·线性外推不再四舍五入到 5 位小数
//      （Excel 存 15 位有效数字·1,2,4 ⇒ 5.33333333333333）；日期规则仍走原 univer 那条（取整到天）。

import { cellKey, parseLiteral, type CellData, type SheetCells } from './formula'
import { parseYmd, parseRange, rangeKey, rectsOverlap, NUMFMT_DATE_KINDS, type CellStyle, type Rect } from './style'
import { shiftFormula } from './formula-refs'

export type FillType = 'copy' | 'series' | 'onlyFormat' | 'noFormat'
export const FILL_TYPES: readonly FillType[] = ['copy', 'series', 'onlyFormat', 'noFormat']
export type FillDir = 'down' | 'up' | 'right' | 'left'
/** 一次填充：来源区＋方向＋新填的区（不含来源） */
export type FillPlan = { dir: FillDir; source: Rect; target: Rect }
/** 拖回来源区里 ⇒ 清掉被让出的那几行／列（Excel／univer AutoClearContent 口径） */
export type ShrinkPlan = { clear: Rect; keep: Rect }

type FCell = { v?: string; f?: string; s?: CellStyle; __src?: number } | null

// ═════════════ tools（univer tools.ts） ═════════════
const chnNumChar: Record<string, number> = { 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
const chnNumChar2 = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九']
const chnUnitSection = ['', '万', '亿', '万亿', '亿亿']
const chnUnitChar = ['', '十', '百', '千']
const chnNameValue: Record<string, { value: number; secUnit: boolean }> = {
  十: { value: 10, secUnit: false }, 百: { value: 100, secUnit: false }, 千: { value: 1000, secUnit: false },
  万: { value: 10000, secUnit: true }, 亿: { value: 100000000, secUnit: true },
  萬: { value: 10000, secUnit: true }, 億: { value: 100000000, secUnit: true },   // 繁体（本仓补）
}

export function chineseToNumber(chnStr?: string | null): number {
  if (!chnStr) return 0
  let rtn = 0, section = 0, number = 0
  const str = chnStr.split('')
  for (let i = 0; i < str.length; i++) {
    const num = chnNumChar[str[i]]
    if (typeof num !== 'undefined') {
      number = num
      if (i === str.length - 1) section += number
    } else {
      const obj = chnNameValue[str[i]]
      if (!obj) return 0
      const unit = obj.value
      if (obj.secUnit) { section = (section + number) * unit; rtn += section; section = 0 }
      else section += (number || (i === 0 ? 1 : 0)) * unit   // 本仓补：开头的「十」＝一十（univer 原码「十二」算成 2）
      number = 0
    }
  }
  return rtn + section
}
function sectionToChinese(section: number): string {
  let strIns = '', chnStr = '', unitPos = 0, zero = true
  while (section > 0) {
    const v = section % 10
    if (v === 0) { if (!zero) { zero = true; chnStr = chnNumChar2[v] + chnStr } }
    else { zero = false; strIns = chnNumChar2[v]; strIns += chnUnitChar[unitPos]; chnStr = strIns + chnStr }
    unitPos++
    section = Math.floor(section / 10)
  }
  return chnStr
}
export function numberToChinese(num: number): string {
  let unitPos = 0, strIns = '', chnStr = '', needZero = false
  if (num === 0) return chnNumChar2[0]
  while (num > 0) {
    const section = num % 10000
    if (needZero) chnStr = chnNumChar2[0] + chnStr
    strIns = sectionToChinese(section)
    strIns += section !== 0 ? chnUnitSection[unitPos] : chnUnitSection[0]
    chnStr = strIns + chnStr
    needZero = section < 1000 && section > 0
    num = Math.floor(num / 10000)
    unitPos++
  }
  return chnStr.startsWith('一十') ? chnStr.slice(1) : chnStr   // 本仓补：12 ⇒ 十二（univer 原码出「一十二」）
}
export function isChnNumber(txt?: string): boolean {
  if (!txt) return false
  if (txt.length === 1) return txt === '日' || txt in chnNumChar
  for (const ch of txt.split('')) if (!(ch in chnNumChar || ch in chnNameValue)) return false
  return true
}
export type ExtendMatch = { isExtendNumber: false } | { isExtendNumber: true; rawMatchTxt: string; matchNumber: number; beforeTxt: string; afterTxt: string }
/** 文字带数字（取最后一段数字）：「第1周」⇒ before「第」·1·after「周」 */
export function matchExtendNumber(txt?: string): ExtendMatch {
  if (!txt) return { isExtendNumber: false }
  const matches = [...txt.matchAll(/\d+/g)]
  if (!matches.length) return { isExtendNumber: false }
  const last = matches[matches.length - 1]
  const rawMatchTxt = last[0]
  const index = last.index ?? 0
  return { isExtendNumber: true, rawMatchTxt, matchNumber: Number(rawMatchTxt), beforeTxt: txt.substring(0, index), afterTxt: txt.substring(index + rawMatchTxt.length) }
}
const WEEK2_S = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const WEEK2_T = ['週日', '週一', '週二', '週三', '週四', '週五', '週六']   // 繁体（本仓补）
const WEEK3 = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']
export const isChnWeek2 = (txt: string) => txt.length === 2 && (WEEK2_S.includes(txt) || WEEK2_T.includes(txt))
export const isChnWeek3 = (txt: string) => txt.length === 3 && WEEK3.includes(txt)

function getLenS(indexArr: number[], rsd: number): number {
  let s = 0
  for (let j = 0; j < indexArr.length; j++) { if (indexArr[j] < rsd) s++; else break }
  return s
}
/** 等差（允许一次正负换向·univer 原判） */
export function isEqualDiff(arr: number[]): boolean {
  if (arr.length < 3) return true
  let step = arr[1] - arr[0]
  let changeStep = false
  for (let i = 2; i < arr.length; i++) {
    const cur = arr[i] - arr[i - 1]
    if (cur !== step) {
      if (changeStep) return false
      if (cur !== -step) return false
      step = cur; changeStep = true
    }
  }
  return true
}
function getDataIndex(csLen: number, asLen: number, indexArr: number[]): number[] {
  const obj: number[] = []
  const num = Math.floor(asLen / csLen)
  const rsd = asLen % csLen
  let sum = 0
  if (num > 0) {
    for (let i = 0; i < num; i++) for (let j = 0; j < indexArr.length; j++) { obj[indexArr[j] + i * csLen] = sum; sum++ }
    for (let a = 0; a < indexArr.length; a++) { if (indexArr[a] < rsd) { obj[indexArr[a] + csLen * num] = sum; sum++ } else break }
  } else {
    for (let a = 0; a < indexArr.length; a++) { if (indexArr[a] < rsd) { obj[indexArr[a]] = sum; sum++ } else break }
  }
  return obj
}
const clone = (d: FCell): FCell => (d ? { ...d, s: d.s ? JSON.parse(JSON.stringify(d.s)) as CellStyle : undefined } : null)
function fillCopy(data: FCell[], len: number): FCell[] {
  const out: FCell[] = []
  for (let i = 1; i <= len; i++) out.push(clone(data[(i - 1) % data.length]))
  return out
}
function fillCopyStyles(data: FCell[], len: number): FCell[] {
  const out: FCell[] = []
  for (let i = 1; i <= len; i++) { const d = data[(i - 1) % data.length]; out.push({ s: d?.s ? JSON.parse(JSON.stringify(d.s)) as CellStyle : undefined, __src: d?.__src }) }
  return out
}
function isEqualRatio(arr: number[]): boolean {
  const step = arr[1] / arr[0]
  if (!Number.isFinite(step)) return false
  for (let i = 1; i < arr.length; i++) if (arr[i] / arr[i - 1] !== step) return false
  return true
}
function getXArr(len: number): number[] { const x: number[] = []; for (let i = 1; i <= len; i++) x.push(i); return x }
/** 线性回归外推（univer forecast·单点 ⇒ 斜率 ±1）；round＝univer 原样四舍五入到 5 位小数（日期用）·false ⇒ 不裁（数字·Excel 口径） */
export function forecast(x: number, yArr: number[], xArr: number[], forward = true, round = true): number {
  const avg = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length
  const ax = avg(xArr), ay = avg(yArr)
  let sumD = 0, sumN = 0
  for (let j = 0; j < xArr.length; j++) { sumD += (xArr[j] - ax) * (yArr[j] - ay); sumN += (xArr[j] - ax) * (xArr[j] - ax) }
  const b = sumN === 0 ? (forward ? 1 : -1) : sumD / sumN
  const a = ay - b * ax
  return round ? Math.round((a + b * x) * 100000) / 100000 : a + b * x
}
/** 数字序列＝Excel 线性趋势（最小二乘·不做等比·不裁小数）：1,2,4 ⇒ 5.333…, 6.833…；1,3 ⇒ 5,7,9；单个 ⇒ ±1 */
export function linearTrend(nums: number[], len: number, forward: boolean): number[] {
  const xArr = getXArr(nums.length)
  const out: number[] = []
  if (forward) { for (let i = 1; i <= len; i++) out.push(forecast(nums.length + i, nums, xArr, true, false)); return out }
  // 往上／往左：nums 已镜像（离目标最近的在最后）⇒ 翻回原顺序在 x＝0、−1、… 处取值（与 Excel 同一条线·免得镜像多一次浮点误差）
  const orig = [...nums].reverse()
  for (let i = 1; i <= len; i++) out.push(forecast(1 - i, orig, xArr, false, false))
  return out
}
/** univer 原序列（>2 个且等比 ⇒ 等比；否则线性外推·5 位小数）——现只给日期用（日期规则照旧不动） */
function fillSeriesNums(nums: number[], len: number, forward: boolean): number[] {
  const out: number[] = []
  if (nums.length > 2 && isEqualRatio(nums)) {
    const ratio = nums[1] / nums[0]
    for (let i = 1; i <= len; i++) out.push(nums[nums.length - 1] * ratio ** i)
  } else {
    const xArr = getXArr(nums.length)
    for (let i = 1; i <= len; i++) out.push(forecast(nums.length + i, nums, xArr, forward))
  }
  return out
}
const numStr = (n: number) => String(Number(n.toPrecision(15)))
function fillSeries(data: FCell[], len: number, forward: boolean): FCell[] {
  const ys = linearTrend(data.map(d => Number(d?.v)), len, forward)
  return ys.map((y, i) => { const d = clone(data[i % data.length]); return d ? { ...d, v: numStr(y) } : d })
}
function fillExtendNumber(data: FCell[], len: number, step: number): FCell[] {
  const last = data[data.length - 1]
  const m = matchExtendNumber(last?.v)
  if (!m.isExtendNumber) return fillCopy(data, len)
  const width = m.rawMatchTxt.length
  const out: FCell[] = []
  for (let i = 1; i <= len; i++) {
    const d = clone(data[(i - 1) % data.length])
    if (!d || !d.v) { out.push(d); continue }
    let s = Math.abs(m.matchNumber + step * i).toString()
    if (s.length < width) s = s.padStart(width, '0')
    out.push({ ...d, v: `${m.beforeTxt}${s}${m.afterTxt}` })
  }
  return out
}
// weekType：0＝日一二…·1＝周X（简）·2＝星期X·3＝週X（繁·本仓补）
function fillChnWeek(data: FCell[], len: number, step: number, weekType = 0): FCell[] {
  const keywordMap = [['日', '一', '二', '三', '四', '五', '六'], WEEK2_S, WEEK3, WEEK2_T]
  const keyword = keywordMap[weekType] ?? keywordMap[0]
  const out: FCell[] = []
  for (let i = 1; i <= len; i++) {
    const d = clone(data[(i - 1) % data.length])
    let num = 0
    const lastV = data[data.length - 1]?.v ?? ''
    if (lastV === keyword[0]) num = 7 + step * i
    else if (lastV) num = chineseToNumber(lastV.substr(lastV.length - 1, 1)) + step * i
    if (num < 0) num = Math.ceil(Math.abs(num) / 7) * 7 + num
    out.push(d ? { ...d, v: keyword[num % 7] } : d)
  }
  return out
}
function fillChnNumber(data: FCell[], len: number, step: number): FCell[] {
  const out: FCell[] = []
  for (let i = 1; i <= len; i++) {
    const d = clone(data[(i - 1) % data.length])
    const num = chineseToNumber(data[data.length - 1]?.v) + step * i
    out.push(d ? { ...d, v: num <= 0 ? '零' : numberToChinese(num) } : d)
  }
  return out
}
const LOOP_SERIES: Record<string, string[]> = {
  enWeek1: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  enWeek2: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  enMonth1: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  enMonth2: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  chnMonth1: ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'],
  chnMonth2: ['正月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '腊月'],
  chnMonth2T: ['正月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '臘月'],   // 繁体（本仓补）
  chHour1: ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'],
  chHour2: ['子时', '丑时', '寅时', '卯时', '辰时', '巳时', '午时', '未时', '申时', '酉时', '戌时', '亥时'],
  chHour2T: ['子時', '丑時', '寅時', '卯時', '辰時', '巳時', '午時', '未時', '申時', '酉時', '戌時', '亥時'],   // 繁体（本仓补）
  chYear1: ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'],
  chSeason1: ['春', '夏', '秋', '冬'],
  chSeason2: ['春季', '夏季', '秋季', '冬季'],
}
export function isLoopSeries(txt: string): boolean { return Object.values(LOOP_SERIES).some(s => s.includes(txt)) }
/** 同一字可能落在多条序列（如「二月」）⇒ 取第一条（univer 原判取最后一条的名·序列却 push 全部——这里改成取同一条的名与序列） */
export function getLoopSeriesInfo(txt: string): { name: string; series: string[] } {
  for (const [name, series] of Object.entries(LOOP_SERIES)) if (series.includes(txt)) return { name, series }
  return { name: '', series: [] }
}
function fillLoopSeries(data: FCell[], len: number, step: number, series: string[]): FCell[] {
  const n = series.length
  const out: FCell[] = []
  for (let i = 1; i <= len; i++) {
    const d = clone(data[(i - 1) % data.length])
    let num = series.indexOf(data[data.length - 1]?.v ?? '') + step * i
    if (num < 0) num += Math.ceil(Math.abs(num) / n) * n
    out.push(d ? { ...d, v: series[num % n] } : d)
  }
  return out
}

// ── 日期（本仓补：字串日期 ⇄ 序列日） ──
const EPOCH = Date.UTC(1899, 11, 30)
function ymdToSerial(y: number, m: number, d: number): number { return Math.round((Date.UTC(y, m - 1, d) - EPOCH) / 86400000) }
function serialToYmdStr(serial: number, like: string): string {
  const dt = new Date(EPOCH + Math.round(serial) * 86400000)
  const y = dt.getUTCFullYear(), m = dt.getUTCMonth() + 1, d = dt.getUTCDate()
  const sep = /^\s*\d{4}([-/.])/.exec(like)?.[1] ?? '-'
  const pad = /^\s*\d{4}[-/.]0\d|^\s*\d{4}[-/.]\d{1,2}[-/.]0\d|^\s*\d{4}[-/.]\d{2}[-/.]\d{2}\s*$/.test(like)
  const p2 = (n: number) => (pad && n < 10 ? '0' + n : String(n))
  return `${y}${sep}${p2(m)}${sep}${p2(d)}`
}
const isDateString = (v: string | undefined) => !!v && !/\d{1,2}:\d{2}/.test(v) && !!parseYmd(v)
const DATE_NUMFMTS: readonly string[] = NUMFMT_DATE_KINDS   // 短日期／长日期／民國紀年
function dateSerialOf(d: FCell): number {
  if (d?.v && isDateString(d.v)) { const x = parseYmd(d.v)!; return ymdToSerial(x.y, x.m, x.d) }
  return Number(d?.v)
}
function fillDate(data: FCell[], len: number, forward: boolean): FCell[] {
  const ys = fillSeriesNums(data.map(dateSerialOf), len, forward)
  return ys.map((y, i) => {
    const d = clone(data[i % data.length])
    if (!d) return d
    return { ...d, v: d.v && isDateString(d.v) ? serialToYmdStr(y, d.v) : numStr(Math.round(y)) }
  })
}

// ═════════════ rules（univer rules.ts） ═════════════
type DataType = 'date' | 'formula' | 'number' | 'extendNumber' | 'chnNumber' | 'chnWeek2' | 'chnWeek3' | 'loopSeries' | 'other'
type Rule = {
  type: DataType
  match: (c: FCell) => boolean
  isContinue: (prev: { type?: DataType; cell?: FCell }, cur: FCell) => boolean
  /** 序列套法（data 已镜像·离目标最近的在最后）；省 ⇒ 当复制 */
  series?: (data: FCell[], len: number, reverse: boolean) => FCell[]
}
const isFormula = (c: FCell) => !!c?.f && c.f.trim().startsWith('=')
const isNumberCell = (c: FCell) => !!c && !isFormula(c) && typeof parseLiteral(c.v) === 'number'
const RULES: readonly Rule[] = [
  {
    type: 'date',
    match: c => !!c && !isFormula(c) && ((isNumberCell(c) && DATE_NUMFMTS.includes(c.s?.numFmt?.t ?? '')) || isDateString(c.v)),
    isContinue: prev => prev.type === 'date',
    series: (data, len, reverse) => fillDate(data, len, !reverse),
  },
  {
    type: 'formula',   // univer sheets-formula formulaRule（priority 1001）：序列与复制同样平移引用
    match: isFormula,
    isContinue: prev => prev.type === 'formula',
  },
  {
    type: 'number',
    match: isNumberCell,
    isContinue: prev => prev.type === 'number',
    series: (data, len, reverse) => fillSeries(data, len, !reverse),
  },
  {
    type: 'extendNumber',
    match: c => !!c && !isFormula(c) && matchExtendNumber(c.v).isExtendNumber,
    isContinue: (prev, cur) => {
      if (prev.type !== 'extendNumber') return false
      const p = matchExtendNumber(prev.cell?.v), q = matchExtendNumber(cur?.v)
      return p.isExtendNumber && q.isExtendNumber && p.beforeTxt === q.beforeTxt && p.afterTxt === q.afterTxt
    },
    series: (data, len, reverse) => {
      if (data.length === 1) return fillExtendNumber(data, len, reverse ? -1 : 1)
      const nums = data.map(d => matchExtendNumber(d?.v)).map(m => (m.isExtendNumber ? m.matchNumber : 0))
      if (isEqualDiff(nums)) return fillExtendNumber(data, len, nums[nums.length - 1] - nums[nums.length - 2])
      return fillCopy(data, len)
    },
  },
  {
    type: 'chnNumber',
    match: c => !!c && !isFormula(c) && isChnNumber(c.v),
    isContinue: prev => prev.type === 'chnNumber',
    series: (data, len, reverse) => {
      if (data.length === 1) {
        const v = data[0]?.v ?? ''
        const step = reverse ? -1 : 1
        return v && (v === '日' || chineseToNumber(v) < 7) ? fillChnWeek(data, len, step) : fillChnNumber(data, len, step)
      }
      const hasWeek = data.some(d => d?.v === '日')
      const nums: number[] = []
      let weekIndex = 0
      data.forEach((d, i) => {
        const v = d?.v ?? ''
        if (v === '日') { if (i === 0) nums.push(0); else { weekIndex++; nums.push(weekIndex * 7) } }
        else if (hasWeek && chineseToNumber(v) > 0 && chineseToNumber(v) < 7) nums.push(chineseToNumber(v) + weekIndex * 7)
        else nums.push(chineseToNumber(v))
      })
      if (isEqualDiff(nums)) {
        const step = nums[nums.length - 1] - nums[nums.length - 2]
        if (hasWeek || (nums[nums.length - 1] < 6 && nums[0] > 0) || (nums[0] < 6 && nums[nums.length - 1] > 0)) return fillChnWeek(data, len, step)
        return fillChnNumber(data, len, nums[1] - nums[0])
      }
      return fillCopy(data, len)
    },
  },
  ...(['chnWeek2', 'chnWeek3'] as const).map((type): Rule => ({
    type,
    match: c => !!c?.v && !isFormula(c) && (type === 'chnWeek2' ? isChnWeek2(c.v) : isChnWeek3(c.v)),
    isContinue: prev => prev.type === type,
    series: (data, len, reverse) => {
      const first = data[data.length - 1]?.v ?? ''
      const wt = type === 'chnWeek3' ? 2 : (first.startsWith('週') ? 3 : 1)
      if (data.length === 1) return fillChnWeek(data, len, reverse ? -1 : 1, wt)
      const nums: number[] = []
      let weekIndex = 0
      data.forEach((d, i) => {
        const v = d?.v ?? ''
        if (v.endsWith('日')) { if (i === 0) nums.push(0); else { weekIndex++; nums.push(weekIndex * 7) } }
        else nums.push(chineseToNumber(v.substr(v.length - 1, 1)) + weekIndex * 7)
      })
      if (isEqualDiff(nums)) return fillChnWeek(data, len, nums[nums.length - 1] - nums[nums.length - 2], wt)
      return fillCopy(data, len)
    },
  })),
  {
    type: 'loopSeries',
    match: c => !!c?.v && !isFormula(c) && isLoopSeries(c.v),
    isContinue: (prev, cur) => prev.type === 'loopSeries' && getLoopSeriesInfo(prev.cell?.v ?? '').name === getLoopSeriesInfo(cur?.v ?? '').name,
    series: (data, len, reverse) => {
      const { series } = getLoopSeriesInfo(data[0]?.v ?? '')
      if (data.length === 1) return fillLoopSeries(data, len, reverse ? -1 : 1, series)
      const nums: number[] = []
      let cycle = 0
      data.forEach((d, i) => {
        const v = d?.v ?? ''
        if (v === series[0]) { if (i === 0) nums.push(0); else { cycle++; nums.push(cycle * series.length) } }
        else nums.push(series.indexOf(v) + cycle * series.length)
      })
      if (isEqualDiff(nums)) return fillLoopSeries(data, len, nums[nums.length - 1] - nums[nums.length - 2], series)
      return fillCopy(data, len)
    },
  },
  { type: 'other', match: () => true, isContinue: prev => prev.type === 'other' },
]
const ruleOf = (c: FCell) => RULES.find(r => r.match(c)) ?? RULES[RULES.length - 1]

type Squad = { data: FCell[]; index: number[] }
type Piece = Partial<Record<DataType, Squad[]>>
/** 一条线切同类段（univer _getCopyData） */
function piecesOf(line: FCell[]): Piece {
  const piece: Piece = {}
  const prev: { type?: DataType; cell?: FCell } = {}
  line.forEach((cell, b) => {
    const { type, isContinue } = ruleOf(cell)
    const list = piece[type] ?? (piece[type] = [])
    if (isContinue(prev, cell) && list.length) { const last = list[list.length - 1]; last.data.push(cell); last.index.push(b) }
    else list.push({ data: [cell], index: [b] })
    prev.type = type; prev.cell = cell
  })
  return piece
}

// ═════════════ 对外 ═════════════
/** 格资料 ⇒ 填充用（空格／只有空字 ⇒ 当空） */
function toF(c: CellData | undefined, src: number): FCell {
  if (!c || (c.v === undefined && c.f === undefined && c.s === undefined)) return null
  return { ...(c.v !== undefined ? { v: c.v } : {}), ...(c.f !== undefined ? { f: c.f } : {}), ...(c.s ? { s: c.s } : {}), __src: src }
}
const vertical = (dir: FillDir) => dir === 'down' || dir === 'up'
const reversed = (dir: FillDir) => dir === 'up' || dir === 'left'
/** 来源线（按行／列·已镜像：离目标最近的在最后）与各格 __src＝它在原来源线里的位置（0＝最上／最左） */
function sourceLines(cells: SheetCells, plan: FillPlan): FCell[][] {
  const { source, dir } = plan
  const lines: FCell[][] = []
  if (vertical(dir)) {
    for (let c = source.c0; c <= source.c1; c++) {
      const line: FCell[] = []
      for (let r = source.r0; r <= source.r1; r++) line.push(toF(cells[cellKey(r, c)], r - source.r0))
      lines.push(reversed(dir) ? line.reverse() : line)
    }
  } else {
    for (let r = source.r0; r <= source.r1; r++) {
      const line: FCell[] = []
      for (let c = source.c0; c <= source.c1; c++) line.push(toF(cells[cellKey(r, c)], c - source.c0))
      lines.push(reversed(dir) ? line.reverse() : line)
    }
  }
  return lines
}

/** 预设套法与「序列」可不可选（univer _getPreferredApplyType／_shouldDisableSeries） */
export function fillDefaults(cells: SheetCells, plan: FillPlan): { preferred: 'copy' | 'series'; seriesDisabled: boolean } {
  const pieces = sourceLines(cells, plan).map(piecesOf)
  const seriesDisabled = pieces.every(p => Object.entries(p).every(([type, list]) => !list?.length || type === 'other' || type === 'formula'))
  const preferCopy = pieces.every(p => Object.entries(p).every(([type, list]) => !list?.length || (list.length === 1 && list[0].data.length === 1 && type === 'number')))
  return { preferred: preferCopy || seriesDisabled ? 'copy' : 'series', seriesDisabled }
}
/** 放手那刻按没按 Ctrl（⌘）：按了 ⇒ 预设反过来（单个数字复制↔递增·Excel 口径）；序列不可选 ⇒ 仍复制 */
export function fillTypeFor(cells: SheetCells, plan: FillPlan, ctrl: boolean): 'copy' | 'series' {
  const { preferred, seriesDisabled } = fillDefaults(cells, plan)
  if (seriesDisabled) return 'copy'
  return ctrl ? (preferred === 'copy' ? 'series' : 'copy') : preferred
}

/** 一条线的目标值（按离来源由近到远·长度 asLen） */
function applyLine(line: FCell[], asLen: number, type: FillType, reverse: boolean): FCell[] {
  const csLen = line.length
  const num = Math.floor(asLen / csLen), rsd = asLen % csLen
  const piece = piecesOf(line)
  const out: FCell[] = new Array(asLen).fill(null)
  for (const rule of RULES) {
    for (const squad of piece[rule.type] ?? []) {
      const len = squad.index.length * num + getLenS(squad.index, rsd)
      let arr: FCell[]
      if (type === 'onlyFormat') arr = fillCopyStyles(squad.data, len)
      else if ((type === 'series' || type === 'noFormat') && rule.series) arr = rule.series(squad.data, len, reverse)
      else arr = fillCopy(squad.data, len)
      const idx = getDataIndex(csLen, asLen, squad.index)
      idx.forEach((di, x) => { if (di !== undefined) out[x] = arr[di] ?? null })
    }
  }
  return out
}

/**
 * 执行一次填充 ⇒ 新 cells（只改 plan.target 里的格）。
 * copy／series：值（公式按位移平移·越界 #REF!）＋格式；onlyFormat：只换格式·值留原格；noFormat：值照序列·格式留原格（univer NO_FORMAT＝不带样式的 SERIES）
 */
export function applyFill(cells: SheetCells, plan: FillPlan, type: FillType, maxRows: number, maxCols: number): SheetCells {
  const next: SheetCells = { ...cells }
  const { source, target, dir } = plan
  const rev = reversed(dir)
  const lines = sourceLines(cells, plan)
  const asLen = vertical(dir) ? target.r1 - target.r0 + 1 : target.c1 - target.c0 + 1
  lines.forEach((line, li) => {
    const vals = applyLine(line, asLen, type, rev)
    vals.forEach((d, x) => {
      // x＝离来源由近到远的第几格 ⇒ 真格位
      const along = rev ? (vertical(dir) ? target.r1 - x : target.c1 - x) : (vertical(dir) ? target.r0 + x : target.c0 + x)
      const r = vertical(dir) ? along : source.r0 + li
      const c = vertical(dir) ? source.c0 + li : along
      const key = cellKey(r, c)
      const old = cells[key]
      let cell: CellData | undefined
      if (type === 'onlyFormat') {
        const base: CellData = { ...(old?.v !== undefined ? { v: old.v } : {}), ...(old?.f !== undefined ? { f: old.f } : {}) }
        cell = d?.s ? { ...base, s: d.s } : base
      } else {
        const v: CellData = {}
        if (d?.f && d.f.trim().startsWith('=')) {
          const srcPos = d.__src ?? 0
          const srcAlong = vertical(dir) ? source.r0 + srcPos : source.c0 + srcPos
          const delta = along - srcAlong
          v.v = ''
          v.f = vertical(dir) ? shiftFormula(d.f, delta, 0, maxRows, maxCols) : shiftFormula(d.f, 0, delta, maxRows, maxCols)
        } else if (d?.v !== undefined) v.v = d.v
        const s = type === 'noFormat' ? old?.s : d?.s
        cell = s ? { ...v, s } : v
      }
      if (!cell || (cell.v === undefined && cell.f === undefined && !cell.s) || (cell.v === '' && cell.f === undefined && !cell.s)) delete next[key]
      else next[key] = cell
    })
  })
  return next
}

/**
 * 拖到哪格 ⇒ 填充计划（Excel：只取一个方向——指针在来源区外哪个方向超出得多就往哪边；在区内且往回拖 ⇒ 收缩清空）
 * 返回 null ＝ 没动
 */
export function fillPlanFor(source: Rect, at: { r: number; c: number }): FillPlan | ShrinkPlan | null {
  const { r0, r1, c0, c1 } = source
  const dy = at.r > r1 ? at.r - r1 : at.r < r0 ? at.r - r0 : 0
  const dx = at.c > c1 ? at.c - c1 : at.c < c0 ? at.c - c0 : 0
  if (dy === 0 && dx === 0) {
    // 在区内：往回拖 ⇒ 让出来的行／列清空（至少留一行／一列）
    const shrinkRows = r1 - Math.max(r0, at.r), shrinkCols = c1 - Math.max(c0, at.c)
    if (shrinkRows <= 0 && shrinkCols <= 0) return null
    if (shrinkRows >= shrinkCols) { const nr1 = Math.max(r0, at.r); return { clear: { r0: nr1 + 1, r1, c0, c1 }, keep: { r0, r1: nr1, c0, c1 } } }
    const nc1 = Math.max(c0, at.c); return { clear: { r0, r1, c0: nc1 + 1, c1 }, keep: { r0, r1, c0, c1: nc1 } }
  }
  if (Math.abs(dy) >= Math.abs(dx)) {
    return dy > 0 ? { dir: 'down', source, target: { r0: r1 + 1, r1: at.r, c0, c1 } } : { dir: 'up', source, target: { r0: at.r, r1: r0 - 1, c0, c1 } }
  }
  return dx > 0 ? { dir: 'right', source, target: { r0, r1, c0: c1 + 1, c1: at.c } } : { dir: 'left', source, target: { r0, r1, c0: at.c, c1: c0 - 1 } }
}
export const isShrink = (p: FillPlan | ShrinkPlan): p is ShrinkPlan => 'clear' in p
/** 填完的整片（来源∪目标） */
export function fillUnion(p: FillPlan): Rect {
  return { r0: Math.min(p.source.r0, p.target.r0), r1: Math.max(p.source.r1, p.target.r1), c0: Math.min(p.source.c0, p.target.c0), c1: Math.max(p.source.c1, p.target.c1) }
}

/** 收缩：清内容（格式留·Excel 口径） */
export function clearContents(cells: SheetCells, rect: Rect): SheetCells {
  const next = { ...cells }
  for (let r = rect.r0; r <= rect.r1; r++) for (let c = rect.c0; c <= rect.c1; c++) {
    const k = cellKey(r, c); const cd = next[k]; if (!cd) continue
    if (cd.s) next[k] = { s: cd.s }; else delete next[k]
  }
  return next
}

/**
 * 合并区：目标区与某合并区「部分重叠」⇒ conflict（Excel：不能只改合并格的一部分）；
 * 否则目标区里整块的旧合并区撤掉·来源区里的合并区按周期复制进目标（整块落得下才复制）。
 */
export function fillMerges(merges: string[], plan: FillPlan): { merges: string[] } | { conflict: true } {
  const { source, target, dir } = plan
  const rects = merges.map(m => ({ m, r: parseRange(m) })).filter((x): x is { m: string; r: Rect } => !!x.r)
  const inside = (a: Rect, b: Rect) => a.r0 >= b.r0 && a.r1 <= b.r1 && a.c0 >= b.c0 && a.c1 <= b.c1
  for (const { r } of rects) if (rectsOverlap(r, target) && !inside(r, target)) return { conflict: true }
  const keep = rects.filter(({ r }) => !rectsOverlap(r, target)).map(x => x.m)
  const srcMerges = rects.filter(({ r }) => inside(r, source)).map(x => x.r)
  const period = vertical(dir) ? source.r1 - source.r0 + 1 : source.c1 - source.c0 + 1
  const out = [...keep]
  for (const sm of srcMerges) {
    for (let k = 1; k < 10000; k++) {
      const off = (reversed(dir) ? -1 : 1) * k * period
      const moved = vertical(dir) ? { ...sm, r0: sm.r0 + off, r1: sm.r1 + off } : { ...sm, c0: sm.c0 + off, c1: sm.c1 + off }
      if (!rectsOverlap(moved, target)) break
      if (inside(moved, target)) out.push(rangeKey(moved))
    }
  }
  return { merges: out }
}

const hasValue = (c: CellData | undefined) => !!c && ((c.v !== undefined && c.v !== '') || !!c.f)
/**
 * 双击填充柄：向下填到哪一行（univer detectAutoFillRange）：先看左邻列（下一行有值 ⇒ 一路往下到连续有值的最后一行）·否则右邻列·都没有 ⇒ 不填；
 * 途中目标区（来源各列）已有值 ⇒ 停在它上一行。返回新的末行·≤ 来源末行 ⇒ null（不动）
 */
export function dblClickFillEnd(cells: SheetCells, source: Rect, maxRows: number, maxCols: number): number | null {
  const { r1, c0, c1 } = source
  let end = r1 + 1
  const at = (r: number, c: number) => hasValue(cells[cellKey(r, c)])
  if (c0 > 0 && at(end, c0 - 1)) { while (end + 1 < maxRows && at(end + 1, c0 - 1)) end++ }
  else if (c1 < maxCols - 1 && at(end, c1 + 1)) { while (end + 1 < maxRows && at(end + 1, c1 + 1)) end++ }
  else end = r1
  for (let r = r1 + 1; r <= end; r++) {
    let hit = false
    for (let c = c0; c <= c1; c++) if (at(r, c)) { hit = true; break }
    if (hit) { end = r - 1; break }
  }
  return end > r1 ? end : null
}

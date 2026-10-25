// 字幕档读写（SRT 读写在 text.pure／clip-ops·这里补 ASS／SSA 读、VTT 与 ASS 写）：
//   读 ASS／SSA（Aegisub、剪映、B 站字幕常见）：[Events] 的 Format 那行定栏位顺序·Dialogue 一行一句；去掉 {\…} 覆写标记、\N 换行、\h 空格。
//   写 VTT（网页、YouTube）、ASS（PlayResX／Y＝画面大小·一句一行；不在默认下方位置的写 \pos、字级与颜色照文字片段）。
//   SRT 写法照旧（clip-ops.tracksToSrt）·三种共用同一份「哪些字算字幕」（文字轨没藏、没停用、有字的段）。
import type { Tracks, TlClip } from './timeline.pure'

export type AssCue = { start: number; end: number; text: string }

/** ASS 时间「h:mm:ss.cc」⇒ 秒 */
function assTime(s: string): number | null {
  const m = /^(\d+):(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/.exec(s.trim())
  return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] + (m[4] ? +`0.${m[4]}` : 0) : null
}
/** 是不是 ASS／SSA（有 [Script Info] 或 [Events] 段） */
export const isAss = (raw: string) => /^\s*\[Script Info\]/im.test(raw) || /^\s*\[Events\]/im.test(raw)

export function parseAss(raw: string): AssCue[] {
  const lines = raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n')
  let inEvents = false
  let fmt = ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text']
  const out: AssCue[] = []
  for (const line of lines) {
    const sec = /^\s*\[(.+)\]\s*$/.exec(line)
    if (sec) { inEvents = sec[1].trim().toLowerCase() === 'events'; continue }
    if (!inEvents) continue
    const kv = /^\s*(Format|Dialogue)\s*:\s*(.*)$/i.exec(line)
    if (!kv) continue
    if (kv[1].toLowerCase() === 'format') { fmt = kv[2].split(',').map((x) => x.trim().toLowerCase()); continue }
    const parts = kv[2].split(',')
    const ti = fmt.indexOf('text')
    if (ti < 0 || parts.length < fmt.length) continue
    const f = (k: string) => parts[fmt.indexOf(k)] ?? ''
    const start = assTime(f('start')), end = assTime(f('end'))
    if (start === null || end === null || end <= start) continue
    const text = parts.slice(ti).join(',').replace(/\{[^}]*\}/g, '').replace(/\\[Nn]/g, '\n').replace(/\\h/g, ' ')
      .split('\n').map((l) => l.trim()).filter(Boolean).join('\n')
    if (text) out.push({ start, end, text })
  }
  return out.sort((a, b) => a.start - b.start)
}

/** 汇出用的字幕段：文字轨（没藏）上没停用、有字的段·照时间排；only 给了 ⇒ 只算那几段 */
export function subtitleItems(tr: Tracks, opts: { only?: ReadonlySet<string> } = {}): TlClip[] {
  return tr.filter((l) => l.kind === 'text' && !l.hidden)
    .flatMap((l) => l.clips.filter((c) => c.text && !c.disabled && c.text.content.trim() && (!opts.only || opts.only.has(c.id))))
    .sort((a, b) => a.start - b.start || a.id.localeCompare(b.id))
}
const ms = (s: number) => Math.max(0, Math.round(s * 1000))
const p2 = (n: number) => String(n).padStart(2, '0')
const vttTime = (s: number) => { const t = ms(s); return `${p2(Math.floor(t / 3600000))}:${p2(Math.floor(t / 60000) % 60)}:${p2(Math.floor(t / 1000) % 60)}.${String(t % 1000).padStart(3, '0')}` }
const assStamp = (s: number) => { const cs = Math.max(0, Math.round(s * 100)); return `${Math.floor(cs / 360000)}:${p2(Math.floor(cs / 6000) % 60)}:${p2(Math.floor(cs / 100) % 60)}.${p2(cs % 100)}` }

export function tracksToVtt(tr: Tracks, opts: { only?: ReadonlySet<string>; from?: number } = {}): string {
  const from = opts.from ?? 0
  const items = subtitleItems(tr, opts)
  if (!items.length) return ''
  return 'WEBVTT\n\n' + items.map((c, i) => `${i + 1}\n${vttTime(c.start - from)} --> ${vttTime(c.start + c.length - from)}\n${c.text!.content.trim().replace(/-->/g, '->')}\n`).join('\n')
}

/** #RRGGBB ⇒ ASS 的 &HBBGGRR& */
const assColor = (hex: string) => { const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex); return m ? `&H${m[3]}${m[2]}${m[1]}&`.toUpperCase() : null }
export function tracksToAss(tr: Tracks, size: { w: number; h: number }, opts: { only?: ReadonlySet<string>; from?: number; title?: string } = {}): string {
  const from = opts.from ?? 0
  const items = subtitleItems(tr, opts)
  if (!items.length) return ''
  const W = Math.round(size.w), H = Math.round(size.h)
  const base = Math.round(H * 0.055)
  const head = ['[Script Info]', `Title: ${(opts.title ?? 'Dilin Studio').replace(/[\r\n]+/g, ' ')}`, 'ScriptType: v4.00+', `PlayResX: ${W}`, `PlayResY: ${H}`, 'WrapStyle: 0', 'ScaledBorderAndShadow: yes', '',
    '[V4+ Styles]', 'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Default,Arial,${base},&H00FFFFFF,&H000000FF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,${Math.max(1, Math.round(H / 400))},0,2,20,20,${Math.round(H * 0.06)},1`, '',
    '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text']
  const lines = items.map((c) => {
    const t = c.text!
    const tags: string[] = []
    if (Math.abs(t.x - 0.5) > 0.01 || Math.abs(t.y - 0.88) > 0.02) tags.push(`\\an5\\pos(${Math.round(t.x * W)},${Math.round(t.y * H)})`)
    if (t.size && Math.abs(t.size * H - base) > 1) tags.push(`\\fs${Math.round(t.size * H)}`)
    const col = t.color ? assColor(t.color) : null
    if (col && col !== '&HFFFFFF&') tags.push(`\\c${col}`)
    if (t.bold) tags.push('\\b1')
    if (t.italic) tags.push('\\i1')
    const body = t.content.trim().replace(/\r\n?/g, '\n').replace(/[{}]/g, '').replace(/\n/g, '\\N')
    return `Dialogue: 0,${assStamp(c.start - from)},${assStamp(c.start + c.length - from)},Default,,0,0,0,,${tags.length ? `{${tags.join('')}}` : ''}${body}`
  })
  return [...head, ...lines, ''].join('\n')
}

// 「选择字体」字体表
//   来源＝免费可商用字体调研「最稳的一套组合」·全部 SIL OFL 1.1。
//   纯数据＋纯函数·无 DOM／React 依赖 ⇒ client／server／单测三方同一份（表格页 sanitizeStyle 白名单、云文档 :font 指令校验、下拉清单都读这里）。
//
//   载法：
//   - google ＝ Google Fonts css2 端点·中文字族由它切 100 余片 unicode-range·浏览器只拉命中的片（Noto Sans TC 约 105 片）
//   - css    ＝ jsDelivr 上现成的切片 css（同样 unicode-range·相对路径 woff2 随 css 所在目录解析）
//   两种来源的根网址都从 ./source.ts 取（env 可换）——陆版若连不上 Google Fonts／jsDelivr·把两条根网址指到自托管镜像（R2）即可·表本身不改。
//   ⛔ 整档 10MB＋ 的中文字体一律不进这张表（清单「体积提醒」段）。
//
//   OFL 义务：字体档旁附授权全文＋版权行——本表每款带 ofl 出处 URL；本站不单卖字体档。
//   RFN 注意：得意黑（RFN "Smiley"／"得意黑"）走 jsDelivr 切片包·包内 font-family 仍叫 'Smiley Sans Oblique'——按 OFL 条文的字面读法切片＝Modified Version·稳妥应改名；
//   业界（含 Google Fonts 自己）普遍不严格执行·这里照切片包原名载（是否要改名待定，见 THIRD_PARTY.md）。

import { googleFontsBase, npmCdnBase } from './source'

export type FontLoad =
  | { kind: 'google'; family: string; weights?: number[] }     // Google Fonts css2（family＝显示名·空格由 cssHref 换 +）
  | { kind: 'css'; path: string; family: string }              // npm CDN 上的切片 css（path＝<包>@<版>/<档>）

export type FontEntry = {
  /** 存进档里的键（cells[A1].s.font ／ :font[]{family=id}）·只许 [a-z0-9-] */
  id: string
  /** 英文显示名（＝Google Fonts 名） */
  label: string
  /** 中文名（下拉旁注） */
  zh: string
  /** 三类：简体／繁体／英文（下拉分组） */
  group: 'sc' | 'tc' | 'latin'
  /** 是不是中文字体（＝必须切片按需载） */
  cjk: boolean
  /** OFL 授权全文出处 */
  ofl: string
  /** CSS font-family 栈（首选＝网络字体名·后接系统回退） */
  stack: string
  load: FontLoad
}

export const FONT_ID_RE = /^[a-z0-9-]{1,40}$/

const SANS_FALLBACK = "'Noto Sans CJK TC', 'Microsoft JhengHei', 'PingFang TC', sans-serif"
const SERIF_FALLBACK = "'Noto Serif CJK TC', 'PMingLiU', serif"

/** 首发 12 款（顺序＝清单「最稳的一套组合」：简体 4／繁体 4／英文 4） */
export const FONT_CATALOG: readonly FontEntry[] = [
  // ── 简体 ──
  { id: 'noto-sans-sc', label: 'Noto Sans SC', zh: '思源黑體（簡）', group: 'sc', cjk: true,
    ofl: 'https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/LICENSE',
    stack: `'Noto Sans SC', 'Noto Sans CJK SC', ${SANS_FALLBACK}`,
    load: { kind: 'google', family: 'Noto Sans SC', weights: [400, 700] } },
  { id: 'noto-serif-sc', label: 'Noto Serif SC', zh: '思源宋體（簡）', group: 'sc', cjk: true,
    ofl: 'https://raw.githubusercontent.com/notofonts/noto-cjk/main/Serif/LICENSE',
    stack: `'Noto Serif SC', 'Noto Serif CJK SC', ${SERIF_FALLBACK}`,
    load: { kind: 'google', family: 'Noto Serif SC', weights: [400, 700] } },
  { id: 'lxgw-wenkai-screen', label: 'LXGW WenKai Screen', zh: '霞鶩文楷（螢幕版）', group: 'sc', cjk: true,
    ofl: 'https://raw.githubusercontent.com/lxgw/LxgwWenKai/main/OFL.txt',   // 作者特例：为 web font 切子集／转 WOFF2 可保留原名（不提供桌面档下载）
    stack: `'LXGW WenKai Screen', 'LXGW WenKai', 'Kaiti TC', 'DFKai-SB', ${SERIF_FALLBACK}`,
    load: { kind: 'css', path: 'lxgw-wenkai-screen-webfont@1.7.0/lxgwwenkaiscreen.css', family: 'LXGW WenKai Screen' } },
  { id: 'smiley-sans', label: 'Smiley Sans', zh: '得意黑', group: 'sc', cjk: true,
    ofl: 'https://raw.githubusercontent.com/atelier-anchor/smiley-sans/main/LICENSE',
    stack: `'Smiley Sans Oblique', 'Smiley Sans', ${SANS_FALLBACK}`,
    load: { kind: 'css', path: 'cn-fontsource-smiley-sans-oblique-regular@1.0.1/font.css', family: 'Smiley Sans Oblique' } },
  // 毛笔／书法四款（Google Fonts·SIL OFL 1.1·可商用；只有一个字重 ⇒ 不带 wght；字集是简体·繁体字缺的落回后面的楷书栈）
  { id: 'ma-shan-zheng', label: 'Ma Shan Zheng', zh: '馬善政毛筆楷書', group: 'sc', cjk: true,
    ofl: 'https://raw.githubusercontent.com/google/fonts/main/ofl/mashanzheng/OFL.txt',
    stack: `'Ma Shan Zheng', 'Kaiti TC', 'DFKai-SB', ${SERIF_FALLBACK}`,
    load: { kind: 'google', family: 'Ma Shan Zheng' } },
  { id: 'zhi-mang-xing', label: 'Zhi Mang Xing', zh: '志莽行書', group: 'sc', cjk: true,
    ofl: 'https://raw.githubusercontent.com/google/fonts/main/ofl/zhimangxing/OFL.txt',
    stack: `'Zhi Mang Xing', 'Kaiti TC', 'DFKai-SB', ${SERIF_FALLBACK}`,
    load: { kind: 'google', family: 'Zhi Mang Xing' } },
  { id: 'liu-jian-mao-cao', label: 'Liu Jian Mao Cao', zh: '劉建毛草', group: 'sc', cjk: true,
    ofl: 'https://raw.githubusercontent.com/google/fonts/main/ofl/liujianmaocao/OFL.txt',
    stack: `'Liu Jian Mao Cao', 'Kaiti TC', 'DFKai-SB', ${SERIF_FALLBACK}`,
    load: { kind: 'google', family: 'Liu Jian Mao Cao' } },
  { id: 'long-cang', label: 'Long Cang', zh: '龍藏體', group: 'sc', cjk: true,
    ofl: 'https://raw.githubusercontent.com/google/fonts/main/ofl/longcang/OFL.txt',
    stack: `'Long Cang', 'Kaiti TC', 'DFKai-SB', ${SERIF_FALLBACK}`,
    load: { kind: 'google', family: 'Long Cang' } },
  // ── 繁体 ──
  { id: 'noto-sans-tc', label: 'Noto Sans TC', zh: '思源黑體（繁）', group: 'tc', cjk: true,
    ofl: 'https://raw.githubusercontent.com/google/fonts/main/ofl/notosanstc/OFL.txt',
    stack: `'Noto Sans TC', 'Noto Sans CJK TC', ${SANS_FALLBACK}`,
    load: { kind: 'google', family: 'Noto Sans TC', weights: [400, 700] } },
  { id: 'noto-serif-tc', label: 'Noto Serif TC', zh: '思源宋體（繁）', group: 'tc', cjk: true,
    ofl: 'https://raw.githubusercontent.com/notofonts/noto-cjk/main/Serif/LICENSE',
    stack: `'Noto Serif TC', 'Noto Serif CJK TC', ${SERIF_FALLBACK}`,
    load: { kind: 'google', family: 'Noto Serif TC', weights: [400, 700] } },
  { id: 'iansui', label: 'Iansui', zh: '芫荽', group: 'tc', cjk: true,
    ofl: 'https://raw.githubusercontent.com/ButTaiwan/iansui/master/OFL.txt',
    stack: `'Iansui', 'Klee One', ${SERIF_FALLBACK}`,
    load: { kind: 'google', family: 'Iansui' } },
  { id: 'huninn', label: 'Huninn', zh: 'jf open 粉圓', group: 'tc', cjk: true,
    ofl: 'https://raw.githubusercontent.com/justfont/open-huninn-font/master/LICENSE',
    stack: `'Huninn', 'jf-openhuninn', ${SANS_FALLBACK}`,
    load: { kind: 'google', family: 'Huninn' } },
  // ── 英文 ──
  { id: 'inter', label: 'Inter', zh: '無襯線', group: 'latin', cjk: false,
    ofl: 'https://raw.githubusercontent.com/google/fonts/main/ofl/inter/OFL.txt',
    stack: `'Inter', ${SANS_FALLBACK}`,
    load: { kind: 'google', family: 'Inter', weights: [400, 700] } },
  { id: 'eb-garamond', label: 'EB Garamond', zh: '襯線', group: 'latin', cjk: false,
    ofl: 'https://raw.githubusercontent.com/google/fonts/main/ofl/ebgaramond/OFL.txt',
    stack: `'EB Garamond', ${SERIF_FALLBACK}`,
    load: { kind: 'google', family: 'EB Garamond', weights: [400, 700] } },
  { id: 'jetbrains-mono', label: 'JetBrains Mono', zh: '等寬', group: 'latin', cjk: false,
    ofl: 'https://raw.githubusercontent.com/google/fonts/main/ofl/jetbrainsmono/OFL.txt',
    stack: `'JetBrains Mono', 'Courier New', monospace`,
    load: { kind: 'google', family: 'JetBrains Mono', weights: [400, 700] } },
  { id: 'caveat', label: 'Caveat', zh: '手寫', group: 'latin', cjk: false,
    ofl: 'https://raw.githubusercontent.com/google/fonts/main/ofl/caveat/OFL.txt',
    stack: `'Caveat', cursive, ${SANS_FALLBACK}`,
    load: { kind: 'google', family: 'Caveat', weights: [400, 700] } },
]

export const FONT_IDS: readonly string[] = FONT_CATALOG.map(f => f.id)

// ── 两层清单 ──────────────────────────────────────────────────────────────────────
//   第一层＝上面的 FONT_CATALOG：全部可公开散布（SIL OFL），游客版与登入版都列。
//   第二层＝宿主注入（registerHostFonts）：只有网站登入版才有、不能随开源码散布的字体，由网站在自己的模块里注册；
//   游客版不注册 ⇒ 不列。现在第二层是空的（现有字体全是 OFL）。
//   注入后 findFont／isFontId／fontStack／findFontByFamily／fontIdsInHtml／fontIdsInText／fontCatalog() 都认得；
//   FONT_CATALOG／FONT_IDS 两个常量只代表第一层。
let HOST_FONTS: readonly FontEntry[] = []
let BY_ID = new Map(FONT_CATALOG.map(f => [f.id, f]))
let BY_FAMILY = new Map(FONT_CATALOG.map(f => [f.load.family.toLowerCase(), f]))
/** 宿主注入额外字体（id 跟第一层撞的、不合 FONT_ID_RE 的丢掉）。再呼叫一次＝整批替换。 */
export function registerHostFonts(list: readonly FontEntry[]): void {
  const pub = new Set(FONT_IDS)
  HOST_FONTS = list.filter(f => FONT_ID_RE.test(f.id) && !pub.has(f.id))
  const all = fontCatalog()
  BY_ID = new Map(all.map(f => [f.id, f]))
  BY_FAMILY = new Map(all.map(f => [f.load.family.toLowerCase(), f]))
}
/** 现在可用的全部字体（第一层＋宿主注入）。下拉清单读这个。 */
export function fontCatalog(): readonly FontEntry[] {
  return HOST_FONTS.length ? [...FONT_CATALOG, ...HOST_FONTS] : FONT_CATALOG
}

export function findFont(id: unknown): FontEntry | undefined {
  return typeof id === 'string' ? BY_ID.get(id) : undefined
}
export function isFontId(id: unknown): id is string {
  return typeof id === 'string' && FONT_ID_RE.test(id) && BY_ID.has(id)
}
/** id ⇒ CSS font-family 栈（不在表里 ⇒ undefined·调用方别写 style） */
export function fontStack(id: unknown): string | undefined {
  return findFont(id)?.stack
}

/** 这款字体要挂的 stylesheet 网址（纯函数·单测与载入器同用） */
export function fontCssHref(entry: FontEntry): string {
  if (entry.load.kind === 'google') {
    const fam = entry.load.family.replace(/ /g, '+')
    const w = entry.load.weights?.length ? `:wght@${entry.load.weights.join(';')}` : ''
    return `${googleFontsBase()}/css2?family=${fam}${w}&display=swap`
  }
  return `${npmCdnBase()}/${entry.load.path}`
}

/** 按网络字体名（stylesheet 里的 font-family·＝load.family）反查·大小写不分（简报 iframe 回报的 computed fontFamily 首项） */
export function findFontByFamily(family: unknown): FontEntry | undefined {
  return typeof family === 'string' ? BY_FAMILY.get(family.replace(/["']/g, '').trim().toLowerCase()) : undefined
}

/** 扫一份 HTML（简报本体）里 inline style 用到的表内字体：认 `font-family:` 声明里出现的网络字体名（带引号或裸名） */
export function fontIdsInHtml(html: string): string[] {
  const out: string[] = []
  if (!html || !/font-family/i.test(html)) return out
  const lower = html.toLowerCase()
  for (const f of fontCatalog()) {
    const fam = f.load.family.toLowerCase()
    if (lower.includes(`'${fam}'`) || lower.includes(`"${fam}"`) || lower.includes(`&quot;${fam}&quot;`) || new RegExp(`font-family:\\s*${fam.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[;,"']`).test(lower)) out.push(f.id)
  }
  return out
}
/** 给一组 id 出 <link rel=stylesheet data-font-id> 串（塞进简报 <head>·同 id 由调用方查重） */
export function fontLinkTags(ids: readonly string[]): string {
  return ids.map(id => findFont(id)).filter((f): f is FontEntry => !!f)
    .map(f => `<link rel="stylesheet" data-font-id="${f.id}" href="${fontCssHref(f)}" crossorigin="anonymous">`).join('\n')
}

/** 扫 markdown／任意文本里用到的字体 id（:font[…]{family=id}）·只回表内的 */
const FONT_DIRECTIVE_ID_RE = /:font\[(?:\\.|[^\]\\])*\]\{\s*family\s*=\s*([a-z0-9-]{1,40})\s*\}/g
export function fontIdsInText(text: string): string[] {
  const out = new Set<string>()
  if (!text || !text.includes(':font[')) return []
  for (const m of text.matchAll(FONT_DIRECTIVE_ID_RE)) if (BY_ID.has(m[1])) out.add(m[1])
  return [...out]
}

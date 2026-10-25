/**
 * slide-kit · 外部简报版式模板抽出来的主题（清单）
 *
 *  口径：⛔ 不把模板当整页 HTML 塞——只抽版式库能表达的部分：
 *   主色／辅色／背景（bg）／标题与正文色（ink／darkInk）／字体（对上字体表 shared/fonts/catalog.ts）／深浅策略／装饰风格名（decor·只描述）。
 * 读数来源（逐套）：reveal.js 读 `--r-*` 变量原值；Marp／Slidev／Shower 在浏览器开各自示例页读第 1、2 张投影片的计算样式＋截图主色像素；
 *   neobeam 各变体读自己那份 css 的 `--primary`。
 * 取舍：
 *   字体：原模板多是拉丁字体（Source Sans Pro／Lato／Palatino／Montserrat…）·中文投影片要中文字体 ⇒ 按「无衬线→思源黑體」「衬线→思源宋體」
 *     「圆体／可爱→jf open 粉圓（Huninn）」对到字体表；拉丁原字体名记在 decor 里。
 *   渐层／纹理／照片／几何色块／波浪／缎带等装饰：版式库没有这层 ⇒ 取主色单色·decor 写明原装饰。
 *   强调色对浅底 < 3:1 的（Marp husserl 红、Slidev bricks 珊瑚、Shower material 绿）压暗一阶同色相（引擎本就会回退主色·压暗才保得住色相）。
 * 全部 MIT（版权行与 LICENSE 出处见本目录 THIRD_PARTY.md）。⛔ 不进生成期随机池 THEMES。
 */
import type { Theme } from './types'

const SANS = 'Noto Sans TC'
const SERIF = 'Noto Serif TC'
const ROUND = 'Huninn'
const sans = { heading: SANS, body: SANS }
const serif = { heading: SERIF, body: SERIF }

export const THIRD_PARTY_TEMPLATE_THEMES: Theme[] = [
  // ── reveal.js 官方主题 11 套（--r-background-color／--r-heading-color／--r-main-color／--r-link-color 原值） ──
  { id: 'reveal-black', name: 'reveal.js Black', primary: '#191919', secondary: '#9a9a9a', accent: '#42affa', darkMode: 'all-dark', fontPair: sans,
    darkInk: { heading: '#FFFFFF', body: '#FFFFFF' }, decor: '大写粗体标题·无装饰（原字体 Source Sans Pro）' },
  { id: 'reveal-white', name: 'reveal.js White', primary: '#222222', secondary: '#9aa4ae', accent: '#2a76dd', darkMode: 'light', fontPair: sans,
    bg: '#FFFFFF', ink: { heading: '#222222', body: '#222222' }, decor: '大写粗体标题·无装饰（原字体 Source Sans Pro）' },
  { id: 'reveal-league', name: 'reveal.js League', primary: '#2e3134', secondary: '#7a8288', accent: '#13daec', darkMode: 'all-dark', fontPair: sans,
    darkInk: { heading: '#EEEEEE', body: '#EEEEEE' }, decor: '灰阶径向渐层（#555a5f→#1c1e20·取中段单色）·标题字阴影（原字体 League Gothic／Lato）' },
  { id: 'reveal-beige', name: 'reveal.js Beige', primary: '#333333', secondary: '#c2aa73', accent: '#8b743d', darkMode: 'light', fontPair: sans,
    bg: '#f7f3de', ink: { heading: '#333333', body: '#333333' }, decor: '米黄径向渐层（#fff→#f7f2d3·取底色）（原字体 Source Sans Pro）' },
  { id: 'reveal-night', name: 'reveal.js Night', primary: '#111111', secondary: '#888888', accent: '#e7ad52', darkMode: 'all-dark', fontPair: sans,
    darkInk: { heading: '#FFFFFF', body: '#FFFFFF' }, decor: '纯黑底·琥珀链接色（原字体 Montserrat／Open Sans）' },
  { id: 'reveal-serif', name: 'reveal.js Serif', primary: '#383d3d', secondary: '#857765', accent: '#51483d', darkMode: 'light', fontPair: serif,
    bg: '#f0f1eb', ink: { heading: '#383d3d', body: '#000000' }, decor: '灰米底·全衬线（原字体 Palatino）' },
  { id: 'reveal-simple', name: 'reveal.js Simple', primary: '#000000', secondary: '#8c8c8c', accent: '#00008b', darkMode: 'light', fontPair: sans,
    bg: '#FFFFFF', ink: { heading: '#000000', body: '#000000' }, decor: '纯白底·海军蓝链接（原字体 News Cycle／Lato）' },
  { id: 'reveal-solarized', name: 'reveal.js Solarized', primary: '#586e75', secondary: '#93a1a1', accent: '#268bd2', darkMode: 'light', fontPair: sans,
    bg: '#fdf6e3', ink: { heading: '#586e75', body: '#657b83' }, decor: 'Solarized 浅色色盘（原字体 League Gothic／Lato）' },
  { id: 'reveal-moon', name: 'reveal.js Moon', primary: '#002b36', secondary: '#93a1a1', accent: '#268bd2', darkMode: 'all-dark', fontPair: sans,
    darkInk: { heading: '#eee8d5', body: '#93a1a1' }, decor: 'Solarized 深色色盘（原字体 League Gothic／Lato）' },
  { id: 'reveal-dracula', name: 'reveal.js Dracula', primary: '#191919', secondary: '#6272a4', accent: '#ff79c6', darkMode: 'all-dark', fontPair: sans,
    darkInk: { heading: '#bd93f9', body: '#f8f8f2' }, decor: 'Dracula 色盘·紫标题粉链接（原字体 系统无衬线）' },
  { id: 'reveal-sky', name: 'reveal.js Sky', primary: '#333333', secondary: '#add9e4', accent: '#2a76dd', darkMode: 'light', fontPair: { heading: ROUND, body: SANS },
    bg: '#d9eef3', ink: { heading: '#333333', body: '#333333' }, decor: '浅蓝径向渐层（#f7fbfc→#add9e4·取中段单色）·圆体标题（原字体 Quicksand／Open Sans）' },
  // ── Marp 14 套（示例页计算样式＋截图主色） ──
  { id: 'marp-default', name: 'Marp Default', primary: '#224466', secondary: '#8c959f', accent: '#4488cc', darkMode: 'light', fontPair: sans,
    bg: '#FFFFFF', ink: { heading: '#224466', body: '#1f2328' }, decor: 'GitHub 风白底·藏青标题（原字体 系统无衬线）' },
  { id: 'marp-gaia', name: 'Marp Gaia', primary: '#455a64', secondary: '#b8ad8e', accent: '#0288d1', darkMode: 'light', fontPair: sans,
    bg: '#fff8e1', ink: { heading: '#455a64', body: '#455a64' }, decor: '奶油底斜条纹（版式库无纹理·取底色）（原字体 Lato）' },
  { id: 'marp-uncover', name: 'Marp Uncover', primary: '#202228', secondary: '#a0a3ad', accent: '#009dd5', darkMode: 'light', fontPair: sans,
    bg: '#fdfcff', ink: { heading: '#202228', body: '#202228' }, decor: '居中大字·右下折角（版式库只取配色）（原字体 系统无衬线）' },
  { id: 'marp-academic', name: 'Marp Academic', primary: '#333333', secondary: '#b3b3b3', accent: '#800000', darkMode: 'light', fontPair: sans,
    bg: '#FFFFFF', ink: { heading: '#800000', body: '#333333' }, decor: '学术白底·栗红标题（原字体 Noto Sans JP）' },
  { id: 'marp-hegel', name: 'marpstyle Hegel', primary: '#002b36', secondary: '#c9b8a8', accent: '#b56e0a', darkMode: 'light', fontPair: sans,
    bg: '#faf7f7', ink: { heading: '#002b36', body: '#1f2328' }, decor: '米白底·标题下橘色细线（原橘 #e99211 对底 <3:1·压暗一阶）（原字体 系统无衬线）' },
  { id: 'marp-heidegger', name: 'marpstyle Heidegger', primary: '#080a0a', secondary: '#d19a2c', accent: '#080a0a', darkMode: 'light', fontPair: sans,
    bg: '#f8b632', ink: { heading: '#080a0a', body: '#080a0a' }, decor: '橘底内容页·黑色标题横带（版式库无横带·取配色）（原字体 Fira Sans Condensed）' },
  { id: 'marp-husserl', name: 'marpstyle Husserl', primary: '#0b2545', secondary: '#9aa3ad', accent: '#d62828', darkMode: 'light', fontPair: serif,
    bg: '#dbdfe3', ink: { heading: '#0b2545', body: '#2e2e30' }, decor: '灰蓝底·衬线·红色强调（原红 #f83232 对底 <3:1·压暗一阶）（原字体 Lora）' },
  { id: 'marp-neobeam', name: 'Neobeam', primary: '#1b2a41', secondary: '#4d85d1', accent: '#4d85d1', darkMode: 'light', fontPair: sans,
    bg: '#fafafa', ink: { heading: '#111111', body: '#111111' }, decor: 'Beamer 风·标题圆角色块（版式库只取配色）（原字体 Roboto）' },
  { id: 'marp-ecobeam', name: 'Neobeam Ecobeam', primary: '#2d3d18', secondary: '#97b36f', accent: '#608534', darkMode: 'light', fontPair: sans,
    bg: '#ecf1e5', ink: { heading: '#111111', body: '#111111' }, decor: 'Beamer 风·浅绿底绿色块（原字体 Roboto）' },
  { id: 'marp-neonbeam', name: 'Neobeam Neonbeam', primary: '#1a1a1a', secondary: '#ffb38a', accent: '#ff5c00', darkMode: 'light', fontPair: sans,
    bg: '#FFFFFF', ink: { heading: '#111111', body: '#111111' }, decor: 'Beamer 风·霓虹橘色块（原字体 Quantico·中文无同类·用思源黑體）' },
  { id: 'marp-oldenbeam', name: 'Neobeam Oldenbeam', primary: '#41424c', secondary: '#a3a4ad', accent: '#41424c', darkMode: 'light', fontPair: serif,
    bg: '#FFFFFF', ink: { heading: '#111111', body: '#111111' }, decor: 'Beamer 风·古典灰色块·衬线（原字体 Hedvig Letters Serif）' },
  { id: 'marp-dracula', name: 'Marp Dracula', primary: '#282a36', secondary: '#6272a4', accent: '#bd93f9', darkMode: 'all-dark', fontPair: sans,
    darkInk: { heading: '#ff79c6', body: '#f8f8f2' }, decor: 'Dracula 色盘·粉标题（原字体 IBM Plex Sans）' },
  { id: 'marp-cybertopia', name: 'Cybertopia', primary: '#000000', secondary: '#02c797', accent: '#02c797', darkMode: 'all-dark', fontPair: sans,
    darkInk: { heading: '#FFFFFF', body: '#FFFFFF' }, decor: '黑底点阵·绿色描框标题（版式库只取配色）' },
  { id: 'marp-wave', name: 'Marp Wave', primary: '#002233', secondary: '#bbdaff', accent: '#0066ff', darkMode: 'all-dark', fontPair: sans,
    darkInk: { heading: '#FFFFFF', body: '#FFFFFF' }, decor: '深蓝底·页底蓝色波浪（版式库无波浪·取配色）（原字体 Roboto）' },
  // ── Slidev 6 套（示例构建计算样式·封面照片不随主题授权 ⇒ 换纯深色） ──
  { id: 'slidev-default', name: 'Slidev Default', primary: '#121212', secondary: '#9ca3af', accent: '#3ab9d5', darkMode: 'sandwich', fontPair: sans,
    bg: '#FFFFFF', ink: { heading: '#000000', body: '#000000' }, decor: '封面全幅照片（换纯深色）·内容页白底（原字体 Avenir Next／Nunito Sans）' },
  { id: 'slidev-seriph', name: 'Slidev Seriph', primary: '#2b2b2b', secondary: '#5d8392', accent: '#4d7534', darkMode: 'sandwich', fontPair: serif,
    bg: '#FFFFFF', ink: { heading: '#4d7534', body: '#000000' }, decor: '封面照片＋暗罩（换纯深色）·墨绿衬线标题（原字体 PT Serif）' },
  { id: 'slidev-apple-basic', name: 'Slidev Apple Basic', primary: '#000000', secondary: '#86868b', accent: '#000000', darkMode: 'light', fontPair: sans,
    bg: '#FFFFFF', ink: { heading: '#000000', body: '#000000' }, decor: '发布会风·大号粗标题·零装饰（原字体 Helvetica Neue）' },
  { id: 'slidev-bricks', name: 'Slidev Bricks', primary: '#000000', secondary: '#72a6e2', accent: '#d9503f', darkMode: 'light', fontPair: { heading: ROUND, body: SANS },
    bg: '#FFFFFF', ink: { heading: '#000000', body: '#000000' }, decor: '几何色块（黄 #f9d56e／珊瑚 #f07a6b／蓝 #72a6e2·版式库无色块·取珊瑚压暗一阶作强调）（原字体 Sigmar One）' },
  { id: 'slidev-shibainu', name: 'Slidev Shibainu', primary: '#734226', secondary: '#bf926b', accent: '#e6c7a5', darkMode: 'all-dark', fontPair: { heading: ROUND, body: SANS },
    darkInk: { heading: '#ebeef2', body: '#ebeef2' }, decor: '柴犬棕有机曲线色块＋点阵（版式库只取配色·浅褐 #bf926b 对深棕 <3:1 提亮一阶作强调）（原字体 Titillium Web）' },
  { id: 'slidev-academic', name: 'Slidev Academic', primary: '#181818', secondary: '#9ca3af', accent: '#5d8392', darkMode: 'sandwich', fontPair: sans,
    bg: '#FFFFFF', ink: { heading: '#181818', body: '#181818' }, decor: '封面全幅照片（换纯深色）·页码角标（原字体 Montserrat）' },
  // ── Shower 2 套 ──
  { id: 'shower-ribbon', name: 'Shower Ribbon', primary: '#000000', secondary: '#9aa4ae', accent: '#cc0000', darkMode: 'light', fontPair: sans,
    bg: '#FFFFFF', ink: { heading: '#000000', body: '#000000' }, decor: '右上红色书签缎带（版式库无缎带·取配色）（原字体 PT Sans）' },
  { id: 'shower-material', name: 'Shower Material', primary: '#212121', secondary: '#a5d6a7', accent: '#388e3c', darkMode: 'light', fontPair: sans,
    bg: '#FFFFFF', ink: { heading: '#212121', body: '#424242' }, decor: '页首绿色色带（#4caf50 对白 <3:1·强调压暗一阶）（原字体 Roboto）' },
]

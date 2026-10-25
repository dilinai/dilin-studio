// 宿主接口：** 里**唯一**准许碰网站本体的档（边界题放行它）。
//   开源仓原样带着这一档：地区判定由仓里的 src/lib/region.ts 顶替，
//   打包时设 NEXT_PUBLIC_STUDIO_STANDALONE=1 ⇒ 网址改成单页的 index.html?app=…（双击打开也能走）、注册页指回线上网站。
//   ⛔ 在这里放密钥或内部网址；只读 NEXT_PUBLIC_ 开头的公开设定。
//   用相对路径 import（不用 @/ 别名）⇒ node 直跑单测也解析得到。

import { getRegion } from '../../lib/region'
import type { StudioLang } from './types'

/** 简体站（dilinai.cn）？——简体默认、语言锁定、文案不写境外服务名。 */
export function isSimplifiedSite(): boolean {
  return getRegion() === 'cn'
}

/** 默认语言：简体站简中，其余繁中。 */
export function defaultLang(): StudioLang {
  return isSimplifiedSite() ? 'zh-CN' : 'zh-TW'
}

/** 语言能不能切换：简体站锁简中（与网站本体 LanguageProvider 同一规矩）。 */
export function langLocked(): boolean {
  return isSimplifiedSite()
}

/** 右栏三种用法要不要用不带服务名的说法（简体站 ⛔ 出现 GitHub 按钮以外的境外服务名）。 */
export function neutralServiceNames(): boolean {
  return isSimplifiedSite()
}

/** 开源仓的单页版（不在网站里跑）？⚠️ 必须写成字面 process.env.NEXT_PUBLIC_…（编译期代入）。 */
export function isStandalone(): boolean {
  return process.env.NEXT_PUBLIC_STUDIO_STANDALONE === '1'
}

/** 线上网站（简体站 dilinai.cn、其余 dilinai.com）。 */
export function siteOrigin(): string {
  return isSimplifiedSite() ? 'https://dilinai.cn' : 'https://dilinai.com'
}

/** 右栏广告那一行导去的注册页。 */
export const SIGNUP_HREF = isStandalone() ? `${siteOrigin()}/signup` : '/signup'

/** 游客版左栏「登入」钮去的登入页（开源单机版指回线上网站）。 */
export const LOGIN_HREF = isStandalone() ? `${siteOrigin()}/login` : '/login'

/** 左上角品牌那颗的图（网站与开源仓都带同一张 logo.png）。 */
export function studioLogoSrc(): string {
  return isStandalone() ? 'logo.png' : '/logo.png'
}

/** 编辑器自带的静态档（例：画板引擎 /drawboard-app/…、剪辑 /vedit/…）的网址：开源单页版改成相对路径。 */
export function studioStaticHref(path: string): string {
  return isStandalone() ? path.replace(/^\/+/, '') : path
}

/** AI 交成品给用户的链接开在哪：线上网站的 /studio/<编辑器>（带 ?import= 或 #p=）。 */
export function studioPublicAppUrl(app: string): string {
  return `${siteOrigin()}/studio/${app}`
}

/** 网站游客版才有短网址代存（作品暂存在网站的储存、网址 /s/<码>）；开源单机版没有服务器 ⇒ false，一律照旧。 */
export function shareEnabled(): boolean {
  return !isStandalone()
}

/** 短网址代存接口的前缀（同源相对路径）。 */
export function shareApiBase(): string {
  return '/api/studio-share'
}

/** 短网址页的路径（网址栏换成这个）。 */
export function sharePath(code: string): string {
  return `/s/${code}`
}

/** 「前往 GitHub 开源仓」按钮的网址：空字串 ⇒ 不显示。⚠️ 必须写成字面 process.env.NEXT_PUBLIC_…（Next 编译期代入）。 */
export function studioGithubUrl(): string {
  const v = (process.env.NEXT_PUBLIC_STUDIO_GITHUB_URL || '').trim()
  return /^https:\/\//.test(v) ? v : ''
}

/** 右栏「前往 GitHub」「給個星星」两颗钮开的开源仓页（GitHub 不能跨站一键点星 ⇒ 星星钮也开仓页）。 */
export const STUDIO_OSS_REPO_URL = 'https://github.com/dilinai/dilin-studio'
/** 开源仓公开了没：false ⇒ 两颗钮照常显示、按了没反应（不开分页、不报错）；true ⇒ 新分页开 STUDIO_OSS_REPO_URL。 */
export const STUDIO_OSS_REPO_PUBLIC: boolean = true

/**
 * Studio 各页的网址。开源单页版：index.html?app=<编辑器>&id=<编号>（双击打开的 file:// 也认得）；网站上回总页＝/dilin。
 *   appNew＝「一定开一份新的」那条（带 new=1）：⛔ 调用处自己在 app() 后面接 `?new=1`——单页版的 app() 本来就带 ?，
 *   接出来是 ?app=video?new=1，单页壳 URLSearchParams 读到的 app 是「video?new=1」、认不出编辑器、退回总页。要带参数一律在这里拼。
 */
export const studioHref = isStandalone()
  ? {
    root: () => 'index.html',
    app: (app: string) => `index.html?app=${app}`,
    appNew: (app: string) => `index.html?app=${app}&new=1`,
    project: (app: string, id: string) => `index.html?app=${app}&id=${id}`,
  }
  : {
    // 网站上没有 /studio 总页：五个入口在 /dilin 顶栏，回总页＝回 /dilin
    root: () => '/dilin',
    app: (app: string) => `/studio/${app}`,
    appNew: (app: string) => `/studio/${app}?new=1`,
    project: (app: string, id: string) => `/studio/${app}/${id}`,
  }

/**
 * 简报皮肤装饰图的图床前缀（皮肤表里存 templates/slides/… 相对路径·渲染时接上这个前缀）。
 *   网站＝自家公开图床；开源拆仓时换成仓内静态档的前缀，或空字串＝不显示装饰图（其余照常）。
 */
export function skinAssetBase(): string {
  return 'https://img.dilinai.com/'
}

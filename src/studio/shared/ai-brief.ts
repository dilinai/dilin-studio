// 「人看不到、AI 抓网址就读得到」的说明（纯函数·有题）：编辑页服务端输出的 HTML 里带这一段（ui/AIBrief.tsx），
//   右栏「複製」只给网址，怎么用、工程档格式、改完怎么交回都在这里由 AI 读、再由 AI 教用户。
//   开头先列三条路请 AI 问用户选哪条：①本机跑单机版；②就在网页里做（存浏览器 OPFS、不上传）；③拿短网址（会上传·先取得同意）。
//   短网址（接口见 share-api.ts）：
//   一、AI 自己做好 ⇒ POST /api/studio-share（by:'ai'）建立、素材走 assets/init → 各 part → complete ⇒ 回用户 /s/<码>；之后用自己的票 PUT 新版。
//   二、用户给 AI 的是 /s/<码> ⇒ GET 读；要改 ⇒ 手上有票就直接 PUT；没有才 pair-request ⇒ 用户念页面上的 6 位验证码 ⇒ pair-confirm 拿票 ⇒ PUT（带 base_version）。
//   只能产网址的 AI（第②条，连不上建立接口时也用；规矩照 import-link.ts）：小作品 #p=；大的或带素材 zip 放公开地址 ?import=。
//   简体站（neutralServiceNames）用不带境外服务名的说法。
//   格式重点（format.summaryForAI）由呼叫端给（AIBrief.tsx 经 registry.ts 的 STUDIO_FORMAT_LOADERS 载）。

import type { StudioAppId, StudioLang } from './types'
import { STUDIO_SHARED_I18N, makeStudioT } from './i18n'
import { siteOrigin, studioPublicAppUrl } from './host'
import { LINK_HASH_MAX_CHARS, LINK_RECOMMENDED_MAX_CHARS } from './import-link'

/** 格式里素材能直接写 https:// 网址的编辑器（各 FORMAT.md：docs src、sheets images.url、slides 图片影片）；其余素材只能放 assets/。 */
const MEDIA_HTTPS = new Set<StudioAppId>(['docs', 'sheets', 'slides'])

const APP_NAME_KEY: Record<StudioAppId, string> = {
  docs: 'studio_app_docs', sheets: 'studio_app_sheets', slides: 'studio_app_slides', video: 'studio_app_video', paint: 'studio_app_paint',
}

/** 短网址那几段（编辑页与 /s/<码> 页共用）。 */
function shareParas(t: ReturnType<typeof makeStudioT>, origin: string, app: string): { create: string[]; given: string[]; close: string } {
  return {
    create: [t('studio_brief_share_create', { origin, app }), t('studio_brief_share_assets', { origin }), t('studio_brief_share_reply', { origin }), t('studio_brief_step')],
    given: [t('studio_brief_share_read', { origin }), t('studio_brief_share_edit_rules'), t('studio_brief_share_pair', { origin })],
    close: t('studio_brief_share_close'),
  }
}

/** 一个编辑器、一种语言的说明（段落阵列·第一段是标题）。neutral＝不写境外服务名。 */
export function studioAIBrief(app: StudioAppId, lang: StudioLang, neutral: boolean, summary: string): string[] {
  const t = makeStudioT([STUDIO_SHARED_I18N], lang)
  const appName = t(APP_NAME_KEY[app])
  const base = studioPublicAppUrl(app)
  const origin = siteOrigin()
  const s = shareParas(t, origin, app)
  return [
    t('studio_brief_heading'),
    t('studio_brief_intro', { appName, app }),
    t('studio_brief_project'),
    t('studio_brief_ways', { base, origin }),
    t('studio_brief_share_title', { origin }),
    ...s.create,
    t('studio_brief_share_given_title', { origin }),
    ...s.given,
    s.close,
    t('studio_brief_fallback_title'),
    t('studio_brief_flow_hash', { base, max: LINK_HASH_MAX_CHARS, rec: LINK_RECOMMENDED_MAX_CHARS }),
    t(MEDIA_HTTPS.has(app) ? 'studio_brief_media_https' : 'studio_brief_media_assets', { appName }),
    t('studio_brief_zip', { base }),
    t('studio_brief_flow_open'),
    t('studio_brief_flow_apps', { app }),
    t('studio_brief_edit_title'),
    t('studio_brief_way_folder'),
    t(neutral ? 'studio_brief_way_browser_neutral' : 'studio_brief_way_browser'),
    t('studio_brief_opfs'),
    t('studio_brief_teach'),
    t('studio_brief_format_title', { appName }),
    summary.trim(),
  ]
}

/** /s/<码> 页的说明（格式重点请 AI 去看那个编辑器页）。embedded＝这页已带着作品全文（ui/AIBrief.tsx 的 ShareWorkEmbed）⇒ 先叫只能读网页的 AI 直接读这页、GET 接口退为次选。 */
export function studioShareBrief(code: string, lang: StudioLang, embedded = false): string[] {
  const t = makeStudioT([STUDIO_SHARED_I18N], lang)
  const origin = siteOrigin()
  const s = shareParas(t, origin, '<app>')
  const fill = (x: string) => x.split('<code>').join(code)
  return [
    t('studio_brief_heading'),
    t('studio_brief_share_page_intro', { code, origin }),
    ...(embedded ? [t('studio_brief_share_page_embedded')] : []),
    ...s.given.map(fill),
    fill(s.create[2]),
    s.create[3],
    fill(s.create[1]),
    s.close,
    t('studio_brief_teach'),
  ]
}

/** 这个站服务端要输出哪几种语言：简体站只出简中；其余出繁中＋英文。 */
export function studioBriefLangs(simplified: boolean): StudioLang[] {
  return simplified ? ['zh-CN'] : ['zh-TW', 'en']
}

/** /s/<码> 页放进 HTML 的作品资料（服务端 lib/studio-share/handlers.ts 的 readShareForPage 产出；这里只定形状·不引 lib）。 */
export type ShareEmbedData = { app: string; version: number; projectJson: string | null; tooLargeBytes: number | null; assets: string[] }

/** 作品全文前后的说明行（每种语言一组）：head、太大说明（只在太大时）、素材档名（有素材时）。 */
export function shareEmbedLines(code: string, lang: StudioLang, d: ShareEmbedData): { head: string; tooBig: string | null; assets: string | null } {
  const t = makeStudioT([STUDIO_SHARED_I18N], lang)
  const origin = siteOrigin()
  return {
    head: t('studio_brief_share_embed_head', { version: d.version, app: d.app }),
    tooBig: d.projectJson === null
      ? t('studio_brief_share_embed_too_big', { mb: ((d.tooLargeBytes ?? 0) / 1024 / 1024).toFixed(1), origin, code, app: d.app, version: d.version })
      : null,
    assets: d.assets.length ? t('studio_brief_share_embed_assets', { list: d.assets.join(', ') }) : null,
  }
}

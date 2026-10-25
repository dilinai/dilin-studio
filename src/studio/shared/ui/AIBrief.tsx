// 给 AI 的说明区块（服务端组件·不加 'use client'）：编辑页路由壳（/studio/<编辑器>、/studio/<编辑器>/<编号>）在服务端渲染它，
//   AI 抓这页网址拿到的原始 HTML（不跑 JS）里就有这段字。画面上用 sr-only 藏起来（仍在 HTML 文字里、读屏与操作浏览器的 AI 也读得到）。
//   内容见 ai-brief.ts；简体站只出简中、不写境外服务名。

import type { StudioAppId } from '../types'
import { isSimplifiedSite, neutralServiceNames } from '../host'
import { studioAIBrief, studioBriefLangs, studioShareBrief, shareEmbedLines, type ShareEmbedData } from '../ai-brief'
import { studioNeg } from '../ai-panel.pure'
import { STUDIO_FORMAT_LOADERS } from '../registry'

export default async function AIBrief({ app }: { app: StudioAppId }) {
  if (studioNeg('studio-ai-brief-ssr')) return null   // 负控：退回修前（HTML 里没有说明）
  const neutral = neutralServiceNames() && !studioNeg('studio-ai-brief-neutral')
  const format = await STUDIO_FORMAT_LOADERS[app]()
  return (
    <section className="sr-only" data-testid="studio-ai-brief" data-ai-instructions="true">
      {studioBriefLangs(isSimplifiedSite()).map(lang => {
        const [heading, ...paras] = studioAIBrief(app, lang, neutral, format.summaryForAI(lang))
        return (
          <div key={lang} lang={lang}>
            <h2>{heading}</h2>
            {paras.map((p, i) => <p key={i} style={{ whiteSpace: 'pre-wrap' }}>{p}</p>)}
          </div>
        )
      })}
    </section>
  )
}

/** /s/<码> 页的说明（同样服务端渲染、视觉隐藏）：怎么读、怎么配对改这一份。 */
export function ShareAIBrief({ code, embedded = false }: { code: string; embedded?: boolean }) {
  if (studioNeg('studio-ai-brief-ssr')) return null
  return (
    <section className="sr-only" data-testid="studio-ai-brief" data-ai-instructions="true">
      {studioBriefLangs(isSimplifiedSite()).map(lang => {
        const [heading, ...paras] = studioShareBrief(code, lang, embedded)
        return (
          <div key={lang} lang={lang}>
            <h2>{heading}</h2>
            {paras.map((p, i) => <p key={i} style={{ whiteSpace: 'pre-wrap' }}>{p}</p>)}
          </div>
        )
      })}
    </section>
  )
}

/** /s/<码> 页的作品全文（服务端渲染·视觉隐藏但留在文字流里）：claude.ai 这类只抓用户贴的网址、不另开 /api 的 AI 也读得到。
 *  ⛔ display:none／hidden／<script type=application/json>（很多抓取器转文字会丢）；用 sr-only（clip）的 <pre>。
 *  JSON 走 React 文本节点 ⇒ </script>、<b> 等自动跳脱。素材只列档名（签名网址会过期·不放）。
 *  负控 DILIN_NEG=studio_share_ssr_no_embed ⇒ 不放（退回修前）。 */
export function ShareWorkEmbed({ code, data }: { code: string; data: ShareEmbedData | null }) {
  if (!data || studioNeg('studio_share_ssr_no_embed')) return null
  const langs = studioBriefLangs(isSimplifiedSite())
  const lines = langs.map(lang => ({ lang, ...shareEmbedLines(code, lang, data) }))
  return (
    <section className="sr-only" data-testid="studio-share-embed" data-ai-instructions="true">
      {lines.map(l => (
        <div key={l.lang} lang={l.lang}>
          <p>{l.tooBig ?? l.head}</p>
          {l.assets && <p>{l.assets}</p>}
        </div>
      ))}
      {data.projectJson !== null && <pre data-testid="studio-share-project-json">{data.projectJson}</pre>}
    </section>
  )
}

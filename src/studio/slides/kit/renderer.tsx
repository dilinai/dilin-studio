/**
 * slide-kit · 三缩放渲染器
 * 同一份数据（layoutId + draft + theme + images）按目标宽度等比渲染——
 * 缩略图（width≈200）/ 编辑画布（width≈760）/ 放映（width≈视口）走同一入口。
 */

import * as React from 'react'
import { CANVAS_HEIGHT, CANVAS_WIDTH } from './types'
import type { LayoutLocale, PageDraft, SlotImageValue, Theme } from './types'
import { getLayout } from './registry'

export type SlideViewProps = {
  layoutId: string
  draft: PageDraft
  theme: Theme
  /** 图槽 id → 裸 url 或 {url, crop}（key 约定见 types.imageSlotKey；
   *  crop=S2 图池匹配裁剪窗·版式层真消费） */
  images?: Record<string, SlotImageValue>
  /** 版式静态文案语言（目录/致谢默认语）·缺省 zh-TW；
   *  version:2 deck_data 顶层带 lang·读侧重渲传它 */
  locale?: LayoutLocale
  /** 目标渲染宽度（px）·高度按 16:9 自算 */
  width: number
}

/**
 * 版式在 1000×562.5 逻辑画布里排版，这里按 width/1000 等比缩放。
 * 未知 layoutId 渲中性占位框（渲染入口不 throw·选版式合法性由 S2/调用方保证）。
 */
export function SlideView(props: SlideViewProps): React.JSX.Element {
  const { layoutId, draft, theme, images, locale, width } = props
  const scale = width / CANVAS_WIDTH
  const height = width * (CANVAS_HEIGHT / CANVAS_WIDTH)
  const entry = getLayout(layoutId)
  return (
    <div style={{ width, height, position: 'relative', overflow: 'hidden' }}>
      <div
        style={{
          width: CANVAS_WIDTH,
          height: CANVAS_HEIGHT,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          position: 'absolute',
          top: 0,
          left: 0,
        }}
      >
        {entry ? (
          <entry.Component draft={draft} theme={theme} images={images} locale={locale} />
        ) : (
          <div
            style={{
              width: CANVAS_WIDTH,
              height: CANVAS_HEIGHT,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: '#F3F4F6',
              color: '#6B7280',
              fontSize: 18,
              border: '1px dashed #D1D5DB',
              boxSizing: 'border-box',
            }}
          >
            未知版式：{layoutId}
          </div>
        )}
      </div>
    </div>
  )
}

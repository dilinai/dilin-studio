/**
 * slide-kit · 目录版式 ×2
 * adapted from presenton (Apache-2.0)：
 *   contents-index ← swift/two_column_index_layout_6248 · modern/two_column_index_grid_5706
 *   contents-cards ← general/centered_contents_layout_8178（改卡片网格）
 * 改造：坐标系 1000×562.5、契约槽位、中文排版、去强调线。
 */

import * as React from 'react'
import type { LayoutEntry, LayoutProps } from '../types'
import { makeSlotTable } from '../types'
import { resolvePalette } from '../themes'
import { Canvas, Dot, NumberBadge, bodyStyle, chromeText, clampStyle, headingStyle, pad2, textOr } from './shared'

/** 唯一取值点：脏 deck_data 防御——items 非数组当空·非字符串条目渲空。 */
function contentsItems(props: LayoutProps, cap: number): string[] {
  const raw = props.draft.type === 'contents' && Array.isArray(props.draft.items) ? props.draft.items : []
  return raw.slice(0, cap).map(textOr)
}

/* ---------------- contents-index：左标题右双栏索引（容量 10） ---------------- */

function ContentsIndex(props: LayoutProps): React.JSX.Element {
  const { theme } = props
  const items = contentsItems(props, 10)
  const p = resolvePalette(theme, 'contents')
  const half = Math.ceil(items.length / 2)
  const cols = [items.slice(0, half), items.slice(half)]
  return (
    <Canvas palette={p} theme={theme}>
      <div style={{ display: 'flex', height: '100%', padding: 64, gap: 60, boxSizing: 'border-box' }}>
        <div style={{ flex: '0 0 26%', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <Dot palette={p} size={12} />
          <h2 style={{ ...headingStyle(theme, p, 44), marginTop: 20 }}>{chromeText(props.locale).contents}</h2>
          <p style={{ ...bodyStyle(p, 15), marginTop: 14 }}>{chromeText(props.locale).contentsEyebrow}</p>
        </div>
        <div style={{ flex: 1, display: 'flex', gap: 48, alignItems: 'center', minWidth: 0 }}>
          {cols.map((col, ci) =>
            col.length ? (
              <div key={ci} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 22, minWidth: 0 }}>
                {col.map((it, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 16, minWidth: 0 }}>
                    <NumberBadge palette={p} label={pad2(ci * half + i)} size={38} />
                    <span style={{ fontSize: 17, lineHeight: 1.5, color: p.text, ...clampStyle(2), minWidth: 0 }}>
                      {it}
                    </span>
                  </div>
                ))}
              </div>
            ) : null,
          )}
        </div>
      </div>
    </Canvas>
  )
}

export const contentsIndex: LayoutEntry = {
  meta: {
    id: 'contents-index',
    desc: '目錄·左標題右雙欄清單（最多 10 項）',
    pageType: 'contents',
    slots: makeSlotTable({ text: { item: 10, itemNumber: 10 }, image: {} }),
  },
  Component: ContentsIndex,
}

/* ---------------- contents-cards：居中标题+卡片网格（容量 6） ---------------- */

function ContentsCards(props: LayoutProps): React.JSX.Element {
  const { theme } = props
  const items = contentsItems(props, 6)
  const p = resolvePalette(theme, 'contents')
  const perRow = items.length <= 4 ? 2 : 3
  return (
    <Canvas palette={p} theme={theme}>
      <div
        style={{
          height: '100%', padding: '54px 72px', display: 'flex', flexDirection: 'column',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
          <Dot palette={p} size={10} />
          <h2 style={{ ...headingStyle(theme, p, 36) }}>{chromeText(props.locale).contents}</h2>
          <Dot palette={p} size={10} />
        </div>
        <div
          style={{
            flex: 1, marginTop: 36, display: 'grid', gap: 20,
            gridTemplateColumns: `repeat(${perRow}, 1fr)`, alignContent: 'center',
          }}
        >
          {items.map((it, i) => (
            <div
              key={i}
              style={{
                background: p.surface, border: `1px solid ${p.border}`, borderRadius: 14,
                padding: '20px 22px', display: 'flex', alignItems: 'center', gap: 16, minWidth: 0,
              }}
            >
              <NumberBadge palette={p} label={pad2(i)} size={36} />
              <span style={{ fontSize: 16, lineHeight: 1.5, color: p.text, ...clampStyle(2), minWidth: 0 }}>
                {it}
              </span>
            </div>
          ))}
        </div>
      </div>
    </Canvas>
  )
}

export const contentsCards: LayoutEntry = {
  meta: {
    id: 'contents-cards',
    desc: '目錄·卡片格（最多 6 項）',
    pageType: 'contents',
    slots: makeSlotTable({ text: { item: 6, itemNumber: 6 }, image: {} }),
  },
  Component: ContentsCards,
}

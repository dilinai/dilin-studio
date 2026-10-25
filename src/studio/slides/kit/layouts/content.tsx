/**
 * slide-kit · 内容版式 ×5（覆盖 1~4 条目）
 * adapted from presenton (Apache-2.0)：
 *   content-split ← general/split_content_layout_7585 · modern/split_media_copy_7780
 *   content-cards ← swift/wide_infographic_row_2844 · modern/titled_card_row_5986
 *   content-grid  ← standard/header_with_index_grid_3810 · two_column_metrics_7973
 *   content-list  ← general/two_column_numbered_layout_3754（🔴去其标题强调线）
 *   content-focus ← general/centered_metrics_layout_9752（改单条聚焦式）
 * 改造：坐标系 1000×562.5、契约槽位、中文排版、去强调线。
 */

import * as React from 'react'
import type { LayoutEntry, LayoutProps } from '../types'
import { imageSlotKey, makeSlotTable, resolveSlotImage } from '../types'
import { resolvePalette } from '../themes'
import { Canvas, Dot, Figure, NumberBadge, bodyStyle, clampStyle, headingStyle, optText, pad2, textOr } from './shared'

type ContentItem = { heading?: string; body: string }

/** 唯一取值点：脏 deck_data 防御——heading/body/title 非字符串
 *  在这里统一挡掉（heading→undefined 走无小标分支·body/title→''），五个内容版式同得。 */
function contentDraft(props: LayoutProps, cap: number): { title: string; items: ContentItem[] } {
  if (props.draft.type !== 'content') return { title: '', items: [] }
  const rawItems = Array.isArray(props.draft.items) ? props.draft.items : []
  return {
    title: textOr(props.draft.title),
    items: rawItems.slice(0, cap).map((it) => {
      const heading = optText((it as { heading?: unknown } | null)?.heading)
      const body = textOr((it as { body?: unknown } | null)?.body)
      return heading !== undefined ? { heading, body } : { body }
    }),
  }
}

/** 页标题行（Dot 母题 + 标题·全内容版式共用） */
function TitleRow(props: { theme: LayoutProps['theme']; p: ReturnType<typeof resolvePalette>; title: string }): React.JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
      <div style={{ paddingTop: 14 }}>
        <Dot palette={props.p} size={12} />
      </div>
      <h2 style={{ ...headingStyle(props.theme, props.p, 32), ...clampStyle(2), minWidth: 0 }}>
        {props.title}
      </h2>
    </div>
  )
}

/* ---------------- content-split：左文右图（容量 2） ---------------- */

function ContentSplit(props: LayoutProps): React.JSX.Element {
  const { theme, images } = props
  const { title, items } = contentDraft(props, 2)
  const fig = resolveSlotImage(images?.[imageSlotKey('pageFigure')])
  const p = resolvePalette(theme, 'content')
  return (
    <Canvas palette={p} theme={theme}>
      <div style={{ height: '100%', padding: '52px 64px', display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }}>
        <TitleRow theme={theme} p={p} title={title} />
        <div style={{ flex: 1, display: 'flex', gap: 52, marginTop: 32, minHeight: 0 }}>
          <div style={{ flex: '1 1 52%', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 30, minWidth: 0 }}>
            {items.map((it, i) => (
              <div key={i} style={{ minWidth: 0 }}>
                {it.heading ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                    <Dot palette={p} size={8} />
                    <span style={{ fontSize: 19, fontWeight: 700, color: p.text, ...clampStyle(1), minWidth: 0 }}>
                      {it.heading}
                    </span>
                  </div>
                ) : null}
                <p style={{ ...bodyStyle(p, 16), ...clampStyle(4) }}>{it.body}</p>
              </div>
            ))}
          </div>
          <Figure
            palette={p}
            url={fig.url}
            crop={fig.crop}
            radius={18}
            style={{ flex: '0 0 40%', alignSelf: 'stretch' }}
          />
        </div>
      </div>
    </Canvas>
  )
}

export const contentSplit: LayoutEntry = {
  meta: {
    id: 'content-split',
    desc: '左文右圖·兩段',
    pageType: 'content',
    slots: makeSlotTable({ text: { title: 1, item: 2, itemTitle: 2 }, image: { pageFigure: 1 } }),
  },
  Component: ContentSplit,
}

/* ---------------- content-cards：横排卡片（容量 4·2-4 条皆宜） ---------------- */

function ContentCards(props: LayoutProps): React.JSX.Element {
  const { theme } = props
  const { title, items } = contentDraft(props, 4)
  const p = resolvePalette(theme, 'content')
  return (
    <Canvas palette={p} theme={theme}>
      <div style={{ height: '100%', padding: '52px 64px', display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }}>
        <TitleRow theme={theme} p={p} title={title} />
        <div style={{ flex: 1, display: 'flex', gap: 22, marginTop: 34, alignItems: 'stretch', minHeight: 0 }}>
          {items.map((it, i) => (
            <div
              key={i}
              style={{
                flex: 1, background: p.surface, border: `1px solid ${p.border}`, borderRadius: 16,
                padding: '26px 24px', display: 'flex', flexDirection: 'column', minWidth: 0,
              }}
            >
              <NumberBadge palette={p} label={pad2(i)} size={40} />
              {it.heading ? (
                <div style={{ fontSize: 18, fontWeight: 700, color: p.text, marginTop: 18, ...clampStyle(2) }}>
                  {it.heading}
                </div>
              ) : null}
              <p style={{ ...bodyStyle(p, 14.5), ...clampStyle(6), marginTop: 12 }}>{it.body}</p>
            </div>
          ))}
        </div>
      </div>
    </Canvas>
  )
}

export const contentCards: LayoutEntry = {
  meta: {
    id: 'content-cards',
    desc: '橫排卡片·1–4 條',
    pageType: 'content',
    slots: makeSlotTable({ text: { title: 1, item: 4, itemTitle: 4, itemNumber: 4 }, image: {} }),
  },
  Component: ContentCards,
}

/* ---------------- content-grid：2×2 网格（容量 4·3-4 条） ---------------- */

function ContentGrid(props: LayoutProps): React.JSX.Element {
  const { theme } = props
  const { title, items } = contentDraft(props, 4)
  const p = resolvePalette(theme, 'content')
  return (
    <Canvas palette={p} theme={theme}>
      <div style={{ height: '100%', padding: '52px 64px', display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }}>
        <TitleRow theme={theme} p={p} title={title} />
        <div
          style={{
            flex: 1, marginTop: 30, display: 'grid', gridTemplateColumns: '1fr 1fr',
            gap: '22px 44px', alignContent: 'center', minHeight: 0,
          }}
        >
          {items.map((it, i) => (
            <div key={i} style={{ display: 'flex', gap: 16, minWidth: 0 }}>
              <NumberBadge palette={p} label={pad2(i)} size={36} />
              <div style={{ minWidth: 0 }}>
                {it.heading ? (
                  <div style={{ fontSize: 17, fontWeight: 700, color: p.text, ...clampStyle(1) }}>
                    {it.heading}
                  </div>
                ) : null}
                <p style={{ ...bodyStyle(p, 14.5), ...clampStyle(3), marginTop: 6 }}>{it.body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Canvas>
  )
}

export const contentGrid: LayoutEntry = {
  meta: {
    id: 'content-grid',
    desc: '田字格編號·1–4 條',
    pageType: 'content',
    slots: makeSlotTable({ text: { title: 1, item: 4, itemTitle: 4, itemNumber: 4 }, image: {} }),
  },
  Component: ContentGrid,
}

/* ---------------- content-list：左题右列（容量 4） ---------------- */

function ContentList(props: LayoutProps): React.JSX.Element {
  const { theme } = props
  const { title, items } = contentDraft(props, 4)
  const p = resolvePalette(theme, 'content')
  return (
    <Canvas palette={p} theme={theme}>
      <div style={{ display: 'flex', height: '100%', padding: '56px 64px', gap: 56, boxSizing: 'border-box' }}>
        <div style={{ flex: '0 0 30%', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <Dot palette={p} size={12} />
          <h2 style={{ ...headingStyle(theme, p, 30), ...clampStyle(6), marginTop: 18 }}>{title}</h2>
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', minWidth: 0 }}>
          {items.map((it, i) => (
            <div
              key={i}
              style={{
                display: 'flex', gap: 18, padding: '18px 0', minWidth: 0,
                borderTop: i === 0 ? 'none' : `1px solid ${p.border}`,
              }}
            >
              <NumberBadge palette={p} label={pad2(i)} size={38} />
              <div style={{ minWidth: 0 }}>
                {it.heading ? (
                  <div style={{ fontSize: 17, fontWeight: 700, color: p.text, ...clampStyle(1) }}>
                    {it.heading}
                  </div>
                ) : null}
                <p style={{ ...bodyStyle(p, 14.5), ...clampStyle(2), marginTop: 5 }}>{it.body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Canvas>
  )
}

export const contentList: LayoutEntry = {
  meta: {
    id: 'content-list',
    desc: '左標題右清單·1–4 條',
    pageType: 'content',
    slots: makeSlotTable({ text: { title: 1, item: 4, itemTitle: 4, itemNumber: 4 }, image: {} }),
  },
  Component: ContentList,
}

/* ---------------- content-focus：单条聚焦（容量 1·1 条特判版式） ---------------- */

function ContentFocus(props: LayoutProps): React.JSX.Element {
  const { theme, images } = props
  const { title, items } = contentDraft(props, 1)
  const it = items[0]
  const fig = resolveSlotImage(images?.[imageSlotKey('pageFigure')])
  const p = resolvePalette(theme, 'content')
  return (
    <Canvas palette={p} theme={theme}>
      <div style={{ display: 'flex', height: '100%', padding: '60px 64px', gap: 56, boxSizing: 'border-box' }}>
        <div style={{ flex: '1 1 56%', display: 'flex', flexDirection: 'column', justifyContent: 'center', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ paddingTop: 5 }}>
              <Dot palette={p} size={10} />
            </div>
            <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: 2, lineHeight: 1.5, color: p.accent, ...clampStyle(2), minWidth: 0 }}>
              {title}
            </span>
          </div>
          {it?.heading ? (
            <h2 style={{ ...headingStyle(theme, p, 34), ...clampStyle(3), marginTop: 24 }}>{it.heading}</h2>
          ) : null}
          {it ? (
            <p style={{ ...bodyStyle(p, 17), ...clampStyle(6), marginTop: 20 }}>{it.body}</p>
          ) : null}
        </div>
        <Figure
          palette={p}
          url={fig.url}
          crop={fig.crop}
          radius={18}
          style={{ flex: '0 0 36%', alignSelf: 'stretch', margin: '8px 0' }}
        />
      </div>
    </Canvas>
  )
}

export const contentFocus: LayoutEntry = {
  meta: {
    id: 'content-focus',
    desc: '一段重點＋右側大圖',
    pageType: 'content',
    slots: makeSlotTable({ text: { title: 1, item: 1, itemTitle: 1 }, image: { pageFigure: 1 } }),
  },
  Component: ContentFocus,
}

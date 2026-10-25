/**
 * slide-kit · 新增的 6 个内容版式
 *   content-waist        拦腰·总分         relation total
 *   content-waist-duo    拦腰·两段并列     relation parallel
 *   content-fan          扇形·总分         relation total
 *   content-beam         倒三角＋底圆·三项并列 relation parallel
 *   content-split-steps  分割·递进         relation progressive
 *   content-split-duo    分割·两段         relation parallel
 *
 * 写法：几何只写一份——组件蓝图（components/blueprints-waist-fan.ts·绝对坐标＋theme:* 记号）；
 * 这里的 React 版式就是「蓝图 ⇒ 组件渲染器」·旧路（SlideView／html_content）与组件化编辑器同一个画面、零漂移
 * （旧 14 版式是先有 flex 版式、蓝图后补·要逐版式比对；新版式没有历史包袱·不另写一套 flex）。
 * meta 带 relation＋group:'v2' ⇒ 自动挑版式与分页不选它；只有 draft.relation 指定了关系时才列入候选。
 */

import * as React from 'react'
import type { LayoutEntry, LayoutMeta, LayoutProps } from '../types'
import { makeSlotTable } from '../types'
import { ComponentSlideView } from '../components/render'
import { WAIST_FAN_BLUEPRINTS } from '../components/blueprints-waist-fan'

/** 蓝图 ⇒ React（页键固定 'v'·只给旧路渲染用·不落库） */
function viewOf(id: string): React.FC<LayoutProps> {
  const bp = WAIST_FAN_BLUEPRINTS[id]
  function V2Layout(props: LayoutProps): React.JSX.Element {
    const components = bp({ pageKey: 'v', draft: props.draft, images: props.images, locale: props.locale })
    return <ComponentSlideView components={components} theme={props.theme} pageType="content" mode="deck" />
  }
  V2Layout.displayName = `V2Layout(${id})`
  return V2Layout
}

function entry(meta: LayoutMeta): LayoutEntry {
  return { meta, Component: viewOf(meta.id) }
}

export const contentWaist: LayoutEntry = entry({
  id: 'content-waist',
  pageType: 'content',
  // content＝总述（lead·选填）
  slots: makeSlotTable({ text: { title: 1, content: 1, item: 4, itemTitle: 4, itemNumber: 4 }, image: { pageFigure: 1 } }),
  relation: 'total',
  group: 'v2',
})

export const contentWaistDuo: LayoutEntry = entry({
  id: 'content-waist-duo',
  pageType: 'content',
  slots: makeSlotTable({ text: { title: 1, item: 2, itemTitle: 2 }, image: { pageFigure: 1 } }),
  relation: 'parallel',
  group: 'v2',
})

export const contentFan: LayoutEntry = entry({
  id: 'content-fan',
  pageType: 'content',
  slots: makeSlotTable({ text: { title: 1, content: 1, item: 4, itemTitle: 4 }, image: {} }),
  relation: 'total',
  group: 'v2',
})

export const contentBeam: LayoutEntry = entry({
  id: 'content-beam',
  pageType: 'content',
  slots: makeSlotTable({ text: { title: 1, item: 3, itemTitle: 3 }, image: { itemFigure: 1 } }),
  relation: 'parallel',
  group: 'v2',
})

export const contentSplitSteps: LayoutEntry = entry({
  id: 'content-split-steps',
  pageType: 'content',
  slots: makeSlotTable({ text: { title: 1, item: 3, itemTitle: 3, itemNumber: 3 }, image: {} }),
  relation: 'progressive',
  group: 'v2',
})

export const contentSplitDuo: LayoutEntry = entry({
  id: 'content-split-duo',
  pageType: 'content',
  slots: makeSlotTable({ text: { title: 1, item: 2, itemTitle: 2 }, image: { pageFigure: 1 } }),
  relation: 'parallel',
  group: 'v2',
})

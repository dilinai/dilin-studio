// 编辑器左右栏收合钮（文件／表格／网站／简报／画板共用）。收合钮做在左右栏自己身上，工具栏里不放。
//
// 两态、两只：
//   PanelCollapseButton（展开态）＝左栏页签条最右边的正方形小块（箭头朝左＝收起左栏）／
//                                右栏顶部角色名左边那格（箭头朝右＝收起右栏）
//   PanelCollapsedEdge（收起态）＝栏收起后页面最左／最右边缘留的窄条·顶上一颗小钮（左边缘箭头朝右／右边缘箭头朝左＝展开）
// 拖宽把手（editorShell.resizeHandle）与本组件不同位：拖宽在栏与栏之间整条分隔条上·收合钮在栏自己的顶部一行。

import { editorShell } from '../theme/editor-shell-theme'

export type PanelSide = 'left' | 'right'

function Chevron({ dir }: { dir: PanelSide }) {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} aria-hidden>
      {dir === 'left'
        ? <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        : <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />}
    </svg>
  )
}

/** 展开态的收合钮：left＝左栏页签条末端（箭头朝左）·right＝右栏页头角色名左边（箭头朝右） */
export function PanelCollapseButton({ side, onCollapse, title, testId }: {
  side: PanelSide
  onCollapse: () => void
  title: string
  testId?: string
}) {
  return (
    <button type="button" onClick={onCollapse} title={title} aria-label={title}
      data-testid={testId ?? `panel-collapse-${side}`} data-panel-side={side}
      className={editorShell.collapseBtn}>
      <Chevron dir={side} />
    </button>
  )
}

/** 收起态的边缘窄条：left＝页面最左边缘（箭头朝右）·right＝页面最右边缘（箭头朝左） */
export function PanelCollapsedEdge({ side, onExpand, title, testId, className = '' }: {
  side: PanelSide
  onExpand: () => void
  title: string
  testId?: string
  className?: string
}) {
  return (
    <div data-testid={testId ?? `panel-collapsed-${side}`} data-panel-side={side}
      className={`${editorShell.collapsedEdge} ${side === 'left' ? editorShell.colBorderR : editorShell.colBorderL} ${className}`}
      style={editorShell.beigeSurface}>
      <button type="button" onClick={onExpand} title={title} aria-label={title}
        data-testid={`panel-expand-${side}`}
        className={editorShell.collapseBtn}>
        <Chevron dir={side === 'left' ? 'right' : 'left'} />
      </button>
    </div>
  )
}

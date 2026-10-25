'use client'

/**
 * 简报组件画布（组件化编辑结构第一期）
 *
 * 画布上只准动框：点组件＝只出框（8 个缩放把手＋1 个旋转把手）；拖＝移动（吸附＋参考线）；把手＝缩放（Shift 锁比例）／
 * 旋转（Shift 每 15°）；右键＝上移一層／下移一層／移到最上層／移到最下層｜基礎動畫…
 *   ⛔ 在画布上改字、改图：双击＝跳到下方清单那一行；Delete 键什么都不做（只能在清单里删）；
 *   放开滑鼠才送一笔（画面先乐观跟手）；locked 的组件只能选、不能拖；
 *   html 组件（旧整页／手动排版层）一律渲在 sandbox iframe 里（render.tsx HtmlView 的 editor 模式·⛔ 进主页面 DOM）；
 *   云盘拖进画布＝在落点新增一个组件——放下的动作交给宿主（它知道怎么把云盘档换成网址）。
 * 交互：
 *   方向键 1（Shift 10）：挂在 window（keys.ts·焦点在清单／属性栏的按钮上也响；在输入框、富文字框里不接）；
 *   Ctrl+A＝全选本页（隐藏的、锁住的不算）；
 *   拉框：空白处（或锁住的底图上）按住拖＝拉框，相交即选；点两下、第二下按住拖（触控板「双击拉框」）＝在哪里都拉框；Ctrl／Shift 拉＝加选；
 *   Ctrl+点＝加选／减选；Alt+拖＝拖出一份复制（原件不动）；Shift+拉把手＝等比；
 *   多选：只准移动、缩放（整组一律等比·四角把手）、旋转（整组绕中心）、排层级（整组）；双击不跳清单、右键没有「基礎動畫」。
 * 画布内容与服务端出 html_content 是同一个渲染器（ComponentSlideView），只是模式不同。
 * 选取／拖动／把手／拉框／吸附／右键叠层／方向键整套搬进通用框层
 *   框层元件 FrameLayer（云文档、云表格共用）；这里只剩简报专属的：整层渲染（renderStage）、
 *   空心形状只点边线、双击跳清单、Alt+拖复制、云盘拖入、右键「基礎動畫」、简报字面（slc_*）与 data-testid 前缀 slc（行为与样式不变）。
 */

import { useCallback, useMemo } from 'react'
import { ComponentSlideView } from '../kit/components/render'
import type { Frame, PageBackground, SlideAnimation, SlideComponent, ZMove } from '../kit/components/types'
import type { PageType, Theme } from '../kit/types'
import { CANVAS_HEIGHT, CANVAS_WIDTH } from '../kit/types'
import { useStudioT as useT } from '../../shared/StudioT'
import { useSlidesHost, type ExternalDragItem } from './host'
import FrameLayer, { FRAME_LAYER_DUP_PREFIX, type FrameChange, type LiveFrames } from '../../shared/components/FrameLayer'
import { isDeckShortcutTarget } from './keys'
import { withGroupFrame } from '../deck-components'

export type CanvasDrop =
  | { kind: 'drive'; item: ExternalDragItem }
  | { kind: 'files'; files: File[] }

export type { FrameChange }

export type ComponentCanvasProps = {
  components: readonly SlideComponent[]
  animations?: readonly SlideAnimation[]
  background?: PageBackground
  theme: Theme
  pageType: PageType
  /** 画布显示宽（px）·高按 16:9 */
  width: number
  /** 选中的（一个＝单选；多个＝多选·多选里没有锁住的） */
  selectedIds: readonly string[]
  onSelect: (ids: string[]) => void
  /** 放开滑鼠／方向键停手：每个动到的组件只送改了的栏（一次手势＝一批） */
  onFrames: (changes: FrameChange[]) => void
  /** 叠层（单个或整组） */
  onZ: (ids: string[], z: ZMove) => void
  onAnimate: (id: string) => void
  /** 双击：跳到清单那一行（⛔ 在画布上改字） */
  onJump: (id: string) => void
  /** Alt+拖放开：这几个组件在新位置各新增一份（原件不动） */
  onDuplicate: (moved: Map<string, Frame>) => void
  onDrop?: (drop: CanvasDrop, at: { x: number; y: number }) => void
  mediaUrl?: (src: string) => string
  placeholderFor?: (c: SlideComponent) => string | undefined
  /** 右键「組合」（多选）／「取消組合」（单个组合） */
  onGroup?: (ids: string[]) => void
  onUngroup?: (id: string) => void
  /** 右键「換版式…」（整页·开版式缩图对话框） */
  onRelayout?: () => void
}

export default function ComponentCanvas(props: ComponentCanvasProps) {
  const t = useT()
  const { externalDrag } = useSlidesHost()
  const { components, width } = props
  const scale = width / CANVAS_WIDTH

  // 画布内容：跟手的换成跟手框；复制拖动时原件不动、另外叠上半透明的影子（与 html_content 同一个渲染器·editor 模式）
  const renderStage = useCallback((live: LiveFrames | null) => {
    // 组合跟手缩放：子件局部框当场照比例换算（与写操作同一个 withGroupFrame）
    const at = (c: SlideComponent, f: Frame): SlideComponent => (c.type === 'group' ? withGroupFrame(c, f) : ({ ...c, frame: f } as SlideComponent))
    const moved = live && !live.dup ? components.map((c) => (live.frames.has(c.id) ? at(c, live.frames.get(c.id)!) : c)) : components
    const shown = live && live.dup
      ? [...moved, ...components.filter((c) => live.frames.has(c.id)).map((c) => ({ ...at(c, live.frames.get(c.id)!), id: `${FRAME_LAYER_DUP_PREFIX}${c.id}`, opacity: (c.opacity ?? 1) * 0.6, locked: false } as SlideComponent))]
      : moved
    return (
      <ComponentSlideView components={shown} background={props.background} theme={props.theme} pageType={props.pageType}
        mode="editor" runPrograms width={width} mediaUrl={props.mediaUrl} placeholderFor={props.placeholderFor} />
    )
  }, [components, props.background, props.theme, props.pageType, width, props.mediaUrl, props.placeholderFor])

  const menuLabels = useMemo(() => ({ up: t('slc_z_up'), down: t('slc_z_down'), top: t('slc_z_top'), bottom: t('slc_z_bottom') }), [t])

  return (
    <FrameLayer<SlideComponent>
      testIdPrefix="slc"
      items={components}
      pageWidth={CANVAS_WIDTH}
      pageHeight={CANVAS_HEIGHT}
      scale={scale}
      renderStage={renderStage}
      selectedIds={props.selectedIds}
      onSelect={props.onSelect}
      onFrames={props.onFrames}
      onZMove={props.onZ}
      menuLabels={menuLabels}
      rotateHint={t('slc_rotate_hint')}
      // 右键：多选时只有叠层；单个多一项「基礎動畫」
      extraMenuItems={(ids) => {
        const items: Array<{ key: string; label: string; onSelect: () => void }> = []
        if (ids.length === 1) items.push({ key: 'anim', label: t('slc_menu_anim'), onSelect: () => props.onAnimate(ids[0]) })
        if (ids.length >= 2 && props.onGroup) items.push({ key: 'group', label: `${t('slc_group')}（Ctrl+G）`, onSelect: () => props.onGroup!(ids) })
        if (ids.length === 1 && props.onUngroup && components.find((c) => c.id === ids[0])?.type === 'group') items.push({ key: 'ungroup', label: `${t('slc_ungroup')}（Ctrl+Shift+G）`, onSelect: () => props.onUngroup!(ids[0]) })
        if (props.onRelayout) items.push({ key: 'relayout', label: t('slc_page_relayout'), onSelect: () => props.onRelayout!() })
        return items
      }}
      onItemDoubleClick={props.onJump}
      onDuplicate={props.onDuplicate}
      // 空心形状（没底色、没字：装饰框线之类）只有边线那一圈点得到——中间透过去点底下的组件（同 PowerPoint）
      hitMode={(c) => (c.type === 'shape' && c.shape !== 'line' && !c.fill && !c.fillMode && !c.text ? 'edge' : 'box')}
      isShortcutTarget={(target) => isDeckShortcutTarget(target)}
      drop={props.onDrop ? {
        canDrop: (dt) => !!externalDrag?.has(dt) || Array.from(dt?.types ?? []).includes('Files'),
        onDrop: (dt, at) => {
          const item = externalDrag?.read(dt) ?? null
          if (item) { props.onDrop!({ kind: 'drive', item }, at); return }
          const files = Array.from(dt.files ?? [])
          if (files.length) props.onDrop!({ kind: 'files', files }, at)
        },
        hint: t('slc_drop_hint'),
      } : undefined}
    />
  )
}

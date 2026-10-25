"use client";

// 网址四形态 · 编辑器 NodeView——hover 冒四形态工具条·
// 选定即 updateAttributes 持久。
// 只读态（editor.isEditable=false）不挂工具条。
import { useEffect, useRef, useState } from 'react';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import HoverFormatToolbar from '../media/HoverFormatToolbar';
import LinkCardDisplay from './LinkCardDisplay';
import { useDocsMedia } from '../media/env';
import { isSimplifiedSite } from '../../../shared/host';
import type { LinkDisplayMode } from '../../core/links';

const icon = (d: string) => (
  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
);

// 四形态选项
function modeOptions() {
  const cn = isSimplifiedSite();
  return [
    { key: 'url', label: cn ? '原网址' : '原網址', icon: icon('M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71') },
    { key: 'name', label: cn ? '名称' : '名稱', icon: icon('M4 7V5h16v2M9 20h6M12 5v15') },
    { key: 'card', label: cn ? '卡片' : '卡片', icon: icon('M3 8h18M3 5h18v14H3zM6 12h8') },
    { key: 'cardLarge', label: cn ? '大卡片' : '大卡片', icon: icon('M3 4h18v16H3zM3 13h18M6 17h8') },
  ];
}

export default function LinkCardView({ node, updateAttributes, editor, selected }: NodeViewProps) {
  const [hovered, setHovered] = useState(false);
  // editable 镜像进 state(terra 二审追加修的配套)——editor.isEditable 只在渲染时读:
  // setEditable(false) 本身不触发 NodeView 重渲→工具条滞留到下次无关重渲(探针实锤·比 280ms 宽限更糟)。
  // tiptap setEditable 会 emit 'update'(core Editor.setEditable emitUpdate=true 默认)→订阅同步·切只读即时卸载。
  const [editable, setEditableState] = useState(editor.isEditable);
  useEffect(() => {
    const sync = () => setEditableState(editor.isEditable);
    editor.on('update', sync);
    return () => { editor.off('update', sync); };
  }, [editor]);
  const media = useDocsMedia();
  const [loadingMeta, setLoadingMeta] = useState(false);
  const fetchingRef = useRef(false);
  const href = node.attrs.href as string;
  const displayMode = node.attrs.displayMode as LinkDisplayMode;
  const title = node.attrs.title as string | null;
  const description = node.attrs.description as string | null;
  const image = node.attrs.image as string | null;
  const favicon = node.attrs.favicon as string | null;

  const needsMeta =
    (displayMode === 'name' && !title) ||
    ((displayMode === 'card' || displayMode === 'cardLarge') && !description && !image && !favicon);

  useEffect(() => {
    if (!editor.isEditable || !needsMeta || fetchingRef.current || !href) return;
    fetchingRef.current = true;
    setLoadingMeta(true);
    let alive = true;
    media.ogPreview(href).then((meta) => {
      fetchingRef.current = false;
      setLoadingMeta(false);
      if (!alive) return;
      if (!meta.ok) return;
      // 三级链：已有 title（链接自带文字）不覆盖 → og title → 域名
      updateAttributes({
        title: title || meta.title || null,
        description: description || meta.description || null,
        image: image || meta.image || null,
        favicon: favicon || meta.favicon || null,
      });
    });
    // cleanup 同步复位 fetchingRef（不等旧 promise 落地）——effect 重跑（如切形态）立刻能为新形态补抓。
    return () => { alive = false; fetchingRef.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayMode, href, needsMeta, editor.isEditable]);

  const isCardMode = displayMode === 'card' || displayMode === 'cardLarge';
  return (
    <NodeViewWrapper
      as="span"
      className={`relative ${isCardMode ? 'block w-full' : 'inline'} ${selected ? 'rounded ring-2 ring-blue-300' : ''}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      data-drag-handle
    >
      {/* 只读态硬关（条件卸载·照视频侧 VideoNodeView 同款）——别把 isEditable 混进 visible：
          editable→只读切换若走 visible=false 会吃 280ms 宽限·残留期按钮仍可 updateAttributes=只读还能改（terra 二审 CONFIRMED）。
          宽限机制只服务「鼠标离开」这一种 visible=false。 */}
      {editable && (
        <HoverFormatToolbar
          options={modeOptions()}
          value={displayMode}
          onChange={(m) => updateAttributes({ displayMode: m })}
          visible={hovered}
          // bottom-full 紧贴目标顶边·视觉空隙由工具条内建 pb-1 桥承担
          className="absolute bottom-full left-0 z-40"
        />
      )}
      <LinkCardDisplay
        href={href}
        displayMode={displayMode}
        title={title}
        description={description}
        image={image}
        favicon={favicon}
        loading={loadingMeta}
      />
    </NodeViewWrapper>
  );
}

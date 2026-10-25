'use client';


import React, { useEffect, useState } from 'react';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { useStudioLang } from '../../../../shared/StudioT';
import { HoverFormatToolbar as HoverToolbar } from '../HoverFormatToolbar';
import { VideoViewByMode } from './views';
import type { VideoDisplayMode } from './video-node';

// 三视图小图标（工具条用·线稿风）
const TextViewIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4" aria-hidden>
    <path d="M4 7h16M4 12h10M4 17h13" />
  </svg>
);
const CardViewIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4" aria-hidden>
    <rect x="3" y="6" width="8" height="12" rx="1.5" />
    <path d="M14 8h7M14 12h7M14 16h5" />
  </svg>
);
const PreviewViewIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4" aria-hidden>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M10.5 9.5v5l4.5-2.5-4.5-2.5z" fill="currentColor" stroke="none" />
  </svg>
);

// 工具条文案：本地双语小表
const LABELS: Record<VideoDisplayMode, { tw: string; cn: string }> = {
  text:    { tw: '文字視圖', cn: '文本视图' },
  card:    { tw: '卡片視圖', cn: '卡片视图' },
  preview: { tw: '預覽視圖', cn: '预览视图' },
};

export function VideoNodeView(props: NodeViewProps) {
  const { node, updateAttributes, editor } = props;
  const language = useStudioLang();
  const isCn = language === 'zh-CN';
  const [hover, setHover] = useState(false);
  // editable 镜像进 state——渲染时裸读 editor.isEditable:
  // setEditable(false) 本身不触发 NodeView 重渲→已挂工具条滞留到下次无关重渲(只读残留期仍可 updateAttributes)。
  // tiptap setEditable 默认 emit 'update'→订阅同步·切只读即时卸载工具条。
  const [editable, setEditable] = useState(editor.isEditable);
  useEffect(() => {
    const sync = () => setEditable(editor.isEditable);
    editor.on('update', sync);
    return () => { editor.off('update', sync); };
  }, [editor]);

  const mode = (node.attrs.displayMode as VideoDisplayMode) || 'card';
  const options = (['text', 'card', 'preview'] as VideoDisplayMode[]).map(k => ({
    key: k,
    label: isCn ? LABELS[k].cn : LABELS[k].tw,
    icon: k === 'text' ? TextViewIcon : k === 'card' ? CardViewIcon : PreviewViewIcon,
  }));

  return (
    <NodeViewWrapper
      className="video-card-block relative"
      style={{ display: 'block' }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      data-display-mode={mode}
    >
      {editable && (
        // bottom-full 紧贴目标顶边·视觉空隙由工具条内建 pb-1 桥承担
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 z-20">
          <HoverToolbar
            options={options}
            value={mode}
            onChange={key => updateAttributes({ displayMode: key as VideoDisplayMode })}
            visible={hover}
          />
        </div>
      )}
      <VideoViewByMode
        displayMode={mode}
        src={node.attrs.src as string}
        name={(node.attrs.name as string) || ''}
        size={(node.attrs.size as number | null) ?? null}
        thumbnail={(node.attrs.thumbnail as string | null) ?? null}
        ratio={(node.attrs.ratio as number) || 16 / 9}
        readOnly={!editable}
        onThumbnail={editable ? (url => updateAttributes({ thumbnail: url })) : undefined}
      />
    </NodeViewWrapper>
  );
}

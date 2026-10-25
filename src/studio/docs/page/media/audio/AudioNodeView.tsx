'use client';


import React, { useEffect, useState } from 'react';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { useStudioLang } from '../../../../shared/StudioT';
import { HoverFormatToolbar as HoverToolbar } from '../HoverFormatToolbar';
import { AudioViewByMode } from './views';
import type { AudioDisplayMode } from './audio-node';

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
    <rect x="3" y="9" width="18" height="6" rx="3" />
    <circle cx="8" cy="12" r="1.4" fill="currentColor" stroke="none" />
  </svg>
);

// 工具条文案：本地双语小表
const LABELS: Record<AudioDisplayMode, { tw: string; cn: string }> = {
  text:    { tw: '文字視圖', cn: '文本视图' },
  card:    { tw: '卡片視圖', cn: '卡片视图' },
  preview: { tw: '預覽視圖', cn: '预览视图' },
};

export function AudioNodeView(props: NodeViewProps) {
  const { node, updateAttributes, editor } = props;
  const language = useStudioLang();
  const isCn = language === 'zh-CN';
  const [hover, setHover] = useState(false);
  // editable 镜像进 state（同 VideoNodeView 修法·setEditable(false) 不触发 NodeView 重渲）：
  const [editable, setEditable] = useState(editor.isEditable);
  useEffect(() => {
    const sync = () => setEditable(editor.isEditable);
    editor.on('update', sync);
    return () => { editor.off('update', sync); };
  }, [editor]);

  const mode = (node.attrs.displayMode as AudioDisplayMode) || 'card';
  const options = (['text', 'card', 'preview'] as AudioDisplayMode[]).map(k => ({
    key: k,
    label: isCn ? LABELS[k].cn : LABELS[k].tw,
    icon: k === 'text' ? TextViewIcon : k === 'card' ? CardViewIcon : PreviewViewIcon,
  }));

  return (
    <NodeViewWrapper
      className="audio-card-block relative"
      style={{ display: 'block' }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      data-display-mode={mode}
    >
      {editable && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 z-20">
          <HoverToolbar
            options={options}
            value={mode}
            onChange={key => updateAttributes({ displayMode: key as AudioDisplayMode })}
            visible={hover}
          />
        </div>
      )}
      <AudioViewByMode
        displayMode={mode}
        src={node.attrs.src as string}
        name={(node.attrs.name as string) || ''}
        size={(node.attrs.size as number | null) ?? null}
        readOnly={!editable}
      />
    </NodeViewWrapper>
  );
}

// ── 音频三形态节点─────────────
// 对标视频三形态（video-node.ts）做同款 3 视图：文本视图 / 卡片视图 / 预览视图。
// 🔴 接合点契约：attrs 形状（序列化进存储文档）
//    { src: string; displayMode: "text"|"card"|"preview"; name: string; size: number|null }
//    size 单位 byte。音频无画面·不带 thumbnail/ratio/width（与视频契约的关键差异）。
// 节点名 'audioBlock'（存储 md 里是 `<audio src …>` 行）。
// 🔴 反铁项1：独立新建节点·绝不复用 videoBlock/VideoBlock 硬塞。
// 🔴 预览视图=原生 <audio controls> 横条。
// 🔴 默认形态=card。

import type { Node as TiptapNode } from '@tiptap/core';
import { AudioNodeView } from './AudioNodeView';
// 节点 schema（属性、parse／render 形状）与游客版文件编辑器共用：docs/core/media-nodes.ts·这里只接网站自己的 NodeView
import { makeAudioBlockNode, AUDIO_DISPLAY_MODES, type AudioDisplayMode } from '../../../core/media-nodes';

export type { AudioDisplayMode };
export { AUDIO_DISPLAY_MODES };

export const audioCardNode: TiptapNode = makeAudioBlockNode(AudioNodeView);


import type { Node as TiptapNode } from '@tiptap/core';
import { VideoNodeView } from './VideoNodeView';
// 节点 schema（属性、parse／render 形状）与游客版文件编辑器共用：docs/core/media-nodes.ts·这里只接网站自己的 NodeView
import { makeVideoBlockNode, VIDEO_DISPLAY_MODES, type VideoDisplayMode } from '../../../core/media-nodes';

export type { VideoDisplayMode };
export { VIDEO_DISPLAY_MODES };

export const videoCardNode: TiptapNode = makeVideoBlockNode(VideoNodeView);

// 网址四形态 · barrel
// ⚠️ server 侧（md-to-html.ts 等）别 import 本 barrel（会拖进 React 组件）·直接 import './link-md'。
export { LinkCardNode } from './link-node';
export { PlainTextHrefSerializer, appendHrefOnce } from './plain-text-href';
export { default as LinkCardDisplay } from './LinkCardDisplay';
export { default as LinkCardView } from './LinkCardView';
export {
  applyInlineLinkCards,
  applyInlineLinkExport,
  applyOutsideCode,
  splitLinkCardSegments,
  parseMdLinkMatch,
  buildMdLink,
  encodeMdHrefParens,
  linkElToMd,
  hostnameOf,
  MD_LINK_CARD_RE,
  type LinkDisplayMode,
  type LinkCardMeta,
  type LinkCardSegment,
} from '../../core/links';

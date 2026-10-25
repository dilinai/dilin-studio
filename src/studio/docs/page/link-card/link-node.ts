// 网址四形态 · linkCard TipTap 节点
//
// 🔴 接合点契约：
//   attrs = { href: string; displayMode: "url"|"name"|"card"|"cardLarge";
//             title: string|null; description: string|null; image: string|null; favicon: string|null }
//
// HTML 形状（三处共享一个 data-* 契约·经验#1238）：<a data-link-card="1" href data-display-mode
//   data-title data-description data-image data-favicon>名称/网址</a>
//   ① mdToTiptapHtml（applyInlineLinkCards）出这形状 ② 本节点 parseHTML 认/renderHTML 出回同形
//   ③ inlineToMd（linkElToMd）读 data-* 还原 markdown。存储永远纯 markdown·节点只是编辑器内表示。
// 🔴 每个 attr 都写显式 renderHTML 映射（不写=tiptap 按 attr 名出属性·getHTML 丢 data-*·经验#1244 真回归）。
import { Node as TiptapNode, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import LinkCardView from './LinkCardView';
import { hostnameOf } from '../../core/links';
import { appendHrefOnce } from './plain-text-href';

const strAttr = (dataName: string) => ({
  default: null as string | null,
  parseHTML: (el: HTMLElement) => el.getAttribute(dataName),
  renderHTML: (attrs: Record<string, string | null>) => {
    const key = dataName.replace(/^data-/, '').replace(/-(\w)/g, (_m, c: string) => c.toUpperCase());
    const v = attrs[key];
    return v ? { [dataName]: v } : {};
  },
});

export const LinkCardNode = TiptapNode.create({
  name: 'linkCard',
  inline: true,
  group: 'inline',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      href: {
        default: '',
        parseHTML: (el: HTMLElement) => {
          const raw = el.getAttribute('href') || '';
          return /^https?:\/\//i.test(raw) ? raw : '';
        },
        renderHTML: (attrs: Record<string, string | null>) => ({ href: attrs.href || '' }),
      },
      displayMode: {
        default: 'url',
        // 兜底轮 guard：外部富文本可伪造 data-display-mode="foo"·
        // 不设白名单会把 foo 收进 attrs → buildMdLink 写出 {mode=foo} → 读侧 MD_LINK_CARD_RE 只认
        // 四值不匹配 → 文档永久残留字面 {mode=foo} 垃圾。四值白名单与 LinkDisplayMode/读侧正则同宽·非法落默认 url。
        parseHTML: (el: HTMLElement) => {
          const raw = el.getAttribute('data-display-mode');
          return raw === 'url' || raw === 'name' || raw === 'card' || raw === 'cardLarge' ? raw : 'url';
        },
        renderHTML: (attrs: Record<string, string | null>) => ({ 'data-display-mode': attrs.displayMode || 'url' }),
      },
      title: strAttr('data-title'),
      description: strAttr('data-description'),
      image: strAttr('data-image'),
      favicon: strAttr('data-favicon'),
    };
  },

  parseHTML() {
    // 只认带 data-link-card 的 <a>（priority 抬高在 Link mark 之前吃掉）·纯 <a href> 留给 Link mark（外部富文本粘贴）
    return [{ tag: 'a[data-link-card]', priority: 100 }];
  },

  renderHTML({ node, HTMLAttributes }) {
    // getHTML 出干净 data-* <a>（供 inlineToMd 反向）·真渲染走 addNodeView（两条路分开·经验#1239）
    return [
      'a',
      mergeAttributes({ 'data-link-card': '1', target: '_blank', rel: 'noopener noreferrer' }, HTMLAttributes),
      (node.attrs.title as string | null) || (node.attrs.href as string),
    ];
  },

  renderText({ node }) {
    const href = (node.attrs.href as string) || '';
    const visible = node.attrs.displayMode === 'url'
      ? href
      : ((node.attrs.title as string | null)?.trim() || hostnameOf(href));
    return appendHrefOnce(visible, href);
  },

  addNodeView() {
    return ReactNodeViewRenderer(LinkCardView);
  },
});

export default LinkCardNode;

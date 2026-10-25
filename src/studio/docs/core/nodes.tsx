'use client'
// Document editor extensions shared by the guest editor and the full editor page:
//   OrderedListExtended  ordered list with a `listType` (1. / 一、 / （一） / 1、 / (1))
//   IndentExtension      paragraph indent 0–8 (Tab / Shift-Tab), stored as `{indent:N}` at line start
//   TrailingParagraph    keeps an empty paragraph at the end so the caret can always get below a block
//   MermaidBlock         ```mermaid code blocks rendered as diagrams (mermaid is loaded on demand)

import { useEffect, useRef, useState } from 'react'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import type { NodeViewRendererProps } from '@tiptap/core'
import { Extension, Node as TiptapNode, mergeAttributes } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import OrderedList from '@tiptap/extension-ordered-list'

export const TrailingParagraph = Extension.create({
  name: 'trailingParagraph',
  addProseMirrorPlugins() {
    return [new Plugin({
      appendTransaction(_, __, state) {
        const { doc, tr, schema } = state;
        if (!schema.nodes.paragraph) return null;
        const last = doc.lastChild;
        if (last?.type === schema.nodes.paragraph) return null;
        return tr.insert(doc.content.size, schema.nodes.paragraph.create());
      },
    })];
  },
});

export const IndentExtension = Extension.create({
  name: 'indent',

  addGlobalAttributes() {
    return [{
      types: ['paragraph'],
      attributes: {
        indent: {
          default: 0,
          parseHTML: el => parseInt(el.getAttribute('data-indent') || '0') || 0,
          renderHTML: attrs => attrs.indent
            ? { 'data-indent': attrs.indent, style: `padding-left: ${(attrs.indent as number) * 2}em` }
            : {},
        },
      },
    }];
  },

  addKeyboardShortcuts() {
    const changeIndent = (delta: number): boolean => {
      const { editor } = this;
      if (editor.isActive('listItem')) {
        return delta > 0
          ? editor.commands.sinkListItem('listItem')
          : editor.commands.liftListItem('listItem');
      }
      if (editor.isActive('heading')) return true; // headings are not indented

      const { state } = editor;
      const { tr, selection } = state;
      const { from, to } = selection;
      let changed = false;
      state.doc.nodesBetween(from, to, (node, pos) => {
        if (node.type.name !== 'paragraph') return;
        const cur = (node.attrs.indent as number) || 0;
        const next = Math.max(0, Math.min(8, cur + delta));
        if (next !== cur) {
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: next });
          changed = true;
        }
      });
      if (changed) editor.view.dispatch(tr);
      return true;
    };
    return {
      Tab: () => changeIndent(1),
      'Shift-Tab': () => changeIndent(-1),
    };
  },
});

export const OrderedListExtended = OrderedList.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      listType: {
        default: 'decimal',
        parseHTML: el => el.getAttribute('data-list-type') ?? 'decimal',
        renderHTML: attrs => ({ 'data-list-type': attrs.listType }),
      },
    };
  },
});

// ── Mermaid ──
// The two status lines are supplied by the host through a hook (called inside the node view render),
// so each editor keeps its own string source: MermaidBlock.configure({ useLabels: () => ({ … }) }).
export interface MermaidLabels { syntaxError: string; rendering: string }
export interface MermaidBlockOptions { useLabels: () => MermaidLabels }

function MermaidNodeView({ node, extension }: NodeViewRendererProps) {
  const labels = (extension.options as MermaidBlockOptions).useLabels();
  const [svg, setSvg] = useState('');
  const [err, setErr] = useState('');
  const idRef = useRef('mm-' + Math.random().toString(36).slice(2, 9));

  useEffect(() => {
    const code = (node.attrs.content as string) || '';
    if (!code.trim()) return;
    let cancelled = false;
    import('mermaid').then(mod => {
      if (cancelled) return;
      const mermaid = mod.default;
      mermaid.initialize({ startOnLoad: false, theme: 'neutral', suppressErrorRendering: true });
      mermaid.render(idRef.current, code)
        .then(({ svg: s }) => { if (!cancelled) { setSvg(s); setErr(''); } })
        .catch((e: Error) => { if (!cancelled) { setErr(e.message || String(e)); setSvg(''); } });
    }).catch(() => { if (!cancelled) setErr('Failed to load Mermaid'); });
    return () => { cancelled = true; };
  }, [node.attrs.content]);

  return (
    <NodeViewWrapper as="div">
      <div contentEditable={false}
        style={{ background:'#F9FAFB', borderRadius:'6px', padding:'8px', margin:'6px 0', border:'1px solid #E5E7EB' }}>
        {svg
          ? <div dangerouslySetInnerHTML={{ __html: svg }} style={{ textAlign:'center' }} />
          : err
          ? <div>
              <div style={{ color:'#9CA3AF', fontSize:'10px', marginBottom:'4px' }}>📊 {labels.syntaxError}</div>
              <pre style={{ color:'#6B7280', fontSize:'10px', margin:0, whiteSpace:'pre-wrap', fontFamily:'monospace', background:'transparent' }}>{(node.attrs.content as string) || ''}</pre>
            </div>
          : <div style={{ color:'#9CA3AF', fontSize:'11px', padding:'4px' }}>{labels.rendering}</div>
        }
      </div>
    </NodeViewWrapper>
  );
}

export const MermaidBlock = TiptapNode.create<MermaidBlockOptions>({
  name: 'mermaidBlock',
  group: 'block',
  atom: true,

  addOptions() {
    return { useLabels: () => ({ syntaxError: 'Diagram syntax error', rendering: 'Rendering diagram…' }) };
  },

  addAttributes() {
    return { content: { default: '' } };
  },

  parseHTML() {
    return [{
      tag: 'div[data-type="mermaid-block"]',
      getAttrs: el => ({ content: (el as HTMLElement).getAttribute('data-content') || '' }),
    }];
  },

  renderHTML({ node }) {
    return ['div', mergeAttributes({ 'data-type': 'mermaid-block', 'data-content': node.attrs.content || '' })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MermaidNodeView);
  },
});

// LaTeX block node: stored in markdown as `$$ … $$`, edited as <div data-latex="…">, rendered with KaTeX.
// The `latex` attribute must render back to data-latex, otherwise getHTML loses the formula source.

import { Node, mergeAttributes } from '@tiptap/core'
import katex from 'katex'

export const LatexNode = Node.create({
  name: 'latexBlock',
  group: 'block',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      latex: {
        default: '',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-latex') || '',

        renderHTML: (attrs: Record<string, unknown>) => ({ 'data-latex': typeof attrs.latex === 'string' ? attrs.latex : '' }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-latex]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes)]
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('div')
      const latex = typeof node.attrs.latex === 'string' ? node.attrs.latex : ''
      dom.setAttribute('data-latex', latex)
      dom.className = 'doc-latex-block my-2 overflow-x-auto text-center'
      dom.contentEditable = 'false'
      try {
        dom.innerHTML = katex.renderToString(latex, { displayMode: true, throwOnError: false })
      } catch {
        dom.textContent = `$$${latex}$$`
      }

      return { dom, ignoreMutation: () => true }
    }
  },
})

// Page break node: a dashed line with a label on screen, a page break when printing; stored as <!--pagebreak-->.
// The on-screen label text comes from the CSS variable --doc-pb-label set by the host editor.

import { Node, mergeAttributes } from '@tiptap/core'
import { PAGE_BREAK_ATTR, PAGE_BREAK_NODE_NAME } from './page-break'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    pageBreak: { setPageBreak: () => ReturnType }
  }
}

export const PageBreakNode = Node.create({
  name: PAGE_BREAK_NODE_NAME,
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,
  parseHTML() {
    return [{ tag: `div[${PAGE_BREAK_ATTR}]` }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { [PAGE_BREAK_ATTR]: 'true', class: 'doc-page-break', contenteditable: 'false' })]
  },
  addCommands() {
    return {

      setPageBreak: () => ({ chain }) =>
        chain().insertContent({ type: PAGE_BREAK_NODE_NAME }).command(({ tr, state }) => {
          if (tr.doc.lastChild?.type.name === PAGE_BREAK_NODE_NAME) tr.insert(tr.doc.content.size, state.schema.nodes.paragraph.create())
          return true
        }).run(),
    }
  },
})
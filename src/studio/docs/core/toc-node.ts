// Table of contents block ([[toc]] in markdown, <div data-toc="true"> in the editor). The node view lists
// the document's headings live (re-rendered on every editor update). Heading/empty labels come from the
// host: TocNode.configure({ labels: () => ({ title, empty }) }) — called on every render, so it can follow
// a language switch.
import { Node, mergeAttributes } from '@tiptap/core'
import { attrEscape } from './directive'

export interface TocNodeOptions { labels: () => { title: string; empty: string } }

export const TocNode = Node.create<TocNodeOptions>({
  name: 'tocBlock',
  group: 'block',
  atom: true,
  selectable: true,

  addOptions() {
    return { labels: () => ({ title: 'Contents', empty: 'Headings you add will appear here' }) }
  },

  parseHTML() {
    return [{ tag: 'div[data-toc]' }]
  },

  renderHTML() {
    return ['div', mergeAttributes({ 'data-toc': 'true' })]
  },

  addNodeView() {
    const labels = this.options.labels
    return ({ editor }) => {
      const dom = document.createElement('div')
      dom.setAttribute('data-toc', 'true')
      dom.contentEditable = 'false'
      dom.className = 'md-toc my-3 p-3 rounded-lg bg-gray-50 border border-gray-200'

      const render = () => {
        const { title, empty } = labels()
        const items: { level: number; text: string }[] = []
        editor.state.doc.descendants((n) => {
          if (n.type.name === 'heading') {
            items.push({ level: Number(n.attrs.level) || 1, text: n.textContent })
          }
        })
        const head = `<div class="text-xs text-gray-500 mb-1.5 font-semibold">${attrEscape(title)}</div>`
        if (items.length === 0) {
          dom.innerHTML = head + `<div class="text-sm text-gray-400">${attrEscape(empty)}</div>`
          return
        }
        const lis = items
          .map((h) => `<li class="md-toc-item" style="margin-left:${(h.level - 1) * 16}px"><span class="text-blue-600">${attrEscape(h.text)}</span></li>`)
          .join('')
        dom.innerHTML = head + `<ul class="list-none pl-0 space-y-0.5 text-sm">${lis}</ul>`
      }

      render()
      const onUpdate = () => render()
      editor.on('update', onUpdate)

      return {
        dom,
        ignoreMutation: () => true,
        destroy() { editor.off('update', onUpdate) },
      }
    }
  },
})

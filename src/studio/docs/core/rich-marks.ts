// Inline rich-text marks: text color / highlight / outline / font. Stored as :color / :bg / :box / :font directives;
// in the editor they are <span data-color|data-bg|data-box|data-font>. Unsafe values render no style.

import { Mark, mergeAttributes } from '@tiptap/core'
import { isRichValueSafe, richStyle, type RichType } from './directive'

function makeRichMark(name: string, type: RichType, dataAttr: string, attrName: 'color' | 'font' = 'color') {
  return Mark.create({
    name,
    addAttributes() {
      return {
        [attrName]: {
          default: null as string | null,
          parseHTML: (el: HTMLElement) => el.getAttribute(dataAttr),
          renderHTML: (attrs: Record<string, unknown>) => {
            const v = typeof attrs[attrName] === 'string' ? (attrs[attrName] as string) : ''
            if (!v || !isRichValueSafe(type, v)) return {}
            return { [dataAttr]: v, style: richStyle(type, v) }
          },
        },
      }
    },
    parseHTML() {
      return [{ tag: `span[${dataAttr}]` }]
    },
    renderHTML({ HTMLAttributes }) {
      return ['span', mergeAttributes(HTMLAttributes), 0]
    },
  })
}

export const ColorMark = makeRichMark('colorMark', 'color', 'data-color')

export const BgMark = makeRichMark('bgMark', 'bg', 'data-bg')

export const BoxMark = makeRichMark('boxMark', 'box', 'data-box')

export const FontMark = makeRichMark('fontMark', 'font', 'data-font', 'font')
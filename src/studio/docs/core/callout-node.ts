// Callout block (:::tone … :::) — <aside data-callout=tone> containing editable blocks; unknown tones become note.

import { Node, mergeAttributes } from '@tiptap/core'
import { SAFE_CALLOUT_NAMES, calloutClassName } from './directive'

const normTone = (t: unknown): string => (typeof t === 'string' && SAFE_CALLOUT_NAMES.has(t) ? t : 'note')

export const CalloutNode = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      tone: {
        default: 'note',
        parseHTML: (el: HTMLElement) => normTone(el.getAttribute('data-callout')),
        renderHTML: (attrs: Record<string, unknown>) => ({ 'data-callout': normTone(attrs.tone) }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'aside[data-callout]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    const tone = normTone(node.attrs.tone)
    return ['aside', mergeAttributes(HTMLAttributes, { class: calloutClassName(tone) }), 0]
  },
})
// Loads the web fonts used by fontMark spans in the document (each id once), on create and after every update.

import { Extension } from '@tiptap/core'
import { ensureFontLoaded } from '../../shared/fonts/load'

function loadFontsInDoc(doc: { descendants: (fn: (node: { isText: boolean; marks: readonly { type: { name: string }; attrs: Record<string, unknown> }[] }) => void) => void }) {
  const seen = new Set<string>()
  doc.descendants(node => {
    if (!node.isText) return
    for (const m of node.marks) {
      if (m.type.name !== 'fontMark') continue
      const id = m.attrs.font
      if (typeof id === 'string' && !seen.has(id)) { seen.add(id); ensureFontLoaded(id) }
    }
  })
}

export const FontLoader = Extension.create({
  name: 'fontLoader',
  onCreate() { loadFontsInDoc(this.editor.state.doc) },
  onUpdate() { loadFontsInDoc(this.editor.state.doc) },
})
# Third-party code used by Dilin Studio · Docs

All are npm packages loaded at build time (nothing is fetched from other servers at run time).

| package | version | license | source | used for |
|---|---|---|---|---|
| @tiptap/react, @tiptap/core, @tiptap/pm, @tiptap/starter-kit | 2.27.2 | MIT | https://github.com/ueberdosis/tiptap | rich-text editor (ProseMirror based) |
| @tiptap/extension-table, -table-row, -table-header, -table-cell | 2.27.2 | MIT | https://github.com/ueberdosis/tiptap | tables |
| @tiptap/extension-image, -link, -placeholder, -ordered-list | 2.27.2 | MIT | https://github.com/ueberdosis/tiptap | images, links, placeholder text, numbered lists |
| ProseMirror (bundled in @tiptap/pm) | — | MIT | https://github.com/ProseMirror/prosemirror | editor engine |
| katex (incl. its CSS and fonts) | 0.16.47 | MIT | https://github.com/KaTeX/KaTeX | `$$ … $$` formulas |
| mermaid | 11.15.0 | MIT | https://github.com/mermaid-js/mermaid | ```` ```mermaid ```` diagrams (loaded on demand) |
| docx | 9.7.1 | MIT | https://github.com/dolanmiu/docx | Word (.docx) export in the browser |
| react | (host) | MIT | https://github.com/facebook/react | UI |

No icons, sample images or effects are bundled by this editor. Web fonts picked with the font mark come from the shared font catalog (see ../shared/THIRD_PARTY.md).

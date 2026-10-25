# Dilin Studio · Docs — project format

A docs project is a folder:

```
my-document/
  project.json      the document
  assets/           images, video and audio used by the document (original files)
```

Edit `project.json`, save it, and an open editor page reloads within a second or two.

## project.json

```json
{
  "format": "dilin-studio/docs",
  "version": 2,
  "name": "Trip notes",
  "paper": { "paper": "a4-portrait", "marginsMm": { "top": 25.4, "bottom": 25.4, "left": 31.7, "right": 31.7 }, "pageNumbers": false },
  "content": [
    "# Trip notes",
    "",
    "Day one: **arrived**, see :color[the plan]{color=#d83931}.",
    "",
    "![harbour](assets/harbour.jpg)"
  ]
}
```

| field | meaning |
|---|---|
| `format` | always `"dilin-studio/docs"` |
| `version` | `2` (version `1` files, which have no `layers`, open as they are) |
| `name` | document title |
| `paper` | `paper`: `a4` / `b5` / `a3` + `-portrait` / `-landscape`, or `null` for one continuous page; `marginsMm`: page margins in mm (0–100); `pageNumbers`: true/false. Optional. |
| `content` | the body as markdown, **one array item per line**. A single string is also accepted. |
| `layers` | free-floating items placed on pages (see below). Optional; left out when there are none. |

## Free-floating items (`layers`)

Text boxes, images, video and audio placed anywhere on a page, above or below the body text.
Positions are in millimetres from the top-left corner of the sheet (margins included); with `paper: null` the page size is taken as A4 portrait.

```json
"layers": {
  "v": 1,
  "unit": "mm",
  "items": [
    { "id": "box1", "kind": "text", "page": 1, "x": 120, "y": 30, "w": 60, "h": 25, "rotate": 0, "plane": "above",
      "text": { "md": "**Note**", "fontSizePt": 12, "color": "#333333", "fill": "#FFF7D6", "align": "center", "valign": "middle" } },
    { "id": "pic1", "kind": "image", "page": 1, "x": 20, "y": 200, "w": 80, "h": 50, "rotate": 5, "plane": "below", "src": "assets/harbour.jpg" }
  ]
}
```

| field | meaning |
|---|---|
| `id` | unique in the document: letters, digits, `_ . : ~ -`, up to 64 characters |
| `kind` | `text` / `image` / `video` / `audio` |
| `page` | page number, from 1 |
| `x` `y` `w` `h` | position and size in mm |
| `rotate` | degrees clockwise |
| `plane` | `above` (default) or `below` the body text |
| `locked` `hidden` | optional, `true` to lock / hide |
| `text` | for `text`: `md` (markdown: paragraphs, bold/italic, colors, lists), optional `fontSizePt`, `color` / `fill` / `border` (`#RRGGBB`), `align` (`left` `center` `right`), `valign` (`top` `middle` `bottom`), `paddingMm` |
| `src` | for `image` / `video` / `audio`: `assets/<file>` (or an `https://` address); `alt` for images, `name` for video/audio, `poster` for video |

The order of `items` is the stacking order (later items are on top). Items the editor cannot read are dropped.

## Body syntax (markdown, one block per line)

- Headings `#` … `####`; `**bold**`, `*italic*`, `~~strike~~`, `` `code` ``
- Lists `- item`, numbered `1. item`; quote `> text`; divider `---`
- Tables `| a | b |` with a `|---|---|` second row; optional `<!--colwidths:120,300-->` line right above sets column widths in px
- Code blocks with ```` ``` ````; ```` ```mermaid ```` blocks become diagrams
- Links `[text](https://…)`
- Text color `:color[text]{color=red}` · highlight `:bg[text]{color=#fde68a}` · outline `:box[text]{color=#94a3b8}` (named colors or `#hex`)
- Callout: a line `:::tip`, the content lines, then a line `:::` (`tip` `note` `info` `warn` `danger` `success` `important` `caution`)
- Formula: `$$ E = mc^2 $$` (LaTeX), on its own line or spanning lines between `$$`
- `[[toc]]` table of contents · `{indent:2}` at the start of a paragraph indents it (1–8)
- A line containing only `&nbsp;` is an empty line; `<!--pagebreak-->` starts a new page

## Images, video, audio

Put the file in `assets/` and reference it with a relative path:

```
![caption](assets/photo.jpg)
<img src="assets/photo.jpg" alt="caption" width="320">
<video src="assets/clip.mp4" data-name="clip.mp4" width="480" controls></video>
<audio src="assets/talk.mp3" data-name="talk.mp3" controls></audio>
```

Asset file names: no `/` `\` spaces quotes brackets or parentheses. `width` is in CSS pixels.

Files the editor inserts are named `<16 lowercase hex characters>.<ext>` (e.g. `3f9a0c1d2b4e5f60.jpg`). After a save the
editor deletes files with names of that shape that the document no longer mentions. Files with any other name are never
deleted, so give files you add yourself a normal name (`harbour.jpg`, not 16 hex characters).

## Moving a project

The editor's "Export project" makes `<name>.dilin-docs.zip` containing `project.json` and `assets/`;
"Import" accepts that zip or a folder with the same layout.

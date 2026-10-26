# Dilin Studio · Paint — project format

A Paint project is a folder:

```
my-drawing/
  project.json      the drawing (JSON, UTF-8)
  assets/           image files used by project.json
    3f9a0c1d2e4b5a67.png
    logo.png
```

One project is one drawing; it may have several pages (see `pages` below).

The editor saves here (Save / Ctrl+S, and a few seconds after the last edit) and re-reads `project.json`
every ~1.5 s. If another program (for example your AI) changes the file, the page reloads it. If the page
also has unsaved edits, it does not overwrite the file and asks which version to keep.

## project.json

```json
{
 "format": "dilin-studio/paint",
 "version": 1,
 "width": 400,
 "height": 300,
 "layers": [
  {"id": "L1", "kind": "raster", "name": "Background", "visible": true, "opacity": 1, "blend": "normal",
   "x": 0, "y": 0, "image": "assets/3f9a0c1d2e4b5a67.png"},
  {"id": "L2", "kind": "text", "name": "Title", "visible": true, "opacity": 1, "blend": "normal", "x": 0, "y": 0,
   "data": {"x": 100, "y": 100, "text": "Hello", "size": 48, "font": "sans-serif", "color": "#123456", "align": "left", "weight": "normal"}},
  {"id": "L3", "kind": "vector", "name": "Shapes", "visible": true, "opacity": 1, "blend": "normal", "x": 0, "y": 0,
   "data": {"shapes": [
    {"id": "S1", "type": "rect", "x": 200, "y": 150, "w": 80, "h": 60, "fill": "#00aa00", "stroke": "none", "strokeWidth": 0},
    {"id": "S2", "type": "ellipse", "x": 50, "y": 200, "w": 60, "h": 60, "fill": "#0000ff", "stroke": "none", "strokeWidth": 0}
   ]}}
 ]
}
```

| field | meaning |
|---|---|
| `format` | always `"dilin-studio/paint"` |
| `version` | `1` (a newer number means a newer editor wrote it; this one refuses to open it) |
| `width`, `height` | canvas size in pixels (1–20000) |
| `layers` | bottom to top |
| layer `id` | unique string (`L1`, `L2`, … — pick any unused one for a new layer) |
| layer `kind` | `raster` (pixels), `text`, `vector` (shapes and paths), `group` (layer group), `smart` (smart object) |
| `name`, `visible` | as shown in the Layers panel |
| `opacity` | 0–1 |
| `blend` | `normal`, `dissolve`, `darken`, `multiply`, `colorBurn`, `linearBurn`, `darkerColor`, `lighten`, `screen`, `colorDodge`, `linearDodge`, `lighterColor`, `overlay`, `softLight`, `hardLight`, `vividLight`, `linearLight`, `pinLight`, `hardMix`, `difference`, `exclusion`, `subtract`, `divide`, `hue`, `saturation`, `color`, `luminosity` |
| `x`, `y` | where the layer's top-left sits on the canvas (raster layers) |
| `image` | raster layers: `"assets/<file>"` — the picture, drawn at its own pixel size |
| `mask` | `null`, or `{"enabled": true, "image": "assets/<file>"}` (white shows, black hides) |
| `parent` | id of the group this layer is in (`null` / missing = top level) |
| `data` | text and vector layers: their content (see the example and "Shapes" below; copy an existing layer when unsure) |
| `style` | layer styles (drop shadow, stroke …) or `null` |

A new drawing starts with one white raster layer named `Background` at the bottom. Keep it and add your
layers above it: without it the canvas is transparent (shown as a dark checkerboard) and dark text on it is
hard to see. Remove it only when the user asks for a transparent picture.

To change the words of a text layer, edit its `data.text` (and `size`, `font`, `color` for the look); to
rename it, change `name`. Do not click the text tool on the web canvas and type: under automated control
keyboard focus is unreliable, letters get lost and the layer name does not follow.

### Shapes (vector layers)

`data.shapes` is a list, drawn in order. Every shape has `id`, `fill` (`#rrggbb` or `"none"`), `stroke`
(`#rrggbb` or `"none"`) and `strokeWidth`.

- `{"type": "rect", "x", "y", "w", "h"}` — rectangle (`x`, `y` = top-left)
- `{"type": "ellipse", "x", "y", "w", "h"}` — ellipse in that box (`w` = `h` for a circle)
- `{"type": "star", "cx", "cy", "r1", "r2", "points": 5}` — star (r1 outer, r2 inner radius); `{"type": "polygon", "cx", "cy", "r1", "points": 6}` — regular polygon
- `{"type": "line", "points": [[x1, y1], [x2, y2]]}` — a line (give it `stroke` and `strokeWidth`)
- `{"type": "path", "points": [[x, y], …], "closed": true}` — any polygon: a triangle is three points,
  e.g. `[[400, 100], [480, 240], [320, 240]]`; `"closed": false` draws an open line through the points
- `{"type": "bezier", "anchors": [{"x", "y", "in": [x, y] | null, "out": [x, y] | null}, …], "closed": true}` — curves (`in`/`out` are absolute handle points)

Coordinates are canvas pixels.

Other top-level and per-layer fields (guides, smart-object sources `smartSources`, document info …) are
written by the editor; leave them as they are if you do not need them.

`brushTips` (optional) holds the custom brush tips this drawing uses or defined (Define Brush Preset, imported
Photoshop .abr files): `[{"id", "name", "width", "height", "size", "spacing", "enc": "rle", "tip"}]`, where `tip`
is the grey-scale tip (one byte per pixel, 255 = full paint) PackBits-compressed and base64-encoded. Leave it as
it is; to paint with a tip, use the editor command `brush.tips.select` (list them with `brush.tips.list`).

Pages: the top level is page 1 (`pageName` = its optional name); `pages` holds pages 2, 3, … — each one is a
complete single-page drawing (`format`: "dilin-canvas", `version`, `width`, `height`, `layers`, …) plus an
optional `name`. Each page opens in its own tab; a save writes all pages back (their pictures go to `assets/`
like page 1's). At most 100 pages; no `pages` inside a page.

## Checking your edit: project.check.json

Each time the editor opens `project.json` (also after your edit, within ~1.5 s) it writes `project.check.json` next to it:

```json
{"ok": false, "layers": 3, "checkedAt": "…",
 "errors":   [{"path": "layers[2].data.shapes[0].type", "message": "unknown shape type \"triangle\" — nothing is drawn", "hint": "use path with three points and \"closed\": true. …"}],
 "warnings": [{"path": "layers[1].data.fontSize", "message": "\"fontSize\" is not read on a text layer", "hint": "the field is \"size\""}]}
```

`errors` will not show on the canvas; `warnings` are fields the editor does not read (or a missing background).
Fix `project.json`, save, and read the report again. Do not edit `project.check.json` itself; it is rewritten.

Text layers: `data.y` is the baseline of the first line (the bottom of the letters), so a 48 px title at the top
needs `y` of about 48 or more; `"align": "center"` centres the text on `data.x`.

## Seeing what was drawn: preview.png and project.layout.json

About a second after the editor draws the project (after it opens it, and after each save) it writes:

- `preview.png` — the flattened picture (longest side at most 1024 px; `previewScale` in the layout says how much smaller).
- `project.layout.json` — for every layer, bottom to top, the box it really covers in canvas pixels
  `[x0, y0, x1, y1]` and `onCanvas`: `inside`, `partly` (crosses an edge), `outside` or `empty` (draws nothing).
  Vector layers list each shape's box; text layers give the measured box of the words (with the real font).

```json
{"width": 1200, "height": 675, "preview": "preview.png", "previewScale": 0.853,
 "layers": [{"index": 2, "id": "T1", "kind": "text", "box": [80, 41.5, 412.3, 104], "onCanvas": "inside", "text": {"lines": 1, "size": 64, "box": [80, 41.5, 412.3, 104]}}]}
```

Use them to check that things are where you meant and do not overlap. Both are rewritten; do not edit them.

## Images

- Any string of the form `assets/<name>.<png|jpg|jpeg|webp|gif|svg>` anywhere in project.json is replaced by
  that file when the project opens. Names: letters, digits, `.`, `_`, `-`; no sub-folders.
- To add a picture: copy it into `assets/`, then add a raster layer whose `image` is its path.
- Files the editor writes are named after their content (16 hex characters). Those it no longer uses are
  deleted on the next save. When the editor saves, every picture is written again under such a content name,
  so after a save your layer points to `assets/<16 hex>.png` instead of the name you gave it. Files with any
  other name (like `logo.png`) are never deleted by the editor; remove them yourself when no longer needed.
- A missing file leaves that layer empty and the page says which file is missing.

## Export / import

`Export project` gives `<name>.dilin-paint.zip` containing the same `project.json` + `assets/`. Import takes
that zip (or a folder). PNG, SVG, PSD and other exports are in the editor's own File menu.

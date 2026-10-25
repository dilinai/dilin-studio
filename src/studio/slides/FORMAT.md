# Dilin Studio · Slides project format

A slides project is a plain folder:

```
my-deck/
  project.json      ← the whole deck (edit this)
  assets/           ← images / videos used by the deck (original files)
```

The editor checks `project.json` about once a second. Save the file and the open
editor reloads it. Keep it valid JSON (UTF-8, no comments).

## project.json

```jsonc
{
  "format": "dilin-studio/slides", // fixed
  "version": 1,                     // fixed
  "name": "My deck",
  "deck": {                   // the deck itself
    "version": 2,             // fixed
    "lang": "zh-TW",          // "zh-TW" | "zh-CN"
    "themeId": "forest-moss", // colour/font theme for the whole deck
    "pages": [ /* one object per slide, in order */ ]
  }
}
```

### A page

```jsonc
{
  "pid": "p1a2b3c4",          // stable page id (letters/digits); keep it when editing
  "layoutId": "blank",        // layout name; use "blank" for free-form pages
  "draft": { "type": "content", "title": "", "items": [] },
  "background": { "color": "#FFFFFF" },          // optional; or "imageUrl": "assets/bg.jpg"
  "transition": { "type": "fade", "durationMs": 600 }, // optional: none|fade|push|wipe|zoom|morph
  "components": [ /* what is on the slide, bottom → top */ ],
  "animations": [ /* optional, see below */ ]
}
```

If a page has a `components` array, that array **is** the slide. If it has none,
the slide is laid out automatically from `layoutId` + `draft`. To change a slide
precisely, give it `components`.

`draft` is the page's text for automatic layout, one of:
`{"type":"cover","title":"…","subtitle":"…"}` · `{"type":"contents","items":["…"]}` ·
`{"type":"transition","title":"…"}` · `{"type":"content","title":"…","items":[{"heading":"…","body":"…"}]}` ·
`{"type":"end"}`. Pages with `components` still need a `draft`: use `"layoutId": "blank"` with the empty
content draft above (`{"type":"content","title":"","items":[]}`) — also for a cover or closing slide you draw with
components. `layoutId` and `draft.type` must match (`blank` only goes with `content`); a page that doesn't match is
turned into a blank page when the project opens.

### Coordinates

The slide is **1000 × 562.5** units (16:9). Every component has a frame:

```json
"frame": { "x": 80, "y": 60, "w": 840, "h": 90, "rotate": 0 }
```

Origin top-left, `rotate` in degrees clockwise around the centre.

### Components

Every component has `id` (unique in the deck, letters/digits/`_.:~-`), `type`,
`frame`, and optionally `name`, `opacity` (0–1), `locked`, `hidden`, `morphKey`.

Colours are `"#RRGGBB"` / `"#RRGGBBAA"` or a theme colour
`"theme:bg"`, `"theme:surface"`, `"theme:border"`, `"theme:text"`, `"theme:muted"`, `"theme:accent"`, `"theme:onAccent"`,
`"theme:figureBg"`, `"theme:primary"`, `"theme:secondary"`.
Fonts are `"theme:heading"`, `"theme:body"`, or a font name.

**text**
```json
{ "id": "c_title", "type": "text", "frame": {"x":80,"y":60,"w":840,"h":90,"rotate":0},
  "paragraphs": [ { "runs": [ { "text": "Hello", "bold": true } ], "align": "left" } ],
  "box": { "font": "theme:heading", "size": 40, "color": "theme:text",
           "align": "left", "valign": "top", "lineHeight": 1.3, "padding": 4 } }
```
A run can also set `italic`, `underline`, `strike`, `color`, `highlight`, `font`, `size`.
A paragraph can set `list` (`{"kind":"ul","style":"disc"}` or `{"kind":"ol","style":"decimal"}`), `indent`, `lineHeight`.

**image** — `"src": "assets/photo.jpg", "fit": "cover"` (or `"contain"`); optional `radius`, `crop`.

**video** — `"src": "assets/clip.mp4", "fit": "contain"`; optional `poster`, `autoplay`, `loop`, `muted`, `controls`.

**shape** — `"shape": "rect"` (also `roundRect`, `ellipse`, `ring`, `arc`, `triangle`, `diamond`, `arrow`, `callout`, `summingJunction`, `line`),
`"fill": "theme:accent"`, `"stroke": {"color":"#000000","width":2}`; optional `text` (same shape as a text
component's `paragraphs` + `box`), `gradient`, `shadow`.

**table** — `"cells": [[{"paragraphs":[...]}, ...], ...]`, `"colWidths": [1,1,2]`, `"header": true`,
`"style": {"font":"theme:body","size":14,"color":"theme:text","headerFill":"theme:accent","headerColor":"theme:onAccent","borderColor":"theme:border"}`.

**chart** — `"chart": "column"` (also `bar`, `line`, `pie`, `doughnut`), `"labels": ["Q1","Q2"]`,
`"series": [{"name":"Sales","values":[3,5]}]`, `"legend": true`, `"showValues": false`.

**program** — animated HTML/JS (canvas allowed) shown in a sandbox:
`"html": "<canvas id=c></canvas><script>…</script>"`, optional `css`, `designW`, `designH`, `steps`
(how many "next" clicks it consumes). It cannot reach the network.

**group** — `"children": [ ...components ]` (one level only).

### Animations (optional)

```json
{ "id": "a1", "componentId": "c_title", "phase": "enter", "effect": "fade",
  "trigger": "click", "durationMs": 500, "delayMs": 0 }
```
`phase`: `enter` (appear, fade, fly, float, wipe, zoom, spin, bounce) ·
`emphasis` (pulse, teeter, grow) · `exit` (disappear, fade, fly, zoom).
`trigger`: `click`, `with`, `after`. `fly`/`wipe` take `direction`: left|right|up|down.

### Media

Put files in `assets/` and refer to them as `"assets/<file name>"`.
Web addresses (`https://…`) also work for images and videos.

## Minimal example

```json
{
  "format": "dilin-studio/slides",
  "version": 1,
  "name": "Hello",
  "deck": {
    "version": 2,
    "lang": "zh-TW",
    "themeId": "forest-moss",
    "pages": [
      {
        "pid": "p0000001",
        "layoutId": "blank",
        "draft": { "type": "content", "title": "", "items": [] },
        "background": { "color": "#FFFFFF" },
        "components": [
          { "id": "c0000000001", "type": "text",
            "frame": { "x": 80, "y": 220, "w": 840, "h": 120, "rotate": 0 },
            "paragraphs": [ { "runs": [ { "text": "Hello, slides" } ], "align": "center" } ],
            "box": { "font": "theme:heading", "size": 54, "color": "theme:text",
                     "align": "center", "valign": "middle", "lineHeight": 1.2, "padding": 4 } }
        ]
      }
    ]
  }
}
```

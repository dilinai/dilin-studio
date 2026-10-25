# Dilin Studio · Video project format (`dilin-studio/video`, version 1)

A project is a folder:

```
<project>/
  project.json      ← the whole edit (this file)
  assets/           ← original media files, referenced by name from project.json
```

The editor checks `project.json` every ~1.5 s. Save the file and, if the user has no unsaved edits, the open editor
swaps in the new content in place within about 2 seconds (no full page reload) and shows a short notice; this is one
undo step, so Undo (Ctrl+Z) goes back to the previous version. If the new `project.json` cannot be read (for example
invalid JSON), the editor keeps what it shows and says why; write a fixed `project.json` and it is picked up. If the
user has unsaved edits, the editor asks them first.

## Minimal example

```json
{
  "format": "dilin-studio/video",
  "version": 1,
  "name": "Trip",
  "ratio": { "kind": "preset", "key": "16:9" },
  "media": [
    { "id": "m1", "name": "beach.mp4", "kind": "video", "duration": 12.5, "file": "beach.mp4" },
    { "id": "m2", "name": "song.mp3", "kind": "audio", "duration": 30, "file": "song.mp3" }
  ],
  "tracks": [
    { "id": "t1", "kind": "text", "locked": false, "hidden": false, "muted": false, "clips": [
      { "id": "c3", "start": 1, "length": 2, "offset": 0, "text": { "content": "Hello", "x": 0.5, "y": 0.8, "size": 0.1 } }
    ] },
    { "id": "main", "kind": "visual", "locked": false, "hidden": false, "muted": false, "clips": [
      { "id": "c1", "mediaId": "m1", "start": 0, "length": 4, "offset": 2 },
      { "id": "c2", "mediaId": "m1", "start": 4, "length": 3, "offset": 8, "transIn": { "tr": "tr-luma_dissolve", "length": 0.8 } }
    ] },
    { "id": "a1", "kind": "audio", "locked": false, "hidden": false, "muted": false, "clips": [
      { "id": "c4", "mediaId": "m2", "start": 0, "length": 7, "offset": 0, "volume": 0.6, "fadeOut": 1 }
    ] }
  ],
  "programs": {}
}
```

## Top level

| field | meaning |
|---|---|
| `format` | always `"dilin-studio/video"` |
| `version` | `1`. A newer number is refused by older editors. |
| `name` | project name (shown in the editor's top bar) |
| `ratio` | `{"kind":"fit"}` (follow the first video), `{"kind":"preset","key":"16:9"\|"4:3"\|"2.35:1"\|"2:1"\|"1.85:1"\|"9:16"\|"3:4"\|"5.8in"\|"1:1"\|"1:2"}` (any other key falls back to fit), or `{"kind":"custom","w":1470,"h":630}` (exact pixels, 16–8192) |
| `media` | media list (below) |
| `tracks` | lanes, top → bottom (below) |
| `programs` | embedded program packages; leave `{}` unless you know what you are doing |

Ids (`media[].id`, lane ids, clip ids) are `[A-Za-z0-9_-]`, 1–64 characters, unique.
Times are seconds. The editor works on a 30 fps grid.

## media

`{ id, name, kind: "video"|"audio"|"image", duration, file, noPicture? }`

- `file` = file name inside `assets/` (no slashes). **To use a new file: copy it into `assets/`, then add a media
  item pointing at it.** A media item whose `file` is missing or invalid is dropped, together with every clip that uses it.
- `duration` = length of the source in seconds; `0` = unknown (the editor measures it on open). Images: `0`.
- `noPicture: true` = the browser could only decode the sound of this video.
- `.m4a` audio must be AAC-encoded (`ffmpeg -i in.wav -c:a aac out.m4a`); browsers can't decode ALAC in `.m4a`. Re-encode it, or use mp3 / wav.

## tracks (lanes)

`{ id, kind, locked, hidden, muted, markers?, clips: [...] }`

- `kind`: `"visual"` (video / image), `"audio"`, `"text"`, `"sticker"`, `"filter"`, `"program"`.
- The lane with id `"main"` must exist (it is a visual lane). Audio lanes go **below** it; every other kind goes
  **above** it. Upper lanes are drawn over lower ones.
- `markers` (main lane only): `[sec, ...]` = flags on the time ruler.
- Clips in one lane must not overlap (a later overlapping clip is dropped on load).

## clips

Common: `{ id, start, length, offset, disabled? }` — `start` = position on the timeline, `length` = timeline length,
`offset` = seconds into the source where the clip starts.

**Video / image / audio clips** (`visual` and `audio` lanes) have `mediaId` and may carry:

- `volume` (0..10, 1 = 100%), `muted`, `fadeIn`, `fadeOut` (seconds of audio fade)
- `speed` (0.1..100; source seconds per timeline second — a 10 s source at speed 2 has length 5), `pitch: true` (pitch follows speed)
- `curve: { id: "custom"|"montage"|"hero"|"bullet"|"jump"|"flashIn"|"flashOut", pts: [[x 0..1, speed 0.1..10], ...] }` = curve speed (replaces `speed`)
- `reverse: true` (play backwards), `freeze: true` (freeze frame at `offset`, visual lanes only)
- `aud: { denoise?, norm?: true, semi? (-12..12), chan?: "left"|"right"|"mono"|"swap", sfx?: "echo"|"hall"|"phone"|"radio"|"robot"|"underwater"|"megaphone" }`
- `kf: { <prop>: [{ t, v, e? }] }` keyframes — `t` = source seconds (same unit as `offset`), `e` = ease to the next key
  (`"linear"|"in"|"out"|"inout"|"in2"|"out2"|"inout2"|"backIn"|"backOut"|"hold"` or `[x1,y1,x2,y2]`).
  Props: `sx, sy, x, y, rot, opacity, mask.x|y|w|h|rot|feather|radius, adj.<key>, vol` (dB, -40 = mute).

Visual clips only:

- `look: { sx, sy, uniform?, x, y, rot, opacity, blend?, mask?, adj?, hsl?, curves?, wheels?, lut?, key?, corner?, shadow?, mblur?, flipH?, flipV?, crop?, bg? }`
  — `sx/sy` scale (1 = 100%), `x/y` offset from centre as a fraction of the canvas (y up), `rot` degrees,
  `mask` = `{shape: linear|mirror|circle|rect|star|heart|pen|stripes, x, y, w, h, rot, feather 0..100, radius 0..100, invert}` — `w` is a fraction of the canvas width and `h` of the canvas height, so a round circle on 16:9 needs `h = w × 16/9`,
  `adj` = `{temp, tint, sat, vib, bright, contrast, highlight, shadow, white, black, light, vignette: -100..100; sharpen, clarity, grain, fade: 0..100}`,
  `crop` = `{l, t, r, b}` fraction cut from each side, `bg` = `{kind:"color",color}` or `{kind:"blur",amount:1..4}`.
- `anim: { in?, out?, loop?: { id, dur } }` entrance / exit / loop animation (same ids as text animations).
- `fx: [{ fx, strength 0..1 }]` effects (max 4); `transIn: { tr, length 0.2..3 }` transition on the seam with the previous
  clip of the same lane (only when that clip ends exactly where this one starts). Ids are listed in `lib/fx.data.ts`
  (`kind: "effect"` / `"transition"`). There is no plain `tr-fade`; for a soft crossfade use `tr-luma_dissolve`.
  Transition ids: `tr-blur_dissolve`, `tr-chroma_whip`, `tr-crash_zoom`, `tr-cube`, `tr-dip_black`, `tr-door`, `tr-film_burn`, `tr-flash_dissolve`, `tr-flash_white`, `tr-glitch`, `tr-gold_wipe`, `tr-halftone_rip`, `tr-ink`, `tr-iris`, `tr-leak_dissolve`, `tr-luma_dissolve`, `tr-pixel_dissolve`, `tr-prism_flash`, `tr-pull_out`, `tr-push`, `tr-shake_zoom`, `tr-shutter`, `tr-slats`, `tr-spin`, `tr-static_tv`, `tr-swirl`, `tr-torn_paper_diag`, `tr-torn_paper_split`, `tr-torn_paper_v`, `tr-whip`.
- `mosaic: [{ id, pts: [[srcSec, x, y], ...], shape: "rect"|"round"|"ellipse", mode: "pixel"|"blur"|"solid", w, h, strength 1..100, color }]` tracked censoring boxes.

**Text clips** (`text` lane): `text: { content, x, y, size, fancy?, font?, bold?, italic?, underline?, color?, letterSpacing?, lineSpacing?, align?, scale?, rotate?, opacity?, stroke?: {color,width}, bg?: {color,opacity} }`
— `x, y` = centre (0..1 of the frame), `size` = height fraction (0.03..0.5), `content` may contain `\n`.
Keyframe props: `tx, ty, ts, trot, top`. Also `anim` as above.

**Sticker clips** (`sticker` lane): `sticker: { sticker, x, y, size }` (ids in `lib/stickers.data.ts`), plus `anim`.

**Filter clips** (`filter` lane): `filter: { filter, strength 0..1 }` (ids in `lib/filters.data.ts`), keyframe prop `flt`.
An adjustment layer is `{ id, start, length, offset: 0, adjust: true, look: { adj?, hsl?, curves?, wheels?, lut? } }`
and grades every visual lane below it.

**Program clips** (`program` lane): `program: { pkg, version, params }` — a built-in animated overlay; see `lib/programs.data.ts`.

## What the editor does on load

Anything it cannot use is dropped and listed in a notice (bad ids, overlapping clips, clips pointing at missing media,
unknown effect / transition / animation ids…). Unknown sticker or filter ids are listed too (the clip stays but draws nothing). The rest opens normally. Values out of range are clamped.

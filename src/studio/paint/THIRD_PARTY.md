# Dilin Studio · Paint — third-party material

The editor UI in this folder (`paint/*`) is original code. The paint engine it loads
(`public/drawboard-app/`, served at `/drawboard-app/`; same files as the signed-in site) contains the following third-party material. Paths in the table below are
relative to that folder. License texts ship next to the engine in `public/drawboard-app/licenses/` (9 files: README.txt, PhotoCraft and VectorCraft LICENSE-MIT + NOTICE,
JPEG-IJG-README.txt, SCOWL-LICENSE.txt, ag-psd-LICENSE-MIT.txt, lzokay-LICENSE-MIT.txt).

| what | where in the engine | source | license | how it is used |
|---|---|---|---|---|
| PhotoCraft (image editor, Rust) | raster engine, filters, adjustments, layer styles, retouch tools — files whose comments cite `*.rs` file/line (e.g. `engine.js`, `menus/impl/ps-*.js`, `tools/clone.js`, `tools/spotheal.js`, `tools/historybrush.js`) | https://github.com/storytold/photocraft | MIT OR Apache-2.0 (dual; this engine uses it under **MIT**) — Copyright (c) 2026 ArtCraft Team and the PhotoCraft contributors | logic translated from Rust to JavaScript; copyright and license kept in `licenses/PhotoCraft-LICENSE-MIT.txt` and `licenses/PhotoCraft-NOTICE.txt` |
| VectorCraft (vector editor, Rust) | vector tools and Illustrator-style menus (`menus/impl/ai-*.js`, `tools/shapebuilder.js`, `tools/livepaint*.js`, …) | https://github.com/storytold/vectorcraft | MIT OR Apache-2.0 (dual; used under **MIT**) — Copyright (c) 2026 ArtCraft Team and the VectorCraft contributors | logic translated from Rust to JavaScript; `licenses/VectorCraft-LICENSE-MIT.txt`, `licenses/VectorCraft-NOTICE.txt` |
| Independent JPEG Group (libjpeg-turbo `jchuff.c`, `jcphuff.c`) | `menus/impl/jpeg-enc.js` (optimal Huffman tables, progressive entropy coding) | https://github.com/libjpeg-turbo/libjpeg-turbo/tree/43ea809765004508d8da72ebe562cf570c6a62b2 | IJG license | translated to JavaScript; original copyright kept in the file; `licenses/JPEG-IJG-README.txt`. "This software is based in part on the work of the Independent JPEG Group." |
| SCOWL English word list | `menus/impl/ps-edit-dict/en_US-scowl-50.txt.gz`; the stem list in `menus/impl/ai-edit.js` (`AiEdit.spellRaw`, generated from the Debian `wamerican` list, which is SCOWL-derived) | https://github.com/en-wl/wordlist | SCOWL license (permissive) | spell check; `licenses/SCOWL-LICENSE.txt` |
| SWOP TR003 coated characterization (via colord's `SWOP_TR003_coated_3.icc`) | `menus/impl/cmyk-swop.js` (9⁴ lookup grid computed with LittleCMS) | https://github.com/colord/colord (profile data: CGATS TR 003, NPES) | profile described as CC0; colord MIT | CMYK approximation (this is **not** Adobe's USWebCoatedSWOP.icc) |
| ag-psd (PSD reader/writer, TypeScript) | `menus/impl/psd-io.js` — the EngineData layout of live text layers (TySh) and the Photoshop kinsoku tables | https://github.com/Agamnentzar/ag-psd | MIT — Copyright (c) 2016 Agamnentzar | structure and default tables followed when writing editable text into PSD; no ag-psd code is shipped |
| lzokay (LZO1X decompressor, C++) | `menus/impl/raster-io.js` — `lzo1x`, used to read Procreate `.chunk` tiles | https://github.com/jackoalan/lzokay | MIT — Copyright (c) 2018 Jack Andersen | decompression steps translated to JavaScript; `licenses/lzokay-LICENSE-MIT.txt` (no LZO / minilzo code is used) |

Not third-party, listed for review:
- Toolbar icons (`icons.js`) are drawn for this engine as SVG line art modelled on the Photoshop 2020 /
  Illustrator 2020 toolbars; no icon files were copied.
- The Zstandard decoder in `menus/impl/vec-io.js` (used to read the private data of Illustrator files) is written for this engine from
  RFC 8878; no zstd library code is included.
- Fonts: the engine bundles none; text uses fonts installed on the user's computer.
- Brushes, patterns and filter textures are generated in code; no image files are bundled.
- The ArtCraft name, wordmark and logos are trademarks of the ArtCraft Team and are not used.

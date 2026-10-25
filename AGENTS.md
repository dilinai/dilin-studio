# AGENTS.md — how an AI uses this repository

This repository is **Dilin Studio** (version 1.3.33): five editors — docs, sheets, slides, video, paint — that run entirely in the browser.
It is the same code as the editors on https://dilinai.com (source commit `c97c2f6a7`; every file under `src/studio/` is byte-for-byte the website's file at that commit).

## 0. Read this first: three ways to deliver — ask the user which one

If someone hands you this repository (for example from a video or a post) and wants you to **make or edit** a document, sheet, slide deck, video edit or drawing, there are three ways. **Ask them which they want before doing any.**

1. **Run the local copy on their own computer.** They download a built release (README, "下載編好的版本") or clone this repository, and double-click a start file (section 1 and the README). Their work stays in their browser or a local folder they pick, on their machine; nothing goes to any server. You can hand them a `project.json` + `assets/` to import, or drive their open editor through the local MCP at `http://localhost:41730/mcp`.
2. **Use the web page https://dilinai.com/studio in their browser.** Nothing to install. The editor runs in their browser and the work is kept in the browser's own storage (OPFS); **nothing is uploaded**.
   - If you can operate the page (for example through a browser extension): hand media in with the page's **Import** button, then edit the project. What you may rely on is listed in section 7, "Stable interfaces".
   - If you can only produce links: give them a link that carries the project, `https://dilinai.com/studio/<editor>#p=<data>` (see "Links that carry the work" below). The part after `#` is never sent to a server.
3. **Get a short link (`https://dilinai.com/s/<code>`).** Opening it shows the finished project, editable by hand. **This uploads the project and its media to the https://dilinai.com server** (kept temporarily, deleted when they close the editor page). Do **not** call the `/api/studio-share` endpoints until you have told the user this and they have agreed.

The editors on the website (`<editor>` = `docs`, `sheets`, `slides`, `video` or `paint`):

```
https://dilinai.com/studio/<editor>
```

### Way 3: short links (`https://dilinai.com/s/<code>`) — only after the user agreed to upload

All endpoints need no sign-in and take/return JSON (`Content-Type: application/json`). The ones marked *ticket* take the header `Authorization: Bearer <token>`.

**A. You made the work yourself**

1. `POST https://dilinai.com/api/studio-share` with body `{"app":"<editor>","by":"ai","project":<the whole project.json object>}` → `{"code","url","token","version":1}`. `token` is your AI editing credential (write ticket) for this work — **store it** and send it with every later write; do not give it to the user.
2. Media (files in `assets/`), one file at a time (*ticket*): `POST https://dilinai.com/api/studio-share/<code>/assets/init` with `{"name":"<file name>","size":<bytes>,"contentType":"<MIME>"}` → `{"uploadId","partSize","parts":[{"partNumber","url"}]}`. Split the file into `partSize` chunks and `PUT` chunk n (`partNumber` = n, from 1) directly to that part's `url`; keep each response's `ETag` header. Then `POST https://dilinai.com/api/studio-share/<code>/assets/complete` with `{"name","uploadId","parts":[{"PartNumber":n,"ETag":"<that part's ETag>"}]}`.
3. Give the user `https://dilinai.com/s/<code>`. Opening it shows the finished work, ready to edit.
4. To change it later (*ticket*): `PUT https://dilinai.com/api/studio-share/<code>/project` with `{"base_version":<the version you have>,"project":<the new whole project.json>}` → `{"version":<new>}`; the page the user has open follows within seconds. `409` (body `{"version"}`) means the user changed it meanwhile: `GET` the latest first, edit that, resend with the new version.

**B. The user gives you a link like `https://dilinai.com/s/<code>`**

1. Read (no ticket, no code): `GET https://dilinai.com/api/studio-share/<code>` → `{"app","version","project","assets":{"<file name>":"<download address>"},"claimed","ai_paired"}`. For a very large project, `project` is `null` and `"project_url"` is given instead: GET that address (if it returns `{"__studio_share_version","project"}`, take `project`). `404` = expired or deleted.
2. To edit: if you already hold this work's credential (from creating it, or from an earlier pairing), skip to step 4 — **one pairing stays valid** until the user presses "Revoke AI editing" or the work is deleted; pair again only if you lost the credential. To pair, send the request yourself: `POST https://dilinai.com/api/studio-share/<code>/pair-request` → `{"request_id"}`. Within a few seconds the page the user has open shows a 6-digit code (valid 5 minutes) — ask them to tell you the code. `409` (`no_open_tab`) = they don't have the page open; ask them to open it.
3. `POST https://dilinai.com/api/studio-share/<code>/pair-confirm` with `{"request_id":"<from step 2>","code":"<6 digits>"}` → `{"token"}` (your credential for this work — store it). `401` = wrong code; after 5 wrong tries start again from step 2.
4. `PUT` the new version as in A.4 with the credential (with `base_version`; on `409` GET first). The user can press "Revoke AI editing" on the page at any time, which cancels your credential.

If you can only read links and cannot send requests, do not ask the user to wait for a code (no `pair-request` was sent, so the page shows none): give them a `#p=` link with the edited project instead (way 2); opening it gives them a new copy in their browser.

**Short-link work is temporary:** it is deleted after the user closes the editor page, and expires 24 hours after creation if nobody opens it. Remind the user to keep important work with "Download to computer" on the left.

### Links that carry the work (way 2 for an AI that can only produce links; also when the create API above can't be reached)

Nothing is uploaded to https://dilinai.com; the work lives only in the user's browser after they open the link.

1. **Small work** (only `project.json`, no media files, and the whole link stays under **32 000 characters**): reply with one link, `https://dilinai.com/studio/<editor>#p=<data>`, where `<data>` = `JSON.stringify(project.json)` (no indentation) → UTF-8 → deflate-raw (same as the browser's `CompressionStream("deflate-raw")`) → base64url without `=` padding. It sits after `#`, so it is never sent to any server. Chat apps and text messages often cut long links, hence the 32 000 limit; the page itself accepts at most 60 000 characters after `#p=` and says the link is too long beyond that. `node tools/make-link.mjs` does this for you (section 4a).
2. **Larger work, or work with media** (images, video, audio — never put media into a link): zip `project.json` + `assets/` (`project.json` at the top level or inside the single top-level folder; media directly in `assets/`, no subfolders, names must not contain `/` or `\`; a single `project.json` file also works), put it at a public https address that downloads directly without login, and give `https://dilinai.com/studio/<editor>?import=<that address, URL-encoded>` (section 4b; limit 50 MB). If you cannot put files at a public address, give a version without media via (1) and let the user add the media in the editor. In `project.json`, docs, sheets and slides may also reference media by `https://` address; video and paint media must be files in `assets/`.
3. **One link is one piece of work.** The website's guest editors have no project list or project-file import menu. Pressing "Copy" on the right of the editor gives the user a short link (`https://dilinai.com/s/<code>`) to hand to you — then follow B above.
4. If you can operate the user's browser, you can also use the editor on the page directly (section 7 lists what you may rely on).
5. **Teach the user first, in a sentence or two:** the result is a link they open to view and keep editing; to have you edit the work they have open, they give you its link and tell you the 6-digit code when the page shows one; closing the page deletes the work, so keep a downloaded copy of important work. Do not hand them the API spec.

Every editor page on the website also carries these notes in its HTML for an AI reading the page's link.

**The local copy (downloading a release or cloning this repository, then double-clicking a start file) is way 1 above:** no sign-in, no account, the work stays on the user's machine. The steps below cover running it, reading the format files, `tools/make-link.mjs`, and checking a project locally.

## 1. Get the code

```
git clone https://github.com/dilinai/dilin-studio dilin-studio
cd dilin-studio
```

Without git: download `dilin-studio-<version>.zip` from this repository's GitHub Releases and unzip it (the sha256 checksum is in the release notes); start files as in the README.

Nothing has to be installed to *use* the editors (the built app is in `app/`). Node.js (18+) is needed only for the helper `tools/make-link.mjs`.

## 2. What a project is

A project is a folder:

```
my-project/
  project.json     ← the whole content, plain JSON (indented, UTF-8)
  assets/          ← original media files referenced by project.json (images, video, audio…); may be empty or missing
```

`project.json` always starts with a header:

```json
{ "format": "dilin-studio/<editor>", "version": 1, "name": "…", … }
```

`<editor>` is one of `docs`, `sheets`, `slides`, `video`, `paint`. The rest of the fields belong to that editor and are described in its format file — **read it before writing anything**:

| editor | format description |
|---|---|
| docs | `src/studio/docs/FORMAT.md` |
| sheets | `src/studio/sheets/FORMAT.md` |
| slides | `src/studio/slides/FORMAT.md` |
| video | `src/studio/video/FORMAT.md` |
| paint | `src/studio/paint/FORMAT.md` |

The code that reads and writes the format is `src/studio/<editor>/format.ts` — when FORMAT.md leaves a question open, that file is the truth. Do not raise `version` above what `format.ts` writes; the editor refuses newer versions.

## 3. Make or edit a project

1. Create a working folder **outside** `src/` (for example `work/<name>/`) with `project.json` and, if needed, `assets/`.
2. If the user gave you a project file (`*.dilin-<editor>.zip`), unzip it there — it contains exactly `project.json` + `assets/`.
3. Write `project.json` following the editor's FORMAT.md. Keep the header. Asset file names: 1–200 characters, no `/` or `\`.
4. Optional — look at it yourself: run the local app (`start-linux` or `sh start-linux.sh`, `start-mac.command` or `start-windows.bat`; or `node tools/serve.mjs`), then open the link from step 4 below made with `--local`.

5. Optional — drive the open editor directly: the Node server (`node tools/serve.mjs`; the start files use it when Node is installed) also serves a local MCP at `http://localhost:41730/mcp` (prefer it over editing files: no folder path needed; the user connects Claude Code with `claude mcp add --transport http dilin-studio http://localhost:41730/mcp` and can add `"mcp__dilin-studio"` to `permissions.allow` so auto mode does not stop) (stdio clients: `node tools/mcp-stdio.mjs`). With the user's paint or video page open, use `studio_pages`, then `paint_list_commands` / `paint_run` / `paint_batch` / `paint_preview`, or `video_list_commands` / `video_run` (send `timeline.list` to read clip ids). Edits show on the user's screen at once, can be undone and are saved back to the project; a wrong command or parameter is refused with the reason. Voice-overs, web screenshots, sound effects and adding media files need the website.

   Docs, sheets and slides too: `docs_read` / `docs_edit` (`append`, or `old_text` + `new_text` that must occur once), `sheets_read` / `sheets_run` (ops like the website update_cells: `set`, `format`, `insert_rows`, `merge`, `sort`, `freeze`, `filter`, `validate` …), `slides_read` / `slides_run` (component and page operations: `component_update`, `component_frame`, `component_add`, `page_add` … with 0-based `pageIndex`). Each call saves and redraws the page (it reloads, so Ctrl+Z cannot undo these; `*_read` saves the page's pending edits first).
   `paint_export` takes out a layered PSD (`format: "psd"`), a layered Illustrator file (`format: "ai"`: shapes as paths, text editable), the same layered Photoshop file as a Large Document (`format: "psb"`), a layered OpenRaster file for Krita / GIMP / MyPaint (`format: "ora"`: text and shapes as pixels), a full-size PNG or the project files; with a project folder they are also saved next to `project.json`.
   Video without a browser: `node tools/video-cli.mjs check <project>` lists everything the editor would drop or change on load (run it after you edit project.json); `run <project> --steps <steps.json>` applies video commands (same as `video_run`) and writes project.json back; `export <project> --format fcpxml|premiere|jianying|capcut|edl|otio|srt|vtt|ass`; `subs <project> --file <subtitles.srt|vtt|ass>` adds the subtitles as a text track (for DaVinci: it skips audio-only EDL events and does not take ASS, so use otio/fcpxml and srt); `import <file.fcpxml|file.xml|file.edl|file.otio|draft_content.json|folder> [--out <new project folder>] [--media <media folder>]` turns a Final Cut / DaVinci / Premiere / Jianying (unencrypted) project into a new project folder, copying the media it can find. Needs `npm run build` first.
   On Windows PowerShell, put the steps in a steps.json file and pass `--steps` (PowerShell strips the quotes inside `--step '{...}'`).
  No browser window at all: `node tools/paint-cli.mjs run [--project <folder> | --open <file.psd|file.svg|file.pdf|file.ai>] --steps <steps.json> --out <file.psd|file.ai|file.png|folder/>` runs the same engine headless in the user's Chrome / Edge / Chromium (`commands --filter <text>` lists commands with their parameter specs; `serve` keeps a headless page open and serves the same MCP at `http://localhost:41731/mcp`).
6. Work in small steps while the user has the page open: save `project.json` (or send one `paint_run` / `video_run` call) after each small change, so the page changes step by step instead of being replaced all at once.
7. Video: when `project.json` is changed from outside while the video page is open and the page has no unsaved edits, the page swaps in the new content in place within about 2 seconds (no full page reload) and shows a short notice; this is one undo step, so Undo (Ctrl+Z) goes back to the previous version. If the new `project.json` cannot be read (for example invalid JSON), the page keeps what it shows and says why; write a fixed `project.json` and it is picked up. If the page has unsaved edits it asks the user first. `.m4a` audio must be AAC-encoded (`ffmpeg -i in.wav -c:a aac out.m4a`); browsers cannot decode ALAC — re-encode it or use mp3 / wav.
8. Paint shapes: coordinates are document pixels with the origin at the top left. Regular polygon: `shape.polygon {cx, cy, r1, points}` (`r1` = circumradius, also accepted as `radius`; `points` = number of sides, 3–1000, also accepted as `sides`, default 6). Star: `shape.star {cx, cy, r1, r2?, points}` (`r1` = outer radius, also accepted as `radius` or `radius1`; `r2` = inner radius, also accepted as `radius2`, optional, default half of `r1`; `points` = number of tips, 2–1000, default 5). A missing or non-numeric center or radius, or an invalid count, is refused with an error that names the parameter to give.

Do not edit anything under `src/studio/` or `public/`: those files must stay identical to the website so that the link opens the same editor the user sees online.

## 4. Hand back the result

Give the user **one link**. Two kinds:

**a) Small project, no assets** — the whole `project.json` travels inside the link (after `#`, so it is never sent to any server):

```
node tools/make-link.mjs work/<name>            # or: node tools/make-link.mjs work/<name>/project.json
```

It prints `https://dilinai.com/studio/<editor>#p=…`. Limit: 60 000 characters after `#p=` (roughly a 100–200 KB project.json). If it is too big, or the project has files in `assets/`, use (b).

**b) Project with assets, or larger** — zip the folder (`project.json` at the top of the zip, or inside one folder, plus `assets/`) and put the zip at a public **https** address that downloads the file directly, without login. Raw files of a public GitHub repository or a gist work (`https://raw.githubusercontent.com/…`, `https://gist.githubusercontent.com/…`; a `https://github.com/<owner>/<repo>/blob/…` address is converted automatically). Then:

```
node tools/make-link.mjs --url https://raw.githubusercontent.com/<owner>/<repo>/<branch>/<name>.dilin-<editor>.zip --app <editor>
```

It prints `https://dilinai.com/studio/<editor>?import=…`. A single `project.json` address works too. Limit: 50 MB. The page fetches it without cookies or credentials.

Without Node, build the link by hand: `#p=` is `base64url(deflate-raw(UTF-8 of JSON.stringify(project.json)))` without `=` padding; `?import=` is the URL-encoded https address.

Tell the user: opening the link saves the project in **their browser** as a new project and opens the editor; from there they can edit it, export it as a file, or move it into a folder on their computer.

## 5. Check before you hand it back

- `format` is `dilin-studio/<editor>` and matches the link's `<editor>`; `version` is a positive integer not above the one in `format.ts`.
- Every asset that `project.json` references exists in `assets/`.
- Open the link yourself with `--local` if you can run a browser.

## 6. Rebuilding the app (only if you changed the shell)

```
npm install
npm run build      # → app/
```

`studio-oss.json` lists the source commit, the versions and a hash of every file; the website repository checks this repository against it — one changed byte in `src/studio/` fails the check.

## 7. Stable interfaces (for an AI that operates the page)

The same editor code runs on https://dilinai.com/studio and in the local copy. If you operate the page directly (for example through a browser extension that can click, type or run script in the page), rely only on the interfaces below; they are kept across versions, and changes to them are announced in the release notes.

**Stable — rely on these:**

- **The project format**: `project.json` + `assets/` as described in each editor's FORMAT.md (section 2), with the `format` / `version` header.
- **Where the page keeps a project.** The page address is `/studio/<editor>/<project id>` (`<project id>` = 32 lowercase hex characters). The project is stored in the page origin's OPFS (`navigator.storage.getDirectory()`) at `dilin-studio/<editor>/<project id>/project.json` and `dilin-studio/<editor>/<project id>/assets/<file name>`. If the user picked a folder ("Choose where to save the project", desktop Chrome / Edge), the same two entries live in that folder instead. A script running in the page origin may read and write these files: copy media into `assets/` first, then write the whole `project.json` in one go (`createWritable()` … `close()`).
- **How the page follows outside changes.** The page checks `project.json`'s modification time every 1.5 seconds. Without unsaved edits it loads the new version (paint replaces the drawing in place; video swaps the content in place as one undo step, and keeps the current content with a notice if the new file cannot be read; the other editors reload); with unsaved edits it asks the user. While the page has unsaved edits, its autosave does not overwrite an outside change.
- **The page's own controls**, used like a person would: for example the video editor's **Import** for media, and "Download to computer" / export project file to get the project out.
- **Links**: `#p=` and `?import=` (section 4), and the short-link endpoints under `/api/studio-share` (section 0).
- **Local copy only**: the local MCP at `http://localhost:41730/mcp` (`studio_pages`, `paint_*`, `video_*`, `docs_*`, `sheets_*`, `slides_*`), the command names and parameters they list (`paint_list_commands`, `video_list_commands`), and the command-line tools `tools/video-cli.mjs`, `tools/paint-cli.mjs`, `tools/make-link.mjs`.
- **Paint's load report** `project.check.json`, written next to `project.json` after each load (what could not be drawn or read).

**Internal — do not rely on these** (they can change in any version without notice):

- The paint engine objects inside the paint page's iframe (`window.__dlSite` with `CMD`, `UI`, `Project`, `History`, `Tabs`, `spec` …, and `window.__dlCmdSpec`). To run paint commands, use the local MCP or `tools/paint-cli.mjs`, or the page's own controls.
- The video, docs, sheets and slides pages expose no script API; their React state, DOM structure, CSS classes and `data-testid` attributes are internal.
- Other browser storage: the IndexedDB database `dilin-studio` (the project list), the OPFS folder `dilin-video-edit/` (video previews and waveforms, rebuilt when missing), `localStorage` keys, and the temporary file `.project.json.tmp`.
- The local server's `/_agent/*` endpoints (the channel between the page and the local MCP).

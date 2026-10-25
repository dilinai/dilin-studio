// 本机 MCP（给 AI 用）：AI 经 MCP 下命令 → 这里排给开着的那页（画板／剪辑）→ 页面用跟网站同一套引擎跑 → 结果原路交回 AI。
//   AI 那头：POST /mcp（MCP Streamable HTTP·一问一答 JSON·不开 SSE）；只吃 stdio 的 AI 用 tools/mcp-stdio.mjs 转过来。
//   页面那头：GET /_agent/hello 探有没有这个服务 → GET /_agent/poll 长轮询取活 → POST /_agent/reply 交回 → POST /_agent/leave 关页。
//   只认本机：Host 要是 localhost／127.0.0.1／[::1] 这个埠（挡 DNS 重绑）；浏览器别的网站来的（Origin 不是本机这个埠、Sec-Fetch-Site 不是同源）一律 403。
//   命令在页面里跑（画面上看得到、进 Ctrl+Z、照常自动存回工程夹）；页面没开 ⇒ 当场说要开哪一页，⛔ 傻等。
// 零依赖（node 内建）·serve.mjs 载入

import { randomUUID } from 'node:crypto'

export const POLL_MS = 25_000          // 页面一次长轮询最多挂多久
export const PAGE_TTL_MS = 8_000       // 开着的页一直挂着一发长轮询；没挂着又这么久没来取 ⇒ 当这页关了（关页没送出 leave 也认得出）
export const JOB_MS = 90_000           // 一件活等页面回多久
export const BODY_MAX = 40 * 1024 * 1024
export const STEPS_MAX = 80
const EDITORS = new Set(['paint', 'video', 'docs', 'sheets', 'slides'])
const TEXT_MAX = 120_000
const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05']

const pageProp = { type: 'string', description: 'Which open page to use (an id or project id from studio_pages). Omit = the open page of that editor the user looked at last.' }
const stepsProp = (what) => ({ type: 'array', maxItems: STEPS_MAX, description: `${what} (max ${STEPS_MAX}).`, items: { type: 'object', properties: { command: { type: 'string' }, params: { type: 'object', additionalProperties: true } }, required: ['command'], additionalProperties: false } })

export const TOOLS = [
  {
    name: 'studio_pages',
    description: 'List the Dilin Studio editor pages open in the browser right now (editor, project id, title). Read-only. The other tools act on one of these pages; if none is open, ask the user to open the editor first.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'paint_list_commands',
    description: 'List the commands the open paint editor understands: each with its parameter notes, a spec (name, optional, type, min/max, default, choices), strict (unknown parameters are refused), whether it can be undone and whether it can run right now (available / disabledReason). Read-only. filter searches ids, names and notes (e.g. "layer.", "text", "blur").',
    inputSchema: { type: 'object', properties: { filter: { type: 'string', description: 'Text to search command ids, names and parameter notes. Omit = all (long).' }, page: pageProp }, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'paint_run',
    description: 'Run one command in the open paint editor (layers, shapes, text, selections, filters...). It shows on the user\'s screen at once, goes into the undo history (Ctrl+Z) and is saved back to the project folder like any edit. A wrong command name or parameter is refused before anything runs, with the reason (e.g. "unknown parameter \'fontSize\' ... did you mean \'size\'?"). A result with "warnings" ran, but a parameter you passed may have been ignored.',
    inputSchema: { type: 'object', properties: { command: { type: 'string', description: 'Command id, e.g. layer.newText (see paint_list_commands)' }, params: { type: 'object', additionalProperties: true, description: 'Command parameters' }, page: pageProp }, required: ['command'], additionalProperties: false },
  },
  {
    name: 'paint_batch',
    description: 'Run several paint commands in order in one call; stops at the first one that fails and tells you which (done = how many ran). Each undoable step is its own Ctrl+Z.',
    inputSchema: { type: 'object', properties: { steps: stepsProp('Commands to run in order'), page: pageProp }, required: ['steps'], additionalProperties: false },
  },
  {
    name: 'paint_preview',
    description: 'Look at the open paint editor: returns a picture of the whole document plus its structure (size, layers top→bottom with id, kind, name, visibility, opacity, position). Read-only. Use it after drawing to check the result.',
    inputSchema: { type: 'object', properties: { max_size: { type: 'integer', minimum: 200, maximum: 2000, description: 'Longest side of the picture in px (default 1024)' }, page: pageProp }, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'paint_export',
    description: 'Take a file out of the open paint editor: "psb" = the same layered Photoshop file in the Large Document Format; "ora" = layered OpenRaster for Krita / GIMP / MyPaint (groups, opacity, blend modes; text and shapes as pixels); "psd" = layered Photoshop file (groups, masks, clipping, blend modes and opacity kept; text layers stay editable text, plain vector layers become shape layers, drop shadow / glow / stroke / color overlay stay layer styles; anything else is written as pixels), "ai" = layered Illustrator file (PDF-compatible; one layer per layer, vector shapes as real paths, text as editable text, everything else as a picture; `notes` lists what was written as a picture), "png" = the flattened picture at full size, "project" = project.json + assets/. psd / ai / png are also saved next to project.json when the project is kept in a folder (project.psd, project.ai, export.png). The file comes back as an embedded resource.',
    inputSchema: { type: 'object', properties: { format: { type: 'string', enum: ['psd', 'psb', 'ai', 'ora', 'png', 'project'], description: 'Default psd' }, save: { type: 'boolean', description: 'Also save into the project folder (default true)' }, page: pageProp }, additionalProperties: false },
  },
  {
    name: 'video_list_commands',
    description: 'List the commands the open video editor understands, each with its parameters (type, range, allowed values) and when it is refused. Read-only. media.list and timeline.list are read-only steps you can send with video_run to get clip ids and times.',
    inputSchema: { type: 'object', properties: { filter: { type: 'string', description: 'Text to search command ids and descriptions (e.g. "clip.", "text", "transition")' }, page: pageProp }, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'video_run',
    description: 'Edit the project open in the video editor with numbered commands (clip.add, clip.split, text.add, ...). All steps apply together or not at all; the change shows on the timeline at once as one undo step and is saved back to the project folder. "$<n>" in an id param = the id made by step n of this batch. Steps that need the website (media.tts, media.webShot, sfx.add) and adding media files are not available here — import files in the editor, then use media.list.',
    inputSchema: { type: 'object', properties: { steps: stepsProp('Commands to run in order: [{command, params}]'), page: pageProp }, required: ['steps'], additionalProperties: false },
  },
  {
    name: 'docs_read',
    description: 'Read the doc open in the docs editor: its markdown text (paged by offset / limit characters), name and how many free-placed layers it has. Read-only.',
    inputSchema: { type: 'object', properties: { offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 200000 }, page: pageProp }, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'docs_edit',
    description: 'Change the doc open in the docs editor with small edits, all or none (same rules as the website edit_doc): {"append": "<markdown>"} adds at the end; {"old_text": "<exact passage, must occur once>", "new_text": "<replacement, empty deletes>"}; {"name": "<new title>"}. The page saves and redraws right away, so send one or two edits per call to let the user watch each step.',
    inputSchema: { type: 'object', properties: { edits: { type: 'array', minItems: 1, maxItems: 50, items: { type: 'object', additionalProperties: true } }, page: pageProp }, required: ['edits'], additionalProperties: false },
  },
  {
    name: 'sheets_read',
    description: 'Read the spreadsheet open in the sheets editor: its tabs, and cells of one tab by A1 range (input = raw text or formula, value = computed, display = as shown, format). Same reading as the website get_sheet. Read-only.',
    inputSchema: { type: 'object', properties: { sheet: { type: 'string', description: 'Tab name or id (default: the first tab)' }, range: { type: 'string', description: 'A1 range, e.g. A1:D20 (default: the used area)' }, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 2000 }, include_formats: { type: 'boolean' }, page: pageProp }, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'sheets_run',
    description: 'Change one tab of the open spreadsheet with ops, all or none — the same engine as the website update_cells / format_cells / insert_rows / merge_cells / sort_range / set_chart / set_freeze / set_filter / set_validation. Each op is {op, …}: {"op":"set","range":"A1","values":[["Item","Qty"],["Apple",3]]} (a string starting with = is a formula); {"op":"format","range":"A1:B1","style":{"bold":true,"bg":"#fff3bf"}}; insert_rows {at,count}; delete_rows; insert_cols {at:"C"}; delete_cols; merge / unmerge {range}; sort {range,by:[{column,descending}],has_header}; resize {range,width|height}; set_chart / delete_chart; cond_format; freeze {rows,cols}; filter; validate. Pictures (add_image) need the website. The page saves and redraws right away.',
    inputSchema: { type: 'object', properties: { sheet: { type: 'string', description: 'Tab name or id (default: the first tab)' }, ops: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'object', additionalProperties: true } }, page: pageProp }, required: ['ops'], additionalProperties: false },
  },
  {
    name: 'slides_read',
    description: 'Read the deck open in the slides editor: the page list (page, page_index, page_id, kind, layout, component count) and, with page (1-based), that page\'s components (id, type, frame {x,y,w,h,rotate}, z, text, style…), animations and the layouts it can switch to. Canvas 1000×562.5 logical px, origin top-left. Read-only.',
    inputSchema: { type: 'object', properties: { page: { type: 'integer', minimum: 1, description: 'Page number (1-based) to list components of' }, editor_page: pageProp }, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'slides_run',
    description: 'Change the open deck with operations, all or none — the same engine as the website slides_add_component / slides_update_component / slides_set_component_frame / slides_add_page / slides_set_page. Each op is {kind, …} with 0-based pageIndex: {"kind":"component_update","componentId":"<id>","patch":{"text":"New title"}} (patch keys are the component fields slides_read shows, e.g. text, box, fill, src); {"kind":"component_frame","componentId":"<id>","frame":{"x":80,"y":60,"w":400,"h":80},"z":"top"}; {"kind":"component_add","pageIndex":0,"component":{"type":"text","text":"Hi","frame":{"x":100,"y":100,"w":300,"h":60}}}; component_delete / component_order / component_group / component_ungroup; animation_set {componentId, enter:{effect:"fade"}}; page_add {afterIndex, pageKind:"blank"|"content"|"transition"|"duplicate"}; page_update {pageIndex, patch:{background|transition}}; page_move {pageIndex,to}; page_set_layout {pageIndex,layoutId}. The page saves and redraws right away.',
    inputSchema: { type: 'object', properties: { ops: { type: 'array', minItems: 1, maxItems: 80, items: { type: 'object', additionalProperties: true } }, page: pageProp }, required: ['ops'], additionalProperties: false },
  },
]

const INSTRUCTIONS = 'Dilin Studio running on this computer. These tools act on an editor page the user has open in the browser (paint, video, docs, sheets or slides): changes show on screen at once and are saved back to the project folder. Paint and video changes can be undone with Ctrl+Z; docs, sheets and slides reload the page after each change, so Ctrl+Z cannot undo those — read first and change in small steps. Start with studio_pages. Paint: paint_list_commands → paint_run / paint_batch → paint_preview to check → paint_export for a layered PSD / PNG. Video: video_list_commands, video_run with timeline.list to read ids. Docs: docs_read → docs_edit. Sheets: sheets_read → sheets_run. Slides: slides_read → slides_run. If no page is open, ask the user to open that editor.'

export function createAgentHub(o = {}) {
  const port = o.port ?? 41730
  const version = o.version ?? '0'
  const now = o.now ?? (() => Date.now())
  const pages = new Map()      // id → { id, editor, project, title, vis, since, seen, waiting, queue }
  const pending = new Map()    // job id → { page, resolve, timer }
  const origins = new Set([`http://localhost:${port}`, `http://127.0.0.1:${port}`, `http://[::1]:${port}`])
  const hosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`])

  const ttl = o.pageTtlMs ?? PAGE_TTL_MS
  const busy = (p) => { for (const j of pending.values()) if (j.page === p.id) return true; return false }   // 手上有活在跑（大图预览可能跑好几秒）也算开着
  const alive = (p) => !!p.waiting || busy(p) || now() - p.seen < ttl
  function sweep() {
    for (const [id, p] of pages) if (!alive(p)) drop(id, 'the editor page was closed')
  }
  function drop(id, why) {
    const p = pages.get(id)
    if (!p) return
    pages.delete(id)
    if (p.waiting) { try { p.waiting.writeHead(204).end() } catch { /* 已断 */ } }
    for (const [jid, j] of pending) if (j.page === id) { clearTimeout(j.timer); pending.delete(jid); j.resolve({ ok: false, error: 'page_closed', message: why }) }
  }
  const listPages = () => { sweep(); return [...pages.values()].map((p) => ({ page: p.id, editor: p.editor, project: p.project || null, title: p.title || null, visible: p.vis === 'visible' })) }
  function pick(editor, sel) {
    sweep()
    const all = [...pages.values()].filter((p) => p.editor === editor)
    if (sel) return all.find((p) => p.id === sel || p.project === sel) || null
    all.sort((a, b) => (b.vis === 'visible') - (a.vis === 'visible') || b.focusAt - a.focusAt || b.since - a.since)
    return all[0] || null
  }
  /** 把一件活排给那页、等它回 */
  function dispatch(p, job, ms = JOB_MS) {
    const id = randomUUID()
    return new Promise((resolve) => {
      const timer = setTimeout(() => { pending.delete(id); p.queue = p.queue.filter((j) => j.id !== id); resolve({ ok: false, error: 'timeout', message: 'the editor page did not answer in time — ask the user to bring the tab to the front; the step may already have run, look before repeating it' }) }, ms)
      pending.set(id, { page: p.id, resolve, timer })
      p.queue.push({ ...job, id })
      if (p.waiting) { const res = p.waiting; p.waiting = null; sendJob(p, res) }
    })
  }
  function sendJob(p, res) {
    const job = p.queue.shift()
    const body = JSON.stringify(job)
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }).end(body)
  }

  // ── 安全：只认本机这个埠、只认同源的页面 ──
  function hostOk(req) { return hosts.has(String(req.headers.host || '').toLowerCase()) }
  function originOk(req) { const o = req.headers.origin; return o === undefined || origins.has(String(o).toLowerCase()) }
  function sameSite(req) { const s = req.headers['sec-fetch-site']; return s === undefined || s === 'same-origin' || s === 'none' }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let n = 0
      const chunks = []
      req.on('data', (c) => { n += c.length; if (n > BODY_MAX) { reject(Object.assign(new Error('too large'), { status: 413 })); req.destroy() } else chunks.push(c) })
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      req.on('error', reject)
    })
  }
  const send = (res, status, obj, extra = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra })
    res.end(obj === undefined ? '' : JSON.stringify(obj))
  }

  // ── 页面那头 ──
  function poll(req, res, q) {
    const id = q.get('page')
    const editor = q.get('editor')
    if (!id || !/^[\w-]{8,64}$/.test(id) || !EDITORS.has(editor)) return send(res, 400, { error: 'bad_poll' })
    let p = pages.get(id)
    if (!p) { p = { id, editor, since: now(), focusAt: 0, queue: [], waiting: null }; pages.set(id, p) }
    p.editor = editor
    p.project = (q.get('project') || '').slice(0, 200)
    p.title = (q.get('title') || '').slice(0, 200)
    p.vis = q.get('vis') === 'visible' ? 'visible' : 'hidden'
    if (q.get('focus') === '1') p.focusAt = now()
    p.seen = now()
    if (p.waiting) { try { p.waiting.writeHead(204).end() } catch { /* 已断 */ } p.waiting = null }
    if (p.queue.length) return sendJob(p, res)
    p.waiting = res
    const t = setTimeout(() => { if (p.waiting === res) { p.waiting = null; p.seen = now(); res.writeHead(204).end() } }, o.pollMs ?? POLL_MS)
    res.on('close', () => { clearTimeout(t); if (p.waiting === res) { p.waiting = null; p.seen = now() } })
  }
  async function reply(req, res) {
    let j
    try { j = JSON.parse(await readBody(req)) } catch (e) { return send(res, e.status || 400, { error: 'bad_reply' }) }
    const w = pending.get(j && j.id)
    if (!w || w.page !== j.page) return send(res, 404, { error: 'no_such_job' })
    clearTimeout(w.timer)
    pending.delete(j.id)
    const p = pages.get(j.page)
    if (p) p.seen = now()
    const r = j.reply && typeof j.reply === 'object' ? j.reply : { ok: false, error: 'bad_reply' }
    w.resolve(r)
    send(res, 200, { ok: true })
  }
  async function leave(req, res) {
    let j = {}
    try { j = JSON.parse(await readBody(req) || '{}') } catch { /* 照关 */ }
    if (j && typeof j.page === 'string') drop(j.page, 'the editor page was closed')
    send(res, 200, { ok: true })
  }

  // ── AI 那头（MCP）──
  const text = (s, isError = false) => ({ content: [{ type: 'text', text: s.length > TEXT_MAX ? `${s.slice(0, TEXT_MAX)}\n… (cut at ${TEXT_MAX} characters — narrow it, e.g. with filter)` : s }], ...(isError ? { isError: true } : {}) })
  const json = (v) => JSON.stringify(v, null, 1)
  const appUrl = (editor) => `http://localhost:${port}/index.html?app=${editor}`
  const noPage = (editor, sel) => text(sel
    ? `No open ${editor} page matches "${sel}". Open pages: ${json(listPages())}`
    : `No ${editor} editor is open. Ask the user to open ${appUrl(editor)} in the browser (choose or make a project) and keep that tab open, then try again.`, true)
  const failText = (r) => {
    if (r.error === 'bad_params') return `Nothing ran: ${r.message}`
    return `${r.error}${r.message ? `: ${r.message}` : ''}`
  }

  async function call(name, a = {}) {
    if (name === 'studio_pages') {
      const L = listPages()
      return text(L.length ? json(L) : `No editor page is open. Ask the user to open ${appUrl('paint')} or ${appUrl('video')} in the browser.`)
    }
    const editor = (/^(paint|video|docs|sheets|slides)_/.exec(name) || [])[1] || null
    if (!editor) return text(`unknown tool ${name}`, true)
    // slides_read 的 page 是页码 ⇒ 挑哪个分页改用 editor_page
    const selRaw = name === 'slides_read' ? a.editor_page : a.page
    const sel = typeof selRaw === 'string' && selRaw.trim() ? selRaw.trim() : null
    const p = pick(editor, sel)
    if (!p) return noPage(editor, sel)
    let job
    if (name === 'paint_list_commands' || name === 'video_list_commands') job = { kind: 'list', ...(typeof a.filter === 'string' && a.filter.trim() ? { filter: a.filter.trim().slice(0, 80) } : {}) }
    else if (name === 'paint_run') {
      if (typeof a.command !== 'string' || !a.command.trim()) return text('command is required (see paint_list_commands)', true)
      if (a.params !== undefined && (a.params === null || typeof a.params !== 'object' || Array.isArray(a.params))) return text('params must be an object', true)
      job = { kind: 'run', command: a.command.trim(), params: a.params || {} }
    } else if (name === 'paint_batch' || name === 'video_run') {
      const s = a.steps
      if (!Array.isArray(s) || !s.length || s.length > STEPS_MAX) return text(`steps must be an array of 1–${STEPS_MAX} {command, params} (got ${Array.isArray(s) ? s.length : typeof s})`, true)
      const bad = s.findIndex((x) => !x || typeof x !== 'object' || typeof x.command !== 'string' || (x.params !== undefined && (x.params === null || typeof x.params !== 'object' || Array.isArray(x.params))))
      if (bad >= 0) return text(`step ${bad} must be {command: string, params?: object}`, true)
      job = name === 'paint_batch' ? { kind: 'batch', steps: s } : { kind: 'run', steps: s }
    } else if (name === 'paint_export') {
      const f = typeof a.format === 'string' ? a.format : 'psd'
      if (!['psd', 'ai', 'png', 'project'].includes(f)) return text('format must be psd, ai, png or project', true)
      job = { kind: 'export', format: f, save: a.save !== false }
    } else if (editor === 'docs' || editor === 'sheets' || editor === 'slides') {
      const { page: _p, editor_page: _e, ...rest } = a
      if (name === 'slides_read' && a.page !== undefined) rest.page = a.page
      job = { kind: name.endsWith('_read') ? 'read' : name === 'docs_edit' ? 'edit' : 'run', ...rest }
    } else if (name === 'paint_preview') {
      const m = Number.isInteger(a.max_size) ? Math.min(2000, Math.max(200, a.max_size)) : 1024
      job = { kind: 'preview', maxSize: m }
    } else return text(`unknown tool ${name}`, true)
    const r = await dispatch(p, job)
    if (!r.ok) return text(failText(r), true)
    if (name === 'paint_preview') {
      const res = r.result || {}
      const m = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/s.exec(typeof res.dataURL === 'string' ? res.dataURL : '')
      const info = text(json({ project: p.project || null, preview: { width: res.width, height: res.height }, document: res.inspect ?? null })).content
      return { content: m ? [{ type: 'image', data: m[2], mimeType: m[1] }, ...info] : [...info, { type: 'text', text: '(no picture came back)' }] }
    }
    if (name === 'paint_export') {
      const res = r.result || {}
      const files = Array.isArray(res.files) ? res.files : []
      const saved = Array.isArray(res.saved) ? res.saved : []
      return { content: [
        { type: 'text', text: json({ files: files.map((f) => ({ name: f.name, bytes: f.bytes, mime: f.mime })), savedToProjectFolder: saved, ...(Array.isArray(res.notes) && res.notes.length ? { notes: res.notes } : {}) }) },
        ...files.map((f) => ({ type: 'resource', resource: { uri: `dilin-studio://${p.project || 'project'}/${f.name}`, mimeType: f.mime, blob: f.base64 } })),
      ] }
    }
    if (name === 'paint_batch' && r.result && r.result.error) return text(json(r.result), true)
    return text(json(r.result ?? null))
  }

  async function rpc(m) {
    if (!m || typeof m !== 'object' || m.jsonrpc !== '2.0' || typeof m.method !== 'string') return { jsonrpc: '2.0', id: m && m.id !== undefined ? m.id : null, error: { code: -32600, message: 'Invalid Request' } }
    const isNote = m.id === undefined
    const ok = (result) => (isNote ? null : { jsonrpc: '2.0', id: m.id, result })
    const err = (code, message) => (isNote ? null : { jsonrpc: '2.0', id: m.id, error: { code, message } })
    switch (m.method) {
      case 'initialize': {
        const want = m.params && m.params.protocolVersion
        return ok({ protocolVersion: PROTOCOLS.includes(want) ? want : PROTOCOLS[0], capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'dilin-studio', version }, instructions: INSTRUCTIONS })
      }
      case 'ping': return ok({})
      case 'tools/list': return ok({ tools: TOOLS })
      case 'tools/call': {
        const n = m.params && m.params.name
        if (!TOOLS.some((t) => t.name === n)) return err(-32602, `unknown tool: ${n}`)
        try { return ok(await call(n, (m.params && m.params.arguments) || {})) } catch (e) { return ok(text(`failed: ${e && e.message ? e.message : e}`, true)) }
      }
      default:
        if (m.method.startsWith('notifications/')) return null
        return err(-32601, `method not found: ${m.method}`)
    }
  }
  async function mcp(req, res) {
    if (req.method !== 'POST') return send(res, 405, { error: 'POST JSON-RPC messages to /mcp (this server does not open an SSE stream)' }, { Allow: 'POST' })
    let body
    try { body = JSON.parse(await readBody(req)) } catch (e) { return send(res, e.status || 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) }
    if (Array.isArray(body)) {
      const out = (await Promise.all(body.map(rpc))).filter(Boolean)
      return out.length ? send(res, 200, out) : send(res, 202)
    }
    const r = await rpc(body)
    return r ? send(res, 200, r) : send(res, 202)
  }

  // 命令列版（tools/paint-cli.mjs）：一件活直接交给指名的那页（它自己开的无头页）·回页面原样的回包
  async function cli(req, res) {
    let j
    try { j = JSON.parse(await readBody(req)) } catch (e) { return send(res, e.status || 400, { error: 'bad_json' }) }
    const p = j && typeof j.page === 'string' ? [...pages.values()].find((x) => x.project === j.page || x.id === j.page) : pick(j && j.editor === 'video' ? 'video' : 'paint', null)
    if (!p) return send(res, 404, { ok: false, error: 'no_page', pages: listPages() })
    if (!j.job || typeof j.job !== 'object' || typeof j.job.kind !== 'string') return send(res, 400, { error: 'bad_job' })
    const { id: _drop, ...job } = j.job
    send(res, 200, await dispatch(p, job, Number.isFinite(j.timeoutMs) ? Math.min(600_000, Math.max(1000, j.timeoutMs)) : JOB_MS))
  }

  /** serve.mjs 每个请求先问它：是这里的口就处理、回 true */
  async function handle(req, res) {
    const url = new URL(req.url || '/', 'http://x')
    const path = url.pathname
    if (path !== '/mcp' && !path.startsWith('/_agent/')) return false
    if (!hostOk(req) || !originOk(req) || !sameSite(req)) { send(res, 403, { error: 'only this computer\'s Dilin Studio pages and local AI tools may use this' }); return true }
    if (path === '/mcp') { await mcp(req, res); return true }
    if (path === '/_agent/cli' && req.method === 'POST') { await cli(req, res); return true }
    if (path === '/_agent/hello' && req.method === 'GET') { send(res, 200, { name: 'dilin-studio-agent', v: 1, version }); return true }
    if (path === '/_agent/poll' && req.method === 'GET') { poll(req, res, url.searchParams); return true }
    if (path === '/_agent/reply' && req.method === 'POST') { await reply(req, res); return true }
    if (path === '/_agent/leave' && req.method === 'POST') { await leave(req, res); return true }
    send(res, 404, { error: 'not found' })
    return true
  }
  return { handle, rpc, call, listPages, _pages: pages }
}

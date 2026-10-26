// Dilin Studio · 简报命令列版的核心（tools/slides-cli.mjs 用；tools/build.mjs 另打成 app/slides-cli-core.mjs·node 跑）。
//   读档检查（同 format.slidesDocFromJson：开档时会丢掉、改成空白页的每一条）、命令表、跑操作（同本机 MCP slides_run＝agent-job.pure：
//   parseComponentOp＋applyComponentOp，网站 slides_add_component／slides_update_component／slides_add_page… 同一套）都是纯函数 ⇒ 不用开浏览器。
//   网页版（html）、PowerPoint（pptx）要浏览器排版量字、烤图 ⇒ 命令列借无头浏览器开同一套页面做（页面那边见 cli-export.ts）。
import { checkProjectHeader, formatTag } from '../shared/project-file'
import { SLIDES_FORMAT_VERSION, slidesDocFromJson, slidesDocToJson, type SlidesDoc } from './format'
import { assetNamesInDeck } from './assets'
import { slidesAgentJob, SLIDES_OPS_MAX } from './agent-job.pure'

export type CliIssue = { code: string; text: string }

const NEG = (k: string) => typeof process !== 'undefined' && process.env?.DILIN_NEG === k

/** 读 project.json（字串或物件）⇒ doc＋读档报告＋引用到的素材档名；表头或 deck 坏到编辑页开不了 ⇒ 丢错 */
export function cliLoad(raw: unknown): { doc: SlidesDoc; issues: CliIssue[]; assets: string[] } {
  const j = checkProjectHeader(typeof raw === 'string' ? JSON.parse(raw) : raw, 'slides', SLIDES_FORMAT_VERSION)
  const doc = slidesDocFromJson(j)
  const issues = NEG('slides-cli-check-blind') ? [] : (doc.loadIssues ?? []).map((text) => ({ code: /→ blank page/.test(text) ? 'page_to_blank' : /dropped/.test(text) ? 'dropped' : 'changed', text }))
  const { loadIssues: _l, ...clean } = doc
  void _l
  return { doc: clean, issues, assets: assetNamesInDeck(clean.deck) }
}

/** doc ⇒ project.json 全文（表头在前·跟编辑页存的一样） */
export function cliSave(doc: SlidesDoc): string {
  return JSON.stringify({ format: formatTag('slides'), version: SLIDES_FORMAT_VERSION, ...slidesDocToJson(doc) }, null, 2) + '\n'
}

const P = (name: string, type: string, description: string, required = true) => ({ name, type, required, description })
const PAGE = P('pageIndex', 'integer', '第幾頁（從 0 起算）')
/** 命令表：run --steps 的每一步（{kind, …}·同本机 MCP slides_run 的 ops） */
export const CLI_COMMANDS = [
  { id: 'component_add', description: '在某頁加一個元件（text／image／video／shape／table／chart／program／group·欄位見 FORMAT.md）', params: [PAGE, P('component', 'object', '元件：{type, frame:{x,y,w,h}, …}；id 可省（自動給）'), P('z', '"top"|"bottom"|"up"|"down"|integer', '疊放位置', false), P('parentId', 'string', '加進哪個組合', false)], example: { kind: 'component_add', pageIndex: 0, component: { type: 'text', text: '標題', frame: { x: 80, y: 60, w: 840, h: 90 } } } },
  { id: 'component_update', description: '改元件欄位（text、box、fill、src…·read 看得到的那些）', params: [P('componentId', 'string', '元件 id'), P('patch', 'object', '要改的欄位')], example: { kind: 'component_update', componentId: 'c_title', patch: { text: '新標題' } } },
  { id: 'component_frame', description: '移動／縮放／旋轉元件（畫布 1000×562.5）', params: [P('componentId', 'string', '元件 id'), P('frame', 'object', '{x,y,w,h,rotate} 給哪幾個改哪幾個'), P('z', '"top"|"bottom"|"up"|"down"|integer', '順便改疊放', false)], example: { kind: 'component_frame', componentId: 'c_title', frame: { x: 80, y: 40 } } },
  { id: 'component_order', description: '改疊放順序', params: [P('componentId', 'string', '元件 id'), P('z', '"top"|"bottom"|"up"|"down"|integer', '移到哪')], example: { kind: 'component_order', componentId: 'c_title', z: 'top' } },
  { id: 'component_delete', description: '刪元件', params: [P('componentId', 'string', '元件 id')], example: { kind: 'component_delete', componentId: 'c_old' } },
  { id: 'component_group', description: '把同一頁的幾個元件組起來', params: [P('componentIds', 'string[]', '2 個以上元件 id'), P('groupId', 'string', '組合的 id', false)], example: { kind: 'component_group', componentIds: ['a', 'b'] } },
  { id: 'component_ungroup', description: '拆開組合', params: [P('componentId', 'string', '組合 id')], example: { kind: 'component_ungroup', componentId: 'g1' } },
  { id: 'animation_set', description: '設元件的進場／強調／離場動畫（null＝拿掉）', params: [P('componentId', 'string', '元件 id'), P('enter', 'object|null', '{effect, trigger?, durationMs?, delayMs?, direction?}', false), P('emphasis', 'object|null', '同上', false), P('exit', 'object|null', '同上', false)], example: { kind: 'animation_set', componentId: 'c_title', enter: { effect: 'fade' } } },
  { id: 'animation_order', description: '排一頁的動畫順序', params: [PAGE, P('order', 'array', '動畫 id，或 {componentId, phase, index?}')], example: { kind: 'animation_order', pageIndex: 0, order: ['a1', 'a2'] } },
  { id: 'page_add', description: '加一頁', params: [P('afterIndex', 'integer', '加在第幾頁後面（-1＝最前面）'), P('pageKind', '"blank"|"content"|"transition"|"duplicate"', '哪種頁'), P('sourceIndex', 'integer', 'duplicate 時複製哪一頁', false), P('layoutId', 'string', '版式', false)], example: { kind: 'page_add', afterIndex: 0, pageKind: 'blank' } },
  { id: 'page_update', description: '改頁的背景或切換效果', params: [PAGE, P('patch', 'object', '{background:{color|imageUrl}} 或 {transition:{type,durationMs}}')], example: { kind: 'page_update', pageIndex: 0, patch: { background: { color: '#FFF7D6' } } } },
  { id: 'page_move', description: '移動頁', params: [PAGE, P('to', 'integer', '移到第幾頁（從 0 起算）')], example: { kind: 'page_move', pageIndex: 2, to: 0 } },
  { id: 'page_set_layout', description: '換版式（read --page 列得出這頁可用的版式）', params: [PAGE, P('layoutId', 'string', '版式')], example: { kind: 'page_set_layout', pageIndex: 1, layoutId: 'content-split' } },
  { id: 'page_restore_layout', description: '回到版式自動排版（丟掉這頁手排的元件）', params: [PAGE], example: { kind: 'page_restore_layout', pageIndex: 1 } },
  { id: 'transition_all', description: '每一頁都套同一個切換效果（null＝全拿掉）', params: [PAGE, P('transition', 'object|null', '{type: none|fade|push|wipe|zoom|morph, durationMs}')], example: { kind: 'transition_all', pageIndex: 0, transition: { type: 'fade', durationMs: 600 } } },
  { id: 'toc_rebuild', description: '目錄頁照現在的章節重排', params: [PAGE], example: { kind: 'toc_rebuild', pageIndex: 1 } },
] as const

export function cliCommands(filter?: string) {
  const f = (filter ?? '').trim().toLowerCase()
  return f ? CLI_COMMANDS.filter((c) => c.id.includes(f) || c.description.toLowerCase().includes(f) || c.params.some((p) => p.name.toLowerCase().includes(f))) : [...CLI_COMMANDS]
}

/** 跑一批操作（全有或全无·最多 SLIDES_OPS_MAX 步）⇒ 新 doc＋每步结果 */
export function cliRun(doc: SlidesDoc, steps: unknown[]): { ok: true; doc: SlidesDoc; changed: boolean; results: unknown[] } | { ok: false; error: string } {
  if (!Array.isArray(steps) || !steps.length) return { ok: false, error: '要給至少一步' }
  if (NEG('slides-cli-run-partial')) {
    let cur = doc
    for (const s of steps) { const r = slidesAgentJob(cur, { kind: 'run', ops: [s] }); if (r.next) cur = r.next }
    return { ok: true, doc: cur, changed: cur !== doc, results: [] }
  }
  if (steps.length > SLIDES_OPS_MAX) return { ok: false, error: `一次最多 ${SLIDES_OPS_MAX} 步（分幾次跑）` }
  const r = slidesAgentJob(doc, { kind: 'run', ops: steps })
  if (!r.reply.ok) return { ok: false, error: r.reply.message ?? r.reply.error }
  const res = r.reply.result as { changed: boolean; results: unknown[] }
  if (!r.next) return { ok: true, doc, changed: false, results: res.results }
  // 写回前再过一次读档（同编辑页开档）：操作做出编辑页会丢掉的东西 ⇒ 当错、什么都不写
  const back = slidesDocFromJson(JSON.parse(cliSave(r.next)))
  if (back.loadIssues?.length) return { ok: false, error: `改完的簡報開檔時會被改掉：${back.loadIssues.join('；')}。Nothing was changed.` }
  return { ok: true, doc: back, changed: res.changed, results: res.results }
}

/** 读（同 slides_read）：页清单；给 page（从 1 起）⇒ 再列那一页的元件、可用版式、动画 */
export function cliRead(doc: SlidesDoc, page?: number): unknown {
  const r = slidesAgentJob(doc, page === undefined ? { kind: 'read' } : { kind: 'read', page })
  return r.reply.ok ? r.reply.result : r.reply
}

export const CLI_EXPORT_FORMATS = ['html', 'pptx'] as const
export type CliExportFormat = typeof CLI_EXPORT_FORMATS[number]
export const exportBaseName = (doc: SlidesDoc): string => (doc.name || 'slides').replace(/[\\/:*?"<>|]/g, '_').slice(0, 120)

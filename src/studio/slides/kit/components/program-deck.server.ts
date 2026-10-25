/**
 * 简报程序动画「死循环计时闸」·整份 deck 的程序编译。
 * ⛔ 客户端 import 本档（会带进 acorn／parse5·另有题钉住）：只给服务端写路、服务端渲染、读回包用。
 *
 * compileDeckPrograms(deck, mode)：递归走每页 components（含组合后代），每个程序组件——
 *   ① 先剥掉进来的 compiled／compileError（⛔ 认外来的：op、模板、导入、客户端、库里旧版本一律重算）；
 *   ② 按规范编码（program-source.ts）当场编译（同 key 走进程内缓存·key＝完整 SHA-256 含编译器／政策版本 ⇒ 缓存命中＝同一份产物）；
 *      拿掉的 script 提示在 compiled.notices 里（本档是唯一生产 caller·只取 compiled ⇒ 提示必须在产物里才跟得到存档／读回／编辑页）；
 *   ③ 编不过：
 *      'strict'（作者在这一笔写的／改的程序）⇒ 抛 ProgramDeckError（路由回 400 program_syntax_error／program_bad_input·整笔不写·库里留前版）；
 *      'lenient'（这一笔没动的旧程序、复制／还原／套模板带进来的、GET 与渲染）⇒ 不带 compiled＝静态，
 *        读回包另带 compileError 白话原因；写库那份不带（写路 lenient 也剥 compileError）。
 *   'strict' 只对「这一笔之前 deck 里没有这份原文」的程序（before 里同 key 的算旧程序·照 lenient）——
 *   免得库里一段旧的编不过（例如上线前就写了 with）把整份简报卡成改不了。
 * 纯函数（不碰库）·回新 deck（没有程序组件 ⇒ 回原物件）。
 */
import type { DeckDataV2 } from '../../deck-edit'
import type { SlideComponent } from './types'
import { compileProgram, ProgramCompileError } from './program-compile.server'
import { ProgramSourceError, tryProgramSourceKey, type CompiledProgram } from './program-source'

export type CompileDeckMode =
  | { kind: 'lenient'; keepError?: boolean }
  | { kind: 'strict-new'; before: DeckDataV2 | null }

export class ProgramDeckError extends Error {
  constructor(readonly code: 'program_syntax_error' | 'program_bad_input', readonly page: number, readonly componentId: string, message: string) {
    super(message)
  }
}

const CACHE_MAX = 256
const cache = new Map<string, CompiledProgram>()
function cachedCompile(src: { html: unknown; css?: unknown; steps?: unknown }, key: string | null): CompiledProgram {
  if (key) {
    const hit = cache.get(key)
    if (hit) { cache.delete(key); cache.set(key, hit); return hit }
  }
  const { compiled } = compileProgram(src)
  cache.set(compiled.key, compiled)
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string)
  return compiled
}
/** 单测用 */
export const programDeckInternals = { cache }

type ProgComp = Extract<SlideComponent, { type: 'program' }>

function sourceOf(c: ProgComp) { return { html: c.html, css: c.css, steps: c.steps } }

/** deck 里全部程序的规范 key（算不出的略过） */
export function deckProgramKeys(deck: DeckDataV2 | null | undefined): Set<string> {
  const out = new Set<string>()
  const walk = (cs: readonly SlideComponent[]) => {
    for (const c of cs) {
      if (c.type === 'program') { const k = tryProgramSourceKey(sourceOf(c)); if (k) out.add(k) }
      else if (c.type === 'group') walk(c.children)
    }
  }
  for (const p of deck?.pages ?? []) if (Array.isArray(p.components)) walk(p.components as SlideComponent[])
  return out
}

function errText(e: unknown): { code: 'program_syntax_error' | 'program_bad_input'; text: string } | null {
  if (e instanceof ProgramCompileError) return { code: 'program_syntax_error', text: e.message }
  if (e instanceof ProgramSourceError) return { code: 'program_bad_input', text: e.message }
  return null
}

export function compileDeckPrograms(deck: DeckDataV2, mode: CompileDeckMode): DeckDataV2 {
  const oldKeys = mode.kind === 'strict-new' ? deckProgramKeys(mode.before) : null
  let touched = false
  const one = (c: ProgComp, page: number): ProgComp => {
    touched = true
    const { compiled: _c, compileError: _e, ...rest } = c
    const key = tryProgramSourceKey(sourceOf(rest as ProgComp))
    try {
      return { ...rest, compiled: cachedCompile(sourceOf(rest as ProgComp), key) } as ProgComp
    } catch (e) {
      const t = errText(e)
      if (!t) throw e
      const strict = oldKeys !== null && !(key && oldKeys.has(key))
      if (strict) throw new ProgramDeckError(t.code, page, c.id, `第 ${page} 頁的程序動畫（${c.name || c.id}）：${t.text}`)
      return (mode.kind === 'lenient' && mode.keepError ? { ...rest, compileError: t.text } : rest) as ProgComp
    }
  }
  const walk = (cs: readonly SlideComponent[], page: number): SlideComponent[] =>
    cs.map((c) => (c.type === 'program' ? one(c, page) : c.type === 'group' ? { ...c, children: walk(c.children, page) as typeof c.children } : c))
  const pages = deck.pages.map((p, i) => (Array.isArray(p.components) ? { ...p, components: walk(p.components as SlideComponent[], i + 1) } : p))
  return touched ? { ...deck, pages: pages as DeckDataV2['pages'] } : deck
}

/** deck 里有没有程序组件（含组合后代） */
export function deckHasPrograms(deck: DeckDataV2 | null | undefined): boolean {
  const walk = (cs: readonly SlideComponent[]): boolean => cs.some((c) => c.type === 'program' || (c.type === 'group' && walk(c.children)))
  return !!deck && deck.pages.some((p) => Array.isArray(p.components) && walk(p.components as SlideComponent[]))
}

/** 库里原样的 deck_data（unknown）：有 pages 阵列才走 compileDeckPrograms（旧整页 HTML 简报／null 原样回） */
export function compileDeckDataRaw(raw: unknown, mode: CompileDeckMode): unknown {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { pages?: unknown }).pages)) return raw
  return compileDeckPrograms(raw as DeckDataV2, mode)
}

/** 角色读回包用：拿掉每个程序的 compiled／compileError（原文照留） */
export function stripDeckProgramsCompiled(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { pages?: unknown }).pages)) return raw
  const walk = (cs: unknown[]): unknown[] => cs.map((c) => {
    if (!c || typeof c !== 'object') return c
    const o = c as Record<string, unknown>
    if (o.type === 'program') { const { compiled: _a, compileError: _b, ...rest } = o; return rest }
    if (o.type === 'group' && Array.isArray(o.children)) return { ...o, children: walk(o.children) }
    return c
  })
  const d = raw as { pages: Array<Record<string, unknown>> }
  return { ...d, pages: d.pages.map((p) => (p && Array.isArray(p.components) ? { ...p, components: walk(p.components) } : p)) }
}

/** 路由用：ProgramDeckError ⇒ 400 回包（白话＋代码＋页码＋组件编号）；别的错不接 */
export function programDeckErrorResponse(e: unknown): Response | null {
  if (!(e instanceof ProgramDeckError)) return null
  return Response.json({ error: e.message, code: `err_aislides_${e.code}`, page: e.page, component_id: e.componentId }, { status: 400 })
}

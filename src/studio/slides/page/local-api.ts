// 游客版的「接口」：在浏览器里对本机工程档（ProjectStore 的 project.json＋assets/）做跟网站简报接口同形的处理，
//   回 Response（回应码与栏位同网站），整页（SlidesPage.tsx）照登入版那套判读、一行不改。
//   一份工程＝一份简报：编号＝工程编号；改动当场套用（applyComponentOp 等纯函数，与网站同一份）、存进 project.json。
//   乐观戳 revision 只在记忆体里（存档不写）；外面（用户自己的 AI）改了档由外框发现、重挂整页重读。
//   没有后端就做不到的（版本纪录、公开分享、角色、云盘里的自存模板、整份原创模板）回 404，页面上那几颗钮宿主也不画。

import type { ProjectStore, SaveState } from '../../shared/types'
import { saveProjectSafe } from '../../shared/store'
import { slidesFormat, isAssetSrc, assetNameOf, type SlidesDoc } from '../format'
import { AssetUrlCache, assetNamesInDeck, blobToDataUrl, saveAssetFiles } from '../assets'
import {
  addDeckPage, applyPageHtmlEdit, applySlotEdit, applyThemeChange, deckRevision, deleteDeckPage, ensureDeckPagePids,
  manualDeckPageCap, parsePatchOp, resolveDeckPageByPid,
  type DeckDataV2, type DeckEditResult, type DeckPatchOpInput,
} from '../deck-edit'
import { applyComponentOp, COMPONENT_OP_ERROR_TEXT, parseComponentOp, programCapExceededAfter } from '../deck-components'
import type { ComponentOp, SlideComponent } from '../kit/components/types'
import { cleanText, OUTLINE_LIMITS } from '../kit/pipeline/schema'
import { compiledDeckToHtml } from '../render-deck'
import type { SlidesApi } from './host'

type ProgramDeckModule = typeof import('../kit/components/program-deck.server')

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const notHere = (): Response => json({ error: 'not available offline', code: 'err_studio_unavailable' }, 404)

const untitled = (deck: DeckDataV2) => (deck.lang === 'zh-CN' ? '未命名演示文稿' : '未命名簡報')

/** deck 里有没有程序组件（有才去载编译器） */
function deckHasProgram(deck: DeckDataV2): boolean {
  const any = (cs?: readonly SlideComponent[]): boolean => !!cs?.some((c) => c.type === 'program' || (c.type === 'group' && any(c.children)))
  return deck.pages.some((p) => any(p.components))
}

export type LocalApiEvents = {
  onDirtyChange(dirty: boolean): void
  onSaveStateChange?(state: SaveState, detail?: string): void
}

export class LocalSlidesApi implements SlidesApi {
  private doc: SlidesDoc | null = null
  private loadErr: unknown = null
  private ready: Promise<void> | null = null
  private writing: Promise<unknown> = Promise.resolve()
  private dirty = false
  private programs: ProgramDeckModule | null = null
  private dataUrls = new Map<string, Promise<string | null>>()
  readonly cache: AssetUrlCache

  constructor(private store: ProjectStore, private projectId: string, private events: () => LocalApiEvents) {
    this.cache = new AssetUrlCache(store)
  }

  dispose(): void { this.cache.dispose(); this.dataUrls.clear() }

  /** 画面上用的媒体网址：assets/<档名> ⇒ blob:（读好之前给透明小图）；别的原样 */
  mediaUrl(src: string): string {
    if (!isAssetSrc(src)) return src
    return this.cache.peek(assetNameOf(src)) ?? 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
  }

  /** 外框要汇出／换资料夹前：手上那份照写（不比对外面改过没有） */
  async flush(): Promise<void> {
    await this.writing
    if (!this.doc || !this.dirty) return
    await this.write(this.doc, true)
  }

  // ── 读档 ──────────────────────────────────────────────
  private load(): Promise<void> {
    if (!this.ready) {
      this.ready = (async () => {
        try {
          const d = await slidesFormat.load(this.store)
          const deck = await this.compile({ ...d.deck, revision: deckRevision(d.deck) ?? 1 }, { kind: 'lenient', keepError: true })
          this.doc = { ...d, deck }
          await Promise.all(assetNamesInDeck(deck).map((n) => this.cache.ensure(n)))
          this.events().onSaveStateChange?.('saved')
        } catch (e) { this.loadErr = e }
      })()
    }
    return this.ready
  }

  private async compile(deck: DeckDataV2, mode: Parameters<ProgramDeckModule['compileDeckPrograms']>[1]): Promise<DeckDataV2> {
    if (!deckHasProgram(deck)) return deck
    if (!this.programs) this.programs = await import('../kit/components/program-deck.server')
    return this.programs.compileDeckPrograms(deck, mode)
  }

  /** 放进沙盒框（缩图、放映）的那份：assets/<档名> 换成 data:（沙盒框读不到本页的 blob:） */
  private async displayHtml(deck: DeckDataV2, title: string): Promise<string> {
    let html = await compiledDeckToHtml(deck, title)
    for (const name of assetNamesInDeck(deck).sort((a, b) => b.length - a.length)) {
      const src = `assets/${name}`
      if (!html.includes(src)) continue
      let p = this.dataUrls.get(name)
      if (!p) {
        p = this.store.readAsset(name).then((b) => (b ? blobToDataUrl(b) : null), () => null)
        this.dataUrls.set(name, p)
      }
      const data = await p
      if (data) html = html.split(src).join(data)
    }
    return html
  }

  private async row(doc: SlidesDoc) {
    const title = doc.name
    return {
      id: this.projectId,
      title,
      slide_count: doc.deck.pages.length,
      html_content: await this.displayHtml(doc.deck, title || untitled(doc.deck)),
      deck_data: doc.deck,
      updated_at: String(doc.deck.revision ?? 0),
      visibility: 'private',
      editor_agent_key: null,
    }
  }

  private async write(doc: SlidesDoc, force = false): Promise<void> {
    const ev = this.events()
    ev.onSaveStateChange?.('saving')
    const r = await saveProjectSafe(this.store, (s) => slidesFormat.save(s, doc), { force })
    if (!r.written) {
      // 外面改过 project.json：先不盖，留着「未存」，外框会问使用者要不要重新载入
      this.dirty = true
      ev.onDirtyChange(true)
      ev.onSaveStateChange?.('dirty')
      return
    }
    if (this.doc === doc) {
      this.dirty = false
      ev.onDirtyChange(false)
      ev.onSaveStateChange?.('saved')
    }
  }

  async getSlide(id: string): Promise<Response> {
    if (id !== this.projectId) return json({ error: 'Not found' }, 404)
    await this.load()
    if (!this.doc) return json({ error: String((this.loadErr as Error)?.message ?? this.loadErr) }, 500)
    return json(await this.row(this.doc))
  }

  async deckHtml(deckId: string): Promise<Response> {
    if (deckId !== this.projectId) return json({ error: 'Not found' }, 404)
    await this.load()
    if (!this.doc) return json({ error: 'load failed' }, 500)
    return json({ html: await this.displayHtml(this.doc.deck, this.doc.name || untitled(this.doc.deck)) })
  }

  async deckRevision(deckId: string): Promise<Response> {
    if (deckId !== this.projectId || !this.doc) return json({ error: 'Not found' }, 404)
    return json({ revision: deckRevision(this.doc.deck) })
  }

  async uploadMedia(file: File): Promise<Response> {
    try {
      const [a] = await saveAssetFiles(this.store, this.cache, [file])
      return json({ url: a.url, display_url: a.displayUrl })
    } catch (e) {
      return json({ error: String((e as Error)?.message ?? e) }, 500)
    }
  }

  async signMedia(): Promise<Response> { return json({ urls: {} }) }

  /** 一笔结构化改动：与网站同一套检查与纯函数（页身份、乐观戳、操作、程序动画编译、标题） */
  patchDeck(body: { slideId: string; expectedRevision: number | null; op: unknown }): Promise<Response> {
    const run = this.writing.then(() => this.applyPatch(body))
    this.writing = run.catch(() => undefined)
    return run
  }

  private async applyPatch(body: { slideId: string; expectedRevision: number | null; op: unknown }): Promise<Response> {
    await this.load()
    const doc = this.doc
    if (!doc || body.slideId !== this.projectId) return json({ error: 'Not found', code: 'err_aislides_not_found' }, 404)
    const op: DeckPatchOpInput | ComponentOp | null = parsePatchOp(body.op) ?? parseComponentOp(body.op)
    if (!op) return json({ error: 'Bad request', code: 'err_aislides_bad_request' }, 400)
    const parsed = doc.deck
    const deck = ensureDeckPagePids(parsed)
    const current = async () => this.row(doc)

    const resolved = ((): DeckPatchOpInput | ComponentOp | 'page_gone' | 'ambiguous' => {
      const byPid = (pid: string, hint: number): number | 'page_gone' | 'ambiguous' => {
        const r = resolveDeckPageByPid(parsed, pid, hint)
        return r.kind === 'found' ? r.index : r.kind === 'gone' ? 'page_gone' : 'ambiguous'
      }
      if ((op.kind === 'edit_slots' || op.kind === 'delete_page' || op.kind === 'edit_page_html') && op.pageId !== undefined) {
        const i = byPid(op.pageId, op.pageIndex)
        return typeof i === 'number' ? { ...op, pageIndex: i } : i
      }
      if (op.kind === 'add_page' && op.afterPageId !== undefined) {
        const i = byPid(op.afterPageId, op.afterIndex)
        return typeof i === 'number' ? { ...op, afterIndex: i } : i
      }
      return op
    })()
    if (resolved === 'page_gone') return json({ error: '該頁已被刪除，內容未寫入', code: 'err_aislides_page_gone', current: await current() }, 409)
    if (resolved === 'ambiguous') return json({ error: '頁面識別衝突，內容未寫入，請重試', code: 'err_aislides_page_ambiguous', current: await current() }, 409)

    const currentRev = deckRevision(deck)
    if (body.expectedRevision !== currentRev) return json({ error: '簡報已在其他視窗更新', code: 'err_aislides_conflict', current: await current() }, 409)

    const result0 = applyLocalOp(deck, resolved)
    const capHit = result0.ok && programCapExceededAfter(deck, result0.deck)
    const result = capHit ? ({ ok: false, error: 'too_many_programs' } as const) : result0
    if (!result.ok) {
      if (result.error === 'page_gone') return json({ error: '該頁已被刪除，內容未寫入', code: 'err_aislides_page_gone', current: await current() }, 409)
      const msg: Record<string, string> = {
        ...COMPONENT_OP_ERROR_TEXT,
        page_componentized: '這一頁已改用元件編輯（請在下方元件清單改）',
        bad_page_index: '頁碼不存在',
        last_page: '至少要保留一頁',
        bad_page_type: '不支援的操作',
        too_many_items: '條目數超過版式上限',
        deck_full: `頁數已達上限（${manualDeckPageCap()} 頁）`,
        page_html_too_large: '這一頁的內容太大，無法儲存',
        bad_theme: '找不到這個模板',
        bad_template: '找不到這個模板',
      }
      const field = 'field' in result && typeof result.field === 'string' ? result.field : undefined
      return json({ error: `${msg[result.error] ?? result.error}${field ? `（${field}）` : ''}`, code: `err_aislides_${result.error}`, ...(field ? { field } : {}) }, 400)
    }

    let newTitle = doc.name
    let nextDeck = result.deck
    if (op.kind === 'rename') {
      const cleaned = cleanText(op.title, OUTLINE_LIMITS.title)
      newTitle = cleaned || untitled(nextDeck)
      nextDeck = { ...nextDeck, outline: { ...(nextDeck.outline ?? {}), title: newTitle } }
    } else if ('coverTitle' in result && result.coverTitle !== undefined) {
      newTitle = result.coverTitle || untitled(nextDeck)
    }
    nextDeck = { ...nextDeck, revision: (currentRev ?? 0) + 1 }
    try {
      nextDeck = await this.compile(nextDeck, op.kind === 'apply_template' || op.kind === 'apply_user_template' ? { kind: 'lenient' } : { kind: 'strict-new', before: deck })
    } catch (e) {
      const r = this.programs?.programDeckErrorResponse(e)
      if (r) return r
      throw e
    }

    const next: SlidesDoc = { ...doc, name: newTitle, deck: nextDeck }
    this.doc = next
    this.dirty = true
    this.events().onDirtyChange(true)
    try {
      await this.write(next)
    } catch (e) {
      // 写不进去（资料夹授权掉了／空间不够）：这一笔不算数，回到前一版
      if (this.doc === next) this.doc = doc
      this.events().onSaveStateChange?.('error', String((e as Error)?.message ?? e))
      return json({ error: String((e as Error)?.message ?? e) }, 500)
    }
    await Promise.all(assetNamesInDeck(nextDeck).map((n) => this.cache.ensure(n)))
    return json({
      id: this.projectId,
      title: newTitle,
      slide_count: nextDeck.pages.length,
      html_content: await this.displayHtml(nextDeck, newTitle || untitled(nextDeck)),
      deck_data: nextDeck,
      ...(result.targetPageIndex !== undefined ? { targetPageIndex: result.targetPageIndex } : {}),
      ...('componentId' in result && result.componentId ? { componentId: result.componentId } : {}),
      ...('childIds' in result && result.childIds ? { childIds: result.childIds } : {}),
    })
  }

  // ── 要后端的：回 404（页面上宿主也不画那几颗钮） ──
  async putSlide(): Promise<Response> { return notHere() }
  async createSlide(): Promise<Response> { return notHere() }
  async createDeck(): Promise<Response> { return notHere() }
  async listVersions(): Promise<Response> { return notHere() }
  async getVersion(): Promise<Response> { return notHere() }
  async restoreVersion(): Promise<Response> { return notHere() }
  async setEditorAgent(): Promise<Response> { return notHere() }
  async listUserTemplates(): Promise<Response> { return notHere() }
  async saveUserTemplate(): Promise<Response> { return notHere() }
  async deleteUserTemplate(): Promise<Response> { return notHere() }
}

/** 一笔操作套到 deck 上（与网站同一份纯函数；整份原创模板与云盘自存模板要网站的模板本体 ⇒ 不支援） */
function applyLocalOp(deck: DeckDataV2, op: DeckPatchOpInput | ComponentOp): DeckEditResult | ReturnType<typeof applyComponentOp> {
  switch (op.kind) {
    case 'apply_user_template':
    case 'apply_template':
      return { ok: false, error: 'bad_template' } as DeckEditResult
    case 'edit_slots':
      return applySlotEdit(deck, op.pageIndex, op.slots ?? {})
    case 'add_page':
      return addDeckPage(deck, op.afterIndex, op.pageType)
    case 'delete_page':
      return deleteDeckPage(deck, op.pageIndex)
    case 'rename':
      return { ok: true, deck }
    case 'edit_page_html':
      return applyPageHtmlEdit(deck, op.pageIndex, op.html)
    case 'set_theme':
      return applyThemeChange(deck, op.themeId)
    default:
      return applyComponentOp(deck, op as ComponentOp)
  }
}

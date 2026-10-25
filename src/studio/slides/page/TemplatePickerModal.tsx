'use client'
// 选模板弹窗：网格卡片（缩图＋名＋出处小字）＋分类页签＋「套用」。简报编辑页与网站编辑页共用。
//   点「套用」⇒ 先问（beforeApply 由调用页定）⇒ onApply(entry)；怎么存由调用页定。
//   catalog：卡片目录（没给 ⇒ 简报卡）；mine：给了才出「我的模板」页签（存在云盘的自存模板）。

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { editorShell } from '../../shared/theme/editor-shell-theme'
import { useStudioLang, useStudioT } from '../../shared/StudioT'
import { confirmDialog } from '../../shared/dialog-store'
import { categoriesOf, categoryLabelKey, templatesOf, type TemplateCategory, type TemplateEntry, type TemplateKind } from '../templates/catalog'

/** 缩图懒载：以网格卷动区为根，卡片进到可视区下方 200px 内才挂 <img>。 */

function LazyThumb({ src, root }: { src: string; root: RefObject<HTMLDivElement | null> }) {
  const holder = useRef<HTMLDivElement>(null)
  const [show, setShow] = useState(false)
  useEffect(() => {
    if (show) return
    const el = holder.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') { setShow(true); return }
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { setShow(true); io.disconnect() } }, { root: root.current, rootMargin: '0px 0px 200px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [show, root])
  return (
    <div ref={holder} className="w-full h-full" data-thumb-loaded={show ? '1' : '0'}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {show && <img src={src} alt="" className="w-full h-full object-cover" decoding="async" draggable={false} />}
    </div>
  )
}

export type UserTemplate = { id: string; title: string; slide_count?: number | null }
export type UserTemplateOps = {
  list: () => Promise<UserTemplate[] | null>
  /** 那份自存模板的整页 HTML（缩图用）·取不到 ⇒ '' */
  html: (id: string) => Promise<string>
  save: () => Promise<UserTemplate | null>
  remove: (tpl: UserTemplate) => Promise<boolean>
  apply: (tpl: UserTemplate) => Promise<boolean>
}

/** 我的模板缩图：进可视区才取那份的 html·无脚本沙盒 iframe 按宽缩放 */
function UserThumb({ id, root, load: loadHtml }: { id: string; root: RefObject<HTMLDivElement | null>; load: (id: string) => Promise<string> }) {
  const holder = useRef<HTMLDivElement>(null)
  const [html, setHtml] = useState<string | null>(null)
  const [scale, setScale] = useState(0.2)
  useEffect(() => {
    const el = holder.current
    if (!el || html !== null) return
    let dead = false
    const load = () => { loadHtml(id).then((h) => { if (!dead) setHtml(h) }).catch(() => { if (!dead) setHtml('') }) }
    if (typeof IntersectionObserver === 'undefined') { load(); return () => { dead = true } }
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { io.disconnect(); load() } }, { root: root.current, rootMargin: '0px 0px 200px 0px' })
    io.observe(el)
    return () => { dead = true; io.disconnect() }
  }, [id, root, html, loadHtml])
  useEffect(() => { const el = holder.current; if (el) setScale(el.clientWidth / 1000) }, [html])
  return (
    <div ref={holder} className="w-full h-full relative overflow-hidden" data-testid="tpl-mine-thumb">
      {html ? <iframe srcDoc={html} sandbox="" tabIndex={-1} title="" className="absolute top-0 left-0 border-0 pointer-events-none origin-top-left" style={{ width: 1000, height: 562.5, transform: `scale(${scale})` }} /> : null}
    </div>
  )
}

type Props = {
  kind: TemplateKind
  open: boolean
  onClose: () => void
  onApply: (entry: TemplateEntry) => Promise<boolean>
  hasExisting: boolean
  beforeApply?: (entry: TemplateEntry) => Promise<boolean>
  mine?: UserTemplateOps
  catalog?: readonly TemplateEntry[]
  /** 只列这些卡（没给 ⇒ 全列） */
  filter?: (entry: TemplateEntry) => boolean
}

export type TemplatePickerModalProps = Props

export default function TemplatePickerModal({ kind, open, onClose, onApply, hasExisting, beforeApply, mine, catalog, filter }: Props) {
  const t = useStudioT()
  const language = useStudioLang()
  const nameLang = language === 'zh-CN' ? 'cn' : language === 'en' ? 'en' : 'tw'
  const [cat, setCat] = useState<'all' | 'mine' | TemplateCategory>('all')
  const [mineList, setMineList] = useState<UserTemplate[] | null>(null)
  const [mineErr, setMineErr] = useState(false)
  const [mineSel, setMineSel] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const askingRef = useRef(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const all = useMemo(() => { const l = templatesOf(kind, catalog); return filter ? l.filter(filter) : l }, [kind, catalog, filter])
  const shown = useMemo(() => (cat === 'all' ? all : cat === 'mine' ? [] : all.filter(e => e.category === cat)), [all, cat])
  const reloadMine = useCallback(async () => {
    if (!mine) return
    setMineErr(false)
    const l = await mine.list()
    if (l === null) setMineErr(true)
    setMineList(l ?? [])
  }, [mine])
  const cats = categoriesOf(kind)
  const counts = useMemo(() => { const m = new Map<string, number>(); for (const e of all) m.set(e.category, (m.get(e.category) ?? 0) + 1); return m }, [all])

  useEffect(() => { if (open) { setCat('all'); setSelected(null); setMineSel(null); setBusy(false); setMineList(null) } }, [open])
  useEffect(() => { if (open && cat === 'mine' && mineList === null) void reloadMine() }, [open, cat, mineList, reloadMine])
  useEffect(() => { if (selected && !shown.some(e => e.id === selected)) setSelected(null) }, [shown, selected])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, busy, onClose])

  if (!open) return null
  const picked = shown.find(e => e.id === selected) ?? null
  const minePicked = cat === 'mine' ? (mineList ?? []).find(m => m.id === mineSel) ?? null : null

  const applyMine = async (tpl: UserTemplate) => {
    if (!mine || busy || askingRef.current) return
    askingRef.current = true
    let go = false
    try { go = await confirmDialog({ message: t('tpl_confirm_user'), confirmLabel: t('tpl_continue'), danger: true }) } finally { askingRef.current = false }
    if (!go) return
    setBusy(true)
    try { if (await mine.apply(tpl)) onClose() } finally { setBusy(false) }
  }
  const saveMine = async () => {
    if (!mine || busy) return
    setBusy(true)
    try { const made = await mine.save(); if (made) { setMineList(l => [made, ...(l ?? []).filter(x => x.id !== made.id)]); setMineSel(made.id) } } finally { setBusy(false) }
  }
  const removeMine = async (tpl: UserTemplate) => {
    if (!mine || busy) return
    if (!(await confirmDialog({ message: t('tpl_delete_confirm').replace('{name}', tpl.title), confirmLabel: t('tpl_delete'), danger: true }))) return
    setBusy(true)
    try { if (await mine.remove(tpl)) { setMineList(l => (l ?? []).filter(x => x.id !== tpl.id)); if (mineSel === tpl.id) setMineSel(null) } } finally { setBusy(false) }
  }

  const apply = async () => {
    if (minePicked) { await applyMine(minePicked); return }
    if (!picked || busy || askingRef.current) return
    askingRef.current = true
    let go = false
    try {
      go = beforeApply ? await beforeApply(picked)
        : hasExisting ? await confirmDialog({ message: t(picked.badge === 'original' ? 'tpl_confirm_site_original' : 'tpl_confirm_site'), confirmLabel: t('tpl_apply'), danger: true })
        : true
    } finally { askingRef.current = false }
    if (!go) return
    setBusy(true)
    try {
      const ok = await onApply(picked)
      if (ok) onClose()
    } finally { setBusy(false) }
  }

  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center ${editorShell.modalMaskColor}`} onClick={() => { if (!busy) onClose() }} data-testid="tpl-modal">
      <div className={`${editorShell.modalCard} w-[980px] max-w-[94vw] h-[84vh] flex flex-col`} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={t(kind === 'slides' ? 'tpl_modal_title_slides' : 'tpl_modal_title_site')}>
        <div className={`flex items-center justify-between px-5 pt-4 pb-3 border-b ${editorShell.divider}`}>
          <h2 className="text-sm font-medium text-gray-800">{t(kind === 'slides' ? 'tpl_modal_title_slides' : 'tpl_modal_title_site')}</h2>
          <button type="button" onClick={onClose} disabled={busy} className={`${editorShell.headerTextBtn} text-base leading-none px-1`} title={t('tpl_close')} data-testid="tpl-close">×</button>
        </div>
        <div className="flex items-center gap-1 px-5 py-2 flex-wrap" data-testid="tpl-tabs">
          {mine && (
            <button type="button" onClick={() => setCat('mine')}
              className={`px-2.5 py-1 text-xs rounded-md transition-colors duration-150 ${cat === 'mine' ? editorShell.chipActive : editorShell.chipIdle}`}
              data-testid="tpl-tab-mine" data-active={cat === 'mine' ? '1' : '0'}>
              {t('tpl_tab_mine')}
              {mineList ? <span className="ml-1 opacity-60 tabular-nums">{mineList.length}</span> : null}
            </button>
          )}
          {(['all', ...cats] as const).map(c => (
            <button key={c} type="button" onClick={() => setCat(c)}
              className={`px-2.5 py-1 text-xs rounded-md transition-colors duration-150 ${cat === c ? editorShell.chipActive : editorShell.chipIdle}`}
              data-testid={`tpl-tab-${c}`} data-active={cat === c ? '1' : '0'}>
              {c === 'all' ? t('tpl_cat_all') : t(categoryLabelKey(c))}
              <span className="ml-1 opacity-60 tabular-nums" data-testid={`tpl-tab-count-${c}`}>{c === 'all' ? all.length : (counts.get(c) ?? 0)}</span>
            </button>
          ))}
        </div>
        <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-5 pb-4" data-testid="tpl-scroll">
          {cat === 'mine' ? (
            <div data-testid="tpl-mine">
              <div className="py-2">
                <button type="button" onClick={() => void saveMine()} disabled={busy}
                  className={`px-3 py-1.5 text-xs rounded-md ${editorShell.chipActive} disabled:opacity-40`} data-testid="tpl-save-current">＋ {t('tpl_save_current')}</button>
              </div>
              {mineList === null ? (
                <div className={`py-12 text-center text-sm ${editorShell.mutedText}`}>…</div>
              ) : mineErr ? (
                <div className={`py-12 text-center text-sm ${editorShell.mutedText}`} data-testid="tpl-mine-failed">{t('tpl_mine_load_failed')}</div>
              ) : mineList.length === 0 ? (
                <div className={`py-12 text-center text-sm ${editorShell.mutedText}`} data-testid="tpl-mine-empty">{t('tpl_mine_empty')}</div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3" data-testid="tpl-mine-grid">
                  {mineList.map(m => {
                    const on = m.id === mineSel
                    return (
                      <div key={m.id} role="button" tabIndex={0} onClick={() => setMineSel(m.id)} onDoubleClick={() => { setMineSel(m.id); void applyMine(m) }}
                        onKeyDown={e => { if (e.key === 'Enter') setMineSel(m.id) }}
                        className={`group relative text-left rounded-xl border-2 p-2 cursor-pointer transition-colors ${on ? 'border-blue-500 bg-blue-50' : `border-transparent ${editorShell.softSurface} ${editorShell.softSurfaceHover}`}`}
                        data-testid={`tpl-mine-card-${m.id}`} data-selected={on ? '1' : '0'} aria-pressed={on}>
                        <div className="aspect-video w-full rounded-lg overflow-hidden bg-white border border-black/5"><UserThumb id={m.id} root={scrollRef} load={mine!.html} /></div>
                        <div className="mt-2 text-sm text-gray-800 truncate" title={m.title}>{m.title}</div>
                        <div className={`text-[11px] ${editorShell.mutedText} truncate`}>{t('tpl_source_mine')}{m.slide_count ? ` · ${m.slide_count}` : ''}</div>
                        <button type="button" onClick={e => { e.stopPropagation(); void removeMine(m) }} disabled={busy} title={t('tpl_delete')} aria-label={t('tpl_delete')}
                          className="absolute top-3 right-3 w-6 h-6 rounded-full bg-white/90 text-gray-500 hover:text-red-500 shadow text-sm leading-none opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                          data-testid={`tpl-mine-delete-${m.id}`}>×</button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          ) : shown.length === 0 ? (
            <div className={`py-12 text-center text-sm ${editorShell.mutedText}`} data-testid="tpl-empty">{t('tpl_empty')}</div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3" data-testid="tpl-grid">
              {shown.map(e => {
                const on = e.id === selected
                return (
                  <button key={e.id} type="button" onClick={() => setSelected(e.id)} onDoubleClick={() => { setSelected(e.id); void apply() }}
                    className={`text-left rounded-xl border-2 p-2 transition-colors ${on ? 'border-blue-500 bg-blue-50' : `border-transparent ${editorShell.softSurface} ${editorShell.softSurfaceHover}`}`}
                    data-testid={`tpl-card-${e.id}`} data-selected={on ? '1' : '0'} data-original={e.badge === 'original' ? '1' : undefined} aria-pressed={on}
                    title={e.badge === 'original' ? `${t('tpl_source_prefix')}${t('tpl_badge_original')}` : [e.desc, e.attribution, e.license].filter(Boolean).join(' · ')}>
                    <div className="aspect-video w-full rounded-lg overflow-hidden bg-white border border-black/5">
                      <LazyThumb src={e.thumb} root={scrollRef} />
                    </div>
                    <div className="mt-2 text-sm text-gray-800 truncate">{e.name[nameLang]}</div>
                    <div className={`text-[11px] ${editorShell.mutedText} truncate`} data-testid="tpl-source">{t('tpl_source_prefix')}{e.badge === 'original' ? t('tpl_badge_original') : e.source}{e.license === 'MIT' ? ' · MIT' : ''}</div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
        <div className={`flex items-center justify-end gap-2 px-5 py-3 border-t ${editorShell.divider}`}>
          <button type="button" onClick={onClose} disabled={busy} className={`px-3 py-1.5 text-xs rounded-md ${editorShell.chipIdle}`}>{t('tpl_close')}</button>
          <button type="button" onClick={() => void apply()} disabled={(cat === 'mine' ? !minePicked : !picked) || busy}
            className={`px-3 py-1.5 text-xs rounded-md ${editorShell.chipActive} disabled:opacity-40`} data-testid="tpl-apply">
            {busy ? t('tpl_applying') : t('tpl_apply')}
          </button>
        </div>
      </div>
    </div>
  )
}

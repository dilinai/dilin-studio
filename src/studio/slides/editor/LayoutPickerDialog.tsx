'use client'

/**
 * 「換版式」对话框（左栏缩图右键／画布右键进来）
 *   列出当页页型的全部版式（版式库注册序·含带 relation 的新版式·⛔ 写死版式 id）；每张缩图＝这一页「换过去以后」的样子：
 *   与 page_set_layout 同一个纯函数 relayoutPage 算出新页·同一个渲染器（ComponentSlideView thumb 模式）渲小图——看到的就是换完的结果。
 *   点一下＝一笔 page_set_layout（宿主送）；装不下这页条目的版式灰掉不给点（服务端也会拒 too_many_items）。
 */

import { useMemo } from 'react'
import { ComponentSlideView } from '../kit/components/render'
import { pageComponents } from '../kit/components/derive'
import { layoutChoices } from '../kit/registry'
import type { LayoutLocale, Theme } from '../kit/types'
import { relayoutPage } from '../deck-components'
import type { DeckDataV2 } from '../deck-edit'
import { useStudioLang, useStudioT as useT } from '../../shared/StudioT'
import { editorShell } from '../../shared/theme/editor-shell-theme'

export type LayoutPickerDialogProps = {
  deck: DeckDataV2
  pageIndex: number
  theme: Theme
  onPick: (layoutId: string) => void
  onClose: () => void
  mediaUrl?: (src: string) => string
}

const THUMB_W = 200

export default function LayoutPickerDialog(p: LayoutPickerDialogProps) {
  const t = useT()
  // 版式说明（meta.desc）是中文·英文介面底下改显示版式编号（说明留在滑鼠提示里）
  const language = useStudioLang()
  const page = p.deck.pages[p.pageIndex]
  const locale: LayoutLocale = p.deck.lang === 'zh-CN' ? 'zh-CN' : 'zh-TW'
  const cards = useMemo(() => {
    if (!page) return []
    return layoutChoices(page.draft.type).map((c) => {
      const current = c.id === page.layoutId
      const r = current ? { ok: true as const, page } : relayoutPage(p.deck, p.pageIndex, c.id)
      return { ...c, current, ok: r.ok, comps: r.ok ? pageComponents(r.page, p.pageIndex, locale) : [], bg: r.ok ? r.page.background : undefined }
    })
  }, [p.deck, p.pageIndex, page, locale])
  if (!page) return null

  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center ${editorShell.modalMaskColor}`} onPointerDown={p.onClose} data-testid="slc-relayout-dialog">
      <div className={`${editorShell.modalCard} p-5 w-[720px] max-w-[95vw] max-h-[90vh] overflow-y-auto text-gray-800`} onPointerDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-1">
          <div className="text-sm font-semibold">{t('slc_relayout_title')}</div>
          <div className="text-xs text-gray-400 truncate">{t('asld_page_pre')}{p.pageIndex + 1}{t('asld_page_suf')}</div>
          <button type="button" className="ml-auto text-gray-400 hover:text-gray-700 px-2" onClick={p.onClose} aria-label={t('slc_close')}>✕</button>
        </div>
        <div className="text-xs text-gray-500 mb-3">{t('slc_relayout_hint')}</div>
        {cards.length <= 1 && <div className="text-xs text-gray-400 py-6 text-center" data-testid="slc-relayout-none">{t('slc_relayout_none')}</div>}
        <div className="grid grid-cols-3 gap-3">
          {cards.map((c) => (
            <button key={c.id} type="button" data-testid={`slc-relayout-${c.id}`} data-current={c.current ? '1' : undefined}
              disabled={!c.ok || c.current}
              title={`${c.id}｜${c.desc}${c.ok ? '' : `｜${t('slc_relayout_too_many')}`}`}
              onClick={() => { if (c.ok && !c.current) p.onPick(c.id) }}
              className={`text-left rounded-lg border p-1.5 transition-colors ${c.current ? 'border-blue-500 ring-2 ring-blue-200' : 'border-gray-200 hover:border-blue-400'} disabled:cursor-default ${!c.ok ? 'opacity-40' : ''}`}>
              <div className="rounded overflow-hidden pointer-events-none" style={{ width: THUMB_W, aspectRatio: '16 / 9' }}>
                {c.ok
                  ? <ComponentSlideView components={c.comps} background={c.bg} theme={p.theme} pageType={page.draft.type} mode="thumb" width={THUMB_W} mediaUrl={p.mediaUrl} />
                  : <div className={`w-full h-full ${editorShell.softSurface}`} />}
              </div>
              <div className="mt-1 text-[11px] text-gray-600 truncate">
                {c.current ? <span className="text-blue-600 mr-1">{t('slc_relayout_current')}</span> : null}
                {c.ok ? (language === 'en' ? c.id : c.desc) : t('slc_relayout_too_many')}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

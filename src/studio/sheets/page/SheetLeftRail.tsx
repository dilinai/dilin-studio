'use client'
// 表格页左栏「收起态」窄栏：收起后表格清单仍可点。
//   左栏收起后不再只剩一颗「>」：留一条约 48px 的窄栏，从上到下＝
//     展开钮「>」（点了回展开态·停在原页签）／每张表格一颗小图标（当前那张高亮·悬停显表名·点了切表）／
//     「＋」新增表格（唯读不显）／最底「硬碟」图标（点了展开到硬碟页签）。
//   展开态照旧（SheetTabList）。规则不在这里：新增／切表都回调本页同一套动作。
//   SheetLeftRailView＝不含 hook 的纯画法（契约测直接调它、找钮、点 onClick）；SheetLeftRail＝接取字的外壳。
import type { ReactElement } from 'react'
import { useSheetT } from '../ui/host'
import { editorShell } from '../../shared/theme/editor-shell-theme'
import type { SheetTab } from '../engine/sheet-list'

export type SheetLeftRailProps = {
  sheets: SheetTab[]
  currentId: string | null
  readonly?: boolean
  onExpand: () => void
  onSelect: (id: string) => void
  onAdd: () => void
  onOpenDrive: () => void
  /** 同 SheetTabList holdFocus：编着公式点别张 ⇒ 按下不抢焦点 */
  holdFocus?: () => boolean
}

type RailText = { expand: string; add: string; drive: string }

const railBtn = 'w-8 h-8 shrink-0 flex items-center justify-center rounded-lg transition-colors'

function SheetIcon({ active }: { active: boolean }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden className={`w-4 h-4 ${active ? 'text-blue-500' : 'text-emerald-500'}`}><path fillRule="evenodd" d="M3 4.5A1.5 1.5 0 0 1 4.5 3h11A1.5 1.5 0 0 1 17 4.5v11a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 15.5v-11ZM4.5 7v2.25h4.75V7H4.5Zm6.25 0v2.25h4.75V7h-4.75Zm4.75 3.75h-4.75V13h4.75v-2.25Zm0 3.75h-4.75V15.5h4.75V14.5Zm-6.25 1V14.5H4.5v1h4.75Zm-4.75-2.5h4.75v-2.25H4.5V13Z" clipRule="evenodd"/></svg>
  )
}

export function SheetLeftRailView(p: SheetLeftRailProps & { text: RailText }): ReactElement {
  return (
    <aside data-testid="sheet-left-collapsed" data-panel-side="left"
      className={`shrink-0 w-12 flex flex-col items-center gap-1.5 pt-1.5 pb-2 ${editorShell.colBorderR}`}
      style={editorShell.beigeSurface}>
      <button type="button" onClick={p.onExpand} title={p.text.expand} aria-label={p.text.expand}
        data-testid="panel-expand-left" className={editorShell.collapseBtn}>
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </button>
      <div className="flex-1 min-h-0 w-full overflow-y-auto flex flex-col items-center gap-1" data-testid="sheet-rail-list">
        {p.sheets.map((s, i) => {
          const active = s.id === p.currentId
          return (
            <button key={s.id} type="button" onClick={() => p.onSelect(s.id)} onMouseDown={e => { if (e.button === 0 && p.holdFocus?.()) e.preventDefault() }}
              title={s.name} aria-label={s.name} aria-current={active ? 'true' : undefined}
              data-testid="sheet-rail-item" data-sheet-id={s.id} data-active={active ? '1' : '0'}
              className={`${railBtn} relative ${active ? 'bg-blue-50 ring-1 ring-blue-200' : `bg-white/60 ${editorShell.softSurfaceHover}`}`}>
              <SheetIcon active={active} />
              {/* 同样的图标一排看不出谁是谁 ⇒ 右下角带序号（第几张） */}
              <span aria-hidden className={`absolute -right-0.5 -bottom-0.5 min-w-[14px] h-[14px] px-0.5 rounded-full text-[9px] leading-[14px] text-center font-medium ${active ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-600'}`}>{i + 1}</span>
            </button>
          )
        })}
        {!p.readonly && (
          <button type="button" onClick={p.onAdd} title={p.text.add} aria-label={p.text.add} data-testid="sheet-rail-add"
            className={`${railBtn} border border-dashed border-gray-300 text-gray-400 hover:text-blue-600 hover:border-blue-300 ${editorShell.softSurfaceHover}`}>
            <span aria-hidden className="text-base leading-none">＋</span>
          </button>
        )}
      </div>
      <button type="button" onClick={p.onOpenDrive} title={p.text.drive} aria-label={p.text.drive} data-testid="sheet-rail-drive"
        className={`${railBtn} text-gray-500 hover:text-gray-800 ${editorShell.softSurfaceHover}`}>
        {/* 硬碟图标 */}
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8} aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 14.25h18M3 14.25l2.4-7.2A1.5 1.5 0 0 1 6.82 6h10.36a1.5 1.5 0 0 1 1.42 1.05L21 14.25M3 14.25v3.75A1.5 1.5 0 0 0 4.5 19.5h15a1.5 1.5 0 0 0 1.5-1.5v-3.75M17.25 16.9h.01" />
        </svg>
      </button>
    </aside>
  )
}

export default function SheetLeftRail(p: SheetLeftRailProps) {
  const t = useSheetT()
  return <SheetLeftRailView {...p} text={{ expand: t('sheet_tab_list'), add: t('sheet_ctx_add'), drive: t('bf_scribe_drive_tab') }} />
}

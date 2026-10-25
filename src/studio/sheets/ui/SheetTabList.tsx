'use client'
// 表格页左栏「表格清單」
//   横的细长卡片一行一张（sheet 名＋右侧小圆点菜单）；右键＝同一份菜单：重新命名（就地改名·Enter 存·Esc 取消）／刪除（二次确认·最后一张不可删）／新增表格（末尾加一张）；
//   点卡片切换当前 sheet。规则（预设名／最后一张）在 engine/sheet-list.ts·这里只画。
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { useSheetT } from './host'
import { editorShell } from '../../shared/theme/editor-shell-theme'
import type { SheetTab } from '../engine/sheet-list'

export type SheetTabListProps = {
  sheets: SheetTab[]
  currentId: string | null
  readonly?: boolean
  onSelect: (id: string) => void
  onAdd: () => void
  onRename: (id: string, name: string) => Promise<boolean> | boolean
  onDelete: (id: string) => void
  /** 按下页签前问一声：true ⇒ 不抢焦点（编着公式要带去别张点格·编辑框别失焦提交） */
  holdFocus?: () => boolean
}

type Menu = { id: string; x: number; y: number }

export default function SheetTabList(p: SheetTabListProps) {
  const t = useSheetT()
  const [menu, setMenu] = useState<Menu | null>(null)
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menu) return
    const close = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(null) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null) }
    document.addEventListener('mousedown', close); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc) }
  }, [menu])
  useEffect(() => { if (renaming) { inputRef.current?.focus(); inputRef.current?.select() } }, [renaming?.id])   // eslint-disable-line react-hooks/exhaustive-deps

  const openMenu = (e: ReactMouseEvent, id: string) => {
    e.preventDefault(); e.stopPropagation()
    if (p.readonly) return
    // 菜单贴鼠标；靠右／靠底时往回收（视窗 160×120 估）
    const x = Math.min(e.clientX, window.innerWidth - 170), y = Math.min(e.clientY, window.innerHeight - 130)
    setMenu({ id, x, y })
  }
  const startRename = (id: string) => {
    const s = p.sheets.find(x => x.id === id); if (!s) return
    setMenu(null); setRenaming({ id, value: s.name })
  }
  const commitRename = async () => {
    if (!renaming) return
    const { id, value } = renaming
    setRenaming(null)
    const nm = value.trim()
    const before = p.sheets.find(x => x.id === id)?.name
    if (!nm || nm === before) return
    await p.onRename(id, nm)
  }
  const canDelete = p.sheets.length > 1

  return (
    <div className="flex-1 overflow-y-auto px-2 py-2 flex flex-col gap-1.5" data-testid="sheet-tab-list">
      {p.sheets.map(s => {
        const active = s.id === p.currentId
        const isRenaming = renaming?.id === s.id
        return (
          <div key={s.id}
            role="button" tabIndex={0}
            data-testid="sheet-card" data-sheet-id={s.id} data-active={active ? '1' : '0'}
            onMouseDown={e => { if (!isRenaming && e.button === 0 && p.holdFocus?.()) e.preventDefault() }}
            onClick={() => { if (!isRenaming) p.onSelect(s.id) }}
            onDoubleClick={() => { if (!p.readonly) startRename(s.id) }}
            onContextMenu={e => openMenu(e, s.id)}
            onKeyDown={e => { if (e.key === 'Enter' && !isRenaming) p.onSelect(s.id) }}
            className={`group relative flex items-center gap-2 h-8 px-2.5 rounded-lg border text-xs cursor-pointer select-none transition-colors ${active ? `${editorShell.driveFileRowCurrent} border-blue-200` : `bg-white border-gray-200 text-gray-600 ${editorShell.softSurfaceHover}`}`}>
            {/* 表格小图标（与云盘表格档同色系） */}
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={`w-3.5 h-3.5 shrink-0 ${active ? 'text-blue-500' : 'text-emerald-500'}`}><path fillRule="evenodd" d="M3 4.5A1.5 1.5 0 0 1 4.5 3h11A1.5 1.5 0 0 1 17 4.5v11a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 15.5v-11ZM4.5 7v2.25h4.75V7H4.5Zm6.25 0v2.25h4.75V7h-4.75Zm4.75 3.75h-4.75V13h4.75v-2.25Zm0 3.75h-4.75V15.5h4.75V14.5Zm-6.25 1V14.5H4.5v1h4.75Zm-4.75-2.5h4.75v-2.25H4.5V13Z" clipRule="evenodd"/></svg>
            {isRenaming ? (
              <input ref={inputRef} value={renaming!.value} data-testid="sheet-rename-input"
                onChange={e => setRenaming(r => (r ? { ...r, value: e.target.value } : r))}
                onBlur={() => { void commitRename() }}
                onKeyDown={e => {
                  if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() }
                  if (e.key === 'Escape') { e.preventDefault(); setRenaming(null) }
                }}
                onClick={e => e.stopPropagation()}
                maxLength={60}
                className="flex-1 min-w-0 h-6 px-1.5 text-xs text-gray-800 bg-white border border-blue-400 rounded outline-none" />
            ) : (
              <span className="flex-1 min-w-0 truncate">{s.name}</span>
            )}
            {!p.readonly && !isRenaming && (
              <button type="button" title="⋯" data-testid="sheet-card-more"
                onClick={e => openMenu(e, s.id)}
                className={`w-5 h-5 flex items-center justify-center rounded text-gray-400 hover:text-gray-700 hover:bg-gray-200 transition-opacity ${menu?.id === s.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor"><path d="M10 6a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm0 5.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm0 5.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Z"/></svg>
              </button>
            )}
          </div>
        )
      })}
      {!p.readonly && (
        <button type="button" onClick={p.onAdd} data-testid="sheet-add"
          className={`h-8 px-2.5 rounded-lg border border-dashed border-gray-300 text-xs text-gray-400 hover:text-blue-600 hover:border-blue-300 ${editorShell.softSurfaceHover} transition-colors text-left`}>
          ＋ {t('sheet_ctx_add')}
        </button>
      )}

      {menu && (
        <div ref={menuRef} data-testid="sheet-ctx-menu" style={{ position: 'fixed', left: menu.x, top: menu.y, zIndex: 9999 }} className={`min-w-[140px] ${editorShell.menu}`} onClick={e => e.stopPropagation()}>
          <button type="button" className={editorShell.menuItem} onClick={() => startRename(menu.id)}>{t('sheet_ctx_rename')}</button>
          <button type="button" disabled={!canDelete} title={canDelete ? undefined : t('sheet_delete_last')}
            className={`${editorShell.menuItem} ${canDelete ? 'hover:!bg-red-50 hover:!text-red-600' : 'opacity-50 cursor-not-allowed'}`}
            onClick={() => { if (!canDelete) return; const id = menu.id; setMenu(null); p.onDelete(id) }}>
            {t('sheet_ctx_delete')}
          </button>
          <div className={`my-1 border-t ${editorShell.divider}`} />
          <button type="button" className={editorShell.menuItem} onClick={() => { setMenu(null); p.onAdd() }}>{t('sheet_ctx_add')}</button>
        </div>
      )}
    </div>
  )
}

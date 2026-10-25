'use client'
// 剪辑页·顶栏「設定」窗：草稿位置／自动上传开关／自动上传存哪／汇出位置／自动调配算力（这几项要网站后端·宿主给 folders 与 compute 才出现）＋快捷键一览（都有）。
//   资料夹挑法＝云盘树（根目录一项＋树）。设定的形状、读回、路径字在 lib/upload.pure.ts；存这个浏览器由页面管。

import { useState } from 'react'
import { useStudioT } from '../../shared/StudioT'
import { folderOptions, folderPath, type FolderLike, type VeditSettings } from '../lib/upload.pure'

type TKey = string
/** 「自动调配算力」那颗开关的状态（宿主读写帐号偏好）。unknown＝读不到存着的值：不画成开、不让翻，只给重读（reload） */
export type ComputeSwitch = { loaded: boolean; on: boolean; unknown?: boolean; busy: boolean; failed: boolean; flip: () => Promise<void> | void; reload?: () => void }

type FolderKey = 'draftFolderId' | 'uploadFolderId' | 'exportFolderId'

/** drive＝云盘那几项要的资料夹（没有 ⇒ 不画草稿位置、自动上传、上传位置、汇出位置）；compute＝自动调配算力开关（没有 ⇒ 不画） */
export default function VeditSettingsDialog({ value, drive, compute, onChange, onClose }: {
  value: VeditSettings
  drive: { folders: readonly FolderLike[]; loading: boolean } | null
  compute: ComputeSwitch | null
  onChange: (v: VeditSettings) => void
  onClose: () => void
}) {
  const t = useStudioT()
  const folders = drive?.folders ?? []
  const foldersLoading = drive?.loading ?? false
  const [picking, setPicking] = useState<FolderKey | null>(null)
  const [pickSel, setPickSel] = useState<string | null | undefined>(undefined)
  const [keysOpen, setKeysOpen] = useState(false)
  const root = t('vedit_set_root')
  const pathOf = (id: string | null, key?: FolderKey) => (id === null && key === 'uploadFolderId' ? t('vedit_set_follow_project') : folderPath(folders, id, root) ?? t('vedit_set_folder_missing'))

  const folderRow = (key: FolderKey, label: TKey, note: TKey | null) => (
    <div className="py-3 border-b border-neutral-800" data-testid={`vedit-set-${key}`}>
      <div className="flex items-center gap-2">
        <span className="text-sm text-neutral-200">{t(label)}</span>
        <button type="button" data-testid={`vedit-set-${key}-pick`} onClick={() => { setPicking(key); setPickSel(value[key]) }}
          className="ml-auto h-7 px-2.5 rounded-md bg-neutral-800 hover:bg-neutral-700 text-xs text-neutral-200">{t('vedit_set_change')}</button>
      </div>
      <div className="mt-1 text-xs text-neutral-400 truncate" data-testid={`vedit-set-${key}-path`}>{foldersLoading && value[key] ? '…' : pathOf(value[key], key)}</div>
      {note && <div className="mt-0.5 text-[11px] text-neutral-500">{t(note)}</div>}
    </div>
  )

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 px-4" onClick={onClose} data-testid="vedit-settings">
      <div className="w-full max-w-md rounded-xl bg-neutral-900 border border-neutral-700 shadow-2xl p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center mb-1">
          <span className="text-base font-semibold text-neutral-100">{t('vedit_settings')}</span>
          <button type="button" onClick={onClose} aria-label={t('vedit_set_close')} className="ml-auto w-7 h-7 rounded-md text-neutral-400 hover:bg-neutral-800">×</button>
        </div>
        {picking ? (
          <div data-testid="vedit-set-picker">
            <div className="text-sm text-neutral-300 mb-2">{t('vedit_set_pick_title')}</div>
            <div className="max-h-64 overflow-y-auto rounded-lg border border-neutral-800 py-1 mb-3">
              <button type="button" onClick={() => setPickSel(null)} data-testid="vedit-set-pick-root"
                className={`w-full text-left px-3 py-1.5 text-sm ${pickSel === null ? 'bg-cyan-900/50 text-cyan-200' : 'text-neutral-300 hover:bg-neutral-800'}`}>{root}</button>
              {folderOptions(folders).map((f) => (
                <button key={f.id} type="button" onClick={() => setPickSel(f.id)} data-testid="vedit-set-pick-folder" data-folder-id={f.id}
                  style={{ paddingLeft: 12 + (f.depth + 1) * 14 }}
                  className={`w-full text-left pr-3 py-1.5 text-sm truncate ${pickSel === f.id ? 'bg-cyan-900/50 text-cyan-200' : 'text-neutral-300 hover:bg-neutral-800'}`}>📁 {f.name}</button>
              ))}
              {foldersLoading && <div className="px-3 py-1.5 text-xs text-neutral-500">…</div>}
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setPicking(null)} className="h-8 px-3 rounded-md text-sm text-neutral-300 hover:bg-neutral-800">{t('vedit_cancel')}</button>
              <button type="button" disabled={pickSel === undefined} data-testid="vedit-set-pick-ok"
                onClick={() => { if (pickSel === undefined) return; onChange({ ...value, [picking]: pickSel }); setPicking(null) }}
                className="h-8 px-3 rounded-md text-sm bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white">{t('vedit_set_ok')}</button>
            </div>
          </div>
        ) : (
          <div>
            {drive && <>
            {folderRow('draftFolderId', 'vedit_set_draft', 'vedit_set_draft_note')}
            <div className="py-3 border-b border-neutral-800">
              <label className="flex items-center gap-2 cursor-pointer">
                <span className="text-sm text-neutral-200">{t('vedit_set_auto_upload')}</span>
                <input type="checkbox" checked={value.autoUpload} data-testid="vedit-set-auto-upload"
                  onChange={(e) => onChange({ ...value, autoUpload: e.target.checked })} className="ml-auto w-4 h-4 accent-cyan-500" />
              </label>
              <div className="mt-0.5 text-[11px] text-neutral-500">{t('vedit_set_auto_upload_note')}</div>
            </div>
            {folderRow('uploadFolderId', 'vedit_set_upload_folder', null)}
            {folderRow('exportFolderId', 'vedit_set_export', 'vedit_set_export_note')}
            </>}
            {/* 自动调配算力：存帐号偏好（换电脑也一样·网站设定「裝置」页同一颗） */}
            {compute && (
            <div className="py-3 border-b border-neutral-800">
              <label className="flex items-center gap-2 cursor-pointer">
                <span className="text-sm text-neutral-200">{t('vedit_compute_title')}</span>
                <input type="checkbox" checked={compute.on} disabled={!compute.loaded || compute.busy || !!compute.unknown} data-testid="vedit-set-auto-compute"
                  data-state={compute.unknown ? 'unknown' : compute.on ? 'on' : 'off'} aria-invalid={compute.unknown || undefined}
                  onChange={() => void compute.flip()} className="ml-auto w-4 h-4 accent-cyan-500 disabled:opacity-40" />
              </label>
              <div className="mt-0.5 text-[11px] text-neutral-500">{t('vedit_compute_desc')}</div>
              {compute.unknown && (
                <div className="mt-0.5 flex items-center gap-2 text-[11px] text-red-400" data-testid="vedit-set-auto-compute-unknown">
                  <span>{t('vedit_compute_read_fail')}</span>
                  {compute.reload && <button type="button" onClick={() => compute.reload?.()} className="underline hover:text-red-300">{t('vedit_audio_retry')}</button>}
                </div>
              )}
              {compute.failed && <div className="mt-0.5 text-[11px] text-red-400" data-testid="vedit-set-auto-compute-fail">{t('vedit_compute_fail')}</div>}
            </div>
            )}
            {/* 原本播放器下的「快捷键」按钮搬来这里·点开看全部快捷键 */}
            <div className="py-3" data-testid="vedit-set-shortcuts">
              <button type="button" onClick={() => setKeysOpen((v) => !v)} aria-expanded={keysOpen} data-testid="vedit-set-shortcuts-toggle"
                className="w-full flex items-center gap-2 text-left text-sm text-neutral-200">
                <span aria-hidden>⌨</span>{t('vedit_shortcuts')}
                <span className={`ml-auto text-neutral-500 transition-transform ${keysOpen ? 'rotate-90' : ''}`} aria-hidden>›</span>
              </button>
              {keysOpen && <div className="mt-2 max-h-64 overflow-y-auto rounded-lg bg-neutral-950/60 px-3 py-2 text-[11px] leading-5 text-neutral-400 whitespace-pre-line" data-testid="vedit-set-shortcuts-body">{t('vedit_shortcuts_body')}</div>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

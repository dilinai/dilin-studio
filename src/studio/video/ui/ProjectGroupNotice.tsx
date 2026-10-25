'use client'
type TKey = string
import type { ProjectGroupNotice } from '../lib/project-group-notice.pure'

/** 頂欄下的非阻塞提示，不佔用一般操作的短暫通知，也不受素材頁籤切換影響。 */
export default function VeditProjectGroupNotice({ notice, projectId, t, onClose }: {
  notice: ProjectGroupNotice | null; projectId: string | null; t: (key: TKey) => string; onClose: () => void
}) {
  if (!notice || notice.projectId !== projectId) return null
  return (
    <div className="shrink-0 flex items-start gap-3 border-b border-amber-900/50 bg-neutral-900 px-4 py-2 text-xs text-amber-200" role="status" aria-live="polite" data-testid="vedit-project-group-notice">
      <div className="flex-1 min-w-0 leading-relaxed">
        {notice.repaired && <p data-testid="vedit-project-group-repaired">{t('vedit_proj_groups_repaired')}</p>}
        {notice.review && <p data-testid="vedit-project-group-review">{t('vedit_proj_groups_review')}</p>}
      </div>
      <button type="button" onClick={onClose} aria-label={t('vedit_set_close')} title={t('vedit_set_close')} data-testid="vedit-project-group-notice-close"
        className="shrink-0 rounded px-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100">×</button>
    </div>
  )
}

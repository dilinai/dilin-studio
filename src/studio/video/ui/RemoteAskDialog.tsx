'use client'
// 剪辑页·手上有没存的改动时别处（角色、别的分页）改了这份工程 ⇒ 先问：套用别处的版本／保留我的改动／合併兩邊（合不了就不给合併）·⛔ 自己整份换掉。
import { useStudioT } from '../../shared/StudioT'

export default function VeditRemoteAskDialog({ canMerge, onPick }: { canMerge: boolean; onPick: (how: 'apply' | 'mine' | 'merge') => void }) {
  const t = useStudioT()
  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/50 px-4" data-testid="vedit-remote-ask">
      <div className="w-full max-w-md rounded-xl bg-neutral-900 border border-neutral-700 shadow-2xl p-4">
        <div className="text-sm font-semibold text-neutral-100 mb-1">{t('vedit_remote_title')}</div>
        <div className="text-xs text-neutral-400 mb-4 leading-relaxed">{t(canMerge ? 'vedit_remote_body' : 'vedit_remote_body_nomerge')}</div>
        <div className="flex flex-col gap-2">
          {canMerge && (
            <button type="button" data-testid="vedit-remote-merge" onClick={() => onPick('merge')}
              className="h-9 px-3 rounded-md text-sm bg-cyan-600 hover:bg-cyan-500 text-white text-left">{t('vedit_remote_merge')}</button>
          )}
          <button type="button" data-testid="vedit-remote-apply" onClick={() => onPick('apply')}
            className="h-9 px-3 rounded-md text-sm bg-neutral-700 hover:bg-neutral-600 text-neutral-100 text-left">{t('vedit_remote_apply')}</button>
          <button type="button" data-testid="vedit-remote-mine" onClick={() => onPick('mine')}
            className="h-9 px-3 rounded-md text-sm bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-left">{t('vedit_remote_mine')}</button>
        </div>
      </div>
    </div>
  )
}

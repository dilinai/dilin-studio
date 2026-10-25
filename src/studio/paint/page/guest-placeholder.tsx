'use client'
// 外框还没给游客宿主时（外框照旧用 StudioShell＋Editor 那条）用的占位宿主：
//   云盘那格、对话那格先放一块说明（工程清单＋存放位置、复制仓库给 AI 由外框的游客宿主给），has() 全回 false。
//   外框改成整页渲染 guestPage（带它自己的游客宿主）之后，这一档只剩 Editor 那条兜底在用。
import type { ReactNode } from 'react'
import type { EditorProps } from '../../shared/types'
import type { StudioPageHost } from '../../shared/page-host'
import { studioHref } from '../../shared/host'
import { useStudioT } from '../../shared/StudioT'
import GuestPaintPage from './GuestPaintPage'

function Slot({ k, titleIcon }: { k: 'drive' | 'chat'; titleIcon?: ReactNode }) {
  const t = useStudioT()
  if (k === 'drive') {
    return <div className="h-full p-3 text-xs leading-relaxed text-neutral-400 bg-[#262626]" data-testid="paint-slot-placeholder-drive">{t('studio_back_list')}</div>
  }
  // 对话那格：页头左边放页面给的收合钮（同登入版角色名左边那格）
  return (
    <div className="h-full flex flex-col bg-[#FAF9F5] text-[#4A3528]" data-testid="paint-slot-placeholder-chat">
      <div className="h-10 shrink-0 flex items-center gap-2 px-2 border-b border-[#EEE4B8] text-sm font-semibold">{titleIcon}<span>{t('studio_ai_title')}</span></div>
    </div>
  )
}

export const placeholderGuestHost: StudioPageHost = {
  kind: 'guest',
  renderHomeBrand: () => <a href={studioHref.root()}>Dilin Studio</a>,
  renderDriveSlot: () => <Slot k="drive" />,
  renderChatSlot: (o) => <Slot k="chat" titleIcon={o?.titleIcon} />,
  has: () => false,
}

/** StudioShell 那条（外框还不认 guestPage 时）：照样渲染整页，宿主用占位那只 */
export default function PaintGuestEditor(props: EditorProps) {
  return <GuestPaintPage {...props} host={placeholderGuestHost} />
}

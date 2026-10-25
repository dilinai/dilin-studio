// 编辑器整页的宿主接口。
// 每个编辑器的整页（顶栏、左栏、工具列、编辑区、右栏）只有一份，放在 <编辑器>/page/；
// 登入版页面（网站）与游客版（/studio/<编辑器>/<编号>）都渲染这一份，差别全经宿主进来：
//   登入版宿主＝网站接线（登入、云盘、角色对话、生成、上传、存档 API）；
//   游客版宿主＝本机存档（shared/store.ts 的 OPFS／资料夹），要后端的功能 has() 回 false、页面就不画那颗钮。
// 两格固定位置由宿主决定内容：
//   renderDriveSlot：登入版「云盘／硬碟」区块那一格 ⇒ 登入版云盘树；游客版工程清单＋存放位置。
//   renderChatSlot：登入版角色对话框那一格 ⇒ 登入版角色对话；游客版「复制给 AI」（给仓库）。
// 每个编辑器在自己的 page/host.ts 里 extends StudioPageHost，加自己要的资料操作（读写工程、传素材…）。

import type { ComponentType, ReactNode } from 'react'
import type { EditorProps } from './types'

export type StudioHostKind = 'site' | 'guest'

export interface DriveSlotOptions {
  /** 'dark'＝暗底编辑器（剪辑）。 */
  variant?: 'light' | 'dark'
}

export interface ChatSlotOptions {
  dense?: boolean
  title?: string
  titleIcon?: ReactNode
  headerExtra?: ReactNode
}

export interface HomeBrandOptions {
  iconOnly?: boolean
  tone?: 'light' | 'dark'
  testId?: string
}

export interface StudioPageHost {
  kind: StudioHostKind
  /** 左上角品牌：登入版回网站首页；游客版回 /studio 总页。 */
  renderHomeBrand(opts?: HomeBrandOptions): ReactNode
  /** 登入版云盘区块那一格的内容（只管内容、填满那格；页签、宽度、收合仍由页面照登入版画）。 */
  renderDriveSlot(opts?: DriveSlotOptions): ReactNode
  /** 云盘区块那一格的页签名。登入版不给 ⇒ 页面用自己那句（雲端硬碟／硬碟／雲盤）；游客版＝專案（里面是工程清单）。 */
  driveSlotLabel?: string
  /** 登入版角色对话框那一格的内容。 */
  renderChatSlot(opts?: ChatSlotOptions): ReactNode
  /** 角色对话框那一格的名字（收起时的提示字等）。登入版不给 ⇒ 页面用自己那句（选择角色）；游客版＝「复制给 AI」那格的标题。 */
  chatSlotLabel?: string
  /** 这个宿主有没有某项功能（键名由各编辑器在自己的删减清单里列）。游客版：要后端的一律 false。 */
  has(feature: string): boolean
}

/** 游客版整页收到的 props：EditorProps（工程存档、flush、存档状态）＋宿主。 */
export interface GuestPageProps extends EditorProps {
  host: StudioPageHost
}

export type GuestPageComponent = ComponentType<GuestPageProps>

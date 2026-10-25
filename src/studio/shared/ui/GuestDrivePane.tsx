'use client'
// 网站上游客版左栏（游客宿主 renderDriveSlot 的内容）：外观照登入版云盘那格，游客没有云盘 ⇒
//   上面一行「我的雲端硬碟」标题、中间一句「登入後即可使用雲端硬碟」＋登入钮（开新分页·登入完回到这页）、
//   最下面「下載到電腦」（把正在开的这一份存成 zip·同原工程栏的汇出）。
//   一个网址就是一份作品：不列多份工程、不汇入。
//   开源单机版也用这格（同一个样子），多给 folder ⇒ 「下載到電腦」上面多一块：存在哪＋「選擇資料夾」（选了这份就存进那个资料夾·本机 AI 直接改 project.json）；
//   不能挑资料夹的浏览器只显示一句提示。
//   行与按钮用 editorShell.drive* 那组 class；暗底编辑器（剪辑、画板）给 variant='dark'。

import { useStudioT } from '../StudioT'
import { editorShell, editorShellDarkDrive } from '../theme/editor-shell-theme'
import { LOGIN_HREF } from '../host'

export interface GuestDrivePaneProps {
  variant?: 'light' | 'dark'
}

const TONE = {
  light: { ...editorShell, text: 'text-gray-500', icon: 'text-gray-300', login: 'bg-[#4A3528] text-white keep-white hover:bg-[#5C4434]' },
  dark: { ...editorShellDarkDrive, text: 'text-neutral-400', icon: 'text-neutral-600', login: 'bg-cyan-600 text-white keep-white hover:bg-cyan-500' },
} as const

/** 登入钮的去处：登入完回到当下这页（只带路径与查询·#p= 那段不经服务器、也不带进 next）。 */
export function guestLoginHref(loc: { pathname: string; search: string } | null): string {
  if (!loc || !LOGIN_HREF.startsWith('/')) return LOGIN_HREF
  return `${LOGIN_HREF}?next=${encodeURIComponent(loc.pathname + loc.search)}`
}

export default function GuestDrivePane(p: GuestDrivePaneProps) {
  const t = useStudioT()
  const sh = TONE[p.variant ?? 'light']
  return (
    <div data-testid="studio-guest-drive" data-variant={p.variant ?? 'light'} className="flex-1 min-h-0 flex flex-col">
      <div className="flex items-center justify-between px-3 pt-2.5 pb-1.5">
        <span className={sh.driveHeaderText} data-testid="studio-guest-drive-title">{t('studio_guest_drive_title')}</span>
      </div>
      <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-3 px-4 text-center">
        <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" strokeWidth={1.5} className={sh.icon} aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15a4.5 4.5 0 0 0 4.5 4.5H18a3.75 3.75 0 0 0 1.332-7.257 3 3 0 0 0-3.758-3.848 5.25 5.25 0 0 0-10.233 2.33A4.502 4.502 0 0 0 2.25 15Z" />
        </svg>
        <p className={`text-sm leading-relaxed ${sh.text}`} data-testid="studio-guest-drive-hint">{t('studio_guest_drive_login_hint')}</p>
        <a href={LOGIN_HREF} target="_blank" rel="noopener" data-testid="studio-guest-drive-login"
          onClick={e => { e.preventDefault(); window.open(guestLoginHref(window.location), '_blank', 'noopener') }}
          className={`inline-flex items-center justify-center h-8 px-5 rounded-lg text-sm font-semibold ${sh.login}`}>
          {t('studio_guest_login')}
        </a>
      </div>
    </div>
  )
}

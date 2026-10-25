// 单页入口：照网址的 ?app=<编辑器>&id=<工程编号> 决定画哪一页（跟网站 /studio、/studio/<编辑器>、/studio/<编辑器>/<编号> 三页同一份元件）。
//   没有 app ⇒ 总页；有 app 没 id ⇒ 直开（新开一份，或读进 ?import=／#p= 带来的那份）；都有 ⇒ 工程页。
//   直接双击 index.html（file://）时浏览器不给「存在浏览器里」那块储存（OPFS）⇒ 只显示一句话，请用仓根的启动档打开。
import { createRoot } from 'react-dom/client'
import { isStudioAppId } from '../studio/shared/types'
import { resolveStudioLang } from '../studio/shared/i18n'
import StudioHome from '../studio/shared/ui/StudioHome'
import DirectOpen from '../studio/shared/ui/DirectOpen'
import ProjectPage from '../studio/shared/ui/ProjectPage'
import DialogHost from './DialogHost'

const FILE_NOTICE = {
  'zh-TW': ['請用啟動檔打開', '直接點開 index.html 時，瀏覽器不給網頁存工程的地方。請回到這個資料夾的上一層，點兩下啟動檔：Windows 用 start-windows.bat，Mac 用 start-mac.command，Linux 用 start-linux。它會在 http://localhost:41730 打開同一個畫面。'],
  'zh-CN': ['请用启动文件打开', '直接点开 index.html 时，浏览器不给网页存工程的地方。请回到这个文件夹的上一层，双击启动文件：Windows 用 start-windows.bat，Mac 用 start-mac.command，Linux 用 start-linux。它会在 http://localhost:41730 打开同一个画面。'],
  en: ['Please open it with a start file', 'When index.html is opened directly, the browser gives the page no place to keep projects. Go one folder up and double-click the start file for your system: start-windows.bat (Windows), start-mac.command (Mac) or start-linux (Linux). It opens the same page at http://localhost:41730.'],
} as const

function FileNotice() {
  const [title, body] = FILE_NOTICE[resolveStudioLang()]
  return (
    <div className="min-h-screen bg-[#FAFAF8] text-[#4A3528] flex items-center justify-center p-6" data-testid="studio-file-notice">
      <div className="max-w-md w-full rounded-2xl border border-[#E7DCBE] bg-white p-6 shadow-[0_6px_16px_rgba(75,65,28,0.06)]">
        <h1 className="text-lg font-bold">{title}</h1>
        <p className="mt-2 text-sm text-[#6E5B45] leading-relaxed">{body}</p>
      </div>
    </div>
  )
}

function Route() {
  if (window.location.protocol === 'file:') return <FileNotice />
  const q = new URLSearchParams(window.location.search)
  const app = q.get('app')
  const id = q.get('id')
  if (!isStudioAppId(app)) return <StudioHome />
  if (!id) return <DirectOpen app={app} />
  return <ProjectPage app={app} id={id} />
}

createRoot(document.getElementById('root')!).render(
  <>
    <Route />
    <DialogHost />
  </>,
)

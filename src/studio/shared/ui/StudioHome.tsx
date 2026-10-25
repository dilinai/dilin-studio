'use client'
// /studio 总页：列五个编辑器。点图示＝开新分页（带 ?new=1·与 /dilin 顶栏图示同：一定新开一份空白作品），直接在这个浏览器开一份新工程进编辑页（/studio/<编辑器> 那页不停留·见 DirectOpen.tsx）。

import { useEffect, useState } from 'react'
import { STUDIO_APP_IDS } from '../types'
import { studioHref } from '../host'
import { useStudioT } from '../StudioT'
import { canPickFolder } from '../fs-types'
import { AppIcon, StudioPageFrame, appNameKey } from './common'

function Inner() {
  const t = useStudioT()
  const [folderOk, setFolderOk] = useState(true)
  useEffect(() => { setFolderOk(canPickFolder()) }, [])
  return (
    <div data-testid="studio-home">
      <h1 className="text-3xl font-bold tracking-tight">{t('studio_name')}</h1>
      <p className="mt-2 text-[15px] text-[#6E5B45] leading-relaxed max-w-2xl">{t('studio_tagline')}</p>
      {!folderOk && <p className="mt-2 text-[13px] text-amber-700" data-testid="studio-browser-only">{t('studio_browser_only')}</p>}
      <h2 className="mt-8 text-sm font-semibold text-[#8A7B66]">{t('studio_all_apps')}</h2>
      <ul className="mt-3 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
        {STUDIO_APP_IDS.map(app => (
          <li key={app}>
            <a href={studioHref.appNew(app)} target="_blank" rel="noopener" data-testid={`studio-app-${app}`}
              className="flex flex-col items-center gap-3 rounded-2xl border border-[#E7DCBE] bg-white/80 px-4 py-6 shadow-[0_6px_16px_rgba(75,65,28,0.06)] hover:bg-[#FBF8EF] hover:-translate-y-0.5 transition-all">
              <AppIcon app={app} size={48} />
              <span className="font-semibold">{t(appNameKey(app))}</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function StudioHome() {
  return <StudioPageFrame><Inner /></StudioPageFrame>
}

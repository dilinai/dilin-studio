'use client'
// 「第三方授權」小窗：剪辑编辑器用到的开源程序、授权与原始码出处，链到授权全文（网站静态档 /vedit/licenses/）。
// 开发者看的完整清单在同目录 THIRD_PARTY.md。
import { useStudioT } from '../shared/StudioT'
import { studioStaticHref } from '../shared/host'

const LICENSE_FILES = [
  { name: 'MPL-2.0', href: studioStaticHref('/vedit/licenses/MPL-2.0.txt') },
  { name: 'LGPL-2.1', href: studioStaticHref('/vedit/licenses/LGPL-2.1.txt') },
  { name: 'EffectCraft MIT', href: studioStaticHref('/vedit/licenses/EffectCraft-LICENSE-MIT.txt') },
  { name: 'README', href: studioStaticHref('/vedit/licenses/README.md') },
] as const

const ITEMS = [
  { name: 'Mediabunny 1.61.3', license: 'MPL-2.0', source: 'https://github.com/Vanilagy/mediabunny' },
  { name: '@mediabunny/aac-encoder 1.61.3', license: 'MPL-2.0', source: 'https://github.com/Vanilagy/mediabunny/tree/main/packages/aac-encoder' },
  { name: 'FFmpeg libavcodec 62.23.103 / libavutil', license: 'LGPL-2.1-or-later', source: 'https://github.com/FFmpeg/FFmpeg' },
  { name: 'EffectCraft keyframe (© ArtCraft Team and the EffectCraft contributors)', license: 'MIT', source: 'https://github.com/storytold/effectcraft' },
  { name: 'JSZip 3.10.1', license: 'MIT', source: 'https://github.com/Stuk/jszip' },
] as const

export default function LicensesDialog({ onClose }: { onClose: () => void }) {
  const t = useStudioT()
  const link = 'text-cyan-300 hover:text-cyan-200 underline'
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 px-4" onClick={onClose} data-testid="vedit-licenses">
      <div className="w-full max-w-lg rounded-xl bg-neutral-900 border border-neutral-700 shadow-2xl p-4 text-sm text-neutral-300" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center mb-3">
          <span className="text-base font-semibold text-neutral-100">{t('vedit_guest_licenses_title')}</span>
          <button type="button" onClick={onClose} aria-label={t('vedit_export_close')} className="ml-auto w-7 h-7 rounded-md text-neutral-400 hover:bg-neutral-800">×</button>
        </div>
        <p className="mb-2">
          {t('vedit_guest_licenses_intro')}{' '}
          {LICENSE_FILES.map((f, i) => <span key={f.href}>{i ? '、' : ''}<a href={f.href} target="_blank" rel="noopener noreferrer" className={link} data-testid="vedit-license-file">{f.name}</a></span>)}
        </p>
        <ul className="mb-3 space-y-1">
          {ITEMS.map((it) => (
            <li key={it.name} className="flex flex-wrap gap-x-2">
              <span className="text-neutral-100">{it.name}</span>
              <span className="text-neutral-500">{it.license}</span>
              <a href={it.source} target="_blank" rel="noopener noreferrer" className={link}>{t('vedit_guest_licenses_source')}</a>
            </li>
          ))}
        </ul>
        <p className="mb-2 text-xs leading-relaxed text-neutral-400">{t('vedit_guest_licenses_ffmpeg')}</p>
        <p className="text-xs leading-relaxed text-neutral-400">{t('vedit_guest_licenses_own')}</p>
      </div>
    </div>
  )
}

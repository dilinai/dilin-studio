'use client'
import { neonFileHref, type NeonIconName } from './neon-files'

// 概念名 → 128px 文件的表在 ./neon-files.ts（开源包照它拷图）
export type { NeonIconName }

// SkillKey → neon 概念（替代各处 skillIcon() 的 emoji 三元）
export const SKILL_NEON: Record<string, NeonIconName> = {
  AiScribe: 'doc',
  AiSlides: 'report',
  MySite:   'web',
  AiImage:  'image',
  AiVideo:  'video',
  AiAudio:  'music',
  BrowserCast: 'web',
  AiSheet:  'board',
  TerminalCast: 'board',
}

/** 取某 skill 的 neon 概念名（无映射兜底 image·不抛错）。 */
export function skillNeon(skill: string | undefined | null): NeonIconName {
  return (skill && SKILL_NEON[skill]) || 'image'
}

/** 取 neon 图标的 public 路径（给命令式 DOM / HTML 字符串场景用·非 JSX）。 */
export function neonIconSrc(opts: { name?: NeonIconName; skill?: string | null }): string {
  const key: NeonIconName = opts.name ?? skillNeon(opts.skill)
  return neonFileHref(key)
}

export function NeonIcon({
  name,
  skill,
  className = 'w-5 h-5',
  alt = '',
}: {
  /** 直接给概念名（chat/video/gear/…）；与 skill 二选一。 */
  name?: NeonIconName
  /** 或给 SkillKey（AiImage/AiVideo/…）自动映射概念。 */
  skill?: string | null
  className?: string
  alt?: string
}) {
  const key: NeonIconName = name ?? skillNeon(skill)
  // eslint-disable-next-line @next/next/no-img-element  // 静态小图标·plain img 足够（next/image 需 width/height 反增复杂）
  return (
    <img
      src={neonFileHref(key)}
      alt={alt}
      draggable={false}
      className={`object-contain shrink-0 select-none ${className}`}
    />
  )
}

"use client";

// 网址四形态 · 纯展示组件——编辑器 NodeView 与分享只读页（MarkdownView）共用同一份·
// 保证「访客看到的 = 作者选定的」。
// 名称三级链：链接自带文字(title) → og title(存进 title) → 域名。
import { useState } from 'react';
import { hostnameOf, type LinkDisplayMode } from '../../core/links';

export interface LinkCardDisplayProps {
  href: string;
  displayMode: LinkDisplayMode;
  title: string | null;
  description: string | null;
  image: string | null;
  favicon: string | null;
  /** og 还没回来时的骨架态（编辑器切卡片瞬间）·分享页不用 */
  loading?: boolean;
  className?: string;
}

const inlineLinkCls = 'text-blue-600 hover:underline dark:text-blue-400';

export default function LinkCardDisplay({ href, displayMode, title, description, image, favicon, loading, className }: LinkCardDisplayProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const [favFailed, setFavFailed] = useState(false);
  const name = (title && title.trim()) || hostnameOf(href);

  // ① 原网址：全 url·可点·新开 tab
  if (displayMode === 'url') {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={`${inlineLinkCls} break-all ${className ?? ''}`}>
        {href}
      </a>
    );
  }
  // ② 名称：只显名称
  if (displayMode === 'name') {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={`${inlineLinkCls} break-words ${className ?? ''}`}>
        {name}
      </a>
    );
  }

  // ③④ 卡片/大卡片。无 og 封面（或加载失败）→ 大卡片降级为小卡片。
  const showCover = displayMode === 'cardLarge' && !!image && !imgFailed;
  const iconEl = favicon && !favFailed ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={favicon} alt="" className="h-5 w-5 shrink-0 rounded" onError={() => setFavFailed(true)} />
  ) : (
    <svg className="h-5 w-5 shrink-0 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`not-prose my-1.5 block w-full max-w-md overflow-hidden rounded-xl border border-gray-200 bg-white no-underline shadow-sm transition hover:shadow-md dark:border-gray-700 dark:bg-gray-800 ${className ?? ''}`}
    >
      {showCover && (
        // og 封面=外站 og:image
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image!} alt="" loading="lazy" className="block h-40 w-full object-cover" onError={() => setImgFailed(true)} />
      )}
      <span className="flex items-center gap-2.5 px-3 py-2.5">
        {iconEl}
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-sm font-medium text-gray-900 dark:text-gray-100 ${loading ? 'animate-pulse' : ''}`}>
            {name}
          </span>
          <span className="block truncate text-xs text-gray-500 dark:text-gray-400">
            {(description && description.trim()) || href}
          </span>
        </span>
      </span>
    </a>
  );
}

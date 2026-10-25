'use client';


import React, { useEffect, useRef, useState } from 'react';
import { useDocsMedia } from '../env';

export interface VideoViewProps {
  src: string;
  name: string;
  size: number | null;
  thumbnail: string | null;
  ratio?: number;         // 既有 videoBlock 兼容字段（预览视图容器宽高比）
  /** 分享只读页访客态：渲染完全一致·仅语义标记（工具条由上层编辑态挂·本组件本就不含） */
  readOnly?: boolean;
  onThumbnail?: (url: string) => void;
}

// 文件名兜底：name attr 空 → 从 src 路径末段推（decodeURIComponent 失败按原文）
export function videoDisplayName(name: string, src: string): string {
  if (name) return name;
  try {
    const path = src.split('?')[0].split('#')[0];
    const seg = path.split('/').filter(Boolean).pop() || '';
    return seg ? decodeURIComponent(seg) : '影片';
  } catch { return src.split('/').pop() || '影片'; }
}

// byte → 人话（镜像 VideoUploader.formatSize 口径·MB 一位小数）
export function formatVideoSize(bytes: number | null): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ── 缩略图获取──
//   attr 有值直接用；null 才抓；抓失败/ok:false → null（卡片画默认图标）·绝不阻塞渲染。
//   模块级 Map 记「抓过但没有」的 src·同页多节点/重渲不风暴（成功结果走 attrs 持久化·失败结果这里挡）。
const thumbFetched = new Map<string, string | null>();

function useVideoThumbnail(src: string, thumbnail: string | null, onThumbnail?: (url: string) => void) {
  const media = useDocsMedia();
  const [fetched, setFetched] = useState<string | null>(() => thumbFetched.get(src) ?? null);
  const askedRef = useRef(false);
  useEffect(() => {
    if (thumbnail || !src || askedRef.current) return;
    if (thumbFetched.has(src)) { setFetched(thumbFetched.get(src) ?? null); return; }
    askedRef.current = true;
    let alive = true;
    void (async () => {
      try {
        const url = await media.videoThumbnail(src);
        thumbFetched.set(src, url);
        if (!alive) return;
        if (url) {
          setFetched(url);
          onThumbnail?.(url); // 编辑态回写 attrs 持久化
        }
      } catch { thumbFetched.set(src, null); /* 网络失败 → 默认图标 */ }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, thumbnail]);
  return thumbnail || fetched;
}

// 默认图标（无缩略图降级·胶片 SVG·不发外部请求）
function FilmIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className={className} aria-hidden>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M7 5v14M17 5v14M3 9h4M3 15h4M17 9h4M17 15h4" />
    </svg>
  );
}

function PlayIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M8 5.5v13l11-6.5-11-6.5z" />
    </svg>
  );
}

// ── ① 文本视图：一行文件名·可点（点了原地展开播放器·再点收起）────────────────
export function VideoTextView({ src, name, size, ratio, readOnly }: VideoViewProps) {
  const { Video } = useDocsMedia();
  const [playing, setPlaying] = useState(false);
  const label = videoDisplayName(name, src);
  return (
    <div className="video-view-text my-1" data-video-view="text" data-readonly={readOnly ? 'true' : undefined}>
      <button
        type="button"
        onClick={() => setPlaying(v => !v)}
        className="inline-flex items-center gap-1.5 text-blue-600 hover:underline text-[15px] leading-relaxed break-all text-left"
        title={label}
      >
        <PlayIcon className="w-3.5 h-3.5 shrink-0" />
        <span>{label}</span>
      </button>
      {playing && (
        <div className="mt-2 max-w-[640px]">
          <Video src={src} controls autoPlay playsInline preload="metadata" className="w-full rounded-lg bg-black" style={{ aspectRatio: String(ratio || 16 / 9) }} />
        </div>
      )}
    </div>
  );
}

// ── ② 卡片视图：缩略图(或默认图标)+名+大小+播放钮 ──
export function VideoCardView({ src, name, size, thumbnail, ratio, readOnly, onThumbnail }: VideoViewProps) {
  const { Video } = useDocsMedia();
  const [playing, setPlaying] = useState(false);
  const [thumbBroken, setThumbBroken] = useState(false);
  const thumb = useVideoThumbnail(src, thumbnail, readOnly ? undefined : onThumbnail);
  const label = videoDisplayName(name, src);
  const sizeText = formatVideoSize(size);

  if (playing) {
    // 点播放钮 → 原地换嵌入播放器（本地态·不改存储的 displayMode）
    return (
      <div className="video-view-card my-2 max-w-[640px]" data-video-view="card" data-readonly={readOnly ? 'true' : undefined}>
        <Video src={src} controls autoPlay playsInline preload="metadata" className="w-full rounded-xl bg-black" style={{ aspectRatio: String(ratio || 16 / 9) }} />
      </div>
    );
  }

  return (
    <div
      className="video-view-card my-2 max-w-[560px] flex items-center gap-3 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 transition-colors p-2.5 pr-4"
      data-video-view="card"
      data-readonly={readOnly ? 'true' : undefined}
    >
      {/* 缩略图 / 默认图标（thumbnail null 或裂图 → 胶片图标·降级不阻塞） */}
      <button
        type="button"
        onClick={() => setPlaying(true)}
        className="relative shrink-0 w-[120px] h-[68px] rounded-lg overflow-hidden bg-gray-100 flex items-center justify-center group"
        aria-label="播放"
      >
        {thumb && !thumbBroken ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumb} alt={label} loading="lazy" className="w-full h-full object-cover" onError={() => setThumbBroken(true)} />
        ) : (
          <FilmIcon className="w-8 h-8 text-gray-400" />
        )}
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="w-9 h-9 rounded-full bg-black/55 group-hover:bg-black/70 flex items-center justify-center transition-colors">
            <PlayIcon className="w-[18px] h-[18px] keep-white" />
          </span>
        </span>
      </button>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-gray-900 truncate" title={label}>{label}</div>
        <div className="text-xs text-gray-500 mt-0.5">{sizeText || '影片'}</div>
      </div>
    </div>
  );
}

// ── ③ 预览视图：嵌入真 player（复用现有 SignedVideo 能力·与既有 VideoBlock 行为一致）──
export function VideoPreviewView({ src, name, ratio, readOnly }: VideoViewProps) {
  const { Video } = useDocsMedia();
  return (
    <div className="video-view-preview my-2 max-w-[720px]" data-video-view="preview" data-readonly={readOnly ? 'true' : undefined}>
      <Video src={src} controls playsInline preload="metadata" className="w-full rounded-xl bg-black" style={{ aspectRatio: String(ratio || 16 / 9) }} title={videoDisplayName(name, src)} />
    </div>
  );
}

// ── 按 displayMode 分发（编辑 NodeView / 只读页共用一个入口·渲染一致）──────────
export function VideoViewByMode(props: VideoViewProps & { displayMode: string }) {
  const { displayMode, ...rest } = props;
  if (displayMode === 'text') return <VideoTextView {...rest} />;
  if (displayMode === 'preview') return <VideoPreviewView {...rest} />;
  return <VideoCardView {...rest} />; // card 或脏值 → 卡片（默认）
}

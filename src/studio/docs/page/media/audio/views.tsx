'use client';


import React, { useState } from 'react';
import { useDocsMedia } from '../env';

export interface AudioViewProps {
  src: string;
  name: string;
  size: number | null;
  /** 分享只读页访客态：渲染完全一致·仅语义标记（工具条由上层编辑态挂·本组件本就不含） */
  readOnly?: boolean;
}

// 文件名兜底：name attr 空 → 从 src 路径末段推
export function audioDisplayName(name: string, src: string): string {
  if (name) return name;
  try {
    const path = src.split('?')[0].split('#')[0];
    const seg = path.split('/').filter(Boolean).pop() || '';
    return seg ? decodeURIComponent(seg) : '音频';
  } catch { return src.split('/').pop() || '音频'; }
}

// byte → 人话（镜像 video-card formatVideoSize 口径·MB 一位小数）
export function formatAudioSize(bytes: number | null): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// 扬声器图标
function SpeakerIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className={className} aria-hidden>
      <path d="M4 9v6h4l5 4V5L8 9H4z" />
      <path d="M17 8.5a5 5 0 0 1 0 7M19.5 6a8.5 8.5 0 0 1 0 12" />
    </svg>
  );
}

function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v12m0 0l-4-4m4 4l4-4M4 19h16" />
    </svg>
  );
}

// 原生 <audio> + 签名自愈（SignedVideo 同款 useResignedSrc·治私密桶裸直链 401）。
function SignedAudio(props: React.AudioHTMLAttributes<HTMLAudioElement> & { src?: string }) {
  const { src, ...rest } = props;
  const r = useDocsMedia().useAudioSrc(src);
  // eslint-disable-next-line jsx-a11y/media-has-caption
  return <audio {...rest} src={r.src} onError={r.onError} />;
}

// 下载按钮：同源代理 `/api/audio-download`（服务端 fetch R2 + Content-Disposition
// attachment）——`src` 传裸直链（canonical·由服务端自行 extractR2Key + 现签，不需要客户端先自己签一次）；
// 原生 `<a href="...">` 导航即触发浏览器下载，不再需要 JS fetch/blob，也不再需要失败兜底新分页
// （代理走服务端，没有客户端网络/CORS 失败态要兜）。
function AudioDownloadButton({ src, name, className }: { src: string; name: string; className?: string }) {
  const media = useDocsMedia();
  const displayFilename = media.displayName;
  const link = media.useAudioDownloadHref(src, name || 'audio');
  if (!link) return null;
  // href 是下载语义消费（Content-Disposition
  // 文件名）——`name` 必须原样传，不得解码；title 是纯视觉 tooltip，单独现算 decode 显示。

  return (
    <a
      href={link.href}
      download={link.download}
      onClick={(e) => e.stopPropagation()}
      aria-label="download"
      title={displayFilename(name)}
      className={className ?? 'inline-flex items-center justify-center w-7 h-7 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors shrink-0'}
    >
      <DownloadIcon className="w-4 h-4" />
    </a>
  );
}

// ── ① 文本视图：一行文件名·可点（点了原地展开播放器·再点收起）────────────────
export function AudioTextView({ src, name, size, readOnly }: AudioViewProps) {
  const displayFilename = useDocsMedia().displayName;
  const [playing, setPlaying] = useState(false);
  const label = audioDisplayName(name, src);
  return (
    <div className="audio-view-text my-1 flex items-center gap-2" data-audio-view="text" data-readonly={readOnly ? 'true' : undefined}>
      <button
        type="button"
        onClick={() => setPlaying(v => !v)}
        className="inline-flex items-center gap-1.5 text-blue-600 hover:underline text-[15px] leading-relaxed break-all text-left"
        title={displayFilename(label)}
      >
        <SpeakerIcon className="w-3.5 h-3.5 shrink-0" />
        <span>{displayFilename(label)}</span>
      </button>
      <AudioDownloadButton src={src} name={label} className="inline-flex items-center justify-center w-6 h-6 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors shrink-0" />
      {playing && (
        <SignedAudio src={src} controls preload="metadata" className="ml-1" style={{ height: 32 }} />
      )}
      {size != null && <span className="text-xs text-gray-400">{formatAudioSize(size)}</span>}
    </div>
  );
}

// ── ② 卡片视图（默认·对标视频「默认中型卡片」）：图标+名+大小+内嵌播放控件 ──
export function AudioCardView({ src, name, size, readOnly }: AudioViewProps) {
  const displayFilename = useDocsMedia().displayName;
  const label = audioDisplayName(name, src);
  const sizeText = formatAudioSize(size);
  return (
    <div
      className="audio-view-card my-2 max-w-[480px] rounded-xl border border-gray-200 bg-white p-3"
      data-audio-view="card"
      data-readonly={readOnly ? 'true' : undefined}
    >
      <div className="flex items-center gap-2.5">
        <div className="shrink-0 w-9 h-9 rounded-lg bg-violet-50 flex items-center justify-center text-violet-500">
          <SpeakerIcon className="w-5 h-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-gray-900 truncate" title={displayFilename(label)}>{displayFilename(label)}</div>
          <div className="text-xs text-gray-500 mt-0.5">{sizeText || '音频'}</div>
        </div>
        <AudioDownloadButton src={src} name={label} />
      </div>
      <SignedAudio src={src} controls preload="metadata" className="w-full mt-2.5" style={{ height: 32 }} />
    </div>
  );
}

// ── ③ 预览视图：原生 audio 控件横条（反铁项2 天然不犯空黑框视频 player）──
export function AudioPreviewView({ src, name, readOnly }: AudioViewProps) {
  const displayFilename = useDocsMedia().displayName;
  const label = audioDisplayName(name, src);
  return (
    <div className="audio-view-preview my-2 max-w-[560px] flex items-center gap-2" data-audio-view="preview" data-readonly={readOnly ? 'true' : undefined}>
      <SignedAudio src={src} controls preload="metadata" className="w-full" title={displayFilename(label)} />
      <AudioDownloadButton src={src} name={label} />
    </div>
  );
}

// ── 按 displayMode 分发（编辑 NodeView / 只读页共用一个入口·渲染一致）──────────
export function AudioViewByMode(props: AudioViewProps & { displayMode: string }) {
  const { displayMode, ...rest } = props;
  if (displayMode === 'text') return <AudioTextView {...rest} />;
  if (displayMode === 'preview') return <AudioPreviewView {...rest} />;
  return <AudioCardView {...rest} />; // card 或脏值 → 卡片（默认）
}

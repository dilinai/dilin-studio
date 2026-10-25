"use client";
// 文件编辑器整页（登入版 /ai-scribe/<编号> 与游客版 /studio/docs/<编号> 共用这一份）：
//   顶栏、左栏（目錄｜硬碟）、工具列、编辑区、右栏、弹窗、快捷键都在这里；要网站的（读写云文档、云盘、角色对话、上传、
//   生成、分享、上架…）一律经宿主（./host.ts）——登入版宿主在网站那边，游客版宿主在 ./guest/。
//   宿主 has(功能键) 回 false 的那几样（游客版）就不画。
import { docsTabTitle } from './tab-title';
import { outlineText } from './outline-text.pure';
import { useState, useRef, useCallback, useEffect, useMemo, type PointerEvent as ReactPointerEvent, type CSSProperties, type Dispatch, type SetStateAction } from "react";
import { safeRandomUUID } from "../../shared/ported/safe-uuid";
import { editorShell } from "../../shared/theme/editor-shell-theme";
import { useEditor, EditorContent, NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import type { NodeViewRendererProps } from "@tiptap/core";
import { Extension, Node as TiptapNode, mergeAttributes } from "@tiptap/core";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableCell } from "@tiptap/extension-table-cell";
import Link from '@tiptap/extension-link';
import 'katex/dist/katex.min.css';
import { makeResizableImage } from "../core/media-nodes";
import { FILE_CARD_ATTR, normalizeFileCardId, fileCardExportLabel, fileCardExportName, fileCardHref } from "../core/file-card";
import { mdToTiptapHtml as mdToEditorHtml, tiptapHtmlToMd as editorHtmlToMd, htmlAttr } from "../core/markdown";
import { IndentExtension, OrderedListExtended, TrailingParagraph, MermaidBlock } from "../core/nodes";
import { ColorMark, BgMark, BoxMark, FontMark } from "../core/rich-marks";
import { FontLoader } from "../core/font-loader";
import { CalloutNode } from "../core/callout-node";
import { LatexNode } from "../core/latex-node";
import { TocNode } from "../core/toc-node";
import { PageBreakNode } from "../core/page-break-node";
import { PAPER_PREFS, splitPaperPref, defaultPaperSettings, resolvePaperSettings, paperSettingsColumns, paperSettingsKey, type DocPaperPref, type DocPaperSettings } from '../core/paper-size';
import { PagedView } from '../core/pagination/pm-paged-view';
import { sanitizeDocLayers, pageSizeMm, type DocLayerItem } from '../core/doc-layers/types';
import {
  FLOW_MEDIA_TYPES, continuousGeometry, docLayersKey, flowFromLayer, flowRectToLayerAt, layerFromFlowNode, layersPutBody, locateOnPages, maxLayerPage,
  mergeDocLayers, mmToPx, newTextBoxLayer, pageLeftPx, placeLayerCentered, pageTopPx, pagedGeometry, removeLayers, serverLayersJson, sheetCount, toDocLayers, topLayerAt, type FlowMediaNode,
} from '../core/doc-layers/editor';
import { startWalk, stepUndo, stepRedo, isWalkCurrent, type WalkState, type RollbackResult } from "../core/history-walk";
import { editorHtmlWithLiveColWidths } from '../core/table-col-widths';
import { useStudioT, useStudioLang } from "../../shared/StudioT";
import { registerDesktopBeforeClose } from '../../shared/desktop-before-close'
import type { StudioLang } from "../../shared/types";
import { isSimplifiedSite } from "../../shared/host";
import { alertDialog } from '../../shared/dialog-store';
import { ColorPicker } from '../../shared/components/ColorPicker';
import FontFamilyDropdown from '../../shared/components/FontFamilyDropdown';
import ToolbarDropdown from '../../shared/ported/ToolbarDropdown';
import { NeonIcon } from '../../shared/ported/NeonIcon';
import { useResponsiveLayout } from '../../shared/ported/useResponsiveLayout';
import { PanelCollapseButton, PanelCollapsedEdge } from '../../shared/ported/PanelCollapseHandle';
import { EditorLoadingScreen } from '../../shared/ported/EditorLoadingArt';
import PagedSheets, { usePagedEditorGeometry, pagedCssVars, printPagedDocument } from './PagedSheets';
import DocLayersPlane from './layers/DocLayersPlane';
import DocLayersStatic from './layers/DocLayersStatic';
import { LinkCardNode, PlainTextHrefSerializer, encodeMdHrefParens } from './link-card';
import { useFormatPainter } from './use-format-painter';
import { useDocSaveQueue } from './useDocSaveQueue';
import { DocsHostProvider, useDocsHost } from './host-context';
import { DocsMediaProvider, useDocsMedia } from './media/env';
import type { DocsAttachment, DocsLoadFail, DocsPageHost, ProfilePublishState, ShareVisibility } from './host';

// Mermaid 两句状态字：在 NodeView 里调用（hook）·照旧走网站字典
function useMermaidLabels() {
  const t = useStudioT();
  return { syntaxError: t('bf_scribe_chart_syntax_error'), rendering: t('bf_scribe_chart_rendering') };
}

// ── 上傳佔位 registry（file 在 NodeView mount 後取出並上傳）────────────────────
const uploadFileRegistry = new Map<string, File>();
const DEFAULT_MEDIA_WIDTH_RATIO = 1 / 3;
const PENDING_CONFIRM_FAILURE_TTL_MS = 5 * 60 * 1000;
const languageRef = { current: 'zh-TW' as StudioLang };
function unconfirmedSaveStep(lang: StudioLang): string {
  return lang === 'zh-CN' ? '保存结果未确认'
    : lang === 'en' ? 'Save result unconfirmed'
    : '儲存結果未確認';
}

export function getDefaultMediaWidth(editor: NodeViewRendererProps['editor']) {
  const editorWidth = editor.view.dom.getBoundingClientRect().width || 860;
  return Math.max(80, Math.round(editorWidth * DEFAULT_MEDIA_WIDTH_RATIO));
}

function videoPlayerSrcDoc(src: string, playerId: string) {
  return `<!doctype html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent;}
  video{display:block;width:100%;height:100%;object-fit:cover;background:transparent;}
</style>
</head>
<body>
<video id="v" src="${htmlAttr(src)}" playsinline preload="metadata"></video>
<script>
  const v = document.getElementById('v');
  const playerId = "${htmlAttr(playerId)}";
  const canHover = matchMedia('(hover: hover)').matches;
  let hovering = false;
  const notifyActive = () => parent.postMessage({ type: 'dilinai-ai-scribe-video-active', id: playerId }, '*');
  const showControls = () => {
    if (!canHover) return;
    hovering = true;
    notifyActive();
    v.controls = true;
  };
  const hideControls = () => {
    if (!canHover || document.fullscreenElement) return;
    hovering = false;
    v.controls = false;
  };
  window.addEventListener('pointerdown', notifyActive);
  window.addEventListener('pointerenter', showControls);
  window.addEventListener('pointermove', showControls);
  window.addEventListener('pointerleave', hideControls);
  window.addEventListener('blur', hideControls);
  document.addEventListener('mouseleave', hideControls);
  v.addEventListener('pause', () => {
    if (canHover && !hovering && !document.fullscreenElement) v.controls = false;
  });
  v.addEventListener('click', () => {
    if (!v.controls) v.paused ? v.play() : v.pause();
  });
  v.controls = !canHover;
</script>
</body>
</html>`;
}

async function captureIframeVideoFrame(iframe: HTMLIFrameElement) {
  try {
    const video = iframe.contentDocument?.querySelector('video');
    if (!(video instanceof HTMLVideoElement)) return null;
    if (video.readyState < 2) {
      await new Promise<void>((resolve) => {
        const timer = window.setTimeout(resolve, 1000);
        video.addEventListener('loadeddata', () => {
          window.clearTimeout(timer);
          resolve();
        }, { once: true });
      });
    }
    if (!video.videoWidth || !video.videoHeight) return null;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}

async function getCleanPdfHtml(editor: NonNullable<ReturnType<typeof useEditor>>, videoFrameAlt?: string) {
  const div = document.createElement('div');
  div.innerHTML = editorHtmlWithLiveColWidths(editor);
  const exportedVideos = Array.from(div.querySelectorAll('video'));
  // 选择器同时匹配繁/简 title（视频 iframe title 已 region-aware·导出视频帧别漏）
  const liveFrames = Array.from(editor.view.dom.querySelectorAll('iframe[title="視頻預覽"], iframe[title="视频预览"], iframe[title="Video preview"]')) as HTMLIFrameElement[];

  await Promise.all(exportedVideos.map(async (video, index) => {
    const frameDataUrl = liveFrames[index] ? await captureIframeVideoFrame(liveFrames[index]) : null;
    if (frameDataUrl) {
      const img = document.createElement('img');
      img.src = frameDataUrl;
      img.alt = videoFrameAlt ?? (isSimplifiedSite() ? '视频画面' : '視頻畫面');
      img.setAttribute('data-video-frame', 'true');
      const width = video.getAttribute('width');
      if (width) img.setAttribute('width', width);
      video.replaceWith(img);
      return;
    }
    video.removeAttribute('controls');
    video.setAttribute('data-pdf-clean-video', 'true');
    video.setAttribute('playsinline', '');
    video.setAttribute('preload', 'metadata');
    video.setAttribute('muted', '');
  }));

  // 音频：音频没有画面可截·
  // 原生 <audio controls> 在无头 Chromium 打印里渲染不可靠（不像 video 有静帧兜底）——
  // 一律退化成「🔊 文件名」纯文字行，绝不留原始 <audio> 标签指望它自己画出控件。
  Array.from(div.querySelectorAll('audio')).forEach((audio) => {
    const name = audio.getAttribute('data-name') || audio.getAttribute('src')?.split('/').pop() || '';
    const p = document.createElement('p');
    p.textContent = `🔊 ${name}`;
    p.setAttribute('data-pdf-audio-fallback', 'true');
    audio.replaceWith(p);
  });

  // 档案卡片：PDF 里退化成一行「附件：档名（连结）」——连结＝本站下载口（权限照文档分享权限现判），与 Word／分享页 PDF 同一句。
  const fcDocId = ((editor.storage as unknown as Record<string, { docId?: string } | undefined>).fileCard?.docId) || '';
  const fcLang = languageRef.current === 'zh-CN' ? 'cn' : languageRef.current === 'en' ? 'en' : 'tw';
  Array.from(div.querySelectorAll(`div[${FILE_CARD_ATTR}]`)).forEach((el) => {
    const fileId = normalizeFileCardId(el.getAttribute(FILE_CARD_ATTR));
    if (!fileId) { el.remove(); return; }
    const p = document.createElement('p');
    p.setAttribute('data-pdf-file-card-fallback', 'true');
    p.appendChild(document.createTextNode(fileCardExportLabel(fcLang)));
    const a = document.createElement('a');
    a.textContent = fileCardExportName(el.getAttribute('data-name') || '', fcLang);
    if (fcDocId) a.href = `${window.location.origin}${fileCardHref(fcDocId, fileId, 'download')}`;
    p.appendChild(a);
    if (fcDocId) p.appendChild(document.createTextNode(`（${a.href}）`));
    el.replaceWith(p);
  });

  return div.innerHTML;
}

// ── 上傳佔位 NodeView ─────────────────────────────────────────────────────────
function UploadPlaceholderView({ node, editor, getPos }: NodeViewRendererProps) {
  const t = useStudioT();
  const host = useDocsHost();
  const { uploadId, ratio, mimeType } = node.attrs as { uploadId: string; ratio: number; mimeType: string };
  const [progress, setProgress] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const file = uploadFileRegistry.get(uploadId);
    if (!file) return;
    uploadFileRegistry.delete(uploadId);

    const task = host.uploadMedia(file, setProgress);
    let alive = true;
    void task.done.then((r) => {
      if (!alive) return;
      if (r) {
        setProgress(100);
        const { url, isVideo, isAudio, jobId, transcoding } = r;
        const pos = typeof getPos === 'function' ? getPos() : undefined;
        if (pos === undefined || !editor) return;
        const width = getDefaultMediaWidth(editor);
        // 音频节点无画面·不需要 width/ratio（四字段 src/displayMode/name/size）。
        const newNode = isVideo
          ? editor.schema.nodes.videoBlock?.create({ src: url, originalSrc: url, width, ratio, jobId: jobId ?? null, transcoding: transcoding ?? false })
          : isAudio
          // audioBlock.name 会被存进正文（可序列化还原）——写入点原样存 file.name、不解码；显示层各自兜底。
          ? editor.schema.nodes.audioBlock?.create({ src: url, name: file.name, size: file.size })
          : editor.schema.nodes.image?.create({ src: url, width });
        if (newNode) {
          editor.view.dispatch(editor.view.state.tr.replaceWith(pos, pos + node.nodeSize, newNode));
        }
      } else {
        setFailed(true);
      }
    });
    return () => { alive = false; task.abort(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const aspectRatio = ratio > 0 ? ratio : 16 / 9;

  return (
    <NodeViewWrapper style={{ display: 'block' }}>
      <div
        style={{ aspectRatio: String(aspectRatio), width: `${DEFAULT_MEDIA_WIDTH_RATIO * 100}%`, maxWidth: '100%' }}
        className="w-full bg-gray-100 rounded-lg flex flex-col items-center justify-center gap-2.5 my-2 select-none"
      >
        {failed ? (
          <span className="text-xs text-red-400">{t('bf_scribe_upload_failed')}</span>
        ) : (
          <>
            <span className="text-xs text-gray-400">{t('bf_scribe_uploading')} {progress}%</span>
            <div className="w-40 h-1 bg-gray-200 rounded-full overflow-hidden">
              <div className="h-full bg-blue-500 transition-all duration-300" style={{ width: `${progress}%` }} />
            </div>
          </>
        )}
      </div>
    </NodeViewWrapper>
  );
}

// ── 可縮放媒體 NodeView（圖片 + 視頻共用）────────────────────────────────────
function ResizableMediaView({ node, editor, getPos, selected, isVideo = false }:
  NodeViewRendererProps & { selected?: boolean; isVideo?: boolean }) {

  const t = useStudioT();
  const host = useDocsHost();
  const { Image: SmartImage, videoProxySrc: toVideoProxySrc } = useDocsMedia();
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const mediaRef = useRef<HTMLImageElement | HTMLVideoElement | HTMLIFrameElement | null>(null);
  const playerIdRef = useRef('video-' + Math.random().toString(36).slice(2, 11));
  const [displayWidth, setDisplayWidth] = useState<number | null>(
    typeof node.attrs.width === 'number' && node.attrs.width > 0 ? node.attrs.width : null
  );
  const [mediaSelected, setMediaSelected] = useState(false);
  const [videoSrc, setVideoSrc] = useState(node.attrs.src as string);
  const [videoError, setVideoError] = useState(false);
  const [transcoding, setTranscoding] = useState(!!(node.attrs.transcoding));
  const aspectRatio =
    typeof node.attrs.ratio === 'number' && node.attrs.ratio > 0
      ? node.attrs.ratio
      : 16 / 9;
  const currentVideoSrc = videoSrc || (node.attrs.src as string);
  const downloadVideoSrc = (node.attrs.originalSrc as string) || currentVideoSrc;
  const playerSrc = toVideoProxySrc(videoError ? downloadVideoSrc : currentVideoSrc);
  const showResizeHandles = !!selected || mediaSelected;

  useEffect(() => {
    if (!isVideo) return;
    setVideoSrc(node.attrs.src as string);
    setTranscoding(!!node.attrs.transcoding);
    setVideoError(false);
  }, [isVideo, node.attrs.src, node.attrs.transcoding]);

  // 轮询转码状态
  useEffect(() => {
    if (!isVideo || !node.attrs.transcoding || !node.attrs.jobId) return;
    setTranscoding(true);
    let ticks = 0;
    const MAX_TICKS = 200; // 200 × 3s ≈ 10 分钟，超时按失败处理避免无限轮询
    const interval = setInterval(async () => {
      if (++ticks > MAX_TICKS) {
        clearInterval(interval);
        setTranscoding(false);
        setVideoError(true);
        return;
      }
      try {
        const { status, transcodedUrl } = await host.transcodeStatus(String(node.attrs.jobId));
        if (status === 'done' && transcodedUrl) {
          clearInterval(interval);
          // 先更新本地 src + 清錯誤，再清 transcoding，避免 onError 誤觸發
          setVideoSrc(transcodedUrl);
          setVideoError(false);
          setTranscoding(false);
          const pos = typeof getPos === 'function' ? getPos() : undefined;
          if (pos !== undefined && editor) {
            editor.view.dispatch(
              editor.view.state.tr.setNodeMarkup(pos, undefined, {
                ...node.attrs, src: transcodedUrl, transcoding: false, jobId: null,
              })
            );
          }
        } else if (status === 'error') {
          clearInterval(interval);
          setTranscoding(false);
          setVideoError(true);
        }
      } catch { /* retry next tick */ }
    }, 3000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.attrs.jobId, node.attrs.transcoding]);

  useEffect(() => {
    setDisplayWidth(typeof node.attrs.width === 'number' && node.attrs.width > 0 ? node.attrs.width : null);
  }, [node.attrs.width]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && wrapperRef.current?.contains(target)) return;
      setMediaSelected(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; id?: string } | null;
      if (data?.type !== 'dilinai-ai-scribe-video-active') return;
      // 🔴 验来源：window 级监听收全站任意
      // iframe 的 postMessage，仅凭 id 匹配会被别处伪造消息带同 id 冒充点击、误置选中态。
      // 但本消息是「点 A 视频广播出去、所有视频节点各自据 id 更新选中态」的广播语义——
      // 若只认「本节点自己那个 iframe」会把「点 B 广播给 A 的合法消息」也当伪源丢弃，A 收不到
      // 该收的 false，导致 A/B 可同时选中（上轮 CONFIRMED）。正解：校验来源属于本文档任一
      // 视频预览 iframe（与 getCleanPdfHtml 同一选择器口径），而非只认自己，伪源（非本文档
      // 任何视频 iframe）才静默丢弃。
      const ownerDoc = wrapperRef.current?.ownerDocument ?? document;
      const liveVideoFrames = ownerDoc.querySelectorAll(
        'iframe[title="視頻預覽"], iframe[title="视频预览"], iframe[title="Video preview"]'
      );
      let sourceIsLegit = false;
      liveVideoFrames.forEach((frame) => {
        if ((frame as HTMLIFrameElement).contentWindow === event.source) sourceIsLegit = true;
      });
      if (!sourceIsLegit) return;
      setMediaSelected(data.id === playerIdRef.current);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const startResize = useCallback((e: React.MouseEvent, xDir: 1 | -1) => {
    e.preventDefault();
    e.stopPropagation();
    setMediaSelected(true);
    // resize 起始宽度从 wrapper 量（不再依赖 media 元素 ref）——图片改用 SmartImage（无 ref 转发·
    // 占位符时渲 PlaceholderBox），wrapper 始终在且宽度 = 当前显示宽度（媒体 w-full 填满它），等价旧 img.offsetWidth。
    const el = wrapperRef.current;
    if (!el) return;
    const startX = e.clientX;
    const startW = el.offsetWidth || 600;
    const prevCursor = document.body.style.cursor;
    const prevUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
    const overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.zIndex = '2147483647';
    overlay.style.cursor = 'ew-resize';
    overlay.style.background = 'transparent';
    document.body.appendChild(overlay);
    let latestW = startW;
    let finished = false;

    const applyWidth = (clientX: number) => {
      latestW = Math.max(80, startW + (clientX - startX) * xDir);
      setDisplayWidth(Math.round(latestW));
    };

    const cleanup = () => {
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevUserSelect;
      overlay.remove();
      overlay.removeEventListener('mousemove', onMove);
      overlay.removeEventListener('mouseup', onUp);
      window.removeEventListener('mouseup', onUp, true);
      window.removeEventListener('blur', onBlur, true);
    };

    const finish = (clientX?: number) => {
      if (finished) return;
      finished = true;
      if (typeof clientX === 'number') applyWidth(clientX);
      const rounded = Math.round(latestW);
      setDisplayWidth(rounded);
      const pos = typeof getPos === 'function' ? getPos() : undefined;
      if (pos !== undefined && editor) {
        const tr = editor.view.state.tr
          .setNodeMarkup(pos, undefined, { ...node.attrs, width: rounded })
          .setMeta('addToHistory', true);
        tr.setSelection(NodeSelection.create(tr.doc, pos));
        editor.view.dispatch(tr);
        editor.view.focus();
      }
      cleanup();
    };

    function onMove(me: MouseEvent) {
      if (me.buttons === 0) {
        finish(me.clientX);
        return;
      }
      applyWidth(me.clientX);
    }

    function onUp(me: MouseEvent) {
      finish(me.clientX);
    }

    function onBlur() {
      finish();
    };

    overlay.addEventListener('mousemove', onMove);
    overlay.addEventListener('mouseup', onUp);
    window.addEventListener('mouseup', onUp, true);
    window.addEventListener('blur', onBlur, true);
  }, [editor, getPos, node.attrs]);

  const corner = "absolute w-3 h-3 bg-white border-2 border-blue-500 rounded-sm shadow-sm z-10";

  return (
    <NodeViewWrapper style={{ display: 'block' }}>
      <div
        ref={wrapperRef}
        className="relative my-2 block"
        style={displayWidth ? { width: `${displayWidth}px`, maxWidth: '100%' } : { maxWidth: '100%' }}
        onMouseDown={() => setMediaSelected(true)}
      >
        {isVideo && transcoding ? (
          <div className="w-full bg-gray-100 rounded-lg flex flex-col items-center justify-center gap-2 py-8" style={{ aspectRatio: String(aspectRatio) }}>
            <svg className="w-6 h-6 text-gray-400 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/></svg>
            <span className="text-xs text-gray-400">{t('bf_scribe_video_processing')}</span>
          </div>
        ) : isVideo ? (
          <div className="relative w-full overflow-hidden rounded-lg bg-gray-100" style={{ aspectRatio: String(aspectRatio) }}>
            <iframe
              key={playerSrc}
              ref={mediaRef as React.Ref<HTMLIFrameElement>}
              srcDoc={videoPlayerSrcDoc(playerSrc, playerIdRef.current)}
              title={t('bf_scribe_video_preview')}
              className="block h-full w-full border-0 bg-transparent"
              allow="autoplay; fullscreen; picture-in-picture"
              allowFullScreen
              referrerPolicy="no-referrer"
            />
          </div>
        ) : (
          <SmartImage
            src={node.attrs.src as string}
            alt={(node.attrs.alt as string) || ''}
            className="block w-full rounded-lg"
          />
        )}
        {showResizeHandles && (
          <>
            <div className={`${corner} -top-1.5 -left-1.5 cursor-nwse-resize`}  onMouseDown={e => startResize(e, -1)} />
            <div className={`${corner} -top-1.5 -right-1.5 cursor-nesw-resize`} onMouseDown={e => startResize(e, 1)} />
            <div className={`${corner} -bottom-1.5 -left-1.5 cursor-nesw-resize`} onMouseDown={e => startResize(e, -1)} />
            <div className={`${corner} -bottom-1.5 -right-1.5 cursor-nwse-resize`} onMouseDown={e => startResize(e, 1)} />
          </>
        )}
      </div>
    </NodeViewWrapper>
  );
}

function ResizableImageView(props: NodeViewRendererProps & { selected?: boolean }) {
  // 工单态占位 → 图片工单卡（宿主画·要生成·耗用点数）·否则普通可缩放图片
  const host = useDocsHost();
  if (host.renderImageTicket && host.isImageTicketSrc?.((props.node.attrs.src as string) || '')) return <>{host.renderImageTicket(props)}</>;
  return <ResizableMediaView {...props} />;
}
function ResizableVideoView(props: NodeViewRendererProps & { selected?: boolean }) {
  return <ResizableMediaView {...props} isVideo />;
}

const UploadPlaceholderNode = TiptapNode.create({
  name: 'uploadPlaceholder',
  group: 'block',
  atom: true,
  addAttributes() {
    return {
      uploadId: { default: '' },
      ratio:    { default: 1 },
      mimeType: { default: 'image/jpeg' },
    };
  },
  parseHTML()  { return [{ tag: 'div[data-upload-placeholder]' }]; },
  renderHTML({ node }) {
    return ['div', mergeAttributes({ 'data-upload-placeholder': '', 'data-upload-id': node.attrs.uploadId })];
  },
  addNodeView() { return ReactNodeViewRenderer(UploadPlaceholderView); },
});

const ResizableImage = makeResizableImage(ResizableImageView);  // schema 与游客版共用（docs/core/media-nodes.ts）


const LEFT_PANEL_DEFAULT_WIDTH = 208;
const LEFT_PANEL_MIN_WIDTH = 160;
const LEFT_PANEL_MAX_WIDTH = 420;
const RIGHT_PANEL_DEFAULT_WIDTH = 300;
const RIGHT_PANEL_MIN_WIDTH = 260;
const RIGHT_PANEL_MAX_WIDTH = 560;

// ── 字号缩放：范围 80%~200%·步进 10%（与 DocEditor 同款·
//    复用 userPrefs.editor_font_scale 同一 per-user key → 独立页 / 画布全屏字号一致·跨设备）──────
const FONT_SCALE_MIN = 0.8;
const FONT_SCALE_MAX = 2.0;
const FONT_SCALE_STEP = 0.1;
const clampFontScale = (s: number) =>
  Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, Math.round(s * 10) / 10));

function clampPanelWidth(width: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(width)));
}

// 原「纸张分页参考线 overlay」（PaperGuideOverlay·近似线）已由真分页视图取代（core/lib/doc-pagination/＋components/doc-paged/）。

type SecretEntry = { real: string; code: string };
/** 非对话编辑气泡（194 迁移触发器写入）的结构化「谁/何时/做了啥」。 */
interface ExternalEditInfo {
  source: string
  at?: string
  titleChanged?: boolean
  contentChanged?: boolean
  oldChars?: number
  newChars?: number
  oldTitle?: string | null
  newTitle?: string | null
}
type ChatMsg =
  | { role: 'user'; text: string; images?: string[] }
  | {
      role: 'assistant'; text: string; streaming: boolean;
      // 文档对话系统功能步：
      id?: string;                       // agent_messages.id（接 A·回滚/积分归属锚）
      // [留痕二期 194] external_edit=非对话途径编辑的说明气泡（DB 触发器产·服务端权威·
      //   本页只显示+沿用「回滚到此」按钮·保存时 position-only 不改写内容——msgs route 兜底）
      kind?: 'director' | 'external_edit';  // director → 深咖啡白字气泡（一般 AI 米色）
      externalEdit?: ExternalEditInfo;   // kind='external_edit' 专属·谁/何时/做了啥（本地化渲染用）
      creditsDetail?: unknown;  // 紫积分气泡（复用画布 CreditsDetailBubble·读 metadata.creditsDetail）
      creditsContext?: unknown;
      versionId?: string;                // 回滚锚：该回复对应的文档版本快照 id（aiscribe_docs_versions.id）
      genStartedAt?: number; genFinishedAt?: number;  // 积分气泡读秒（A 给或前端 stamp）
      docOp?: boolean;
      // ── 思考态搬总管──
      //   A 安抚语 + B 紫色读秒气泡 + C 步骤列表：写作前的「深度思考/联网」phase + 写作模型首字前等待都算思考态。
      //   reasoning=块C deepThink 输出（route reasoning_delta 累积·开了深度思考才有）；
      //   stepProgress.steps=route step_progress 推进的阶段（深度思考中→联网中→撰写中）；
      //   thinkEndedAt=首个答案 token 到达=思考结束（读秒冻结成「✓ 已思考 X 秒」）。
      reasoning?: string;
      thinking?: string;                 // 完整思考全文（thinking_block·暂留扩展位）
      // milestone：该条是否属于「可被下一条同族 done 事件原地替换」的
      //   里程碑链——只有 milestone===true 的末条才会被下一条 done 事件替换，非 milestone 末条一律追加
      //   新行（防止唯一一条非里程碑步骤如「分析指令中」被首个里程碑吃掉）。
      stepProgress?: { steps: { step: string; ts: number; milestone?: boolean }[]; currentStep?: string };
      thinkEndedAt?: number;
      // ProcessFold 出错降级态：/api/aiscribe 无 tool 级
      //   出错事件·只有整轮失败 `{type:'error'}`（route.ts:194，服务端协议零碰·适配全在此）——
      //   映成一条 stages 形 error 条目喂 buildProcessTimeline，形状对齐 canvas 面 Msg['stages']
      //   （tool/state/error/ts）以便与首页共用的合并时间线渲染逻辑零改复用。
      foldError?: { message: string; ts: number };
    };

// 🔴 保存基线指纹：doSave 用它算「我这一发是基于哪一版服务端正文」，
//   服务端 PUT（api/aiscribe/docs/route.ts 的 base_sha256 闸）用 node crypto 的 sha256 算同一个值比对。
//   两端契约必须逐位一致：**UTF-8 字节 → SHA-256 → 小写 hex 全长**（别一边截断一边不截）。
//   用 SHA-256 而非诊断书里提的 md5：浏览器 WebCrypto 没有 md5，用它就要多拖一个依赖进来；
//   哈希只用来判「同不同版」，不涉密码学攻防，换算法不改语义。
//   crypto.subtle 缺席（非安全上下文/古董浏览器）→ 返回 null = 本发不带 base = 退回改前的无条件写
//   （保存可用性优先·失去的只是这一发的冲突保护；生产 https 与 localhost 都有 subtle）。
async function sha256Hex(text: string): Promise<string | null> {
  try {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) return null;
    const buf = await subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  } catch { return null; }
}
type LeftTab = "secretbox" | "outline" | "drive";
// 档案卡片工具栏回纹针图示
function PaperclipIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 11.5l-8.6 8.6a5 5 0 0 1-7.1-7.1l8.6-8.6a3.3 3.3 0 0 1 4.7 4.7l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4l7.9-7.9" />
    </svg>
  );
}

function ToolBtn({ label, active, onClick, title }: { label: string; active?: boolean; onClick: () => void; title?: string }) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={e => { e.preventDefault(); onClick(); }}
      className={`px-2 py-1 text-xs rounded-md transition-colors duration-150 ${active ? editorShell.chipActive : editorShell.chipIdle}`}
    >
      {label}
    </button>
  );
}

const OL_TYPES = [
  { key: 'decimal',        label: '1.'   },
  { key: 'cjk-stem',       label: '一、' },
  { key: 'cjk-stem-paren', label: '（一）' },
  { key: 'decimal-stem',   label: '1、'  },
  { key: 'decimal-paren',  label: '(1)'  },
] as const;
type OLType = typeof OL_TYPES[number]['key'];

function OLDropdown({ editor }: { editor: ReturnType<typeof useEditor> | null }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const currentType = editor?.isActive('orderedList')
    ? ((editor.getAttributes('orderedList').listType ?? 'decimal') as OLType)
    : null;
  const activeLabel = OL_TYPES.find(t => t.key === currentType)?.label ?? '1.';

  const apply = (lt: OLType) => {
    setOpen(false);
    if (!editor) return;
    if (editor.isActive('orderedList')) {
      if ((editor.getAttributes('orderedList').listType ?? 'decimal') === lt) {
        editor.chain().focus().toggleOrderedList().run();
      } else {
        editor.chain().focus().updateAttributes('orderedList', { listType: lt }).run();
      }
    } else {
      editor.chain().focus().toggleOrderedList().updateAttributes('orderedList', { listType: lt }).run();
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onMouseDown={e => { e.preventDefault(); setOpen(o => !o); }}
        className={`px-2 py-1 text-xs rounded transition-colors flex items-center gap-0.5 ${
          currentType ? editorShell.chipActive : editorShell.chipIdle
        }`}
      >
        {activeLabel}<span className="opacity-50 text-[9px] ml-0.5">▾</span>
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-50 min-w-[5rem]">
          {OL_TYPES.map(({ key, label }) => (
            <button key={key} type="button"
              onMouseDown={e => { e.preventDefault(); apply(key); }}
              className={`w-full text-center px-3 py-1.5 text-xs transition-colors hover:bg-gray-50 ${
                currentType === key ? 'text-blue-600 font-medium' : 'text-gray-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}


export default function DocsPage(props: { host: DocsPageHost; docId: string }) {
  return (
    <DocsHostProvider host={props.host}>
      <DocsMediaProvider value={props.host.media}>
        <DocsPageBody {...props} />
      </DocsMediaProvider>
    </DocsHostProvider>
  );
}

function DocsPageBody({ host, docId }: { host: DocsPageHost; docId: string }) {
  // Phase A：canvas 全屏 inline 编辑器（components/canvas-fullscreen/DocEditor.tsx）替代旧 iframe + ?embed=fullscreen 方案。
  // standalone /ai-scribe/[id] 保留完整 standalone UI，不再有 embed 模式。

  const t = useStudioT();
  const language = useStudioLang();
  const tRef = useRef(t);
  tRef.current = t;
  languageRef.current = language;  // 同 ticketDocIdRef 手法（:1472）——每次渲染同步写入，供低频清理
  //   effect 闭包读取最新值而不必把 language 塞进它们的依赖数组（见模块顶 languageRef 声明处注释）。

  const { mdToTiptapHtml, tiptapHtmlToMd } = useMemo(() => ({
    mdToTiptapHtml: (md: string): string => mdToEditorHtml(md, host.mdHooks),
    tiptapHtmlToMd: (html: string): string => editorHtmlToMd(host.saveHtml ? host.saveHtml(html) : html, host.mdHooks),
  }), [host]);

  const [mdContent, setMdContent]       = useState("");
  const [title, setTitle]               = useState(t('bf_scribe_untitled'));
  const [loadingDoc, setLoadingDoc]     = useState(true);
  const [loadFail, setLoadFail]         = useState<DocsLoadFail | null>(null);
  // [分享到个人主页 桩①] 挂载三字段初值（doc 载入时填·作分享弹窗展开区初值）
  const [profileInitial, setProfileInitial] = useState<ProfilePublishState>({ published: false, coverUrl: "", title: "" });
  const docImageInputRef                = useRef<HTMLInputElement>(null);
  const docVideoInputRef                = useRef<HTMLInputElement>(null);
  const docAudioInputRef                = useRef<HTMLInputElement>(null);
  const [saveStatus, setSaveStatus]     = useState<"idle" | "saving" | "saved" | "error">("idle");
  // [记忆②·编辑闭环] 全局记忆只读（GET 带 readonly 标志·禁编辑/禁保存·别让用户白编辑撞 403）
  const [readonlyDoc, setReadonlyDoc]   = useState(false);
  // 只读 doc 的内容单独存一份当唯读视图源——别用 initialMd（编辑器加载后被置 null·见下方 1495 行 setInitialMd(null)）
  const [readonlyContent, setReadonlyContent] = useState("");
  // 本文分享页唯一访问人数（doc GET 顺手带 view_count·只 owner 请求算·作者本人不计）·null=未载入/无数据不显示
  const [viewCount, setViewCount]       = useState<number | null>(null);
  const [pdfLoading, setPdfLoading]     = useState(false);
  const [wordLoading, setWordLoading]   = useState(false); // Word 后端导出端点：改走后端·加 loading 态同 PDF 手感
  // 点「分享」→ 打开 ShareLinkModal（飞书风下拉两态 + 链接 + 复制）·替原一次性 PUT public + toast。
  const [shareModalOpen, setShareModalOpen] = useState(false);
  // [文档分享·安全#2] 系统保护的内部文档不可分享·按钮 disable（后端 PUT 亦兜底拒）。
  const [shareDisabled, setShareDisabled] = useState(false);
  // [付费上架·批一] 上架编辑态 + 卡点线
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);
  const { isSeller } = host.useMeRoles(currentUserEmail);
  const [isListingMode, setIsListingMode] = useState(false);
  const [listingModalOpen, setListingModalOpen] = useState(false);
  const [paywallPositionPx, setPaywallPositionPx] = useState(0);
  const [listingWarnOpen, setListingWarnOpen] = useState(false);
  const [initialMd, setInitialMd]       = useState<string | null>(null);
  const [leftPanelWidth, setLeftPanelWidth] = useState(LEFT_PANEL_DEFAULT_WIDTH);
  const [rightPanelWidth, setRightPanelWidth] = useState(RIGHT_PANEL_DEFAULT_WIDTH);
  // 直板机/折叠/网页三档断点 + 桌面侧栏可收 + 窄屏全屏覆盖
  const { isNarrow, isMedium, ready: responsiveReady } = useResponsiveLayout();
  const [leftCollapsed, setLeftCollapsed] = useState(false);   // 桌面: 工具栏最左收合钮 toggle·窄屏不用
  const [rightCollapsed, setRightCollapsed] = useState(false); // 桌面: 工具栏最右收合钮 toggle·窄屏不用
  const [leftMobileOpen, setLeftMobileOpen] = useState(false); // 窄屏: 点目录入口开 = fixed inset-0 全屏覆盖
  const [rightMobileOpen, setRightMobileOpen] = useState(false); // 窄屏: 点 AI 入口开 = fixed inset-0 全屏覆盖
  const userTouchedRightCollapseRef = useRef(false);
  useEffect(() => {
    if (!responsiveReady) return;
    if (userTouchedRightCollapseRef.current) return; // 用户碰过=锁住自动 sync·尊重手动改
    setRightCollapsed(isMedium);  // 跟断点:中宽=收·桌面/窄屏=展开(窄屏 collapsed 不参与渲染·走 mobileOpen)
  }, [responsiveReady, isMedium]);
  // 直板机目录点标题跳转后弹 2 秒 toast 提示「请收起目录看正文」(目录全屏覆盖时盖着正文)
  const [navToast, setNavToast] = useState(false);
  const navToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // unmount cleanup:免 setTimeout 触发时组件已卸载导致 setState on unmounted warn
  useEffect(() => {
    return () => {
      if (navToastTimerRef.current) clearTimeout(navToastTimerRef.current);
    };
  }, []);
  // 原生 execCommand('undo') 已改过 DOM 但
  //   stepHistoryDir 没能真正 applied（rollback失败/历史耗尽/版本列表空/被并发调用挡下）时用——
  //   input 处理器把 DOM 强制拉回已知基线后弹 2 秒提示，别让用户以为撤销悄悄生效了（同 navToast 范式）。
  const [undoRevertedToast, setUndoRevertedToast] = useState(false);
  const undoRevertedToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (undoRevertedToastTimerRef.current) clearTimeout(undoRevertedToastTimerRef.current);
    };
  }, []);
  // 工具栏 7 组合一钮的 popover 开关·单一 state 同时只能开 1 个（窄屏才用）
  const [openToolGroup, setOpenToolGroup] = useState<null | 'A' | 'B' | 'C' | 'D' | 'F' | 'G' | 'H' | 'export' | 'paper' | 'filecard'>(null);
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const colorSelRef = useRef<{ from: number; to: number; text: string } | null>(null);
  const [fontScale, setFontScale] = useState(1);
  const lastSavedScaleRef = useRef<number | null>(null);  // 已落库值·防 load 设初值/同值时冗余写
  const fontSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const adjustFontScale = useCallback((delta: number) => setFontScale(s => clampFontScale(s + delta)), []);
  // 载入（无则默认 1.0）；lastSavedScaleRef 记已落库值供下方写 effect 跳过「load 设初值」拍。
  useEffect(() => {
    let alive = true;
    void host.loadEditorFontScale().then(s => {
      if (!alive) return;
      const v = typeof s === 'number' ? clampFontScale(s) : 1;
      lastSavedScaleRef.current = v;
      setFontScale(v);
    });
    return () => { alive = false; };
  }, []);
  // debounce 500ms 写库（只用户真改才写·别每滚一格写）。
  useEffect(() => {
    if (lastSavedScaleRef.current === null) return;        // 尚未 load 完
    if (fontScale === lastSavedScaleRef.current) return;   // 与已存相同（含 load 初值）→ 不写
    if (fontSaveTimer.current) clearTimeout(fontSaveTimer.current);
    fontSaveTimer.current = setTimeout(() => {
      lastSavedScaleRef.current = fontScale;
      void host.saveEditorFontScale(fontScale);
    }, 500);
    return () => { if (fontSaveTimer.current) clearTimeout(fontSaveTimer.current); };
  }, [fontScale]);
  // Ctrl+滚轮缩放 handler（stable·setFontScale 稳定·仅 ctrlKey 才缩放·preventDefault 防浏览器整页缩放）。
  const pagedModeRef = useRef(false);  // 分页视图下字号钉 100%（画面＝打印）·Ctrl+滚轮不缩
  const wheelZoomHandler = useCallback((e: WheelEvent) => {
    if (!e.ctrlKey) return;
    if (pagedModeRef.current) return;
    e.preventDefault();
    setFontScale(s => clampFontScale(s + (e.deltaY < 0 ? FONT_SCALE_STEP : -FONT_SCALE_STEP)));
  }, []);
  // 🔴 用 callback ref 挂 wheel 监听（非 useEffect deps []）：独立页编辑器滚动容器在 editor 就绪后才渲染·
  //   []useEffect 在 mount 时 ref 还 null 会漏挂。callback ref 节点挂载即挂·卸载即清·不漏。
  const editorScrollRef = useRef<HTMLDivElement | null>(null);
  const attachEditorScroll = useCallback((node: HTMLDivElement | null) => {
    if (editorScrollRef.current) editorScrollRef.current.removeEventListener('wheel', wheelZoomHandler);
    editorScrollRef.current = node;
    if (node) node.addEventListener('wheel', wheelZoomHandler, { passive: false });
  }, [wheelZoomHandler]);
  useEffect(() => () => { if (fontSaveTimer.current) clearTimeout(fontSaveTimer.current); }, []);

  const [paperSettings, setPaperSettings] = useState<DocPaperSettings>(() => defaultPaperSettings(null));
  const paperPref = paperSettings.paper;
  pagedModeRef.current = !!paperPref;
  const lastSavedPaperRef = useRef<string | undefined>(undefined);  // 已存设定的签名·undefined=尚未随 doc load 完
  const [paperSaveError, setPaperSaveError] = useState(false);
  const paperPendingRef = useRef<DocPaperSettings | undefined>(undefined);   // 恒=用户当前真正想要的设定
  const paperDrainPromiseRef = useRef<Promise<void> | null>(null);              // 当前在跑的写链（供 exportWord await）

  // 写纸型设定时带上登入凭证（同 exportWord）：App 内的网页视图不一定带 cookie，带上才存得进去。
  const writePaperOnce = useCallback(async (target: DocPaperSettings): Promise<boolean> => {
    for (let attempt = 0; attempt <= 2; attempt++) {
      let ok = false;
      try {
        const res = await host.putDoc(docId, paperSettingsColumns(target), { bearer: true });
        ok = res.ok;
      } catch { ok = false; }
      if (ok) {
        lastSavedPaperRef.current = paperSettingsKey(target);  // 🔴 只在真收到 2xx 后才认定"已存"（防假成功）
        setPaperSaveError(false);
        // 全局快照此前用 void（fire-and-forget）——doc PUT 一成功、drain
        //   循环立刻可能判"追平完成"结束，此刻若马上在别处 POST 建新文档，会在这份全局快照写完成
        //   **之前**读到旧值、把错误纸型固化进新文档（docs/route.ts POST 的 initialPaperPref 快照读）。
        //   改 await：本文档这次写链（drainPaperWrites 返回的 promise，exportWord/后续同页操作都会
        //   等它）必须连全局快照一起写完才算"跑完"，把"漏读旧值"的窗口从"任意时刻"收紧到"仅当另一
        //   个页面/标签在写链跑完前的极短并发窗口内提前发 POST"——后者是 best-effort 全局快照设计
        // 固有的跨页竞态，非本函数职责内可再消除。
        await host.saveDocPaperPref(target.paper).catch(() => {});
        return true;
      }
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 1200));
    }
    setPaperSaveError(true);  // 重试用尽仍失败→显式告知·不悄悄假成功·ref 留旧值等下次真实选择再踢动
    return false;  // 显式回失败状态·供 drainPaperWrites 据此止损（不再无限重试）
  }, [docId, host]);

  // 唯一发 PUT 的入口：串行追平 paperPendingRef，任意时刻至多一个 PUT 在途。
  //   多个调用者（选择 handler / 复用中的自身循环）共享同一个正在跑的 promise。
  const drainPaperWrites = useCallback((): Promise<void> => {
    if (paperDrainPromiseRef.current) return paperDrainPromiseRef.current;
    const run = (async () => {
      try {
        while (paperPendingRef.current !== undefined && paperSettingsKey(paperPendingRef.current) !== lastSavedPaperRef.current) {
          // 此前 writePaperOnce 失败(重试用尽)后既不清 pending、也不返回
          //   失败状态——while 条件（pending!==lastSaved）纹丝不动、循环立刻原地重跑，形成真·无限
          //   重试：导出按钮 exportWord await 的正是这条 drain promise，会被永久挂起（按钮转圈不停·
          //   PUT 持续打向后端）。现在 writePaperOnce 显式回 boolean：失败就 break 出循环，让 drain
          //   promise 正常 resolve（finally 里 ref 归 null）——exportWord 等到的是"已尽力，仍可能是
          //   旧值"而非"永远等不到"，paperSaveError 横幅已告知用户没存上；用户下一次真实选择纸型
          //   （含重选同一个值）会因 pending!==lastSaved 再次触发全新一轮 drainPaperWrites（等同手动
          //   重试）——不是"再也不重试"，只是不再原地无限自转。
          const ok = await writePaperOnce(paperPendingRef.current);
          if (!ok) break;
        }
      } finally {
        paperDrainPromiseRef.current = null;
      }
    })();
    paperDrainPromiseRef.current = run;
    return run;
  }, [writePaperOnce]);

  // 点选纸型：state 更新（UI 高亮）+ 当帧同步把目标排进写链——不靠 useEffect 追 paperPref 变化
  // 设定改动一律经这里（纸型／页码开关）：state + 当帧排进写链。paperSettingsRef 让连点两下拿到的是最新值。
  const paperSettingsRef = useRef(paperSettings);
  paperSettingsRef.current = paperSettings;
  const updatePaperSettings = useCallback((patch: Partial<DocPaperSettings>) => {
    const next: DocPaperSettings = { ...paperSettingsRef.current, ...patch };
    paperSettingsRef.current = next;
    setPaperSettings(next);
    if (lastSavedPaperRef.current === undefined) return;  // 尚未随 doc load 完·load 效果自己会补写初值
    paperPendingRef.current = next;
    void drainPaperWrites();
  }, [drainPaperWrites]);
  const selectPaperPref = useCallback((next: DocPaperPref | null) => updatePaperSettings({ paper: next }), [updatePaperSettings]);
  // 真分页页数（PagedView 扩展量完回报）＋页码文案
  const [pagedCount, setPagedCount] = useState(1);
  const pagedPageLabel = useCallback((n: number, total: number) => t('scribe_pg_page_num').replace('{n}', String(n)).replace('{total}', String(total)), [t]);

  // 「纸张」下拉项（窄屏/桌面两分支共用）：提示行（铁项6「参考」措辞）+ 关闭 + 六选一
  // + 写库重试用尽仍失败时的错误行（红字·不占正常流程视觉）。
  const paperDropdownItems = useMemo(() => [
    { key: 'hint', label: <span className="text-[10px] text-gray-400">{t('scribe_paper_hint')}</span>, onSelect: () => {}, disabled: true },
    // 页码开关：只在分页视图下有意义·关闭时置灰
    { key: 'page-numbers', label: <span data-testid="doc-paper-page-numbers">{`${paperSettings.pageNumbers ? '✓ ' : ''}${t('scribe_pg_show_numbers')}`}</span>, active: paperSettings.pageNumbers, disabled: !paperPref, onSelect: () => updatePaperSettings({ pageNumbers: !paperSettingsRef.current.pageNumbers }) },
    ...(paperSaveError ? [{ key: 'save-error', label: <span className="text-[10px] text-red-500">{t('scribe_paper_save_error')}</span>, onSelect: () => {}, disabled: true }] : []),
    { key: 'off', label: t('scribe_paper_off'), active: !paperPref, onSelect: () => selectPaperPref(null) },
    ...PAPER_PREFS.map(p => {
      const { kind, orientation } = splitPaperPref(p);
      return {
        key: p,
        label: `${kind.toUpperCase()} · ${t(orientation === 'portrait' ? 'scribe_paper_portrait' : 'scribe_paper_landscape')}`,
        active: paperPref === p,
        onSelect: () => selectPaperPref(p),
      };
    }),
  ], [paperPref, paperSettings.pageNumbers, paperSaveError, t, selectPaperPref, updatePaperSettings]);

  const [leftTab, setLeftTab]     = useState<LeftTab>("outline"); // secretbox hidden for now
  // 派生 tab 治窄屏状态残留:桌面态打开 drive→缩窄→leftTab='drive' 残留致 mobile aside 空白(outline 跳/drive 被 !isNarrow 挡)。
  //   窄屏永远走 outline(铁项5「只留目录」)·别用副作用 setLeftTab(resize 来回会抖+改了用户桌面回去的 tab 态)。
  const effectiveLeftTab: LeftTab = isNarrow ? 'outline' : leftTab;
  const [sbEnabled, setSbEnabled] = useState(false);
  // 暗格默认代号 region-aware（地點/時間 繁→陆版简体·人物/物品 繁简同字）
  const [entries, setEntries]     = useState<SecretEntry[]>(
    [{ real: "", code: `${t('bf_scribe_code_person')}1` }, { real: "", code: `${t('bf_scribe_code_place')}1` }, { real: "", code: `${t('bf_scribe_code_time')}1` }, { real: "", code: `${t('bf_scribe_code_item')}1` }]
  );

  // 🔴 messages 的两类变更必须分家：
  //   · **本地事件**（用户发消息 / AI 流式回复 / 过程条更新…）→ 该触发一次保存把消息持久化；
  //   · **服务端回读**（初始加载 chat_history/agent_messages、外部编辑侦测轮询补拉 refreshMsgs）
  //     → **绝不能**触发保存。
  //   原实现里 autosave effect 直接依赖 `messages` 数组，两类不分：轮询侦测到「对话之外有人改了
  //   文档」→ refreshMsgs 的 setMessages 改了数组 → 3 秒后 autosave 把本页签内存里的**旧正文**
  //   无条件 PUT 回库，把外部编辑盖掉——侦测层不但不挂闸，还亲手替覆盖扣了扳机
  //   治法：本地变更一律走下方 wrapper `setMessages`（顺手把本地世代号 +1），服务端回读走原始
  //   setState `setMessagesFromServer`（不动世代号）；autosave effect 只依赖世代号、不再依赖数组。
  //   ⚠️ 后人注意：新增「服务端把消息回读进 state」的路径时，必须用 setMessagesFromServer，
  //   否则这条覆盖死循环会原样长回来。
  const [messages, setMessagesFromServer] = useState<ChatMsg[]>([]);
  const [localMsgsGen, setLocalMsgsGen] = useState(0);
  const setMessages = useCallback<Dispatch<SetStateAction<ChatMsg[]>>>(v => {
    setLocalMsgsGen(g => g + 1);
    setMessagesFromServer(v);
  }, []);
  const setStepProgressTerminal = useCallback((assistantMsgId: string, finalStep: string) => {
    setMessages(prev => prev.map(m => {
      if (!(m.role === 'assistant' && m.id === assistantMsgId)) return m;
      const prevSteps = m.stepProgress?.steps ?? [];
      const nextSteps = prevSteps.length > 0
        ? [...prevSteps.slice(0, -1), { step: finalStep, ts: Date.now() }]
        : [...prevSteps, { step: finalStep, ts: Date.now() }];
      return { ...m, stepProgress: { steps: nextSteps, currentStep: finalStep } };
    }));
  }, []);
  const docFoldLatchRef = useRef<Set<string>>(new Set());
  useEffect(() => { docFoldLatchRef.current = new Set(); }, [docId]);
  useEffect(() => {
    const cur = pendingConfirmSaveFailureRef.current;
    if (cur) setStepProgressTerminal(cur.assistantMsgId, unconfirmedSaveStep(languageRef.current));
    pendingConfirmSaveFailureRef.current = null;
  }, [docId]);
  useEffect(() => {
    const id = setInterval(() => {
      const cur = pendingConfirmSaveFailureRef.current;
      if (cur && Date.now() - cur.ts > PENDING_CONFIRM_FAILURE_TTL_MS) {
        setStepProgressTerminal(cur.assistantMsgId, unconfirmedSaveStep(languageRef.current));
        pendingConfirmSaveFailureRef.current = null;
      }
    }, 30_000);
    return () => clearInterval(id);
  }, []);
  // 读秒 ticker：原紫底 DocThinkBubble 内部各自挂 setInterval 每秒
  // force 自身重渲（:1341-1347 旧版）；ProcessFold 抽成无状态展示组件后 headerLabel 由本页每条消息在
  // render 期算好字符串传入——若无独立 ticker，长时间等首 token（无 SSE 事件到达·setMessages 不触发）时
  // 秒数会冻结在挂载那一刻的 elapsedSec，直到下一次真实事件重渲才跳。用页级 tick 状态 + 1s interval 强制
  // 整页重渲，仅在存在「思考/生成中」消息时开表、无消息在生成时不开（避免闲置页面空耗）。
  const [, foldTick] = useState(0);
  useEffect(() => {
    const hasActiveFold = messages.some(m => m.role === 'assistant' && m.streaming && !m.text && !m.thinkEndedAt);
    if (!hasActiveFold) return;
    const id = setInterval(() => foldTick(n => (n + 1) % 1_000_000), 1000);
    return () => clearInterval(id);
  }, [messages]);
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const messagesRef   = useRef<ChatMsg[]>([]);
  const pendingConfirmSaveFailureRef = useRef<{ assistantMsgId: string; docId: string; contentSnapshot: string; gen: number; ts: number } | null>(null);

  const saveTimer      = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusTimer    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isProgrammatic = useRef(false);
  const mdContentRef   = useRef(mdContent);
  const contentGenRef  = useRef(0);
  const titleRef       = useRef(title); // 供 saveDoc 响应回填时读"到达时刻的当前输入"，非请求闭包旧值
  const hasManualTitle = useRef(false);
  const skipPanelWidthPersist = useRef(true);

  useEffect(() => {
    try {
      const savedLeft = Number(window.localStorage.getItem('aiscribe:leftPanelWidth'));
      const savedRight = Number(window.localStorage.getItem('aiscribe:rightPanelWidth'));
      if (Number.isFinite(savedLeft) && savedLeft > 0) {
        setLeftPanelWidth(clampPanelWidth(savedLeft, LEFT_PANEL_MIN_WIDTH, LEFT_PANEL_MAX_WIDTH));
      }
      if (Number.isFinite(savedRight) && savedRight > 0) {
        setRightPanelWidth(clampPanelWidth(savedRight, RIGHT_PANEL_MIN_WIDTH, RIGHT_PANEL_MAX_WIDTH));
      }
    } catch { /**/ }
  }, []);

  useEffect(() => {
    if (skipPanelWidthPersist.current) {
      skipPanelWidthPersist.current = false;
      return;
    }
    try {
      window.localStorage.setItem('aiscribe:leftPanelWidth', String(leftPanelWidth));
      window.localStorage.setItem('aiscribe:rightPanelWidth', String(rightPanelWidth));
    } catch { /**/ }
  }, [leftPanelWidth, rightPanelWidth]);

  const startPanelResize = useCallback((panel: 'left' | 'right', e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = panel === 'left' ? leftPanelWidth : rightPanelWidth;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onPointerMove = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientX - startX;
      if (panel === 'left') {
        setLeftPanelWidth(clampPanelWidth(startWidth + delta, LEFT_PANEL_MIN_WIDTH, LEFT_PANEL_MAX_WIDTH));
      } else {
        setRightPanelWidth(clampPanelWidth(startWidth - delta, RIGHT_PANEL_MIN_WIDTH, RIGHT_PANEL_MAX_WIDTH));
      }
    };

    const stopResize = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', stopResize);
      window.removeEventListener('pointercancel', stopResize);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', stopResize, { once: true });
    window.addEventListener('pointercancel', stopResize, { once: true });
  }, [leftPanelWidth, rightPanelWidth]);

  useEffect(() => { contentGenRef.current += 1; mdContentRef.current = mdContent; }, [mdContent]);
  useEffect(() => { titleRef.current = title; }, [title]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const brand = t('agent_dilin_name');
    document.title = docsTabTitle(title, brand);
    return () => { document.title = brand; };
  }, [title, t]);

  // [桩A·贴图/拖图] insertMedia 经 ref 桥进 editorProps：editorProps 在 useEditor 创建时只读一次，
  //   而 insertMedia 随 editor 重建（首渲染 editor=null）；直接闭包会锁死在「editor=null 版」（永远空转）。
  // ref 始终指向最新 insertMedia。
  const insertMediaRef = useRef<((files: FileList | File[]) => void) | null>(null);
  const insertFileCardsRef = useRef<((files: FileList | File[]) => void) | null>(null);  // 档案卡片：上传新档挂卡（handlePaste/handleDrop 同 insertMediaRef 范式）
  const [docFolderId, setDocFolderId] = useState<string | null>(null);

  // [留痕二期·铁项2] Ctrl+Z 接回滚历史：处理函数定义在 saveDoc 之后（依赖它 flush）·经 ref 桥进
  //   useEditor 的 keymap 扩展（同 insertMediaRef 范式：extensions 创建时只读一次·ref 恒指最新）。
  const undoFromHistoryRef = useRef<(() => void) | null>(null);
  const redoFromHistoryRef = useRef<(() => void) | null>(null);
  type UndoBaseline = { content: string; title: string; dirty: boolean };
  const undoFromHistoryAwaitableRef = useRef<((baseline?: UndoBaseline) => Promise<boolean>) | null>(null);

  // ── TipTap editor ─────────────────────────────────────────────
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ orderedList: false, ...(host.has('history') ? { history: false } : {}) }),
      ...(host.has('history') ? [Extension.create({
        name: 'historyStepsKeymap',
        addKeyboardShortcuts() {
          return {
            'Mod-z': () => { undoFromHistoryRef.current?.(); return true; },
            'Shift-Mod-z': () => { redoFromHistoryRef.current?.(); return true; },
            'Mod-y': () => { redoFromHistoryRef.current?.(); return true; },
          };
        },
      })] : []),
      OrderedListExtended,
      IndentExtension,
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      MermaidBlock.configure({ useLabels: useMermaidLabels }),
      UploadPlaceholderNode,
      host.videoNode,
      host.audioNode,
      ...(host.fileCardNode ? [host.fileCardNode] : []),  // 档案卡片（游客版没有）
      PageBreakNode,
      TrailingParagraph,
      (host.wrapMediaNode ? host.wrapMediaNode(ResizableImage, 'img') : ResizableImage).configure({ inline: false, allowBase64: false }),
      // 富文本 directive 渲染。
      ColorMark,
      BgMark,
      BoxMark,
      FontMark,
      FontLoader,
      CalloutNode,
      LatexNode,
      TocNode.configure({ labels: () => ({ title: tRef.current('bf_toc_title'), empty: tRef.current('bf_toc_empty') }) }),
      // 网址四形态：linkCard 行内 atom 节点（四形态渲染+hover 工具条+attrs 持久）；
      //   Link mark 兜「外部富文本粘贴的纯 <a>」与「选中文字贴 URL→名称链接」（linkOnPaste）·
      //   openOnClick 关（编辑器内误跳）·autolink 关（打字不自动转·手贴走 handlePaste 的 linkCard 默认原网址）。
      LinkCardNode,
      Link.configure({ openOnClick: false, autolink: false, linkOnPaste: true }),
      // 增强半：纯文本复制时链接在可见文字外再附一次网址。
      //   🔴 linkCard 走它自己的 renderText 即可；**Link mark 没有 renderText 这个钩**
      //   （tiptap 只有 Node 有·getTextSerializersFromSchema 只遍历 schema.nodes）⇒ mark 那半
      //   只能在编辑器级接管 clipboardTextSerializer，就是这一行。详见 plain-text-href.ts 档头。
      PlainTextHrefSerializer,
      // 没有角色对话（游客版）⇒ 占位字不提「右侧 AI 面板输入指令」
      Placeholder.configure({ placeholder: host.has('roleWire') ? t('scribe_editor_ph') : t('docs_guest_editor_ph') }),
      // 纸张分页视图：只插排版垫片装饰（不进文档内容）·纸张关＝不插（几何由 usePagedEditorGeometry 下发）
      PagedView.configure({ onPageCount: setPagedCount }),
    ],
    content: '',
    immediatelyRender: false,
    editorProps: {
      // [桩A·贴图/拖图] 截图粘贴(clipboardData.files)/拖拽(dataTransfer.files)里的原始图片·视频文件。
      //   Tiptap/ProseMirror 默认只认 HTML 里的 <img>·不处理剪贴板/拖拽的 image|video blob → 默默丢弃（allowBase64:false 也不退化 base64）。
      //   这里拦下走现成 insertMedia 上传链（→ uploadPlaceholder → /api/upload/media → 落节点）。
      //   view.editable 实时守只读 doc；非媒体文件 return false 交还默认（文本/HTML 正常粘贴/拖入）。
      handlePaste: (view, event) => {
        if (!view.editable) return false;
        dirtyRef.current = true;  // 用户粘贴=真改（文本或媒体皆然）→ 置脏（只透传·不拦事件）
        const pastedText = event.clipboardData?.getData('text/plain')?.trim() ?? '';
        const pastedFiles = event.clipboardData?.files;
        const cursorMarks = view.state.storedMarks ?? view.state.selection.$from.marks();
        if ((!pastedFiles || pastedFiles.length === 0) && view.state.selection.empty && /^https?:\/\/\S+$/.test(pastedText)
            && !view.state.selection.$from.parent.type.spec.code
            && !cursorMarks.some((mk) => mk.type.name === 'code')) {
          const linkCardType = view.state.schema.nodes.linkCard;
          if (linkCardType) {
            event.preventDefault();
            // 括号编成 %28/%29
            const node = linkCardType.create({ href: encodeMdHrefParens(pastedText), displayMode: 'url', title: null, description: null, image: null, favicon: null });
            view.dispatch(view.state.tr.replaceSelectionWith(node).scrollIntoView());
            return true;
          }
        }
        const files = event.clipboardData?.files;
        if (!files || files.length === 0) return false;
        const media = Array.from(files).filter(f => f.type.startsWith('image/') || f.type.startsWith('video/'));
        // 档案卡片：图片／影片以外的档（html、zip、pdf…）⇒ 传进云盘、挂成卡片
        const others = host.fileCardNode ? Array.from(files).filter(f => !(f.type.startsWith('image/') || f.type.startsWith('video/'))) : [];
        if (media.length === 0 && others.length === 0) return false;
        event.preventDefault();
        if (media.length) insertMediaRef.current?.(media);
        if (others.length) insertFileCardsRef.current?.(others);
        return true;
      },
      handleDrop: (view, event) => {
        if (!view.editable) return false;
        dirtyRef.current = true;  // 用户拖放=真改 → 置脏
        const files = event.dataTransfer?.files;
        if (!files || files.length === 0) return false;
        const media = Array.from(files).filter(f => f.type.startsWith('image/') || f.type.startsWith('video/'));
        // 档案卡片：拖进来的非图／影档 ⇒ 传进云盘、挂成卡片（落在拖放点）
        const others = host.fileCardNode ? Array.from(files).filter(f => !(f.type.startsWith('image/') || f.type.startsWith('video/'))) : [];
        if (media.length === 0 && others.length === 0) return false;
        event.preventDefault();
        if (others.length) {
          const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
          if (at) view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(at.pos))));
        }
        if (media.length) insertMediaRef.current?.(media);
        if (others.length) insertFileCardsRef.current?.(others);
        return true;
      },
      // dirty 事件驱动：只有真实用户输入才置脏。全 return false 透传·只置脏不拦事件。
      //   打字/IME输入法输入 → handleTextInput（ProseMirror 对 composition 期文本插入也走此；IME 结束再由下方 compositionend 兜底）。
      handleTextInput: (view) => {
        if (view.editable) dirtyRef.current = true;
        return false;  // 只标脏·不接管插入
      },
      //   删除/回车等改文键 → handleKeyDown（打字字符本身已由 handleTextInput 覆盖；此处专补不经 textInput 的改文键）。
      handleKeyDown: (view, event) => {
        if (view.editable) {
          const k = event.key;
          // [留痕二期] Ctrl+Z/Y 从 mut 列表移除：撤销/重做已改走回滚历史（historyStepsKeymap→
          //   rollback API·状态由行走逻辑自管·applyHistoryResult 收 dirty）——再置脏会让每次按键
          //   都误判「用户手编过」而重开 burst·行走永远走不到第二步。
          const mut = k === 'Backspace' || k === 'Delete' || k === 'Enter';
          if (mut) dirtyRef.current = true;
        }
        return false;
      },
      handleDOMEvents: {
        // 剪切 → 内容被删=真改
        cut: (view) => {
          if (view.editable) dirtyRef.current = true;
          return false;
        },
        // 中文输入法兜底：IME 合成结束必置脏（handleTextInput 对部分浏览器 composition 期可能不触发·此为钉死覆盖）
        compositionend: (view) => {
          if (view.editable) dirtyRef.current = true;
          return false;
        },
      },
    },
    onUpdate: ({ editor }) => {
      if (isProgrammatic.current) return;
      // dirty 不再在此置——onUpdate 会被异步 NodeView 后台派发（视频转码轮询 setNodeMarkup / 配图工单 setSrc / 工单转视频 replaceWith）在用户没打字时误触发 → 误置脏 → 罩落误弹「已暂存」。
      //   dirty 改由真实用户输入事件驱动（下方 editorProps.handleTextInput/handleKeyDown/handlePaste/handleDrop/handleDOMEvents cut+compositionend）——后台/程序化派发天然免疫。此处只留 md 镜像同步。
      setMdContent(tiptapHtmlToMd(editorHtmlWithLiveColWidths(editor)));
    },
  });
  // 纸张设定 → PagedView 几何（关＝回连续流）
  usePagedEditorGeometry(editor, paperSettings);

  // 真接线：上面 editorProps.
  //   handleDOMEvents.input 那条挂钩点走真证实生产环境不触发（诊断见上方注释）——改成自己直接
  //   在 editor.view.dom 上挂一个原生 `input` 监听（捕获阶段），完全绕开 ProseMirror
  //   someProp/plugins 的分发链，不依赖任何扩展/NodeView 的事件处理顺序。editor 实例变化（含
  //   StrictMode 双挂载重建）时 cleanup 会先摘旧监听再挂新的，不会重复绑定/漏绑定。
  useEffect(() => {
    if (!editor || !host.has('history')) return;
    const dom = editor.view.dom;
    const onNativeInput = (event: Event) => {
      if (!editor.view.editable) return;
      if ((event as InputEvent).inputType !== 'historyUndo') return;
      const baseline: UndoBaseline = {
        content: mdContentRef.current,
        title: titleRef.current,
        dirty: dirtyRef.current,
      };
      setTimeout(() => {
        void undoFromHistoryAwaitableRef.current?.(baseline).then((applied) => {
          if (!applied) {
            setUndoRevertedToast(true);
            if (undoRevertedToastTimerRef.current) clearTimeout(undoRevertedToastTimerRef.current);
            undoRevertedToastTimerRef.current = setTimeout(() => setUndoRevertedToast(false), 2000);
          }
        });
      }, 0);
    };
    dom.addEventListener('input', onNativeInput, true);
    return () => dom.removeEventListener('input', onNativeInput, true);
  }, [editor, host]);

  const { painterArmed, armFormatPainter } = useFormatPainter(editor, t);

  const centerColRef = useRef<HTMLDivElement>(null);
  const onShieldReleaseRef = useRef<() => Promise<void>>(async () => {});
  const [editorAgentKey, setEditorAgentKey] = useState<string | null>(null);
  const roleBusyOn = !!docId && host.has('roleWire');
  const { busy: roleBusy, roster: roleRoster } = host.useEditorRoleBusy({ editorAgentKey, enabled: roleBusyOn });
  const aiShield = host.useEditorAIShield({ kind: 'doc', id: docId, enabled: !loadingDoc && !readonlyDoc && !!docId && host.has('docLive'), onRelease: () => onShieldReleaseRef.current(), containerRef: centerColRef, hold: roleBusy });
  const aiShieldIngest = aiShield.ingest;
  const aiShieldKickRef = useRef(aiShield.kick);
  aiShieldKickRef.current = aiShield.kick;
  const locked = aiShield.locked;
  const editingMark = locked ? { by: aiShield.by } : null;
  const lockedRef = useRef(false);
  useEffect(() => { lockedRef.current = locked; }, [locked]);
  // 未罩时也消费别人的更新（此前未罩一律不动正文·只补拉气泡）：
  //   lastSeenUpdatedAtRef＝上一拍看到的 updated_at（载入时立基线）；ownWriteStampsRef＝本页写回成功时服务端回的 updated_at（自己那发不算别人改）；
  //   docLive＝Realtime 订上了（在线 ⇒ 轮询照旧 4s/6s 只当兜底；不在线 ⇒ 3 秒轮询）；pollKickRef＝Realtime 一响就当场拉一拍。
  const lastSeenUpdatedAtRef = useRef<string | null>(null);
  const ownWriteStampsRef = useRef<Set<string>>(new Set());
  const [docLive, setDocLive] = useState(false);
  const docLiveRef = useRef(false);
  useEffect(() => { docLiveRef.current = docLive; }, [docLive]);
  const pollKickRef = useRef<() => void>(() => {});
  const editorAgentKeyRef = useRef<string | null>(null);
  // 本页正文 PUT 在飞的笔数：在飞时一拍 GET 可能看到「已落库但戳还没回读进 ownWriteStamps」的自己那版 ⇒ 这一拍先不判（下一拍再判·戳到那时已记下）。
  const docPutInFlightRef = useRef(0);
  // 罩期在途输入暂存：dirtyRef=用户真改过未存；stashRef=罩落瞬间暂存的未保存 md；lastServerContentRef=已知服务端内容（平滑重渲基线）。
  const dirtyRef = useRef(false);
  const stashRef = useRef<string | null>(null);
  // 🔴 stashRef 的 title 半边：本批新上的 title 闸让
  //   「我在改标题 × 外部也改了标题」第一次真能走进冲突条（改前 title-only 外部改名根本不产生
  //   409、这条路进不来），而 resolveConflictTakeServer 只把正文塞进 stashRef、紧接着无条件
  //   setTitle(serverTitle) 盖掉用户刚敲进标题框、还没落库的新标题，restoreStash 也只还原正文——
  // 等于本批亲手在「不许静默丢用户在途输入」上开了半个口子：
  //   护栏只盖了正文那一半。这里补上 title 那一半：同款进 stash、同款还原、还原条同步覆盖。
  //   null = 这次暂存不含 title（例如玻璃罩进罩暂存只暂存正文·罩期不改标题）。
  const stashTitleRef = useRef<string | null>(null);
  const lastServerContentRef = useRef<string>('');
  // 🔴 与 lastServerContentRef 同族·title 版本：
  //   存「已知服务端 title 原值」（**不是**下方 title state 那个已套用 t('bf_scribe_untitled') 兜底
  //   显示文案的展示值——服务端 null 时这里必须存 ''，与 route.ts `cur.title ?? ''` 的哈希输入逐位对齐，
  //   否则新建空标题文档首次保存就会误报 409）。用途同 base_sha256：doSave 每发算 base_title_sha256。
  const lastServerTitleRef = useRef<string>('');
  // 🔴 统一推进口径：任何一处"我们已确知服务端此刻真值"的时刻，
  //   content 与 title 两条基线必须同一次一起推进——此前四条推进路径（doSave 成功/409/rollback/
  //   Ctrl+Z 历史回放）各自手写、其中三条漏写了 title 那一半，导致 lastServerTitleRef 停留在陈旧值、
  //   下一发 base_title_sha256 打不中真库值——自伤式假 409（诊断书同族根因）。往后新增任何"推进基线"
  // 的调用点一律走这个函数，禁止再各写各的。
  //   title 传 undefined = 只推进 content（极少数只知道 content 真值、不确定 title 真值的调用点用）。
  const applyServerBaseline = useCallback((content: string, title?: string) => {
    lastServerContentRef.current = content;
    if (typeof title === 'string') lastServerTitleRef.current = title;
  }, []);

  // ── 自由摆放组件（aiscribe_docs.layers·迁移 406）──────────────────────────
  //   · 载入：doc GET 带出 ⇒ applyServerLayers；角色那侧改了（轮询／掀罩）且本页没改过组件 ⇒ 也换进来。
  //   · 存档：跟正文同一条防抖存档路（useDocSaveQueue·getExtra 在调用瞬间快照）——本页改过组件（layersDirtyRef）才带 layers（整份替换）；
  //     没改过不带（⛔ 拿本页旧那份盖掉角色刚摆好的）。组件改动＝真改（dirtyRef）⇒ Ctrl+Z 开新一轮前会先落库（版本快照 407 连 layers 记）。
  //   · 撤销：同一本回滚历史（版本行多记 layers·回滚连组件一起还原）·⛔ 另起第二本撤销账。
  const [layerItems, setLayerItemsState] = useState<DocLayerItem[]>([]);
  const layersRef = useRef<DocLayerItem[]>([]);
  const layersDirtyRef = useRef(false);
  const lastServerLayersKeyRef = useRef<string>('null');
  // 组件乐观锁：服务端那份 layers 的 jsonb 序 JSON（算 sha 用）＋那份组件（409 三方合并的基准）
  const lastServerLayersJsonRef = useRef<string>('null');
  const lastServerLayersItemsRef = useRef<DocLayerItem[]>([]);
  const [layersGen, setLayersGen] = useState(0);
  const [layerSel, setLayerSel] = useState<string[]>([]);
  const [layerEditingId, setLayerEditingId] = useState<string | null>(null);
  const [layerLiveId, setLayerLiveId] = useState<string | null>(null);
  // 「选底层组件」：垫在文字底下那层平时不接滑鼠（不挡打字）；开了才把那层抬到正文上面接滑鼠（Esc／再按一次收）
  const [belowMode, setBelowMode] = useState(false);
  const [flowMenu, setFlowMenu] = useState<{ x: number; y: number; pos: number } | null>(null);
  /** 本页改组件一律经这里：画面＋ref 同步、标脏、推进世代（触发 3 秒防抖存档） */
  const changeLayers = useCallback((next: DocLayerItem[]) => {
    layersRef.current = next;
    setLayerItemsState(next);
    layersDirtyRef.current = true;
    dirtyRef.current = true;
    setLayersGen(g => g + 1);
  }, []);
  /** 服务端那份换进来（载入／角色改了／回滚）：不标脏 */
  const applyServerLayers = useCallback((v: unknown) => {
    const items = sanitizeDocLayers(v)?.items ?? [];
    layersRef.current = items;
    setLayerItemsState(items);
    layersDirtyRef.current = false;
    lastServerLayersKeyRef.current = docLayersKey(v);
    lastServerLayersJsonRef.current = serverLayersJson(v);
    lastServerLayersItemsRef.current = items;
  }, []);
  /** 存组件撞 409（角色刚改过组件）：以服务端那份为新基准三方合并（角色新加的留着·本页的改动留着）·组件仍脏 ⇒ 3 秒后再存；⛔ 静默覆盖角色刚加的 */
  const onLayersConflict = useCallback((server: unknown) => {
    const serverItems = sanitizeDocLayers(server)?.items ?? [];
    const merged = mergeDocLayers(lastServerLayersItemsRef.current, layersRef.current, serverItems);
    lastServerLayersKeyRef.current = docLayersKey(server);
    lastServerLayersJsonRef.current = serverLayersJson(server);
    lastServerLayersItemsRef.current = serverItems;
    layersRef.current = merged;
    setLayerItemsState(merged);
    layersDirtyRef.current = true;
    dirtyRef.current = true;
    setLayersGen(g => g + 1);
  }, []);
  // 坐标几何：分页视图＝纸张毫米＋页缝·缩放 1；关闭（连续流）＝A4 直式·无页缝·跟字号缩放走（组件与文字一起缩）
  const layerGeom = useMemo(
    () => (paperPref ? pagedGeometry(pageSizeMm(paperPref)) : continuousGeometry(pageSizeMm(null), fontScale)),
    [paperPref, fontScale],
  );
  const hasLayers = layerItems.length > 0;
  // 只读 doc／上架态／AI 编辑保护罩：组件只显示、不能拖（同正文 setEditable 那三条）
  const layerEditable = !readonlyDoc && !isListingMode && !locked;
  const layerPages = paperPref ? sheetCount(pagedCount, layerItems) : Math.max(1, maxLayerPage(layerItems));
  /** 纸叠左上角那个元素（分页＝.doc-paged；连续流＝正文容器·两者左上角＝第 1 页纸张左上角） */
  const layerHostEl = useCallback((): HTMLElement | null => {
    if (!editor || editor.isDestroyed) return null;
    const dom = editor.view.dom as HTMLElement;
    return (dom.closest('.doc-paged') as HTMLElement | null) ?? (dom.closest('.aiscribe-editor') as HTMLElement | null);
  }, [editor]);
  /** 画面正中那一点落在哪一页、离纸张左上角几毫米 */
  const currentLayerSpot = useCallback((): { page: number; x: number; y: number } | null => {
    const sc = editorScrollRef.current, host = layerHostEl();
    if (!sc || !host) return null;
    const sr = sc.getBoundingClientRect(), hr = host.getBoundingClientRect();
    return locateOnPages(sr.left + sr.width / 2 - hr.left, sr.top + sr.height / 2 - hr.top, layerGeom);
  }, [layerHostEl, layerGeom]);
  const insertTextBox = useCallback(() => {
    const spot = currentLayerSpot();
    const paper = pageSizeMm(paperPref);
    const it = placeLayerCentered(newTextBoxLayer(spot?.page ?? 1, paper, t('doc_layer_textbox_default')), spot, paper);
    changeLayers([...layersRef.current, it]);
    setLayerSel([it.id]);
  }, [currentLayerSpot, paperPref, t, changeLayers]);
  /** 正文里的媒体节点 ⇒ 自由组件：从正文删掉、在它原来所在页与位置新建同内容组件 */
  const convertFlowToFree = useCallback((pos: number) => {
    if (!editor || editor.isDestroyed) return;
    const node = editor.state.doc.nodeAt(pos);
    if (!node || !(FLOW_MEDIA_TYPES as readonly string[]).includes(node.type.name)) return;
    const dom = editor.view.nodeDOM(pos) as HTMLElement | null;
    const host = layerHostEl();
    if (!dom || !host) return;
    const inner = (dom.querySelector?.('img,video,[data-video-view],[data-audio-view],[data-testid="doc-file-card"]') as HTMLElement | null) ?? dom;
    const ir = inner.getBoundingClientRect(), hr = host.getBoundingClientRect();
    const at = flowRectToLayerAt({ left: ir.left - hr.left, top: ir.top - hr.top, width: ir.width, height: ir.height }, layerGeom);
    const item = layerFromFlowNode({ type: node.type.name as FlowMediaNode['type'], attrs: node.attrs as Record<string, unknown> }, at);
    if (!item) { void alertDialog(t('doc_layer_to_free_failed')); return; }
    editor.chain().deleteRange({ from: pos, to: pos + node.nodeSize }).run();
    dirtyRef.current = true;
    changeLayers([...layersRef.current, item]);
    setLayerSel([item.id]);
  }, [editor, layerHostEl, layerGeom, t, changeLayers]);
  /** 自由组件 ⇒ 插回正文（「改回跟着文字走」）：落在组件所在位置那一段之后（找不到就落在光标处）；文字方块＝段落 */
  const convertLayerToFlow = useCallback((id: string) => {
    if (!editor || editor.isDestroyed) return;
    const it = layersRef.current.find(x => x.id === id);
    if (!it) return;
    const f = flowFromLayer(it);
    let at: number | null = null;
    const host = layerHostEl();
    if (host) {
      const hr = host.getBoundingClientRect();
      const dr = (editor.view.dom as HTMLElement).getBoundingClientRect();
      const left = Math.min(dr.right - 4, Math.max(dr.left + 4, hr.left + pageLeftPx(layerGeom) + mmToPx(it.x + it.w / 2, layerGeom.zoom)));
      const top = hr.top + pageTopPx(it.page, layerGeom) + mmToPx(it.y, layerGeom.zoom);
      const hit = editor.view.posAtCoords({ left, top });
      if (hit) at = hit.pos;
    }
    if (at == null) at = editor.state.selection.to;
    const $p = editor.state.doc.resolve(Math.min(at, editor.state.doc.content.size));
    const insertAt = $p.depth >= 1 ? $p.after(1) : $p.pos;
    const content = 'node' in f ? f.node : (f.md ? mdToTiptapHtml(f.md) : null);
    if (content) editor.chain().insertContentAt(insertAt, content).run();
    dirtyRef.current = true;
    changeLayers(removeLayers(layersRef.current, [id]));
    setLayerSel([]);
  }, [editor, layerHostEl, layerGeom, changeLayers]);
  // 正文里：① 右键图片／视频／音频／档案卡 ⇒ 我们的小选单「改成自由摆放」（其余地方照旧浏览器选单）；
  //   ② 点正文 ⇒ 收起组件选取／退出组件原地编辑；按住 Alt 点 ⇒ 点到的若是「垫在文字底下」的组件就选它（进「选底层组件」）。
  const layersPointerRef = useRef({ layerItems, layerGeom, layerSel, layerHostEl });
  layersPointerRef.current = { layerItems, layerGeom, layerSel, layerHostEl };
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom as HTMLElement;
    const mediaAt = (e: MouseEvent): number | null => {
      const types = FLOW_MEDIA_TYPES as readonly string[];
      const hit = editor.view.posAtCoords({ left: e.clientX, top: e.clientY });
      if (hit && hit.inside >= 0) { const n = editor.state.doc.nodeAt(hit.inside); if (n && types.includes(n.type.name)) return hit.inside; }
      const w = (e.target as Element | null)?.closest?.('[data-node-view-wrapper],[data-file-card]');
      if (w) {
        try {
          const p = editor.view.posAtDOM(w, 0);
          for (const q of [p, p - 1]) { if (q < 0) continue; const n = editor.state.doc.nodeAt(q); if (n && types.includes(n.type.name)) return q; }
        } catch { /* 不在文档里 */ }
      }
      return null;
    };
    const onCtx = (e: MouseEvent) => {
      if (!editor.view.editable) return;
      const pos = mediaAt(e);
      if (pos == null) return;
      e.preventDefault();
      setFlowMenu({ x: e.clientX, y: e.clientY, pos });
    };
    const onDown = (e: PointerEvent) => {
      const st = layersPointerRef.current;
      if (e.altKey && editor.view.editable) {
        const host = st.layerHostEl();
        if (host) {
          const hr = host.getBoundingClientRect();
          const loc = locateOnPages(e.clientX - hr.left, e.clientY - hr.top, st.layerGeom);
          const it = topLayerAt(st.layerItems, loc.page, loc.x, loc.y, 'below');
          if (it) { e.preventDefault(); e.stopPropagation(); setBelowMode(true); setLayerSel([it.id]); return; }
        }
      }
      if (st.layerSel.length) setLayerSel([]);
      setLayerEditingId(null);
      setLayerLiveId(null);
    };
    dom.addEventListener('contextmenu', onCtx);
    dom.addEventListener('pointerdown', onDown, true);
    return () => { dom.removeEventListener('contextmenu', onCtx); dom.removeEventListener('pointerdown', onDown, true); };
  }, [editor]);
  // 正文媒体小选单：点外面／滚动／Esc 收
  useEffect(() => {
    if (!flowMenu) return;
    const close = () => setFlowMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('pointerdown', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('scroll', close, true); window.removeEventListener('keydown', onKey); };
  }, [flowMenu]);
  // 「选底层组件」：Esc 回到打字；底层没组件了自动收
  useEffect(() => {
    if (!belowMode) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key !== 'Escape' || (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable))) return;
      setBelowMode(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [belowMode]);
  useEffect(() => { if (belowMode && !layerItems.some(it => it.plane === 'below')) setBelowMode(false); }, [belowMode, layerItems]);
  const [contentDim, setContentDim] = useState(false);  // 罩期内容平滑替换（opacity 过渡·避免整页白闪）
  const [stashNotice, setStashNotice] = useState<null | 'stashed' | 'restore'>(null);
  const olderStashRef = useRef<string[]>([]);
  const [olderStashCount, setOlderStashCount] = useState(0);
  const keepOlderStash = () => {
    if (stashRef.current == null && stashTitleRef.current == null) return;
    const text = [stashTitleRef.current != null ? stashTitleRef.current : '', stashRef.current ?? ''].filter(Boolean).join('\n');
    if (!text) return;
    olderStashRef.current = [...olderStashRef.current, text];
    setOlderStashCount(olderStashRef.current.length);
  };
  // 🔴 还原条/toast 要覆盖 title 那一半——ref 改动不触发渲染，故另立一个 state
  //   镜像「这次暂存里含不含 title」，让还原条能明说「标题也一并暂存了」（否则用户点还原前无从
  //   得知标题会被一起还原，等于护栏做了但用户看不见）。与 stashTitleRef 严格同生同灭。
  const [stashHasTitle, setStashHasTitle] = useState(false);
  const stashToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 🔴 保存冲突态：doSave 发 PUT 时附「我基于哪一版服务端内容」
  //   （base_sha256 = lastServerContentRef 的哈希）；服务端发现库里的 content 已不是那一版 → 409
  //   （不写库·188 触发器不响·不产生盖回垃圾版本行）→ 这里存下服务端最新版，弹冲突条让用户选边。
  //   冲突未决期间 saveDoc 一律早退（同罩期 :3925 语义）——否则每 3 秒 debounce 一发 409 空转。
  // origin:'live'＝不是 409 撞出来的·是轮询／Realtime 看到别人（角色）改了这份而本页有未保存改动 ⇒ 同一条选边条·
  //   措辞改「〈角色〉改了這份」·两个钮同一套出路（套用＝载入新版并暂存我的；保留我的＝推进基线后覆盖）。by＝角标同款显示名（空＝不知道谁）。
  const [saveConflict, setSaveConflict] = useState<null | { serverContent: string; serverTitle: string | null; origin?: 'save' | 'live'; by?: string }>(null);
  const saveConflictRef = useRef(false);
  useEffect(() => { saveConflictRef.current = saveConflict !== null; }, [saveConflict]);
  // 切文档：冲突态属于上一个 doc·别跟着带到新文档（否则新文档的保存被上一档的闸挡死）。
  useEffect(() => { saveConflictRef.current = false; setSaveConflict(null); }, [docId]);

  // 编辑器可编辑性单一真相源：只读 doc / 上架态 / 罩态 任一 → 关编辑（tiptap 只读·连光标都不给）。
  useEffect(() => {
    if (editor) editor.setEditable(!readonlyDoc && !isListingMode && !locked);
  }, [editor, readonlyDoc, isListingMode, locked]);

  // ── Load doc ──────────────────────────────────────────────────
  // 只在换了文档（docId）时读：宿主经 ref 叫现在那份——宿主换一份（外框重绘、换存放位置）不算换文档，
  //   重读会把编辑器内容换回读到的那版、清掉未存标记，盖掉读回来之前刚打的字。外面改了档要重读由外框重挂整页。
  const loadHostRef = useRef(host);
  loadHostRef.current = host;
  useEffect(() => {
    const host = loadHostRef.current;
    // 读不到 ⇒ 按回应码明说（⛔ 跳回入口页：那页会默默新建一份空白文件）
    setLoadFail(null);
    host.getUser().then(async (user) => {
      if (!user) { host.loginRedirect(docId); return; }
      setCurrentUserEmail(user.email ?? null);
      try {
        const res = await host.getDoc(docId);
        if (!res.ok) { setLoadFail(host.loadFailOf(res.status)); return; }
        const d = await res.json();
        setTitle(d.title ?? t('bf_scribe_untitled'));
        setEditorAgentKey(typeof d.editor_agent_key === 'string' && d.editor_agent_key ? d.editor_agent_key : null);
        editorAgentKeyRef.current = typeof d.editor_agent_key === 'string' && d.editor_agent_key ? d.editor_agent_key : null;
        // 载入那份就是「已看过」的版本：游标立在它的 updated_at 上（没戳＝库没回·下一拍再立）
        lastSeenUpdatedAtRef.current = typeof d.updated_at === 'string' ? d.updated_at : null;
        ownWriteStampsRef.current = new Set();
        lastServerTitleRef.current = d.title ?? '';  // [S9 title-only 修] 服务端原值基线（非展示兜底文案）
        setInitialMd(d.content ?? "");
        setDocFolderId(typeof d.folder_id === 'string' && d.folder_id ? d.folder_id : null);  // 档案卡片：上传新档落这篇所在的资料夹
        // [分享到个人主页 桩①] 载入挂载三字段·作分享弹窗初值（空/NULL→空串·前端 fallback）
        setProfileInitial({
          published: !!d.profile_published,
          coverUrl: d.profile_cover_url ?? "",
          title: d.profile_title ?? "",
        });
        if (d.readonly) { setReadonlyDoc(true); setReadonlyContent(d.content ?? ""); }  // [系统夹重构·只读页] 存稳定内容源给 DocReadOnlyPage
        if (d.systemProtected) setShareDisabled(true);  // [文档分享·安全#2] 系统保护的内部文档禁分享
        if (typeof d.view_count === 'number') setViewCount(d.view_count);  // 唯一访问人数（owner 视角显示）
        // 纸型初值改随本次 doc GET 一并带出（docs/route.ts GET
        //   select 列已加 paper_pref）——非法/缺省值→null（=未设置·下游按 A4 直式默认渲染·回归零变化）。
        //   必须先落 lastSavedPaperRef 再 setPaperPref：顺序反了会让上方写回 effect 把 load 出的初值误当"用户新选"回写一次。
        // 读口：paper_settings 优先·空则 paper_pref＋默认边距/页码合成（resolvePaperSettings）。
        { const ps = resolvePaperSettings(d.paper_settings, d.paper_pref); lastSavedPaperRef.current = paperSettingsKey(ps); paperSettingsRef.current = ps; setPaperSettings(ps); }
        applyServerLayers(d.layers);   // 自由摆放组件（406 没套＝没这个键＝空）
      } catch { setLoadFail(host.loadFailOf(null)); }
      finally { setLoadingDoc(false); }
    });
  }, [docId]);
  useEffect(() => { editorAgentKeyRef.current = editorAgentKey; }, [editorAgentKey]);  // 角标名解析要读现值（右栏切角色后立刻跟）
  const changeEditorAgent = useCallback(async (key: string | null): Promise<boolean> => {
    try {
      if (!host.postEditorAgent) return false;
      const res = await host.postEditorAgent({ kind: 'doc', id: docId, editor_agent_key: key });
      if (!res.ok) return false;
      const j = (await res.json().catch(() => null)) as { editor_agent_key?: unknown } | null;
      setEditorAgentKey(typeof j?.editor_agent_key === 'string' && j.editor_agent_key ? j.editor_agent_key : null);
      return true;
    } catch { return false; }
  }, [docId, host]);


  // ── Set editor content once both editor & initial content ready
  useEffect(() => {
    if (!editor || initialMd === null) return;
    const html = mdToTiptapHtml(initialMd);
    isProgrammatic.current = true;
    editor.commands.setContent(html || '<p></p>');
    isProgrammatic.current = false;
    setMdContent(initialMd);
    lastServerContentRef.current = initialMd;  // [玻璃罩块B] 记已知服务端内容基线（罩期平滑重渲比对用）
    dirtyRef.current = false;
    setInitialMd(null);
  }, [editor, initialMd]);

  const applyServerContentSmooth = useCallback((md: string) => {
    if (!editor) return;
    setContentDim(true);              // 先淡出→setContent→双 rAF 后淡回·避免整页白一下
    isProgrammatic.current = true;
    editor.commands.setContent(mdToTiptapHtml(md) || '<p></p>');
    isProgrammatic.current = false;
    lastServerContentRef.current = md;
    requestAnimationFrame(() => requestAnimationFrame(() => setContentDim(false)));
  }, [editor]);

  const applyEditingMark = useCallback((d: { editing_by?: unknown; editing_expires_at?: unknown; editing_turn_id?: unknown; updated_at?: unknown; editor_agent_key?: unknown; server_now?: unknown }) => {
    aiShieldIngest({ ...d, editor_agent_key: typeof d.editor_agent_key === 'string' ? d.editor_agent_key : editorAgentKeyRef.current });
  }, [aiShieldIngest]);


  // 罩态轮询：罩着=3~5s 拉内容+标记（内容变则平滑重渲）；未罩=低频 6s 只查标记。document.hidden 暂停。
  // 三处改：① Realtime 一响（pollKickRef）当场拉一拍；② 实时不在线时间隔压到 3 秒（docLivePollDelay）；
  //   ③ 未罩时也消费别人的更新（decideDocLiveUpdate：自己写的不算·没未保存改动就换·有就走选边条·⛔ 不静默盖）。
  useEffect(() => {
    const live = host.docLive;
    if (loadingDoc || readonlyDoc || !editor || !live || !host.has('docLive')) return;  // 只读系统 doc 走 DocReadOnlyPage·不轮询
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let inFlight = false;
    let rerun = false;   // 在飞期间又被叫（Realtime 响了）⇒ 这拍完立刻再拉一拍
    const poll = async () => {
      if (cancelled) return;
      if (typeof document !== 'undefined' && document.hidden) { schedule(); return; }
      if (inFlight) { rerun = true; return; }
      inFlight = true;
      rerun = false;
      const histGen = historyGenRef.current;
      try {
        const res = await host.getDoc(docId);
        const histSettled = !historyBusyRef.current && historyGenRef.current === histGen;
        if (res.ok && !cancelled && !histSettled) {
          applyEditingMark(await res.json());
        } else if (res.ok && !cancelled) {
          const d = await res.json();
          applyEditingMark(d);
          // 「罩着」时消费内容更新（罩期路照旧：平滑重渲）。
          if (lockedRef.current && typeof d.content === 'string' && d.content !== lastServerContentRef.current) {
            applyServerContentSmooth(d.content);
          }
          // 未罩也消费：按 updated_at 判这一版是不是别人改的。
          //   本页正文 PUT 在飞 ⇒ 这一拍不判（自己那版可能已落库而戳还没回读）·游标也不动·下一拍再判。
          if (docPutInFlightRef.current === 0) {
            const verdict = live.decideDocLiveUpdate({
              server: d,
              lastSeenUpdatedAt: lastSeenUpdatedAtRef.current,
              ownWriteStamps: ownWriteStampsRef.current,
              localContent: mdContentRef.current,
              baselineContent: lastServerContentRef.current,
              dirty: dirtyRef.current,
              locked: lockedRef.current,
            });
            if (typeof d.updated_at === 'string') lastSeenUpdatedAtRef.current = d.updated_at;
            if (verdict.action === 'apply') {
              // 没未保存改动 ⇒ 换进编辑器（同掀罩重拉那条路的收尾：正文／镜像／基线／非脏一起推）
              applyServerContentSmooth(verdict.content);
              setMdContent(verdict.content);
              mdContentRef.current = verdict.content;
              dirtyRef.current = false;
              if (verdict.title !== null && verdict.title !== titleRef.current) { setTitle(verdict.title); titleRef.current = verdict.title; }
              applyServerBaseline(verdict.content, verdict.title ?? undefined);
            } else if (verdict.action === 'prompt') {
              // 有未保存改动 ⇒ 不盖·走既有选边条（套用＝载入新版并暂存我的；保留我的＝推进基线后覆盖）·条在时 autosave 挂闸（同 409 语义）
              const who = live.editingDisplayName({ editingBy: d.editing_by, editorAgentKey: editorAgentKeyRef.current, dilinName: t('agent_dilin_name') })
                || live.boundRoleName(editorAgentKeyRef.current, t('agent_dilin_name'));
              setSaveConflict({ serverContent: verdict.content, serverTitle: verdict.title, origin: 'live', by: who });
              saveConflictRef.current = true;
            }
            // 组件被别处（角色工具）改了：本页没改过组件 ⇒ 换进来；改过 ⇒ 不盖（本页下一发存档整份替换·后写为准）
            if (d && typeof d === 'object' && 'layers' in d && !layersDirtyRef.current && docLayersKey(d.layers) !== lastServerLayersKeyRef.current) {
              applyServerLayers(d.layers);
            }
          }
        }
      } catch { /* 网络抖动→下一拍重试 */ }
      inFlight = false;
      if (rerun) { rerun = false; if (timer) clearTimeout(timer); timer = setTimeout(poll, 50); return; }
      schedule();
    };
    const schedule = () => {
      if (cancelled) return;
      if (timer) clearTimeout(timer);
      // 未罩 poll 12s→6s：初罩延迟≤7s（罩期 4s 不动）； 实时不在线 ⇒ 压到 3 秒
      timer = setTimeout(poll, live.docLivePollDelay(docLiveRef.current, lockedRef.current ? 4000 : 6000));
    };
    // 进入本 effect（含罩态切换）即拉一拍：罩落后尽快抓到机器人新内容。
    timer = setTimeout(poll, locked ? 300 : 800);
    const onVis = () => { if (!document.hidden) { if (timer) clearTimeout(timer); timer = setTimeout(poll, 200); } };
    document.addEventListener('visibilitychange', onVis);
    // Realtime 一响 ⇒ 当场拉一拍（在飞就记 rerun·这拍完接着拉）
    pollKickRef.current = () => { if (cancelled) return; if (inFlight) { rerun = true; return; } if (timer) clearTimeout(timer); timer = setTimeout(poll, 50); };
    return () => { cancelled = true; pollKickRef.current = () => {}; if (timer) clearTimeout(timer); document.removeEventListener('visibilitychange', onVis); };
  }, [docId, editor, loadingDoc, readonlyDoc, locked, applyEditingMark, applyServerContentSmooth, applyServerBaseline, applyServerLayers, t, host]);

  // 订这份档的 Realtime UPDATE（RLS 只本人·迁移 288 加进 publication）：响了就叫上面那条轮询当场拉一拍；
  //   订上了 ⇒ docLive=true（轮询退成 4s/6s 兜底）；陆版／288 没套／断线 ⇒ false（3 秒轮询）。换档撤旧频道。
  useEffect(() => {
    if (loadingDoc || readonlyDoc || !docId || !host.docLive || !host.has('docLive')) return;
    const watcher = host.docLive.createWatcher();
    const stop = watcher.start(docId, { onChange: () => { pollKickRef.current(); aiShieldKickRef.current(); }, onLive: setDocLive });
    return () => { stop(); setDocLive(false); };
  }, [docId, loadingDoc, readonlyDoc, host]);

  // 罩态跃迁副作用：进罩=暂存在途未存改动；掀罩=拉一次最新内容+恢复编辑+提示还原。
  const prevLockedRef = useRef(false);
  useEffect(() => {
    if (locked && !prevLockedRef.current) {
      // 进罩：罩落瞬间若有未保存改动→本地暂存 + 不打断提示。基线设为当前内容（罩期比对增量）。
      // 🔴 上一版曾在这里连 title 一并 applyServerBaseline
      //   (mdContentRef.current, titleRef.current)——但 titleRef.current 是"本地展示/可能未保存的
      //   脏值"，与本档 :2391-2394 自己立的口径「lastServerTitleRef 只能存已知服务端真值」正面打架；
      //   且 saveDoc 在 lockedRef.current 为真时本就整段早退（见下方罩期早退分支），"罩期用旧 base
      //   打 PUT"这件事本身根本不会发生，注释宣称的收益不存在。退回只推 content（沿用进罩前既有写
      //   法），title 半删掉——title 基线仍旧只在"确知服务端真值"的四条路径（doSave 成功/409/
      //   rollback/Ctrl+Z/掀罩/冲突条二选一）上推进。
      lastServerContentRef.current = mdContentRef.current;
      if (dirtyRef.current) {
        keepOlderStash();   // 上一份没还原也没捨棄的暂存 ⇒ 挪去「更早的暂存」（⛔ 被这份顶掉）
        stashRef.current = mdContentRef.current;
        // 🔴 进罩暂存只暂存正文（罩期标题输入不被服务端盖·无 title 那一半
        //   要救）；但这一行是**整体覆盖** stashRef，若不同时清掉 title 半边，上一次冲突条留下的
        //   旧标题暂存会挂在这份新暂存上、被用户点还原时套用到无关的现场。两半严格同生同灭。
        stashTitleRef.current = null;
        setStashHasTitle(false);
        setStashNotice('stashed');
        if (stashToastTimer.current) clearTimeout(stashToastTimer.current);
        stashToastTimer.current = setTimeout(() => {
          setStashNotice(prev => prev === 'stashed' ? null : prev);  // 4s 后自动收「已暂存」toast·不误清还原条
        }, 4500);
      }
    } else if (!locked && prevLockedRef.current) {
      // 掀罩：最新内容已由 onShieldReleaseRef（钩子终态先拉后掀）换进编辑器；这里只管「还原」条。
      setStashNotice(stashRef.current != null || stashTitleRef.current != null ? 'restore' : null);
    }
    prevLockedRef.current = locked;
  }, [locked, docId, editor, applyEditingMark]);

  onShieldReleaseRef.current = async () => {
    try {
      const res = await host.getDoc(docId);
      if (!res.ok) return;
      const d = await res.json();
      applyEditingMark(d);  // 可能后端已换新标记（连续托管）·顺手同步
      if (typeof d.content === 'string') {
        isProgrammatic.current = true;
        editor?.commands.setContent(mdToTiptapHtml(d.content) || '<p></p>');
        isProgrammatic.current = false;
        setMdContent(d.content);
        lastServerContentRef.current = d.content;
        dirtyRef.current = false;
      }
      // 🔴 掀罩推进路径：这里已经现拉了服务端最新 title（d.title）——同款推进
      //   lastServerTitleRef（此前只 setTitle 更新 UI 显示、漏了基线本身，罩期外部改过标题
      //   后掀罩仍会用旧 base 打下一发 autosave）。
      if (typeof d.title === 'string') { setTitle(d.title); lastServerTitleRef.current = d.title; }
      if (d && typeof d === 'object' && 'layers' in d) applyServerLayers(d.layers);   // 罩期角色摆的组件一起拉回
    } catch { /* 掀罩拉取失败→保留当前显示·不阻断恢复编辑 */ }
  };

  // 还原暂存：把罩落前的未保存 md 写回编辑器（用户手动触发·别自动合并）。
  // 🔴 还原两半：正文（stashRef）与标题（stashTitleRef）各自独立判空还原——
  //     玻璃罩进罩那条路径只暂存正文（stashTitleRef 为 null·不动标题输入框），冲突条「载入新版」
  //     那条路径可能两半都有。任一半有暂存就允许还原（不能再用「正文为空就整段早退」当门槛，
  //     否则只有标题被盖掉的那种碰撞点了还原按钮会静默什么都不做）。
  // 🔴 旧码：正文还原被 `&& editor` 守住、下面清空四行却**无条件**
  //     照跑 ⇒ 暂存有正文、而 tiptap 实例尚未建好（useEditor 在实例建成前返回 null）时点还原＝正文没写回、
  //     暂存被清掉、还原条消失，在途正文再也拿不回来。触发面没被守卫挡住：还原条渲染条件只判
  //     stashNotice === 'restore'，按钮点得到（对照同区 'stashed' 那条是有 editingMark 守卫的）。
  //     修法＝把「编辑器未就绪」加进早退（不是把清空块挪进 if 里做半还原）：两半严格同生同灭，宁可这一次
  //     什么都不做、把暂存与还原条原样留着让用户就绪后再点，也不许出现「清了但没还原」的不可逆状态。
  const restoreStash = useCallback(() => {
    if (stashRef.current == null && stashTitleRef.current == null) return;
    // 🔴 编辑器实例未就绪时整段不动（保住暂存与还原条·等就绪再点一次）。
    if (stashRef.current != null && !editor) return;
    if (stashRef.current != null && editor) {
      isProgrammatic.current = true;
      editor.commands.setContent(mdToTiptapHtml(stashRef.current) || '<p></p>');
      isProgrammatic.current = false;
      setMdContent(stashRef.current);
    }
    if (stashTitleRef.current != null) {
      setTitle(stashTitleRef.current);
      titleRef.current = stashTitleRef.current;
      hasManualTitle.current = true;  // 用户手敲的标题被还原回来·维持"手动改过标题"语义（别被自动命名再盖一次）
    }
    dirtyRef.current = true;
    stashRef.current = null;
    stashTitleRef.current = null;
    setStashHasTitle(false);
    setStashNotice(null);
  }, [editor]);
  useEffect(() => () => { if (stashToastTimer.current) clearTimeout(stashToastTimer.current); }, []);

  // ── Outline ───────────────────────────────────────────────────
  const outline = useMemo(() => {
    return mdContent.split('\n')
      .map((line, idx) => {
        const m = line.match(/^(#{1,4})\s+(.+)/);
        if (!m) return null;
        return { level: m[1].length, text: outlineText(m[2]), line: idx };
      })
      .filter(Boolean) as { level: number; text: string; line: number }[];
  }, [mdContent]);

  const addEntry    = () => setEntries(e => [...e, { real: "", code: `${t('bf_scribe_code_prefix')}${e.length + 1}` }]);
  const updateEntry = (i: number, f: "real" | "code", v: string) =>
    setEntries(e => e.map((x, j) => j === i ? { ...x, [f]: v } : x));
  const removeEntry = (i: number) => setEntries(e => e.filter((_, j) => j !== i));

  const scrollToHeading = (text: string) => {
    if (!editor) return;
    const el = editor.options.element;
    const headings = el.querySelectorAll('h1,h2,h3,h4');
    for (const h of headings) {
      if (h.textContent?.trim() === text) {
        h.scrollIntoView({ behavior: 'smooth', block: 'center' });
        break;
      }
    }
    // 直板机+目录全屏覆盖态下跳转·弹 2 秒 toast 提示用户收起目录看正文(目录盖着正文看不到)
    if (isNarrow && leftMobileOpen) {
      setNavToast(true);
      if (navToastTimerRef.current) clearTimeout(navToastTimerRef.current);
      navToastTimerRef.current = setTimeout(() => setNavToast(false), 2000);
    }
  };

  const insertMedia = useCallback(async (files: FileList | File[]) => {
    if (!editor) return;
    for (const file of Array.from(files)) {
      if (host.exceedsUploadLimit(file.size)) { await alertDialog(`${file.name}：${t('upload_single_too_large')}`); continue; }
      const isVideo = file.type.startsWith('video/');
      const isAudio = file.type.startsWith('audio/');
      // 音频无画面·ratio 不参与 audioBlock 契约（audio-node.ts 只四字段 src/displayMode/name/size）·
      // 跳过下方图/视频专用的元数据探测（省一次不必要的 <video>/<img> 解码往返）。
      if (isAudio) {
        const uploadId = safeRandomUUID();
        uploadFileRegistry.set(uploadId, file);
        editor.chain().focus().insertContent({ type: 'uploadPlaceholder', attrs: { uploadId, ratio: 1, mimeType: file.type } }).run();
        continue;
      }
      let ratio = isVideo ? 16 / 9 : 1;
      try {
        ratio = await new Promise<number>((resolve) => {
          const objUrl = URL.createObjectURL(file);
          const cleanup = (r: number) => { URL.revokeObjectURL(objUrl); resolve(r); };
          if (isVideo) {
            const v = document.createElement('video');
            const timer = setTimeout(() => cleanup(16 / 9), 3000);
            v.preload = 'metadata';
            v.onloadedmetadata = () => { clearTimeout(timer); cleanup(v.videoWidth && v.videoHeight ? v.videoWidth / v.videoHeight : 16 / 9); };
            v.onerror = () => { clearTimeout(timer); cleanup(16 / 9); };
            v.src = objUrl;
          } else {
            const img = new window.Image();
            img.onload = () => cleanup(img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1);
            img.onerror = () => cleanup(1);
            img.src = objUrl;
          }
        });
      } catch { /* use default */ }

      const uploadId = safeRandomUUID();
      uploadFileRegistry.set(uploadId, file);
      editor.chain().focus().insertContent({ type: 'uploadPlaceholder', attrs: { uploadId, ratio, mimeType: file.type } }).run();
    }
  }, [editor, t, host]);
  // [桩A] ref 始终指向最新 insertMedia（供 editorProps.handlePaste/handleDrop 调·避免锁死首渲染 editor=null 版）
  insertMediaRef.current = insertMedia;

  // ── 档案卡片：上传新档（每份一张占位卡·传完换成真卡）＋从云盘挑现有档 ──
  const docFileCardInputRef = useRef<HTMLInputElement>(null);
  const [fileCardPickerOpen, setFileCardPickerOpen] = useState(false);
  const insertFileCards = useCallback((files: FileList | File[]) => {
    const registry = host.fileCardUploadRegistry;
    if (!editor || !registry) return;
    const nodes = Array.from(files).map((file) => {
      const uploadId = safeRandomUUID();
      registry.set(uploadId, file);
      return { type: 'fileCard', attrs: { uploadId, name: file.name } };
    });
    if (nodes.length) editor.chain().focus().insertContent(nodes).run();
  }, [editor, host]);
  insertFileCardsRef.current = insertFileCards;
  // 卡片 NodeView 从 editor.storage.fileCard 读这篇的 id（问现况／下载）与资料夹（上传落点）
  useEffect(() => {
    if (!editor) return;
    const st = (editor.storage as unknown as Record<string, { docId: string; folderId: string | null } | undefined>).fileCard;
    if (st) { st.docId = docId; st.folderId = docFolderId; }
  }, [editor, docId, docFolderId]);
  const attachDriveFileCards = useCallback((atts: DocsAttachment[]) => {
    setFileCardPickerOpen(false);
    if (!editor) return;
    const nodes = atts
      .map(a => ({ fileId: normalizeFileCardId(a.fileId), a }))
      .filter((x): x is { fileId: string; a: DocsAttachment } => !!x.fileId)
      .map(({ fileId, a }) => ({ type: 'fileCard', attrs: { fileId, name: a.name || '', mime: a.mime || '', size: null, createdAt: '' } }));
    if (nodes.length) editor.chain().focus().insertContent(nodes).run();
  }, [editor]);

  // ── 匯出 ─────────────────────────────────────────────────────
  const exportPdf = useCallback(async () => {
    if (pdfLoading || !editor || !host.downloadEditorPdf) return;
    // 「PDF」＝一律服务端出档直接下载（纸张开关都一样·纸型随 body 带上）——服务端 PDF 与纸张视图同一套排版规则（lib/doc-pdf-download.ts）。
    //   浏览器列印是另一个「列印」选项（printDoc·只在纸张打开时显示）。
    setPdfLoading(true);
    try {
      const html = await getCleanPdfHtml(editor, t('bf_scribe_video_preview'));
      // 画面上的自由组件一起交给 PDF（服务端过净化闸·照毫米坐标落第 N 页）；没有组件 ⇒ 请求体与原本相同
      const pdfLayers = toDocLayers(layersRef.current);
      const ok = await host.downloadEditorPdf({ title, html, paper: paperPref, fileName: `${title || t('bf_scribe_untitled')}.pdf`, ...(pdfLayers ? { layers: pdfLayers } : {}) });
      if (!ok) { await alertDialog(t('bf_scribe_pdf_export_failed')); return; }
    } catch {
      await alertDialog(t('bf_scribe_pdf_export_failed'))
    } finally {
      setPdfLoading(false);
    }
  }, [editor, title, pdfLoading, t, paperPref]);
  // 「列印」（只在纸张打开时显示）：浏览器列印这份纸张画面（可另存 PDF）
  const printDoc = useCallback(() => { if (paperPref) printPagedDocument(title || t('bf_scribe_untitled'), host.printPage); }, [paperPref, title, t, host]);

  // [文檔分享·塊1] 下載改走共享 util（doc-export.ts·唯讀分享頁複用同一套）。
  //   內容 = tiptapHtmlToMd(editor.getHTML())（同入庫 mdContent 那條轉換鏈）→ util 內部 md→html→md 往返對 MD 無損。
  // ── 匯入 Word：选一份 .docx ⇒ 服务端转成新云文档（放本文档同一个资料夹）⇒ 转过去 ──
  const importWordInputRef = useRef<HTMLInputElement>(null);
  const [importWordBusy, setImportWordBusy] = useState(false);
  const importWordFile = useCallback(async (f: File | undefined) => {
    if (!f || !host.importWord) return;
    setImportWordBusy(true);
    try {
      const r = await host.importWord(f, { nearDocId: docId, lang: language, source: 'doc_page' });
      if (!r.ok) { await alertDialog(`${t('scribe_import_word_fail')}${r.message}`); return; }
      host.openDoc(r.id);
    } finally {
      setImportWordBusy(false);
      if (importWordInputRef.current) importWordInputRef.current.value = '';
    }
  }, [docId, language, host, t]);

  const exportMarkdown = useCallback(() => {
    if (!editor) return;
    host.exportDocAsMarkdown({ content: tiptapHtmlToMd(editorHtmlWithLiveColWidths(editor)), title });
  }, [editor, title, host, tiptapHtmlToMd]);

  // ── 自動儲存 ──────────────────────────────────────────────────
  // 真正发一次 PUT（doSave）——串行化/尾值合并/队列交给下方 useDocSaveQueue 共用
  // hook（与画布小视窗 DocEditor.tsx 同一份实现），这里只保留本页特有的业务逻辑（chat_history 兜底、
  // A 对话消息持久化、标题回填、lastServerContentRef 基线、BroadcastChannel 广播）。
  // 🔴 D2：目标 docId 走**参数** sendDocId，不再读本组件的 docId 闭包——队列里的快照可能是切文档之前
  //   排下的（属于旧文档），必须发去它自己的目标、发它自己的值。
  const runDocSave = useDocSaveQueue({
    getDocId: () => docId,
    getTitle: () => titleRef.current,
    getContent: () => mdContentRef.current,
    // D8：组件随存档意图在调用瞬间快照——本页改过组件才带（layersPutBody 认 'layers' 键）
    getExtra: () => (layersDirtyRef.current ? { layers: toDocLayers(layersRef.current) } : {}),
    doSave: async (sendDocId, sendTitle, sendContent, silent, extra) => {
      if (!silent) setSaveStatus("saving");
      docPutInFlightRef.current += 1;   // 在飞期间轮询那拍不判「别人改了」（finally 归零）
      try {
        // 🔴 基线证明：本发是基于「我此刻已知的那一版服务端正文」
        //   （lastServerContentRef）写的。服务端比对不上（= 我读到它之后有别人写过库）→ 409·不落库。
        //   ⚠️ 这里是**发送瞬间**读 ref，不是 D1/D8 那样的入队瞬间快照——两者的区别是本修的关键：
        //     串行队列里「A 在飞、B 排队」时，A 成功会把基线推到 A 的内容；B 若拿入队那一刻的旧基线
        //     去发，就会被自己刚写的那一发判成冲突（连续打字全线 409·真回归）。基线的语义本就是
        //     「我所知道的服务端最新状态」，含我自己刚落库的那一发，所以必须发送时现读。
        //   跨文档尾发（sendDocId ≠ 当前 docId）不带 base：那时 lastServerContentRef 已经是**新文档**的
        //   基线（:3904 同款守卫），拿它当旧文档的前提是错的——宁可这一发退回无条件写，也不误判冲突。
        const baseSha = sendDocId === docId ? await sha256Hex(lastServerContentRef.current) : null;
        // 🔴 title 走同一套基线证明契约（route.ts
        //   :725-747 新增的 base_title_sha256 闸·算法逐字沿用正文那套 sha256(UTF-8)）——不带则该
        //   闸不生效、行为逐字维持原无条件写（契约第⑤条：base 均可选）。同款守卫：跨文档尾发不带。
        const baseTitleSha = sendDocId === docId ? await sha256Hex(lastServerTitleRef.current) : null;
        // 组件乐观锁：这一发带了组件才带「我基于服务端哪一份组件」（同 baseSha 发送瞬间现读·跨文档尾发不带）
        const baseLayersSha = sendDocId === docId && 'layers' in layersPutBody(extra) ? await sha256Hex(lastServerLayersJsonRef.current) : null;
        const res = await host.putDoc(String(sendDocId), {
          title: sendTitle, content: sendContent, ...layersPutBody(extra), ...(baseSha ? { base_sha256: baseSha } : {}), ...(baseTitleSha ? { base_title_sha256: baseTitleSha } : {}), ...(baseLayersSha ? { base_layers_sha256: baseLayersSha } : {}),
        });
        // 🔴 [autosave 乐观锁] 409 = 服务端正文已不是我发的 base（有人在我读到它之后改了库·本次未写库）
        //   → 不当"保存失败"报错了事，也绝不重试盖回去：存下服务端最新版、挂冲突闸、弹条让用户选边
        //   （载入新版 / 保留我的并覆盖）。返回 false=本发未落库（dirty 保留·D5 语义不破）。
        // ⚠️ 本段（连同上方 fetch 整段）会被 e2e/agent/aiscribe-process-visibility-contract.spec.ts
        //   case-17 用 new AsyncFunction **原样当 JS 编译执行**（源码抠段真跑法）——这里**不许出现
        //   TS-only 语法**（类型标注 / as 断言 / 泛型），否则那条 spec 会 SyntaxError。故下面用纯 JS 写法。
        // 组件乐观锁 409（回包带 server_layers）：三方合并、组件仍脏下一发再存；只撞组件（没带 server_content）⇒ 到此为止
        if (res.status === 409 && sendDocId === docId) {
          const layersConflict = await res.clone().json().catch(() => null);
          if (layersConflict && typeof layersConflict === 'object' && 'server_layers' in layersConflict) {
            onLayersConflict(layersConflict.server_layers);
            if (!('server_content' in layersConflict)) { setSaveStatus("idle"); return false; }
          }
        }
        if (res.status === 409) {
          const conflict = await res.json().catch(() => null);   // 体形见 docs/route.ts 的 doc_conflict
          // 🔴 route.ts 新增的 stale 标记
          //   ＝"server_content/server_title 这两个字段是服务端拿不到真行时的兜底空值（重读失败 或
          //   该行已被并发软删），不是真实服务端值"（aiscribe_docs.title 是 NOT NULL·
          //   真实库值永远不会是空标题/空正文·见 route.ts 同批注释）。旧写法只判 typeof===string，
          //   兜底空字符串 '' 一样通过——会把"读失败"误当"服务端此刻正文就是空"塞进冲突条，用户点
          //   「载入新版」直接清空文档、点「保留我的并覆盖」用假基线再打一发。stale 命中时整段当
          //   "没能拿到可用的服务端快照"处理：不进冲突条、不推进 title 基线，留着旧基线等下一次
          //   真实的 409/轮询自然纠偏——宁可让这一发继续挂 dirty 稍后重试，也不能拿假数据引导用户
          //   点出破坏性操作。
          const conflictStale = !!(conflict && conflict.stale === true);
          const serverContent = conflict && !conflictStale && typeof conflict.server_content === 'string' ? conflict.server_content : null;
          const serverTitle = conflict && !conflictStale && typeof conflict.server_title === 'string' ? conflict.server_title : null;
          if (sendDocId === docId && serverContent !== null) {
            setSaveConflict({ serverContent, serverTitle });
            saveConflictRef.current = true;   // 闸即刻生效（不等下一次渲染·防这 3 秒内又排一发空转 409）
            // [S9 title-only 修] 409 响应体（不论是 content 触发还是 title 触发）都带 server_title——
            //   这是我们此刻真实知道的服务端 title，无条件推进基线（同 lastServerContentRef 的
            //   resolveConflictKeepMine 语义：知道了就该记住，不然下一发用旧 base 还是白挨一次 409）。
            lastServerTitleRef.current = serverTitle ?? '';
          }
          setSaveStatus("error");
          if (statusTimer.current) clearTimeout(statusTimer.current);
          statusTimer.current = setTimeout(() => setSaveStatus("idle"), 3000);
          return false;
        }
        if (!res.ok) throw new Error();
        // 服务端 PUT 已把 title 统一剥掉 :color[]{} 指令字面（route.ts stripDirectiveMarkup）
        //   并把剥后纯文字回带在响应体 data.title——手动改标题输入含指令标记时，前端此前只发原 title、成功后只设
        // 保存状态、从不读响应，受控 input 会继续显示带标记的原文。
        //   这里读回响应、剥后值与当前 title 不同就回填 state，让输入框在保存后真的变成纯文字。
        //   catch 内静默吞：读响应失败不该让保存本身判失败（保存已成功·回填是锦上添花）。
        // 比较对象必须是"响应到达时的当前输入"（titleRef.current），
        //   不能比请求闭包里的旧 title——PUT 在途时用户若继续改标题，闭包旧 title 已经不是用户现在看到的值，
        //   若仍拿闭包值判等，服务端回带的（针对旧值剥好的）规范化结果会覆盖用户飞行期间打的新字符，造成丢字。
        //   现在改为：读 titleRef.current（永远追踪最新 title state），若响应到达时当前输入已经变了（用户在飞行期又改了）→
        //   不回填，尊重用户新输入（脏值会随下次保存自然重送、届时再剥一次）；若当前输入仍与请求时一致 → 回填服务端规范化值。
        // [S9 title-only 修] 响应体 title = 服务端这次写后真值（剥标记/去重后规范化过）——记下来给
        //   下面的 lastServerTitleRef 推进用。
        // 🔴 解析失败**不能**退回用 sendTitle 当基线——服务端 route.ts 会用
        //   stripTitleWithFallback 剥指令标记 + ensureUniqueSiblingName 撞名加序号改写落库的真实 title，
        //   两者恰恰就是"服务端真值 ≠ 我方发出值"的典型场合；猜成 sendTitle 会让基线错配真实库值，
        //   下一发算出的 base_title_sha256 恒对不上库里的真值 → 自伤式假 409、autosave 看似冻结
        // 。改法：解析失败就不推进（savedTitleForBase 留 null，
        //   下方 :4048 一带的推进只在非 null 时才写）——基线维持上一次已知的真值，若因此真撞了一次
        //   冲突，409 处理点（:3924 一带）会用响应体带回的 server_title 正常纠偏，比瞎猜一个可能
        //   错的值更安全。
        let savedTitleForBase: string | null = null;
        try {
          const saved = await res.json()
          // 记下这发落库后服务端回的 updated_at：轮询／Realtime 看到同一个戳＝自己写的·不当别人改
          host.docLive?.rememberOwnWriteStamp(ownWriteStampsRef.current, saved?.updated_at);
          if (sendDocId === docId && typeof saved?.updated_at === 'string') lastSeenUpdatedAtRef.current = saved.updated_at;
          if (typeof saved?.title === 'string') {
            savedTitleForBase = saved.title;
            if (saved.title !== titleRef.current && titleRef.current === sendTitle) {
              setTitle(saved.title)
            }
          }
        } catch { /* 响应体解析失败：不猜基线、不改 UI——本发已 200 落库，只是我们暂不确知规范化后的
          真实 title 字面；lastServerTitleRef 保持不动，靠下一次真冲突的 409 响应纠偏（见上方注） */ }
        setSaveStatus("saved");
        if (pendingConfirmSaveFailureRef.current && Date.now() - pendingConfirmSaveFailureRef.current.ts > PENDING_CONFIRM_FAILURE_TTL_MS) {
          setStepProgressTerminal(pendingConfirmSaveFailureRef.current.assistantMsgId, unconfirmedSaveStep(language));
          pendingConfirmSaveFailureRef.current = null;
        }
        const pendingFailure = pendingConfirmSaveFailureRef.current;
        if (
          pendingFailure
          && sendDocId === pendingFailure.docId
          && sendContent === pendingFailure.contentSnapshot
          && sendContent === mdContentRef.current
          && contentGenRef.current === pendingFailure.gen
        ) {
          const resolvedMsgId = pendingFailure.assistantMsgId;
          pendingConfirmSaveFailureRef.current = null;
          const recoveredStep = language === 'zh-CN' ? '已套用全文覆盖'
            : language === 'en' ? 'Applied full rewrite'
            : '已套用全文覆蓋';
          setStepProgressTerminal(resolvedMsgId, recoveredStep);
        }
        // 🔴 清 dirty 的唯一合法条件 = 「这一发成功落库 && 它落的值 == 编辑器当前值」。
        //   旧写法只要 PUT 成功就无条件清脏——但串行化下"成功的这发"很可能是队列里的旧值（用户在它飞行
        //   期间又改了、尾值还没发出去），此时清脏 = 谎报"已全部落库"，玻璃罩落下时不再暂存在途输入
        // 。值不等就留着脏，等尾发成功那一刻自然清。
        if (sendDocId === docId && sendContent === mdContentRef.current && sendTitle === titleRef.current) {
          dirtyRef.current = false;                     // [玻璃罩块B] 已落库且就是当前值→清脏
        }
        // 基线必须=本次真正发出并成功落库的 sendContent——不能拿 mdContentRef.current（响应到达
        //   时可能已是更新的输入，还没真正发过 PUT）当"已知服务端内容"，那正是原竞态的根：会让"看似已存"
        //   的基线超前于 DB 实际落的值，掩盖住还需要再补发一次的事实。（尾值合并交由 useDocSaveQueue 处理。）
        //   sendDocId ≠ 当前 docId（这发属于已切走的旧文档）时不动本页基线——那不是本文档的服务端状态。
        if (sendDocId === docId) lastServerContentRef.current = sendContent;
        // [S9 title-only 修] 同款推进 title 基线——这一发成功落库的 title 就是服务端现在的真值
        //   （响应体回带了剥标记/去重后的规范化 title 才推进；上方 catch 已经把"解析失败=退回
        //   sendTitle"这条错误 fallback 拿掉——见 :3950 一带注释，此处 savedTitleForBase 为 null
        //   时保持不动，不猜）。
        if (sendDocId === docId && savedTitleForBase !== null) lastServerTitleRef.current = savedTitleForBase;
        // 这一发带了组件且已落库：记服务端那份签名；本地现在仍是那份 ⇒ 组件不脏。组件仍脏 ⇒ 整份文档仍算脏（D5 同口径：落的不是当前值就不清）
        if (sendDocId === docId) {
          const sentLayers = layersPutBody(extra);
          if ('layers' in sentLayers) {
            const k = docLayersKey(sentLayers.layers);
            lastServerLayersKeyRef.current = k;
            lastServerLayersJsonRef.current = serverLayersJson(sentLayers.layers);
            lastServerLayersItemsRef.current = sentLayers.layers?.items ?? [];
            if (docLayersKey(toDocLayers(layersRef.current)) === k) layersDirtyRef.current = false;
          }
          if (layersDirtyRef.current) dirtyRef.current = true;
        }
        // 通知主页面 canvas window 同步最新内容（无需用户刷新/关窗重开）
        const bc = new BroadcastChannel('dilinai-doc-sync')
        bc.postMessage({ docId: sendDocId, content: sendContent })
        bc.close()
        if (sendDocId === docId && !dirtyRef.current) host.onSaved?.();
        if (statusTimer.current) clearTimeout(statusTimer.current);
        statusTimer.current = setTimeout(() => setSaveStatus("idle"), 2000);
        return true;
      } catch {
        setSaveStatus("error");
        if (statusTimer.current) clearTimeout(statusTimer.current);
        statusTimer.current = setTimeout(() => setSaveStatus("idle"), 3000);
        return false;
      } finally {
        docPutInFlightRef.current = Math.max(0, docPutInFlightRef.current - 1);
      }
    },
  });

  // 返回值 = 这次保存意图的值是否真正落库；await saveDoc() 一定等到"覆盖了本次意图的那发"
  //   完成才返回（exportWord 依赖此契约：导出前先落库，后端才读得到新值）。
  const saveDoc = useCallback(async (opts?: { silent?: boolean }): Promise<boolean> => {
    if (readonlyDoc) return false; // [记忆②] 全局记忆只读：手动/自动保存全不发（服务端 403 是兜底·别白打）
    if (lockedRef.current) return false; // [玻璃罩块B] 罩期机器人正写=服务端内容权威·前端绝不回写（防覆盖机器人编辑）
    // 🔴 [autosave 乐观锁] 冲突未决=服务端有一版我没看过的内容·用户还没选边 → 一律不发
    //   （同罩期语义）。否则 3 秒 debounce 会一直空转打 409。用户点冲突条两个按钮之一即解闸。
    if (saveConflictRef.current) return false;
    return runDocSave(opts);
  }, [readonlyDoc, runDocSave]);

  const resolveConflictTakeServer = useCallback(() => {
    if (!saveConflict || !editor) return;
    const mine = mdContentRef.current;
    // 🔴 本批新上 title 闸之前，
    //   title-only 的外部改名根本不产生 409、这条路进不来；title 闸一上，「我在改标题 × 外部也改了
    //   标题」正是最典型的碰撞形态——而下面那行把服务端标题回填输入框的调用是**无条件**盖掉
    //   用户此刻标题框里那份还没落库的新标题。上一版只把正文塞进 stash，等于护栏只盖了正文那一半，
    //   标题那一半被静默吞掉。这里补齐：标题与正文同款进 stash（各自独立判「我这份和服务端那份
    //   真的不同」才暂存·相同就没什么可还原的），还原由 restoreStash 一并做。
    const myTitle = titleRef.current;
    const contentDiffers = mine !== saveConflict.serverContent;
    // serverTitle === null（服务端这次没给 title）时下面根本不会 setTitle、标题不会被盖，无须暂存。
    const titleDiffers = saveConflict.serverTitle !== null && myTitle !== saveConflict.serverTitle;
    if (contentDiffers || titleDiffers) {
      keepOlderStash();   // 上一份没还原也没捨棄的暂存 ⇒ 挪去「更早的暂存」（⛔ 被这份顶掉）
      stashRef.current = contentDiffers ? mine : null;   // 本地这份进暂存（反铁项1）
      stashTitleRef.current = titleDiffers ? myTitle : null;
      setStashHasTitle(titleDiffers);
      setStashNotice('restore');            // 复用掀罩后的「还原我的修改」条
    } else if (stashRef.current != null || stashTitleRef.current != null) {
      // 🔴 两半皆同＝本次没什么可暂存；但上一次留下的旧暂存若不清，就挂在这个新现场上，
      //   用户点还原会套用一份与当前无关的旧标题/旧正文（脏暂存被当有效暂存用）。清残＝两半同生同灭。
      keepOlderStash();   // 清的是「还原」那条路·字挪去「更早的暂存」只给复制（⛔ 默默丢）
      stashRef.current = null;
      stashTitleRef.current = null;
      setStashHasTitle(false);
      setStashNotice(null);
    }
    isProgrammatic.current = true;
    editor.commands.setContent(mdToTiptapHtml(saveConflict.serverContent) || '<p></p>');
    isProgrammatic.current = false;
    setMdContent(saveConflict.serverContent);
    mdContentRef.current = saveConflict.serverContent;
    // 🔴 lastServerTitleRef 推进成 saveConflict.serverTitle ?? ''——
    //   与 409 处理点（:3924 一带·同一套 ?? '' coalesce）口径对齐，不只在 `!== null` 时才动（那是 UI
    //   展示层的守卫，用来"服务端没给 title 就别覆盖输入框显示"，与基线推进是两件事）。
    // 🔴 复核过：这一行删掉重新连跑 Z1/Z2/Z3 三条缝，读数**一字不变**——因为
    //   `saveConflict` 只能来自上方 409 处理点（:3945），那里在 `setSaveConflict` 之前已经无条件写过
    //   一次 `lastServerTitleRef.current = serverTitle ?? ''`，本行是同一守卫块内对同一个值的**幂等
    //   重复推进**，不是"此前完全没这行、下一发会立刻再挨一次自伤式 409"（那句因果关系不成立，
    //   不可复现——上一版报告的说法是错的，改正）。保留本行只为让"载入新版"这条路径本身自解释、
    //   不依赖读者去推导"409 处理点早就推过了"这层隐含前提；真正必要的推进点是 409 处理点本身。
    applyServerBaseline(saveConflict.serverContent, saveConflict.serverTitle ?? '');
    if (saveConflict.serverTitle !== null) { setTitle(saveConflict.serverTitle); titleRef.current = saveConflict.serverTitle; }
    dirtyRef.current = false;
    saveConflictRef.current = false;
    setSaveConflict(null);
  }, [saveConflict, editor, applyServerBaseline]);

  //   ② 保留我的并覆盖：把基线推成服务端那一版（= 我已看过它、明知要盖），解闸后立刻发一发
  //      非静默保存。若此刻服务端又变了一版，那一发会再吃 409、冲突条再来一次（正确·不静默盖）。
  // 409 撞出来的冲突条·而本页**没有**未保存改动（dirty=false：例如载入后 3 秒那发例行 autosave 恰好撞上角色刚写完）
  //   ⇒ 没什么「我的」要保·别问·直接换成服务端那版（同 apply 分支的收尾）并解闸。真旅程实撞：页面开着 → 钥匙 PUT → 例行 autosave 409 → 弹「文檔已被外部更新」让人选边·可用户一个字都没改。
  //   有未保存改动（dirty=true）照旧弹条让用户选边（反铁项 1）。⛔ 不动 doSave 里的 409 分支（契约 spec 抠段真跑·别加自由名）。
  useEffect(() => {
    if (!saveConflict || saveConflict.origin === 'live' || !editor) return;
    if (dirtyRef.current) return;
    applyServerContentSmooth(saveConflict.serverContent);
    setMdContent(saveConflict.serverContent);
    mdContentRef.current = saveConflict.serverContent;
    if (saveConflict.serverTitle !== null && saveConflict.serverTitle !== titleRef.current) { setTitle(saveConflict.serverTitle); titleRef.current = saveConflict.serverTitle; }
    applyServerBaseline(saveConflict.serverContent, saveConflict.serverTitle ?? '');
    dirtyRef.current = false;
    saveConflictRef.current = false;
    setSaveConflict(null);
  }, [saveConflict, editor, applyServerContentSmooth, applyServerBaseline]);

  const resolveConflictKeepMine = useCallback(() => {
    if (!saveConflict) return;
    // 🔴 同款推进 title 基线（理由同 resolveConflictTakeServer 注释）
    //   ——同样是对 409 处理点已推进过的同一个值的幂等重复推进，复核过删掉这行读数不变，不是
    //   "不推进就会白挨一次多余 409"（那句因果不成立，已改正）。保留是为了这条路径自身在代码里
    //   自解释，不强依赖读者记得"409 处理点早推过了"。
    applyServerBaseline(saveConflict.serverContent, saveConflict.serverTitle ?? '');
    dirtyRef.current = true;
    saveConflictRef.current = false;
    setSaveConflict(null);
    void saveDoc({ silent: false });
  }, [saveConflict, saveDoc, applyServerBaseline]);

  const historyWalkRef = useRef<WalkState | null>(null);
  const historyBusyRef = useRef(false);
  const historyGenRef = useRef(0);

  const doHistoryRollback = useCallback(async (versionId: string): Promise<RollbackResult | null> => {
    try {
      if (!host.historyRollback) return null;
      const res = await host.historyRollback(docId, versionId);
      if (!res.ok) return null;
      const data = await res.json() as { ok?: boolean; content?: string; title?: string; layers?: unknown };
      if (!data.ok || typeof data.content !== 'string') return null;
      // 那一版记了组件 ⇒ 回包带 layers（null＝那版没有组件）；没这个键＝那版没记·组件不动
      return { content: data.content, title: typeof data.title === 'string' ? data.title : titleRef.current, ...('layers' in data ? { layers: data.layers ?? null } : {}) };
    } catch { return null; }
  }, [docId, host]);

  const applyHistoryResult = useCallback((r: RollbackResult) => {
    if (!editor) return;
    isProgrammatic.current = true;
    editor.commands.setContent(mdToTiptapHtml(r.content) || '<p></p>');
    isProgrammatic.current = false;
    setMdContent(r.content);
    setTitle(r.title);
    // rollback API 已把这份内容写回服务端 → 它就是新的服务端基线·非脏（防 autosave 白打一发·
    // 防「内容变了」被行走有效性判据误判成用户手编）。
    // 🔴 title 基线同款推进——RollbackResult.title 恒为 string（doHistoryRollback 兜底
    //   titleRef.current，非可选）·此前只推进了 content 那一半（Ctrl+Z/Ctrl+Y 每步都会漏推 title 基线）。
    applyServerBaseline(r.content, r.title);
    dirtyRef.current = false;
    // ref 同步不等下一次渲染：连续快按两次 Ctrl+Z 时·第二按在 re-render 前读 mdContentRef/titleRef
    // 若还是旧值·isWalkCurrent 会误判 burst 失效重开一轮（state 的 setMdContent/setTitle 照发·渲染
    // 层不受影响·此处只是把 ref 提前对齐）。
    mdContentRef.current = r.content;
    titleRef.current = r.title;
    if (r.layers !== undefined) applyServerLayers(r.layers);   // 组件一起回到那一版
  }, [editor, applyServerBaseline, applyServerLayers]);

  // 返回值=这次调用是否真正 applied 了一步历史（false=没能推进：readonly/locked/并发挡下/burst
  //   开不起来/rollback 失败/历史耗尽——调用方靠这个真假区分"画面已变但状态没跟上"）。
  const stepHistoryDir = useCallback(async (dir: 'undo' | 'redo'): Promise<boolean> => {
    if (!editor || readonlyDoc || lockedRef.current || historyBusyRef.current || !host.historyVersions) return false;
    historyBusyRef.current = true;
    historyGenRef.current += 1;
    // rollback 是 await fetch 的真网络往返，非本地同步——从 doHistoryRollback
    //   发起到 applyHistoryResult 真正 setContent 覆写之间隔着这段窗口，原注释把它定性为"瞬时、
    //   不会被用户看见"但没有在弱网/延迟下验证过。与其继续赌网络够快，这里把编辑区在整段 stepHistoryDir
    //   期间锁只读——彻底堵死"用户在窗口内继续打字，构造出与实际 DOM 不同源 transaction"的入口，
    //   比事后补救更稳。finally 里按 readonlyDoc/isListingMode/lockedRef 当下真实值交还可编辑性
    //   （不是无脑设 true）——即便本次调用期间这几个依赖发生了变化，交还时也读的是最新值。
    // setEditable 从 try 之外挪进 try 内第一行（调用顺序/行为不变·仅让 finally 兜到它）：
    //   本轮真断点就是它在这里抛 IndexSizeError（详见 onNativeInput 注释），而它落在 try 之外 ⇒
    //   finally 不执行 ⇒ 上一行刚置真的 historyBusyRef 永久卡住 ⇒ 此后**所有**撤销/重做（含键盘
    //   Ctrl+Z 与工具栏 ↩↪）全被首行的 historyBusyRef.current 挡下、静默失效。根因已在上游治掉，
    //   这里补的是「万一它以别的原因再抛」时不再把整条历史链一起带走的护栏。
    try {
      editor.setEditable(false);
      let walk = historyWalkRef.current;
      // burst 有效性：脏（用户手编过）或显示内容已不是状态机最后应用的（AI 改/别处回滚/外部编辑
      //   经掀罩进来）→ 重开一轮 burst（无时间窗判据）。redo 无既有 burst 时无从走·直接返回。
      if (!walk || dirtyRef.current || !isWalkCurrent(walk, mdContentRef.current, titleRef.current, docLayersKey(toDocLayers(layersRef.current)))) {
        if (dir === 'redo') return false;
        if (dirtyRef.current || docPutInFlightRef.current > 0) {
          const ok = await saveDoc({ silent: true });  // flush：打字中的未保存段先落库（=可回滚的一版）
          if (!ok) return false;
        }
        const res = await host.historyVersions(docId);
        if (!res.ok) return false;
        const rows = await res.json() as { id: string }[];
        if (!Array.isArray(rows) || rows.length === 0) return false;
        walk = startWalk(rows.map(r => ({ id: r.id })), { content: mdContentRef.current, title: titleRef.current, layers: toDocLayers(layersRef.current) }, docLayersKey);
      }
      const out = dir === 'undo' ? await stepUndo(walk, doHistoryRollback, docLayersKey) : await stepRedo(walk, doHistoryRollback, docLayersKey);
      historyWalkRef.current = out.state;
      if (out.applied) {
        applyHistoryResult(out.applied);
        if (out.restorePreBurst) {
          // 走回 burst 起点：那份现场只在本地（当时可能没落过库）→ 标脏补一发保存（editor 途径·
          //   194 不播报；188 会把「redo 前状态」照记一版=历史仍每步在案）。
          dirtyRef.current = true;
          if (out.applied.layers !== undefined) layersDirtyRef.current = true;   // 起点那份组件也要补存
          void saveDoc({ silent: true });
        }
        return true;
      }
      return false;
    } finally {
      historyBusyRef.current = false;
      historyGenRef.current += 1;
      editor.setEditable(!readonlyDoc && !isListingMode && !lockedRef.current);
    }
  }, [editor, readonlyDoc, isListingMode, docId, saveDoc, doHistoryRollback, applyHistoryResult, host]);

  // ref 桥（historyStepsKeymap / 工具栏 ↩↪ 共用·渲染期同步指最新）
  undoFromHistoryRef.current = host.has('history') ? () => { void stepHistoryDir('undo'); } : () => { editor?.chain().focus().undo().run(); };
  redoFromHistoryRef.current = host.has('history') ? () => { void stepHistoryDir('redo'); } : () => { editor?.chain().focus().redo().run(); };
  useEffect(() => {
    let lastDownInLayers = false;
    const onDown = (e: PointerEvent) => {
      const el = e.target as HTMLElement | null;
      lastDownInLayers = !!el && typeof el.closest === 'function' && !!el.closest('.doc-layers-plane');
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k !== 'z' && k !== 'y') return;
      const el = e.target as HTMLElement | null;
      if (!el || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable) return;
      const inPlane = typeof el.closest === 'function' && !!el.closest('.doc-layers-plane');
      const onPage = el === document.body || el === document.documentElement;
      if (!inPlane && !(onPage && lastDownInLayers)) return;
      e.preventDefault();
      if (k === 'y' || e.shiftKey) redoFromHistoryRef.current?.(); else undoFromHistoryRef.current?.();
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('pointerdown', onDown, true); window.removeEventListener('keydown', onKey); };
  }, []);
  // 每次渲染都重新指向
  // "当下这份" stepHistoryDir/editor/mdContentRef（同 undoFromHistoryRef 范式）——原生 input
  // 监听（上方 useEffect，只在 editor 变化时重挂一次）只捕获一次闭包，必须靠这层 ref 桥才能拿到
  // 每次渲染最新的 stepHistoryDir/mdContentRef，不必因此每次渲染都重新 addEventListener。
  undoFromHistoryAwaitableRef.current = async (baseline) => {
    const before = baseline?.content ?? mdContentRef.current;
    if (baseline && editor) {
      isProgrammatic.current = true;
      editor.commands.setContent(mdToTiptapHtml(before) || '<p></p>');
      isProgrammatic.current = false;
      setMdContent(before);
      mdContentRef.current = before;
      dirtyRef.current = baseline.dirty;   // 原生撤销不是用户编辑·脏位照 pre-undo 原样交还
    }
    const applied = await stepHistoryDir('undo');
    if (!applied && editor) {
      // stepHistoryDir 没能 applied：原生 execCommand('undo') 已经先动过 DOM，这里用调用前记下
      // 的已知基线强制覆写，把那次没人知情的局部改动物理抹掉（不是"假装没发生"——上层会弹提示）。
      isProgrammatic.current = true;
      editor.commands.setContent(mdToTiptapHtml(before) || '<p></p>');
      isProgrammatic.current = false;
    }
    return applied;
  };

  // 改调后端 POST /api/aiscribe/word（body {docId, paper}）——
  //   后端从 markdown 原文直接解析（图片内嵌 + 视频/网址卡片封面图），比前端 doc-export.ts 的
  // DOM-walk 更完整。失败兜底回退前端 util（不留死按钮）。
  // 🔴 定义须在 saveDoc 之后（exportWord 依赖 saveDoc·顺序在前会撞 TDZ ReferenceError）。
  const exportWord = useCallback(async () => {
    if (wordLoading || !editor) return;
    setWordLoading(true);
    try {
      if (!host.exportWordServer || !host.has('wordServer')) throw new Error('no server word export');
      if (!lockedRef.current && (mdContentRef.current !== lastServerContentRef.current || titleRef.current !== lastServerTitleRef.current)) {
        await saveDoc({ silent: true }); // 导出前先落库一次(幂等)·原 saveDoc 保存 title/content·失败走静默态·导出仍尽力
      }
      // 只挪了自由组件（正文标题没变）也要先落库——后端导出读的是 DB 里的 layers
      if (!lockedRef.current && layersDirtyRef.current) await saveDoc({ silent: true });
      // 服务端权威源=DB 里该 doc 的 paper_pref——纸型 PUT
      // 是异步后台跑的（见上方 selectPaperPref/drainPaperWrites），若导出不等它，用户刚选完纸型立刻
      // 点导出会读到 DB 里的旧值。这里等同一条写链的 promise 跑完（若当下确有在途/待追平的选择），
      // 保证服务端读到的 paper_pref 已反映用户最新点选；没有在途写时该 promise 为 null，不引入等待。
      if (paperDrainPromiseRef.current) await paperDrainPromiseRef.current;
      // 带上登入凭证（App 内的网页视图不一定带 cookie）；浏览器照常走 cookie。
      const blob = await host.exportWordServer(docId, paperPref);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${title || t('bf_scribe_untitled')}.docx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      // 后端端点异常（网络/服务忙）→ 前端 util 兜底（原逻辑·图片/卡片缺口仍在但保证有输出）。
      await host.exportDocAsWord({ content: tiptapHtmlToMd(editorHtmlWithLiveColWidths(editor)), title, paper: paperPref, docId });
    } finally {
      setWordLoading(false);
    }
  }, [editor, title, paperPref, docId, wordLoading, t, saveDoc, host, tiptapHtmlToMd]);

  // loadVisibility：开弹窗拉 /api/drive/all（含 visibility）find 本 doc·失败默认 private。
  //   三态读取：'unlisted'/'public' 透传真值·其余（含旧 undefined/异常值）退 'private'（fail-closed·别把未知态当公开）。
  //   onChange：PUT /api/aiscribe/docs?id=<id> body {visibility:三态}·后端 PUT 已扩三态 + 系统doc guard 挡②③（route.ts:199/156）。
  const loadDocVisibility = useCallback(async (): Promise<ShareVisibility> => {
    if (!host.loadDocVisibility) return 'private';
    return host.loadDocVisibility(docId);
  }, [docId, host]);

  const changeDocVisibility = useCallback(async (next: ShareVisibility) => {
    if (!docId) throw new Error('no docId');
    const res = await host.putDoc(docId, { visibility: next });
    if (!res.ok) throw new Error('share PUT failed');
  }, [docId, host]);

  const profilePutChainRef = useRef<Promise<unknown>>(Promise.resolve());
  const profileInitialRef = useRef(profileInitial);
  profileInitialRef.current = profileInitial;
  const profileReqSeqRef = useRef(0);   // 请求发号（回滚门控·仅最新一发失败才回滚）
  const changeProfilePublish = useCallback(async (next: ProfilePublishState) => {
    if (!docId) throw new Error('no docId');
    const seq = ++profileReqSeqRef.current;
    const prev = profileInitialRef.current;   // 回滚基准（本次调用前的权威值）
    setProfileInitial(next);                  // 乐观回写
    const run = profilePutChainRef.current.then(async () => {
      const res = await host.putDoc(docId, {
        profile_published: next.published,
        profile_cover_url: next.coverUrl,
        profile_title: next.title,
      });
      if (!res.ok) throw new Error('profile publish PUT failed');
    });
    profilePutChainRef.current = run.catch(() => {});   // 链尾推进（一发失败不断整条链）
    try {
      await run;
    } catch (e) {
      // 🔴 回滚门控：仅当本发仍是**最新一发**才回滚——否则旧发失败会把后发的更新意图覆盖掉
      //   （A 乐观 true→B 乐观 false→A 失败·若无条件回滚会把 B 的 false 退回 A 的 prev·丢 B 意图）。
      if (seq === profileReqSeqRef.current) setProfileInitial(prev);
      throw e;
    }
  }, [docId, host]);

  // 稳定 prop 引用（避免每 render 新对象让弹窗 useEffect 反复重初始化）。
  //   initial 随 doc 载入(1818)+每次 changeProfilePublish 成功回写(单调水位)变·始终反映最新权威值（真案3收尾·勾选态不再回退旧值）。
  const profilePublishProp = useMemo(
    () => ({ initial: profileInitial, onChange: changeProfilePublish }),
    [profileInitial, changeProfilePublish],
  );

  useEffect(() => () => { if (statusTimer.current) clearTimeout(statusTimer.current); }, []);

  useEffect(() => {
    if (loadingDoc) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const fire = () => {
      if (historyBusyRef.current) { saveTimer.current = setTimeout(fire, 1000); return; }
      void saveDoc({ silent: true });
    };
    saveTimer.current = setTimeout(fire, 3000);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
    // 🔴 依赖里的 `messages` 换成 `localMsgsGen`
    //   ——正文/标题变化照常 3 秒 debounce 存（口径不变）；消息只在**本地消息事件**（用户发言 /
    //   AI 回复 / 过程条更新，见 setMessages wrapper）时才推进世代号触发保存，服务端回读消息
    //   （初始加载、外部编辑侦测补拉）不再扣扳机=掐断「侦测即覆盖」死循环。
  }, [mdContent, title, localMsgsGen, layersGen, loadingDoc, saveDoc]);

  // 外框（游客版）要知道：有没有还没存的改动、存档状态；它要先存（汇出、换存放位置前）就叫 flush
  useEffect(() => { host.onSaveStatus?.(saveStatus); }, [saveStatus, host]);
  useEffect(() => {
    if (loadingDoc) return;
    if (mdContentRef.current === lastServerContentRef.current && titleRef.current === lastServerTitleRef.current && !layersDirtyRef.current) return;
    host.onEdited?.();
  }, [mdContent, title, layersGen, loadingDoc, host]);
  // Desktop app: save before the tab closes (shared/desktop-before-close)
  useEffect(() => registerDesktopBeforeClose(async () => { await saveDoc({ silent: true }); }), [saveDoc]);
  useEffect(() => {
    if (!host.registerFlush) return;
    host.registerFlush(async () => { await saveDoc({ silent: false }); });
    return () => host.registerFlush?.(null);
  }, [host, saveDoc]);

  const saveStatusLabel = saveStatus === "saving" ? t('saving')
    : saveStatus === "saved" ? t('saved_at')
    : saveStatus === "error" ? t('scribe_save_error') : "";

  // Phase A：删除旧 embed 模式 postMessage 桥接（migrate 到 inline DocEditor 组件）

  if (loadFail) return <>{host.renderLoadFail(loadFail, docId)}</>;

  if (loadingDoc) return (
    <EditorLoadingScreen kind="doc" label={t('scribe_loading')} className={editorShell.loadingScreen}
      style={{ fontFamily: "var(--cjk-font)" }} />
  );

  // 只读系统 doc（全局记忆等·数据层 writeMemoryGuard 已拒用户写）→ 渲染干净唯读视图：
  //   无编辑器工具栏 / 无 AI 对话区 / 无保存·分享按钮（不给可编辑·保存的「假界面」）。复用 DocReadOnlyPage variant="system"。
  //   编辑器实例仍 mount（hooks 规则不可条件调用）但不渲染 EditorContent·内容读 readonlyContent（稳定·不被 1495 行清空）。
  if (readonlyDoc && host.renderReadOnly) return (
    <>{host.renderReadOnly({ docId, title, content: readonlyContent, paperSettings, layers: toDocLayers(layerItems) })}</>
  );
  return (
    <div className={`h-screen ${editorShell.root} flex flex-col overflow-hidden`}
      style={editorShell.rootFont}>

      {/* ── Header（standalone 始终显示；canvas 全屏不再走此页 — Phase A 改 inline DocEditor）
 窄屏：返回/云盘 icon-only；汇出 Word/PDF/MD 合一钮下拉。
 桌面/折叠：保持原 Word/PDF/Markdown 三钮平铺 + 返回/云盘带文字。 */}
      <header className={`${editorShell.headerBar} px-4 py-2.5 flex items-center gap-3 shrink-0 relative`} style={editorShell.beigeSurface} data-testid="scribe-topbar">
        {host.renderHomeBrand({ iconOnly: isNarrow, testId: "scribe-home" })}
        <div className={editorShell.headerDivider} />
        {/* 雲端硬碟＝新开浏览器分页进云盘页 */}
        {host.has('driveLink') && (<>
        <a href="/my-drive" target="_blank" rel="noopener noreferrer" title={t('scribe_drive_title')}
          className={editorShell.headerLink}>
          {isNarrow ? (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path d="M2 6a2 2 0 0 1 2-2h3.586a2 2 0 0 1 1.414.586l1.414 1.414a2 2 0 0 0 1.414.586H16a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6z" />
            </svg>
          ) : (
            t('bf_scribe_drive')
          )}
        </a>
        <div className={editorShell.headerDivider} />
        </>)}
        {/* 唯一访问人数（眼睛图标+数字·owner 视角·作者本人不计·分享页 UV）。
 仅普通可编辑 doc 显示（只读系统 doc 无分享/无意义）·viewCount 已载入才显示。>9999 走 fmtWan 三语。 */}
        {!readonlyDoc && viewCount !== null && (
          <span
            className="flex items-center gap-1 text-xs text-amber-600/80 shrink-0 select-none"
            title={t('scribe_views_tooltip')}
            aria-label={t('scribe_views_tooltip')}
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path d="M10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />
              <path fillRule="evenodd" d="M.664 10.59a1.651 1.651 0 0 1 0-1.186A10.004 10.004 0 0 1 10 3c4.257 0 7.893 2.66 9.336 6.41.147.381.146.804 0 1.186A10.004 10.004 0 0 1 10 17c-4.257 0-7.893-2.66-9.336-6.41ZM14 10a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z" clipRule="evenodd" />
            </svg>
            <span className="tabular-nums">
              {viewCount < 10000 ? viewCount : `${(language === 'en' ? viewCount / 1000 : viewCount / 10000).toFixed(1)}${t('profile_unit_wan')}`}
            </span>
          </span>
        )}
        <div className={`${editorShell.headerDivider} ${!readonlyDoc && viewCount !== null ? '' : 'hidden'}`} />
        <input
          value={title}
          readOnly={readonlyDoc || locked}
          onChange={e => { if (readonlyDoc || locked) return; hasManualTitle.current = true; titleRef.current = e.target.value; setTitle(e.target.value); }}
          className={`flex-1 ${editorShell.titleInput}`}
          placeholder={t('scribe_title_ph')}
        />
        <div className="flex items-center gap-3 shrink-0 aiscribe-no-print">
          {readonlyDoc && (
            /* [记忆②] 全局记忆只读提示 */
            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 border border-amber-200 flex items-center gap-1">
              🔒 {t('bf_scribe_readonly_system')}
            </span>
          )}
          {!readonlyDoc && saveStatusLabel && (
            <span className={`text-xs ${saveStatus === "error" ? "text-red-400" : "text-gray-400"}`}>{saveStatusLabel}</span>
          )}
          {!readonlyDoc && !isSimplifiedSite() && host.has('listing') && (
            <>
              {isListingMode && (
                <button
                  onClick={() => setListingModalOpen(true)}
                  className="text-xs text-amber-600 hover:text-amber-800 font-medium transition-colors shrink-0"
                >
                  {t('pl_listing_edit')}
                </button>
              )}
              <button
                onClick={() => {
                  if (!isSeller) { setListingWarnOpen(true); return; }
                  if (isListingMode) {
                    setIsListingMode(false);
                  } else {
                    setIsListingMode(true);
                    setPaywallPositionPx(editorScrollRef.current ? Math.round(editorScrollRef.current.clientHeight / 2) : 300);
                  }
                }}
                className={`text-xs px-2 py-0.5 rounded transition-colors shrink-0 ${isListingMode ? 'bg-amber-100 text-amber-700 hover:bg-amber-200' : 'text-gray-400 hover:text-gray-700'}`}
              >
                {isListingMode ? t('pl_listing_cancel') : t('pl_listing_enter')}
              </button>
              <div className={editorShell.headerDivider} />
            </>
          )}
          {isNarrow ? (
            /* [响应式·铁项7] 窄屏汇出合一钮下拉：Word/PDF/Markdown 收成「汇出」popover */
            <ToolbarDropdown
              open={openToolGroup === 'export'}
              onOpenChange={open => setOpenToolGroup(open ? 'export' : null)}
              align="right"
              trigger={<span className="text-xs text-gray-500">{t('scribe_tb_export')}</span>}
              triggerTitle={t('scribe_tb_export')}
              triggerClassName={editorShell.toolbarTextBtn}
              items={[
                ...(host.has('importWord') ? [{ key: 'import-word', label: importWordBusy ? t('scribe_import_word_busy') : t('scribe_import_word'), onSelect: () => { if (!importWordBusy) importWordInputRef.current?.click(); }, disabled: importWordBusy }] : []),
                { key: 'word', label: wordLoading ? 'Word…' : 'Word', onSelect: () => { if (!wordLoading) exportWord(); }, disabled: wordLoading },
                ...(host.has('pdf') ? [{ key: 'pdf', label: pdfLoading ? 'PDF…' : 'PDF', onSelect: () => { if (!pdfLoading) exportPdf(); }, disabled: pdfLoading }] : []),
                ...(paperPref ? [{ key: 'print', label: t('scribe_print'), onSelect: printDoc }] : []),
                { key: 'md', label: t('export_markdown'), onSelect: exportMarkdown },
              ]}
            />
          ) : (
            <>
              {host.has('importWord') && (<>
              <button onClick={() => importWordInputRef.current?.click()} disabled={importWordBusy} title={t('scribe_import_word_title')}
                className={`${editorShell.headerTextBtn} disabled:opacity-60`}>{importWordBusy ? t('scribe_import_word_busy') : t('scribe_import_word')}</button>
              <div className="w-px h-4 bg-gray-200" />
              </>)}
              <button onClick={exportWord} disabled={wordLoading}
                className={`${editorShell.headerTextBtn} disabled:opacity-60`}>{wordLoading ? 'Word…' : 'Word'}</button>
              {host.has('pdf') && (
              <button onClick={exportPdf} disabled={pdfLoading}
                className={`${editorShell.headerTextBtn} disabled:opacity-60 flex items-center gap-1`}>
                {pdfLoading && (
                  <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z"/>
                  </svg>
                )}
                PDF
              </button>
              )}
              {paperPref && (
                <button onClick={printDoc} title={t('scribe_print_title')} data-testid="scribe-print"
                  className={`${editorShell.headerTextBtn} text-[11px]`}>{t('scribe_print')}</button>
              )}
              <button onClick={exportMarkdown}
                className={editorShell.headerTextBtn}>{t('export_markdown')}</button>
            </>
          )}
          {host.has('importWord') && <input ref={importWordInputRef} type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="hidden"
            data-testid="scribe-import-word-input" onChange={e => { void importWordFile(e.target.files?.[0]); }} />}
          {host.has('share') && (<>
          <div className="w-px h-4 bg-gray-200" />
          {/* 点「分享」→ 开 ShareLinkModal（飞书风下拉两态 + 链接 + 复制）·治原 toast 撤销没 UI 割裂 */}
          <button onClick={() => setShareModalOpen(true)} disabled={readonlyDoc || shareDisabled}
            className={`${editorShell.headerLinkBtn} disabled:opacity-40 flex items-center gap-1`}>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
              <path d="M13 4.5a2.5 2.5 0 1 1 .702 1.737L6.97 9.604a2.518 2.518 0 0 1 0 .792l6.733 3.367a2.5 2.5 0 1 1-.671 1.341l-6.733-3.367a2.5 2.5 0 1 1 0-3.475l6.733-3.366A2.52 2.52 0 0 1 13 4.5Z" />
            </svg>
            {t('bf_scribe_share')}
          </button>
          </>)}
        </div>
        {host.renderAIShieldPill?.(aiShield, "scribe-ai-shield")}
      </header>

      {/* ShareLinkModal · loadVisibility/onChange 在上方 callback 段·替原 toast */}
      {host.has('share') && host.renderShareModal?.({
        open: shareModalOpen,
        onClose: () => setShareModalOpen(false),
        title,
        shareUrl: typeof window !== 'undefined' && docId ? `${window.location.origin}/ai-scribe/share/${docId}` : '',
        loadVisibility: loadDocVisibility,
        onChange: changeDocVisibility,
        enableUnlisted: true,  // 三态：开 unlisted（取链接可看·不被搜）
        linkOnly: isSimplifiedSite(),  // 简体站只给「仅链接可见」（私有／仅链接两档·没有公开档）
        profilePublish: isSimplifiedSite() ? undefined : profilePublishProp,  // 分享到个人主页（勾选自动 public·展开封面+标题）·简体站没有个人主页
        ogWarmupDocId: docId,  // 开弹窗／复制链接时顺手预热分享图
      })}

      {/* [付费上架·批一] 编辑上架资料弹窗 */}
      {host.has('listing') && host.renderListingModal?.({
        open: listingModalOpen,
        onClose: () => setListingModalOpen(false),
        docTitle: title,
        docId,
        paywallBlockIndex: (() => {
          if (paywallPositionPx < 20) return 0;
          const pm = editorScrollRef.current?.querySelector('.ProseMirror');
          if (!pm) return 0;
          let count = 0;
          for (const block of Array.from(pm.children) as HTMLElement[]) {
            if (block.offsetTop + block.offsetHeight < paywallPositionPx) count++;
            else break;
          }
          return count;
        })(),
      })}

      {/* [付费上架·批一] 非卖家点上架弹「功能开发中」提示 */}
      {listingWarnOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
          <div className={editorShell.modalMask} onClick={() => setListingWarnOpen(false)} />
          <div className={`${editorShell.modalCard} px-8 py-8 max-w-xs w-full text-center`}>
            <div className="text-3xl mb-3">🚀</div>
            <p className="text-sm font-semibold text-gray-800 mb-1">
              {t('pl_warn_dev_title')}
            </p>
            <p className="text-xs text-gray-400 mb-6">
              {t('pl_warn_dev_sub')}
            </p>
            <button
              onClick={() => setListingWarnOpen(false)}
              className="px-6 py-2 rounded-lg bg-gray-800 text-white text-sm font-medium hover:bg-gray-700 transition-colors"
            >
              {t('pl_warn_dev_ok')}
            </button>
          </div>
        </div>
      )}

      {/* 直板机目录跳转 toast(2 秒自动消失·z-60 浮在 mobile aside z-50 之上让用户看见提示) */}
      {navToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] max-w-[92vw] bg-gray-900/95 keep-white rounded-lg shadow-lg px-4 py-2.5 text-xs leading-relaxed aiscribe-no-print">
          {t('bf_scribe_toc_jumped')}
        </div>
      )}

      {/* 右键菜单撤销/execCommand('undo')
 没能真正走通 rollback 时的提示(2 秒自动消失·同 navToast 范式)——DOM 已被强制拉回，这里只是
 让用户知道刚才那次撤销没生效，别以为悄悄成功了 */}
      {undoRevertedToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] max-w-[92vw] bg-gray-900/95 keep-white rounded-lg shadow-lg px-4 py-2.5 text-xs leading-relaxed aiscribe-no-print">
          {t('bf_scribe_undo_native_reverted')}
        </div>
      )}

      {/* ── Body */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Left sidebar
 窄屏: fixed inset-0 z-50 全屏覆盖 + 收起钮 + 只渲目录(去云盘 tab/内容)·
 桌面/折叠: 常显·style width=leftPanelWidth·leftCollapsed=true 整段不渲(收回去) */}
        {((isNarrow && leftMobileOpen) || (!isNarrow && !leftCollapsed)) && (
        <aside
          style={!isNarrow ? { width: leftPanelWidth, ...editorShell.beigeSurface } : undefined}
          data-testid="scribe-left"
          className={isNarrow
            ? "fixed inset-0 z-50 flex flex-col hp-lavender aiscribe-no-print relative"
            : "shrink-0 flex flex-col aiscribe-no-print relative"}
        >
          {/* [付费上架·批一] 上架编辑态灰雾覆盖侧栏 */}
          {isListingMode && <div className={editorShell.dimMask} />}
          {isNarrow && (
            /* 窄屏全屏覆盖时·必有收起钮 */
            <div className="flex justify-end px-3 py-2 border-b border-black/5">
              <button onClick={() => setLeftMobileOpen(false)} className="text-xs text-gray-500 hover:text-gray-800 flex items-center gap-1">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
                </svg>
                {t('scribe_collapse')}
              </button>
            </div>
          )}
          {/* 派生 tab 治窄屏状态残留:桌面打开 drive tab→缩窄屏→leftTab='drive' 残留+drive 内容被 !isNarrow 挡=空白。
 派生值优于 setState 副作用(resize 来回不抖+不动用户原 tab 态·桌面缩回去保留原选择)。窄屏永远显 outline(铁项5)。 */}
          <div className="flex border-b border-black/5">
            <button onClick={() => setLeftTab('outline')}
              className={`flex-1 py-2 text-xs font-medium text-center transition-colors ${effectiveLeftTab !== 'drive' ? editorShell.sideTabActive : editorShell.sideTabIdle}`}>
              ☰ {t('scribe_tab_outline')}
            </button>
            {!isNarrow && (
              /* 窄屏左侧不渲云盘 tab·直板手机只留目录 */
              <>
                <button onClick={() => setLeftTab('drive')}
                  className={`flex-1 py-2 text-xs font-medium text-center transition-colors ${effectiveLeftTab === 'drive' ? editorShell.sideTabActive : editorShell.sideTabIdle}`}>
                  {host.driveSlotLabel ?? t('bf_scribe_drive_tab')}
                </button>
                <PanelCollapseButton side="left" onCollapse={() => setLeftCollapsed(true)} title={t('scribe_collapse')} testId="scribe-left-collapse" />
              </>
            )}
          </div>

          {effectiveLeftTab === "secretbox" && (
            <div className="flex flex-col flex-1 overflow-hidden">
              <div className="px-3 py-2.5 border-b border-gray-100 flex items-center justify-between">
                <span className="text-xs text-gray-500 font-medium">{t('scribe_sb_title')}</span>
                <label className="flex items-center gap-1 cursor-pointer">
                  <input type="checkbox" checked={sbEnabled} onChange={e => setSbEnabled(e.target.checked)} className="accent-blue-500 w-3 h-3" />
                  <span className={`text-xs font-medium ${sbEnabled ? "text-blue-600" : "text-gray-400"}`}>{sbEnabled ? t('scribe_sb_enable') : t('scribe_sb_disable')}</span>
                </label>
              </div>
              <div className={`flex-1 overflow-y-auto px-3 py-2 flex flex-col gap-1.5 transition-opacity ${sbEnabled ? "opacity-100" : "opacity-40"}`}>
                {entries.map((e, i) => (
                  <div key={i} className="bg-white border border-gray-200 rounded-lg px-2.5 py-2 flex flex-col gap-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-amber-600 font-mono font-medium">{e.code || `${t('bf_scribe_code_prefix')}${i+1}`}</span>
                      <button onClick={() => removeEntry(i)} className="text-gray-200 hover:text-red-400 text-xs leading-none">✕</button>
                    </div>
                    <input value={e.real} onChange={ev => updateEntry(i, "real", ev.target.value)}
                      placeholder={t('scribe_sb_real_ph')}
                      className="w-full text-xs text-gray-700 bg-gray-50 border border-gray-100 rounded px-2 py-1 outline-none focus:border-blue-300 placeholder:text-gray-300" />
                    <input value={e.code} onChange={ev => updateEntry(i, "code", ev.target.value)}
                      placeholder={t('scribe_sb_code_ph')}
                      className="w-full text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded px-2 py-1 outline-none focus:border-amber-300 placeholder:text-gray-300 font-mono" />
                  </div>
                ))}
                <button onClick={addEntry}
                  className="w-full py-1.5 border border-dashed border-gray-200 rounded-lg text-xs text-gray-400 hover:text-gray-600 hover:border-gray-400 transition-colors">
                  {t('scribe_sb_add')}
                </button>
              </div>
            </div>
          )}

          {effectiveLeftTab === "outline" && (
            <div className="flex-1 overflow-y-auto px-2 py-3">
              {outline.length === 0 ? (
                <div className="px-2 text-xs text-gray-400 leading-relaxed">
                  {t('scribe_outline_hint')}
                </div>
              ) : (
                <div className="flex flex-col gap-0.5">
                  {outline.map((h, i) => (
                    <button key={i} onClick={() => scrollToHeading(h.text)}
                      className="w-full text-left text-xs text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded px-2 py-1 transition-colors truncate"
                      style={{ paddingLeft: `${(h.level - 1) * 12 + 8}px` }}>
                      {h.text}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {!isNarrow && effectiveLeftTab === "drive" && (
            host.renderDriveSlot()
          )}
        </aside>
        )}
        {!isNarrow && leftCollapsed && (
          <PanelCollapsedEdge side="left" onExpand={() => setLeftCollapsed(false)} title={t('scribe_tab_outline')} testId="scribe-left-collapsed" className="aiscribe-no-print" />
        )}

        {/* 左拖宽 separator 只在桌面展开态渲(窄屏走全屏覆盖·无拖宽语义) */}
        {!isNarrow && !leftCollapsed && (
        <div
          role="separator"
          aria-label={t('bf_scribe_left_resize_aria')}
          aria-orientation="vertical"
          aria-valuemin={LEFT_PANEL_MIN_WIDTH}
          aria-valuemax={LEFT_PANEL_MAX_WIDTH}
          aria-valuenow={leftPanelWidth}
          onPointerDown={e => startPanelResize('left', e)}
          className={`${editorShell.resizeHandle} aiscribe-no-print`}
          title={t('bf_scribe_left_resize_title')}
        >
          <div className={editorShell.resizeHandleLine} />
          <div className={editorShell.resizeHandleGrip} />
        </div>
        )}

        {/* ── Center: TipTap editor */}
        <div ref={centerColRef} className={`flex flex-col flex-1 min-w-0 overflow-hidden relative ${editorShell.centerCol}`} data-testid="scribe-center">
          <div className="flex flex-col flex-1 min-h-0 overflow-hidden" data-testid="scribe-center-body">
          {/* Formatting toolbar
 工具栏首尾加侧栏 toggle 钮·中段窄屏 7 组合 1 钮下拉·
 通用 input file 放工具栏外避 conditional unmount 丢 ref */}
          <input ref={docImageInputRef} type="file" accept="image/*" multiple className="hidden"
            onChange={e => { if (e.target.files?.length) insertMedia(e.target.files); e.target.value = ''; }} />
          <input ref={docVideoInputRef} type="file" accept="video/mp4,video/webm,video/quicktime,video/x-msvideo" multiple className="hidden"
            onChange={e => { if (e.target.files?.length) insertMedia(e.target.files); e.target.value = ''; }} />
          {/* 🔴台A陆B：音频上传入口陆版不开放·input 干脆不渲染（非只 CSS 藏·彻底不给可交互面）。
 accept 白名单对齐网站上传接口的音频白名单。 */}
          {!isSimplifiedSite() && (
            <input ref={docAudioInputRef} type="file" accept="audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/mp4,audio/m4a,audio/x-m4a,audio/ogg,audio/flac,audio/aac" multiple className="hidden"
              onChange={e => { if (e.target.files?.length) insertMedia(e.target.files); e.target.value = ''; }} />
          )}
          {/* 档案卡片：accept＝云盘上传口同一份白名单（DRIVE_ACCEPT_MIME）·真身判定仍在服务端 */}
          {host.has('fileCard') && (
          <input ref={docFileCardInputRef} type="file" accept={host.fileCardAccept} multiple className="hidden" data-testid="doc-file-card-input"
            onChange={e => { if (e.target.files?.length) insertFileCards(e.target.files); e.target.value = ''; }} />
          )}
          {fileCardPickerOpen && host.renderDrivePicker?.({ onPick: attachDriveFileCards, onClose: () => setFileCardPickerOpen(false) })}
          <div inert={locked} data-testid="scribe-toolbar" className={`flex items-center gap-0.5 px-3 py-1.5 ${editorShell.toolbarBar} shrink-0 flex-wrap aiscribe-no-print relative`}>
            {/* [付费上架·批一] 上架编辑态灰雾覆盖 formatting toolbar */}
            {isListingMode && <div className={editorShell.dimMask} />}
            {isNarrow && (
              <>
                <button type="button" onClick={() => setLeftMobileOpen(true)} title={t('scribe_tab_outline')}
                  className={editorShell.toolbarBtn}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16"/></svg>
                </button>
                <div className="w-px h-4 bg-gray-200 mx-1.5" />
              </>
            )}

            {isNarrow ? (
              <>
                {/* A 段落样式 */}
                <ToolbarDropdown
                  open={openToolGroup === 'A'}
                  onOpenChange={open => setOpenToolGroup(open ? 'A' : null)}
                  trigger={<span className="text-xs">{t('scribe_tb_paragraph')}</span>}
                  triggerTitle={t('scribe_tb_paragraph')}
                  items={[
                    { key: 'p', label: t('scribe_tb_para'), active: editor?.isActive('paragraph'), onSelect: () => editor?.chain().focus().setParagraph().run() },
                    { key: 'h1', label: t('scribe_tb_h1'), active: editor?.isActive('heading', { level: 1 }), onSelect: () => editor?.chain().focus().toggleHeading({ level: 1 }).run() },
                    { key: 'h2', label: t('scribe_tb_h2'), active: editor?.isActive('heading', { level: 2 }), onSelect: () => editor?.chain().focus().toggleHeading({ level: 2 }).run() },
                    { key: 'h3', label: t('scribe_tb_h3'), active: editor?.isActive('heading', { level: 3 }), onSelect: () => editor?.chain().focus().toggleHeading({ level: 3 }).run() },
                    { key: 'h4', label: t('scribe_tb_h4'), active: editor?.isActive('heading', { level: 4 }), onSelect: () => editor?.chain().focus().toggleHeading({ level: 4 }).run() },
                  ]}
                />
                {/* B 文字样式 */}
                <ToolbarDropdown
                  open={openToolGroup === 'B'}
                  onOpenChange={open => setOpenToolGroup(open ? 'B' : null)}
                  trigger={<span className="text-xs">{t('scribe_tb_text_style')}</span>}
                  triggerTitle={t('scribe_tb_text_style')}
                  items={[
                    { key: 'b', label: <span className="font-bold">B</span>, active: editor?.isActive('bold'), onSelect: () => editor?.chain().focus().toggleBold().run() },
                    { key: 'i', label: <span className="italic">I</span>, active: editor?.isActive('italic'), onSelect: () => editor?.chain().focus().toggleItalic().run() },
                    { key: 's', label: <span className="line-through">S</span>, active: editor?.isActive('strike'), onSelect: () => editor?.chain().focus().toggleStrike().run() },
                    { key: 'code', label: <span className="font-mono">{'`'}</span>, active: editor?.isActive('code'), onSelect: () => editor?.chain().focus().toggleCode().run() },
                  ]}
                />
                <FontFamilyDropdown testid="doc-font" triggerClassName="w-[96px]" value={editor?.getAttributes('fontMark').font as string | undefined}
                  onPick={id => { if (!editor) return; const c = editor.chain().focus(); (id ? c.setMark('fontMark', { font: id }) : c.unsetMark('fontMark')).run(); }} />
                {/* C 列表 */}
                <ToolbarDropdown
                  open={openToolGroup === 'C'}
                  onOpenChange={open => setOpenToolGroup(open ? 'C' : null)}
                  trigger={<span className="text-xs">{t('scribe_tb_list')}</span>}
                  triggerTitle={t('scribe_tb_list')}
                  items={[
                    { key: 'ul', label: '• ' + t('bf_scribe_ul'), active: editor?.isActive('bulletList'), onSelect: () => editor?.chain().focus().toggleBulletList().run() },
                    { key: 'ol', label: '1. ' + t('bf_scribe_ol'), active: editor?.isActive('orderedList'), onSelect: () => editor?.chain().focus().toggleOrderedList().run() },
                  ]}
                />
                {/* D 块 */}
                <ToolbarDropdown
                  open={openToolGroup === 'D'}
                  onOpenChange={open => setOpenToolGroup(open ? 'D' : null)}
                  trigger={<span className="text-xs">{t('scribe_tb_block')}</span>}
                  triggerTitle={t('scribe_tb_block')}
                  items={[
                    { key: 'quote', label: t('scribe_tb_quote'), active: editor?.isActive('blockquote'), onSelect: () => editor?.chain().focus().toggleBlockquote().run() },
                    { key: 'code', label: t('scribe_tb_code'), active: editor?.isActive('codeBlock'), onSelect: () => editor?.chain().focus().toggleCodeBlock().run() },
                    { key: 'hr', label: t('scribe_tb_hr'), onSelect: () => editor?.chain().focus().setHorizontalRule().run() },
                  ]}
                />
                {/* E 撤销/重做 保 2 独立 */}
                <ToolBtn label="↩" onClick={() => undoFromHistoryRef.current?.()} />
                <ToolBtn label="↪" onClick={() => redoFromHistoryRef.current?.()} />
                {/* F 美化批 */}
                <ToolbarDropdown
                  open={openToolGroup === 'F'}
                  onOpenChange={open => setOpenToolGroup(open ? 'F' : null)}
                  trigger={<span className="text-xs">{t('scribe_tb_decorate')}</span>}
                  triggerTitle={t('scribe_tb_decorate')}
                  items={[
                    { key: 'math', label: '∑  ' + t('bf_scribe_math'), onSelect: () => editor?.chain().focus().insertContent({
                      type: 'latexBlock', attrs: { latex: 'x^2 + y^2 = z^2' },
                    }).run() },
                    { key: 'toc', label: '≡  ' + t('bf_scribe_toc'), onSelect: () => editor?.chain().focus().insertContent({
                      type: 'tocBlock',
                    }).run() },
                    { key: 'codeb', label: '{ }  ' + t('bf_scribe_code_block'), onSelect: () => editor?.chain().focus().insertContent([
                      { type: 'paragraph', content: [{ type: 'text', text: '```python' }] },
                      { type: 'paragraph', content: [{ type: 'text', text: t('bf_scribe_code_sample') }] },
                      { type: 'paragraph', content: [{ type: 'text', text: '```' }] },
                    ]).run() },
                    { key: 'tip', label: '!  ' + t('bf_scribe_callout'), onSelect: () => editor?.chain().focus().insertContent({
                      type: 'callout', attrs: { tone: 'tip' },
                      content: [{ type: 'paragraph', content: [{ type: 'text', text: t('bf_scribe_callout_placeholder') }] }],
                    }).run() },
                    { key: 'color', label: <span className="flex items-center gap-2"><NeonIcon name="color" className="w-4 h-4" />{t('bf_scribe_color_text')}</span>, onSelect: () => {
                      if (!editor) return;
                      const { from, to } = editor.state.selection;
                      if (from === to) { void alertDialog(t('bf_scribe_color_select_first')); return; }
                      const selected = editor.state.doc.textBetween(from, to, ' ');
                      colorSelRef.current = { from, to, text: selected };
                      setColorPickerOpen(true);
                    } },
                  ]}
                />
                {/* G 插入媒体 */}
                <ToolbarDropdown
                  open={openToolGroup === 'G'}
                  onOpenChange={open => setOpenToolGroup(open ? 'G' : null)}
                  trigger={<span className="text-xs">{t('scribe_tb_media')}</span>}
                  triggerTitle={t('scribe_tb_media')}
                  items={[
                    { key: 'img', label: <span className="flex items-center gap-2"><NeonIcon name="image" className="w-4 h-4" />{t('bf_scribe_insert_image')}</span>, onSelect: () => docImageInputRef.current?.click() },
                    { key: 'vid', label: <span className="flex items-center gap-2"><NeonIcon name="video" className="w-4 h-4" />{t('bf_scribe_insert_video')}</span>, onSelect: () => docVideoInputRef.current?.click() },
                    // 🔴台A陆B：音频入口陆版不出现（isCnRegion 分支）·候语音审核接好另单开闸。
                    ...(!isSimplifiedSite() ? [{ key: 'aud', label: <span className="flex items-center gap-2"><NeonIcon name="music" className="w-4 h-4" />{t('bf_scribe_insert_audio')}</span>, onSelect: () => docAudioInputRef.current?.click() }] : []),
                    // 档案卡片：两条路——从云盘挑／上传新档
                    ...(host.has('fileCard') ? [
                    { key: 'fc-drive', label: <span className="flex items-center gap-2"><PaperclipIcon />{t('scribe_file_card')} · {t('scribe_file_card_from_drive')}</span>, onSelect: () => setFileCardPickerOpen(true) },
                    { key: 'fc-upload', label: <span className="flex items-center gap-2"><PaperclipIcon />{t('scribe_file_card')} · {t('scribe_file_card_upload')}</span>, onSelect: () => docFileCardInputRef.current?.click() },
                    ] : []),
                    // 文字方块：放进画面中间那页的正中（自由组件·不进正文）
                    { key: 'textbox', label: <span className="flex items-center gap-2" data-testid="doc-layer-add-textbox-narrow">▭ {t('doc_layer_textbox')}</span>, onSelect: insertTextBox },
                  ]}
                />
                {/* H 字号 inline 紧凑 3 钮 */}
                <div className="w-px h-4 bg-gray-200 mx-1.5" />
                <ToolBtn label="A−" onClick={() => { if (!paperPref) adjustFontScale(-FONT_SCALE_STEP); }} title={paperPref ? t('scribe_pg_font_fixed') : t('bf_scribe_font_smaller')} />
                <span data-testid="doc-font-scale" className="px-1 text-xs text-gray-500 tabular-nums select-none min-w-[3ch] text-center" title={t('bf_scribe_font_scale')}>
                  {paperPref ? 100 : Math.round(fontScale * 100)}%
                </span>
                <ToolBtn label="A+" onClick={() => { if (!paperPref) adjustFontScale(FONT_SCALE_STEP); }} title={paperPref ? t('scribe_pg_font_fixed') : t('bf_scribe_font_larger')} />
                {/* 纸张分页参考线：字号钮旁·六选一+关闭·title 带「参考」措辞 */}
                <ToolbarDropdown
                  open={openToolGroup === 'paper'}
                  onOpenChange={open => setOpenToolGroup(open ? 'paper' : null)}
                  trigger={<span className={`text-xs${paperPref ? ' text-violet-600 font-medium' : ''}`}>{t('scribe_tb_paper')}</span>}
                  triggerTitle={t('scribe_tb_paper_title')}
                  items={paperDropdownItems}
                />
                <ToolBtn label={t('scribe_tb_page_break')} onClick={() => editor?.chain().focus().setPageBreak().run()} title={t('scribe_tb_page_break_title')} />
              </>
            ) : (
              <>
                {/* 桌面: 全钮平铺(现状一字未改) */}
                {/* Block type */}
                <ToolBtn label={t('scribe_tb_para')} active={editor?.isActive('paragraph')} onClick={() => editor?.chain().focus().setParagraph().run()} />
                <ToolBtn label={t('scribe_tb_h1')} active={editor?.isActive('heading', { level: 1 })} onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()} />
                <ToolBtn label={t('scribe_tb_h2')} active={editor?.isActive('heading', { level: 2 })} onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()} />
                <ToolBtn label={t('scribe_tb_h3')} active={editor?.isActive('heading', { level: 3 })} onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()} />
                <ToolBtn label={t('scribe_tb_h4')} active={editor?.isActive('heading', { level: 4 })} onClick={() => editor?.chain().focus().toggleHeading({ level: 4 }).run()} />
                <div className="w-px h-4 bg-gray-200 mx-1.5" />
                <ToolBtn label="B" active={editor?.isActive('bold')} onClick={() => editor?.chain().focus().toggleBold().run()} />
                <ToolBtn label="I" active={editor?.isActive('italic')} onClick={() => editor?.chain().focus().toggleItalic().run()} />
                <ToolBtn label="S" active={editor?.isActive('strike')} onClick={() => editor?.chain().focus().toggleStrike().run()} />
                <ToolBtn label="`" active={editor?.isActive('code')} onClick={() => editor?.chain().focus().toggleCode().run()} />
                <FontFamilyDropdown testid="doc-font" value={editor?.getAttributes('fontMark').font as string | undefined}
                  onPick={id => { if (!editor) return; const c = editor.chain().focus(); (id ? c.setMark('fontMark', { font: id }) : c.unsetMark('fontMark')).run(); }} />
                <div className="w-px h-4 bg-gray-200 mx-1.5" />
                <ToolBtn label={'• ' + t('bf_scribe_list')} active={editor?.isActive('bulletList')} onClick={() => editor?.chain().focus().toggleBulletList().run()} />
                <OLDropdown editor={editor} />
                <div className="w-px h-4 bg-gray-200 mx-1.5" />
                <ToolBtn label={t('scribe_tb_quote')} active={editor?.isActive('blockquote')} onClick={() => editor?.chain().focus().toggleBlockquote().run()} />
                <ToolBtn label={t('scribe_tb_code')} active={editor?.isActive('codeBlock')} onClick={() => editor?.chain().focus().toggleCodeBlock().run()} />
                <ToolBtn label={t('scribe_tb_hr')} onClick={() => editor?.chain().focus().setHorizontalRule().run()} />
                <div className="w-px h-4 bg-gray-200 mx-1.5" />
                <ToolBtn label="↩" onClick={() => undoFromHistoryRef.current?.()} />
                <ToolBtn label="↪" onClick={() => redoFromHistoryRef.current?.()} />
                <div className="w-px h-4 bg-gray-200 mx-1.5" />
                <ToolBtn label="∑" onClick={() => editor?.chain().focus().insertContent({
                  type: 'latexBlock', attrs: { latex: 'x^2 + y^2 = z^2' },
                }).run()} title={t('bf_scribe_math_title')} />
                <ToolBtn label="≡" onClick={() => editor?.chain().focus().insertContent({
                  type: 'tocBlock',
                }).run()} title={t('bf_scribe_toc_title')} />
                <ToolBtn label="{ }" onClick={() => editor?.chain().focus().insertContent([
                  { type: 'paragraph', content: [{ type: 'text', text: '```python' }] },
                  { type: 'paragraph', content: [{ type: 'text', text: t('bf_scribe_code_sample') }] },
                  { type: 'paragraph', content: [{ type: 'text', text: '```' }] },
                ]).run()} title={t('bf_scribe_code_block_title')} />
                <ToolBtn label="!" onClick={() => editor?.chain().focus().insertContent({
                  type: 'callout', attrs: { tone: 'tip' },
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: t('bf_scribe_callout_placeholder') }] }],
                }).run()} title={t('bf_scribe_callout_title')} />
                <button type="button" title={t('bf_scribe_color_title')}
                  onMouseDown={e => { e.preventDefault();
                    if (!editor) return;
                    const { from, to } = editor.state.selection;
                    if (from === to) { void alertDialog(t('bf_scribe_color_select_first')); return; }
                    const selected = editor.state.doc.textBetween(from, to, ' ');
                    colorSelRef.current = { from, to, text: selected };
                    setColorPickerOpen(true);
                  }}
                  className={editorShell.toolbarBtn}>
                  <NeonIcon name="color" className="w-4 h-4" alt={t('bf_scribe_color_text')} />
                </button>
                {/* 格式刷 */}
                <button type="button"
                  onMouseDown={e => e.preventDefault()}
                  onClick={armFormatPainter}
                  title={painterArmed ? t('bf_doc_painter_armed') : t('bf_doc_painter_idle')}
                  className={`px-2 py-0.5 text-sm rounded-md flex items-center gap-1 ${painterArmed ? 'bg-gray-200 text-gray-900' : 'hover:bg-gray-100 text-gray-600'}`}>
                  🖌
                </button>
                <div className="w-px h-4 bg-gray-200 mx-1.5" />
                {/* 插入圖片 svg → NeonIcon image */}
                <button type="button" onClick={() => docImageInputRef.current?.click()} title={t('bf_scribe_insert_image')}
                  className={editorShell.toolbarBtn}>
                  <NeonIcon name="image" className="w-4 h-4" alt={t('bf_scribe_insert_image')} />
                </button>
                {/* 插入視頻 svg → NeonIcon video */}
                <button type="button" onClick={() => docVideoInputRef.current?.click()} title={t('bf_scribe_insert_video')}
                  className={editorShell.toolbarBtn}>
                  <NeonIcon name="video" className="w-4 h-4" alt={t('bf_scribe_insert_video')} />
                </button>
                {/* 插入音頻：🔴台A陆B·陆版不渲染 */}
                {!isSimplifiedSite() && (
                  <button type="button" onClick={() => docAudioInputRef.current?.click()} title={t('bf_scribe_insert_audio')}
                    className={editorShell.toolbarBtn}>
                    <NeonIcon name="music" className="w-4 h-4" alt={t('bf_scribe_insert_audio')} />
                  </button>
                )}
                {/* 档案卡片：从云盘挑／上传新档 */}
                {host.has('fileCard') && (
                <ToolbarDropdown
                  open={openToolGroup === 'filecard'}
                  onOpenChange={open => setOpenToolGroup(open ? 'filecard' : null)}
                  trigger={<span className="flex items-center gap-1 text-xs" data-testid="doc-file-card-menu"><PaperclipIcon />{t('scribe_file_card')}</span>}
                  triggerTitle={t('scribe_file_card_title')}
                  items={[
                    { key: 'fc-drive', label: t('scribe_file_card_from_drive'), onSelect: () => setFileCardPickerOpen(true) },
                    { key: 'fc-upload', label: t('scribe_file_card_upload'), onSelect: () => docFileCardInputRef.current?.click() },
                  ]}
                />
                )}
                {/* 文字方块：放进画面中间那页的正中（自由组件·可拖·右键层次）；插图片／视频等照旧进正文（右键「改成自由摆放」才变组件） */}
                <button type="button" onClick={insertTextBox} title={t('doc_layer_textbox_tip')} data-testid="doc-layer-add-textbox"
                  className={`${editorShell.toolbarBtn} text-xs`}>▭ {t('doc_layer_textbox')}</button>
                {/* 「选底层组件」：底层有组件才出现（垫在文字底下的平时点不到·不挡打字） */}
                {layerItems.some(it => it.plane === 'below') && (
                  <button type="button" onClick={() => setBelowMode(v => !v)} title={t('doc_layer_below_mode_tip')} data-testid="doc-layer-below-mode"
                    className={`${editorShell.toolbarBtn} text-xs${belowMode ? ' bg-blue-100 text-blue-700' : ''}`}>{t('doc_layer_below_mode')}</button>
                )}
                {/* 字号缩放：A−/百分比/A+·Ctrl+滚轮亦可 */}
                <div className="w-px h-4 bg-gray-200 mx-1.5" />
                <ToolBtn label="A−" onClick={() => { if (!paperPref) adjustFontScale(-FONT_SCALE_STEP); }} title={paperPref ? t('scribe_pg_font_fixed') : t('bf_scribe_font_smaller_ctrl')} />
                <span data-testid="doc-font-scale" className="px-1 text-xs text-gray-500 tabular-nums select-none min-w-[3ch] text-center" title={t('bf_scribe_font_scale')}>
                  {paperPref ? 100 : Math.round(fontScale * 100)}%
                </span>
                <ToolBtn label="A+" onClick={() => { if (!paperPref) adjustFontScale(FONT_SCALE_STEP); }} title={paperPref ? t('scribe_pg_font_fixed') : t('bf_scribe_font_larger_ctrl')} />
                {/* 纸张分页参考线：字号钮旁·六选一+关闭·title 带「参考」措辞 */}
                <div className="w-px h-4 bg-gray-200 mx-1.5" />
                <ToolbarDropdown
                  open={openToolGroup === 'paper'}
                  onOpenChange={open => setOpenToolGroup(open ? 'paper' : null)}
                  trigger={<span className={`text-xs${paperPref ? ' text-violet-600 font-medium' : ''}`}>{t('scribe_tb_paper')}</span>}
                  triggerTitle={t('scribe_tb_paper_title')}
                  items={paperDropdownItems}
                />
                <ToolBtn label={t('scribe_tb_page_break')} onClick={() => editor?.chain().focus().setPageBreak().run()} title={t('scribe_tb_page_break_title')} />
              </>
            )}

            {/* 最右: 桌面收/展右栏 / 窄屏 AI 入口 */}
            <div className="flex-1" />
            {isNarrow && (
              <button type="button" onClick={() => setRightMobileOpen(true)} title={host.chatSlotLabel ?? t('side_chat_pick_role')}
                className={editorShell.toolbarBtn}>
                <NeonIcon name="ai" className="w-5 h-5" alt={host.chatSlotLabel ?? t('side_chat_pick_role')} />
              </button>
            )}
          </div>

          {/* Editor content（attachEditorScroll callback ref = Ctrl+滚轮缩放 handler 挂载容器·不漏渲染时机）
 外裹 relative 层：光洁玻璃罩 absolute 覆盖滚动视口（罩层 pointer-events-none·滚轮穿透→罩期可滚动阅读） */}
          <div className="relative flex-1 min-h-0 flex flex-col">
            {/* 选了纸张 ⇒ 滚动区换灰底、正文排进一张张纸（.doc-paged）；「關閉」⇒ 原连续流（display:contents 包层·零变化）。
 包层恒在（只切 class）⇒ 开关纸张不重挂 EditorContent。select-none 仍只上架态。 */}
            <div ref={attachEditorScroll} className={`flex-1 overflow-y-auto aiscribe-print-body${paperPref ? ' doc-paged-scroll overflow-x-auto px-6 py-6' : ' px-10 pt-8 pb-8'}${isListingMode ? ' relative select-none' : ''}`}>
              {/* 连续流有自由组件时包层改成 relative 块（左上角＝正文栏左上角·纸张原点再往左上一个页边距 continuousGeometry·A4 直式一页接一页）·正文抬 z-index 1 盖住「垫在文字底下」那层；
 没组件＝原样 contents。分页视图：纸叠画到组件最远那页（sheetCount）。 */}
              <div className={paperPref ? 'doc-paged' : (hasLayers ? 'relative doc-layers-flow-host' : 'contents')} data-testid={paperPref ? 'doc-paged' : undefined}
                style={paperPref ? pagedCssVars(paperPref, paperSettings.marginsMm, layerPages) : (hasLayers ? { isolation: 'isolate', minHeight: '100%' } : undefined)}>
                {paperPref && (
                  <PagedSheets paper={paperPref} marginsMm={paperSettings.marginsMm} pageCount={layerPages}
                    pageNumbers={paperSettings.pageNumbers} pageLabel={pagedPageLabel} />
                )}
                {hasLayers && (layerEditable ? (
                  <DocLayersPlane items={layerItems} plane="below" pageCount={layerPages} geometry={layerGeom} docId={docId}
                    selectedIds={layerSel} onSelect={setLayerSel} onChange={changeLayers} active={belowMode}
                    editingId={layerEditingId} onEditingId={setLayerEditingId} liveId={layerLiveId} onLiveId={setLayerLiveId} onToFlow={convertLayerToFlow} />
                ) : <DocLayersStatic items={layerItems} plane="below" geometry={layerGeom} docId={docId} />)}
                {/* --doc-font-scale 设在 .aiscribe-editor 容器上→ globals.css base font-size 整体缩
 （分页视图下 CSS 把它钉回 1：字号＝打印字号·画面＝打印）
 contentDim：罩期机器人内容平滑替换（opacity 过渡·避免整页白闪） */}
                <EditorContent editor={editor} className={`aiscribe-editor min-h-full${paperPref ? ' doc-paged-editor' : ''}`} style={{ '--doc-font-scale': fontScale, '--doc-pb-label': JSON.stringify(t('scribe_tb_page_break')), opacity: contentDim ? 0.5 : 1, transition: 'opacity 260ms ease', ...(!paperPref && hasLayers ? { position: 'relative', zIndex: 1 } : {}) } as CSSProperties} />
                {hasLayers && (layerEditable ? (
                  <DocLayersPlane items={layerItems} plane="above" pageCount={layerPages} geometry={layerGeom} docId={docId}
                    selectedIds={layerSel} onSelect={setLayerSel} onChange={changeLayers} active
                    editingId={layerEditingId} onEditingId={setLayerEditingId} liveId={layerLiveId} onLiveId={setLayerLiveId} onToFlow={convertLayerToFlow} />
                ) : <DocLayersStatic items={layerItems} plane="above" geometry={layerGeom} docId={docId} />)}
              </div>
              {/* 正文媒体右键小选单：「改成自由摆放」 */}
              {flowMenu && (
                <div className={`fixed z-50 ${editorShell.menu} w-40`} data-testid="doc-flow-media-menu"
                  style={{ left: Math.min(flowMenu.x, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 170), top: flowMenu.y }}
                  onPointerDown={(e) => e.stopPropagation()}>
                  <button type="button" className={editorShell.menuItem} data-testid="doc-flow-media-to-free"
                    onClick={() => { const pos = flowMenu.pos; setFlowMenu(null); convertFlowToFree(pos); }}>{t('doc_layer_to_free')}</button>
                </div>
              )}
              {belowMode && (
                <div className="pointer-events-none sticky bottom-3 z-40 flex justify-center" data-testid="doc-layer-below-mode-on">
                  <span className="rounded-full bg-blue-600/90 px-3 py-1 text-xs keep-white shadow">{t('doc_layer_below_mode_on')}</span>
                </div>
              )}
              {/* [付费上架·批一] 可拖拉付费卡点线·上架编辑态才渲 */}
              {isListingMode && (
                host.renderPaywallLine?.({
                  positionPx: paywallPositionPx,
                  onChange: setPaywallPositionPx,
                  scrollContainerRef: editorScrollRef,
                })
              )}
            </div>
            {/* [玻璃罩块B] 罩落在途输入暂存提示（非打断·顶部漂浮）；掀罩后「还原我的修改」条 */}
            {stashNotice === 'stashed' && editingMark && (
              <div className="pointer-events-none absolute inset-x-0 top-3 z-40 flex justify-center px-4">
                <div className="pointer-events-auto max-w-md rounded-lg border border-amber-200 bg-amber-50/95 px-4 py-2 text-xs text-amber-800 shadow-md">
                  {t('bf_scribe_editing_stashed').replace('{name}', editingMark.by)}
                </div>
              </div>
            )}
            {saveConflict && (
              <div className="absolute inset-x-0 top-3 z-50 flex justify-center px-4">
                <div className="flex flex-wrap items-center gap-3 rounded-lg border border-rose-200 bg-white px-4 py-2 text-xs text-gray-700 shadow-md">
                  {/* origin:'live'＝角色改了这份而本页有未保存改动·两钮同一套出路 */}
                  <span data-testid="doc-live-conflict-text">{saveConflict.origin === 'live'
                    ? (language === 'zh-CN' ? `${saveConflict.by || '角色'}改了这份文档`
                      : language === 'en' ? `${saveConflict.by || 'A role'} edited this document`
                      : `${saveConflict.by || '角色'}改了這份文檔`)
                    : (language === 'zh-CN' ? '文档已被外部更新'
                      : language === 'en' ? 'This document was updated elsewhere'
                      : '文檔已被外部更新')}</span>
                  <button type="button" onClick={resolveConflictTakeServer} data-testid="doc-live-conflict-take"
                    className="rounded-md bg-violet-600 px-2.5 py-1 keep-white hover:bg-violet-700">
                    {saveConflict.origin === 'live'
                      ? (language === 'zh-CN' ? '套用' : language === 'en' ? 'Apply' : '套用')
                      : (language === 'zh-CN' ? '载入新版'
                        : language === 'en' ? 'Load new version'
                        : '載入新版')}
                  </button>
                  <button type="button" onClick={resolveConflictKeepMine} data-testid="doc-live-conflict-keep"
                    className="rounded-md border border-gray-300 px-2.5 py-1 text-gray-600 hover:bg-gray-50">
                    {saveConflict.origin === 'live'
                      ? (language === 'zh-CN' ? '保留我的' : language === 'en' ? 'Keep mine' : '保留我的')
                      : (language === 'zh-CN' ? '保留我的并覆盖'
                        : language === 'en' ? 'Keep mine and overwrite'
                        : '保留我的並覆蓋')}
                  </button>
                </div>
              </div>
            )}
            {stashNotice === 'restore' && (
              <div className="absolute inset-x-0 top-3 z-40 flex justify-center px-4">
                <div className="flex items-center gap-3 rounded-lg border border-violet-200 bg-white px-4 py-2 text-xs text-gray-700 shadow-md">
                  <span>{t('bf_scribe_editing_restore_hint')}</span>
                  {stashHasTitle && (
                    <span className="text-gray-500">
                      {language === 'zh-CN' ? '（标题也一并暂存）'
                        : language === 'en' ? '(the title was stashed too)'
                        : '（標題也一併暫存）'}
                    </span>
                  )}
                  <button type="button" onClick={restoreStash}
                    className="rounded-md bg-violet-600 px-2.5 py-1 keep-white hover:bg-violet-700">
                    {t('bf_scribe_editing_restore_btn')}
                  </button>
                  <button type="button" onClick={() => { stashRef.current = null; stashTitleRef.current = null; setStashHasTitle(false); setStashNotice(null); }}
                    className="text-gray-400 hover:text-gray-600">
                    {t('bf_scribe_editing_restore_dismiss')}
                  </button>
                </div>
              </div>
            )}
            {olderStashCount > 0 && (
              <div className={`absolute inset-x-0 ${stashNotice === 'restore' ? 'top-14' : 'top-3'} z-40 flex justify-center px-4`}>
                <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900 shadow-md" data-testid="scribe-older-stash-bar">
                  <span>{t('ai_shield_older_stash').replace('{n}', String(olderStashCount))}</span>
                  <button type="button" data-testid="scribe-older-stash-copy" onClick={() => { void navigator.clipboard?.writeText(olderStashRef.current.join('\n\n────────\n\n')).catch(() => {}); }}
                    className="rounded-md bg-amber-600 px-2.5 py-1 keep-white hover:bg-amber-700">
                    {t('ai_shield_restore_copy')}
                  </button>
                  <button type="button" data-testid="scribe-older-stash-discard" onClick={() => { olderStashRef.current = []; setOlderStashCount(0); }}
                    className="text-amber-700/70 hover:text-amber-900">
                    {t('ai_shield_restore_discard')}
                  </button>
                </div>
              </div>
            )}
          </div>
          </div>
          {host.renderAIShield?.(aiShield, "scribe-ai-shield")}
        </div>

        {/* 右拖宽 separator 只在桌面展开态渲(窄屏走全屏覆盖·无拖宽语义) */}
        {!isNarrow && !rightCollapsed && (
        <div
          role="separator"
          aria-label={t('bf_scribe_right_resize_aria')}
          aria-orientation="vertical"
          aria-valuemin={RIGHT_PANEL_MIN_WIDTH}
          aria-valuemax={RIGHT_PANEL_MAX_WIDTH}
          aria-valuenow={rightPanelWidth}
          onPointerDown={e => startPanelResize('right', e)}
          className={`${editorShell.resizeHandle} aiscribe-no-print`}
          title={t('bf_scribe_right_resize_title')}
        >
          <div className={editorShell.resizeHandleLine} />
          <div className={editorShell.resizeHandleGrip} />
        </div>
        )}

        {/* ── Right: AI panel
 窄屏: fixed inset-0 z-50 全屏覆盖 + 收起钮·
 桌面/折叠: 常显·style width=rightPanelWidth·rightCollapsed=true 整段不渲 */}
        {!isNarrow && rightCollapsed && (
          <PanelCollapsedEdge side="right" onExpand={() => { userTouchedRightCollapseRef.current = true; setRightCollapsed(false); }} title={host.chatSlotLabel ?? t('side_chat_pick_role')} testId="scribe-right-collapsed" className="aiscribe-no-print" />
        )}
        {((isNarrow && rightMobileOpen) || (!isNarrow && !rightCollapsed)) && (
        <div
          style={!isNarrow ? { width: rightPanelWidth } : undefined}
          className={isNarrow
            ? "fixed inset-0 z-50 flex flex-col hp-lavender aiscribe-no-print relative"
            : "shrink-0 flex flex-col aiscribe-no-print relative"}
        >
          {/* [付费上架·批一] 上架编辑态灰雾覆盖右侧 AI 栏 */}
          {isListingMode && <div className="absolute inset-0 bg-gray-500/25 z-40 pointer-events-auto select-none" />}
          {isNarrow && (
            <div className="flex justify-end px-3 py-2 border-b border-black/5">
              <button onClick={() => setRightMobileOpen(false)} className="text-xs text-gray-500 hover:text-gray-800 flex items-center gap-1">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
                </svg>
                {t('scribe_collapse')}
              </button>
            </div>
          )}
          {/* 侧栏对话框：右栏改成三页共用的竖版四钮组件——
 對話／精簡／過程／產物 四页签·标题＝角色名·
 气泡／输入框／建议 chips／模型选／深度思考／联网全搬进组件；输入与附件受控（云盘回纹针@、
 建议 chips 仍从本页 setInstruction／setImages 塞字）。过程折叠仍由本页 renderDocProcess 渲
 （docProcess latch／出错降级／积分归属等页级状态原样保留·未改判据）。 */}
          {host.renderChatSlot({
            // 右栏＝所选角色的对话框（按钮条由角色决定）
            roleWire: { docKind: 'doc', docId, docTitle: title, editorAgentKey, onEditorAgentKeyChange: changeEditorAgent },
            rosterFrom: roleBusyOn ? roleRoster : undefined,
            title: host.chatSlotLabel ?? t('side_chat_pick_role'),
            // 桌面态页头角色名左边那格＝收合箭头；窄屏全屏覆盖态仍留图标
            titleIcon: isNarrow
              ? <NeonIcon name="ai" className="w-4 h-4" alt="" />
              : <PanelCollapseButton side="right" onCollapse={() => { userTouchedRightCollapseRef.current = true; setRightCollapsed(true); }} title={t('scribe_collapse')} testId="scribe-right-collapse" />,
            dense: isNarrow,
          })}
        </div>
        )}
      </div>
      <ColorPicker
        isOpen={colorPickerOpen}
        onClose={() => setColorPickerOpen(false)}
        onConfirm={(color) => {
          const sel = colorSelRef.current;
          if (!sel || !editor) { setColorPickerOpen(false); return; }
          if (sel.text.includes(':color[')) { void alertDialog(t('bf_scribe_unrendered_color_code')); setColorPickerOpen(false); return; }
          editor.chain().focus().setTextSelection({ from: sel.from, to: sel.to }).setMark('colorMark', { color }).run();
          setColorPickerOpen(false);
        }}
      />
    </div>
  );
}

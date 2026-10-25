"use client";
// 云文档真分页·纸张层
//   一张张白纸（页间灰缝）＋页码＋打印用 @page 规格。正文（编辑器或分享页的 markdown）叠在纸上面，
//   分页垫片由 pm-paged-view.ts（编辑器）/ dom-paged-view.ts（分享页）插；本组件只画纸、不碰内容。
//   打印：@media print 把页缝归零（--pg-gap:0）、只印 .doc-paged 这一块、@page 尺寸＝纸张、边距 0（边距已在纸内）。
import { useEffect, useMemo, useState, type CSSProperties, type RefObject } from "react";
import { paginateStaticDom, removeStaticSpacers } from "../core/pagination/dom-paged-view";
import { PAGINATION_TUNING } from "../core/pagination/paginate";
import type { Editor } from "@tiptap/react";
import { pageGeometryPx, paperPageMm, PAGE_GAP_PX, type DocPaperSettings, type DocPaperPref, type PaperMarginsMm } from "../core/paper-size";

export type PagedVars = CSSProperties & Record<`--${string}`, string | number>;

// .doc-paged 容器上的 CSS 变量（纸宽高/边距/页缝/页数）——画面与打印共用同一组数。
export function pagedCssVars(paper: DocPaperPref, marginsMm: PaperMarginsMm, pageCount: number): PagedVars {
  const g = pageGeometryPx(paper, marginsMm);
  return {
    '--pg-w': `${g.pageW}px`,
    '--pg-h': `${g.pageH}px`,
    '--pg-mt': `${g.marginTop}px`,
    '--pg-mb': `${g.marginBottom}px`,
    '--pg-ml': `${g.marginLeft}px`,
    '--pg-mr': `${g.marginRight}px`,
    '--pg-cw': `${g.contentW}px`,
    '--pg-ch': `${g.contentH}px`,
    '--pg-gap': `${PAGE_GAP_PX}px`,
    '--pg-count': Math.max(1, pageCount),
  };
}

// 编辑器：纸张设定 → 告诉 PagedView 扩展几何（关＝null 回连续流）
export function usePagedEditorGeometry(editor: Editor | null, settings: DocPaperSettings): void {
  const { paper, marginsMm } = settings;
  const key = paper ? `${paper}|${marginsMm.top},${marginsMm.bottom},${marginsMm.left},${marginsMm.right}` : 'off';
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    if (!paper) { editor.commands.setPagedGeometry(null); return; }
    const g = pageGeometryPx(paper, marginsMm);
    editor.commands.setPagedGeometry({ pageH: g.pageH, marginTop: g.marginTop, contentH: g.contentH, gap: PAGE_GAP_PX });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, key]);
}

export default function PagedSheets({ paper, marginsMm, pageCount, pageNumbers, pageLabel }: {
  paper: DocPaperPref;
  marginsMm: PaperMarginsMm;
  pageCount: number;
  pageNumbers: boolean;
  pageLabel: (n: number, total: number) => string;
}) {
  const g = useMemo(() => pageGeometryPx(paper, marginsMm), [paper, marginsMm]);
  const mm = paperPageMm(paper);
  const n = Math.max(1, pageCount);
  return (
    <>
      {/* 打印纸张规格＝所选纸型·边距 0（边距已画在纸内·画面与打印同一套） */}
      <style>{`@media print { @page { size: ${mm.widthMm}mm ${mm.heightMm}mm; margin: 0 !important; } }`}</style>
      <div className="doc-pg-sheets" aria-hidden data-testid="doc-pg-sheets" data-page-count={n}>
        {Array.from({ length: n }, (_, i) => (
          <div key={i} className="doc-pg-sheet" data-page={i + 1}
            style={{ top: `calc(${i} * (var(--pg-h) + var(--pg-gap)))` }}>
            {pageNumbers && (
              <span className="doc-pg-pagenum" style={{ top: g.pageH - g.marginBottom / 2 - 8 }}>{pageLabel(i + 1, n)}</span>
            )}
          </div>
        ))}
        {/* 页缝遮罩：盖住溢进灰缝的内容（打印时缝＝0·遮罩不印） */}
        {Array.from({ length: n - 1 }, (_, i) => (
          <div key={`gap${i}`} className="doc-pg-gapcover"
            style={{ top: `calc(${i + 1} * var(--pg-h) + ${i} * var(--pg-gap))` }} />
        ))}
      </div>
    </>
  );
}

// 分页视图的「下载 PDF／列印」：浏览器列印对话框（可选「另存为 PDF」）。标题临时换成文档名 ⇒ 另存档名默认＝文档名。
//   printPage＝宿主的列印法（登入版：桌面版走桌面壳的列印；缺省＝window.print）。
export function printPagedDocument(title: string, printPage: (win: Window) => unknown = (win) => win.print()): void {
  if (typeof window === 'undefined') return;
  const prev = document.title;
  document.title = title;
  const restore = () => { document.title = prev; window.removeEventListener('afterprint', restore); };
  window.addEventListener('afterprint', restore);
  printPage(window);
}

// 分享页／只读页（静态 DOM）：内容容器 ref ＋ 纸张设定 ⇒ 页数。内容变、图片载入、字体就绪时重排（debounce 同编辑器节奏常数）。
export function useStaticPagedView(ref: RefObject<HTMLElement | null>, paper: DocPaperPref | null, marginsMm: PaperMarginsMm, contentKey: unknown): number {
  const [count, setCount] = useState(1);
  const mKey = `${marginsMm.top},${marginsMm.bottom},${marginsMm.left},${marginsMm.right}`;
  useEffect(() => {
    const root = ref.current;
    if (!root || !paper) return;
    const g = pageGeometryPx(paper, marginsMm);
    let timer: ReturnType<typeof setTimeout> | null = null;
    let alive = true;
    const run = () => { timer = null; if (alive && root.isConnected) setCount(paginateStaticDom(root, { pageH: g.pageH, marginTop: g.marginTop, contentH: g.contentH, gap: PAGE_GAP_PX })); };
    const schedule = () => { if (timer) clearTimeout(timer); timer = setTimeout(run, PAGINATION_TUNING.debounceMs); };
    run();
    const onLoad = () => schedule();
    root.addEventListener('load', onLoad, true);
    void document.fonts?.ready.then(() => { if (alive) schedule(); });
    return () => { alive = false; if (timer) clearTimeout(timer); root.removeEventListener('load', onLoad, true); removeStaticSpacers(root); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, paper, mKey, contentKey]);
  return paper ? count : 1;
}

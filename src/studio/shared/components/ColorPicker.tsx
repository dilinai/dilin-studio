"use client";
// ColorPicker · Word 式取色器
//
// 需求：Word 式渐变色盘选无限色 + 常用色块 + RGBA 数值 + 透明度
//
// 设计：
//   - HSV canvas（SV plane·按 Hue 渲色）+ 纵 Hue 滑块 + 横 Alpha 滑块 + RGBA 数值输入 + hex 输入 + 8 常用色块
//   - 输出：6 老色 swatch → 命名色（red/orange/yellow/green/blue/purple·向后兼容·SAFE_COLOR_RE 已认）
//           其它 → #hex8（RRGGBBAA·含 alpha·SAFE_COLOR_RE 已认 #hex 3-8 位）
//   - 安全：输出前必过 SAFE_COLOR_RE·防绕过塞任意串进 `:color[X]{}`
//   - 零依赖
//
// 复用方：网站云文档页（菜单 + toolbar 两处）、画布全屏文档编辑
import { useEffect, useRef, useState } from 'react';
import { useStudioT } from '../StudioT';
import { alertDialog } from '../dialog-store'   // 浏览器原生 confirm／alert／prompt 换自家弹窗
/** 三色档（字色/底色/框色·font 由字体下拉管）——与网站 lib/directive-md-html 的 RichType 同形（结构型别·两边可互传）。 */
export type RichType = 'color' | 'bg' | 'box' | 'font';

// 同 MarkdownView.tsx:27 SAFE_COLOR_RE 严限色名（命名色 / #hex 3-8 位）·端到端守 CSS 注入
const SAFE_COLOR_RE = /^([a-z][a-z0-9]{1,32}|#[0-9a-f]{3,8})$/i;

// 8 常用色（6 老色 + 黑 + 白·向后兼容老命名色文档）
const SWATCHES: { value: string; labelKey: string }[] = [
  { value: 'red', labelKey: 'bf_colorpicker_red' },
  { value: 'orange', labelKey: 'bf_colorpicker_orange' },
  { value: 'yellow', labelKey: 'bf_colorpicker_yellow' },
  { value: 'green', labelKey: 'bf_colorpicker_green' },
  { value: 'blue', labelKey: 'bf_colorpicker_blue' },
  { value: 'purple', labelKey: 'bf_colorpicker_purple' },
  { value: '#000000', labelKey: 'bf_colorpicker_black' },
  { value: '#ffffff', labelKey: 'bf_colorpicker_white' },
];

// ── HSV ↔ RGB 转换（标准算法·h:0-360 / s,v,a:0-1 / r,g,b:0-255）──
function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60)      { r = c; g = x; b = 0; }
  else if (h < 120){ r = x; g = c; b = 0; }
  else if (h < 180){ r = 0; g = c; b = x; }
  else if (h < 240){ r = 0; g = x; b = c; }
  else if (h < 300){ r = x; g = 0; b = c; }
  else             { r = c; g = 0; b = x; }
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}
function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const v = max;
  const d = max - min;
  const s = max === 0 ? 0 : d / max;
  let h = 0;
  if (d !== 0) {
    if (max === r)      h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else                h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, s, v];
}
function toHex2(n: number): string { return Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0'); }
function toHex8(r: number, g: number, b: number, a: number): string {
  return `#${toHex2(r)}${toHex2(g)}${toHex2(b)}${toHex2(Math.round(a * 255))}`;
}

interface Props {
  isOpen: boolean;
  /** popover 锚定位置（fixed left/top 像素）·缺省 = 居中 */
  anchorPos?: { x: number; y: number };
  onClose: () => void;
  /** 输出：命名色（swatch 6 老色）或 #hex8（其它）·已过 SAFE_COLOR_RE。kind=用户选的档（字色/底色/框色）·缺省 'color' */
  onConfirm: (color: string, kind: RichType) => void;
  /** 开三档（字色/底色/框色）选择条·缺省 false（ai-scribe 仍纯字色） */
  enableKinds?: boolean;
}

export function ColorPicker({ isOpen, anchorPos, onClose, onConfirm, enableKinds }: Props) {
  const t = useStudioT();
  const [hue, setHue] = useState(0);
  const [sat, setSat] = useState(1);
  const [val, setVal] = useState(1);
  const [alpha, setAlpha] = useState(1);
  const [hexInput, setHexInput] = useState('');
  // 三档：字色 color / 底色 bg / 框色 box（仅 enableKinds 时显档条·否则恒 color）
  const [kind, setKind] = useState<RichType>('color');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const draggingRef = useRef(false);

  const [r, g, b] = hsvToRgb(hue, sat, val);
  const hex8 = toHex8(r, g, b, alpha);

  // hexInput sync from state（state 变动同步 hex 显示）
  useEffect(() => { if (isOpen) setHexInput(hex8); }, [hex8, isOpen]);

  // SV plane 渲（按 hue 整面重渲·ImageData 批写比 fillRect 1x1 快 50+ 倍）
  useEffect(() => {
    if (!isOpen) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width, h = canvas.height;
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const s = x / (w - 1);
        const v = 1 - y / (h - 1);
        const [rr, gg, bb] = hsvToRgb(hue, s, v);
        const idx = (y * w + x) * 4;
        img.data[idx] = rr; img.data[idx + 1] = gg; img.data[idx + 2] = bb; img.data[idx + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [hue, isOpen]);

  // 关 popover 时重置（下次打开干净态）
  useEffect(() => {
    if (!isOpen) {
      setHue(0); setSat(1); setVal(1); setAlpha(1);
      setKind('color');
      draggingRef.current = false;
    }
  }, [isOpen]);

  // 切档默认透明度：底色档默认 40% 马克笔感(Q4)·字色/框色档默认不透明。用户仍可手动调 alpha 滑块覆盖。
  const switchKind = (k: RichType) => {
    setKind(k);
    setAlpha(k === 'bg' ? 0.4 : 1);
  };

  const onCanvasPos = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width - 1, e.clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height - 1, e.clientY - rect.top));
    setSat(x / (rect.width - 1));
    setVal(1 - y / (rect.height - 1));
  };

  const onHexCommit = () => {
    const raw = hexInput.trim().toLowerCase();
    const v = raw.startsWith('#') ? raw.slice(1) : raw;
    if (/^[0-9a-f]{6}$/.test(v)) {
      const rr = parseInt(v.slice(0, 2), 16);
      const gg = parseInt(v.slice(2, 4), 16);
      const bb = parseInt(v.slice(4, 6), 16);
      const [hh, ss, vv] = rgbToHsv(rr, gg, bb);
      setHue(hh); setSat(ss); setVal(vv); setAlpha(1);
    } else if (/^[0-9a-f]{8}$/.test(v)) {
      const rr = parseInt(v.slice(0, 2), 16);
      const gg = parseInt(v.slice(2, 4), 16);
      const bb = parseInt(v.slice(4, 6), 16);
      const aa = parseInt(v.slice(6, 8), 16) / 255;
      const [hh, ss, vv] = rgbToHsv(rr, gg, bb);
      setHue(hh); setSat(ss); setVal(vv); setAlpha(aa);
    } else {
      setHexInput(hex8); // 无效输入 revert
    }
  };

  const updateRgb = (nr: number, ng: number, nb: number) => {
    const [hh, ss, vv] = rgbToHsv(nr, ng, nb);
    setHue(hh); setSat(ss); setVal(vv);
  };

  // 安全输出：必过 SAFE_COLOR_RE（防 hex 输入栏被攒入非法字符 / 防绕过）。kind=当前档
  const safeConfirm = (color: string) => {
    if (!SAFE_COLOR_RE.test(color)) {
      void alertDialog(t('cp_invalid_color'));
      return;
    }
    onConfirm(color, kind);
  };

  if (!isOpen) return null;

  // popover 位置（fixed·跟随鼠标·右下侧避免遮 toolbar）
  const containerStyle: React.CSSProperties = anchorPos
    ? { position: 'fixed', left: anchorPos.x, top: anchorPos.y, zIndex: 9999 }
    : { position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', zIndex: 9999 };

  return (
    <>
      {/* 遮罩·点 close 不 confirm */}
      <div
        className="fixed inset-0 z-[9998]"
        onMouseDown={onClose}
      />
      <div
        style={containerStyle}
        className="bg-white border border-gray-200 rounded-lg shadow-xl p-3 select-none"
        onMouseDown={e => e.stopPropagation()}
        role="dialog"
        aria-label={t('cp_aria_picker')}
      >
        {/* 三档选择（字色/底色/框色）·仅 enableKinds 显·切档默认透明度(底色 40% 马克笔) */}
        {enableKinds && (
          <div className="flex gap-1 mb-2 p-0.5 bg-gray-100 rounded-md">
            {([
              { k: 'color' as RichType, label: t('cp_kind_text') },
              { k: 'bg' as RichType,    label: t('cp_kind_bg') },
              { k: 'box' as RichType,   label: t('cp_kind_box') },
            ]).map(({ k, label }) => (
              <button
                key={k}
                type="button"
                onClick={() => switchKind(k)}
                className={`flex-1 px-2 py-1 text-xs rounded transition ${kind === k ? 'bg-white text-gray-800 shadow-sm font-medium' : 'text-gray-500 hover:text-gray-700'}`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        {/* SV plane + Hue 滑块 */}
        <div className="flex gap-2">
          <div className="relative">
            <canvas
              ref={canvasRef}
              width={180}
              height={140}
              className="cursor-crosshair rounded border border-gray-200 block"
              onMouseDown={e => { draggingRef.current = true; onCanvasPos(e); }}
              onMouseMove={e => { if (draggingRef.current) onCanvasPos(e); }}
              onMouseUp={() => { draggingRef.current = false; }}
              onMouseLeave={() => { draggingRef.current = false; }}
            />
            {/* SV 当前位置十字标 */}
            <div
              className="absolute pointer-events-none w-3 h-3 rounded-full border-2 border-white shadow"
              style={{
                left: sat * 180 - 6,
                top: (1 - val) * 140 - 6,
                background: `rgb(${r},${g},${b})`,
              }}
            />
          </div>
          {/* 纵 Hue 滑块（rainbow 渐变背景·range input 透明叠上） */}
          <div
            className="relative w-4 h-[140px] rounded"
            style={{ background: 'linear-gradient(to bottom, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)' }}
            onMouseDown={e => {
              const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
              const move = (ev: MouseEvent) => {
                const y = Math.max(0, Math.min(rect.height, ev.clientY - rect.top));
                setHue((y / rect.height) * 360);
              };
              move(e.nativeEvent);
              const up = () => {
                window.removeEventListener('mousemove', move);
                window.removeEventListener('mouseup', up);
              };
              window.addEventListener('mousemove', move);
              window.addEventListener('mouseup', up);
            }}
          >
            <div
              className="absolute pointer-events-none w-[18px] h-[3px] bg-white shadow border border-gray-700 -left-px"
              style={{ top: (hue / 360) * 140 - 1.5 }}
            />
          </div>
        </div>

        {/* Alpha 滑块（checker 底 + 当前色 gradient） */}
        <div className="mt-2">
          <div
            className="relative h-3 rounded"
            style={{
              background: `
                linear-gradient(to right, rgba(${r},${g},${b},0), rgba(${r},${g},${b},1)),
                repeating-conic-gradient(#ccc 0% 25%, #fff 0% 50%) 50% / 8px 8px
              `,
              backgroundBlendMode: 'normal, normal',
            }}
            onMouseDown={e => {
              const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
              const move = (ev: MouseEvent) => {
                const x = Math.max(0, Math.min(rect.width, ev.clientX - rect.left));
                setAlpha(x / rect.width);
              };
              move(e.nativeEvent);
              const up = () => {
                window.removeEventListener('mousemove', move);
                window.removeEventListener('mouseup', up);
              };
              window.addEventListener('mousemove', move);
              window.addEventListener('mouseup', up);
            }}
          >
            <div
              className="absolute pointer-events-none h-4 w-[3px] bg-white shadow border border-gray-700 -top-0.5"
              style={{ left: alpha * 100 + '%', transform: 'translateX(-1.5px)' }}
            />
          </div>
          <div className="text-[10px] text-gray-500 text-right mt-0.5">α {Math.round(alpha * 100)}%</div>
        </div>

        {/* RGBA 数值 + Hex 输入 */}
        <div className="grid grid-cols-4 gap-1 mt-2">
          <NumIn label="R" value={r} max={255} onChange={v => updateRgb(v, g, b)} />
          <NumIn label="G" value={g} max={255} onChange={v => updateRgb(r, v, b)} />
          <NumIn label="B" value={b} max={255} onChange={v => updateRgb(r, g, v)} />
          <NumIn label="A" value={Math.round(alpha * 100)} max={100} onChange={v => setAlpha(v / 100)} suffix="%" />
        </div>
        <input
          type="text"
          value={hexInput}
          onChange={e => setHexInput(e.target.value)}
          onBlur={onHexCommit}
          onKeyDown={e => { if (e.key === 'Enter') { onHexCommit(); (e.target as HTMLInputElement).blur(); } }}
          placeholder="#RRGGBB(AA)"
          className="w-full mt-2 px-2 py-1 text-xs font-mono border border-gray-200 rounded focus:border-blue-400 focus:outline-none"
        />

        {/* 常用色块（6 老色 + 黑白·点了直接 confirm 命名色·向后兼容） */}
        <div className="mt-2">
          <div className="text-[10px] text-gray-500 mb-1">{t('cp_common_colors')}</div>
          <div className="grid grid-cols-8 gap-1">
            {SWATCHES.map(c => (
              <button
                key={c.value}
                type="button"
                onClick={() => safeConfirm(c.value)}
                title={t(c.labelKey)}
                className="w-6 h-6 rounded border border-gray-200 hover:ring-2 hover:ring-blue-300 transition"
                style={{ background: c.value }}
              />
            ))}
          </div>
        </div>

        {/* 当前色预览 + 取消/确定 */}
        <div className="mt-3 flex items-center gap-2">
          <div
            className="w-8 h-8 rounded border border-gray-300 shrink-0"
            style={{
              background: `
                linear-gradient(${hex8}, ${hex8}),
                repeating-conic-gradient(#ccc 0% 25%, #fff 0% 50%) 50% / 6px 6px
              `,
              backgroundBlendMode: 'normal, normal',
            }}
          />
          <span className="text-[10px] font-mono text-gray-500 flex-1 truncate">{hex8}</span>
          <button
            type="button"
            onClick={onClose}
            className="px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 rounded"
          >
            {t('cancel')}
          </button>
          <button
            type="button"
            onClick={() => safeConfirm(hex8)}
            className="px-3 py-1 text-xs bg-blue-500 keep-white rounded hover:bg-blue-600"
          >
            {t('confirm')}
          </button>
        </div>
      </div>
    </>
  );
}

function NumIn({ label, value, max, onChange, suffix }: { label: string; value: number; max: number; onChange: (v: number) => void; suffix?: string }) {
  return (
    <label className="flex items-center gap-0.5 text-xs">
      <span className="text-gray-500 w-3">{label}</span>
      <input
        type="number"
        min={0}
        max={max}
        value={value}
        onChange={e => onChange(Math.max(0, Math.min(max, Number(e.target.value) || 0)))}
        className="w-full min-w-0 px-1 py-0.5 border border-gray-200 rounded text-xs focus:border-blue-400 focus:outline-none"
      />
      {suffix && <span className="text-gray-400 text-[10px]">{suffix}</span>}
    </label>
  );
}

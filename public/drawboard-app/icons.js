/* 堤麟画板 · 工具栏图示库（照 Photoshop 2020 / Illustrator 2020 左侧工具栏截图自画的 SVG 线图）
   来源截图：参考/PS-AI工具栏截图/（截·PS 21.2、AI 24.3 简中介面）
   每个图示 24×24、描边用 currentColor，所以按钮变色图示跟着变。
   Icons.svg(id) 回整段 <svg>；缺的 id 回一个问号方块，免得整条工具栏挂掉。 */

const Icons = (() => {
  const P = d => `<path d="${d}"/>`;
  const F = d => `<path d="${d}" fill="currentColor" stroke="none"/>`;
  const D = d => `<path d="${d}" stroke-dasharray="2 1.6"/>`;
  const C = (x, y, r, f) => `<circle cx="${x}" cy="${y}" r="${r}"${f ? ' fill="currentColor" stroke="none"' : ''}/>`;
  const R = (x, y, w, h, rx) => `<rect x="${x}" y="${y}" width="${w}" height="${h}"${rx ? ` rx="${rx}"` : ''}/>`;
  const E = (x, y, rx, ry, dash) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}"${dash ? ' stroke-dasharray="2 1.6"' : ''}/>`;
  const T = (x, y, s, size, bold) => `<text x="${x}" y="${y}" font-size="${size}" font-family="Georgia,serif"${bold ? ' font-weight="bold"' : ''} fill="currentColor" stroke="none" text-anchor="middle">${s}</text>`;
  const plus = P('M3.5 5h5M6 2.5v5');                       // 左上角小「+」
  const minus = P('M3.5 5h5');                              // 左上角小「−」
  const spark = P('M18 2v4M16 4h4M21 8v2M20 9h2');          // 右上角星光
  const arrowF = F('M6 3l12 10.5h-7.2L7.5 21z');           // 实心箭头（PS 路径选择／AI 直接选择）
  const arrowH = P('M6 3l12 10.5h-7.2L7.5 21z');           // 空心箭头（PS 直接选择／AI 选择）
  const pen = P('M4 20l3-8.5L16 3l5 5-8.5 9z') + P('M7 11.5l5.5 5.5') + C(13.5, 10.5, 1.3);
  const brush = P('M14.5 3.5l6 6-8 8-6-6z') + P('M6.5 11.5c-3 1-4.5 4-4.5 9 5 0 8-1.5 9-4.5');
  const pencil = P('M4 20l1-4L16 5l3 3L8 19z') + P('M14 7l3 3') + P('M4 20l4-1');
  const lasso = P('M4 10.5c0-3.3 3.6-6 8-6s8 2.7 8 6-3.6 6-8 6c-1.2 0-2.3-.2-3.3-.5') + P('M8.5 16c-1.5 1-1.5 3 .5 5');
  const stamp = P('M9.5 3h5l-1 6h1.5a4 4 0 0 1 4 4v1h-14v-1a4 4 0 0 1 4-4h1.5z') + P('M6 17h12v3H6z');
  const eraser = P('M15.5 3.5l5 5L10 19H6l-3-3z') + P('M9.5 9.5l5 5') + P('M4 21h17');
  const hand = P('M7 11.5V5.5a1.5 1.5 0 0 1 3 0v5M10 10.5V3.5a1.5 1.5 0 0 1 3 0v7M13 10.5V5a1.5 1.5 0 0 1 3 0v6M16 11V8a1.5 1.5 0 0 1 3 0v6.5a6.5 6.5 0 0 1-6.5 6.5h-.8a6 6 0 0 1-5-2.7L3.6 13.6a1.4 1.4 0 0 1 2.3-1.6L7 13.5');
  const zoom = C(10, 10, 6) + P('M14.5 14.5L21 21');
  const grad = R(3.5, 6, 17, 12) + F('M3.5 6h5v12h-5z') + `<path d="M8.5 6h4v12h-4z" fill="currentColor" stroke="none" opacity=".55"/>` + `<path d="M12.5 6h4v12h-4z" fill="currentColor" stroke="none" opacity=".25"/>`;
  const bucket = P('M3 12l8-8 8 8-8 8z') + P('M19.5 14c1.5 2 2 3 2 4a2 2 0 0 1-4 0c0-1 .5-2 2-4z') + P('M7.5 7.5l-2-3');
  const typeT = F('M5 4h14v4h-5v12h-4V8H5z');
  const dashT = D('M5 4h14v4h-5v12h-4V8H5z');
  const crop = P('M7 2.5v14.5h14.5M2.5 7h14.5v14.5');
  const knife = P('M3.5 20.5l10-10 4 4-5 5h-5z') + P('M13.5 10.5l4-4 4 4-4 4');
  const slice = P('M3.5 20.5l11-11 3 3-11 11z') + P('M14.5 9.5l3-3 3 3-3 3');
  const dropper = P('M3 21l1.5-4.5L15 6l3 3L7.5 19.5z') + P('M12.5 8.5l3 3') + P('M17 4l1-1a1.6 1.6 0 0 1 3 3l-1 1');
  const spray = R(8, 8.5, 8, 12.5, 1) + P('M10 8.5V5h4v3.5') + C(4, 4, .9, 1) + C(6.5, 7, .9, 1) + C(3, 8.5, .9, 1);
  const arc = P('M4 20A16 16 0 0 1 20 4');
  const star5 = P('M12 3l2.6 5.8 6.4.6-4.8 4.2 1.4 6.2L12 16.6 6.4 19.8l1.4-6.2L3 9.4l6.4-.6z');
  const spiral = P('M12 12a1 1 0 0 1 1 1 2 2 0 0 1-2 2 3 3 0 0 1-3-3 4 4 0 0 1 4-4 5.5 5.5 0 0 1 5.5 5.5A6.5 6.5 0 0 1 11 20a8 8 0 0 1-8-8');
  const square2 = R(4, 8.5, 11, 11) + F('M9 4h11v11h-5V9H9z');
  const bars = (a, b, c) => R(4.5, 20 - a, 4, a) + R(10, 20 - b, 4, b) + R(15.5, 20 - c, 4, c) + P('M3 20.5h18');
  const hbars = (a, b, c) => R(4, 4.5, a, 4) + R(4, 10, b, 4) + R(4, 15.5, c, 4) + P('M3.5 3v18');
  const pin = P('M9 3h6l-1 6.5 3 3H7l3-3z') + P('M12 12.5V21');
  const symbolBase = C(7, 15, 3) + C(15, 15, 3) + C(11, 8, 3);

  const I = {
    /* ── 共用／选择 ── */
    'move': P('M12 3v18M3 12h18') + P('M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3'),
    'artboard': R(7, 7, 13, 13) + P('M3 7h4M7 3v4'),
    'marquee-rect': D('M4 5h16v14H4z'),
    'marquee-ellipse': E(12, 12, 8.5, 6.5, true),
    'marquee-row': D('M3 10.5h18M3 13.5h18'),
    'marquee-col': D('M10.5 3v18M13.5 3v18'),
    'lasso': lasso,
    'lasso-poly': P('M5 7.5l8-3.5 6.5 6-5 9-9-4z') + P('M9 15l-1.5 5.5'),
    'lasso-magnetic': P('M5 7.5l8-3.5 6.5 6-5 9-9-4z') + P('M8 14a4 4 0 0 0 8 0') + P('M8 14v-2M16 14v-2'),
    'object-select': D('M3.5 3.5h12v12h-12z') + F('M12 12l8.5 3.3-3.3 1.2-1.2 3.3z'),
    'quick-select': E(11, 12, 7, 7, true) + P('M15.5 8.5l5-5') + P('M13.5 10.5l2-2'),
    'magic-wand': P('M4 20L14 10') + P('M16 2v4M14 4h4M20 8v3M18.5 9.5h3M11 8l2 2M19 4l1-1'),
    'crop': crop,
    'crop-perspective': P('M8 4L5.5 20h13L16 4z') + P('M6.5 9.5h11M6 15h12'),
    'slice': slice,
    'slice-select': slice + F('M3 3l5.5 2.2-2.2 1.1-1.1 2.2z'),
    'frame': R(3.5, 3.5, 17, 17) + P('M3.5 3.5l17 17M20.5 3.5l-17 17'),
    'eyedropper': dropper,
    'eyedropper-3d': dropper + P('M17 15l3 1.5v3L17 21l-3-1.5v-3z'),
    'color-sampler': dropper + C(18, 17, 2.5) + P('M18 13v2M18 19v2M14 17h2M20 17h2'),
    'ruler': P('M3 17L17 3l4 4L7 21z') + P('M7 11l2 2M10 8l2 2M13 5l2 2'),
    'note': R(4, 4, 16, 13, 1.5) + P('M8 9h8M8 12.5h5') + P('M9 17v4l3.5-4'),
    'count': T(12, 16.5, '123', 10, true),
    'heal-spot': P('M5.5 13l7.5-7.5 5.5 5.5-7.5 7.5z') + C(11, 10, .7, 1) + C(13, 12, .7, 1) + C(12, 13.5, .7, 1) + E(12, 12, 9.5, 9.5, true),
    'heal-brush': P('M5.5 13l7.5-7.5 5.5 5.5-7.5 7.5z') + P('M7.5 11l-2 2M13.5 17l-2 2M8.5 10l1-1M14.5 16l1-1') + C(11, 10, .7, 1) + C(13, 12, .7, 1),
    'patch': D('M5 7h14v10H5z') + P('M8.5 7v10M12 7v10M15.5 7v10'),
    'content-move': P('M3 5l6 7-6 7M21 5l-6 7 6 7') + P('M9 12h6'),
    'red-eye': C(14, 13.5, 5.5) + C(14, 13.5, 2, 1) + P('M5 4v6M2 7h6'),
    /* ── 画 ── */
    'brush': brush,
    'pencil': pencil,
    'color-replace': brush + R(3, 3, 5, 5) + P('M8 5.5h3l-1-1M11 5.5l-1 1'),
    'mixer-brush': brush + P('M5 3c1.5 2 2.5 3.5 2.5 4.5a2.5 2.5 0 0 1-5 0C2.5 6.5 3.5 5 5 3z'),
    'clone-stamp': stamp,
    'pattern-stamp': stamp + F('M3 3h2.5v2.5H3zM5.5 5.5H8V8H5.5z'),
    'history-brush': brush + P('M3 9a6 6 0 1 1 1.8 4.2') + P('M3 5v4h4'),
    'art-history-brush': brush + P('M3 9a6 6 0 1 1 1.8 4.2') + P('M3 5v4h4') + P('M7 8c1 1 2 1 3 0'),
    'eraser': eraser,
    'bg-eraser': eraser + C(5, 5, .8, 1) + C(8, 3.5, .8, 1) + C(3, 8.5, .8, 1) + P('M3 4l2-1M7 7l1.5-1.5'),
    'magic-eraser': eraser + spark,
    'gradient': grad,
    'bucket': bucket,
    'drop-3d': bucket + P('M15 15l3 1.5v3L15 21l-3-1.5v-3z'),
    'blur': P('M12 3c3.5 4.5 6.5 7.5 6.5 11a6.5 6.5 0 0 1-13 0C5.5 10.5 8.5 7.5 12 3z'),
    'sharpen': P('M12 3l7.5 17h-15z'),
    'smudge': P('M8 20.5v-6.5l-2.5-3 2-1 2.5 2.5V5a1.6 1.6 0 0 1 3.2 0v7l5 1.5v7z'),
    'dodge': C(10, 10, 6) + P('M14.5 14.5L21 21') + C(10, 10, 2.5, 1),
    'burn': P('M3.5 12c3-5.5 10.5-5.5 13.5 0 1 2-1 4.5-3 4.5H6.5c-2 0-4-2.5-3-4.5z') + C(12, 11, 2.2),
    'sponge': C(12, 12, 8.5) + C(9, 10, 1.2) + C(14.5, 9, 1.2) + C(13.5, 14.5, 1.2) + C(8.5, 15, 1.2),
    /* ── 钢笔家族 ── */
    'pen': pen,
    'pen-freeform': pen + D('M2 6c2-3 4-3 6 0'),
    'pen-curvature': pen + P('M2.5 21.5c1.5-6 4-9 7.5-10.5'),
    'curvature': pen + P('M2.5 21.5c1.5-6 4-9 7.5-10.5'),
    'pen-add': pen + plus,
    'pen-del': pen + minus,
    'convert-point': P('M6 18.5V5.5L18.5 18'),
    'anchor-point': P('M6 18.5V5.5L18.5 18'),
    /* ── 文字 ── */
    'type-h': typeT,
    'type-v': F('M8 4h12v4h-4v12h-4V8H8z') + P('M4 4v13M2.5 15l1.5 2.5L5.5 15'),
    'type-mask-h': dashT,
    'type-mask-v': D('M8 4h12v4h-4v12h-4V8H8z') + P('M4 4v13M2.5 15l1.5 2.5L5.5 15'),
    'type-area': R(3.5, 3.5, 17, 17) + F('M7 7h10v3h-3.5v8h-3v-8H7z'),
    'type-path': P('M2.5 15.5c3-7 6.5-7 9.5 0s6.5 7 9.5 0') + F('M8.5 4h7v2.5H13V11h-2V6.5H8.5z'),
    'type-v-area': R(3.5, 3.5, 17, 17) + F('M9 7h9v3h-3v8h-3v-8H9z') + P('M6 7v8M5 13.5l1 1.5 1-1.5'),
    'type-v-path': P('M8 2.5c-5 3-5 7 0 10s5 7 0 10') + F('M12 8h8v2.5h-2.8V16h-2.4v-5.5H12z'),
    'touch-type': R(4, 4, 16, 16) + F('M8 7h8v3h-2.5v8h-3v-8H8z') + R(2.5, 2.5, 3, 3) + R(18.5, 2.5, 3, 3) + R(2.5, 18.5, 3, 3) + R(18.5, 18.5, 3, 3),
    /* ── 形状 ── */
    'path-select': arrowF,
    'direct-select': arrowH,
    'select': arrowH,
    'select-direct-ai': arrowF,
    'group-select': arrowF + plus,
    'lasso-ai': P('M4 10.5c0-3.3 3.6-6 8-6s8 2.7 8 6-3.6 6-8 6c-1.2 0-2.3-.2-3.3-.5') + F('M11 11l8 3-3 1.2-1.2 3z'),
    'rect': R(4, 5, 16, 14),
    'rounded-rect': R(4, 5, 16, 14, 4),
    'ellipse': E(12, 12, 8.5, 7),
    'polygon': P('M12 3l8.5 6.2-3.2 10H6.7L3.5 9.2z'),
    'star': star5,
    'line': P('M4 20L20 4'),
    'line-segment': P('M4 20L20 4'),
    'custom-shape': P('M8 3h3.5v2.5a1.8 1.8 0 0 0 3.6 0V3H19v4h-2.5a1.8 1.8 0 0 0 0 3.6H19v4h-4v2.5a1.8 1.8 0 0 1-3.6 0V14.6H8v-4h2.5a1.8 1.8 0 0 0 0-3.6H8z'),
    'arc': arc,
    'spiral': spiral,
    'rect-grid': R(4, 4, 16, 16) + P('M4 9.5h16M4 14.5h16M9.5 4v16M14.5 4v16'),
    'polar-grid': C(12, 12, 8.5) + C(12, 12, 4.5) + P('M3.5 12h17M12 3.5v17'),
    'flare': C(12, 12, 3) + P('M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4M5.5 5.5l2.8 2.8M15.7 15.7l2.8 2.8M18.5 5.5l-2.8 2.8M8.3 15.7l-2.8 2.8') + C(18.5, 5.5, 1.3),
    /* ── AI 画笔家族 ── */
    'blob-brush': P('M14.5 3.5l6 6-8 8-6-6z') + P('M5 13c-2 1.5-3 4.5-2.5 8 4 0 7-1.5 8-4.5') + C(5, 17, 1.5),
    'shaper': pencil + C(16.5, 7.5, 4.5),
    'smooth': pencil + P('M12 4c2-2 4-2 6 0s4 2 6 0'),
    'path-eraser': pencil + R(14.5, 2.5, 6, 4, 1) + P('M16 2.5v4'),
    'join': P('M3.5 16.5l6.5-6.5M14 10l6.5 6.5') + C(12, 11, 2.2) + P('M12 3.5v3M9.5 5.5l1.5 1.5M14.5 5.5L13 7'),
    'eraser-ai': P('M12 3.5l8.5 8.5-8.5 8.5L3.5 12z') + P('M7.5 7.5l9 9'),
    'scissors': C(7, 6, 3) + C(7, 18, 3) + P('M9.3 7.6L20.5 18.5M9.3 16.4L20.5 5.5'),
    'knife': knife,
    /* ── AI 修改 ── */
    'rotate': P('M20 12a8 8 0 1 1-3.2-6.4') + P('M17.5 3v3.5H21'),
    'reflect': P('M12 2.5v19') + F('M9.5 7l-6.5 5 6.5 5z') + P('M14.5 7l6.5 5-6.5 5z'),
    'scale': R(4, 11, 9, 9) + P('M9.5 11V5h9v9h-5.5') + P('M12.5 11.5L18.5 5.5M14.5 5.5h4v4'),
    'shear': P('M8.5 5h13l-5.5 14h-13z'),
    'reshape': arrowF + R(16, 14.5, 4, 4) + P('M18 14.5V8M18 8l3-3'),
    'width': P('M3 12c3-8 6-8 9 0s6 8 9 0') + P('M12 5v14') + P('M10 7l2-2 2 2M10 17l2 2 2-2'),
    'warp': F('M4 3.5v17l16-4.5V8z'),
    'twirl': P('M12 12a2 2 0 0 1 2 2 4 4 0 0 1-4 4 6 6 0 0 1-6-6 8 8 0 0 1 8-8 9 9 0 0 1 9 9') + F('M20 9.5l1.5 3.5h-3z'),
    'pucker': P('M12 2.5v6M12 15.5v6M2.5 12h6M15.5 12h6') + P('M9.5 6l2.5 2.5L14.5 6M9.5 18l2.5-2.5 2.5 2.5M6 9.5l2.5 2.5L6 14.5M18 9.5l-2.5 2.5 2.5 2.5') + C(12, 12, 1.5, 1),
    'bloat': C(12, 12, 4) + P('M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4') + P('M10 4.5l2-2 2 2M10 19.5l2 2 2-2M4.5 10l-2 2 2 2M19.5 10l2 2-2 2'),
    'scallop': P('M4 5h16v11c-2 3-3 3-5 0s-3-3-5 0-3 3-6 0z'),
    'crystallize': F('M12 2.5l2.8 6.7 6.7 2.8-6.7 2.8-2.8 6.7-2.8-6.7L2.5 12l6.7-2.8z'),
    'wrinkle': F('M4 20V8.5l4 4 4-9 4 9 4-4V20z'),
    'puppet-warp': pin,
    'free-transform': D('M5 5h14v14H5z') + F('M8 8l6 4.5-3 .7-1 3z') + R(3.5, 3.5, 3, 3) + R(17.5, 3.5, 3, 3) + R(3.5, 17.5, 3, 3) + R(17.5, 17.5, 3, 3),
    'shape-builder': C(9, 10.5, 5.5) + C(15, 10.5, 5.5) + F('M13.5 14l7 3.5-2.8 1-1 2.8z'),
    'live-paint': P('M3 10l6-6 6 6-6 6z') + P('M9 7l-1.5-2.5') + R(13, 12, 8, 8) + P('M13 16h8M17 12v8'),
    'live-paint-select': R(3, 3, 11, 11) + P('M3 8.5h11M8.5 3v11') + F('M12 12l8.5 3.3-3.3 1.2-1.2 3.3z'),
    'perspective-grid': P('M3.5 20.5L12 4l8.5 16.5M12 4v16.5M6 15.5h12M8 11h8'),
    'perspective-select': F('M3 3l8 6.2h-4.6L5 16z') + P('M14 13l3.5 1.8v3.5L14 20l-3.5-1.7v-3.5z'),
    'mesh': R(4, 4, 16, 16) + P('M4 12c4-3 12-3 16 0M12 4c-3 4-3 12 0 16'),
    'measure': P('M3 17L17 3l4 4L7 21z') + P('M7 11l2 2M10 8l2 2M13 5l2 2') + C(19, 5, 1.2, 1),
    'blend': C(8, 15.5, 4.5) + R(12, 3.5, 8.5, 8.5) + P('M10.5 12l3.5-3') + P('M12.5 9h2v2'),
    'symbol-spray': spray,
    'symbol-shift': symbolBase + P('M18 5h4M20 3l2 2-2 2'),
    'symbol-scrunch': symbolBase + P('M17 3l2 2 2-2M17 8l2-2 2 2'),
    'symbol-size': symbolBase + P('M17 7l5-5M18 2h4v4'),
    'symbol-spin': symbolBase + P('M22 4.5a3 3 0 1 1-1.2-2.4') + P('M21 1.5v2h2'),
    'symbol-stain': symbolBase + F('M19 2c1.5 2 2.5 3.5 2.5 4.5a2.5 2.5 0 0 1-5 0C16.5 5.5 17.5 4 19 2z'),
    'symbol-screen': symbolBase + R(16.5, 2, 5.5, 5.5) + P('M16.5 4.7h5.5M19.2 2v5.5'),
    'symbol-style': symbolBase + F('M19 1.5l1 2.3 2.5.3-1.8 1.7.5 2.5L19 7l-2.2 1.3.5-2.5-1.8-1.7 2.5-.3z'),
    'graph-column': bars(9, 15, 7),
    'graph-stacked-column': bars(9, 15, 7) + P('M4.5 15.5h4M10 11h4M15.5 16.5h4'),
    'graph-bar': hbars(9, 15, 7),
    'graph-stacked-bar': hbars(9, 15, 7) + P('M9 4.5v4M13 10v4M8 15.5v4'),
    'graph-line': P('M3.5 18.5l5-6.5 4 3 7.5-9.5') + C(8.5, 12, 1.3, 1) + C(12.5, 15, 1.3, 1) + C(20, 5.5, 1.3, 1),
    'graph-area': F('M3.5 20l5-7.5 4 3 7.5-9v13.5z'),
    'graph-scatter': C(6, 16, 1.4, 1) + C(9, 11, 1.4, 1) + C(13, 13, 1.4, 1) + C(16, 7, 1.4, 1) + C(19, 10, 1.4, 1) + P('M3.5 3v18h18'),
    'graph-pie': C(12, 12, 8.5) + P('M12 3.5V12l6.5 5.5'),
    'graph-radar': P('M12 3l8.5 6.2-3.2 10H6.7L3.5 9.2z') + P('M12 8l4.5 3.3-1.7 5.3H9.2L7.5 11.3z') + P('M12 3v5M20.5 9.2L16.5 11.3M3.5 9.2l4 2.1M17.3 19.2l-2.5-2.6M6.7 19.2l2.5-2.6'),
    'print-tiling': R(5, 3, 14, 18) + D('M8 7h8v10H8z'),
    /* ── 底部小件 ── */
    'hand': hand,
    'rotate-view': hand + P('M2 4a5 5 0 0 1 8-2') + P('M9 1v2h-2'),
    'zoom': zoom + P('M7.5 10h5M10 7.5v5'),
    'more': C(5, 12, 1.7, 1) + C(12, 12, 1.7, 1) + C(19, 12, 1.7, 1),
    'quick-mask': R(3.5, 3.5, 17, 17) + E(12, 12, 5, 5, true),
    'screen-standard': R(3, 8.5, 12.5, 10) + R(8.5, 4.5, 12.5, 10),
    'screen-full-menu': R(3, 4, 18, 16) + P('M3 8h18'),
    'screen-full': R(3, 4, 18, 16) + P('M7 10.5V7h3.5M13.5 7H17v3.5M17 13.5V17h-3.5M10.5 17H7v-3.5'),
    'screen-presentation': R(3, 4, 18, 13) + P('M12 17v4M8 21h8'),
    'swap': P('M4 7.5h12l-3-3M20 16.5H8l3 3'),
    'default-colors': F('M3.5 3.5h9v9h-9z') + R(9.5, 9.5, 11, 11) + `<rect x="10.5" y="10.5" width="9" height="9" fill="#fff" stroke="none"/>`,
    'draw-normal': square2,
    'draw-behind': F('M4 8.5h11v11H4z') + R(9, 4, 11, 11),
    'draw-inside': R(4, 4, 16, 16) + D('M8 8h8v8H8z'),
    'color': F('M4 4h16v16H4z'),
    'gradient-swatch': grad,
    'none': R(4, 4, 16, 16) + `<path d="M4 20L20 4" stroke="#e23b3b"/>`,
    // 图层面板「锁定：」那排（PS：透明像素＝棋盘格、图像像素＝画笔、位置＝十字箭头、全部＝锁头）＋图层列右边的小锁（实心＝全锁、空心＝部分锁）
    'lock-transparency': R(4, 4, 16, 16) + F('M4 4h4v4H4zM12 4h4v4h-4zM8 8h4v4H8zM16 8h4v4h-4zM4 12h4v4H4zM12 12h4v4h-4zM8 16h4v4H8zM16 16h4v4h-4z'),
    'lock-pixels': brush,
    'lock-position': P('M12 3v18M3 12h18') + P('M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3'),
    'lock-all': P('M8 11V7.5a4 4 0 0 1 8 0V11') + F('M5.5 11h13v10h-13z'),
    'lock-hollow': P('M8 11V7.5a4 4 0 0 1 8 0V11') + R(5.5, 11, 13, 10),
  };

  return {
    has: id => !!I[id],
    inner: id => I[id] || (R(4, 4, 16, 16) + T(12, 16.5, '?', 11)),
    svg(id, size){
      const s = size || 20;
      return `<svg class="ico" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${this.inner(id)}</svg>`;
    },
    ids(){ return Object.keys(I); }
  };
})();
window.Icons = Icons;

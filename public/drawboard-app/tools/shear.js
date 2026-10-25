/* 堤麟画板 · 倾斜工具 —— 照 ArtCraft VectorCraft 原码逐段翻译
   原码：tools/src/xform/transform.rs（TransformKind::Shear：134-147 matrix_for、其余流程跟镜像／旋转同一支 TransformTool）
         engine/src/cmd/object.rs:293-299（object.shear：t＝tan(clamp(angle, ±89°))；vertical＝[1,t,0,1]，否则 [1,0,−t,1]，绕 origin）
         ui-egui/src/dialogs/tools.rs:35-49（shear 预设 {angle:0, axis:"horizontal"} 并入 origin）、dialogs/transform.rs:87（确定＝object.shear {angle, axis, copy, origin}）
   拖曳（transform.rs:134-147）：轴＝拖曳位移的主方向（|dx|≥|dy| 水平）；水平：k＝dx ／ lever(按下点 y − 参考点 y, 外框高/2)，矩阵 about(o,[1,0,k,1,0,0])；
         垂直：k＝dy ／ lever(按下点 x − 参考点 x, 外框宽/2)，矩阵 about(o,[1,k,0,1,0,0])；lever：|a|>1e-3 用 a，否则 max(备用, 1)；读数＝−atan(k) 的度数。
   其余（点一下设参考点并吸附、Alt＋点开对话框、放开时 Alt＝复制、双击／Enter 开对话框、Esc 取消、游标、叠画）跟镜像同一份：
   流程与命令底座都在 tools/reflect.js 的 window.XformKit.makeTransformTool（几颗变形工具共用，放在第一支档、挂在 window 上）。 */
(function(){
'use strict';
if (!window.XformKit){ console.error('shear.js: tools/reflect.js（XformKit）没载入'); return; }
const SHEAR_STRINGS = {
  'zh-Hant':{'ui.shearHint':'點一下＝設參考點（貼齊錨點／中心）· 拖＝繞參考點傾斜（拖的主方向＝傾斜軸；放開時按 Alt＝拷貝）· Alt＋點／雙擊／Enter＝輸入數值 · 拖時 Esc 取消'},
  'zh-Hans':{'ui.shearHint':'点一下＝设参考点（吸到锚点／中心）· 拖＝绕参考点倾斜（拖的主方向＝倾斜轴；放开时按 Alt＝复制）· Alt＋点／双击／Enter＝输入数值 · 拖时 Esc 取消'},
  'en':{'ui.shearHint':'Click to set the reference point (snaps to anchors / centres) · Drag to shear about it (the drag direction picks the axis; Alt at release: copy) · Alt+Click / double-click / Enter for exact values · Esc cancels a drag'}
};
if (typeof Lang !== 'undefined') Lang.add(SHEAR_STRINGS);
window.ShearTool = XformKit.makeTransformTool('shear');
})();

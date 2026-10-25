/* 极坐标网格工具（AI 版面 ai.polar-grid）——照 vectorcraft/crates/tools/src/draw2/family.rs（FamilyTool "polarGrid"）、
   engine/src/cmd/create.rs:355-360 shape.polarGrid、geom/src/shapes.rs:41-57 ellipse＋155-169 polar_grid、settings.rs:30（concentric／radial）逐段翻。
   行为：拖＝框（Shift 正圆、Alt 以按下点为中心）；拖时 ↑↓＝同心圆分隔线 ±1、←→＝径向分隔线 ±1（0..999）；Esc 取消；
   落地＝编组：concentric+1 个同心椭圆（4 平滑点，最外＝外框）＋ max(radial,1) 条从中心出去的线（第一条朝正上）；每条填色无、描边＝目前描边（无＝黑 1px）；
   点一下不拖＝对话框（原码没有·照 AI 2020 写：宽、高、同心圆／径向分隔线数）。
   共用的底层在 tools/arc.js 的 window.AiFamily；命令 polargrid.create／polargrid.drag／polargrid.setOption。 */
window.AiFamily.install('polargrid');

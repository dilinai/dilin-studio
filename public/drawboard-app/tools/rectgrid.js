/* 矩形网格工具（AI 版面 ai.rect-grid）——照 vectorcraft/crates/tools/src/draw2/family.rs（FamilyTool "rectangularGrid"）、
   engine/src/cmd/create.rs:328-353 grid_group／shape.rectangularGrid、geom/src/shapes.rs:137-153 rectangular_grid、settings.rs:29（rows／columns）逐段翻。
   行为：拖＝框（Shift 正方、Alt 以按下点为中心）；拖时 ↑↓＝水平分隔线 ±1、←→＝垂直分隔线 ±1（0..999）；Esc 取消；
   落地＝编组：rows 条横线＋columns 条直线＋外框矩形，每条填色无、描边＝目前描边（描边为无时我们用黑 1px）；
   点一下不拖＝对话框（原码没有·照 AI 2020 写：宽、高、两种分隔线数，参考点左上）。
   共用的底层在 tools/arc.js 的 window.AiFamily；命令 rectgrid.create／rectgrid.drag／rectgrid.setOption。 */
window.AiFamily.install('rectgrid');

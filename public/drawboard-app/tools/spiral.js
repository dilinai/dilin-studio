/* 螺旋线工具（AI 版面 ai.spiral）——照 vectorcraft/crates/tools/src/draw2/family.rs（FamilyTool "spiral"）、
   engine/src/cmd/create.rs:310-320 shape.spiral、geom/src/shapes.rs:113-135 spiral、settings.rs:28（decay／segments／clockwise 要记住）逐段翻。
   行为：按下＝中心；拖＝半径＝拖的距离（Shift／Alt 原码对螺旋线不起作用）；拖超过 2 屏幕像素才算开始；拖时 ↑／↓＝段数 ±1（2..1000，记进选项）；Esc 取消；
   点一下不拖＝「螺旋线」对话框（原码 dialogs/tools.rs 落到 `_ => return` 没对话框；照 AI 2020 写：半径、衰减、段数、顺时针）。
   共用的底层（几何、命令登记、选项、对话框、叠画）在 tools/arc.js 的 window.AiFamily；命令 spiral.create／spiral.drag／spiral.setOption。 */
window.AiFamily.install('spiral');

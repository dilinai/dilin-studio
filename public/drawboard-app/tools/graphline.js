/* lineGraph（AI 版面图表格）——逐段照抄 VectorCraft tools/src/extra.rs:298-376 GraphTool（id = lineGraph，catalog.rs:116-124）。
   状态机、Shift／Alt、点一下的尺寸对话框、放开后的「图表数据」、Esc 全部在 tools/graphcolumn.js 的 window.GraphToolKit（九颗共用）；
   这里只登记这颗：GraphKind = line（doc/src/graph.rs），生成走 menus/impl/ai-object.js 的 ai.graph.create。 */
GraphToolKit.make('graphline', 'line', 304);

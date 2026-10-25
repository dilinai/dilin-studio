/* 堤麟画板 · 符号旋转器（Symbol Spinner）：symbol.adjust tool=spin——往拖的方向转 sign((c−q)×delta)·0.1w 弧度、点一下 0.05w、Alt 反转（brushsym.rs:990-994）
   照 ArtCraft VectorCraft vectorcraft/crates/tools/src/symbolism.rs（SymbolismTool，id "symbolSpinner"）逐段翻译；
   手势、选项、叠画、命令（symspray.adjust）都在 tools/symspray.js 的 window.SymKit（八颗符号工具同一个结构），这里只登记这一颗。 */
if (window.SymKit) SymKit.makeTool('symspin');

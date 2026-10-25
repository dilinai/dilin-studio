/* 堤麟画板 · 符号滤色器（Symbol Screener）：symbol.adjust tool=screen——不透明度 −0.1w（最低 5%）、Alt 加回（brushsym.rs:1011-1014）
   照 ArtCraft VectorCraft vectorcraft/crates/tools/src/symbolism.rs（SymbolismTool，id "symbolScreener"）逐段翻译；
   手势、选项、叠画、命令（symspray.adjust）都在 tools/symspray.js 的 window.SymKit（八颗符号工具同一个结构），这里只登记这一颗。 */
if (window.SymKit) SymKit.makeTool('symscreen');

/* 堤麟画板 · 符号移位器（Symbol Shifter）：symbol.adjust tool=shift——实例跟着拖动方向搬 delta×w（brushsym.rs:981）
   照 ArtCraft VectorCraft vectorcraft/crates/tools/src/symbolism.rs（SymbolismTool，id "symbolShifter"）逐段翻译；
   手势、选项、叠画、命令（symspray.adjust）都在 tools/symspray.js 的 window.SymKit（八颗符号工具同一个结构），这里只登记这一颗。 */
if (window.SymKit) SymKit.makeTool('symshift');

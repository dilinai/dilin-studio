/* 堤麟画板 · 符号样式器（Symbol Styler）：symbol.adjust tool=style——套图形样式的填色（缺省第一个非默认样式）、Alt 清掉（brushsym.rs:931-934、995-1010）
   照 ArtCraft VectorCraft vectorcraft/crates/tools/src/symbolism.rs（SymbolismTool，id "symbolStyler"）逐段翻译；
   手势、选项、叠画、命令（symspray.adjust）都在 tools/symspray.js 的 window.SymKit（八颗符号工具同一个结构），这里只登记这一颗。 */
if (window.SymKit) SymKit.makeTool('symstyle');

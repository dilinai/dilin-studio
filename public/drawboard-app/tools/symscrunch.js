/* 堤麟画板 · 符号紧缩器（Symbol Scruncher）：symbol.adjust tool=scrunch——实例往刷子中心聚拢 (q−c)×0.15w、Alt 推开（brushsym.rs:982-985）
   照 ArtCraft VectorCraft vectorcraft/crates/tools/src/symbolism.rs（SymbolismTool，id "symbolScruncher"）逐段翻译；
   手势、选项、叠画、命令（symspray.adjust）都在 tools/symspray.js 的 window.SymKit（八颗符号工具同一个结构），这里只登记这一颗。 */
if (window.SymKit) SymKit.makeTool('symscrunch');

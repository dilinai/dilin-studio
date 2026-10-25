# 表格编辑器用到的第三方代码与资源

## 执行期依赖（npm 套件，随网页打包）

| 名字 | 来源 | 授权 | 用在哪 |
|---|---|---|---|
| SheetJS 社区版 `xlsx` | https://sheetjs.com （仓库 https://git.sheetjs.com/sheetjs/sheetjs ） | Apache-2.0 | `engine/xlsx-io.ts`：读 xlsx／xls／csv（格值、公式、合并区、列宽行高、数字格式码），以及用它附带的 CFB 模块读写 zip 部件。锁档版本 0.20.3（`core/vendor/xlsx-0.20.3.tgz`，与 npm 上 0.18.5 同授权）。只在用户按「汇入／汇出 xlsx」时动态载入。 |
| SheetJS 附属套件 `cfb`、`ssf`、`codepage`、`adler-32`、`crc-32`、`wmf`、`word`、`frac` | https://github.com/SheetJS | Apache-2.0 | 0.18.x 版 `xlsx` 的相依套件（0.20.x 已内建）。 |
| React | https://react.dev | MIT | 全部画面。 |

## 抄改的算法（已在档头写明出处与修改声明）

| 名字 | 来源 | 授权 | 用在哪 |
|---|---|---|---|
| univer（commit 511bfd2） | https://github.com/dream-num/univer ·Copyright 2023-present DreamNum Co., Ltd. | Apache-2.0 | `engine/fill.ts`（填充柄序列推断）、`engine/history.ts`（撤销栈规矩）、`engine/border.ts`（套框线规则）、`engine/formula-refs.ts`（相对引用平移）、`engine/formula-edit.ts`（引用上色、F4 切绝对引用、语法检查口径）；`ui/SheetBorderMenu.tsx`、`ui/SheetFormulaInput.tsx` 的选项清单与补全外观参考。各档头有 Apache-2.0 §4(b) 修改声明。 |
| fortune-sheet（commit 9434660） | https://github.com/ruilisi/fortune-sheet ·Copyright (c) 2022 Suzhou Ruilisi Technology Co., Ltd | MIT | `engine/formula-edit.ts`、`engine/agent-ops.ts`（区间平移）、`ui/SheetFormulaInput.tsx`（补全下拉键盘规矩）；`engine/formula.ts`、`engine/layout.ts`、`ui/SheetGrid.tsx` 只参考结构，代码现写。 |

## 字体（不打包，用户选了才从网络载）

表格可选的字体用共用底座的字体表（`shared/fonts/catalog.ts`），16 款全部是 SIL Open Font License 1.1，每款的授权全文网址写在表里（`ofl` 栏）。载入来源：Google Fonts css2（https://fonts.googleapis.com ）与 jsDelivr 上的切片包（https://cdn.jsdelivr.net/npm ）；部署时可用 `NEXT_PUBLIC_FONT_GOOGLE_BASE`、`NEXT_PUBLIC_FONT_NPM_CDN_BASE` 改指自托管镜像。

| 字体 | 授权全文 |
|---|---|
| Noto Sans SC／Noto Serif SC／Noto Sans TC／Noto Serif TC | https://github.com/notofonts/noto-cjk |
| LXGW WenKai Screen（霞鶩文楷螢幕版） | https://github.com/lxgw/LxgwWenKai |
| Smiley Sans（得意黑） | https://github.com/atelier-anchor/smiley-sans |
| Ma Shan Zheng、Zhi Mang Xing、Liu Jian Mao Cao、Long Cang、Inter、EB Garamond、JetBrains Mono、Caveat | https://github.com/google/fonts （各自的 ofl/<名字>/OFL.txt） |
| Iansui（芫荽） | https://github.com/ButTaiwan/iansui |
| jf open 粉圓（Huninn） | https://github.com/justfont/open-huninn-font |

## 没有放进来的

- 示范素材：没有（新工程是一张空表）。
- 图标：工具栏图标是本仓手写的内联 SVG 线稿，没有用图标库。

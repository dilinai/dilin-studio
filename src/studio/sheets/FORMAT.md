# 表格工程格式（dilin-studio/sheets · version 1）

一个工程＝一个资料夹：

```
<工程资料夹>/
  project.json      ← 全部表格内容（本档说明）
  assets/           ← 插进表格的图片原档
```

汇出的工程档 `<名字>.dilin-sheets.zip` 里面是同样两样东西。改完 `project.json` 存档，开着的网页约 1.5 秒内会自动重新载入。

## 最小范例

```json
{
  "format": "dilin-studio/sheets",
  "version": 1,
  "name": "月报",
  "sheets": [
    {
      "id": "s1",
      "name": "Sheet1",
      "content": {
        "cells": {
          "A1": { "v": "品项", "s": { "b": true, "bg": "#f3f4f6" } },
          "B1": { "v": "金额", "s": { "b": true, "bg": "#f3f4f6" } },
          "A2": { "v": "房租" }, "B2": { "v": "12000" },
          "A3": { "v": "水电" }, "B3": { "v": "1850.5" },
          "A4": { "v": "合计" }, "B4": { "v": "", "f": "=SUM(B2:B3)", "s": { "numFmt": { "t": "number", "d": 2, "k": true } } }
        },
        "colWidths": { "A": 140 }
      }
    }
  ]
}
```

## 顶层

| 栏位 | 说明 |
|---|---|
| `format` | 固定 `"dilin-studio/sheets"` |
| `version` | 固定 `1`（比这版网页认得的新 ⇒ 拒收） |
| `name` | 工程名（可省） |
| `sheets` | 工作表阵列，顺序＝画面上的分页顺序；最多 50 张；一张都没有 ⇒ 网页给一张空表 |

每张表：`id`（英数、`_`、`-`，1–64 字，不可重复；坏的会换新）、`name`（1–60 字）、`content`（下面）。

## content

| 栏位 | 形状 |
|---|---|
| `cells` | `{ "A1": 格, … }`，键＝格名（栏 A–ZZZ、列 1–999999，大写） |
| `merges` | `["A1:B2", …]` 合并区（不可重叠） |
| `colWidths` | `{ "A": 120 }` 栏宽像素（16–1200；省＝96） |
| `rowHeights` | `{ "1": 32 }` 列高像素（12–600；省＝28） |
| `images` | `[{ "id", "url", "cell", "w", "h", "ox"?, "oy"?, "plane"?, "inCell"? }]` |
| `freeze` | `{ "rows": 1, "cols": 0 }` 冻结窗格 |
| `filter` | `{ "range": "A1:D20", "criteria"?: { "B": { "values": ["甲"] } } }` |
| `validations` | `[{ "id", "range": "C2:C20", "type": "list", "list": ["是","否"] }]` 下拉清单（或 `"source": "F1:F5"`） |
| `condFormats` | 条件格式规则 `[{ "id", "ranges": ["B2:B20"], "type", "value"?, "style"? }]`（`type`：`greater` `less` `between` `equal` `top` `bottom` `above_average` `duplicate` `unique` `text_contains` `color_scale` `data_bar`…；`color_scale`／`data_bar` 的 `colors` 可省 ⇒ 预设色（色阶红黄绿、数据条 `#638ec6`），条长按区里数字的最小～最大自动算） |
| `charts` | `[{ "id", "type": "column|bar|line|pie|doughnut", "range": "A1:B5", "cell": "D2", "w", "h", "title"? }]` |
| `print` | 列印设定（网页「列印」对话框存的·每张表各一份·省＝A4 直式、标准边界、不缩放、整张表）：`{ "scope": "sheet\|selection\|range", "range"?: "A1:F30", "paper": "A4\|A3\|Letter\|Legal\|B5", "orientation": "portrait\|landscape", "marginPreset": "normal\|narrow\|wide\|custom", "margins": { "top", "bottom", "left", "right", "header", "footer" }（公分）, "scaleMode": "none\|fitSheet\|fitCols\|fitRows\|custom", "scale": 10–400, "titleRows"?: "1:1", "titleCols"?: "A:A", "gridlines", "headings", "hCenter", "vCenter", "header"/"footer": { "l"?, "c"?, "r"?: "sheet\|title\|page\|date" } }` |
| `hiddenRows` `hiddenCols` | `[2, 3]` 手动隐藏的列／栏（0 起编号：`0`＝第 1 列／A 栏）；跟 `filter` 筛掉的列分开存，清掉筛选不会放出来 |

### 格

`{ "v": "原文", "f": "=公式", "s": { 格式 } }`，三个都可省（全省＝这格不存在）。

- `v` 一律是**字串**：数字写 `"12.5"`；日期写 Excel 日期序号字串配日期格式，如 `{ "v": "46313", "s": { "numFmt": { "t": "date" } } }` ＝ 2026/10/18（写成 `"2026/10/18"` 会被当成文字显示）。
- 有 `f` 的格，`v` 写 `""`；网页自己算。公式以 `=` 开头，支援约 160 个 Excel 常用函数（SUM、IF、VLOOKUP、XLOOKUP、INDEX、MATCH、SUMIFS、COUNTIFS、TEXT、DATE、NETWORKDAYS、PMT…）、`$A$1` 绝对引用与 `Sheet2!A1` 跨表引用；一格算出整片的函数（FILTER、SORT、UNIQUE、SEQUENCE）与 LET、LAMBDA 不支援。

### 格式 `s`

| 键 | 值 |
|---|---|
| `b` `i` `u` `s` | `true` ＝粗体／斜体／底线／删除线 |
| `size` | 字级（pt） |
| `font` | 字体代号：`noto-sans-sc`、`noto-serif-sc`、`lxgw-wenkai-screen`、`smiley-sans`、`ma-shan-zheng`、`zhi-mang-xing`、`liu-jian-mao-cao`、`long-cang`、`noto-sans-tc`、`noto-serif-tc`、`iansui`、`huninn`、`inter`、`eb-garamond`、`jetbrains-mono`、`caveat`（省＝预设字体） |
| `fg` `bg` | 字色／底色 `#rrggbb` |
| `align` | `left` `center` `right`；`valign`：`top` `middle` `bottom` |
| `wrap` | `true` 自动换行；`indent`：缩排层数 |
| `border` | `{ "t"|"r"|"b"|"l": { "style": "thin|medium|thick|dashed|dotted|double", "color"?: "#rrggbb" } }` |
| `numFmt` | `{ "t": 种类, "d"?: 小数位, "k"?: 千分位, "c"?: "$"|"€"|"¥"|"NT$" }`；种类：`general` `number` `currency` `accounting` `date` `longdate` `rocdate` `time` `percent` `fraction` `scientific` `text` |

### 图片

`url` 写 `"assets/<档名>"`（档放在工程的 `assets/` 资料夹；档名不可含斜线）或 `https://` 网址。`cell`＝左上角锚在哪格，`w` `h`＝显示宽高像素（16–4000），`ox` `oy`＝相对锚格左上的偏移；`"plane": "below"` 垫在格子底下，`"inCell": true` 放进格子里。

## 读档规矩

不认得的键、坏值（颜色不是 `#rrggbb`、格名不对、数字超出范围…）读入时会被丢掉，不会整份拒收；`format` 或 `version` 不对才整份拒收。

# slides 用到的第三方

只列简报编辑器自己用到的；底座共用的（React、JSZip、Heroicons、字体表）见 `../shared/THIRD_PARTY.md`。

## npm 套件（执行期）

| 名字 | 版本 | 来源 | 授权 | 用在哪 |
|---|---|---|---|---|
| React／React DOM | 19.x | https://github.com/facebook/react | MIT | 全部元件（宿主提供，peer）；`react-dom/server` 在 `kit/pipeline/deck-html.ts` 把整份简报渲成 HTML（放映、下载 HTML） |
| pptxgenjs | 3.12.0 | https://github.com/gitbrent/PptxGenJS | MIT（Copyright (c) 2015-present Brent Ely） | `pptx/`：下载 PowerPoint；整包调用、没改它的码；按下载钮才懒载入 |
| JSZip | 3.10.1 | https://github.com/Stuk/jszip | MIT（与 GPLv3 二择一，这里取 MIT） | `pptx/pptx-components.ts`：pptx 出档后补 XML（切换、背景填充、动画、影片档） |
| acorn | 8.x | https://github.com/acornjs/acorn | MIT | `kit/components/program-compile.server.ts`：程序动画的脚本在浏览器里解析、检查（有程序动画的简报才懒载入） |
| parse5 | 7.x | https://github.com/inikulin/parse5 | MIT | `kit/components/program-compile.server.ts`、`program-verify.ts`：程序动画的 HTML 解析、检查 |

## 改写过的码（不是整包调用）

| 出处 | 授权 | 改写进哪 | 说明 |
|---|---|---|---|
| dom-to-pptx 2.1.2（https://github.com/atharva9167j/dom-to-pptx） | MIT（Copyright (c) 2025 Atharva Dharmendra Jagtap and dom-to-pptx contributors） | `pptx/pptx.ts` | 「量 DOM 坐标＋计算样式 ⇒ pptxgenjs 对象」的走访、z 排序、文字框判法、字样换算、颜色正规化、裸文字量框；改成 TypeScript、按本编辑器版式收窄。档头逐段写明对应关系 |
| presenton（https://github.com/presenton/presenton） | Apache-2.0 | `kit/layouts/cover.tsx`、`contents.tsx`、`content.tsx`、`transition.tsx`、`end.tsx`，`kit/components/blueprints.ts`，`kit/types.ts` | 版式视觉起点；每档档头写明取自哪几个原版式、改了什么（坐标系 1000×562.5、槽位契约、中文排版） |

presenton 的授权全文与本目录的 NOTICE 在 `licenses/presenton/`（`LICENSE` 照对方仓原文、`NOTICE` 列出改写过的档与改了什么）。对方仓的 NOTICE 只收它自己打包的第三方套件授权，跟这几档无关，没照搬，原因写在那份 NOTICE 里。

## 主题配色（`kit/template-themes.ts`）

只取了颜色值、深浅策略与字体的对应（字体一律换成 `../shared/fonts` 表里的开源字体），没带对方的 CSS、图片或字体档。原作者版权行照列如下（全部 MIT）：

| 出处 | 版权行 | 授权全文 | 主题 |
|---|---|---|---|
| reveal.js | Copyright (C) 2011-2026 Hakim El Hattab | https://github.com/hakimel/reveal.js/blob/master/LICENSE | reveal-black、white、league、beige、night、serif、simple、solarized、moon、dracula、sky |
| Marp | Copyright (c) 2018 Marp team | https://github.com/marp-team/marp-core/blob/main/LICENSE | marp-default、gaia、uncover |
| marp-theme-academic | Copyright (c) 2022 Kaito Sugimoto | https://github.com/kaisugi/marp-theme-academic/blob/main/LICENSE | marp-academic |
| marpstyle | Copyright (c) 2021-2024 Paulo Cunha | https://github.com/cunhapaulo/marpstyle/blob/main/LICENSE | marp-hegel、heidegger、husserl |
| neobeam | Copyright (c) 2024 Embracket | https://github.com/mikael-ros/neobeam/blob/main/LICENSE | marp-neobeam、ecobeam、neonbeam、oldenbeam |
| Dracula Theme（Marp 版） | Copyright (c) 2020 Dracula Theme | https://github.com/dracula/marp/blob/master/LICENSE | marp-dracula |
| cybertopia-marp | Copyright (c) 2024 Alexandre ZANNI | https://github.com/noraj/cybertopia-marp/blob/master/LICENSE | marp-cybertopia |
| MarpThemeWave | Copyright (c) 2023 Julius Wiedemann | https://github.com/JuliusWiedemann/MarpThemeWave/blob/main/LICENSE | marp-wave |
| Slidev themes | Copyright (c) 2021 Slidev.js Team | https://github.com/slidevjs/themes/blob/main/LICENSE | slidev-default、seriph、apple-basic、bricks、shibainu |
| slidev-theme-academic | Copyright (c) 2022 Alexander Eble | https://github.com/alexanderdavide/slidev-theme-academic/blob/master/LICENSE | slidev-academic |
| Shower | Copyright © 2010–2024 Vadim Makeev | https://github.com/shower/ribbon/blob/main/LICENSE.md、https://github.com/shower/material/blob/main/LICENSE.md | shower-ribbon、shower-material |

## 皮肤装饰图（`kit/dilin-skins.ts`）

码里只存相对路径（`templates/slides/…`）；图档不在这个目录、也不随码打包。前缀由宿主给（`../shared/host.ts` 的 `skinAssetBase()`）：网站＝自家图床；留空＝装饰图不显示、版式照常。开源时带不带这批图另定。

## 外部网址

- 字体：经 `../shared/fonts` 载入（Google Fonts、jsDelivr；根网址可换自托管镜像）。
- `schemas.openxmlformats.org`／`schemas.microsoft.com`：只是 .pptx 档里固定的 XML 命名空间字串，不连网。
- 除此之外不连任何伺服器：下载 PowerPoint 时外站图直取失败，要宿主给同源代理才再试（游客版不给）。

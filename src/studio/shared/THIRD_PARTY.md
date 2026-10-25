# shared 用到的第三方

只列 shared/ 自己用到的；各编辑器在 `<app>/THIRD_PARTY.md` 另列。

## npm 套件（执行期）

| 名字 | 来源 | 授权 | 用在哪 |
|---|---|---|---|
| React | https://github.com/facebook/react | MIT | 全部元件（由宿主提供，peer） |
| JSZip 3.x | https://github.com/Stuk/jszip | MIT（与 GPLv3 二择一，这里取 MIT） | `zip.ts` 工程档汇出／汇入 |

## 图示

| 名字 | 来源 | 授权 | 用在哪 |
|---|---|---|---|
| Heroicons（20 solid：document-plus、table-cells、presentation-chart、video-camera、paint-brush、cloud 同族） | https://github.com/tailwindlabs/heroicons | MIT | `icons.ts` 五个编辑器图示；路径字串原样 |

## 字体（`fonts/catalog.ts`·第一层＝可公开散布）

码里只放字体名与载入网址，不附字体档。载入走 Google Fonts css2 端点与 jsDelivr 上的 npm 切片包（`fonts/source.ts`，根网址可用 `NEXT_PUBLIC_FONT_GOOGLE_BASE`／`NEXT_PUBLIC_FONT_NPM_CDN_BASE` 换成自托管镜像）。

| 字体 | 授权 | 授权全文 | 载法 |
|---|---|---|---|
| Noto Sans SC | SIL OFL 1.1 | https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/LICENSE | Google Fonts |
| Noto Serif SC | SIL OFL 1.1 | https://raw.githubusercontent.com/notofonts/noto-cjk/main/Serif/LICENSE | Google Fonts |
| LXGW WenKai Screen（霞鶩文楷螢幕版） | SIL OFL 1.1 | https://raw.githubusercontent.com/lxgw/LxgwWenKai/main/OFL.txt | jsDelivr `lxgw-wenkai-screen-webfont@1.7.0` |
| Smiley Sans（得意黑） | SIL OFL 1.1（含保留字体名 "Smiley"／"得意黑"） | https://raw.githubusercontent.com/atelier-anchor/smiley-sans/main/LICENSE | jsDelivr `cn-fontsource-smiley-sans-oblique-regular@1.0.1` |
| Ma Shan Zheng | SIL OFL 1.1 | https://raw.githubusercontent.com/google/fonts/main/ofl/mashanzheng/OFL.txt | Google Fonts |
| Zhi Mang Xing | SIL OFL 1.1 | https://raw.githubusercontent.com/google/fonts/main/ofl/zhimangxing/OFL.txt | Google Fonts |
| Liu Jian Mao Cao | SIL OFL 1.1 | https://raw.githubusercontent.com/google/fonts/main/ofl/liujianmaocao/OFL.txt | Google Fonts |
| Long Cang | SIL OFL 1.1 | https://raw.githubusercontent.com/google/fonts/main/ofl/longcang/OFL.txt | Google Fonts |
| Noto Sans TC | SIL OFL 1.1 | https://raw.githubusercontent.com/google/fonts/main/ofl/notosanstc/OFL.txt | Google Fonts |
| Noto Serif TC | SIL OFL 1.1 | https://raw.githubusercontent.com/notofonts/noto-cjk/main/Serif/LICENSE | Google Fonts |
| Iansui（芫荽） | SIL OFL 1.1 | https://raw.githubusercontent.com/ButTaiwan/iansui/master/OFL.txt | Google Fonts |
| Huninn（jf open 粉圓） | SIL OFL 1.1 | https://raw.githubusercontent.com/justfont/open-huninn-font/master/LICENSE | Google Fonts |
| Inter | SIL OFL 1.1 | https://raw.githubusercontent.com/google/fonts/main/ofl/inter/OFL.txt | Google Fonts |
| EB Garamond | SIL OFL 1.1 | https://raw.githubusercontent.com/google/fonts/main/ofl/ebgaramond/OFL.txt | Google Fonts |
| JetBrains Mono | SIL OFL 1.1 | https://raw.githubusercontent.com/google/fonts/main/ofl/jetbrainsmono/OFL.txt | Google Fonts |
| Caveat | SIL OFL 1.1 | https://raw.githubusercontent.com/google/fonts/main/ofl/caveat/OFL.txt | Google Fonts |

待定：得意黑走的是第三方切片包，包内 font-family 仍叫 `Smiley Sans Oblique`。按 OFL 字面，切片算「修改版」、不该沿用保留字体名；业界（含 Google Fonts）普遍没严格执行。开源仓公开前要定：改名载入，或从第一层拿掉、改由宿主注入（`registerHostFonts`）。

第二层（宿主注入·`registerHostFonts`）：目前是空的。不能随开源码散布的字体只由网站登入版注册，游客版与开源仓不列。

## 不是第三方、但拆仓时要注意的宿主依赖

- `theme/editor-shell-theme.ts` 的 `hp-lavender` 与各处 `keep-white` 是网站 `globals.css` 定义的 class；拆仓后要在新仓补这两条 CSS（或换掉）。
- 弹窗队列 `dialog-store.ts` 要有宿主把队首那条画出来（网站是根布局的 `<DialogHost/>`）；拆仓后要补一个最小宿主。
- Tailwind CSS（MIT）：元件的 class 依赖宿主有 Tailwind 3 编译。

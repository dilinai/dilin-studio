# video 用到的第三方

只列剪辑编辑器自己用到的；底座（React、JSZip、Heroicons、字体表）见 `../shared/THIRD_PARTY.md`。

## npm 套件（执行期）

| 名字 | 版本 | 来源 | 授权 | 用在哪 |
|---|---|---|---|---|
| Mediabunny | 1.61.3 | https://github.com/Vanilagy/mediabunny | MPL-2.0 | 读影音档、解码、剪辑用小预览档转档（`lib/opfs-cache.ts`）、逐帧编码出 MP4／WebM（`ui/export-render.ts`）、声音波形（按需 `import('mediabunny')`） |
| @mediabunny/aac-encoder | 1.61.3 | https://github.com/Vanilagy/mediabunny/tree/main/packages/aac-encoder | MPL-2.0；内含 FFmpeg（libavcodec 62.23.103、libavutil）编成的 WASM，LGPL-2.1-or-later | 浏览器自带 WebCodecs 编不了 AAC 时才载（`ui/export-render.ts` 按需 `import()`） |
| JSZip | 3.10.1 | https://github.com/Stuk/jszip | MIT（与 GPL-3.0-or-later 二择一，这里取 MIT） | 执行期：「程式」页签上传程序包时解 zip（`lib/program-store.ts` 按需 `import('jszip')`）；工程档 zip 汇出／汇入走底座 `shared/zip.ts`（也是它）；题 `export-project.test.ts` |
| React | 宿主提供 | https://github.com/facebook/react | MIT | 全部元件（peer） |

## 照着改写的上游算法

| 名字 | 来源 | 授权 | 用在哪 | 怎么用的 |
|---|---|---|---|---|
| EffectCraft `crates/keyframe` | https://github.com/storytold/effectcraft | MIT OR Apache-2.0（这里取 MIT）— Copyright (c) 2026 ArtCraft Team and the EffectCraft contributors | `lib/keyframe.pure.ts` 关键帧缓动（ease_progress、solve_u、EaseCurve） | Rust 算法改写成 TypeScript；没搬程序档、字体、商标（ArtCraft 名称与标志是商标，不用）。授权全文与 NOTICE 在 `/vedit/licenses/EffectCraft-LICENSE-MIT.txt`、`EffectCraft-NOTICE.txt` |
| pyJianYingDraft | https://github.com/GuanYixuan/pyJianYingDraft | MIT | `lib/jianying.pure.ts` 汇出剪映草稿（draft_content.json／draft_meta_info.json 栏位） | 照它新建草稿的栏位结构用 TypeScript 自写；没搬程序档。剪映是字节跳动的产品，只做相容输出、不用其商标 |

两支 Mediabunny 都按 npm 发布版原样使用、没改过。MPL-2.0 是「按档」的 copyleft：不改它的档就只要保留授权与原始码出处；改了它的档就要把改过的那几档照 MPL-2.0 公开。

FFmpeg 那部分：@mediabunny/aac-encoder 的 README 写明 FFmpeg 编译参数是 `--disable-everything --enable-avcodec --enable-encoder=aac`，没有 `--enable-gpl`、`--enable-nonfree`，用的是 FFmpeg 自带的 `aac` 编码器（不是要 nonfree 的 libfdk-aac）。

### FFmpeg（LGPL-2.1-or-later）怎么替换

- **不是独立的 `.wasm` 档**：上游把 FFmpeg 编成的 WASM 连同胶水码一起内嵌在 `@mediabunny/aac-encoder` 的 JS 里（`dist/bundles/mediabunny-aac-encoder.mjs`，约 1 MB；上游 README「Building and development」：编出来的 `build/aac.js` 内含 WASM）。
- **跟编辑器分开载**：`ui/export-render.ts` 只在浏览器自带 WebCodecs 编不了 AAC 时才 `import('@mediabunny/aac-encoder')`，打包后是单独一块，执行时在 Worker 里跑；编辑器其余部分不依赖它。
- **换法**：照上游 README 用你自己的 FFmpeg 原始码重编出 `build/aac.js`、重新打包那个套件，再用 npm `overrides`（或直接换掉 `node_modules/@mediabunny/aac-encoder`）装进来；套件对外只有 `registerAacEncoder()` 一个入口，介面不变就能替换。删掉这个套件也行：浏览器自带 AAC 时照常出声，没有时退 Opus 或无声并明说。
- **原始码**：FFmpeg https://github.com/FFmpeg/FFmpeg（libavcodec 62.23.103）；编译脚本与 JS／C 桥接 https://github.com/Vanilagy/mediabunny/tree/main/packages/aac-encoder 。

授权全文放在 `public/vedit/licenses/`（`MPL-2.0.txt`、`LGPL-2.1.txt`、`README.md` 写了出处与上面这段编译依据），游客页顶栏「第三方授權」小窗（`LicensesDialog.tsx`）链到这几档。

## 自己做的素材（堤麟自制，跟码同一个授权）

| 东西 | 在哪 | 怎么来的 |
|---|---|---|
| 特效 29 款、转场 30 款（GLSL） | `lib/fx.data.ts`（着色器字串）；缩图 `public/vedit/fx/<id>.jpg`（59 张） | 自写，随本专案授权。`fx.data.ts` 就是着色器原始码（最早由一次性脚本批量产出，之后直接改这一档）；缩图是拿自己的样图套这些着色器渲染出来的 |
| 滤镜 62 款 15 类 | `lib/filters.data.ts`（参数）、`lib/filter.pure.ts`（数学）；缩图 `public/vedit/filters/<id>.jpg`（62 张） | 自调，名字与参数自定，没照抄剪映；缩图是拿自己的样图套滤镜算出来的 |
| 花字 56 款 15 类 | `lib/fancy-text.data.ts` | 自设计；不引外部字体、不外链图片，纹理只用 CSS 渐层 |
| 贴纸 117 张 12 类（SVG） | 清单 `lib/stickers.data.ts`；档 `public/vedit/stickers/*.svg` | 自画，透明底，字已转路径，不外链 |
| 音效库 | `lib/sfx-lib.pure.ts` | 程序当场合成（固定种子的纯函数），没有任何素材档 |
| 程序包样例「花字标题弹入」 | `lib/programs.data.ts` | 自写 HTML／canvas，在沙盒 iframe 里跑（`shared/program-sandbox.ts` 挡网路） |

### 一起带的静态档

缩图、贴纸、乐器录音是从静态路径读的，不在这个目录里：

| 夹 | 档 | 谁读 |
|---|---|---|
| `public/vedit/fx/` | 59 张 `<特效或转场 id>.jpg` | 特效、转场页签缩图 |
| `public/vedit/filters/` | 62 张 `<滤镜 id>.jpg` | 滤镜页签缩图 |
| `public/vedit/stickers/` | 117 张 `*.svg` | 贴纸页签、轨道、成片 |
| `public/vedit/licenses/` | `MPL-2.0.txt`、`LGPL-2.1.txt`、`EffectCraft-LICENSE-MIT.txt`、`EffectCraft-NOTICE.txt`、`README.md` | 「第三方授權」小窗 |
| `public/vedit/samples/` | 72 个 mp3 ＋ `CREDITS.txt` | 「编曲」的乐器录音：Salamander 钢琴 CC BY 3.0（要署名，编曲面板与 `CREDITS.txt` 都有署名）；笛子、二胡、古筝 CC0。出处见 `CREDITS.txt` |

## 只有登入版用得到的部分

- 有几支纯函数是给网站的云盘功能用的（单机版里那几条路走不到、不连网）：`lib/upload.pure.ts`（素材自动上传云盘的设定）、`lib/frame.pure.ts`（看某一刻的画面）、`lib/shell-media.pure.ts`、`lib/cloud-proxy.pure.ts`。
- `lib/commands.pure.ts` 是剪辑命令表：单机版的本机 MCP（`video_run`）与 `tools/video-cli.mjs` 都用它；其中 `media.tts`、`media.webShot`、`sfx.add` 要网站先做好，单机版遇到会照实拒。

## 来路不明、没放进游客版的

没有。登入版剪辑页里要伺服器的东西（识别字幕模型、AI 分轨模型、朗读、云盘）都没进游客版，它们的模型档也不在这个目录。

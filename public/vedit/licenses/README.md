# 堤麟剪辑页 · 第三方授权

剪辑页导出成片时，若浏览器自带的 WebCodecs 不能编 AAC，会改加载下列第三方套件来编 AAC 声音。依其授权保留原版权与授权声明如下。

## EffectCraft（关键帧缓动算法）— MIT（与 Apache-2.0 二择一，这里取 MIT）

- 版权：Copyright (c) 2026 ArtCraft Team and the EffectCraft contributors
- 授权：MIT，全文见 `EffectCraft-LICENSE-MIT.txt`；上游 NOTICE 原文见 `EffectCraft-NOTICE.txt`。
- 原始码：https://github.com/storytold/effectcraft （crates/keyframe）
- 剪辑页的关键帧缓动（`src/studio/video/lib/keyframe.pure.ts`）照它的 Rust 算法改写成 TypeScript；没有搬它的程序档、字体或商标。

## @mediabunny/aac-encoder 1.61.3 — MPL-2.0

- 作者：Vanilagy（Mediabunny）
- 授权：Mozilla Public License 2.0，全文见 `MPL-2.0.txt`（即该套件随附的 LICENSE）。
- 原始码：https://github.com/Vanilagy/mediabunny/tree/main/packages/aac-encoder
- 本站未修改该套件，按 npm 发布版原样使用。

## FFmpeg（libavcodec 62.23.103、libavutil）— LGPL-2.1-or-later

上述 @mediabunny/aac-encoder 内含一支由 FFmpeg 的 libavcodec 与 libavutil 以 Emscripten 静态编译成的 WebAssembly 模块（只含 FFmpeg 自带的 AAC 编码器）。该模块内的版本字串为 `Lavc62.23.103`。

- 版权：Copyright (c) the FFmpeg developers（各源码档的个别版权声明见 FFmpeg 原始码）。
- 授权：GNU Lesser General Public License 2.1 或更新版本，全文见 `LGPL-2.1.txt`。
  FFmpeg is free software; you can redistribute it and/or modify it under the terms of the GNU Lesser General Public License as published by the Free Software Foundation; either version 2.1 of the License, or (at your option) any later version.
- 未启用 GPL／nonfree 组件的依据：@mediabunny/aac-encoder 的 README（"Building and development" 一节）给出的 FFmpeg 编译参数为
  `--disable-all --disable-everything --disable-autodetect --enable-avcodec --enable-encoder=aac`（另有关闭汇编、程式、文档、除错、多线程等选项），
  不含 `--enable-gpl`，也不含 `--enable-nonfree`；所用编码器为 FFmpeg 原生 `aac`，非需 nonfree 的 libfdk-aac。
  另检查该 WASM 内的字串，未见 GPL、nonfree 组件名或授权字串（编译配置字串已于最佳化时被裁去，无法从二进制直接读出）。
- 原始码取得处：
  - FFmpeg 原始码：https://ffmpeg.org/download.html （Git：https://github.com/FFmpeg/FFmpeg）
  - 编译方式与 JS／C 桥接原始码：https://github.com/Vanilagy/mediabunny/tree/main/packages/aac-encoder

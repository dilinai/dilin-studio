堤麟画板 · 第三方授权

本画板部分程式照下列开源专案的原始码翻译改写，依其授权保留原版权与授权声明：
- PhotoCraft — Copyright (c) 2026 ArtCraft Team and the PhotoCraft contributors — MIT License（PhotoCraft-LICENSE-MIT.txt、PhotoCraft-NOTICE.txt）
- VectorCraft — Copyright (c) 2026 ArtCraft Team and the VectorCraft contributors — MIT License（VectorCraft-LICENSE-MIT.txt、VectorCraft-NOTICE.txt）
  （两者原为「MIT 或 Apache-2.0 择一」，本画板选用 MIT。）
- SCOWL 英文字典（拼写检查用，menus/impl/ps-edit-dict/）— SCOWL license（SCOWL-LICENSE.txt）
- ag-psd — Copyright (c) 2016 Agamnentzar — MIT License（ag-psd-LICENSE-MIT.txt）：PSD 活文字的 EngineData 结构与禁则字表（menus/impl/psd-io.js）照它写。
- lzokay — Copyright (c) 2018 Jack Andersen — MIT License（lzokay-LICENSE-MIT.txt）：开 Procreate 档用的 LZO1X 解压（menus/impl/raster-io.js 的 lzo1x）照它的解法改写成 JavaScript。

ArtCraft 名称、字标与标志为 ArtCraft Team 的商标，不在上述授权范围内；本画板不使用。

- JPEG 编码器（menus/impl/jpeg-enc.js）— 最佳霍夫曼表／渐进熵编码依 Independent JPEG Group 的 jchuff.c、jcphuff.c 改写成 JavaScript；其余字节输出、直接 DCT、RGBA 准备与自定渐进显示轮次为本画板实现，没有运行时第三方依赖。
  固定核对来源：https://github.com/libjpeg-turbo/libjpeg-turbo/tree/43ea809765004508d8da72ebe562cf570c6a62b2
  原版权保留在 jpeg-enc.js，原 README 全文与 IJG 授权见 JPEG-IJG-README.txt。
  This software is based in part on the work of the Independent JPEG Group.

/* JPEG entropy coding adapted to JavaScript from the Independent JPEG Group / libjpeg-turbo
 * jchuff.c and jcphuff.c (fixed reference: 43ea809765004508d8da72ebe562cf570c6a62b2).
 * Original jchuff.c notices:
 * Copyright (C) 1991-1997, Thomas G. Lane.
 * Lossless JPEG Modifications: Copyright (C) 1999, Ken Murchison.
 * libjpeg-turbo Modifications:
 * Copyright (C) 2009-2011, 2014-2016, 2018-2026, D. R. Commander.
 * Copyright (C) 2015, Matthieu Darbois.
 * Copyright (C) 2018, Matthias Räncker.
 * Copyright (C) 2020, Arm Limited.
 * Copyright (C) 2022, Felix Hanau.
 * Original jcphuff.c notices:
 * Copyright (C) 1995-1997, Thomas G. Lane.
 * Lossless JPEG Modifications: Copyright (C) 1999, Ken Murchison.
 * libjpeg-turbo Modifications:
 * Copyright (C) 2011, 2015, 2018, 2021-2022, 2024-2025, D. R. Commander.
 * Copyright (C) 2016, 2018, 2022, Matthieu Darbois.
 * Copyright (C) 2020, Arm Limited.
 * Copyright (C) 2021, Alex Richardson.
 * JavaScript adaptation and integration: Copyright (C) 2026 Dilin contributors.
 * Changes: byte writer, direct DCT, RGBA preparation, independent progressive scripts,
 * JS optimal Huffman/progressive entropy coding; no libjpeg runtime dependency.
 * This software is based in part on the work of the Independent JPEG Group.
 * For conditions of distribution and use, see licenses/JPEG-IJG-README.txt.
 */
/* JPEG 编码器（纯 JS，照 JPEG 规范 ITU T.81 ＋ libjpeg jchuff.c／jcphuff.c 的写法）——给「存储为 JPEG」的三种格式选项：
   基线（标准）＝SOF0＋附录 K 标准霍夫曼表；基线已优化＝SOF0＋照这张图的符号频率算的最佳霍夫曼表（两遍）；
   连续（渐进）＝SOF2＋频谱选择／逐次逼近多次扫描（每次扫描各自最佳表）。浏览器 canvas.toBlob 只出基线，所以自己编。
   JpegEnc.encode(imageData{data,width,height}, {quality:1..100（IJG 量化表缩放）, mode:'standard'|'optimized'|'progressive', scans:3|4|5, subsample:bool（4:2:0）, dpi}) → Uint8Array
   Adobe 官方 JPEGSaveOptions／Dynamic Media pscan 定义 3／4／5 为渐进显示轮次，不公开逐个 SOS 的安排。
   本编码器自定 SCRIPTS：一轮可以含多个分量扫描（非交错 AC 每次只能一个分量），3／4／5 轮分别有 5／6／7 个 SOS；不宣称是 PS 的扫描脚本。
   依据：https://developer.adobe.com/photoshop/uxp/2022/ps-reference/objects/saveoptions/jpegsaveoptions/
   https://experienceleague.adobe.com/en/docs/dynamic-media-developer-resources/image-serving-api/image-serving-api/http-protocol-reference/command-reference/r-pscan */
(function(){
'use strict';
const ZZ = [0,1,8,16,9,2,3,10,17,24,32,25,18,11,4,5,12,19,26,33,40,48,41,34,27,20,13,6,7,14,21,28,35,42,49,56,57,50,43,36,29,22,15,23,30,37,44,51,58,59,52,45,38,31,39,46,53,60,61,54,47,55,62,63];
// 附录 K.1 量化表（自然顺序）
const QY = [16,11,10,16,24,40,51,61,12,12,14,19,26,58,60,55,14,13,16,24,40,57,69,56,14,17,22,29,51,87,80,62,18,22,37,56,68,109,103,77,24,35,55,64,81,104,113,92,49,64,78,87,103,121,120,101,72,92,95,98,112,100,103,99];
const QC = [17,18,24,47,99,99,99,99,18,21,26,66,99,99,99,99,24,26,56,99,99,99,99,99,47,66,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99];
// 附录 K.3 标准霍夫曼表（bits[1..16]、vals）
const STD = {
  dcY:{bits:[0,1,5,1,1,1,1,1,1,0,0,0,0,0,0,0], vals:[0,1,2,3,4,5,6,7,8,9,10,11]},
  dcC:{bits:[0,3,1,1,1,1,1,1,1,1,1,0,0,0,0,0], vals:[0,1,2,3,4,5,6,7,8,9,10,11]},
  acY:{bits:[0,2,1,3,3,2,4,3,5,5,4,4,0,0,1,0x7d], vals:[0x01,0x02,0x03,0x00,0x04,0x11,0x05,0x12,0x21,0x31,0x41,0x06,0x13,0x51,0x61,0x07,0x22,0x71,0x14,0x32,0x81,0x91,0xa1,0x08,0x23,0x42,0xb1,0xc1,0x15,0x52,0xd1,0xf0,0x24,0x33,0x62,0x72,0x82,0x09,0x0a,0x16,0x17,0x18,0x19,0x1a,0x25,0x26,0x27,0x28,0x29,0x2a,0x34,0x35,0x36,0x37,0x38,0x39,0x3a,0x43,0x44,0x45,0x46,0x47,0x48,0x49,0x4a,0x53,0x54,0x55,0x56,0x57,0x58,0x59,0x5a,0x63,0x64,0x65,0x66,0x67,0x68,0x69,0x6a,0x73,0x74,0x75,0x76,0x77,0x78,0x79,0x7a,0x83,0x84,0x85,0x86,0x87,0x88,0x89,0x8a,0x92,0x93,0x94,0x95,0x96,0x97,0x98,0x99,0x9a,0xa2,0xa3,0xa4,0xa5,0xa6,0xa7,0xa8,0xa9,0xaa,0xb2,0xb3,0xb4,0xb5,0xb6,0xb7,0xb8,0xb9,0xba,0xc2,0xc3,0xc4,0xc5,0xc6,0xc7,0xc8,0xc9,0xca,0xd2,0xd3,0xd4,0xd5,0xd6,0xd7,0xd8,0xd9,0xda,0xe1,0xe2,0xe3,0xe4,0xe5,0xe6,0xe7,0xe8,0xe9,0xea,0xf1,0xf2,0xf3,0xf4,0xf5,0xf6,0xf7,0xf8,0xf9,0xfa]},
  acC:{bits:[0,2,1,2,4,4,3,4,7,5,4,4,0,1,2,0x77], vals:[0x00,0x01,0x02,0x03,0x11,0x04,0x05,0x21,0x31,0x06,0x12,0x41,0x51,0x07,0x61,0x71,0x13,0x22,0x32,0x81,0x08,0x14,0x42,0x91,0xa1,0xb1,0xc1,0x09,0x23,0x33,0x52,0xf0,0x15,0x62,0x72,0xd1,0x0a,0x16,0x24,0x34,0xe1,0x25,0xf1,0x17,0x18,0x19,0x1a,0x26,0x27,0x28,0x29,0x2a,0x35,0x36,0x37,0x38,0x39,0x3a,0x43,0x44,0x45,0x46,0x47,0x48,0x49,0x4a,0x53,0x54,0x55,0x56,0x57,0x58,0x59,0x5a,0x63,0x64,0x65,0x66,0x67,0x68,0x69,0x6a,0x73,0x74,0x75,0x76,0x77,0x78,0x79,0x7a,0x82,0x83,0x84,0x85,0x86,0x87,0x88,0x89,0x8a,0x92,0x93,0x94,0x95,0x96,0x97,0x98,0x99,0x9a,0xa2,0xa3,0xa4,0xa5,0xa6,0xa7,0xa8,0xa9,0xaa,0xb2,0xb3,0xb4,0xb5,0xb6,0xb7,0xb8,0xb9,0xba,0xc2,0xc3,0xc4,0xc5,0xc6,0xc7,0xc8,0xc9,0xca,0xd2,0xd3,0xd4,0xd5,0xd6,0xd7,0xd8,0xd9,0xda,0xe2,0xe3,0xe4,0xe5,0xe6,0xe7,0xe8,0xe9,0xea,0xf2,0xf3,0xf4,0xf5,0xf6,0xf7,0xf8,0xf9,0xfa]}
};
// 自定渐进显示轮次（分量扫描）：c＝分量（0 Y、1 Cb、2 Cr），ss/se＝频谱范围（之字形序号），ah/al＝逐次逼近位
const S = (c, ss, se, ah, al) => ({c, ss, se, ah, al});
const SCRIPTS = {
  3:[S([0,1,2],0,0,0,0), S([0],1,5,0,0), S([1],1,63,0,0), S([2],1,63,0,0), S([0],6,63,0,0)],
  4:[S([0,1,2],0,0,0,1), S([0],1,5,0,0), S([1],1,63,0,0), S([2],1,63,0,0), S([0],6,63,0,0), S([0,1,2],0,0,1,0)],
  5:[S([0,1,2],0,0,0,1), S([0],1,5,0,1), S([1],1,63,0,0), S([2],1,63,0,0), S([0],6,63,0,1), S([0],1,63,1,0), S([0,1,2],0,0,1,0)]
};

function qtable(base, quality){
  const q = Math.max(1, Math.min(100, Math.round(quality))), sc = q < 50 ? 5000 / q : 200 - q * 2;
  return base.map(v => Math.max(1, Math.min(255, Math.floor((v * sc + 50) / 100))));
}
// 8×8 正向 DCT（可分离，浮点）
const COS = new Float64Array(64);
for (let u = 0; u < 8; u++) for (let x = 0; x < 8; x++) COS[u * 8 + x] = Math.cos((2 * x + 1) * u * Math.PI / 16) * (u === 0 ? Math.SQRT1_2 : 1) / 2;
const TMP = new Float64Array(64);
function fdct(inp, out){
  for (let y = 0; y < 8; y++) for (let u = 0; u < 8; u++){ let s = 0; for (let x = 0; x < 8; x++) s += COS[u * 8 + x] * inp[y * 8 + x]; TMP[y * 8 + u] = s; }
  for (let u = 0; u < 8; u++) for (let v = 0; v < 8; v++){ let s = 0; for (let y = 0; y < 8; y++) s += COS[v * 8 + y] * TMP[y * 8 + u]; out[v * 8 + u] = s; }
}

/* RGBA → 三个分量的量化系数块（之字形顺序 Int16Array(64)），块格子补到 MCU 整数倍（边缘复制） */
function prepare(img, quality, sub){
  const W = img.width, H = img.height, d = img.data, hm = sub ? 2 : 1;
  const mx = Math.ceil(W / (8 * hm)), my = Math.ceil(H / (8 * hm));
  const qt = [qtable(QY, quality), qtable(QC, quality)];
  const comps = [{id:1, h:hm, v:hm, tq:0}, {id:2, h:1, v:1, tq:1}, {id:3, h:1, v:1, tq:1}];
  const Y = new Float32Array(W * H), Cb = new Float32Array(W * H), Cr = new Float32Array(W * H);
  for (let i = 0, j = 0; i < W * H; i++, j += 4){
    const r = d[j], g = d[j + 1], b = d[j + 2];
    Y[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    Cb[i] = -0.168736 * r - 0.331264 * g + 0.5 * b + 128;
    Cr[i] = 0.5 * r - 0.418688 * g - 0.081312 * b + 128;
  }
  const planes = [Y, Cb, Cr], blk = new Float64Array(64), co = new Float64Array(64);
  comps.forEach((c, ci) => {
    const bw = mx * c.h, bh = my * c.v, f = hm / c.h, P = planes[ci], q = qt[c.tq], blocks = new Array(bw * bh);
    c.bw = bw; c.bh = bh;
    c.nbw = Math.ceil(Math.ceil(W * c.h / hm) / 8); c.nbh = Math.ceil(Math.ceil(H * c.v / hm) / 8);   // 非交错扫描只走真有画面的块
    for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++){
      for (let yy = 0; yy < 8; yy++) for (let xx = 0; xx < 8; xx++){
        let s = 0;
        for (let sy = 0; sy < f; sy++) for (let sx = 0; sx < f; sx++){
          const X = Math.min(W - 1, ((bx * 8 + xx) * f) + sx), Yp = Math.min(H - 1, ((by * 8 + yy) * f) + sy);
          s += P[Yp * W + X];
        }
        blk[yy * 8 + xx] = s / (f * f) - 128;
      }
      fdct(blk, co);
      const z = new Int16Array(64);
      for (let k = 0; k < 64; k++){ const n = ZZ[k]; z[k] = Math.round(co[n] / q[n]); }
      blocks[by * bw + bx] = z;
    }
    c.blocks = blocks;
  });
  return {W, H, mx, my, comps, qt};
}

/* 霍夫曼：频率 → 最佳表（libjpeg jpeg_gen_optimal_table，码长上限 16、留全 1 码） */
function optimal(freq0){
  const freq = Float64Array.from(freq0); freq[256] = 1;
  const size = new Int32Array(257), others = new Int32Array(257).fill(-1);
  for (;;){
    let c1 = -1, v = Infinity;
    for (let i = 0; i <= 256; i++) if (freq[i] && freq[i] <= v){ v = freq[i]; c1 = i; }
    let c2 = -1; v = Infinity;
    for (let i = 0; i <= 256; i++) if (freq[i] && freq[i] <= v && i !== c1){ v = freq[i]; c2 = i; }
    if (c2 < 0) break;
    freq[c1] += freq[c2]; freq[c2] = 0;
    size[c1]++; while (others[c1] >= 0){ c1 = others[c1]; size[c1]++; }
    others[c1] = c2;
    size[c2]++; while (others[c2] >= 0){ c2 = others[c2]; size[c2]++; }
  }
  const bits = new Int32Array(33);
  for (let i = 0; i <= 256; i++) if (size[i]) bits[size[i]]++;
  for (let i = 32; i > 16; i--) while (bits[i] > 0){ let j = i - 2; while (bits[j] === 0) j--; bits[i] -= 2; bits[i - 1]++; bits[j + 1] += 2; bits[j]--; }
  let i = 16; while (bits[i] === 0) i--; bits[i]--;
  const vals = [];
  for (let L = 1; L <= 32; L++) for (let s = 0; s < 256; s++) if (size[s] === L) vals.push(s);
  return {bits:Array.from(bits.slice(1, 17)), vals};
}
function derive(t){
  const code = new Int32Array(256), len = new Int32Array(256);
  let c = 0, k = 0;
  for (let L = 1; L <= 16; L++){ for (let n = 0; n < t.bits[L - 1]; n++){ const s = t.vals[k++]; code[s] = c++; len[s] = L; } c <<= 1; }
  return {code, len};
}

/* 位元写出（0xFF 后补 0x00） */
function Out(){ this.buf = new Uint8Array(1 << 16); this.n = 0; this.acc = 0; this.cnt = 0; }
Out.prototype.byte = function(b){ if (this.n >= this.buf.length){ const nb = new Uint8Array(this.buf.length * 2); nb.set(this.buf); this.buf = nb; } this.buf[this.n++] = b; };
Out.prototype.bytes = function(a){ for (const b of a) this.byte(b); };
Out.prototype.word = function(w){ this.byte(w >> 8 & 255); this.byte(w & 255); };
Out.prototype.bits = function(v, n){
  for (let i = n - 1; i >= 0; i--){
    this.acc = (this.acc << 1) | ((v >>> i) & 1);
    if (++this.cnt === 8){ this.byte(this.acc); if (this.acc === 0xff) this.byte(0); this.acc = 0; this.cnt = 0; }
  }
};
Out.prototype.flush = function(){ if (this.cnt) this.bits((1 << (8 - this.cnt)) - 1, 8 - this.cnt); };
Out.prototype.marker = function(m, body){ this.byte(0xff); this.byte(m); this.word(body.length + 2); this.bytes(body); };

const nbits = v => { v = Math.abs(v); let n = 0; while (v){ n++; v >>= 1; } return n; };

/* 一次扫描的熵编码。E：{sym(tbl, s), bits(v, n)}；tbl＝'d0'/'d1'/'a0'/'a1'（数＝表号） */
function runScan(P, sc, E){
  const comps = sc.c.map(i => P.comps[i]), last = [0, 0, 0];
  const dcT = c => 'd' + (c.tq ? 1 : 0), acT = c => 'a' + (c.tq ? 1 : 0);
  const dcSym = (c, diff) => { const s = nbits(diff); E.sym(dcT(c), s); if (s) E.bits(diff < 0 ? diff - 1 : diff, s); };
  const each = fn => {                                                   // 交错＝照 MCU；单一分量＝照分量自己的块格子
    if (comps.length > 1){ for (let my = 0; my < P.my; my++) for (let mx = 0; mx < P.mx; mx++) comps.forEach((c, k) => { for (let v = 0; v < c.v; v++) for (let h = 0; h < c.h; h++) fn(c, c.blocks[(my * c.v + v) * c.bw + mx * c.h + h], sc.c[k]); }); }
    else { const c = comps[0]; for (let by = 0; by < c.nbh; by++) for (let bx = 0; bx < c.nbw; bx++) fn(c, c.blocks[by * c.bw + bx], sc.c[0]); }
  };
  if (!sc.prog){                                                         // 基线：整块（DC＋AC）
    each((c, z, ci) => {
      const diff = z[0] - last[ci]; last[ci] = z[0]; dcSym(c, diff);
      let r = 0;
      for (let k = 1; k < 64; k++){
        const v = z[k]; if (!v){ r++; continue; }
        while (r > 15){ E.sym(acT(c), 0xf0); r -= 16; }
        const s = nbits(v); E.sym(acT(c), (r << 4) | s); E.bits(v < 0 ? v - 1 : v, s); r = 0;
      }
      if (r) E.sym(acT(c), 0);
    });
    return;
  }
  const {ss, se, ah, al} = sc;
  if (ss === 0){
    if (!ah) each((c, z, ci) => { const t = z[0] >> al, diff = t - last[ci]; last[ci] = t; dcSym(c, diff); });
    else each((c, z) => E.bits((z[0] >> al) & 1, 1));
    return;
  }
  // AC（单一分量）：EOBRUN／修正位缓冲照 jcphuff.c
  const c = comps[0], T = acT(c), MAXB = 1000, bitbuf = new Uint8Array(MAXB);
  let EOBRUN = 0, BE = 0;
  const emitBuf = (off, n) => { for (let i = 0; i < n; i++) E.bits(bitbuf[off + i], 1); };
  const eob = () => {
    if (!EOBRUN) return;
    let t = EOBRUN, n = 0; while ((t >>= 1)) n++;
    E.sym(T, n << 4); if (n) E.bits(EOBRUN, n);
    EOBRUN = 0; emitBuf(0, BE); BE = 0;
  };
  if (!ah){
    each((cc, z) => {
      let r = 0;
      for (let k = ss; k <= se; k++){
        let t = z[k]; if (!t){ r++; continue; }
        let t2;
        if (t < 0){ t = (-t) >> al; t2 = ~t; } else { t >>= al; t2 = t; }
        if (!t){ r++; continue; }
        eob();
        while (r > 15){ E.sym(T, 0xf0); r -= 16; }
        const s = nbits(t); E.sym(T, (r << 4) | s); E.bits(t2, s); r = 0;
      }
      if (r){ EOBRUN++; if (EOBRUN === 0x7fff) eob(); }
    });
  } else {
    const absv = new Int32Array(64);
    each((cc, z) => {
      let EOB = 0;
      for (let k = ss; k <= se; k++){ const t = Math.abs(z[k]) >> al; absv[k] = t; if (t === 1) EOB = k; }
      let r = 0, BR = 0, bro = BE;
      for (let k = ss; k <= se; k++){
        const t = absv[k]; if (!t){ r++; continue; }
        while (r > 15 && k <= EOB){ eob(); E.sym(T, 0xf0); r -= 16; emitBuf(bro, BR); bro = 0; BR = 0; }
        if (t > 1){ bitbuf[bro + BR++] = t & 1; continue; }
        eob(); E.sym(T, (r << 4) | 1); E.bits(z[k] < 0 ? 0 : 1, 1);
        emitBuf(bro, BR); bro = 0; BR = 0; r = 0;
      }
      if (r > 0 || BR > 0){ EOBRUN++; BE += BR; if (EOBRUN === 0x7fff || BE > MAXB - 64 + 1) eob(); }
    });
  }
  eob();
}

function dhtBody(cls, id, t){ return [(cls << 4) | id].concat(t.bits, t.vals); }

function encode(img, o){
  o = o || {};
  const mode = o.mode === 'optimized' || o.mode === 'progressive' ? o.mode : 'standard';
  const P = prepare(img, o.quality === undefined ? 85 : o.quality, !!o.subsample);
  const out = new Out();
  out.byte(0xff); out.byte(0xd8);
  const dpi = Math.max(1, Math.min(65535, Math.round(o.dpi || 72)));
  out.marker(0xe0, [0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 1, dpi >> 8, dpi & 255, dpi >> 8, dpi & 255, 0, 0]);
  P.qt.forEach((q, id) => out.marker(0xdb, [id].concat(ZZ.map(n => q[n]))));
  const prog = mode === 'progressive';
  const sof = [8, P.H >> 8, P.H & 255, P.W >> 8, P.W & 255, 3];
  P.comps.forEach(c => sof.push(c.id, (c.h << 4) | c.v, c.tq));
  out.marker(prog ? 0xc2 : 0xc0, sof);
  const scans = prog ? (SCRIPTS[o.scans] || SCRIPTS[3]).map(s => Object.assign({prog:true}, s)) : [{c:[0, 1, 2], ss:0, se:63, ah:0, al:0, prog:false}];
  for (const sc of scans){
    let tabs;
    if (mode === 'standard') tabs = {d0:STD.dcY, d1:STD.dcC, a0:STD.acY, a1:STD.acC};
    else {                                                               // 第一遍：数符号 → 最佳表
      const freq = {};
      runScan(P, sc, {sym:(t, s) => { (freq[t] || (freq[t] = new Float64Array(257)))[s]++; }, bits:() => {}});
      tabs = {}; for (const t in freq) tabs[t] = optimal(freq[t]);
    }
    if (mode !== 'standard' || sc === scans[0]){                       // 标准表只写一次；最佳表每次扫描各写自己的
      const body = [];
      Object.keys(tabs).forEach(t => { body.push(...dhtBody(t[0] === 'd' ? 0 : 1, +t[1], tabs[t])); });
      if (body.length) out.marker(0xc4, body);
    }
    const codes = {}; for (const t in tabs) codes[t] = derive(tabs[t]);
    const sos = [sc.c.length];
    sc.c.forEach(i => { const c = P.comps[i], k = c.tq ? 1 : 0; sos.push(c.id, (k << 4) | k); });
    sos.push(sc.ss, sc.se, (sc.ah << 4) | sc.al);
    out.marker(0xda, sos);
    runScan(P, sc, {sym:(t, s) => { const d = codes[t]; out.bits(d.code[s], d.len[s]); }, bits:(v, n) => out.bits(v, n)});
    out.flush();
  }
  out.byte(0xff); out.byte(0xd9);
  return out.buf.slice(0, out.n);
}

/* 读标记（测试／预估用）：→ {sof:0xc0|0xc2…, scans:SOS 段数, dht:DHT 段数} */
function inspect(u){
  const r = {sof:null, scans:0, dht:0, markers:[]};
  let i = 2;
  while (i + 4 <= u.length){
    if (u[i] !== 0xff){ i++; continue; }
    const m = u[i + 1];
    if (m === 0xd9){ r.markers.push(m); break; }
    if (m === 0x00 || (m >= 0xd0 && m <= 0xd7) || m === 0xff){ i++; continue; }
    const len = (u[i + 2] << 8) | u[i + 3];
    r.markers.push(m);
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) r.sof = m;
    if (m === 0xc4) r.dht++;
    if (m === 0xda){
      r.scans++; i += 2 + len;
      while (i + 1 < u.length && !(u[i] === 0xff && u[i + 1] !== 0 && !(u[i + 1] >= 0xd0 && u[i + 1] <= 0xd7))) i++;   // 跳过熵编码资料
      continue;
    }
    i += 2 + len;
  }
  return r;
}

window.JpegEnc = {encode, inspect, SCRIPTS};
})();

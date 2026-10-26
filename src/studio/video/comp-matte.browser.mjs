#!/usr/bin/env node
// 巢状合成＋画面层轨道遮罩·像素题（真画布）：comp-matte.px-entry.ts 用 esbuild 打包·无头 Chromium 里照汇出那支 frameDrawer 画一格、取点比颜色。
//   成片、静帧、角色看帧（video_edit_frame）、预览 PlanCanvas（frame(t, only)）都是这一支 ⇒ 这里对了四处就一致；另验 only（预览那条路）跟整格一样。
// 跑法（在 studio 根目录跑）：node video/comp-matte.browser.mjs
//   要 esbuild 与 playwright（Chromium）：node_modules 里没有 esbuild ⇒ 设 VEDIT_ESBUILD=<esbuild 套件目录>。
// 负控（每题都跑）：拿掉合成清单（env 不带 comps＝没有巢状渲染）⇒ N 红；拿掉 look.matte（没有轨道遮罩）⇒ M 红——负控要红、正题要绿才算过。
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const esbuild = require(process.env.VEDIT_ESBUILD || 'esbuild')
const { chromium } = require('playwright')

const W = 160, H = 90
const L = (id, kind, clips) => ({ id, kind, locked: false, hidden: false, muted: false, clips })
const solid = (id, start, length, color, more = {}) => ({ id, mediaId: '', start, length, offset: 0, solid: { color }, ...more })
const rect = (id, start, length, color, w, h) => ({ id, mediaId: '', start, length, offset: 0, shape: { shape: 'rect', stroke: color, width: 0.002, fill: color, radius: 0, w, h } })
const comp = (id, start, length, compId, more = {}) => ({ id, mediaId: '', start, length, offset: 0, comp: compId, ...more })
const near = (a, b, eps = 4) => a.every((v, i) => Math.abs(v - b[i]) <= eps)

// N：两层巢状——外层合成 outer（红底＋一段合成段放 inner·缩 0.5·offset 1）整段不透明度 0.5；inner＝1:1 合成·0–1 秒绿、1–2 秒蓝
//   ⇒ t=0.5 时 inner 画第 1.5 秒（蓝）：中心＝蓝×0.5、正方形外＝红×0.5（黑底）
const N = {
  tracks: [L('main', 'visual', [comp('k1', 0, 2, 'outer', { look: { opacity: 0.5 } })])],
  comps: {
    outer: { name: 'outer', ratio: { kind: 'fit' }, tracks: [L('up', 'visual', [comp('k2', 0, 2, 'inner', { offset: 1, look: { sx: 0.5, sy: 0.5 } })]), L('main', 'visual', [solid('r', 0, 2, '#ff0000')])] },
    inner: { name: 'inner', ratio: { kind: 'preset', key: '1:1' }, length: 3, tracks: [L('main', 'visual', [solid('g', 0, 1, '#00ff00'), solid('b', 1, 2, '#0000ff')])] },
  },
  t: 0.5, w: W, h: H, pts: [[80, 45], [40, 45], [5, 5]],
}
const N_WANT = [[0, 0, 128, 255], [128, 0, 0, 255], [128, 0, 0, 255]]

// M：上方轨一块灰（#808080）方块（画面中间一半）当遮罩·下面合成段（整片蓝）挂 look.matte 指定那一块·四种方式
const M = (mode, invert) => ({
  tracks: [L('top', 'visual', [rect('m', 0, 2, '#808080', 0.5, 0.5)]), L('main', 'visual', [comp('u', 0, 2, 'blue', { look: { matte: { clip: 'm', mode, ...(invert ? { invert: true } : {}) } } })])],
  comps: { blue: { name: 'blue', ratio: { kind: 'fit' }, tracks: [L('main', 'visual', [solid('bb', 0, 2, '#0000ff')])] } },
  t: 0.5, w: W, h: H, pts: [[80, 45], [5, 5]],
})
// 中心（遮罩里：灰 128·不透明）／角落（遮罩外：透明）·遮罩层本身不画（中心不会是灰）
// R：跟父子连结／3D 并存——空物件（不透明度 0.5）当父层·合成段 parentAlpha＋轨道遮罩 ⇒ 中心蓝×0.5（走 drawRigged 暂存那张·遮罩照挂）；
//   合成段开 3D 推远一倍（z＝缺省摄影机距离）⇒ 缩一半：中心蓝、左边 1/4 处与角落黑
const blueComp = { blue: { name: 'blue', ratio: { kind: 'fit' }, tracks: [L('main', 'visual', [solid('bb', 0, 2, '#0000ff')])] } }
const R1 = {
  tracks: [L('top', 'visual', [rect('m', 0, 2, '#808080', 0.5, 0.5)]), L('nl', 'visual', [{ id: 'n', mediaId: '', start: 0, length: 2, offset: 0, rig: { kind: 'null' }, look: { opacity: 0.5 } }]),
    L('main', 'visual', [comp('u', 0, 2, 'blue', { parent: 'n', parentAlpha: true, look: { matte: { clip: 'm', mode: 'alpha' } } })])],
  comps: blueComp, t: 0.5, w: W, h: H, pts: [[80, 45], [5, 5]],
}
const R1_WANT = [[0, 0, 128, 255], [0, 0, 0, 255]]
const R2 = { tracks: [L('main', 'visual', [comp('u', 0, 2, 'blue', { d3: { z: 1.3737 } })])], comps: blueComp, t: 0.5, w: W, h: H, pts: [[80, 45], [30, 45], [5, 5]] }
const R2_WANT = [[0, 0, 255, 255], [0, 0, 0, 255], [0, 0, 0, 255]]
const M_CASES = [
  ['alpha', false, [[0, 0, 255, 255], [0, 0, 0, 255]]],
  ['alpha', true, [[0, 0, 0, 255], [0, 0, 255, 255]]],
  ['luma', false, [[0, 0, 128, 255], [0, 0, 0, 255]]],
  ['luma', true, [[0, 0, 127, 255], [0, 0, 255, 255]]],
]

const built = await esbuild.build({
  entryPoints: [join(here, 'comp-matte.px-entry.ts')], bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022', logLevel: 'silent',
  external: ['@mediabunny/aac-encoder'], // 只有编 AAC 才载·像素题用不到
  // 网站那边 next 建置时把 process.env 换掉；这里给个空的（药开关只在 node 认·浏览器里一律关）
  banner: { js: 'globalThis.process = globalThis.process || { env: {} };' },
  // '@/…'＝core/…（同网站 tsconfig paths）
  plugins: [{ name: 'core-alias', setup(b) { b.onResolve({ filter: /^@\// }, async (a) => b.resolve('./' + a.path.slice(2), { resolveDir: join(here, '..', '..'), kind: a.kind })) } }],
})
const code = built.outputFiles[0].text
const browser = await chromium.launch()
let n = 0, bad = 0
const ok = (name, cond, detail) => { if (cond) { n++; console.log('✓', name) } else { bad++; console.log('✗', name); if (detail) console.log('  ', detail) } }
try {
  const page = await browser.newPage()
  page.on('pageerror', (e) => console.log('  [页面错误]', String(e).slice(0, 300)))
  await page.setContent('<!doctype html><html><body></body></html>')
  await page.addScriptTag({ content: code })
  const run = (c) => page.evaluate((x) => globalThis.vnmRun(x), c)
  const strip = (c, what) => (what === 'comps' ? { ...c, comps: undefined } : JSON.parse(JSON.stringify(c), (k, v) => (k === 'matte' ? undefined : v)))

  const got = await run(N)
  ok('N 两层巢状：合成里再放合成（缩放·offset 取到合成第 1.5 秒）·外层不透明度——中心蓝×0.5、外围红×0.5', got.every((p, i) => near(p, N_WANT[i])), JSON.stringify(got))
  const gotOnly = await run({ ...N, only: ['k1'] })
  ok('N′ 预览那条路（frame(t, only)＝PlanCanvas）跟整格一样', JSON.stringify(gotOnly) === JSON.stringify(got), JSON.stringify(gotOnly))
  const neg = await run(strip(N, 'comps'))
  ok('N 负控：拿掉巢状渲染（不带合成清单）⇒ 像素不对（要红）', !neg.every((p, i) => near(p, N_WANT[i])), JSON.stringify(neg))

  for (const [mode, inv, want] of M_CASES) {
    const name = `${mode}${inv ? '反相' : ''}`
    const c = M(mode, inv)
    const g = await run(c)
    ok(`M ${name}：遮罩里／外的颜色对·遮罩层（灰块）本身不画`, g.every((p, i) => near(p, want[i], 2)), JSON.stringify(g))
    const go = await run({ ...c, only: ['u'] })
    ok(`M′ ${name}：预览那条路（only 只画用遮罩的那段）跟整格一样`, JSON.stringify(go) === JSON.stringify(g), JSON.stringify(go))
    const ng = await run(strip(c, 'matte'))
    ok(`M ${name} 负控：拿掉轨道遮罩 ⇒ 像素不对（要红）`, !ng.every((p, i) => near(p, want[i], 2)), JSON.stringify(ng))
  }
  const r1 = await run(R1)
  ok('R1 父层（空物件·不透明度 0.5·parentAlpha）＋合成段＋轨道遮罩：中心蓝×0.5、遮罩外黑', r1.every((p, i) => near(p, R1_WANT[i], 2)), JSON.stringify(r1))
  const r1n = await run(JSON.parse(JSON.stringify(R1), (k, v) => (k === 'parent' || k === 'parentAlpha' ? undefined : v)))
  ok('R1 负控：拿掉父子连结 ⇒ 像素不对（要红）', !r1n.every((p, i) => near(p, R1_WANT[i], 2)), JSON.stringify(r1n))
  const r2 = await run(R2)
  ok('R2 合成段开 3D 推远一倍 ⇒ 缩一半（中心蓝·外围黑）', r2.every((p, i) => near(p, R2_WANT[i], 2)), JSON.stringify(r2))
} finally { await browser.close() }
console.log(`comp-matte.browser → ${n} 过 ${bad} 败`)
if (bad) process.exit(1)

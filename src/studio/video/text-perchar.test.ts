// 文字逐字动画题（需求单第 1、2、9 项）：字距下限 -1em·逐字计算（第 n 个字在时刻 t 的状态）·预览与汇出同一支纯函数·旧工程不变·命令 text.setAnim stagger。
// 跑法（在 studio 根目录跑）：node -e "require('sucrase/register/ts');require('./video/text-perchar.test.ts')"
// 药：DILIN_NEG=vedit_perchar_auto_off ⇒ 没设间隔退回固定 0.06 ⇒ S 红。
// 药：DILIN_NEG=vedit_text_perchar_off ⇒ charPoseAt 恒 CHAR_IDLE、charPoses 恒 null（逐字不生效）⇒ B／C／D／F 红。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ANIM_IN, ANIM_OUT, CHAR_IDLE, STAGGER, animDef, autoStagger, charCss, charMatrix, charPoseAt, charPoses, charTiming, parseTextAnim, textAnimPose, poseIdle, type CharPose,
} from './lib/text-anim.pure'
import { LETTER_SPACING_MIN, parseTextLook } from './lib/text-style.pure'
import { VISUAL_ANIM_LIB } from './lib/clip-look.pure'
import { applyCommands } from './lib/commands.pure'
import { drawTextBody } from './lib/text-draw'
import type { TextBody } from './lib/timeline.pure'

let n = 0, bad = 0
function test(name: string, fn: () => void) {
  try { fn(); n++; console.log('✓', name) } catch (e) { bad++; console.log('✗', name); console.log('  ', (e as Error).message.split('\n').slice(0, 6).join('\n   ')) }
}
const near = (a: number, b: number, eps = 1e-6, msg = '') => assert.ok(Math.abs(a - b) < eps, `${msg} ${a} ≠ ${b}`)
// node 没有画布：离屏画布给一个什么都不做的 2d（只录主画布的 transform）
const dummyCtx = () => new Proxy({} as Record<string, unknown>, { get: (o, k) => k in o ? o[k as string] : k === 'measureText' ? (s: string) => ({ width: s.length * 10 }) : k === 'createLinearGradient' || k === 'createPattern' ? () => ({ addColorStop() {} }) : () => undefined, set: (o, k, v) => { o[k as string] = v; return true } })
;(globalThis as Record<string, unknown>).OffscreenCanvas ??= class { constructor(public width: number, public height: number) {} getContext() { return dummyCtx() } }
const PC = ['fade', 'spin', 'fold', 'standup', 'pop']

test('A 字间距下限 -1em：读档验值收 -1·更小夹到 -1·面板／命令表／AI 说明同步', () => {
  assert.equal(LETTER_SPACING_MIN, -1)
  assert.equal(parseTextLook({ letterSpacing: -0.8 }).letterSpacing, -0.8)
  assert.equal(parseTextLook({ letterSpacing: -1 }).letterSpacing, -1)
  assert.equal(parseTextLook({ letterSpacing: -3 }).letterSpacing, -1)
  const proj = readFileSync(join(__dirname, 'lib/project.pure.ts'), 'utf8')
  assert.match(proj, /letterSpacing\(em -1\.\.2\)/)
  assert.match(readFileSync(join(__dirname, 'ui/ManualPane.tsx'), 'utf8'), /LETTER_SPACING_MIN/)
  const raw = { v: 1, media: [], tracks: [{ id: 'main', kind: 'visual', clips: [] }, { id: 'tl', kind: 'text', clips: [{ id: 't', mediaId: '', start: 0, length: 3, offset: 0, text: { content: 'AB', x: 0.5, y: 0.5, size: 0.1 } }] }] }
  const r = applyCommands(raw, [{ command: 'text.update', params: { clip: 't', letterSpacing: -0.9 } }])
  assert.ok(r.ok, JSON.stringify(r))
  const t = (r as { project: { tracks: Array<{ clips: Array<{ text?: TextBody }> }> } }).project.tracks.flatMap((l) => l.clips).find((c) => c.text)!.text!
  assert.equal(t.letterSpacing, -0.9)
})

test('B 逐字计算：第 i 个字在 t 秒的状态（间隔 stagger·每字时长＝总长−间隔×(n−1)）', () => {
  for (const k of PC) { assert.ok(animDef('in', `in-pc-${k}`)?.perChar, k); assert.ok(animDef('out', `out-pc-${k}`)?.perChar, k) }
  const a = { in: { id: 'in-pc-fade', dur: 1, stagger: 0.1 } }
  const tm = charTiming(1, 5, 0.1); near(tm.gap, 0.1); near(tm.each, 0.6)
  assert.equal(charPoseAt(a, 0, 5, 0, 4).alpha, 0)
  const c0 = charPoseAt(a, 0, 5, 0.3, 4), c4 = charPoseAt(a, 4, 5, 0.3, 4)
  assert.ok(c0.alpha > 0 && c0.alpha < 1, `c0 ${c0.alpha}`); assert.equal(c4.alpha, 0)
  assert.ok(charPoseAt(a, 2, 5, 0.5, 4).alpha > charPoseAt(a, 3, 5, 0.5, 4).alpha, '前面的字先出来')
  assert.deepEqual(charPoseAt(a, 4, 5, 1.2, 4), CHAR_IDLE)
  // 站起：一开始每字绕横轴 -90°（扁平躺着）·轴在字底边·矩阵竖向缩到 0
  const s = charPoseAt({ in: { id: 'in-pc-standup', dur: 1 } }, 0, 3, 0, 3)
  near(s.rx, -90); near(s.pivot, 0.5); near(charMatrix(s)[3], 0, 1e-9)
  // 逐字旋转：绕直轴翻·横向缩 cos(ry)
  const sp = charPoseAt({ in: { id: 'in-pc-spin', dur: 1, stagger: 0 } }, 1, 3, 0.2, 3)
  assert.ok(sp.ry < 0 && sp.ry > -180); near(charMatrix(sp)[0], Math.cos((sp.ry * Math.PI) / 180))
  // 出场：最后那段时间逐字退
  const o = { out: { id: 'out-pc-pop', dur: 1, stagger: 0.1 } }
  assert.deepEqual(charPoseAt(o, 0, 3, 1, 4), CHAR_IDLE)
  const e0 = charPoseAt(o, 0, 3, 3.95, 4), e2 = charPoseAt(o, 2, 3, 3.5, 4)
  assert.ok(e0.sx < 0.5, `e0 ${e0.sx}`); assert.ok(e2.sx > e0.sx)
  // stagger 太大自动压：n 很多也不会超出入场那段
  const big = charTiming(1, 50, 1); assert.ok(big.gap * 49 <= 0.7 + 1e-9 && big.each > 0)
})

test('C 预览与汇出同一函数：charCss 与 canvas 每字 transform 都由 charMatrix(charPoseAt) 而来', () => {
  const b: TextBody = { content: 'AB\nC', x: 0.5, y: 0.5, size: 0.1, anim: { in: { id: 'in-pc-fold', dur: 1, stagger: 0.2 } } }
  const t = 0.35
  const pcs = charPoses(b.anim, 3, t, 4)!
  assert.ok(pcs && pcs.length === 3)
  // 汇出：录下 canvas 的 transform 调用
  const calls: number[][] = []
  const ctx: Record<string, unknown> = new Proxy({ globalAlpha: 1, canvas: { width: 1920, height: 1080 } } as Record<string, unknown>, {
    get: (o, k) => k in o ? o[k as string] : k === 'measureText' ? (s: string) => ({ width: s.length * 10, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 })
      : k === 'transform' ? (...v: number[]) => calls.push(v) : k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => undefined,
    set: (o, k, v) => { o[k as string] = v; return true },
  })
  drawTextBody(ctx as unknown as CanvasRenderingContext2D, b, 1920, 1080, { t, length: 4 })
  const px = 0.1 * 1080
  const drawn = pcs.filter((q) => q.alpha > 0)
  assert.equal(calls.length, drawn.length, `每个看得到的字一笔 transform（${calls.length}）`)
  drawn.forEach((q, i) => { const m = charMatrix(q); m.forEach((v, j) => near(calls[i][j], j >= 4 ? v * px : v, 1e-6, `字${i}[${j}]`)) })
  // 预览：CSS 字串里的数字＝同一份 charMatrix
  for (const q of pcs) {
    const m = charMatrix(q), css = charCss(q)
    const nums = css.transform.match(/-?\d+(\.\d+)?(e-?\d+)?/g)!.map(Number)
    ;[m[4], m[5], m[0], m[1], m[2], m[3]].forEach((v, j) => near(nums[j], v, 1e-5))
    assert.equal(css.opacity, q.alpha)
  }
  // 两边接线：页面叠字与汇出都调 charPoses
  const pg = readFileSync(join(__dirname, 'page/VideoEditPage.tsx'), 'utf8'), td = readFileSync(join(__dirname, 'lib/text-draw.ts'), 'utf8'), ft = readFileSync(join(__dirname, 'ui/FancyText.tsx'), 'utf8')
  assert.match(pg, /charPoses\(tb\.anim, charCount\(displayText\(tb\)\), s\.hit!\.local - c\.offset, c\.length\)/); assert.match(pg, /perChar=\{pcs\?\.map\(charCss\)\}/)
  assert.match(td, /charPoses\(b\.anim, charCount\(displayText\(b\)\), at\.t, at\.length\)/); assert.match(td, /charMatrix\(q\)/)
  assert.match(ft, /perChar\[pi\+\+\]/)
})

test('D 3D 透视近似：翻转时有斜切（不是纯缩放）·静止＝单位矩阵', () => {
  const q: CharPose = { ...CHAR_IDLE, ry: -60 }
  const m = charMatrix(q); assert.ok(Math.abs(m[1]) > 0.1, '翻 ry 有竖斜切'); near(m[0], 0.5)
  const r: CharPose = { ...CHAR_IDLE, rx: 60 }
  const mr = charMatrix(r); assert.ok(Math.abs(mr[2]) > 0.1, '翻 rx 有横斜切'); near(mr[3], 0.5)
  assert.deepEqual(charMatrix(CHAR_IDLE).map((v) => v + 0), [1, 0, 0, 1, 0, 0])
  // 折叠期间确实在翻
  assert.ok(Math.abs(charPoseAt({ in: { id: 'in-pc-fold', dur: 1 } }, 0, 1, 0.1, 2).rx) > 10)
})

test('E 旧工程不变：旧款无 stagger、逐字 null、整段姿势照旧；画面片段／贴纸动画库不收逐字款', () => {
  assert.deepEqual(parseTextAnim({ in: { id: 'in-fade', dur: 0.5, stagger: 0.3 } }), { in: { id: 'in-fade', dur: 0.5 } })
  assert.deepEqual(parseTextAnim({ in: { id: 'in-pc-pop', dur: 0.5, stagger: 9 } }), { in: { id: 'in-pc-pop', dur: 0.5, stagger: STAGGER.max } })
  assert.equal(charPoses({ in: { id: 'in-fade', dur: 1 } }, 3, 0.2, 4), null)
  assert.equal(charPoses(undefined, 3, 0.2, 4), null)
  assert.ok(poseIdle(textAnimPose({ in: { id: 'in-pc-spin', dur: 1 } }, 0.2, 4)), '逐字款不动整段')
  assert.ok(!VISUAL_ANIM_LIB.in.some((d) => d.perChar) && !VISUAL_ANIM_LIB.out.some((d) => d.perChar))
  assert.equal(ANIM_IN.filter((d) => d.perChar).length, 5); assert.equal(ANIM_OUT.filter((d) => d.perChar).length, 5)
  assert.deepEqual(ANIM_IN.slice(0, 2).map((d) => d.id), ['in-fade', 'in-zoom-up'])
  // 旧款画法：汇出没有逐字 transform
  const calls: unknown[] = []
  const ctx = new Proxy({} as Record<string, unknown>, { get: (o, k) => k in o ? o[k as string] : k === 'measureText' ? (s: string) => ({ width: s.length * 10 }) : k === 'transform' ? () => calls.push(1) : () => undefined, set: (o, k, v) => { o[k as string] = v; return true } })
  drawTextBody(ctx as unknown as CanvasRenderingContext2D, { content: 'AB', x: 0.5, y: 0.5, size: 0.1, anim: { in: { id: 'in-fade', dur: 1 } } }, 100, 100, { t: 0.5, length: 3 })
  assert.equal(calls.length, 0)
})

test('F 命令 text.setAnim：stagger 存进去·换回同款保留', () => {
  const raw = { v: 1, media: [], tracks: [{ id: 'main', kind: 'visual', clips: [] }, { id: 'tl', kind: 'text', clips: [{ id: 't', mediaId: '', start: 0, length: 3, offset: 0, text: { content: 'ABC', x: 0.5, y: 0.5, size: 0.1 } }] }] }
  const r = applyCommands(raw, [{ command: 'text.setAnim', params: { clip: 't', slot: 'in', anim: 'in-pc-standup', dur: 1.2, stagger: 0.15 } }])
  assert.ok(r.ok, JSON.stringify(r))
  const t = (r as { project: { tracks: Array<{ clips: Array<{ text?: TextBody }> }> } }).project.tracks.flatMap((l) => l.clips).find((c) => c.text)!.text!
  assert.deepEqual(t.anim, { in: { id: 'in-pc-standup', dur: 1.2, stagger: 0.15 } })
  assert.ok(charPoses(t.anim, 3, 0.1, 3), '套上后逐字在动')
})

test('S 没设每字间隔 ⇒ 照时长与字数自动摊（3 秒 12 字要一条条亮）·手动设的照旧·面板显示自动值', () => {
  near(autoStagger(3, 12), 0.175, 1e-9); near(autoStagger(0.5, 4), 0.088, 1e-9)
  near(autoStagger(10, 2), 0.5, 1e-9, '上限'); near(autoStagger(0.3, 40), 0.03, 1e-9, '下限')
  const tm = charTiming(3, 12); near(tm.gap, 0.175, 1e-9); assert.ok(tm.gap * 11 <= 3 * 0.7 + 1e-9)
  near(charTiming(3, 12, 0.06).gap, 0.06, 1e-9, '手动设的照旧'); near(charTiming(3, 12, 0).gap, 0, 1e-9)
  // 3 秒 12 字：第 1 个字已亮完一截时，最后一个字还没开始（看得出一条条）
  const a = { in: { id: 'in-pc-fade', dur: 3 } }
  assert.ok(charPoseAt(a, 0, 12, 1.0, 5).alpha > 0.3 && charPoseAt(a, 11, 12, 1.0, 5).alpha === 0, '逐条亮')
  const pane = readFileSync(join(__dirname, 'ui/ManualPane.tsx'), 'utf8')
  assert.match(pane, /const stShow = cur \? \(cur\.stagger \?\? autoStagger\(cur\.dur, charCount\(body\.content\)\)\) : STAGGER\.def/)
  assert.match(pane, /<NumField value=\{stShow\}/); assert.match(pane, /data-testid="vedit-man-anim-stagger-hint"/)
})

console.log(`\n${n} 过 · ${bad} 红`)
if (bad) process.exit(1)

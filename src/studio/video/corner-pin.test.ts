// 四角透视题：homography 四角映射与反向·预览 CSS matrix3d 与汇出逐像素投影同一个矩阵·关键帧插值·旧工程无栏不变·命令。
// 跑法（在 studio 根目录跑）：node -e "require('sucrase/register/ts');require('./video/corner-pin.test.ts')"
// 药：DILIN_NEG=vedit_corner_pin_off ⇒ pinMatrix 恒 null（不套透视）⇒ B／C／D／E 红。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { applyH, homography, invertH, pinCssMatrix, pinMatrix, pinQuad, parsePin, warpPixels, UNIT_QUAD, PIN_ZERO, type ClipPin } from './lib/corner-pin.pure'
import { applyClipPatch, lookOf, parseLook } from './lib/clip-look.pure'
import { parseProject } from './lib/project.pure'
import { applyCommands } from './lib/commands.pure'
import type { TlClip } from './lib/timeline.pure'

let n = 0, bad = 0
function test(name: string, fn: () => void) {
  try { fn(); n++; console.log('✓', name) } catch (e) { bad++; console.log('✗', name); console.log('  ', (e as Error).message.split('\n').slice(0, 6).join('\n   ')) }
}
const near = (a: number, b: number, eps = 1e-6, msg = '') => assert.ok(Math.abs(a - b) < eps, `${msg} ${a} ≠ ${b}`)
const PIN: ClipPin = { x0: 0.1, y0: 0.05, x1: -0.2, y1: 0.15, x2: -0.05, y2: -0.1, x3: 0.12, y3: -0.02 }

test('A homography：四角映到目标四角·反矩阵映回来', () => {
  const dst: Array<[number, number]> = [[0.1, 0.2], [0.9, 0.05], [0.8, 0.95], [0.15, 0.7]]
  const H = homography(UNIT_QUAD, dst)!
  assert.ok(H)
  UNIT_QUAD.forEach(([x, y], i) => { const p = applyH(H, x, y)!; near(p[0], dst[i][0], 1e-9, `角${i} x`); near(p[1], dst[i][1], 1e-9, `角${i} y`) })
  const Hi = invertH(H)!
  dst.forEach(([u, v], i) => { const p = applyH(Hi, u, v)!; near(p[0], UNIT_QUAD[i][0], 1e-9); near(p[1], UNIT_QUAD[i][1], 1e-9) })
  // 中间一点来回
  const m = applyH(Hi, ...(applyH(H, 0.3, 0.6)!))!; near(m[0], 0.3, 1e-9); near(m[1], 0.6, 1e-9)
  // 退化（三点共线）⇒ null
  assert.equal(homography(UNIT_QUAD, [[0, 0], [0.5, 0], [1, 0], [0, 1]]), null)
})

test('B pinMatrix：四角照 pin 位移·全 0／没 pin／交叉 ⇒ 不套', () => {
  const H = pinMatrix(PIN)
  assert.ok(H, 'pin 有位移却没矩阵')
  pinQuad(PIN).forEach((q, i) => { const p = applyH(H!, ...UNIT_QUAD[i])!; near(p[0], q[0], 1e-9); near(p[1], q[1], 1e-9) })
  assert.equal(pinMatrix({ ...PIN_ZERO }), null)
  assert.equal(pinMatrix(null), null)
  assert.equal(pinMatrix({ ...PIN_ZERO, x0: 1.2, x1: -1.2 }), null) // 左上跟右上交叉
})

test('C 预览 CSS matrix3d 与汇出同一个矩阵：元素 px 四角（原点在正中）经 matrix3d ＝ pin 四角 px', () => {
  const H = pinMatrix(PIN)!
  assert.ok(H)
  const w = 640, h = 360
  const v = pinCssMatrix(H, w, h).match(/matrix3d\((.*)\)/)![1].split(',').map(Number)
  // 栏优先 4×4：x' = v0 x + v4 y + v12；y' = v1 x + v5 y + v13；w' = v3 x + v7 y + v15（相对 transform-origin＝正中）
  pinQuad(PIN).forEach((q, i) => {
    const x = UNIT_QUAD[i][0] * w - w / 2, y = UNIT_QUAD[i][1] * h - h / 2
    const W = v[3] * x + v[7] * y + v[15]
    near((v[0] * x + v[4] * y + v[12]) / W + w / 2, q[0] * w, 1e-4, `角${i} x`)
    near((v[1] * x + v[5] * y + v[13]) / W + h / 2, q[1] * h, 1e-4, `角${i} y`)
  })
})

test('D 汇出 warpPixels：整层白 ⇒ 四边形内白·外透明；角点照 pin 落', () => {
  const w = 40, h = 30
  const src = new Uint8ClampedArray(w * h * 4).fill(255), dst = new Uint8ClampedArray(w * h * 4)
  const H = pinMatrix({ ...PIN_ZERO, x0: 0.25, y0: 0.25 })!
  assert.ok(H)
  warpPixels(src, dst, w, h, H)
  const a = (x: number, y: number) => dst[(y * w + x) * 4 + 3]
  assert.equal(a(1, 1), 0, '左上角被拉进去了·原角落应透明')
  assert.equal(a(w - 2, h - 2), 255)
  assert.equal(a(Math.round(w * 0.3), Math.round(h * 0.3)), 255)
  // 汇出档真的接上同一份
  const er = readFileSync(join(__dirname, 'ui/export-render.ts'), 'utf8'), pg = readFileSync(join(__dirname, 'page/VideoEditPage.tsx'), 'utf8')
  assert.match(er, /pinMatrix\(lk\.pin\)/); assert.match(er, /warpPixels\(/)
  assert.match(pg, /pinCssMatrix\(H3, w, h\)/); assert.match(pg, /pinMatrix\(lookOf\(c, now\)\.pin\)/)
})

test('E 关键帧：pin.* 照同一套 kf 插值（lookOf 带 t）', () => {
  const c = { id: 'a', start: 0, length: 4, offset: 0, mediaId: 'm', look: { pin: { ...PIN_ZERO } }, kf: { 'pin.x0': [{ t: 0, v: 0 }, { t: 2, v: 0.2 }], 'pin.y2': [{ t: 1, v: -0.1 }] } } as TlClip
  near(lookOf(c, 1).pin!.x0, 0.1, 1e-9); near(lookOf(c, 3).pin!.x0, 0.2, 1e-9); near(lookOf(c, 3).pin!.y2, -0.1, 1e-9)
  near(lookOf(c).pin!.x0, 0, 1e-9) // 不带 t ＝底值
  assert.ok(pinMatrix(lookOf(c, 1).pin), '关键帧插出来的四角该套透视')
  // 打过关键帧的角·面板一改 ⇒ 在播放头补一颗
  const n2 = applyClipPatch(c, { at: 1, look: { pin: { x0: 0.5 } } }, 'visual')
  assert.deepEqual(n2.kf!['pin.x0']!.map((k) => k.t), [0, 1, 2]); near(n2.look!.pin!.x0, 0, 1e-9)
  // 菱形钮（KF_GROUP.pin）
  const n3 = applyClipPatch({ ...c, kf: undefined }, { at: 1, kfToggle: ['pin.x0', 'pin.y0'] }, 'visual')
  assert.ok(n3.kf?.['pin.x0']?.length === 1 && n3.kf?.['pin.y0']?.length === 1)
})

test('F 旧工程无栏不变·读档验值·开关', () => {
  const raw = { v: 1, media: [{ id: 'vid', name: 'a.mp4', kind: 'video', duration: 20 }], tracks: [{ id: 'main', kind: 'visual', clips: [{ id: 'a', mediaId: 'vid', start: 0, length: 4, offset: 0, look: { sx: 1.5 } }] }] }
  const pr = parseProject(raw) as { project?: { tracks?: Array<{ clips: TlClip[] }> } }
  const pc = pr.project!.tracks![0].clips[0]
  assert.deepEqual(pc.look, parseLook({ sx: 1.5 })); assert.ok(!('pin' in (pc.look ?? {}))); assert.equal(lookOf(pc, 1).pin, null); assert.equal(pinMatrix(lookOf(pc, 1).pin), null)
  assert.deepEqual(parseLook({ pin: { x0: 9, y1: 'x' } })!.pin, { ...PIN_ZERO, x0: 2 })
  assert.deepEqual(parsePin({}), PIN_ZERO)
  const raw2 = { ...raw, tracks: [{ id: 'main', kind: 'visual', clips: [{ ...raw.tracks[0].clips[0], look: { pin: PIN }, kf: { 'pin.x1': [{ t: 0, v: 0.3 }] } }] }] }
  const pc2 = (parseProject(raw2) as typeof pr).project!.tracks![0].clips[0]
  assert.deepEqual(pc2.look!.pin, PIN); assert.ok(pc2.kf!['pin.x1'])
  const on = applyClipPatch(pc, { look: { pin: {} } }, 'visual'); assert.deepEqual(on.look!.pin, PIN_ZERO)
  const off = applyClipPatch(on, { look: { pin: null } }, 'visual'); assert.equal(off.look!.pin, undefined)
  // 文字片段也收 pin
  const t = applyClipPatch({ id: 't', start: 0, length: 2, offset: 0, text: { content: 'hi', x: 0.5, y: 0.5, size: 0.1 } } as unknown as TlClip, { look: { pin: { x0: 0.1 } } }, 'text')
  near(t.look!.pin!.x0, 0.1)
})

test('G 命令 clip.setCornerPin／clip.setKeyframe pin.*', () => {
  const raw = { v: 1, media: [{ id: 'vid', name: 'a.mp4', kind: 'video', duration: 20 }], tracks: [{ id: 'main', kind: 'visual', clips: [{ id: 'a', mediaId: 'vid', start: 0, length: 4, offset: 0 }] }] }
  const r = applyCommands(raw, [{ command: 'clip.setCornerPin', params: { clips: 'a', pin: { x0: 0.1, y3: -0.05 } } }, { command: 'clip.setKeyframe', params: { clip: 'a', at: 1, values: { 'pin.x1': -0.2 } } }])
  assert.ok(r.ok, JSON.stringify(r))
  const c = r.ok ? r.project.tracks[0].clips[0] : null
  assert.deepEqual(c!.look!.pin, { ...PIN_ZERO, x0: 0.1, y3: -0.05 }); assert.ok(c!.kf!['pin.x1'])
  const off = applyCommands(r.ok ? r.project : raw, [{ command: 'clip.setCornerPin', params: { clips: 'a', pin: null } }])
  assert.ok(off.ok && !off.project.tracks[0].clips[0].look?.pin)
  assert.equal(applyCommands(raw, [{ command: 'clip.setCornerPin', params: { clips: 'a', pin: { x9: 1 } } }]).ok, false)
})

test('H 角点显示位置夹在框内（四角没动时下两颗压在框边被裁掉、点到分隔条）·角点层在最上', () => {
  const { pinHandlePos } = require('./lib/corner-pin.pure')
  for (const v of [0, 1]) assert.ok(/^clamp\(6px, /.test(pinHandlePos(v)), pinHandlePos(v))
  assert.equal(pinHandlePos(1), 'clamp(6px, 100%, calc(100% - 6px))')
  assert.equal(pinHandlePos(0.25), 'clamp(6px, 25%, calc(100% - 6px))')
  const src = require('fs').readFileSync(require('path').join(__dirname, 'page/VideoEditPage.tsx'), 'utf8')
  assert.ok(src.includes('left: pinHandlePos(x), top: pinHandlePos(y)'))
  assert.ok(/pointer-events-none z-50" data-testid="vedit-pin-handles"/.test(src))
})

console.log(`corner-pin → ${n} 过 ${bad} 败`)
if (bad) process.exit(1)

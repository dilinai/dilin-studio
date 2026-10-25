// 画面片段外观题：外发光／描边读档验值与画法接线·图片运动模糊生效·方向模糊采样方向＝关键帧位移方向·rotX／rotY→四角换算·旧工程不变。
// 跑法（在 studio 根目录跑）：node -e "require('sucrase/register/ts');require('sucrase/register/tsx');require('./video/look-glow-mblur.test.ts')"
// 药：DILIN_NEG=vedit_glow_canvas_blur_off ⇒ 汇出光晕／阴影模糊不 ×2 ⇒ F 红。
// 药：DILIN_NEG=vedit_pv_fit_off ⇒ 预览素材元素不撑满舞台（只缩不放）⇒ G 红。
// 药：DILIN_NEG=vedit_look_glow_mblur_off ⇒ 外发光／描边验值全丢、图片运动模糊关、方向样本 null、3D 换算恒 0 ⇒ A／B／C／D 红（E 旧工程照旧绿）。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { applyClipPatch, borderRing, canvasBlur, fitLayerCss, glowCss, glowPx, shadowPx, lookOf, lookXform, clipAnimPose, normalizeLook, parseLook, type ClipLook } from './lib/clip-look.pure'
import { drawDirSamples, mblurDirSamples, mblurDirVector, mblurModeOf, parseMotionBlur, MBLUR_DEFAULT, type Ctx2DLite } from './lib/motion-blur.pure'
import { pinMatrix, rot3dToPin, parsePin, PIN_KEYS } from './lib/corner-pin.pure'
import { applyCommands } from './lib/commands.pure'
import type { TlClip } from './lib/timeline.pure'

let n = 0, bad = 0
function test(name: string, fn: () => void) {
  try { fn(); n++; console.log('✓', name) } catch (e) { bad++; console.log('✗', name); console.log('  ', (e as Error).message.split('\n').slice(0, 6).join('\n   ')) }
}
const near = (a: number, b: number, eps = 1e-6, msg = '') => assert.ok(Math.abs(a - b) < eps, `${msg} ${a} ≠ ${b}`)
const R = (p: string) => readFileSync(join(__dirname, p), 'utf8')
const EXP = R('ui/export-render.ts'), PAGE = R('page/VideoEditPage.tsx'), CI = R('ui/ClipInspector.tsx'), GP = R('ui/GradePanels.tsx'), DB = R('ui/DirBlurCanvas.tsx')
const clip = (look: ClipLook | undefined, kf?: TlClip['kf']): TlClip => ({ id: 'c1', start: 0, length: 2, offset: 0, mediaId: 'm1', ...(look ? { look } : {}), ...(kf ? { kf } : {}) } as TlClip)

test('A 外发光／描边：读档验值（夹值·坏色补缺省·0 不存·null 拿掉）＋换算＋预览汇出接线', () => {
  const l = parseLook({ glow: { color: '#FF0000', radius: 150, strength: 80 }, border: { color: 'zzz', width: 12.4 } })!
  assert.deepEqual(l.glow, { color: '#ff0000', radius: 100, strength: 80 })
  assert.deepEqual(l.border, { color: '#ffffff', width: 12 })
  assert.equal(parseLook({ glow: { color: '#ff0000', radius: 20, strength: 0 } }), undefined, '强度 0 ⇒ 不存')
  const c = applyClipPatch(clip(l), { look: { glow: null } }, 'visual')
  assert.equal(c.look?.glow, undefined); assert.ok(c.look?.border)
  const gp = glowPx(l.glow, 1000)!
  near(gp.blur, 80); assert.equal(gp.passes, 3); assert.match(gp.color, /^#ff0000[0-9a-f]{2}$/)
  assert.equal(glowCss(l.glow)!.split('drop-shadow(0 0 8cqh').length - 1, 3, '预览串 passes 个 drop-shadow·半径同 glowPx')
  const ring = borderRing({ x: 0.1, y: 0, w: 0.8, h: 1 }, { l: 0.1, t: 0, r: 0, b: 0 }, 20, l.border, 16 / 9)!
  near(ring.x, 0.18); near(ring.width, 0.006); assert.ok(ring.r > 0, '描边半径跟圆角走')
  // 接线：汇出 glowLayer＋paintFramed（描边）·预览 glowCss＋borderCss·面板
  assert.match(EXP, /const gp = glowPx\(lk\.glow, H\)/); assert.match(EXP, /if \(gp\) full = glowLayer\(full, gp\)/)
  assert.match(EXP, /const ring = borderRing\(/); assert.match(EXP, /paintFramed\(c, /)
  assert.match(PAGE, /glowCss\(lk\.glow\)/); assert.match(PAGE, /borderCss\(ring\)/); assert.match(PAGE, /borderRing\(fr, lk\.crop, lk\.corner, lk\.border/)
  assert.match(GP, /vedit-ci-glow-on/); assert.match(GP, /vedit-ci-border-width/)
})

const moving = () => clip({ mblur: { ...MBLUR_DEFAULT } }, { x: [{ t: 0, v: 0 }, { t: 1, v: 0.5 }], y: [{ t: 0, v: 0 }, { t: 1, v: -0.25 }] } as TlClip['kf'])
const pose = (c: TlClip) => (t: number) => lookXform(lookOf(c, t), clipAnimPose(c, t))

test('B 图片运动模糊：图片片段直接走方向模糊（不必合并）·汇出／预览不再只认影片·提示改了', () => {
  assert.equal(mblurModeOf(MBLUR_DEFAULT, 'image'), 'dir')
  assert.equal(mblurModeOf({ ...MBLUR_DEFAULT, mode: 'frames' }, 'image'), 'dir', '图片没有前几格可混 ⇒ 方向')
  assert.equal(mblurModeOf({ ...MBLUR_DEFAULT, mode: 'dir' }, 'video'), 'dir')
  assert.equal(parseMotionBlur({ amount: 30, blend: 30, passes: 2, mode: 'dir' })!.mode, 'dir')
  const s = mblurDirSamples(lookOf(moving(), 0.5).mblur!, pose(moving()), 0.5)
  assert.ok(s && s.length === 15, '图片＋位移关键帧 ⇒ 有样本（叠加 4 次 ⇒ 15 个）')
  assert.match(EXP, /const dirS = mblurModeOf\(lk\.mblur, op\.media\) === 'dir'/)
  assert.match(PAGE, /mblurModeOf\(lk\?\.mblur, m\.kind\)/); assert.match(PAGE, /<VeditDirBlurCanvas /)
  assert.doesNotMatch(R('i18n.ts'), /vedit_ci_mblur_image: "[^"]*合併/)
  assert.match(CI, /vedit-ci-mblur-mode/)
})

test('C 方向模糊：样本位移方向＝关键帧这一刻的位移方向·没在动 ⇒ null·叠法预览汇出同一个 drawDirSamples', () => {
  const c = moving(), mb = lookOf(c, 0.5).mblur!
  const s = mblurDirSamples(mb, pose(c), 0.5)!
  assert.ok(s)
  // 关键帧：x 每秒 +0.5 画面宽 ⇒ tx +50%/s；y 每秒 −0.25（往上为正）⇒ ty +25%/s
  const v = mblurDirVector(s)!, L = Math.hypot(50, 25)
  near(v[0], 50 / L, 1e-6, 'x 方向'); near(v[1], 25 / L, 1e-6, 'y 方向')
  for (const x of s) if (x.dt) near(x.dtx * 25, x.dty * 50, 1e-6, '每个样本都在同一条线上')
  assert.equal(s[s.length - 1].dt, 0); near(s[0].alpha, 1)
  assert.equal(mblurDirSamples(mb, pose(clip({ mblur: mb })), 0.5), null, '没关键帧 ⇒ 不模糊')
  // 叠法：假画布录 translate ⇒ 位置沿位移方向
  const tr: Array<[number, number]> = []
  const ctx: Ctx2DLite = { save() {}, restore() {}, globalAlpha: 1, translate(x, y) { tr.push([x, y]) }, rotate() {}, scale() {} }
  const xf = pose(c)(0.5)
  drawDirSamples(ctx, s, xf, 1000, 1000, () => {})
  const pts = tr.filter((_, i) => i % 2 === 0)
  assert.equal(pts.length, s.length)
  for (const p of pts) near((p[0] - pts[pts.length - 1][0]) * 25, (p[1] - pts[pts.length - 1][1]) * 50, 1e-6)
  assert.match(EXP, /drawDirSamples\(c as unknown as Ctx2DLite, dirS, xf, W, H/); assert.match(DB, /drawDirSamples\(g as unknown as Ctx2DLite, p\.samples, p\.xf, W, H/)
})

test('D 3D 旋转 → 四角：0 度不变形·左右／上下对称·正角远边缩·同一个 pin 机制（命令）', () => {
  const z = rot3dToPin({ x: 0, y: 0, d: 2.5 }, 16 / 9)
  assert.ok(PIN_KEYS.every((k) => z[k] === 0)); assert.equal(pinMatrix(z), null)
  const a = rot3dToPin({ x: 0, y: 30, d: 2.5 }, 16 / 9), b = rot3dToPin({ x: 0, y: -30, d: 2.5 }, 16 / 9)
  assert.ok(Math.abs(a.x1) > 0.01, '30° 有变形')
  // 左右镜像：+θ 的角 i ↔ −θ 的镜像角（0↔1、3↔2）·x 取反、y 相同
  near(a.x0, -b.x1, 1e-4); near(a.y0, b.y1, 1e-4); near(a.x3, -b.x2, 1e-4); near(a.y3, b.y2, 1e-4)
  near(a.y0, -a.y3, 1e-4, '上下对称'); assert.ok(a.y1 > 0 && a.y2 < 0, 'rotY>0 ⇒ 右边退远变短')
  const p = rot3dToPin({ x: 25, y: 0, d: 2 }, 1), q = rot3dToPin({ x: -25, y: 0, d: 2 }, 1)
  near(p.y0, -q.y3, 1e-4); near(p.x0, q.x3, 1e-4); assert.ok(p.x3 > 0 && p.x2 < 0, 'rotX>0 ⇒ 下边退远变窄')
  assert.ok(pinMatrix(parsePin(a)!), '换出来的四角可投影')
  const raw = { v: 1, ratio: { kind: 'preset', key: '16:9' }, media: [{ id: 'img', name: 'a.png', kind: 'image', duration: 0 }], tracks: [{ id: 'main', kind: 'visual', clips: [{ id: 'a', mediaId: 'img', start: 0, length: 4, offset: 0 }] }] }
  const r = applyCommands(raw, [{ command: 'clip.setRotateXY', params: { clips: 'a', rotY: 30 } }])
  assert.ok(r.ok, JSON.stringify(r))
  const lk = r.ok ? r.project.tracks[0].clips[0].look! : null
  near(lk!.pin!.x1, a.x1, 1e-4); assert.equal(lk!.rot3d!.y, 30)
  assert.match(CI, /<Rot3dSection host=\{host\} \/>/); assert.match(CI, /rot3dToPin\(q, host\.stageRatio/)
})

test('E 旧工程不变：没新栏的 look 读回一样·影片没写 mode 照「和前几格混」·lookOf 新栏缺省', () => {
  const old = { x: 0.1, corner: 20, shadow: { color: '#000000', opacity: 60, blur: 30, dist: 20, angle: 135 }, mblur: { amount: 30, blend: 30, passes: 4 } }
  assert.deepEqual(parseLook(old), normalizeLook(old as ClipLook))
  assert.deepEqual(parseLook(old), old)
  assert.equal(mblurModeOf(old.mblur, 'video'), 'frames')
  const l = lookOf(clip(old as ClipLook))
  assert.equal(l.glow, null); assert.equal(l.border, null); assert.equal(l.rot3d, null)
  assert.equal(glowPx(null, 1000), null); assert.equal(borderRing({ x: 0, y: 0, w: 1, h: 1 }, null, 0, null, 1), null)
  assert.match(EXP, /if \(op\.media === 'video' && mblurActive\(lk\.mblur\)\) \{ if \(mbFrames\)/)
})

test('F 外发光／阴影：汇出画布模糊＝预览 drop-shadow 的两倍（drop-shadow 是标准差、shadowBlur 是两倍标准差·成片偏窄偏淡）', () => {
  near(canvasBlur(12), 24)
  const gp = glowPx({ color: '#7dd3fc', radius: 40, strength: 80 }, 720)!
  near(gp.canvasBlur, gp.blur * 2); near(gp.blur, 0.4 * 0.08 * 720)
  const sp = shadowPx({ color: '#000000', blur: 50, dist: 20, angle: 45, opacity: 60 } as never, 720)
  near(sp.canvasBlur, sp.blur * 2)
  const er = readFileSync(join(__dirname, 'ui/export-render.ts'), 'utf8')
  assert.match(er, /d2\.shadowBlur = gp\.canvasBlur;/)
  assert.equal((er.match(/ctx\.shadowBlur = sp\.canvasBlur;/g) ?? []).length, 2)
  assert.ok(!/shadowBlur = (gp|sp)\.blur\b/.test(er), '汇出还在直接填标准差')
})

test('G 预览素材大小＝汇出 containRect：小图小片也撑满舞台（预览块小约 8%）·图片、影片元素都接上', () => {
  assert.deepEqual(fitLayerCss(640 / 360), { width: 'min(100cqw, 1.7778 * 100cqh)', height: 'auto' })
  // 696×402 舞台里 640×360 的图：宽＝min(696, 1.7778×402=714.7)＝696（撑满宽）·不再是原尺寸 640
  const w = Math.min(696, 1.7778 * 402); near(w / 696, 1, 1e-9, '撑满宽')
  assert.equal(fitLayerCss(null), null); assert.equal(fitLayerCss(0), null); assert.equal(fitLayerCss(Infinity), null)
  assert.match(PAGE, /data-testid="vedit-tl-image"[^>]*onLoad=\{\(e\) => notePvAspect\(m\.id, e\.currentTarget\.naturalWidth, e\.currentTarget\.naturalHeight\)\} style=\{\{ \.\.\.fitLayerCss\(pvAspect\[m\.id\]\)/)
  assert.match(PAGE, /onLoadedMetadata=\{\(e\) => notePvAspect\(c\.mediaId, e\.currentTarget\.videoWidth, e\.currentTarget\.videoHeight\)\}\s*style=\{\{ \.\.\.fitLayerCss\(pvAspect\[c\.mediaId\]\)/)
})

console.log(`\nlook-glow-mblur → ${n} 过 ${bad} 败`)
if (bad) process.exit(1)

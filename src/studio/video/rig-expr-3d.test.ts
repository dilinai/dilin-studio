// 空物件／父子连结·表达式·真 3D 摄影机灯光题：父链级联数值与像素·绕圈拒·表达式各函数结果与沙盒·3D 投影与远近排序·灯光像素·读写往返·命令·预览汇出同一份接线。
// 跑法（在 studio 根目录跑）：node -e "require('sucrase/register/ts');require('./video/rig-expr-3d.test.ts')"
// 药（DILIN_NEG，逗号分隔）：
//   vedit_parent_off ⇒ 父链不级联 ⇒ A／B 红；vedit_parent_cycle_off ⇒ 读档不拿掉绕圈 ⇒ C 红；
//   vedit_expr_off ⇒ 表达式不算 ⇒ D 红；vedit_expr_limit_off ⇒ 不限步数 ⇒ E2 红；vedit_expr_globals_open ⇒ 认不得的名字穿到 globalThis ⇒ E1 红；
//   vedit_3d_off ⇒ 3D 当 2D ⇒ F 红；vedit_3d_sort_off ⇒ 不排远近 ⇒ G 红；vedit_light_off ⇒ 不打光 ⇒ H 红；vedit_rig_parse_off ⇒ 读档不收 d3／parent／expr ⇒ I／J 红。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { camDist, rigCanvasAffine, rigCssMatrix, rigScene, shadePixels, type RigOut } from './lib/rig.pure'
import { compileExpr, exprStatus, runExpr, setExprScene, EXPR_MAX_LEN } from './lib/expr.pure'
import { lookOf } from './lib/clip-look.pure'
import { textBodyAt } from './lib/text-kf.pure'
import { applyH, warpPixels, type Mat3 } from './lib/corner-pin.pure'
import { framePlan } from './lib/export.pure'
import { parseProject, parseProjectIssues } from './lib/project.pure'
import { applyCommands } from './lib/commands.pure'
import { srcAt, type Lane, type TlClip, type Tracks } from './lib/timeline.pure'

let n = 0, bad = 0
function test(name: string, fn: () => void) {
  try { fn(); n++; console.log('✓', name) } catch (e) { bad++; console.log('✗', name); console.log('  ', (e as Error).message.split('\n').slice(0, 6).join('\n   ')) }
}
const near = (a: number, b: number, eps = 1e-6, msg = '') => assert.ok(Math.abs(a - b) < eps, `${msg} ${a} ≠ ${b}`)
const A = 16 / 9, F = camDist(40)
const img = (id: string, x: Partial<TlClip> = {}): TlClip => ({ id, mediaId: 'img', start: 0, length: 4, offset: 0, ...x })
const nul = (id: string, x: Partial<TlClip> = {}): TlClip => ({ id, mediaId: '', start: 0, length: 4, offset: 0, rig: { kind: 'null' }, ...x })
const txt = (id: string, x: Partial<TlClip> = {}): TlClip => ({ id, mediaId: '', start: 0, length: 4, offset: 0, text: { content: 'Hi', x: 0.3, y: 0.3, size: 0.1 }, ...x })
const lane = (id: string, kind: Lane['kind'], clips: TlClip[]): Lane => ({ id, kind, clips, locked: false, hidden: false, muted: false })
const MEDIA = [{ id: 'img', name: 'p.png', kind: 'image', duration: 0, from: 'local' }]
const proj = (tracks: unknown[]) => ({ v: 1, ratio: { kind: 'preset', key: '16:9' }, tracks, media: MEDIA, programs: {} })
const of = (tr: Tracks, id: string, t = 1): RigOut => rigScene(tr, t, A).of(tr.flatMap((l) => l.clips).find((c) => c.id === id)!)
const map = (m: Mat3 | null, x: number, y: number) => (m ? applyH(m, x, y)! : [x, y])
// 像素：W×H RGBA·画一块白（[x0,x1)×[y0,y1) 像素）
const PW = 64, PH = 36
function block(x0: number, y0: number, x1: number, y1: number): Uint8ClampedArray {
  const d = new Uint8ClampedArray(PW * PH * 4)
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) d.fill(255, (y * PW + x) * 4, (y * PW + x) * 4 + 4)
  return d
}
const alphaAt = (d: Uint8ClampedArray, x: number, y: number) => d[(y * PW + x) * 4 + 3]

test('A 父子级联：空物件位移＋旋转 90° ⇒ 子层整层照父层的锚点转（数值与像素·文字子层同一套）', () => {
  const tr: Tracks = [lane('L1', 'visual', [nul('nul', { look: { x: 0.1, rot: 90 } })]), lane('tx', 'text', [txt('t1', { parent: 'nul' })]), lane('main', 'visual', [img('kid', { parent: 'nul' })])]
  const r = of(tr, 'kid')
  assert.ok(r.m, '有父层却没矩阵')
  const [x0, y0] = map(r.m, 0.5, 0.5); near(x0, 0.6, 1e-9, '中心跟着父层位移'); near(y0, 0.5, 1e-9)
  // 中心右边 0.1 个画面宽（u 空间 0.1A）⇒ 顺时针转 90° 到下面 0.1A 个画面高
  const [x1, y1] = map(r.m, 0.6, 0.5); near(x1, 0.6, 1e-9); near(y1, 0.5 + 0.1 * A, 1e-9)
  // 像素：flat 上一块（中心约 0.6,0.5）⇒ 投到 (0.6, 0.68) 附近；原位空了
  const src = block(35, 16, 42, 20), dst = new Uint8ClampedArray(src.length)
  warpPixels(src, dst, PW, PH, r.m!)
  assert.equal(alphaAt(dst, 38, 24), 255, '转下去的位置该有画面'); assert.equal(alphaAt(dst, 38, 18), 0, '原位该空了')
  // 汇出画布仿射＝同一个矩阵（像素座标）
  const [a, b, c, d, e, f] = rigCanvasAffine(r.m!, PW, PH), X = 0.6 * PW, Y = 0.5 * PH
  near(a * X + c * Y + e, x1 * PW, 1e-6); near(b * X + d * Y + f, y1 * PH, 1e-6)
  // 文字子层：同一个父层矩阵
  const rt = of(tr, 't1'); const [tx, ty] = map(rt.m, 0.5, 0.5); near(tx, 0.6, 1e-9); near(ty, 0.5, 1e-9)
  // 没父层 ⇒ 不套
  assert.equal(rigScene([lane('main', 'visual', [img('k2')])], 1, A).of(img('k2')).m, null)
})

test('B 父层的关键帧／表达式／片段动画／祖父层／不透明度都级联', () => {
  const kfTr: Tracks = [lane('L1', 'visual', [nul('nul', { kf: { x: [{ t: 0, v: 0 }, { t: 2, v: 0.2 }] } })]), lane('main', 'visual', [img('kid', { parent: 'nul' })])]
  near(map(of(kfTr, 'kid', 1).m, 0.5, 0.5)[0], 0.6, 1e-9, '父层关键帧 t=1 ⇒ x 0.1')
  const exTr: Tracks = [lane('L1', 'visual', [nul('nul', { expr: { x: 'time * 0.1' } })]), lane('main', 'visual', [img('kid', { parent: 'nul' })])]
  near(map(of(exTr, 'kid', 1.5).m, 0.5, 0.5)[0], 0.65, 1e-9, '父层表达式 x = time×0.1')
  const anTr = (anim?: TlClip['anim']): Tracks => [lane('L1', 'visual', [nul('nul', anim ? { anim } : {})]), lane('main', 'visual', [img('kid', { parent: 'nul' })])]
  const withAnim = of(anTr({ in: { id: 'in-left', dur: 1 } }), 'kid', 0.3).m
  assert.ok(withAnim && Math.abs(map(withAnim, 0.5, 0.5)[0] - 0.5) > 1e-3, '父层入场动画带着子层走')
  const gp: Tracks = [lane('L0', 'visual', [nul('gp', { look: { y: 0.1 } })]), lane('L1', 'visual', [nul('nul', { parent: 'gp', look: { x: 0.1, opacity: 0.5 } })]), lane('main', 'visual', [img('kid', { parent: 'nul', parentAlpha: true }), img('k3', { start: 4, parent: 'nul' })])]
  const [gx, gy] = map(of(gp, 'kid').m, 0.5, 0.5); near(gx, 0.6, 1e-9, '父层'); near(gy, 0.4, 1e-9, '祖父层往上 0.1')
  near(of(gp, 'kid').alpha, 0.5, 1e-9, 'parentAlpha ⇒ 乘父层不透明度')
  near(of(gp, 'k3').alpha, 1, 1e-9, '没勾 parentAlpha ⇒ 不透明度不跟')
})

test('C 绕圈：读档拿掉形成圈那段的连结（其余照留）·指不到／指到摄影机 ⇒ 拿掉·命令拒绕圈与自己当父层', () => {
  const raw = proj([
    { id: 'L1', kind: 'visual', clips: [{ id: 'a', start: 0, length: 4, offset: 0, rig: { kind: 'null' }, parent: 'b' }, { id: 'cam', start: 4, length: 2, offset: 0, rig: { kind: 'camera' } }] },
    { id: 'L2', kind: 'visual', clips: [{ id: 'b', start: 0, length: 4, offset: 0, rig: { kind: 'null' }, parent: 'a' }] },
    { id: 'main', kind: 'visual', clips: [{ id: 'k', mediaId: 'img', start: 0, length: 2, offset: 0, parent: 'ghost' }, { id: 'k2', mediaId: 'img', start: 2, length: 2, offset: 0, parent: 'cam' }] },
  ])
  const r = parseProjectIssues(raw)
  assert.ok(r.ok)
  if (!r.ok) return
  const codes = r.issues.map((d) => `${d.code}:${d.id}`).sort()
  assert.deepEqual(codes, ['parent_bad:k', 'parent_bad:k2', 'parent_loop:a'])
  const all = r.project.tracks.flatMap((l) => l.clips)
  assert.equal(all.find((c) => c.id === 'a')!.parent, undefined, 'a 的连结拿掉')
  assert.equal(all.find((c) => c.id === 'b')!.parent, 'a', 'b → a 留着（圈已断）')
  // 再读一次：不再报
  const again = parseProject(JSON.parse(JSON.stringify(r.project)))
  assert.ok(again.ok && again.drops.length === 0)
  // 命令：会绕圈 ⇒ 拒；自己 ⇒ 拒；摄影机当父层 ⇒ 拒
  const loop = applyCommands(r.project, [{ command: 'clip.setParent', params: { clips: 'a', parent: 'b' } }])
  assert.ok(!loop.ok && /loop/.test(loop.error), '绕圈该拒')
  assert.ok(!applyCommands(r.project, [{ command: 'clip.setParent', params: { clips: 'a', parent: 'a' } }]).ok)
  assert.ok(!applyCommands(r.project, [{ command: 'clip.setParent', params: { clips: 'k', parent: 'cam' } }]).ok)
  // 场景层也防圈（就算资料里绕了也不会卡死）
  const cyc: Tracks = [lane('L1', 'visual', [nul('p', { parent: 'q' }), nul('q', { start: 4, parent: 'p' })]), lane('main', 'visual', [img('k', { parent: 'p' })])]
  assert.ok(of(cyc, 'k').m !== undefined)
})

test('D 表达式各函数：time／value／wiggle／loopOut／linear／ease／thisClip／clip(id).prop／Math／var·出错回原值', () => {
  const x = (c: TlClip, t: number, tr?: Tracks) => { if (tr) setExprScene(tr); return lookOf(c, t).x }
  near(x(img('e1', { expr: { x: 'time * 2' } }), 1.5), 3, 1e-9, 'time')
  const kfx = { x: [{ t: 0, v: 0 }, { t: 2, v: 1 }] }
  near(x(img('e2', { kf: kfx, expr: { x: 'value * 10' } }), 1), 5, 1e-9, 'value＝关键帧值')
  // wiggle：确定性、幅度内、会动、不同片段不一样
  const w = (id: string, t: number) => x(img(id, { look: { x: 0.2 }, expr: { x: 'wiggle(2, 0.1)' } }), t)
  const ws = [0.1, 0.37, 0.8, 1.3, 2.1, 3.3].map((t) => w('w1', t))
  assert.ok(ws.every((v) => Math.abs(v - 0.2) <= 0.1 + 1e-9), `wiggle 超出幅度 ${ws}`)
  assert.ok(new Set(ws.map((v) => v.toFixed(5))).size > 3, 'wiggle 没在动')
  assert.equal(w('w1', 1.3), ws[3], 'wiggle 同一刻同一个值')
  assert.notEqual(w('w2', 1.3).toFixed(6), ws[3].toFixed(6), '不同片段同一刻不同')
  // loopOut：关键帧 0→1（0..1 秒）之后循环／来回
  const lk = { x: [{ t: 0, v: 0 }, { t: 1, v: 1 }] }
  near(x(img('l1', { kf: lk, expr: { x: "loopOut('cycle')" } }), 1.25), 0.25, 1e-9, 'cycle')
  near(x(img('l1', { kf: lk, expr: { x: "loopOut('cycle')" } }), 2.5), 0.5, 1e-9, 'cycle 第三圈')
  near(x(img('l2', { kf: lk, expr: { x: "loopOut('pingpong')" } }), 1.25), 0.75, 1e-9, 'pingpong 回程')
  near(x(img('l2', { kf: lk, expr: { x: "loopOut('pingpong')" } }), 2.25), 0.25, 1e-9, 'pingpong 第三段')
  near(x(img('l3', { kf: lk, expr: { x: "loopOut('cycle')" } }), 0.5), 0.5, 1e-9, '最后一颗之前照关键帧')
  // linear／ease
  near(x(img('i1', { expr: { x: 'linear(time, 0, 2, 10, 20)' } }), 0.5), 12.5, 1e-9, 'linear')
  near(x(img('i2', { expr: { x: 'ease(time, 0, 2, 0, 1)' } }), 1), 0.5, 1e-9, 'ease 中点')
  near(x(img('i3', { expr: { x: 'ease(time, 0, 2, 0, 1)' } }), 0.5), (1 - Math.cos(Math.PI / 4)) / 2, 1e-9, 'ease 四分之一')
  near(x(img('i4', { expr: { x: 'linear(time, 0, 1, 5, 6) + linear(0.5, 0, 10)' } }), 3), 11, 1e-9, '夹在范围内＋三参数版')
  // thisClip／clip('id')
  near(x(img('h1', { start: 1, length: 3, expr: { x: 'thisClip.start + thisClip.length' } }), 2), 4, 1e-9, 'thisClip')
  const other = img('oth', { look: { x: 0.3 } }), other2 = img('oth2', { look: { x: 0.3 }, expr: { x: '0.7' } }), tt = txt('tt', { expr: { ts: '2' } })
  const tr: Tracks = [lane('tx', 'text', [tt]), lane('L', 'visual', [other, other2])]
  near(x(img('c1', { expr: { x: "clip('oth').x * -1" } }), 1, tr), -0.3, 1e-9, '读别段底值')
  near(x(img('c2', { expr: { x: "clip('oth2').x" } }), 1, tr), 0.7, 1e-9, '读别段（连它的表达式）')
  near(x(img('c3', { expr: { x: "clip('tt').ts + clip('oth').prop('x', 0)" } }), 1, tr), 2.3, 1e-9, '文字项＋prop(名, 时刻)')
  // Math／var
  near(x(img('m1', { expr: { x: 'Math.max(1, 2) + abs(-3) + PI' } }), 0), 5 + Math.PI, 1e-9, 'Math')
  near(x(img('v1', { expr: { x: 'var a = 2; let b = a * 3; b + 1' } }), 0), 7, 1e-9, 'var／let')
  // 出错回原值（关键帧值）·面板看得到原因
  const e1 = img('bad1', { kf: kfx, expr: { x: "clip('nope').x" } })
  near(x(e1, 1), 0.5, 1e-9, '执行错 ⇒ 回关键帧值')
  const st = exprStatus(e1, 'x', 1, srcAt(e1, 1), 0)
  assert.ok(st && !st.ok && /nope/.test(st.err), '面板该拿到错误原因')
  const e2 = img('self', { look: { x: 0.4 }, expr: { x: 'thisClip.x + 1' } })
  near(x(e2, 1), 0.4, 1e-9, '读自己这一项＝绕圈 ⇒ 回原值')
  assert.equal(compileExpr('wiggle(').ok, false); assert.equal(compileExpr('1 +').ok, false)
  // 文字项、3D 项也走表达式
  near(textBodyAt(txt('t2', { expr: { ts: '1.5 + time' } }), 0.5)!.scale!, 2, 1e-9, '文字缩放')
  const d3c = img('d3e', { d3: { z: 1 }, expr: { 'd3.z': 'value * 3' } })
  near(of([lane('main', 'visual', [d3c])], 'd3e').depth!, F + 3, 1e-4, 'd3.z 表达式')
})

test('E1 沙盒：拿不到全域／网路／原型链／建构式·不准呼叫非内建函数·没有副作用', () => {
  const bads = ['globalThis', 'globalThis.__vx = 1', 'process.pid', 'process.exit(1)', 'this', 'constructor', 'Math.constructor', "Math['constructor']", '(function(){ return 1 })()',
    'new Function("return 1")', 'eval("1")', 'require("fs")', 'fetch("http://example.com")', 'thisClip.__proto__', 'thisClip.constructor', 'Math.sin.call(null, 1)',
    'x => 1', 'while (1) {}', 'Date.now()', 'setTimeout', "clip('k').constructor", "'abc'.length", 'value.toString()', 'import("fs")', 'Object', 'window']
  for (const src of bads) {
    const r = runExpr(src, { clip: img('k'), prop: 'x', t: 1, s: 1, value: 0, base: 0 })
    assert.ok(!r.ok, `沙盒没挡住：${src} ⇒ ${JSON.stringify(r)}`)
  }
  assert.equal((globalThis as Record<string, unknown>).__vx, undefined, '有副作用')
  assert.equal(compileExpr('1+'.repeat(EXPR_MAX_LEN)).ok, false, '太长该拒')
})

test('E2 限额：别段互相引用一层层摊开（12^4 次）⇒ 步数限额挡下·回原值', () => {
  const sum = (to: string) => Array.from({ length: 12 }, () => `clip('${to}').x`).join('+')
  const cs = [0, 1, 2, 3, 4].map((i) => img(`f${i}`, { look: { x: 0.25 }, ...(i < 4 ? { expr: { x: sum(`f${i + 1}`) } } : {}) }))
  setExprScene([lane('main', 'visual', cs)])
  const st = exprStatus(cs[0], 'x', 1, 1, 0)
  assert.ok(st && !st.ok && /limit/.test(st.err), `该被限额挡下：${JSON.stringify(st)}`)
  near(lookOf(cs[0], 1).x, 0.25, 1e-9, '挡下 ⇒ 回原值')
})

test('F 3D 投影：缺省摄影机 z=0 ＝ 2D·远一倍 ⇒ 缩一半（数值＋像素）·转 y 轴近大远小·摄影机移动·3D 父层带深度·摄影机后面不画·预览 CSS 同一个矩阵', () => {
  const one = (c: TlClip, extra: Lane[] = []) => of([...extra, lane('main', 'visual', [c])], c.id)
  const r0 = one(img('k', { d3: {} }))
  assert.ok(r0.is3d, '开了 3D 却不是 3D')
  const p0 = map(r0.m, 0.3, 0.7); near(p0[0], 0.3, 1e-9); near(p0[1], 0.7, 1e-9)
  near(r0.depth!, F, 1e-4)
  const r1 = one(img('k', { d3: { z: F } }))
  const p1 = map(r1.m, 0.75, 0.5); near(p1[0], 0.625, 1e-9, '远一倍 ⇒ 离中心的距离减半'); near(p1[1], 0.5, 1e-9)
  const src = block(0, 0, PW, PH), dst = new Uint8ClampedArray(src.length)
  warpPixels(src, dst, PW, PH, r1.m!)
  assert.equal(alphaAt(dst, 32, 18), 255); assert.equal(alphaAt(dst, 20, 12), 255); assert.equal(alphaAt(dst, 45, 25), 255)
  assert.equal(alphaAt(dst, 10, 18), 0); assert.equal(alphaAt(dst, 55, 18), 0); assert.equal(alphaAt(dst, 32, 4), 0)
  // 绕 y 转 60°：右边退远（变窄变矮）·左边靠近（变大）
  const r2 = one(img('k', { d3: { ry: 60 } }))
  const right = map(r2.m, 1, 0.5), left = map(r2.m, 0, 0.5)
  near(right[0], 0.5 + (F * (A / 2) * 0.5) / (F + (A / 2) * Math.sin(Math.PI / 3)) / A, 1e-9, '右边')
  near(left[0], 0.5 - (F * (A / 2) * 0.5) / (F - (A / 2) * Math.sin(Math.PI / 3)) / A, 1e-9, '左边')
  const hR = map(r2.m, 1, 1)[1] - map(r2.m, 1, 0)[1], hL = map(r2.m, 0, 1)[1] - map(r2.m, 0, 0)[1]
  assert.ok(hR < 1 && hL > 1, `近大远小 ${hR} ${hL}`)
  // 摄影机：退后一倍 ⇒ 缩一半；左右平移 ⇒ 画面反向移
  const cam = (rig: Record<string, number>) => lane('cam', 'visual', [{ id: 'cm', mediaId: '', start: 0, length: 4, offset: 0, rig: { kind: 'camera', x: 0, y: 0, z: -F, tx: 0, ty: 0, tz: 0, fov: 40, ...rig } }])
  near(map(one(img('k', { d3: {} }), [cam({ z: -2 * F })]).m, 0.75, 0.5)[0], 0.625, 1e-9, '摄影机退后')
  near(map(one(img('k', { d3: {} }), [cam({ x: 0.1, tx: 0.1 })]).m, 0.5, 0.5)[0], 0.5 - 0.1 / A, 1e-9, '摄影机右移 ⇒ 画面左移')
  // 3D 父层：深度＋3D 旋转带给 3D 子层；2D 子层只跟 2D 部分
  const tr3: Tracks = [lane('L1', 'visual', [nul('n3', { d3: { z: F } })]), lane('main', 'visual', [img('c3', { parent: 'n3', d3: {} }), img('c2', { start: 4, parent: 'n3' })])]
  near(map(of(tr3, 'c3').m, 0.75, 0.5)[0], 0.625, 1e-9, '3D 子层跟父层深度')
  assert.equal(of(tr3, 'c2', 5).m, null, '2D 子层不吃父层的深度')
  // 摄影机后面 ⇒ 不画
  assert.ok(one(img('k', { d3: { z: -2 * F } })).hidden)
  // 预览 CSS matrix3d：元素四角（原点在正中）＝ 汇出 homography 四角
  const w = 640, h = 360, v = rigCssMatrix(r2.m!, w, h).match(/matrix3d\((.*)\)/)![1].split(',').map(Number)
  for (const [u, q] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
    const x0 = u * w - w / 2, y0 = q * h - h / 2, W4 = v[3] * x0 + v[7] * y0 + v[15]
    const e = map(r2.m, u, q)
    assert.ok(W4 > 0, 'w 要是正的（不翻面）')
    // 容差 1e-3 px：CSS 字串取到小数 9 位·强透视下会放大一点（远小于一个像素）
    near((v[0] * x0 + v[4] * y0 + v[12]) / W4 + w / 2, e[0] * w, 1e-3); near((v[1] * x0 + v[5] * y0 + v[13]) / W4 + h / 2, e[1] * h, 1e-3)
  }
})

test('G 远近排序：相邻 3D 层远的先画（跟轨道上下无关）·2D 层切开 3D 串', () => {
  const kindOf = () => 'image' as const
  const tr: Tracks = [lane('tA', 'visual', [img('A', { d3: { z: 1 } })]), lane('main', 'visual', [img('B', { d3: {} })])]
  const sc = rigScene(tr, 1, A), plan = framePlan(tr, 1, kindOf)
  assert.deepEqual(plan.map((o) => o.clip.id), ['B', 'A'], '原本由下往上')
  assert.deepEqual(sc.order(plan, (o) => o.clip).map((o) => o.clip.id), ['A', 'B'], '远的 A 先画')
  const tr2: Tracks = [lane('tA', 'visual', [img('A', { d3: { z: 1 } })]), lane('t2', 'visual', [img('C')]), lane('main', 'visual', [img('B', { d3: {} })])]
  const sc2 = rigScene(tr2, 1, A)
  assert.deepEqual(sc2.order(framePlan(tr2, 1, kindOf), (o) => o.clip).map((o) => o.clip.id), ['B', 'C', 'A'], '2D 层夹在中间 ⇒ 不跨过它排')
})

test('H 灯光（简化 Lambert）：环境光照颜色加·平行光照角度·聚光照锥角·3D 转了跟着变·2D 层不打光·像素照乘', () => {
  const lt = (rig: Record<string, unknown>) => lane('lt', 'visual', [{ id: 'l' + Object.values(rig).join('').replace(/[^a-z0-9]/gi, ''), mediaId: '', start: 0, length: 4, offset: 0, rig: { kind: 'light', color: '#ffffff', intensity: 1, x: 0, y: 0, z: -1, tx: 0, ty: 0, tz: 0, cone: 60, feather: 0, ...rig } as TlClip['rig'] }])
  const shade = (c: TlClip, lights: Lane[]) => of([...lights, lane('main', 'visual', [c])], c.id).shade
  assert.equal(shade(img('k', { d3: {} }), []), null, '没灯 ⇒ 不打光')
  assert.deepEqual(shade(img('k', { d3: {} }), [lt({ light: 'ambient', intensity: 0.5, color: '#ff0000' })]), [0.5, 0, 0], '环境光')
  assert.deepEqual(shade(img('k', { d3: {} }), [lt({ light: 'parallel' })]), [1, 1, 1], '正面平行光')
  const s60 = shade(img('k', { d3: {} }), [lt({ light: 'parallel', x: Math.sin(Math.PI / 3), z: -0.5 })])!
  near(s60[0], 0.5, 1e-4, '斜 60° 平行光')
  near(shade(img('k', { d3: { ry: 60 } }), [lt({ light: 'parallel' })])![1], 0.5, 1e-4, '层转 60° ⇒ cos60')
  near(shade(img('k', { d3: {} }), [lt({ light: 'point' })])![2], 1, 1e-6, '正前方点光')
  assert.deepEqual(shade(img('k', { d3: {} }), [lt({ light: 'spot', tz: -2 })]), [0, 0, 0], '聚光照别处')
  near(shade(img('k', { d3: {} }), [lt({ light: 'spot' })])![0], 1, 1e-6, '聚光照正中')
  assert.equal(shade(img('k'), [lt({ light: 'parallel' })]), null, '2D 层不打光')
  const d = block(0, 0, PW, PH); shadePixels(d, [0.5, 0.25, 1])
  assert.deepEqual([d[0], d[1], d[2], d[3]], [128, 64, 255, 255], '像素照乘·透明度不动')
})

test('I 读写往返：空物件／摄影机／灯光／父层／3D／表达式存了再读一模一样·坏的丢进 drops', () => {
  const raw = proj([
    { id: 'cam', kind: 'visual', clips: [{ id: 'c1', start: 0, length: 4, offset: 0, rig: { kind: 'camera', x: 0.1, y: 0, z: -2, tx: 0, ty: 0, tz: 0, fov: 35, aperture: 20, focus: 2 }, kf: { 'cam.z': [{ t: 0, v: -2 }, { t: 4, v: -1.5 }], x: [{ t: 0, v: 1 }] } }] },
    { id: 'lt', kind: 'visual', clips: [{ id: 'l1', start: 0, length: 4, offset: 0, rig: { kind: 'light', light: 'spot', color: '#FFAA00', intensity: 1.5, x: -1, y: 1, z: -1, tx: 0, ty: 0, tz: 0, cone: 45, feather: 30 }, kf: { 'lt.int': [{ t: 1, v: 2 }] } }] },
    { id: 'tx', kind: 'text', clips: [{ id: 't1', start: 0, length: 4, offset: 0, text: { content: 'Hi', x: 0.3, y: 0.3, size: 0.1 }, parent: 'n1', d3: { rx: 20 }, expr: { ts: 'value + 0.1 * sin(time)' } }] },
    { id: 'n', kind: 'visual', clips: [{ id: 'n1', start: 0, length: 4, offset: 0, rig: { kind: 'null' }, look: { x: 0.1 }, d3: { z: 0.5 }, kf: { x: [{ t: 0, v: 0 }, { t: 2, v: 0.2 }], 'd3.z': [{ t: 0, v: 0 }, { t: 2, v: 1 }] } }] },
    { id: 'main', kind: 'visual', clips: [{ id: 'k', mediaId: 'img', start: 0, length: 4, offset: 0, parent: 'n1', parentAlpha: true, d3: { z: 0.2, ry: 30 }, expr: { x: 'wiggle(2, 0.02)', 'd3.z': 'value + time * 0.1' }, kf: { 'd3.ry': [{ t: 0, v: 30 }, { t: 4, v: -30 }] } }] },
  ])
  const r = parseProject(raw)
  assert.ok(r.ok)
  if (!r.ok) return
  assert.deepEqual(r.drops, [], `不该丢：${r.drops.join('；')}`)
  const all = r.project.tracks.flatMap((l) => l.clips), by = (id: string) => all.find((c) => c.id === id)!
  assert.equal(by('k').parent, 'n1'); assert.equal(by('k').parentAlpha, true); assert.deepEqual(by('k').d3, { z: 0.2, ry: 30 }); assert.equal(by('k').expr?.['d3.z'], 'value + time * 0.1')
  assert.ok(by('k').kf?.['d3.ry']?.length === 2)
  assert.equal(by('c1').rig?.kind, 'camera'); assert.equal(by('c1').kf?.x, undefined, '摄影机不收画面关键帧'); assert.ok(by('c1').kf?.['cam.z'])
  assert.equal((by('l1').rig as { color: string }).color, '#ffaa00')
  assert.deepEqual(by('t1').d3, { rx: 20 }); assert.equal(by('t1').parent, 'n1')
  const again = parseProject(JSON.parse(JSON.stringify(r.project)))
  assert.ok(again.ok && again.drops.length === 0)
  assert.deepEqual(again.ok && again.project, r.project, '往返不丢不改')
  // 坏的：表达式写错／这段没有那一项 ⇒ expr_bad；光的种类不认得 ⇒ 整段丢（clip_no_media）
  const bad = parseProjectIssues(proj([
    { id: 'lt', kind: 'visual', clips: [{ id: 'l2', start: 0, length: 4, offset: 0, rig: { kind: 'light', light: 'laser' } }] },
    { id: 'main', kind: 'visual', clips: [{ id: 'k', mediaId: 'img', start: 0, length: 4, offset: 0, expr: { x: 'wiggle(', tx: '1', rot: '90 + time' } }] },
  ]))
  assert.ok(bad.ok)
  if (!bad.ok) return
  assert.deepEqual(bad.issues.map((d) => `${d.code}:${d.body ?? d.id}`).sort(), ['clip_no_media:l2', 'expr_bad:tx', 'expr_bad:x'])
  assert.deepEqual(bad.project.tracks.flatMap((l) => l.clips).find((c) => c.id === 'k')!.expr, { rot: '90 + time' }, '好的那句留着')
})

test('J 命令：null.add／clip.setParent／clip.set3d／clip.setExpression／camera.add|update／light.add|update／关键帧 d3.z、cam.z·该拒的拒', () => {
  const base = proj([{ id: 'main', kind: 'visual', clips: [{ id: 'k', mediaId: 'img', start: 0, length: 4, offset: 0 }] }])
  let id = 0
  const newId = () => `id${++id}`
  const r = applyCommands(base, [
    { command: 'null.add', params: { at: 0, length: 4, x: 0.1, d3: true } },
    { command: 'clip.setParent', params: { clips: 'k', parent: '$0', alpha: true } },
    { command: 'clip.set3d', params: { clips: 'k', z: 0.5, ry: 30 } },
    { command: 'clip.setKeyframe', params: { clip: 'k', at: 1, values: { 'd3.z': 1 } } },
    { command: 'clip.setExpression', params: { clip: 'k', prop: 'x', expr: 'wiggle(2, 0.05)' } },
    { command: 'camera.add', params: { at: 0, length: 4, z: -3, fov: 30 } },
    { command: 'camera.update', params: { clip: '$5', aperture: 20 } },
    { command: 'light.add', params: { kind: 'spot', at: 0, length: 4, color: '#FFAA00', intensity: 1.5 } },
    { command: 'light.update', params: { clip: '$7', cone: 40 } },
    { command: 'clip.setKeyframe', params: { clip: '$5', at: 2, values: { 'cam.z': -2 } } },
    { command: 'clip.setExpression', params: { clip: '$0', prop: 'rot', expr: 'time * 45' } },
  ], { newId })
  assert.ok(r.ok, r.ok ? '' : `${r.step}: ${r.error}`)
  if (!r.ok) return
  const all = r.project.tracks.flatMap((l) => l.clips), by = (x: string) => all.find((c) => c.id === x)!
  assert.equal(by('k').parent, 'id1'); assert.equal(by('k').parentAlpha, true); assert.deepEqual(by('k').d3, { z: 0.5, ry: 30 }); assert.ok(by('k').kf?.['d3.z']); assert.equal(by('k').expr?.x, 'wiggle(2, 0.05)')
  assert.deepEqual(by('id1').rig, { kind: 'null' }); assert.deepEqual(by('id1').d3, {}); assert.equal(by('id1').look?.x, 0.1)
  const cam = by(r.results[5].id!).rig as { kind: string; z: number; fov: number; aperture: number }
  assert.equal(cam.kind, 'camera'); assert.equal(cam.z, -3); assert.equal(cam.fov, 30); assert.equal(cam.aperture, 20)
  const light = by(r.results[7].id!).rig as { light: string; color: string; cone: number }
  assert.deepEqual([light.light, light.color, light.cone], ['spot', '#ffaa00', 40])
  const list = applyCommands(r.project, [{ command: 'timeline.list' }])
  assert.ok(list.ok)
  const row = list.ok ? ((list.results[0].data as { lanes: Array<{ clips: Array<Record<string, unknown>> }> }).lanes.flatMap((l) => l.clips).find((c) => c.id === 'k')!) : {}
  assert.equal(row.parent, 'id1'); assert.deepEqual(row.d3, { z: 0.5, ry: 30 }); assert.deepEqual(row.expr, { x: 'wiggle(2, 0.05)' })
  // 该拒的
  const no = (steps: Parameters<typeof applyCommands>[1], re: RegExp) => { const x = applyCommands(r.project, steps); assert.ok(!x.ok && re.test(x.error), `该拒：${JSON.stringify(steps)} ⇒ ${x.ok ? 'ok' : x.error}`) }
  no([{ command: 'clip.setExpression', params: { clip: 'k', prop: 'x', expr: 'wiggle(' } }], /parse/)
  no([{ command: 'clip.setExpression', params: { clip: 'k', prop: 'tx', expr: '1' } }], /can't take an expression/)
  no([{ command: 'clip.setParent', params: { clips: 'id1', parent: 'k' } }], /loop/)
  no([{ command: 'clip.set3d', params: { clips: r.results[5].id!, z: 1 } }], /only video/)
  no([{ command: 'light.add', params: { kind: 'spot', at: 0, color: 'red' } }], /#rrggbb/)
  no([{ command: 'camera.update', params: { clip: 'k', fov: 30 } }], /not a camera/)
  // 3D 关掉 ⇒ 连 d3 关键帧一起拿掉
  const off = applyCommands(r.project, [{ command: 'clip.set3d', params: { clips: 'k', on: false } }])
  assert.ok(off.ok && !off.project.tracks.flatMap((l) => l.clips).find((c) => c.id === 'k')!.d3)
  assert.ok(off.ok && !off.project.tracks.flatMap((l) => l.clips).find((c) => c.id === 'k')!.kf?.['d3.z'])
})

test('K 预览、汇出、抽帧同一份：预览 rigScene＋rigCssMatrix＋灯光滤镜·汇出 scene.order＋warpPixels＋shadePixels（video_edit_frame 走汇出那支 frameDrawer）', () => {
  const pg = readFileSync(join(__dirname, 'page/VideoEditPage.tsx'), 'utf8'), er = readFileSync(join(__dirname, 'ui/export-render.ts'), 'utf8')
  assert.match(pg, /const rigSc = rigScene\(tracks, now, stageRatio \?\? 16 \/ 9\)/)
  assert.match(pg, /rigCssMatrix\(r\.m, rigW, rigH\)/)
  assert.match(pg, /feColorMatrix type="matrix" values=\{shadeMatrixValues\(r\.shade\)\}/)
  assert.match(pg, /data-testid="vedit-null-box"/)
  assert.match(er, /const scene = rigScene\(env\.tracks, t, W \/ H\)/)
  assert.match(er, /scene\.order\(framePlan\(env\.tracks, t, kindOf, only, env\.comps\), \(o\) => o\.clip\)/) // 巢状合成：framePlan 多带子合成
  assert.match(er, /warpPixels\(a\.data, b\.data, W, H, r\.m\)/)
  assert.match(er, /if \(r\.shade\) shadePixels\(b\.data, r\.shade\)/)
  // 空物件／摄影机／灯光不进画（framePlan 跳过）
  const tr: Tracks = [lane('L', 'visual', [nul('n')]), lane('main', 'visual', [img('k')])]
  assert.deepEqual(framePlan(tr, 1, () => 'image').map((o) => o.clip.id), ['k'])
})

console.log(`rig-expr-3d → ${n} 过 ${bad} 败`)
if (bad) process.exit(1)

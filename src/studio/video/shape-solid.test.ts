// 形状／纯色片段＋片头转场题：读档验值与旧工程不变·描边生长 0／0.5／1 的长度·纯色片段·第一段挂转场的混合比例·命令·预览与汇出同一支画法。
// 跑法（在 studio 根目录跑）：node -e "require('sucrase/register/ts');require('./video/shape-solid.test.ts')"
// 药：DILIN_NEG=vedit_shape_solid_off ⇒ 形状／纯色读档丢掉、描边生长恒画满、片头转场不生效 ⇒ A／B／C／D／E 红。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { drawVectorClip, growLength, growProgress, parseShape, parseSolid, pathLength, shapeDefault, shapePaths, truncatePaths, type ShapeBody, type VecCtx } from './lib/shape.pure'
import { parseProject } from './lib/project.pure'
import { applyCommands } from './lib/commands.pure'
import { fxStateAt, laneSeams, setTransition, transLimit } from './lib/fx.pure'
import { framePlan } from './lib/export.pure'
import { frameLayers } from './lib/frame.pure'
import type { TlClip, Tracks } from './lib/timeline.pure'

let n = 0, bad = 0
function test(name: string, fn: () => void) {
  try { fn(); n++; console.log('✓', name) } catch (e) { bad++; console.log('✗', name); console.log('  ', (e as Error).message.split('\n').slice(0, 6).join('\n   ')) }
}
const near = (a: number, b: number, eps = 1e-6, msg = '') => assert.ok(Math.abs(a - b) < eps, `${msg} ${a} ≠ ${b}`)

const lane = (id: string, clips: TlClip[], kind: 'visual' = 'visual') => ({ id, kind, clips, locked: false, hidden: false, muted: false })

test('A 读档验值：形状／纯色留得住、坏值夹范围、旧工程不变', () => {
  const raw = { v: 1, media: [{ id: 'img', name: 'a.png', kind: 'image', duration: 0 }], tracks: [
    lane('ov', [
      { id: 's1', start: 0, length: 3, offset: 9, shape: { shape: 'rect', stroke: '#FF0000', width: 9, fill: '#00ff00', radius: 0.2, w: 0.5, h: 0.4, grow: 1 }, look: { x: 0.1, rot: 30, opacity: 0.5, mask: { shape: 'circle' } }, kf: { x: [{ t: 0, v: 0 }, { t: 2, v: 0.3 }], vol: [{ t: 0, v: 1 }] } },
      { id: 'bad', start: 4, length: 1, offset: 0, shape: { shape: 'star' } },
    ]),
    lane('main', [{ id: 'k', start: 0, length: 5, offset: 0, solid: { color: '#ABCDEF' } }, { id: 'p', start: 5, length: 2, offset: 0, mediaId: 'img' }]),
  ] }
  const r = parseProject(raw)
  assert.ok(r.ok)
  const tr = r.ok ? r.project.tracks : []
  const s1 = tr[0].clips.find((c) => c.id === 's1')!
  assert.deepEqual(s1.shape, { shape: 'rect', stroke: '#ff0000', width: 0.1, fill: '#00ff00', radius: 0.2, w: 0.5, h: 0.4, grow: 1 })
  assert.equal(s1.offset, 0); assert.equal(s1.mediaId, '')
  assert.deepEqual(s1.look, { x: 0.1, rot: 30, opacity: 0.5 }) // 蒙版不收
  assert.deepEqual(Object.keys(s1.kf ?? {}), ['x'])            // 音量关键帧不收
  assert.ok(!tr[0].clips.some((c) => c.id === 'bad'), '认不得的形状要丢')
  assert.deepEqual(tr[1].clips[0].solid, { color: '#abcdef' })
  assert.equal(parseShape({ shape: 'line' })!.fill, undefined)
  assert.equal(parseSolid({ color: 'red' }), null)
  // 旧工程（没有这两栏）来回一趟一字不差
  const old = { v: 1, media: [{ id: 'img', name: 'a.png', kind: 'image', duration: 0 }], tracks: [lane('main', [{ id: 'p', start: 0, length: 2, offset: 0, mediaId: 'img' }])] }
  const o = parseProject(old)
  assert.ok(o.ok); const oc = o.ok ? o.project.tracks[0].clips[0] : null
  assert.deepEqual(oc, { id: 'p', mediaId: 'img', start: 0, length: 2, offset: 0 })
})

test('B 描边生长：进度 0／0.5／1 画出的长度＝全长×进度（矩形、直线、箭头）', () => {
  const W = 1600, H = 900
  const rect: ShapeBody = { ...shapeDefault('rect'), w: 0.5, h: 0.4, grow: 2 }
  near(pathLength(shapePaths(rect, W, H)), 2 * (800 + 360), 1e-6, '矩形全长')
  const c: TlClip = { id: 's', mediaId: '', start: 10, length: 4, offset: 0, shape: rect }
  near(growProgress(c, 10), 0); near(growProgress(c, 11), 0.5); near(growProgress(c, 12), 1); near(growProgress(c, 13), 1)
  near(growLength(rect, W, H, growProgress(c, 10)), 0)
  near(growLength(rect, W, H, growProgress(c, 11)), 1160)
  near(growLength(rect, W, H, growProgress(c, 12)), 2320)
  // 截一半：前两条边（顶 800＋右 360）
  const half = truncatePaths(shapePaths(rect, W, H), 1160)
  near(pathLength(half), 1160); assert.deepEqual(half[0].pts[half[0].pts.length - 1].map(Math.round), [1200, 630])
  const line: ShapeBody = { ...shapeDefault('line'), w: 0.5 }
  near(growLength(line, W, H, 0.5), 400)
  const arrow: ShapeBody = { ...shapeDefault('arrow'), w: 0.5 }
  const ap = shapePaths(arrow, W, H)
  assert.equal(ap.length, 2); near(pathLength(truncatePaths(ap, 400)), 400)
  assert.equal(truncatePaths(ap, 400).length, 1, '一半时箭头翼还没开始画')
  // 没设 grow ⇒ 一出来就画满
  near(growProgress({ start: 0, shape: shapeDefault('ellipse') }, 0), 1)
})

/** 记下画布调用的假画布 */
function recCtx() {
  const calls: string[] = []
  const ctx = { globalAlpha: 1, fillStyle: '' as unknown, strokeStyle: '' as unknown, lineWidth: 1, lineCap: 'butt', lineJoin: 'miter' } as VecCtx & { calls: string[] }
  for (const m of ['save', 'restore', 'translate', 'rotate', 'scale', 'beginPath', 'moveTo', 'lineTo', 'closePath', 'fill', 'stroke', 'fillRect'] as const)
    (ctx as unknown as Record<string, unknown>)[m] = (...a: number[]) => calls.push(`${m}(${a.map((v) => Math.round(v * 100) / 100).join(',')})${m === 'fillRect' || m === 'fill' ? `:${String(ctx.fillStyle)}@${ctx.globalAlpha}` : m === 'stroke' ? `:${String(ctx.strokeStyle)}` : ''}`)
  ctx.calls = calls
  return ctx
}

test('C 纯色片段：读档→汇出画法铺满整个画面（颜色、不透明度关键帧）·命令 solid.add 进空主轨', () => {
  const raw = { v: 1, media: [], tracks: [lane('main', [{ id: 'k', start: 0, length: 4, offset: 0, solid: { color: '#112233' }, look: { opacity: 0.5 } }])] }
  const r = parseProject(raw); assert.ok(r.ok)
  const tr = r.ok ? r.project.tracks : []
  const ops = framePlan(tr, 1, () => undefined)
  assert.equal(ops.length, 1); assert.equal(ops[0].kind, 'vector')
  const ctx = recCtx(); drawVectorClip(ctx, ops[0].clip, 1, 1920, 1080)
  assert.ok(ctx.calls.includes('fillRect(0,0,1920,1080):#112233@0.5'), ctx.calls.join(' '))
  assert.equal(frameLayers(tr, 1, () => null)[0].solid, '#112233')
  const a = applyCommands({ v: 1, media: [], tracks: [lane('main', [])] }, [{ command: 'solid.add', params: { color: '#000000', at: 0 } }, { command: 'solid.update', params: { clip: '$0', color: '#ffffff' } }])
  assert.ok(a.ok, JSON.stringify(a))
  const c = a.ok ? a.project.tracks.find((l) => l.id === 'main')!.clips[0] : null
  assert.deepEqual(c?.solid, { color: '#ffffff' }); near(c!.length, 5)
})

test('D 片头转场：第一段挂 tr-slats ⇒ 从黑场进场·混合进度 0／0.5／1·接缝转场照旧', () => {
  const v = (id: string, start: number, length: number): TlClip => ({ id, mediaId: 'img', start, length, offset: 0 })
  let tr: Tracks = [lane('main', [v('a', 1, 4), v('b', 5, 4)])]
  assert.equal(transLimit(tr[0], tr[0].clips[0]) > 0, true)
  tr = setTransition(tr, 'a', 'tr-slats', 1)
  assert.deepEqual(tr[0].clips[0].transIn, { tr: 'tr-slats', length: 1 })
  assert.equal(laneSeams(tr[0])[0].head, true)
  const at = (t: number) => fxStateAt(tr[0], t)?.trans ?? null
  const p0 = at(1), pm = at(1.5), p1 = at(2)
  assert.ok(p0 && p0.head && p0.live === 'to', '开头要有片头转场')
  const lin = (p: number) => p // tr-slats ease 若是 linear 就匀速；不然 smoothstep——两种在 0／0.5 都一样
  near(p0!.progress, lin(0)); near(pm!.progress, 0.5)
  assert.equal(p1, null, '过了转场长度就结束（进度 1＝全是这段）')
  near(at(1.999)!.progress, 1, 0.01)
  // 汇出：另一边不取素材（黑场）·预览那份进度同一个
  const op = framePlan(tr, 1.5, () => 'image')[0]
  assert.equal(op.kind, 'media')
  if (op.kind === 'media') { assert.equal(op.trans?.head, true); assert.equal(op.trans?.otherMedia, ''); near(op.trans!.progress, 0.5) }
  const row = frameLayers(tr, 1.5, () => ({ name: 'a', kind: 'image' }))[0]
  assert.deepEqual(row.transition, { tr: 'tr-slats', from: '', to: 'a', progress: 0.5, length: 1 })
  // 接缝转场照旧（b 前面接着 a）
  tr = setTransition(tr, 'b', 'tr-slats', 1)
  const s = fxStateAt(tr[0], 5.25)!.trans!
  assert.ok(!s.head); assert.equal(s.other.clip.id, 'a')
  // 命令也收第一段
  const cmd = applyCommands({ v: 1, media: [{ id: 'img', name: 'a.png', kind: 'image', duration: 0 }], tracks: [lane('main', [v('a', 0, 4)])] }, [{ command: 'clip.setTransition', params: { clip: 'a', transition: 'tr-slats', length: 0.8 } }])
  assert.ok(cmd.ok, JSON.stringify(cmd))
  assert.ok(fxStateAt((cmd.ok ? cmd.project.tracks : [])[0], 0.2)?.trans?.head)
})

test('E 形状命令＋预览与汇出同一支画法（drawVectorClip）＋关键帧位置／不透明度', () => {
  const a = applyCommands({ v: 1, media: [], tracks: [lane('main', [])] }, [
    { command: 'shape.add', params: { shape: 'arrow', at: 0, stroke: '#00ff00', width: 0.02, grow: 2 } },
    { command: 'clip.setKeyframe', params: { clip: '$0', at: 0, values: { x: 0, opacity: 1 } } },
    { command: 'clip.setKeyframe', params: { clip: '$0', at: 2, values: { x: 0.25, opacity: 0.5 } } },
  ])
  assert.ok(a.ok, JSON.stringify(a))
  const tr = a.ok ? a.project.tracks : []
  const c = tr.find((l) => l.id === 'main')!.clips[0]
  assert.equal(c.shape?.shape, 'arrow'); assert.equal(c.shape?.grow, 2)
  const back = parseProject(JSON.parse(JSON.stringify(a.ok ? a.project : {})))
  assert.ok(back.ok); assert.deepEqual(back.ok ? back.project.tracks.find((l) => l.id === 'main')!.clips[0] : null, c)
  const ctx = recCtx(); drawVectorClip(ctx, c, 1, 1000, 500)
  // t=1：关键帧中间 ⇒ x＝0.125（往右 125px）·不透明度 0.75·描边画到一半（只有杆没有翼）
  assert.ok(ctx.calls.includes('translate(625,250)'), ctx.calls.join(' '))
  near(ctx.globalAlpha, 0.75) // 假画布 save/restore 不还原 ⇒ 留着的就是描边时的不透明度（关键帧中间）
  assert.ok(ctx.calls.some((x) => x === 'stroke():#00ff00'))
  assert.equal(ctx.calls.filter((x) => x.startsWith('moveTo')).length, 1, '一半时只画杆')
  const er = readFileSync(join(__dirname, 'ui/export-render.ts'), 'utf8'), vc = readFileSync(join(__dirname, 'ui/VectorCanvas.tsx'), 'utf8'), pg = readFileSync(join(__dirname, 'page/VideoEditPage.tsx'), 'utf8'), fc = readFileSync(join(__dirname, 'ui/FxCanvas.tsx'), 'utf8')
  assert.match(er, /drawVectorClip\(ctx, op\.clip, t, W, H\)/); assert.match(vc, /drawVectorClip\(ctx, clip, t, w, h\)/)
  assert.match(pg, /<VeditVectorCanvas clip=\{s\.hit!\.clip\} t=\{now\} \/>/)
  assert.match(er, /op\.trans\?\.head/); assert.match(fc, /o\.kind === 'blank'/); assert.match(pg, /fxSt\?\.trans\?\.head \? \{ url: '', kind: 'blank'/)
})

console.log(`shape-solid → ${n} 过 ${bad} 败`)
if (bad) process.exit(1)

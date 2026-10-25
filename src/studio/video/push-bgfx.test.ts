// 推镜头「推到框」＋程序画动态背景（星空粒子／光斑漂移）题：
//   推到框：框填满画面、中心对准、已放大／挪位／旋转的片段再推仍正确、缓动写进关键帧、命令 clip.pushToBox、面板与页面接线；
//   动态背景：同种子同时刻一致、不同时刻会动、读档验值、汇出画法接线（预览汇出同一支 drawVectorClip ⇒ drawBgfx）、命令 bgfx.add／bgfx.update。
// 跑法（在 studio 根目录跑）：node -e "require('sucrase/register/ts');require('./video/push-bgfx.test.ts')"
// 药：DILIN_NEG=vedit_bg_bottom_off ⇒ 背景照一般规则放在主轨上面一条 ⇒ I 红；DILIN_NEG=vedit_push_box_off ⇒ 不扣片段已有变换、缓动不写 ⇒ B／C／D 红；DILIN_NEG=vedit_bgfx_off ⇒ 读档丢掉、圆点不随时间动 ⇒ F／G／H 红。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { applyPushBox, pushBoxKeys, pushTarget } from './lib/push-box.pure'
import { hostMap, hostUnmap, hostXf, type TrackBox } from './lib/motion-track.pure'
import { lookOf } from './lib/clip-look.pure'
import { srcAt, type TlClip, type Tracks } from './lib/timeline.pure'
import { applyCommands } from './lib/commands.pure'
import { parseProject } from './lib/project.pure'
import { bgfxCount, bgfxDefault, bgfxFrame, parseBgfx, rng, type BgfxBody } from './lib/bgfx.pure'
import { addBackgroundAt, drawVectorClip, isVectorClip, newBgfxClip, newSolidClip, patchBgfx, type VecCtx } from './lib/shape.pure'
import { framePlan } from './lib/export.pure'
import { frameLayers } from './lib/frame.pure'

let n = 0, bad = 0
function test(name: string, fn: () => void) {
  try { fn(); n++; console.log('✓', name) } catch (e) { bad++; console.log('✗', name); console.log('  ', (e as Error).message.split('\n').slice(0, 6).join('\n   ')) }
}
const near = (a: number, b: number, eps = 1e-3, msg = '') => assert.ok(Math.abs(a - b) < eps, `${msg} ${a} ≠ ${b}`)
const lane = (id: string, clips: TlClip[], kind: 'visual' = 'visual') => ({ id, kind, clips, locked: false, hidden: false, muted: false })
const A = 16 / 9

/** 套完之后：推到终点那一刻，原本画在屏幕上的框（经起点那刻片段变换反算到片段座标）落在哪 ⇒ 中心与宽高（画面比例） */
function boxAfter(c0: TlClip, c1: TlClip, t0: number, t1: number, box: TrackBox): { cx: number; cy: number; w: number; h: number } {
  const h0 = hostXf(c0, t0), h1 = hostXf(c1, t1)
  const corners: Array<[number, number]> = [[box.x - box.w / 2, box.y - box.h / 2], [box.x + box.w / 2, box.y - box.h / 2], [box.x + box.w / 2, box.y + box.h / 2], [box.x - box.w / 2, box.y + box.h / 2]]
  const m = corners.map(([x, y]) => { const [ux, uy] = hostUnmap(h0, A, x, y); return hostMap(h1, A, ux, uy) })
  const xs = m.map((p) => p[0]), ys = m.map((p) => p[1])
  return { cx: (Math.min(...xs) + Math.max(...xs)) / 2, cy: (Math.min(...ys) + Math.max(...ys)) / 2, w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }
}
const withKf = (c: TlClip, kf: TlClip['kf']): TlClip => ({ ...c, kf })
const fills = (r: { cx: number; cy: number; w: number; h: number }, msg: string) => {
  near(r.cx, 0.5, 1e-3, `${msg} 中心 x`); near(r.cy, 0.5, 1e-3, `${msg} 中心 y`)
  near(Math.max(r.w, r.h), 1, 2e-3, `${msg} 填满（长的那边＝1）`)
  assert.ok(r.w <= 1 + 2e-3 && r.h <= 1 + 2e-3, `${msg} 两边都装得下 ${r.w} ${r.h}`)
}

test('A 推到框：框填满画面、中心对准（没变换的片段·值照算）', () => {
  const c: TlClip = { id: 'v', mediaId: 'm', start: 2, length: 6, offset: 1 }
  const box: TrackBox = { x: 0.75, y: 0.25, w: 0.25, h: 0.2 }
  const tg = pushTarget(c, 3, box, A)
  near(tg.sx, 4); near(tg.sy, 4) // 1／max(0.25,0.2)
  near(tg.x, -1); near(tg.y, -1) // 框心在右上 ⇒ 往左、往下挪（y 往上为正）
  const r = pushBoxKeys(c, 3, box, 1, 'inout', A)!
  assert.ok(r); near(r.t1, 4)
  fills(boxAfter(c, withKf(c, r.kf), 3, 4, box), '没变换')
  // 起点那刻＝现在的样子（看起来没动）
  const l0 = lookOf(withKf(c, r.kf), 3); near(l0.sx, 1); near(l0.x, 0); near(l0.y, 0)
  // 中途在两者之间
  const lm = lookOf(withKf(c, r.kf), 3.5); assert.ok(lm.sx > 1 && lm.sx < 4)
})

test('B 已放大／挪位／旋转（含关键帧）的片段再推仍正确', () => {
  const box: TrackBox = { x: 0.4, y: 0.6, w: 0.3, h: 0.4 }
  const c1: TlClip = { id: 'v', mediaId: 'm', start: 0, length: 10, offset: 0, look: { sx: 2, sy: 2, x: 0.1, y: -0.05 } }
  const r1 = pushBoxKeys(c1, 1, box, 2, 'out', A)!
  fills(boxAfter(c1, withKf(c1, r1.kf), 1, 3, box), '已放大挪位')
  near(r1.to.sx, 2 / 0.4) // 现在的缩放 × 2.5
  const c2: TlClip = { id: 'v', mediaId: 'm', start: 0, length: 10, offset: 0, look: { sx: 1.5, sy: 1.5, x: -0.2, y: 0.1, rot: 30 } }
  fills(boxAfter(c2, withKf(c2, pushBoxKeys(c2, 0, box, 1, 'linear', A)!.kf), 0, 1, box), '旋转 30°')
  // 已经有关键帧推过一次（第 0～1 秒放大到 2）⇒ 在第 2 秒再推一次
  const c3: TlClip = { id: 'v', mediaId: 'm', start: 0, length: 10, offset: 0, kf: { sx: [{ t: 0, v: 1 }, { t: 1, v: 2 }], sy: [{ t: 0, v: 1 }, { t: 1, v: 2 }], x: [{ t: 0, v: 0 }, { t: 1, v: 0.3 }] } }
  const r3 = pushBoxKeys(c3, 2, box, 1, 'inout', A)!
  const c3b = withKf(c3, r3.kf)
  fills(boxAfter(c3, c3b, 2, 3, box), '关键帧推过再推')
  near(lookOf(c3b, 0.5).sx, 1.5, 1e-3, '前面那次推的关键帧留着')
  // 不等比缩放：维持宽高比
  const c4: TlClip = { id: 'v', mediaId: 'm', start: 0, length: 10, offset: 0, look: { sx: 1, sy: 2, uniform: false } }
  const t4 = pushTarget(c4, 0, { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }, A)
  near(t4.sx, 2); near(t4.sy, 4)
})

test('C 缓动写进关键帧·两颗之间旧关键帧拿掉·到片尾为止·不合回 null', () => {
  const c: TlClip = { id: 'v', mediaId: 'm', start: 10, length: 3, offset: 5, kf: { x: [{ t: 5, v: 0 }, { t: 6.5, v: 0.2 }, { t: 8, v: 0.1 }], opacity: [{ t: 6, v: 0.5 }] } }
  const box: TrackBox = { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }
  const r = pushBoxKeys(c, 11, box, 5, 'out', A)!
  near(r.t1, 13, 1e-6, '到片尾为止')
  const s0 = srcAt(c, 11), s1 = srcAt(c, 13)
  for (const p of ['sx', 'sy', 'x', 'y'] as const) {
    const k0 = r.kf[p]!.find((k) => Math.abs(k.t - s0) < 1e-3)!, k1 = r.kf[p]!.find((k) => Math.abs(k.t - s1) < 1e-3)!
    assert.ok(k0 && k1, `${p} 两颗都在`)
    assert.equal(k0.e, 'out', `${p} 起点那颗带缓动`)
  }
  assert.deepEqual(r.kf.x!.map((k) => k.t), [5, 6, 8], '两颗之间那颗（6.5）拿掉·前面那颗留着·终点在 8')
  assert.deepEqual(r.kf.opacity, [{ t: 6, v: 0.5 }], '别的关键帧不动')
  assert.equal(pushBoxKeys(c, 9, box, 1, 'out', A), null, '播放头在片段外')
  assert.equal(pushBoxKeys(c, 12.99, box, 1, 'out', A), null, '剩不到一格')
  // 锁了的轨不动
  const tr: Tracks = [{ ...lane('main', [c]), locked: true }]
  assert.equal(applyPushBox(tr, 'v', 11, box, 1, 'out', A), null)
})

test('D 命令 clip.pushToBox：照工程画面比例算·读档来回一样·文字片段拒', () => {
  const proj = { v: 1, ratio: { kind: 'preset', key: '9:16' }, media: [{ id: 'm', name: 'a.mp4', kind: 'video', duration: 20 }], tracks: [lane('main', [{ id: 'v', mediaId: 'm', start: 0, length: 8, offset: 0, look: { sx: 1.2 } }])] }
  const r = applyCommands(proj as never, [{ command: 'clip.pushToBox', params: { clip: 'v', at: 1, box: { x: 0.3, y: 0.7, w: 0.4, h: 0.2 }, duration: 1.5, ease: 'inout2' } }])
  assert.ok(r.ok, JSON.stringify(r))
  const c = r.ok ? r.project.tracks.find((l) => l.id === 'main')!.clips[0] : null
  assert.ok(c?.kf?.sx && c.kf.x && c.kf.y)
  assert.equal(c!.kf!.sx![0].e, 'inout2')
  const c0 = proj.tracks[0].clips[0] as TlClip
  const h0 = hostXf(c0, 1), h1 = hostXf(c!, 2.5)
  const [ux, uy] = hostUnmap(h0, 9 / 16, 0.3, 0.7)
  const [px, py] = hostMap(h1, 9 / 16, ux, uy)
  near(px, 0.5); near(py, 0.5)
  near(lookOf(c!, 2.5).sx, 1.2 / 0.4)
  const back = parseProject(JSON.parse(JSON.stringify(r.ok ? r.project : {})))
  assert.ok(back.ok); assert.deepEqual(back.ok ? back.project.tracks.find((l) => l.id === 'main')!.clips[0] : null, c)
  const txt = applyCommands({ v: 1, media: [], tracks: [lane('main', [])] } as never, [{ command: 'text.add', params: { content: 'hi', at: 0 } }, { command: 'clip.pushToBox', params: { clip: '$0', at: 0.5, box: { x: 0.5, y: 0.5, w: 0.5, h: 0.5 } } }])
  assert.equal(txt.ok, false)
})

test('E 面板与页面接线：画面页「推镜头」组（拉框／时长／缓动／套用）·预览拉框·套用叫 applyPushBox', () => {
  const ci = readFileSync(join(__dirname, 'ui/ClipInspector.tsx'), 'utf8'), pg = readFileSync(join(__dirname, 'page/VideoEditPage.tsx'), 'utf8')
  for (const id of ['vedit-push-select', 'vedit-push-dur', 'vedit-push-ease', 'vedit-push-apply']) assert.ok(ci.includes(`testid="${id}"`), id)
  assert.match(ci, /\{host\.push && <PushSection host=\{host\} push=\{host\.push\} \/>\}/)
  assert.match(pg, /if \(pushSelRef\.current\) \{ onPushDown\(e\); return \}/)
  assert.match(pg, /applyPushBox\(tracksRef\.current, id, nowRef\.current, pushBox, pushDur, pushEase, stageRatioRef\.current \?\? 16 \/ 9\)/)
  assert.match(pg, /data-testid="vedit-push-box-overlay"/)
})

// ── 动态背景 ──
const stars = (o: Partial<BgfxBody> = {}): BgfxBody => ({ ...bgfxDefault('stars', 42), ...o })
const bokeh = (o: Partial<BgfxBody> = {}): BgfxBody => ({ ...bgfxDefault('bokeh', 7), ...o })

test('F 同种子同时刻一致·不同时刻会动·不同种子不同·速度 0 静止·密度定颗数·视差会变', () => {
  const a = bgfxFrame(stars(), 1.25, 1920, 1080), b = bgfxFrame(stars(), 1.25, 1920, 1080)
  assert.deepEqual(a, b, '同种子同时刻')
  assert.equal(a.dots.length, bgfxCount(stars()))
  const later = bgfxFrame(stars(), 2.5, 1920, 1080)
  assert.notDeepEqual(later.dots, a.dots, '星星会动／闪')
  const moved = later.dots.filter((d, i) => Math.hypot(d.x - a.dots[i].x, d.y - a.dots[i].y) > 0.5).length
  assert.ok(moved > a.dots.length / 2, `大半会漂移 ${moved}`)
  assert.notDeepEqual(bgfxFrame(stars({ seed: 43 }), 1.25, 1920, 1080).dots, a.dots, '换种子换画面')
  const s0 = bgfxFrame(stars({ speed: 0 }), 0, 1920, 1080), s9 = bgfxFrame(stars({ speed: 0 }), 9, 1920, 1080)
  assert.deepEqual(s9, s0, '速度 0 ⇒ 静止')
  assert.ok(bgfxCount(stars({ density: 1 })) > bgfxCount(stars({ density: 0 })))
  const bk0 = bgfxFrame(bokeh(), 0, 1000, 500), bk1 = bgfxFrame(bokeh(), 3, 1000, 500)
  assert.ok(bk0.dots.every((d) => d.soft && d.r >= 0.04 * 500 - 1e-6), '光斑＝柔边大圆')
  assert.notDeepEqual(bk1.dots, bk0.dots, '光斑会飘')
  const p0 = bgfxFrame(bokeh({ parallax: true }), 0, 1000, 500).view, p1 = bgfxFrame(bokeh({ parallax: true }), 6, 1000, 500).view
  assert.deepEqual(p0, { scale: 1, dx: 0, dy: 0 }); assert.ok(p1.scale > 1 && p1.dx !== 0, '视差：整体慢慢平移放大')
  assert.deepEqual(bgfxFrame(bokeh(), 6, 1000, 500).view, { scale: 1, dx: 0, dy: 0 }, '没开视差不动')
  const r1 = rng(5), r2 = rng(5); assert.deepEqual([r1(), r1(), r1()], [r2(), r2(), r2()])
})

test('G 读档验值：留得住、坏值夹范围、认不得的丢、旧工程不变', () => {
  const raw = { v: 1, media: [], tracks: [lane('main', [
    { id: 'b1', start: 0, length: 5, offset: 3, bgfx: { kind: 'bokeh', color: '#FF00AA', bg: 'nope', density: 4, speed: -1, seed: 12.6, parallax: true }, look: { opacity: 0.8, mask: { shape: 'circle' } }, kf: { sx: [{ t: 0, v: 1 }, { t: 2, v: 1.2 }] } },
    { id: 'b2', start: 6, length: 2, offset: 0, bgfx: { kind: 'rain' } },
  ] as unknown as TlClip[])] }
  const r = parseProject(raw); assert.ok(r.ok)
  const cl = r.ok ? r.project.tracks[0].clips : []
  assert.deepEqual(cl[0].bgfx, { kind: 'bokeh', color: '#ff00aa', bg: '#0b1020', density: 1, speed: 0, seed: 13, parallax: true })
  assert.equal(cl[0].offset, 0); assert.deepEqual(cl[0].look, { opacity: 0.8 }); assert.deepEqual(Object.keys(cl[0].kf ?? {}), ['sx'])
  assert.ok(!cl.some((c) => c.id === 'b2'), '认不得的种类要丢')
  assert.equal(parseBgfx({ kind: 'stars', parallax: 'yes' })!.parallax, undefined)
  assert.ok(isVectorClip(cl[0]))
  // 改参数：验值同读档
  const tr = patchBgfx(r.ok ? r.project.tracks : [], 'b1', { density: 0.25, parallax: false, color: 'bad' })
  assert.deepEqual(tr[0].clips[0].bgfx, { kind: 'bokeh', color: '#ff00aa', bg: '#0b1020', density: 0.25, speed: 0, seed: 13 })
  const old = { v: 1, media: [{ id: 'img', name: 'a.png', kind: 'image', duration: 0 }], tracks: [lane('main', [{ id: 'p', start: 0, length: 2, offset: 0, mediaId: 'img' }])] }
  const o = parseProject(old); assert.ok(o.ok)
  assert.deepEqual(o.ok ? o.project.tracks[0].clips[0] : null, { id: 'p', mediaId: 'img', start: 0, length: 2, offset: 0 })
})

/** 记下画布调用的假画布 */
function recCtx() {
  const calls: string[] = []
  const ctx = { globalAlpha: 1, fillStyle: '' as unknown, strokeStyle: '' as unknown, lineWidth: 1, lineCap: 'butt', lineJoin: 'miter' } as VecCtx & { calls: string[] }
  for (const m of ['save', 'restore', 'translate', 'rotate', 'scale', 'beginPath', 'moveTo', 'lineTo', 'closePath', 'fill', 'stroke', 'fillRect', 'arc'] as const)
    (ctx as unknown as Record<string, unknown>)[m] = (...a: number[]) => calls.push(`${m}(${a.map((v) => Math.round(v * 100) / 100).join(',')})${m === 'fillRect' || m === 'fill' ? `:${String(ctx.fillStyle)}@${Math.round(ctx.globalAlpha * 1000) / 1000}` : ''}`)
  ctx.calls = calls
  return ctx
}

test('H 汇出画法接线：framePlan 出 vector·drawVectorClip 画底色＋每颗圆点（同 bgfxFrame）·命令 bgfx.add／update·素材区两颗', () => {
  const a = applyCommands({ v: 1, media: [], tracks: [lane('main', [])] } as never, [
    { command: 'bgfx.add', params: { kind: 'stars', at: 0, seed: 99, density: 0.2, color: '#AACCFF' } },
    { command: 'bgfx.update', params: { clip: '$0', speed: 0.5, parallax: true } },
  ])
  assert.ok(a.ok, JSON.stringify(a))
  const tr = a.ok ? a.project.tracks : []
  const c = tr.find((l) => l.id === 'main')!.clips[0]
  assert.deepEqual(c.bgfx, { kind: 'stars', color: '#aaccff', bg: '#05070f', density: 0.2, speed: 0.5, seed: 99, parallax: true }); near(c.length, 5)
  const ops = framePlan(tr, 2, () => undefined)
  assert.equal(ops.length, 1); assert.equal(ops[0].kind, 'vector')
  const ctx = recCtx(); drawVectorClip(ctx, ops[0].clip, 2, 640, 360)
  assert.ok(ctx.calls.includes('fillRect(0,0,640,360):#05070f@1'), ctx.calls.slice(0, 6).join(' '))
  const fr = bgfxFrame(c.bgfx!, 2, 640, 360)
  const arcs = ctx.calls.filter((x) => x.startsWith('arc('))
  assert.equal(arcs.length, fr.dots.filter((d) => d.a > 0 && d.r > 0).length, '每颗一个圆')
  const d0 = fr.dots[0]; assert.equal(arcs[0], `arc(${[d0.x, d0.y, d0.r, 0, Math.PI * 2].map((v) => Math.round(v * 100) / 100).join(',')})`, '圆点＝bgfxFrame 那份')
  assert.equal(frameLayers(tr, 1, () => null)[0].bgfx, 'stars')
  assert.equal(newBgfxClip('x', 'bokeh', 3).bgfx!.seed, 3)
  const sh = readFileSync(join(__dirname, 'lib/shape.pure.ts'), 'utf8'), at = readFileSync(join(__dirname, 'ui/AssetTabs.tsx'), 'utf8'), pg = readFileSync(join(__dirname, 'page/VideoEditPage.tsx'), 'utf8'), er = readFileSync(join(__dirname, 'ui/export-render.ts'), 'utf8')
  assert.match(sh, /if \(c\.bgfx\) \{ drawBgfx\(ctx, c\.bgfx, t - c\.start, W, H, xf\.opacity\)/)
  assert.match(er, /drawVectorClip\(ctx, op\.clip, t, W, H\)/)
  assert.match(at, /data-testid="vedit-bgfx-item"/); assert.match(pg, /onBgfx: \(k\) => pickVector\(newBgfxClip\(/)
  assert.match(pg, /s\.hit\?\.clip\.bgfx\)\) \{/)
})

test('I 背景类（星空／纯色）点一下或命令不指定轨 ⇒ 放最底：主轨空那段直接进·被占那段原样挪上一条·指定轨照旧', () => {
  const shot: TlClip = { id: 'shot', start: 0, length: 4, offset: 0, mediaId: 'm1' } as TlClip
  const later: TlClip = { id: 'later', start: 6, length: 2, offset: 0, mediaId: 'm1' } as TlClip
  const top: TlClip = { id: 'top', start: 0, length: 3, offset: 0, mediaId: 'm2' } as TlClip
  const tr0: Tracks = [lane('v1', [top]), lane('main', [shot, later])] as Tracks
  let k = 0
  const r = addBackgroundAt(tr0, newBgfxClip('bg', 'stars', 1), 1, () => `L${++k}`)
  assert.equal(r.moved, 1)
  assert.deepEqual(r.tracks.map((l) => l.id), ['v1', 'L1', 'main'], '挪上去的那条在主轨正上方、原上层不动')
  assert.deepEqual(r.tracks[1].clips.map((c) => [c.id, c.start]), [['shot', 0]], '被占那段原样（起点不变）')
  assert.deepEqual(r.tracks[2].clips.map((c) => c.id).sort(), ['bg', 'later'], '背景进主轨·不重叠的主轨片段留着')
  near(r.tracks[2].clips.find((c) => c.id === 'bg')!.start, 1)
  // 主轨那段空着 ⇒ 直接进、不加轨
  const r2 = addBackgroundAt([lane('main', [later])] as Tracks, newSolidClip('s', '#000000'), 0, () => 'X')
  assert.equal(r2.moved, 0); assert.equal(r2.tracks.length, 1); assert.deepEqual(r2.tracks[0].clips.map((c) => c.id).sort(), ['later', 's'])
  // 命令：不指定轨 ⇒ 放最底＋回一句；指定轨 ⇒ 照旧
  const a = applyCommands({ v: 1, media: [{ id: 'm1', name: 'a.png', kind: 'image', duration: 0 }], tracks: [lane('main', [shot])] } as never, [
    { command: 'bgfx.add', params: { kind: 'bokeh', at: 0 } },
    { command: 'solid.add', params: { color: '#000000', at: 0, lane: '$0.lane' } },
  ])
  assert.ok(a.ok, JSON.stringify(a))
  if (a.ok) {
    const main = a.project.tracks.find((l) => l.id === 'main')!
    assert.ok(main.clips.some((c) => c.bgfx), 'bgfx.add 进主轨（最底）')
    assert.equal(a.project.tracks[a.project.tracks.length - 1].id, 'main')
    assert.ok(a.project.tracks.some((l) => l.id !== 'main' && l.clips.some((c) => c.id === 'shot')), '截图挪上一条')
    assert.match(String((a as { results?: Array<{ note?: string }> }).results?.[0]?.note ?? ''), /moved up one lane/)
  }
  // 页面点一下：背景类走 addBackgroundAt，形状照一般规则
  const pg = readFileSync(join(__dirname, 'page/VideoEditPage.tsx'), 'utf8')
  assert.match(pg, /isBackgroundClip\(c\) \? addBackgroundAt\(/, '点一下走 addBackgroundAt')
})

console.log(`push-bgfx → ${n} 过 ${bad} 败`)
if (bad) process.exit(1)

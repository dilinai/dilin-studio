// 运动跟踪题：NCC 追踪在合成移动方块上算对·绑定后位置·预览 CSS 与汇出同一份计算·改字不丢跟随·旧工程不变·命令 clip.followTrack·文字贴纸四角透视面板接线。
// 跑法（在 studio 根目录跑）：node -e "require('sucrase/register/ts');require('./video/motion-track.test.ts')"
// 药：DILIN_NEG=vedit_track_follow_off ⇒ followAt 恒 null（跟随不生效）⇒ B／C／D／F 红。
// 药：DILIN_NEG=vedit_track_host_off ⇒ 不扣影片片段自身变换 ⇒ G／H 红。
// 药：DILIN_NEG=vedit_retrack_seam_off ⇒ 重追不对齐接缝 ⇒ K 红。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { patchMTracks, bindFollow, boxToHost, hostMap, hostUnmap, hostXf, mergeMTrack, tlAtSrc, followAffine, followAt, followCssMatrix, followPoint, makeMTrack, mtrackAt, parseFollow, parseMTracks, trackFrames, trackTimes, type Gray, type MTrack } from './lib/motion-track.pure'
import { applyClipPatch, patchClips } from './lib/clip-look.pure'
import { parseProject } from './lib/project.pure'
import { applyCommands } from './lib/commands.pure'
import type { TlClip, Tracks } from './lib/timeline.pure'

let n = 0, bad = 0
function test(name: string, fn: () => void) {
  try { fn(); n++; console.log('✓', name) } catch (e) { bad++; console.log('✗', name); console.log('  ', (e as Error).message.split('\n').slice(0, 6).join('\n   ')) }
}
const near = (a: number, b: number, eps = 1e-6, msg = '') => assert.ok(Math.abs(a - b) < eps, `${msg} ${a} ≠ ${b}`)

// 合成帧：有纹理的背景上一块有纹理的方块·逐格平移＋放大
const W = 160, H = 90
function frame(cx: number, cy: number, sz: number): Gray {
  const d = new Float32Array(W * H)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = x - cx, dy = y - cy
    d[y * W + x] = Math.abs(dx) < sz / 2 && Math.abs(dy) < sz / 2 ? 128 + 90 * Math.sin((dx / sz) * 9 + 0.5) * Math.cos((dy / sz) * 7 + 0.3) : 40 + ((x * 7 + y * 13) % 23)
  }
  return { w: W, h: H, d }
}

test('A 追踪：移动＋放大的方块·每格中心误差 <1 像素·缩放误差 <5%', () => {
  const fr: Gray[] = [], truth: Array<[number, number, number]> = []
  for (let i = 0; i < 30; i++) { const s = 1 + i * 0.01; fr.push(frame(30 + i * 2.5, 40 + i * 0.8, 20 * s)); truth.push([30 + i * 2.5, 40 + i * 0.8, s]) }
  const r = trackFrames(fr, { x: 30 / W, y: 40 / H, w: 26 / W, h: 26 / H })
  assert.equal(r.length, 30)
  r.forEach((p, i) => assert.ok(Math.hypot(p.x * W - truth[i][0], p.y * H - truth[i][1]) < 1, `第 ${i} 格偏 ${Math.hypot(p.x * W - truth[i][0], p.y * H - truth[i][1]).toFixed(2)} 像素`))
  near(r[29].s, truth[29][2], 0.05, '缩放')
  // 只平移（关缩放）也对
  const fr2 = Array.from({ length: 12 }, (_, i) => frame(80 - i * 3, 45 + i * 1.5, 22))
  const r2 = trackFrames(fr2, { x: 80 / W, y: 45 / H, w: 26 / W, h: 26 / H }, { scale: false })
  r2.forEach((p, i) => assert.ok(Math.hypot(p.x * W - (80 - i * 3), p.y * H - (45 + i * 1.5)) < 1))
  // 取消：onStep 回 false ⇒ 停
  assert.equal(trackFrames(fr2, { x: 0.5, y: 0.5, w: 0.15, h: 0.25 }, {}, (i) => i < 4).length, 4)
})

// 一个工程：影片片段 v（带路径）·文字 t·贴纸 s
const TRK: MTrack = { id: 'trk-1', w: 0.1, h: 0.1, pts: [[1, 0.3, 0.4, 1], [2, 0.5, 0.45, 1.2], [3, 0.7, 0.5, 1.5]] }
const tracksOf = (follow?: TlClip['follow']): Tracks => [
  { id: 'tx', kind: 'text', locked: false, hidden: false, muted: false, clips: [{ id: 't', mediaId: '', start: 0, length: 3, offset: 0, text: { content: 'hi', x: 0.3, y: 0.3, size: 0.1 }, ...(follow ? { follow } : {}) } as TlClip] },
  { id: 'main', kind: 'visual', locked: false, hidden: false, muted: false, clips: [{ id: 'v', mediaId: 'vid', start: 0, length: 3, offset: 1, mtrack: [TRK] } as TlClip] },
]

test('B 绑定后位置：绑那刻不动·之后照路径平移并以跟踪点为心缩放·预览 CSS 与汇出 canvas 同一个变换', () => {
  const fo = bindFollow(tracksOf(), 'v', 'trk-1', 0)!
  assert.deepEqual(fo, { clip: 'v', track: 'trk-1', at: 1 }) // 时间轴 0 秒＝素材 1 秒
  const tr = tracksOf(fo), c = tr[0].clips[0]
  const x0 = followAt(tr, c, 0)!
  assert.ok(x0, '绑上了却没变换')
  const p0 = followPoint(x0, 0.3, 0.3); near(p0[0], 0.3); near(p0[1], 0.3)
  const x1 = followAt(tr, c, 1)! // 素材 2 秒：点 (0.5,0.45)·缩放 1.2
  near(x1.k, 1.2)
  const p1 = followPoint(x1, 0.3, 0.3); near(p1[0], 0.5 + (0.3 - 0.3) * 1.2); near(p1[1], 0.45 + (0.3 - 0.4) * 1.2)
  const m = mtrackAt(TRK, 1.5)!; near(m.x, 0.4); near(m.s, 1.1)
  // 汇出 followAffine 与预览 followCssMatrix（以正中为原点）映同一点
  const w = 640, h = 360
  const [a, b, cc, d, e, f] = followAffine(x1, w, h)
  const v = followCssMatrix(x1, w, h).match(/matrix\((.*)\)/)![1].split(',').map(Number)
  for (const [px, py] of [[0, 0], [100, 50], [600, 300]]) {
    const ex = a * px + cc * py + e, ey = b * px + d * py + f
    const cx = px - w / 2, cy = py - h / 2
    near(v[0] * cx + v[2] * cy + v[4] + w / 2, ex, 1e-3, 'x'); near(v[1] * cx + v[3] * cy + v[5] + h / 2, ey, 1e-3, 'y')
    const q = followPoint(x1, px / w, py / h); near(q[0] * w, ex, 1e-6); near(q[1] * h, ey, 1e-6)
  }
  // 汇出档与预览页真的都用 followAt
  const er = readFileSync(join(__dirname, 'ui/export-render.ts'), 'utf8'), pg = readFileSync(join(__dirname, 'page/VideoEditPage.tsx'), 'utf8')
  assert.match(er, /followAt\(env\.tracks, op\.clip, t, W \/ H\)/); assert.match(er, /ctx\.transform\(\.\.\.followAffine\(fo, W, H\)\)/)
  assert.match(pg, /followAt\(tracks, c, now\)/); assert.match(pg, /followCssMatrix\(fo, w, h\)/)
  // 影片片段切开：后半段（同一条路径）照样跟
  const split = tracksOf(fo); split[1] = { ...split[1], clips: [{ ...split[1].clips[0], length: 1.5 }, { ...split[1].clips[0], id: 'v2', start: 1.5, length: 1.5, offset: 2.5 }] }
  near(followAt(split, split[0].clips[0], 2)!.qx, 0.7)
})

test('C 改字不丢跟随：text.update 改字／字体·拖位置·面板改样式后 follow 还在、还生效', () => {
  const fo = bindFollow(tracksOf(), 'v', 'trk-1', 0)!
  const raw = { v: 1, media: [{ id: 'vid', name: 'a.mp4', kind: 'video', duration: 20 }], tracks: tracksOf(fo) }
  const r = applyCommands(raw, [{ command: 'text.update', params: { clip: 't', content: '改过的字', font: 'serif', color: '#ff0000', x: 0.6 } }])
  assert.ok(r.ok, JSON.stringify(r))
  const tr = r.ok ? r.project.tracks : []
  const c = tr.find((l) => l.id === 'tx')!.clips[0]
  assert.equal(c.text!.content, '改过的字')
  assert.deepEqual(c.follow, fo)
  assert.ok(followAt(tr, c, 2), '改字后跟随失效')
  // 四角透视面板一改（文字轨 look.pin）也不丢
  const c2 = applyClipPatch(c, { look: { pin: { x0: 0.1 } } }, 'text')
  assert.deepEqual(c2.follow, fo); assert.ok(followAt(tr, c2, 2))
  // 工程档来回一趟留得住
  const back = parseProject(JSON.parse(JSON.stringify(r.ok ? r.project : raw))) as { project?: { tracks: Tracks } }
  const bc = back.project!.tracks.find((l) => l.id === 'tx')!.clips[0]
  assert.deepEqual(bc.follow, fo); assert.deepEqual(back.project!.tracks.find((l) => l.id === 'main')!.clips[0].mtrack, [TRK])
  assert.ok(followAt(back.project!.tracks, bc, 2))
})

test('D 命令 clip.followTrack：绑上（at＝片段开头）·null 解除·不认得的路径／影片片段被拒', () => {
  const raw = { v: 1, media: [{ id: 'vid', name: 'a.mp4', kind: 'video', duration: 20 }], tracks: tracksOf() }
  const r = applyCommands(raw, [{ command: 'clip.followTrack', params: { clips: 't', track: 'trk-1' } }])
  assert.ok(r.ok, JSON.stringify(r))
  const c = r.ok ? r.project.tracks[0].clips[0] : null
  assert.deepEqual(c!.follow, { clip: 'v', track: 'trk-1', at: 1 })
  assert.ok(followAt(r.ok ? r.project.tracks : [], c!, 1.5))
  const off = applyCommands(r.ok ? r.project : raw, [{ command: 'clip.followTrack', params: { clips: 't', track: null } }])
  assert.ok(off.ok && !off.project.tracks[0].clips[0].follow)
  assert.equal(applyCommands(raw, [{ command: 'clip.followTrack', params: { clips: 't', track: 'nope' } }]).ok, false)
  assert.equal(applyCommands(raw, [{ command: 'clip.followTrack', params: { clips: 'v', track: 'trk-1' } }]).ok, false)
})

test('E 旧工程无栏不变·读档验值', () => {
  const raw = { v: 1, media: [{ id: 'vid', name: 'a.mp4', kind: 'video', duration: 20 }], tracks: tracksOf() }
  raw.tracks[1].clips[0] = { ...raw.tracks[1].clips[0], mtrack: undefined }
  const pr = parseProject(JSON.parse(JSON.stringify(raw))) as { project?: { tracks: Tracks } }
  const t = pr.project!.tracks[0].clips[0], v = pr.project!.tracks[1].clips[0]
  assert.ok(!('follow' in t) && !('mtrack' in v))
  assert.equal(followAt(pr.project!.tracks, t, 1), null)
  assert.deepEqual(followPoint(null, 0.2, 0.7), [0.2, 0.7])
  // 坏资料丢掉
  assert.equal(parseMTracks([{ id: 'bad id!', pts: [[0, 0.5, 0.5, 1]] }]), undefined)
  assert.equal(parseMTracks([{ id: 'a', pts: [] }]), undefined)
  assert.deepEqual(parseMTracks([{ id: 'a', pts: [[2, 0.5, 0.5], [1, 0.4, 0.4, 2]] }])![0].pts, [[1, 0.4, 0.4, 2], [2, 0.5, 0.5, 1]])
  assert.equal(parseFollow({ clip: 'v', track: 't' }), undefined)
  // 路径找不到（影片片段删了）⇒ 照原位
  const gone = tracksOf({ clip: 'v', track: 'trk-x', at: 1 })
  assert.equal(followAt(gone, gone[0].clips[0], 1), null)
  // 画面座标换算＋追踪时刻
  const mk = makeMTrack('k', [0, 0.5], [{ x: 0.5, y: 0.5, s: 1 }, { x: 1, y: 0, s: 1 }], { x: 0.5, y: 0.5, w: 0.2, h: 0.2 }, { x: 0.5, y: 0.5, w: 0.5, h: 1 })!
  assert.deepEqual(mk.pts[1], [0.5, 0.75, 0, 1]); near(mk.w, 0.1)
  assert.deepEqual(trackTimes({ start: 0, length: 0.2, offset: 3 }, 0), [3, 3.0667, 3.1333])
})

test('F 文字／贴纸四角透视＋跟随面板接线（面板控件·画面角点·宿主）', () => {
  // 贴纸轨也收 pin 与 follow；patchClips 认得文字／贴纸
  const st: TlClip = { id: 's', mediaId: '', start: 0, length: 2, offset: 0, sticker: { sticker: 'x', x: 0.5, y: 0.5, size: 0.2 } }
  const s2 = applyClipPatch(st, { look: { pin: { x2: -0.1 } }, follow: { clip: 'v', track: 'trk-1', at: 1 } }, 'sticker')
  near(s2.look!.pin!.x2, -0.1); assert.deepEqual(s2.follow, { clip: 'v', track: 'trk-1', at: 1 })
  const tr: Tracks = [{ id: 'sk', kind: 'sticker', locked: false, hidden: false, muted: false, clips: [st] }, tracksOf()[1]]
  const tr2 = patchClips(tr, ['s'], { follow: { clip: 'v', track: 'trk-1', at: 1 } }, () => false)
  assert.ok(followAt(tr2, tr2[0].clips[0], 2), '贴纸绑上不生效')
  assert.equal(applyClipPatch(st, { follow: null }, 'sticker').follow, undefined)
  // UI 接线
  const panel = readFileSync(join(__dirname, 'ui/MotionTrackPanel.tsx'), 'utf8'), pg = readFileSync(join(__dirname, 'page/VideoEditPage.tsx'), 'utf8')
  const ci = readFileSync(join(__dirname, 'ui/ClipInspector.tsx'), 'utf8'), mp = readFileSync(join(__dirname, 'ui/ManualPane.tsx'), 'utf8')
  for (const id of ['vedit-ci-pin-on', 'vedit-ci-pin-reset', 'vedit-follow-select', 'vedit-follow-unbind', 'vedit-mt-select', 'vedit-mt-start', 'vedit-mt-cancel', 'vedit-mt-progress', 'vedit-mt-list']) assert.ok(panel.includes(`"${id}"`), `面板少了 ${id}`)
  assert.match(panel, /onPatch\(\{ look: \{ pin: q \} \}, commit\)/)
  assert.match(pg, /extra: tsSel\?\.lane\.kind === 'text' \? tsPanel/); assert.match(pg, /if \(mtSelRef\.current\) \{ onMtDown\(e\); return \}/); assert.match(pg, /data-testid="vedit-sticker-panel"/)
  assert.match(pg, /\(\(clipState\.kind === 'clip' && clipState\.lane === 'visual'\) \|\| tsSel\) && \(\(\) => \{/) // 画面角点：文字／贴纸也画
  assert.match(pg, /const onClipPatch = ts \? onTsPatch : onClipPatchV/)
  assert.match(ci, /<VeditMotionTrackPanel clip=\{st\.clip\} host=\{host\.mtrack\}/); assert.match(mp, /host\.extra/)
})

test('G 影片片段放大／挪位／打关键帧推拉：字仍贴着路径那一点（片段座标经片段变换映射到画面）', () => {
  const A = 16 / 9
  const tr = tracksOf(); const v = tr[1].clips[0] as TlClip
  v.look = { sx: 2, x: 0.1, y: -0.05 } // 放大 2 倍、往右 10%、往下 5%
  const fo = bindFollow(tr, 'v', 'trk-1', 0)!
  const tr2: Tracks = [{ ...tr[0], clips: [{ ...tr[0].clips[0], follow: fo }] }, { ...tr[1], clips: [v] }]
  const c = tr2[0].clips[0]
  for (const t of [0, 1, 2]) {
    const f = followAt(tr2, c, t, A)!
    const p = mtrackAt(TRK, 1 + t)!, p0 = mtrackAt(TRK, 1)!
    const h = hostXf(v, t), [ex, ey] = hostMap(h, A, p.x, p.y), [e0x, e0y] = hostMap(h, A, p0.x, p0.y)
    // 绑那刻的点在画面上落在 (e0x,e0y)；这一刻那一点在 (ex,ey)：跟随把前者送到后者
    const [gx, gy] = followPoint(f, e0x, e0y)
    near(gx, ex, 1e-6, `t=${t} x`); near(gy, ey, 1e-6, `t=${t} y`)
    near(f.k, p.s / p0.s, 1e-6, `t=${t} 缩放（片段缩放不变 ⇒ 只剩路径缩放）`)
  }
  // 放大 2 倍：路径走了 d，画面上字要走 2d
  const f2 = followAt(tr2, c, 2, A)!, p2 = mtrackAt(TRK, 3)!, p0 = mtrackAt(TRK, 1)!
  near(f2.qx - f2.q0x, 2 * (p2.x - p0.x), 1e-6, '放大后位移没跟着放大')
  // 关键帧推拉：0 秒 1 倍、2 秒 2 倍 ⇒ 字的缩放＝路径缩放 × 2
  const vk = { ...v, look: {}, kf: { sx: [{ t: 1, v: 1 }, { t: 3, v: 2 }] } } as unknown as TlClip
  const tr3: Tracks = [tr2[0], { ...tr[1], clips: [vk] }]
  const f3 = followAt(tr3, c, 2, A)!
  near(f3.k, (p2.s / p0.s) * 2, 1e-3, '关键帧推拉的缩放没算进去')
})

test('H 框选反算：画面框扣掉片段变换回片段座标（含旋转）·hostMap／hostUnmap 互逆', () => {
  const A = 16 / 9
  for (const h of [{ tx: 10, ty: -5, rot: 0, sx: 2, sy: 2 }, { tx: -7, ty: 3, rot: 30, sx: 1.5, sy: 1.5 }, { tx: 0, ty: 0, rot: 0, sx: 1, sy: 1 }]) {
    for (const [x, y] of [[0.2, 0.3], [0.5, 0.5], [0.9, 0.1]]) {
      const [mx, my] = hostMap(h, A, x, y), [ux, uy] = hostUnmap(h, A, mx, my)
      near(ux, x, 1e-9); near(uy, y, 1e-9)
    }
  }
  const v = { id: 'v', mediaId: 'm', start: 0, length: 3, offset: 0, look: { sx: 2, x: 0.1 } } as TlClip
  const b = boxToHost({ x: 0.7, y: 0.5, w: 0.2, h: 0.2 }, hostXf(v, 0), A)
  near(b.w, 0.1, 1e-9, '宽没除缩放'); near(b.x, 0.5 + (0.7 - 0.5 - 0.1) / 2, 1e-9, '中心没扣位移缩放'); near(b.y, 0.5, 1e-9)
  // 片段没变换 ⇒ 框原样
  assert.deepEqual(boxToHost({ x: 0.3, y: 0.4, w: 0.1, h: 0.1 }, hostXf({ id: 'w', mediaId: 'm', start: 0, length: 3, offset: 0 } as TlClip, 0), A), { x: 0.3, y: 0.4, w: 0.1, h: 0.1 })
  // 页面：框选先扣片段变换再进素材帧
  const pg = readFileSync(join(__dirname, 'page/VideoEditPage.tsx'), 'utf8')
  assert.match(pg, /const hb = boxToHost\(mtBox, hostXf\(c, nowRef\.current\), asp\)/)
  for (const s of ['followAt(tracks, c, now, w / h)', 'followAt(tracks, pc, now, stageRatioRef.current ?? 16 / 9)']) assert.ok(pg.includes(s), `预览没传画面比例：${s}`)
  assert.ok(readFileSync(join(__dirname, 'ui/export-render.ts'), 'utf8').includes('followAt(env.tracks, op.clip, t, W / H)'), '汇出没传画面比例')
})

test('I 往前追与重追：往前取格到片段开头·重追盖掉同方向那截·旧点留着·tlAtSrc 倒查', () => {
  const c = { start: 0, length: 0.2, offset: 3 }
  assert.deepEqual(trackTimes(c, 0.2, 900, 'back'), [3.2, 3.1333, 3.0667, 3])
  near(tlAtSrc({ start: 2, length: 4, offset: 1, speed: 2 }, 3), 3, 1e-9)
  near(tlAtSrc({ start: 2, length: 4, offset: 1, reverse: true } as never, 3), 4, 0.02) // 倒放：取样倒查
  const old: MTrack = { id: 'k', w: 0.1, h: 0.1, pts: [[0, 0.1, 0.1, 1], [1, 0.2, 0.2, 1], [2, 0.3, 0.3, 1], [3, 0.4, 0.4, 1]] }
  const add: MTrack = { id: 'x', w: 0.1, h: 0.1, pts: [[2, 0.5, 0.5, 1], [3, 0.6, 0.6, 1]] }
  const f = mergeMTrack(old, add, 'fwd')!
  assert.equal(f.id, 'k'); assert.deepEqual(f.pts.map((p) => p[0]), [0, 1, 2, 3]); near(f.pts[2][1], 0.3, 1e-9, '接缝接上旧路径（0.5 平移到 0.3）'); near(f.pts[3][1], 0.4, 1e-9); near(f.pts[1][1], 0.2)
  const b = mergeMTrack(old, { ...add, pts: [[0, 0.9, 0.9, 1], [1, 0.8, 0.8, 1]] }, 'back')!
  near(b.pts[1][1], 0.2, 1e-9, '往前追接缝在尾端'); near(b.pts[0][1], 0.3, 1e-9); near(b.pts[2][1], 0.3)
  const panel = readFileSync(join(__dirname, 'ui/MotionTrackPanel.tsx'), 'utf8')
  for (const id of ['vedit-mt-start-back', 'vedit-mt-retrack']) assert.ok(panel.includes(`"${id}"`), `面板少了 ${id}`)
  assert.match(panel, /host\.onStart\('fwd', m\.id\)/); assert.match(panel, /host\.onStart\('back'\)/)
})

test('J 拖跟随中的字／贴纸：位移除掉跟随缩放·不吸附', () => {
  const pg = readFileSync(join(__dirname, 'page/VideoEditPage.tsx'), 'utf8')
  assert.equal((pg.match(/const fk = followAt\(tracksRef\.current, c, nowRef\.current, r\.width \/ Math\.max\(1, r\.height\)\)\?\.k \|\| 0/g) ?? []).length, 2, '字块、贴纸都要量跟随缩放')
  assert.equal((pg.match(/mode === 'move' && !fk \? stageBoxesAt/g) ?? []).length, 2)
  assert.equal((pg.match(/b0\.x \+ dx \/ fk/g) ?? []).length, 2)
})

test('K 重追接缝连续：新段缩放乘上旧路径该刻、位置平移到旧路径该刻·往前追接在尾端·原位替换不改名·框选中按到字不拖字', () => {
  // 旧路径：推近中，4 秒时已放大到 2、中心 (0.6, 0.4)
  const old: MTrack = { id: 'k', w: 0.1, h: 0.1, pts: [[0, 0.5, 0.5, 1], [2, 0.55, 0.45, 1.5], [4, 0.6, 0.4, 2], [6, 0.7, 0.35, 2.5]] }
  // 在 4 秒重框：新段从 1 起算、中心落在 (0.62, 0.43)（重框的位置跟旧路径偏一点）
  const add: MTrack = { id: 'x', w: 0.2, h: 0.2, pts: [[4, 0.62, 0.43, 1], [5, 0.66, 0.41, 1.1], [6, 0.7, 0.39, 1.2]] }
  const f = mergeMTrack(old, add, 'fwd')!
  const a = mtrackAt(f, 4 - 1e-3)!, b = mtrackAt(f, 4)!
  near(b.s, 2, 1e-6, '接缝缩放接上旧路径'); near(b.x, 0.6, 1e-6); near(b.y, 0.4, 1e-6)
  near(a.s, b.s, 1e-2, '接缝前后缩放连续'); near(a.x, b.x, 1e-3); near(a.y, b.y, 1e-3)
  near(mtrackAt(f, 6)!.s, 2.4, 1e-6, '之后照新段相对变化（×1.2）'); near(mtrackAt(f, 5)!.x, 0.64, 1e-6, '之后照新段位移')
  near(mtrackAt(f, 2)!.s, 1.5, 1e-6, '前面旧点留着')
  // 往前追：接缝在新段结尾（播放头 3 秒），新段排在倒序也照接
  const back: MTrack = { id: 'y', w: 0.2, h: 0.2, pts: [[3, 0.3, 0.3, 1], [2, 0.29, 0.31, 0.9], [1, 0.28, 0.32, 0.8]] }
  const g = mergeMTrack(old, back, 'back')!
  const o3 = mtrackAt(old, 3)!
  near(mtrackAt(g, 3)!.s, o3.s, 1e-6); near(mtrackAt(g, 3)!.x, o3.x, 1e-6); near(mtrackAt(g, 1)!.s, o3.s * 0.8, 1e-6)
  near(mtrackAt(g, 6)!.s, 2.5, 1e-6, '后面旧点留着')
  // 原位替换：重追后顺序不变（「路徑 1」不会变成「路徑 2」）
  const list: MTrack[] = [old, { ...old, id: 'z' }]
  assert.deepEqual(patchMTracks(list, 'k', f)!.map((m) => m.id), ['k', 'z'])
  assert.deepEqual(patchMTracks(list, 'n', { ...old, id: 'n' })!.map((m) => m.id), ['k', 'z', 'n'])
  assert.deepEqual(patchMTracks(list, 'k', null)!.map((m) => m.id), ['z'])
  // 框选中（跟踪／推镜头）按到字或贴纸：交给舞台拉框，不拖字
  const pg = readFileSync(join(__dirname, 'page/VideoEditPage.tsx'), 'utf8')
  assert.match(pg, /!c\.text \|\| mosaicRecRef\.current \|\| mtSelRef\.current \|\| pushSelRef\.current\) return/)
  assert.match(pg, /if \(mosaicRecRef\.current \|\| mtSelRef\.current \|\| pushSelRef\.current\) return \/\/ 追踪打码开着／框选中/)
})

console.log(`motion-track → ${n} 过 ${bad} 败`)
if (bad) process.exit(1)

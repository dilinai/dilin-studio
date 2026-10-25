// 蒙版与合成题（百叶窗开场缺口单 3–6）：条纹蒙版每条覆盖·多蒙版读写档与旧工程相容·轨道遮罩取形·blend 跨文字层接线·预览汇出同一份计算。
// 跑法（在 studio 根目录跑）：node -e "require('sucrase/register/ts');require('sucrase/register/tsx');require('./video/mask-matte.test.ts')"
// 药：DILIN_NEG=vedit_mask_matte_off ⇒ 条纹不分条／多蒙版只认第一个／轨道遮罩不生效／blend 退回里层 ⇒ A／B／C／D 红。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { blendHost, matteAlpha, matteLaneOf, matteLanesAt, stripeBands, stripeCover } from './lib/mask-matte.pure'
import { applyClipPatch, lookOf, maskDefault, masksSvg, normalizeLook, parseLook, type ClipMask } from './lib/clip-look.pure'
import { framePlan } from './lib/export.pure'
import { parseProject } from './lib/project.pure'
import { applyCommands } from './lib/commands.pure'
import type { TlClip, Tracks } from './lib/timeline.pure'

let n = 0, bad = 0
function test(name: string, fn: () => void) {
  try { fn(); n++; console.log('✓', name) } catch (e) { bad++; console.log('✗', name); console.log('  ', (e as Error).message.split('\n').slice(0, 6).join('\n   ')) }
}
const near = (a: number, b: number, eps = 1e-3, msg = '') => assert.ok(Math.abs(a - b) < eps, `${msg} ${a} ≠ ${b}`)
const read = (p: string) => readFileSync(join(__dirname, p), 'utf8')

test('A 条纹蒙版：给定进度每条覆盖几成（stagger／缓动）·关键帧 mask.progress 驱动·SVG 出对条数', () => {
  // 4 条·stagger 1（一条接一条）·匀速：每条走 1/4 进度
  assert.deepEqual(stripeCover(4, 0, 1, 'linear'), [0, 0, 0, 0])
  assert.deepEqual(stripeCover(4, 0.375, 1, 'linear'), [1, 0.5, 0, 0])
  assert.deepEqual(stripeCover(4, 1, 1, 'linear'), [1, 1, 1, 1])
  // stagger 0 ⇒ 一起开
  assert.deepEqual(stripeCover(3, 0.5, 0, 'linear'), [0.5, 0.5, 0.5])
  // stagger 0.5·4 条：d=1/2.5=0.4·第 i 条从 0.2i 开始
  const c = stripeCover(4, 0.5, 0.5, 'linear'); near(c[0], 1); near(c[1], 0.75); near(c[2], 0.25); near(c[3], 0)
  near(stripeCover(1, 0.5, 0, 'out')[0], 0.75, 1e-3, '缓出'); near(stripeCover(1, 0.5, 0, 'in')[0], 0.25, 1e-3, '缓入')
  // 间隙：每格 1/4·留 50% ⇒ 全开时每条高 0.125
  const b = stripeBands({ count: 4, gap: 0.5, progress: 1, stagger: 0 }); assert.deepEqual(b.map((x) => x[1]), [0.125, 0.125, 0.125, 0.125]); assert.deepEqual(b.map((x) => x[0]), [0, 0.25, 0.5, 0.75])
  // 片段挂条纹＋进度关键帧：时间轴 1 秒在 0→1 中间 ⇒ progress 0.5
  const clip = { id: 'v', mediaId: 'vid', start: 0, length: 2, offset: 0, look: { mask: { ...maskDefault('stripes'), count: 4, stagger: 1, ease: 'linear' as const } }, kf: { 'mask.progress': [{ t: 0, v: 0 }, { t: 2, v: 1 }] } } as TlClip
  near(lookOf(clip, 1).mask!.progress!, 0.5)
  const svg = masksSvg(lookOf(clip, 1).masks, 'and', 16 / 9)
  assert.equal((svg.match(/<rect x=/g) ?? []).length, 2, '进度 0.5·一条接一条 ⇒ 两条有面积（第 1 条全开·第 2 条刚好开完）')
  // 读档验值
  const l = parseLook({ mask: { shape: 'stripes', count: 999, progress: 3, ease: 'bogus' } })!
  assert.equal(l.mask!.count, 60); assert.equal(l.mask!.progress, 1); assert.equal(l.mask!.ease, 'out')
})

test('B 多蒙版：look.masks 读写档·旧工程单个 mask 照旧·写档 mask＝第一个（旧版读得到）·and／or 合成·面板改第一个同步', () => {
  const a = maskDefault('circle'), b: ClipMask = { ...maskDefault('rect'), invert: true }
  // 旧工程：只有 mask
  const old = parseLook({ mask: { shape: 'circle', x: 0.1 } })!
  assert.equal(old.masks, undefined, '旧档不长出 masks'); assert.equal(lookOf({ look: old }).masks.length, 1)
  // 两个：写档 mask=第一个＋masks=全部
  const two = normalizeLook({ masks: [a, b], maskOp: 'or' })!
  assert.equal(two.masks!.length, 2); assert.equal(two.mask!.shape, 'circle'); assert.equal(two.maskOp, 'or')
  assert.equal(lookOf({ look: two }).masks.length, 2, '读回两个')
  // 只剩一个 ⇒ 回旧格式
  const one = normalizeLook({ masks: [a] })!; assert.equal(one.masks, undefined); assert.equal(one.mask!.shape, 'circle')
  // 面板改第一个（look.mask）·第二个留着
  const c0 = { id: 'v', mediaId: 'vid', start: 0, length: 2, offset: 0, look: two } as TlClip
  const c1 = applyClipPatch(c0, { look: { mask: { x: 0.3 } } }, 'visual')
  assert.equal(c1.look!.masks!.length, 2); near(c1.look!.masks![0].x, 0.3); near(c1.look!.mask!.x, 0.3); assert.equal(c1.look!.masks![1].shape, 'rect')
  // 拿掉第一个 ⇒ 第二个递补成单个
  const c2 = applyClipPatch(c1, { look: { mask: null } }, 'visual'); assert.equal(c2.look!.mask!.shape, 'rect'); assert.equal(c2.look!.masks, undefined)
  // SVG：and 套 <g mask>·or 并排
  assert.match(masksSvg([a, b], 'and', 16 / 9), /<g mask="url\(#m1\)"><rect[^>]*mask="url\(#m\)"\/><\/g>/)
  assert.equal((masksSvg([a, b], 'or', 16 / 9).match(/fill="white" mask=/g) ?? []).length, 2)
  // 工程档来回＋命令
  const raw = { v: 1, media: [{ id: 'vid', name: 'a.mp4', kind: 'video', duration: 20 }], tracks: [{ id: 'main', kind: 'visual', locked: false, hidden: false, muted: false, clips: [c0] }] }
  const back = parseProject(JSON.parse(JSON.stringify(raw)))
  assert.ok(back.ok); assert.equal(back.ok && back.project.tracks[0].clips[0].look!.masks!.length, 2)
  const r = applyCommands(raw, [{ command: 'clip.setLook', params: { clips: 'v', masks: [{ shape: 'stripes', count: 6, progress: 0.4 }, { shape: 'circle' }, { shape: 'heart' }], maskOp: 'and' } }])
  assert.ok(r.ok, JSON.stringify(r)); const lk = r.ok ? r.project.tracks[0].clips[0].look! : {}
  assert.equal(lk.masks!.length, 3); assert.equal(lk.mask!.shape, 'stripes'); assert.equal(lk.mask!.count, 6)
  assert.ok(!applyCommands(raw, [{ command: 'clip.setLook', params: { clips: 'v', maskOp: 'xor' } }]).ok)
})

const TR = (matte?: object): Tracks => [
  { id: 'tx', kind: 'text', locked: false, hidden: false, muted: false, clips: [{ id: 't', mediaId: '', start: 0, length: 3, offset: 0, text: { content: 'IIII', x: 0.5, y: 0.5, size: 0.3 } } as TlClip] },
  { id: 'main', kind: 'visual', locked: false, hidden: false, muted: false, clips: [{ id: 'v', mediaId: 'vid', start: 0, length: 3, offset: 0, ...(matte ? { look: { matte } } : {}) } as TlClip] },
  { id: 'tx2', kind: 'text', locked: false, hidden: false, muted: false, clips: [{ id: 't2', mediaId: '', start: 0, length: 3, offset: 0, text: { content: 'under', x: 0.5, y: 0.5, size: 0.1 } } as TlClip] },
]
const kindOf = () => 'video' as const

test('C 轨道遮罩：缺 lane ⇒ 上方最近文字轨·遮罩轨本身不画·画面片段带遮罩画法·alpha／亮度／反相公式', () => {
  const tr = TR({ mode: 'alpha' })
  assert.equal(matteLaneOf(tr, 'main', { mode: 'alpha' }), 'tx')
  assert.equal(matteLaneOf(tr, 'main', { mode: 'alpha', lane: 'tx2' }), 'tx2', '指定下方那条也行')
  assert.equal(matteLaneOf(tr, 'main', { mode: 'alpha', lane: 'main' }), null, '自己那条不行')
  assert.deepEqual([...matteLanesAt(tr, 1)], [['tx', 'main']])
  const plan = framePlan(tr, 1, kindOf)
  assert.deepEqual(plan.map((o) => `${o.kind}:${o.laneId}`), ['text:tx2', 'media:main'], '上方遮罩轨不画·下方文字照画')
  const mo = plan[1].kind === 'media' ? plan[1].matte : undefined
  assert.ok(mo && mo.laneId === 'tx' && mo.ops.length === 1 && mo.ops[0].kind === 'text', '画面片段带上遮罩轨那一刻的字')
  assert.equal(framePlan(TR(), 1, kindOf).length, 3, '没挂遮罩 ⇒ 照旧三层')
  // 片段过了（3 秒后）⇒ 不再藏
  assert.equal(matteLanesAt(tr, 3.5).size, 0)
  // 像素公式：红 255 不透明·半透明白·透明
  const px = new Uint8ClampedArray([255, 0, 0, 255, 255, 255, 255, 128, 0, 0, 0, 0])
  const a = px.slice(); matteAlpha(a, 'alpha'); assert.deepEqual([a[3], a[7], a[11]], [255, 128, 0])
  const l = px.slice(); matteAlpha(l, 'luma'); assert.deepEqual([l[3], l[7], l[11]], [54, 128, 0])
  const iv = px.slice(); matteAlpha(iv, 'alpha', true); assert.deepEqual([iv[3], iv[7], iv[11]], [0, 127, 255])
  // 读档＋命令
  const raw = { v: 1, media: [{ id: 'vid', name: 'a.mp4', kind: 'video', duration: 20 }], tracks: TR() }
  const r = applyCommands(raw, [{ command: 'clip.setLook', params: { clips: 'v', matte: { mode: 'luma', invert: true } } }])
  assert.ok(r.ok, JSON.stringify(r)); assert.deepEqual(r.ok && r.project.tracks.find((l) => l.id === 'main')!.clips[0].look!.matte, { mode: 'luma', invert: true })
  const back = parseProject(JSON.parse(JSON.stringify(r.ok ? r.project : raw)))
  assert.ok(back.ok && back.project.tracks.find((l) => l.id === 'main')!.clips[0].look!.matte!.mode === 'luma')
})

test('D blend 跨文字层：预览 blend 挂外框（跟文字层同一叠层·阴影／遮罩不把它关起来）·汇出照 blendOp 叠在已画好的文字上', () => {
  assert.equal(blendHost(), 'outer')
  const pg = read('page/VideoEditPage.tsx'), er = read('ui/export-render.ts')
  assert.match(pg, /const blendOuter = blendHost\(\) === 'outer' && ls && ls\.mixBlendMode !== 'normal' \? ls\.mixBlendMode : null/)
  assert.match(pg, /data-testid="vedit-tl-shadow"[^\n]*\.\.\.\(blendOuter \? \{ mixBlendMode: blendOuter \} : \{\}\)/)
  assert.match(pg, /mixBlendMode !== 'normal' && !blendOuter \? \{ mixBlendMode: ls\.mixBlendMode \}/)
  assert.match(pg, /\{\[\.\.\.layers\]\.reverse\(\)\.map\(\(s\) => \{/, '预览由下往上排（文字在画面下方 ⇒ DOM 在前）')
  // 汇出：文字先画进同一张 ctx·画面层用 blendOp 叠上（有遮罩时先遮再照 blend 贴）
  const plan = framePlan(TR(), 1, kindOf)
  assert.ok(plan.findIndex((o) => o.laneId === 'tx2') < plan.findIndex((o) => o.laneId === 'main'), '下方文字先画')
  assert.match(er, /const ctx = tgt\n\s*ctx\.save\(\)\n\s*ctx\.globalAlpha = xf\.opacity\n\s*ctx\.globalCompositeOperation = mt \? 'source-over' : blendOp\(lk\.blend\)/)
  assert.match(er, /ctx\.globalCompositeOperation = blendOp\(lk\.blend\); ctx\.drawImage\(mtCv, 0, 0\)/)
})

test('E 预览与汇出同一份计算：蒙版都走 masksSvg·轨道遮罩都走 drawMatteOps（matteAlpha）·遮罩轨都用 matteLanesAt 藏', () => {
  const pg = read('page/VideoEditPage.tsx'), er = read('ui/export-render.ts'), md = read('ui/matte-draw.ts'), ci = read('ui/ClipInspector.tsx'), ex = read('lib/export.pure.ts')
  assert.match(pg, /masksUrl\(lk\.masks, lk\.maskOp, stageRatio \?\? 16 \/ 9, fr\)/); assert.match(er, /masksSvg\(lk\.masks, lk\.maskOp, W \/ H, frameIn\(W \/ H, sw \/ sh\)\)/)
  assert.match(pg, /matteOpOf\(tracks, now, s\.lane\.id, vc\)/); assert.match(pg, /matteCssUrl\(mtOp, now, tracks/); assert.match(md, /drawMatteOps\(pvCv\.getContext/)
  assert.match(er, /drawMatteOps\(mk2d, mt, W, H, t, env\.tracks/); assert.match(md, /matteAlpha\(px\.data, m\.mode, m\.invert\)/)
  assert.match(pg, /matteLanesAt\(tracks, now\)\.has\(s\.lane\.id\)/); assert.match(ex, /const mattes = matteLanesAt\(tr, t\)/)
  for (const id of ['vedit-ci-mask-add', 'vedit-ci-mask-del', 'vedit-ci-mask-tab', 'vedit-ci-mask-op', 'vedit-ci-mask-progress', 'vedit-ci-mask-count', 'vedit-ci-mask-gap', 'vedit-ci-mask-stagger', 'vedit-ci-mask-ease', 'vedit-ci-matte-lane', 'vedit-ci-matte-mode', 'vedit-ci-matte-invert']) assert.ok(ci.includes(`"${id}"`), `面板少了 ${id}`)
})

console.log(`mask-matte → ${n} 过 ${bad} 败`)
if (bad) process.exit(1)

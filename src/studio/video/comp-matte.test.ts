// 巢状合成＋轨道遮罩（画面层）题：读写档往返不丢·绕回自己／套太深被拒·合成段时间照 offset／变速算（递归）·打包成合成·
//   汇出摊平合成里的声音·画面层当遮罩（指定片段／上方相邻轨·四种方式·遮罩层本身不画）·命令表 comp.*／clip.setMatte／clip.add 放合成。
//   像素（真画布、汇出那支 frameDrawer）另在 comp-matte.browser.mjs（无头 Chromium 跑）。
// 跑法（在 studio 根目录跑）：node -e "require('sucrase/register/ts');require('sucrase/register/tsx');require('./video/comp-matte.test.ts')"
// 药：DILIN_NEG=vedit_comp_off ⇒ 读档不收合成、绕回不检查、合成段不画、打包与摊声音不做 ⇒ A–F 全红；DILIN_NEG=vedit_mask_matte_off ⇒ 遮罩不生效 ⇒ E 红。
import assert from 'node:assert/strict'
import { parseProject, buildProject } from './lib/project.pure'
import { docFromJson, docToJson, usedMediaIds } from './format'
import { applyCommands } from './lib/commands.pure'
import { framePlan, visualUses } from './lib/export.pure'
import { frameLayers } from './lib/frame.pure'
import { breakCompCycles, compPixelSize, compTimeAt, flattenCompAudio, precompose, withCompAudioIds, type Comps } from './lib/comp.pure'
import { matteAlpha, matteFromKind, matteLanesAt, matteLaneOf } from './lib/mask-matte.pure'
import { subClipPlan } from './lib/group.pure'
import type { Lane, LaneKind, TlClip, Tracks } from './lib/timeline.pure'
import { FX_ITEMS } from './lib/fx.data'
const FX1 = FX_ITEMS.find((x) => x.kind === 'effect')!.id

let n = 0, bad = 0
function test(name: string, fn: () => void) {
  try { fn(); n++; console.log('✓', name) } catch (e) { bad++; console.log('✗', name); console.log('  ', (e as Error).message.split('\n').slice(0, 6).join('\n   ')) }
}
const L = (id: string, kind: LaneKind, clips: TlClip[]): Lane => ({ id, kind, locked: false, hidden: false, muted: false, clips })
const C = (id: string, start: number, length: number, more: Partial<TlClip> = {}): TlClip => ({ id, mediaId: '', start, length, offset: 0, ...more })
const MEDIA = [{ id: 'vid', name: 'a.mp4', kind: 'video', duration: 20, from: 'local' }, { id: 'aud', name: 'm.mp3', kind: 'audio', duration: 30, from: 'local' }]
const kinds: Record<string, 'video' | 'audio' | 'image'> = { vid: 'video', aud: 'audio' }
const kindOf = (id: string) => kinds[id]
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v))

/** 工程：主时间轴一段合成段（offset 1·速度 2·外观／特效／转场／动画／关键帧都挂）·合成 A 里有影片＋一段合成段放 B·B 里一段纯色＋音频 */
function project() {
  const B: Tracks = [L('main', 'visual', [C('b1', 0, 6, { solid: { color: '#ff0000' } })]), L('ba', 'audio', [C('b2', 1, 3, { mediaId: 'aud', offset: 2 })])]
  const A: Tracks = [L('ax', 'visual', [C('a2', 0.5, 4, { comp: 'cB', offset: 0.5, look: { opacity: 0.5 } as TlClip['look'] })]), L('main', 'visual', [C('a1', 0, 8, { mediaId: 'vid', offset: 3 })])]
  const root: Tracks = [L('main', 'visual', [
    C('r0', 0, 2, { mediaId: 'vid' }),
    C('r1', 2, 3, { comp: 'cA', offset: 1, speed: 2, look: { x: 0.1, opacity: 0.8 } as TlClip['look'], fx: [{ fx: FX1, strength: 0.5 }], transIn: { tr: 'tr-luma_dissolve', length: 0.8 }, anim: { in: { id: 'in-fade', dur: 0.5 } }, kf: { opacity: [{ t: 1, v: 0 }, { t: 3, v: 1 }] } }),
  ])]
  return { v: 1, ratio: { kind: 'preset', key: '16:9' }, media: MEDIA, programs: {}, tracks: root,
    comps: { cA: { name: '片头', ratio: { kind: 'fit' }, length: 8, tracks: A }, cB: { name: 'B', ratio: { kind: 'preset', key: '1:1' }, tracks: B } } }
}

test('A 往返读写不丢：comps＋合成段（offset／变速／外观／特效／转场／动画／关键帧／遮罩指定片段）读回再存一字不差·游客版 project.json 同样·用到的素材算进合成里的', () => {
  const raw = project()
  const r1 = parseProject(clone(raw))
  assert.ok(r1.ok)
  const p1 = r1.ok ? r1.project : null!
  assert.deepEqual(r1.ok && r1.drops, [], '什么都没丢')
  assert.equal(r1.ok && r1.project.tracks[0].clips[1].fx?.[0].fx, FX1, '合成段挂得上特效')
  assert.ok(p1.comps && p1.comps.cA && p1.comps.cB, '两份合成都在')
  const r1c = p1.tracks[0].clips[1]
  assert.equal(r1c.comp, 'cA'); assert.equal(r1c.offset, 1); assert.equal(r1c.speed, 2); assert.equal(r1c.transIn?.tr, 'tr-luma_dissolve'); assert.equal(r1c.look?.opacity, 0.8); assert.ok(r1c.kf?.opacity)
  assert.equal(p1.comps!.cA.tracks.find((l) => l.id === 'ax')!.clips[0].comp, 'cB', '合成里放合成')
  assert.equal(p1.comps!.cB.ratio.kind, 'preset')
  // 再读一次＝不变（往返稳定）
  const r2 = parseProject(clone(p1))
  assert.ok(r2.ok); assert.deepEqual(r2.ok && r2.drops, []); assert.deepEqual(r2.ok && r2.project, p1)
  // buildProject 带 comps·没合成就不写那栏（旧档一样）
  assert.deepEqual(buildProject({ ratio: p1.ratio, tracks: p1.tracks, media: p1.media, comps: p1.comps }).comps, p1.comps)
  assert.equal('comps' in buildProject({ ratio: p1.ratio, tracks: p1.tracks, media: p1.media }), false)
  assert.equal('comps' in (parseProject({ v: 1, tracks: [], media: [] }) as { project: object }).project, false, '旧档读回没长出 comps')
  // 游客版 project.json
  const doc = docFromJson({ name: 'x', ratio: raw.ratio, tracks: raw.tracks, programs: {}, comps: raw.comps, media: MEDIA.map((m) => ({ ...m, file: `${m.id}.bin` })) })
  assert.ok(doc.comps?.cA && doc.comps.cB)
  const j = docToJson(doc)
  const doc2 = docFromJson(clone(j))
  assert.deepEqual(docToJson(doc2), j, '游客版往返一字不差')
  assert.deepEqual([...usedMediaIds(doc2)].sort(), ['aud', 'vid'], '只在合成里用到的素材也算用到（汇出打包不漏）')
  // 遮罩指定片段：读回留着；指到不在同一条时间轴的 ⇒ 拿掉遮罩并报
  const withMatte = clone(p1) as typeof p1
  withMatte.tracks.unshift(L('top', 'visual', [C('m1', 0, 5, { solid: { color: '#ffffff' } })]))
  withMatte.tracks.find((l) => l.id === 'main')!.clips[0].look = { matte: { clip: 'm1', mode: 'luma', invert: true } } as TlClip['look']
  withMatte.comps!.cA.tracks[1].clips[0].look = { matte: { clip: 'm1', mode: 'alpha' } } as TlClip['look'] // m1 在主时间轴·不在合成 A 里
  const rm = parseProject(clone(withMatte))
  assert.ok(rm.ok)
  assert.deepEqual(rm.ok && rm.project.tracks.find((l) => l.id === 'main')!.clips[0].look!.matte, { clip: 'm1', mode: 'luma', invert: true })
  assert.equal(rm.ok && rm.project.comps!.cA.tracks[1].clips[0].look?.matte, undefined)
  assert.ok(rm.ok && rm.drops.some((d) => d.includes('a1') && d.includes('m1')), '指不到的遮罩进 drops')
})

test('B 绕回自己被拒：A→B→A、自己放自己、套太深 ⇒ 那段拿掉并进 drops；合成段指到没有的合成 ⇒ 丢；命令放进会绕回的合成 ⇒ 白话拒', () => {
  const raw = project()
  raw.comps.cB.tracks[0].clips.push(C('bx', 6, 2, { comp: 'cA' })) // B 里放 A：A→B→A
  raw.comps.cA.tracks[1].clips.push(C('ay', 8, 1, { comp: 'cA' })) // A 放自己
  raw.tracks[0].clips.push(C('rz', 5, 1, { comp: 'nope' }))
  const r = parseProject(clone(raw))
  assert.ok(r.ok)
  const p = r.ok ? r.project : null!
  const all = (tr: Tracks) => tr.flatMap((l) => l.clips.map((c) => c.id))
  assert.ok(!all(p.comps!.cA.tracks).includes('ay'), '自己放自己拿掉')
  assert.equal([...all(p.comps!.cA.tracks), ...all(p.comps!.cB.tracks)].filter((id) => id === 'a2' || id === 'bx').length, 1, 'A→B→A 那一圈拿掉一段（另一段留着）')
  assert.ok(!all(p.tracks).includes('rz'), '指到没有的合成 ⇒ 丢')
  assert.ok(r.ok && r.drops.filter((d) => /绕回/.test(d)).length === 2 && r.drops.some((d) => /nope/.test(d)), JSON.stringify(r.ok && r.drops))
  // 拿掉后再读：没有绕回（稳定）
  const r2 = parseProject(clone(p)); assert.ok(r2.ok && r2.drops.length === 0)
  // 套太深：c0→c1→…→c9（10 层）
  const comps: Comps = {}
  for (let i = 0; i < 10; i++) comps[`c${i}`] = { name: `c${i}`, ratio: { kind: 'fit' }, tracks: [L('main', 'visual', i < 9 ? [C(`k${i}`, 0, 1, { comp: `c${i + 1}` })] : [C('leaf', 0, 1, { solid: { color: '#00ff00' } })])] }
  const deep = breakCompCycles([L('main', 'visual', [C('top', 0, 1, { comp: 'c0' })])], comps)
  assert.ok(deep.dropped.length >= 1 && deep.dropped.every((d) => d.why === 'deep'), JSON.stringify(deep.dropped))
  // 命令：进 cA 放 cA／放 cB（cB 里没有 A 了才行·这里 bx 被拿掉的话就放得进）
  const base = clone(project())
  const self = applyCommands(base, [{ command: 'comp.enter', params: { comp: 'cA' } }, { command: 'clip.add', params: { media: 'cA', at: 9 } }])
  assert.ok(!self.ok && /contain itself/.test(self.error), JSON.stringify(self))
  const loop = applyCommands(base, [{ command: 'comp.enter', params: { comp: 'cB' } }, { command: 'clip.add', params: { media: 'cA', at: 9 } }])
  assert.ok(!loop.ok && /contain itself/.test(loop.error), 'B 里放 A（A 已含 B）⇒ 拒')
})

test('C 合成段时间：合成里第几秒＝srcAt（offset＋过了几秒×速度）·递归往下取到素材那一刻·出了合成长度透明·像素大小照合成比例', () => {
  const r = parseProject(clone(project()))
  assert.ok(r.ok)
  const p = r.ok ? r.project : null!
  // 主时间轴 3 秒：r1 从 2 秒起·offset 1·速度 2 ⇒ 合成 A 第 1+1×2=3 秒
  const plan = framePlan(p.tracks, 3, kindOf, undefined, p.comps)
  const op = plan.find((o) => o.kind === 'media' && o.clip.id === 'r1')
  assert.ok(op && op.kind === 'media' && op.media === 'comp' && op.comp === 'cA', JSON.stringify(plan.map((o) => o.kind)))
  assert.equal(op.kind === 'media' && op.source, 3)
  assert.equal(compTimeAt(p.tracks[0].clips[1], p.comps!.cA, 3), 3)
  // 合成 A 第 3 秒：a1（影片第 3+3=6 秒）＋a2（合成 B 第 0.5+2.5=3 秒）
  const inner = framePlan(p.comps!.cA.tracks, 3, kindOf, undefined, p.comps)
  assert.deepEqual(inner.map((o) => (o.kind === 'media' ? `${o.clip.id}:${o.media}@${o.source}` : o.kind)), ['a1:video@6', 'a2:comp@3'])
  // 汇出预检照合成往下找素材（递归）：主时间轴 3 秒那格用到 vid（两处）
  const uses = visualUses(p.tracks, { from: 2.5, to: 3.5 }, kindOf, 0.5, p.comps)
  assert.ok(uses.has('vid'))
  // 出了合成长度（A 长 8·主时间轴 4.9 秒 ⇒ A 第 1+2.9×2=6.8 秒还在·B 长 6）
  assert.equal(compTimeAt({ ...p.tracks[0].clips[1], speed: 4 }, p.comps!.cA, 4.9), null, '变速超过合成长度 ⇒ 透明')
  // 合成比例：1:1 放进 16:9 ⇒ 高满·宽＝高
  assert.deepEqual(compPixelSize(p.comps!.cB, 1600, 900), { w: 900, h: 900 })
  // 角色看帧的层清单：合成段写出是哪份、合成里第几秒
  const layers = frameLayers(p.tracks, 3, (id) => (kinds[id] ? { name: id, kind: kinds[id] } : null), p.comps)
  assert.deepEqual(layers.find((l) => l.clip === 'r1')!.comp, { id: 'cA', name: '片头', at: 3 })
})

test('D 打包成合成：选中两条轨上的几段 ⇒ 新合成（时间从最早那段算 0·主轨那几段当合成主轨·编号不变）·原位换一段合成段；命令 comp.fromClips 跟页面同一支；合成里的声音汇出摊平', () => {
  let i = 0
  const id = () => `n${++i}`
  const tr: Tracks = [L('tx', 'text', [C('t1', 2, 2, { text: { content: 'Hi', x: 0.5, y: 0.5, size: 0.1 } })]), L('main', 'visual', [C('v0', 0, 2, { mediaId: 'vid' }), C('v1', 2, 3, { mediaId: 'vid', offset: 4 })]), L('a1', 'audio', [C('s1', 3, 2, { mediaId: 'aud' })])]
  const r = precompose(tr, ['t1', 'v1', 's1'], { compId: 'cc', clipId: 'cclip', newId: id, name: 'Comp 1' })!
  assert.ok(r)
  assert.equal(r.comp.length, 3)
  assert.deepEqual(r.comp.tracks.map((l) => `${l.kind}:${l.id === 'main' ? 'main' : '*'}:${l.clips.map((c) => `${c.id}@${c.start}`).join(',')}`), ['text:*:t1@0', 'visual:main:v1@0', 'audio:*:s1@1'])
  const main = r.tracks.find((l) => l.id === 'main')!
  assert.deepEqual(main.clips.map((c) => `${c.id}@${c.start}+${c.length}`), ['v0@0+2', 'cclip@2+3'], '合成段放回主轨原位')
  assert.equal(main.clips[1].comp, 'cc')
  assert.ok(!r.tracks.some((l) => l.clips.some((c) => ['t1', 'v1', 's1'].includes(c.id))), '原段搬走')
  // 命令同一支
  const raw = { v: 1, media: MEDIA, tracks: tr }
  let k = 0
  const cr = applyCommands(raw, [{ command: 'comp.fromClips', params: { clips: ['t1', 'v1', 's1'], name: 'Comp 1' } }], { newId: () => `n${++k}` })
  assert.ok(cr.ok, JSON.stringify(cr))
  const cid = cr.ok ? cr.results[0].id! : ''
  assert.ok(cr.ok && cr.project.comps![cid] && cr.project.comps![cid].tracks.some((l) => l.clips.some((c) => c.id === 'v1')))
  assert.equal(cr.ok && cr.project.tracks.find((l) => l.id === 'main')!.clips[1].comp, cid)
  // 声音摊平：合成段 2 秒起·合成里 s1 在 1 秒 ⇒ 主时间轴 3 秒·音量乘合成段的
  const comps: Comps = { cc: r.comp }
  const tracks2 = r.tracks.map((l) => ({ ...l, clips: l.clips.map((c) => (c.comp ? { ...c, volume: 0.5 } : c)) }))
  const flat = flattenCompAudio(tracks2, comps)
  const seg = flat.flatMap((l) => l.clips).find((c) => c.id === 'cclip~s1')!
  assert.ok(seg && seg.start === 3 && seg.length === 2 && seg.offset === 0 && seg.volume === 0.5, JSON.stringify(seg))
  const plan = subClipPlan(flat, withCompAudioIds(['cclip'], flat), kindOf)!
  assert.ok(plan.segs.some((s) => s.mediaId === 'aud' && s.at === 1), '只汇出选中的合成段也带它里面的声音')
  // 合成段截头（offset 1.5）⇒ 合成里 s1 被截掉 0.5 秒·入点往后挪
  const cut = flattenCompAudio(tracks2.map((l) => ({ ...l, clips: l.clips.map((c) => (c.comp ? { ...c, offset: 1.5, length: 1.5 } : c)) })), comps).flatMap((l) => l.clips).find((c) => c.id === 'cclip~s1')!
  assert.ok(cut.start === 2 && Math.abs(cut.length - 1.5) < 1e-9 && Math.abs(cut.offset - 0.5) < 1e-9, JSON.stringify(cut))
  // 变了速的合成段 ⇒ 不摊（文件写明）
  assert.ok(!flattenCompAudio(tracks2.map((l) => ({ ...l, clips: l.clips.map((c) => (c.comp ? { ...c, speed: 2 } : c)) })), comps).some((l) => l.clips.some((c) => c.id.includes('~'))))
})

test('E 画面层轨道遮罩：指定片段／上方相邻轨·遮罩层本身不画（show 例外）·遮罩那层画法挂在用它的片段上·四种方式公式·命令 clip.setMatte', () => {
  const tr: Tracks = [
    L('top', 'visual', [C('m1', 0, 4, { shape: { shape: 'rect', stroke: '#ffffff', width: 0.01, fill: '#ffffff', radius: 0, w: 0.5, h: 0.5 } as TlClip['shape'] })]),
    L('main', 'visual', [C('u1', 0, 4, { comp: 'cB', look: { matte: { clip: 'm1', mode: 'alpha' } } as TlClip['look'] })]),
  ]
  const comps: Comps = { cB: { name: 'B', ratio: { kind: 'fit' }, tracks: [L('main', 'visual', [C('b1', 0, 6, { solid: { color: '#0000ff' } })])] } }
  assert.equal(matteLaneOf(tr, 'main', { clip: 'm1', mode: 'alpha' }), 'top')
  assert.deepEqual([...matteLanesAt(tr, 1)], [['top', 'main']])
  const plan = framePlan(tr, 1, kindOf, undefined, comps)
  assert.deepEqual(plan.map((o) => `${o.kind}:${o.clip.id}`), ['media:u1'], '遮罩层不画·只剩用它的那段')
  const mo = plan[0].kind === 'media' ? plan[0].matte : undefined
  assert.ok(mo && mo.laneId === 'top' && mo.ops.length === 1 && mo.ops[0].kind === 'vector' && mo.ops[0].clip.id === 'm1', JSON.stringify(mo))
  // 指定片段此刻不在（4 秒后 m1 没了）⇒ 那层不藏、遮罩全挡（ops 空）
  const tr2 = tr.map((l) => (l.id === 'main' ? { ...l, clips: [{ ...l.clips[0], length: 6 }] } : l))
  assert.equal(matteLanesAt(tr2, 5).size, 0)
  const p5 = framePlan(tr2, 5, kindOf, undefined, comps)
  assert.ok(p5[0].kind === 'media' && p5[0].matte && p5[0].matte.ops.length === 0)
  // show：遮罩层照画
  const trShow = tr.map((l) => (l.id === 'main' ? { ...l, clips: [{ ...l.clips[0], look: { matte: { clip: 'm1', mode: 'alpha', show: true } } as TlClip['look'] }] } : l))
  assert.deepEqual(framePlan(trShow, 1, kindOf, undefined, comps).map((o) => o.clip.id), ['u1', 'm1'])
  // 四种方式（遮罩画好的像素：不透明白、半透明灰 128 a128、透明）
  const px = new Uint8ClampedArray([255, 255, 255, 255, 128, 128, 128, 128, 0, 0, 0, 0])
  const run = (k: 'alpha' | 'alphaInv' | 'luma' | 'lumaInv') => { const a = px.slice(); const m = matteFromKind(k); matteAlpha(a, m.mode!, !!m.invert); return [a[3], a[7], a[11]] }
  assert.deepEqual(run('alpha'), [255, 128, 0]); assert.deepEqual(run('alphaInv'), [0, 127, 255])
  assert.deepEqual(run('luma'), [255, 64, 0]); assert.deepEqual(run('lumaInv'), [0, 191, 255])
  // 命令
  const raw = { v: 1, media: MEDIA, tracks: tr.map((l) => (l.id === 'main' ? { ...l, clips: [{ ...l.clips[0], look: undefined }] } : l)), comps }
  const cmd = (params: Record<string, unknown>) => applyCommands(clone(raw), [{ command: 'clip.setMatte', params: { clips: 'u1', ...params } }])
  const ok1 = cmd({ matte: 'm1', mode: 'lumaInv' })
  assert.ok(ok1.ok, JSON.stringify(ok1)); assert.deepEqual(ok1.ok && ok1.project.tracks.find((l) => l.id === 'main')!.clips[0].look!.matte, { mode: 'luma', invert: true, clip: 'm1' })
  const ok2 = cmd({ above: true, mode: 'alphaInv' })
  assert.ok(ok2.ok); assert.deepEqual(ok2.ok && ok2.project.tracks.find((l) => l.id === 'main')!.clips[0].look!.matte, { mode: 'alpha', invert: true, lane: 'top' })
  assert.ok(!cmd({ matte: 'm1', above: true }).ok, '两种来源同给 ⇒ 拒')
  const self = cmd({ lane: 'main' }); assert.ok(!self.ok && /different lane/.test(self.error))
  const off = applyCommands(ok1.ok ? ok1.project : raw, [{ command: 'clip.setMatte', params: { clips: 'u1', remove: true } }])
  assert.ok(off.ok && off.project.tracks.find((l) => l.id === 'main')!.clips[0].look?.matte === undefined)
})

test('F 命令 comp.*：建／改／列／删·comp.enter 里照常用各条命令改合成·结果过读档不丢不改', () => {
  let k = 0
  const r = applyCommands({ v: 1, media: MEDIA, tracks: [L('main', 'visual', [])] }, [
    { command: 'comp.create', params: { name: '标题卡', ratio: '1:1', length: 4 } },
    { command: 'comp.enter', params: { comp: '$0' } },
    { command: 'solid.add', params: { color: '#112233', at: 0, length: 4 } },
    { command: 'text.add', params: { content: '你好', at: 0.5 } },
    { command: 'timeline.list' },
    { command: 'comp.exit' },
    { command: 'clip.add', params: { media: '$0', at: 1, in: 1 } },
    { command: 'comp.update', params: { comp: '$0', name: '标题卡2' } },
    { command: 'comp.list' },
  ], { newId: () => `id${++k}` })
  assert.ok(r.ok, JSON.stringify(r))
  const p = r.ok ? r.project : null!
  const cid = r.ok ? r.results[0].id! : ''
  assert.equal(p.comps![cid].name, '标题卡2'); assert.equal(p.comps![cid].length, 4); assert.deepEqual(p.comps![cid].ratio, { kind: 'preset', key: '1:1' })
  assert.ok(p.comps![cid].tracks.some((l) => l.kind === 'text' && l.clips.length === 1), '进合成加的字在合成里')
  assert.equal(p.tracks.flatMap((l) => l.clips).filter((c) => c.text).length, 0, '主时间轴没多出字')
  const placed = p.tracks.find((l) => l.id === 'main')!.clips[0]
  assert.ok(placed.comp === cid && placed.offset === 1 && Math.abs(placed.length - 3) < 1e-9, JSON.stringify(placed))
  const list = r.ok ? (r.results[4].data as { composition?: { id: string } }) : null
  assert.equal(list?.composition?.id, cid, 'timeline.list 在合成里列合成')
  const cl = r.ok ? (r.results[8].data as { comps: Array<{ id: string; usedBy: string[] }> }) : null
  assert.deepEqual(cl?.comps[0].usedBy, [placed.id])
  // 还用着 ⇒ 删不掉；删了合成段再删
  const del = applyCommands(p, [{ command: 'comp.delete', params: { comp: cid } }]); assert.ok(!del.ok && /still used/.test(del.error))
  const del2 = applyCommands(p, [{ command: 'clip.delete', params: { clips: placed.id } }, { command: 'comp.delete', params: { comp: cid } }])
  assert.ok(del2.ok && !del2.project.comps, JSON.stringify(del2))
})

console.log(`comp-matte → ${n} 过 ${bad} 败`)
if (bad) process.exit(1)

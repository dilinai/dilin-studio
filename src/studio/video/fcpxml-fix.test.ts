// 剪辑 FCPXML 与读档（Windows 上的问题）：
// X1 24fps 素材换成 30 帧时，相接的片段之间不能多出 1 帧空档（首尾各自换帧）；
// X2 定速变速用 timeMap 带过去：0.5 倍那段在素材上只用到一半，不再写成比素材还长的片段；
// X3 写了比例却读成「适应」（旧档 "21:9"、库里没有的键）要报 ratio_unknown。
// 跑法（在 studio 根目录跑）：node -e "require('sucrase/register/ts');require('./video/fcpxml-fix.test.ts')"
// 负控：lenOf 改回 fr(c.length) ⇒ X1 红；拿掉 timeMap ⇒ X2 红；拿掉 ratio_unknown 那行 ⇒ X3 红。
import assert from 'node:assert/strict'
import { docToFcpxml } from './lib/fcpxml.pure'
import { parseProjectIssues } from './lib/project.pure'
import type { VideoDoc } from './format'

let failed = 0
const ok = (n: string, f: () => void) => { try { f(); console.log('✓', n) } catch (e) { failed++; console.log('✗', n, '\n ', (e as Error).message) } }
const lane = (id: string, kind: string, clips: unknown[]) => ({ id, kind, locked: false, hidden: false, muted: false, clips })
const doc = (clips: unknown[], media = [{ id: 'm1', name: 'a.mp4', kind: 'video', duration: 12.04, from: 'local', file: 'a.mp4' }]) => {
  const r = parseProjectIssues({ ratio: { kind: 'preset', key: '16:9' }, media, tracks: [lane('main', 'visual', clips)] })
  if (!r.ok) throw new Error('parse')
  return { name: 'T', ...r.project, media: r.project.media.map((m) => ({ ...m, file: 'a.mp4' })) } as unknown as VideoDoc
}

ok('X1 1/24 秒对齐的相接片段：没有 gap', () => {
  const clips = Array.from({ length: 6 }, (_, i) => ({ id: `c${i}`, mediaId: 'm1', start: i * (41 / 24), length: 41 / 24, offset: 0 }))
  const { xml } = docToFcpxml(doc(clips))
  assert.equal((xml.match(/<gap /g) ?? []).length, 0, '相接的片段之间不该有 1 帧空档')
})

ok('X2 0.5 倍定速：带 timeMap、start 在变速后的时间上、notes 不再报 speed', () => {
  const { xml, notes } = docToFcpxml(doc([{ id: 'c1', mediaId: 'm1', start: 0, length: 20, offset: 2, speed: 0.5 }]))
  assert.match(xml, /<asset-clip [^>]*start="120\/30s" duration="600\/30s"[^>]*><timeMap><timept time="0s" value="0s" interp="linear"\/><timept time="\d+\/30s" value="\d+\/30s" interp="linear"\/><\/timeMap>/)
  const [, t, v] = /<timept time="(\d+)\/30s" value="(\d+)\/30s"/.exec(xml)!
  assert.equal(Number(t), Number(v) * 2)
  assert.ok(!notes.includes('speed'))
})

ok('X3 比例读不懂要报：字串 "21:9"、不存在的 preset；合法的不报', () => {
  const codes = (ratio: unknown) => { const r = parseProjectIssues({ ratio, tracks: [] }); return r.ok ? r.issues.filter((d) => d.code === 'ratio_unknown').length : -1 }
  assert.equal(codes('21:9'), 1)
  assert.equal(codes({ kind: 'preset', key: '21:9' }), 1)
  assert.equal(codes({ kind: 'preset', key: '2.35:1' }), 0)
  assert.equal(codes({ kind: 'fit' }), 0)
  assert.equal(codes(undefined), 0)
  assert.equal(codes({ kind: 'custom', w: 1470, h: 630 }), 0)
})

ok('X4 给 assetBase ⇒ media-rep 写绝对 file:// 网址（档名照编码）；不给 ⇒ 照旧相对 ./assets/', () => {
  const d = doc([{ id: 'c1', mediaId: 'm1', start: 0, length: 2, offset: 0 }])
  ;(d.media[0] as { file: string }).file = '我的 片.mp4'
  assert.match(docToFcpxml(d, { assetBase: 'file:///D:/proj/assets/' }).xml, /src="file:\/\/\/D:\/proj\/assets\/%E6%88%91%E7%9A%84%20%E7%89%87\.mp4"/)
  assert.match(docToFcpxml(d).xml, /src="\.\/assets\/%E6%88%91%E7%9A%84%20%E7%89%87\.mp4"/)
})

console.log(`${4 - failed}/4 passed`)
if (failed) process.exitCode = 1

// 汇入／拖放的档种类判断：File.type 是空字串、application/octet-stream 或别的非影音图片类型 ⇒ 按副档名（lib/media-kind.pure.ts）。
//   页面脚本或浏览器扩充自己造的 File、系统没登记 .m4a 等副档名时，File.type 常是空的 ⇒ 只看 type 会被当成「不是素材」丢掉。
// 跑法（在 studio 根目录跑）：node -e "require('sucrase/register/ts');require('./video/media-kind.test.ts')"
// 负控：把 mediaKindOf 末行的 mediaKindOfName(file.name) 改成 null ⇒ K2／K3／K5 红。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MEDIA_ACCEPT_EXTS, mediaKindOf, mediaKindOfName } from './lib/media-kind.pure'

let n = 0, bad = 0
function test(name: string, fn: () => void) {
  try { fn(); n++; console.log('✓', name) } catch (e) { bad++; console.log('✗', name); console.log('  ', (e as Error).message.split('\n').slice(0, 6).join('\n   ')) }
}

const AUDIO = ['mp3', 'wav', 'aac', 'm4a', 'flac', 'ogg', 'opus', 'aiff', 'aif', 'wma', 'caf', 'weba']
const VIDEO = ['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi']
const IMAGE = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'svg']
const ALL: Array<[string, 'audio' | 'video' | 'image']> = [...AUDIO.map((e) => [e, 'audio'] as [string, 'audio']), ...VIDEO.map((e) => [e, 'video'] as [string, 'video']), ...IMAGE.map((e) => [e, 'image'] as [string, 'image'])]

test('K1 type 是影音图片 ⇒ 照 type（副档名不管）', () => {
  assert.equal(mediaKindOf({ name: 'tone.m4a', type: 'audio/x-m4a' }), 'audio')
  assert.equal(mediaKindOf({ name: 'tone.m4a', type: 'audio/mp4' }), 'audio')
  assert.equal(mediaKindOf({ name: 'clip.bin', type: 'video/mp4' }), 'video')
  assert.equal(mediaKindOf({ name: 'x', type: 'image/png' }), 'image')
  assert.equal(mediaKindOf({ name: 'a.mp4', type: 'Audio/MP4' }), 'audio')
})

test('K2 各副档名 × 空 type ⇒ 按副档名（大小写不拘）', () => {
  for (const [ext, kind] of ALL) {
    assert.equal(mediaKindOf({ name: `f.${ext}`, type: '' }), kind, `.${ext}`)
    assert.equal(mediaKindOf({ name: `F.${ext.toUpperCase()}`, type: '' }), kind, `.${ext.toUpperCase()}`)
  }
})

test('K3 各副档名 × application/octet-stream ⇒ 按副档名', () => {
  for (const [ext, kind] of ALL) assert.equal(mediaKindOf({ name: `素材 1.${ext}`, type: 'application/octet-stream' }), kind, `.${ext}`)
})

test('K4 不是素材的档照旧不收', () => {
  for (const name of ['project.json', 'cut.fcpxml', 'sub.srt', 'notes.txt', 'm4a', 'archive.zip', 'tone.m4a.txt', '']) {
    assert.equal(mediaKindOf({ name, type: '' }), null, name)
    assert.equal(mediaKindOf({ name, type: 'application/octet-stream' }), null, name)
  }
  assert.equal(mediaKindOf({ name: 'project.json', type: 'application/json' }), null)
  assert.equal(mediaKindOfName('sub.vtt'), null)
})

test('K5 type 是别的非影音类型（text/plain 等）⇒ 也按副档名', () => {
  assert.equal(mediaKindOf({ name: 'tone.m4a', type: 'text/plain' }), 'audio')
  assert.equal(mediaKindOf({ name: 'clip.mkv', type: 'application/x-matroska' }), 'video')
})

test('K6 选档窗 accept 列出每个副档名；页面 kindOf 走 mediaKindOf、汇入框用 MEDIA_ACCEPT_EXTS', () => {
  const acc = MEDIA_ACCEPT_EXTS.split(',')
  for (const [ext] of ALL) assert.ok(acc.includes('.' + ext), `accept 缺 .${ext}`)
  for (const a of acc) assert.notEqual(mediaKindOfName('x' + a), null, `accept 有 ${a} 但判断不收`)
  const page = readFileSync(join(__dirname, 'page/VideoEditPage.tsx'), 'utf8')
  assert.match(page, /function kindOf\(file: File\): MediaKind \| null \{\s*return mediaKindOf\(file\)\s*\}/)
  assert.ok(page.includes('${MEDIA_ACCEPT_EXTS}'), '汇入框 accept 没带副档名')
  assert.ok(!/file\.type\.startsWith\(/.test(page), '页面还有只看 file.type 的判断')
})

console.log(`\n${n} ok, ${bad} failed`)
if (bad) process.exit(1)

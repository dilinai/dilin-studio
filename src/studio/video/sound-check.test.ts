// 素材声音解不开（浏览器不支援的编码如 ALAC、坏档、解出 0 个样本）⇒ 标无声＋提示怎么转档·同一份只提示一次（lib/sound-check.pure.ts）。
// 跑法（在 studio 根目录跑）：node -e "require('sucrase/register/ts');require('./video/sound-check.test.ts')"
// 负控：soundUndecodable 只认 kind === 'audio'（影片的声音轨解不开不算）⇒ S1 红；decodedProbe 一律回 'ok' ⇒ S3 红；firstSoundWarn 一律回 true ⇒ S4 红。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SOUND_NOTICE_MS, decodedProbe, firstSoundWarn, soundUndecodable } from './lib/sound-check.pure'
import { VIDEO_I18N } from './i18n'

let n = 0, bad = 0
function test(name: string, fn: () => void) {
  try { fn(); n++; console.log('✓', name) } catch (e) { bad++; console.log('✗', name); console.log('  ', (e as Error).message.split('\n').slice(0, 6).join('\n   ')) }
}

test('S1 有声音轨却解不开 ⇒ 音频、影片都标无声', () => {
  assert.equal(soundUndecodable('audio', 'undecodable'), true)
  assert.equal(soundUndecodable('video', 'undecodable'), true)
})

test('S2 音频档读不到声音轨（坏档／副档名不对）⇒ 标；影片没声音轨是常态 ⇒ 不标；能解／没法判断 ⇒ 不标', () => {
  assert.equal(soundUndecodable('audio', 'none'), true)
  assert.equal(soundUndecodable('video', 'none'), false)
  for (const k of ['audio', 'video'] as const) {
    assert.equal(soundUndecodable(k, 'ok'), false, k)
    assert.equal(soundUndecodable(k, 'unknown'), false, k)
  }
  assert.equal(soundUndecodable('image', 'undecodable'), false)
})

test('S3 解码器不报错却一格样本都没解出来 ⇒ 当解不开', () => {
  assert.equal(decodedProbe(0), 'undecodable')
  assert.equal(decodedProbe(1024), 'ok')
  assert.equal(soundUndecodable('video', decodedProbe(0)), true)
})

test('S4 同一条素材只提示一次；重试清掉记号后能再提示', () => {
  const seen = new Set<string>()
  assert.equal(firstSoundWarn(seen, 'k1'), true)
  assert.equal(firstSoundWarn(seen, 'k1'), false)
  assert.equal(firstSoundWarn(seen, 'k1'), false)
  assert.equal(firstSoundWarn(seen, 'k2'), true)
  seen.delete('k1')
  assert.equal(firstSoundWarn(seen, 'k1'), true)
})

test('S5 提示文案三语：说明可能是 ALAC、请转成 mp3 或 AAC 编码的 m4a；留得比一般提示久', () => {
  for (const l of ['zh-TW', 'zh-CN', 'en'] as const) {
    const d = VIDEO_I18N[l] as Record<string, string>
    const s = d.vedit_audio_decode_fail
    assert.ok(s.includes('{name}'), `${l} 带档名`)
    for (const w of ['ALAC', 'mp3', 'AAC', 'm4a']) assert.ok(s.includes(w), `${l} 提到 ${w}`)
    assert.ok(d.vedit_no_sound_badge, `${l} 无声标`)
  }
  assert.ok(SOUND_NOTICE_MS > 4000)
})

test('S6 页面接线：汇入探声音轨、算波形看 sound、片段与素材卡标无声', () => {
  const page = readFileSync(join(__dirname, 'page/VideoEditPage.tsx'), 'utf8')
  assert.match(page, /const noSound = kind !== 'image' && soundUndecodable\(kind, await probeSound\(f\)\)/)
  assert.match(page, /for \(const m of added\) if \(m\.noSound\) flagNoSound\(m, false\)/)
  assert.match(page, /else if \(soundUndecodable\(mm\.kind, p\.sound\)\) flagNoSound\(mm, true\)/)
  assert.match(page, /if \(!firstSoundWarn\(soundWarned\.current, m\.id\)\) return/) // 记号按素材编号：内容键带工程编号、汇入时还没有 ⇒ 放上时间轴会再提示一次
  assert.match(page, /setNotice\(null\); soundWarned\.current\.delete\(r\.id\); peaksAsked\.current\.delete\(r\.id\)/)
  assert.match(page, /data-testid="vedit-clip-no-sound"/)
  assert.match(page, /data-testid="vedit-media-no-sound"/)
  const store = readFileSync(join(__dirname, 'lib/opfs-cache.ts'), 'utf8')
  assert.match(store, /const sound = decodedProbe\(frames\)\n\s*if \(sound !== 'ok'\) return \{ peaks: null, sound \}/)
})

console.log(`sound-check: ${n} 过、${bad} 红`)
if (bad) process.exit(1)

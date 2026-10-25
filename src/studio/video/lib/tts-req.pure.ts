// 剪辑·朗读配音的请求验值（音色清单、情绪、字数上限、参数夹范围）。纯函数·不碰网络。
// 网站与开源单机版共用这一份；合成、计费、钥匙在网站那层（不随开源）。
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** 一次最多几个字（同步接口上限 1 万·剪辑一段字用不到那么长·压低免得长段误送） */
export const TTS_MAX_CHARS = 1000
/** 系统音色（MiniMax 常驻的那批·台陆都有） */
export const TTS_VOICES = [
  'female-shaonv', 'female-yujie', 'female-chengshu', 'female-tianmei', 'presenter_female', 'audiobook_female_1',
  'male-qn-qingse', 'male-qn-jingying', 'male-qn-badao', 'male-qn-daxuesheng', 'presenter_male', 'audiobook_male_1',
] as const
export type TtsVoice = (typeof TTS_VOICES)[number]
export const TTS_EMOTIONS = ['auto', 'happy', 'sad', 'angry', 'surprised', 'calm'] as const
export type TtsEmotion = (typeof TTS_EMOTIONS)[number]
/** speed 0.5～2·pitch -12～12 半音（经卷 voice_setting 范围） */
export type TtsReq = { text: string; voice: TtsVoice; speed: number; pitch: number; emotion: TtsEmotion }
export const TTS_DEFAULT: Omit<TtsReq, 'text'> = { voice: 'female-shaonv', speed: 1, pitch: 0, emotion: 'auto' }

/** 页面送来的验值：字去头尾空白、不能空、不能超长；其他夹进范围／不认得的换缺省 */
/** 有没有能念出来的字（任一种文字的字母或数字）：只有表情、标点、空白 ⇒ 语音服务也回 200 但给一段空白音 ⇒ 送出前就挡 */
export const ttsReadable = (text: string) => /[\p{L}\p{N}]/u.test(text)
export function parseTtsReq(v: unknown): { ok: true; req: TtsReq } | { ok: false; code: 'empty' | 'too_long' | 'bad' | 'no_readable' } {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return { ok: false, code: 'bad' }
  const o = v as Record<string, unknown>
  const text = typeof o.text === 'string' ? o.text.replace(/\r\n?/g, '\n').trim() : ''
  if (!text) return { ok: false, code: 'empty' }
  if ([...text].length > TTS_MAX_CHARS) return { ok: false, code: 'too_long' }
  if (!ttsReadable(text)) return { ok: false, code: 'no_readable' }
  const voice = (TTS_VOICES as readonly string[]).includes(String(o.voice)) ? (o.voice as TtsVoice) : TTS_DEFAULT.voice
  const emotion = (TTS_EMOTIONS as readonly string[]).includes(String(o.emotion)) ? (o.emotion as TtsEmotion) : 'auto'
  const speed = Math.round(clamp(num(o.speed) ?? 1, 0.5, 2) * 100) / 100
  const pitch = Math.round(clamp(num(o.pitch) ?? 0, -12, 12))
  return { ok: true, req: { text, voice, speed, pitch, emotion } }
}

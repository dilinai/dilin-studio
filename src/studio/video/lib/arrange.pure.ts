// 网页剪辑页·「编曲」。
// 本档只放纯函数（题直接跑）：乐器清单、音高名、电脑键盘对琴键、格子（十六分音符一格）上加／删／拉长／挪音符、录音落格、读档验值、钢琴音色参数、WAV 编码。
// 弹窗画法在 video-edit/VeditArrange.tsx·发声在 video-edit/vedit-piano-synth.ts（同一份音色参数·弹的、播的、汇出的都同一个声音）。⛔ 碰 DOM。
// 页面文案三语在翻译档 lib/translations/backfill.ts。
import { studioStaticHref } from '../../shared/host'
/** 界面字典的键（各宿主的字典都有这些键） */
type TKey = string

export type ArrLang = 'tw' | 'cn' | 'en'
export const arrLang = (language: string): ArrLang => (language === 'zh-CN' ? 'cn' : language === 'en' ? 'en' : 'tw')

/** 乐器·名字走翻译档 backfill（bf_varr_*）。不管哪种乐器都用同一排琴键弹 */
// 四种都改用真乐器录音（见下面 SAMPLE_SETS）
export type InstrumentId = 'piano' | 'flute' | 'erhu' | 'zheng'
export type Instrument = { id: InstrumentId; label: TKey }
export const INSTRUMENTS: readonly Instrument[] = [
  { id: 'piano', label: 'bf_varr_piano' }, { id: 'flute', label: 'bf_varr_flute' }, { id: 'erhu', label: 'bf_varr_erhu' }, { id: 'zheng', label: 'bf_varr_zheng' },
]
export const instrumentOf = (id: string): Instrument => INSTRUMENTS.find((i) => i.id === id) ?? INSTRUMENTS[0]

// ── 真乐器录音：档放在网站自己的 public/vedit/samples/<夹>/<MIDI 音高>.mp3（台陆两版各一份·⛔ 热链别站）·出处写在同夹 CREDITS.txt ──
// 每种只录了一部分音（钢琴隔三个半音、笛子隔两个、二胡每个、越南筝五声音阶）；中间缺的音拿最近那个录音调快调慢补。
// sustain＝按着会一直响（吹、拉）·放开就收；否则是敲、拨的（放开收得慢一点·录音自己会衰减）；gain＝这种乐器再放大几倍（无头 Chrome 汇出量过·对齐到原本合成音的响度）
export const VEDIT_SAMPLE_BASE = '/vedit/samples'
export type SampleSet = { dir: string; notes: readonly number[]; sustain: boolean; release: number; gain: number }
const range = (a: number, b: number, step: number) => Array.from({ length: Math.floor((b - a) / step) + 1 }, (_, i) => a + i * step)
export const SAMPLE_SETS: Record<InstrumentId, SampleSet> = {
  piano: { dir: 'piano', notes: range(33, 99, 3), sustain: false, release: 0.35, gain: 1 },      // Salamander（Alexander Holm·CC BY 3.0）·A1～D#7
  flute: { dir: 'dizi', notes: range(67, 91, 2), sustain: true, release: 0.18, gain: 1.5 },        // Freesound Hypnotriod「Flute Dizi C」（CC0）·G4～G6
  erhu: { dir: 'erhu', notes: range(62, 81, 1), sustain: true, release: 0.15, gain: 2.7 },         // sfzinstruments aliexpress-erhu（CC0）·D4～A5
  zheng: { dir: 'zheng', notes: [47, 49, 51, 54, 56, 59, 61, 63, 66, 68, 71, 73, 75, 78, 80, 83], sustain: false, release: 0.6, gain: 1.25 }, // VCSL 越南筝（CC0）·B2～B5 五声
}
export const sampleUrl = (inst: InstrumentId, midi: number) => studioStaticHref(`${VEDIT_SAMPLE_BASE}/${SAMPLE_SETS[inst].dir}/${midi}.mp3`)
/** 弹 p 这个音要拿哪个录音、调快多少（rate＝播放速度倍数·>1 调高）：挑最近的录音；一样近挑高的那个往下调（往下调比往上调自然） */
export function nearestSample(inst: InstrumentId, p: number): { midi: number; rate: number } {
  const ns = SAMPLE_SETS[inst].notes
  let best = ns[0]
  for (const n of ns) if (Math.abs(n - p) < Math.abs(best - p) || (Math.abs(n - p) === Math.abs(best - p) && n > best)) best = n
  return { midi: best, rate: Math.pow(2, (p - best) / 12) }
}


// ── 格子：一拍四格（十六分音符）·一小节四拍 ──
export const STEPS_PER_BEAT = 4
export const BEATS_PER_BAR = 4
export const STEPS_PER_BAR = STEPS_PER_BEAT * BEATS_PER_BAR
export const BPM_MIN = 40
export const BPM_MAX = 240
export const BPM_DEFAULT = 100
/** 小节数 */
export const BARS_CHOICES = [4, 8, 16, 32, 64, 128] as const
export const BARS_DEFAULT = 8
/** 格子上下：C2（36）～C7（96）·琴键能弹的范围同 */
export const PITCH_LO = 36
export const PITCH_HI = 96
export const MAX_NOTES = 4000

/** 一个音符：p＝音高（MIDI 编号·60＝中央 C）；s＝从第几格开始；l＝几格长；v＝力度 0～1 */
export type Note = { id: string; p: number; s: number; l: number; v: number }
/** 一条音轨：inst＝乐器；vol＝音量 0～1；mute＝静音；solo＝独奏（有任一条独奏 ⇒ 只放独奏的） */
export type ArrTrack = { id: string; inst: InstrumentId; vol: number; mute: boolean; solo: boolean; notes: Note[]; audio?: AudioClip; parts?: Part[]; pieces?: AudioPiece[] }
/** 音轨上一段一段的片段。
 *  乐器轨＝Part（格）：开头落在 [s, s+l) 的音符归这段（挪段＝音符一起挪·裁段＝段外的音符拿掉或截短）；
 *  音频轨＝AudioPiece（秒）：at＝曲子第几秒开始放；off＝从档里第几秒放起；len＝放几秒（同一个档可以剪成好几段） */
export type Part = { id: string; s: number; l: number }
export type AudioPiece = { id: string; at: number; off: number; len: number }
/** 音频音轨的那段声音：
 *  file＝本机储存里的档编号（档本身在 OPFS·vedit-store）；name＝原档名；dur＝秒；at＝从曲子第几秒开始放（导入时 0） */
/** driveId／url＝传上云盘那份（本机储存读不到就从这里拉回来·换电脑也开得出来） */
export type AudioClip = { file: string; name: string; dur: number; at: number; driveId?: string; url?: string }
/** 这条是不是音频音轨（没有音符可编·不录音·画波形） */
/** 导入的声音最长几秒（解开后整段放记忆体·太长会吃光记忆体） */
export const CLIP_MAX_SEC = 15 * 60
export const isAudioTrack = (tr: Pick<ArrTrack, 'audio'>) => !!tr.audio
/** 编曲：tracks＝音轨（由上到下）；sel＝选中的那条（琴键弹的、录音录进去的、格子编的都是它） */
/** 调号：root＝主音（0＝C … 11＝B）；minor＝小调 */
export type KeySig = { root: number; minor: boolean }
export const KEY_DEFAULT: KeySig = { root: 0, minor: false }
export type Arrangement = { v: 2; bpm: number; bars: number; key: KeySig; tracks: ArrTrack[]; sel: string }
/** 音轨上限（分轨一次出 6 条·再加乐器轨） */
export const MAX_TRACKS = 12
export const VOL_DEFAULT = 0.8
export const newTrack = (id: string, inst: InstrumentId): ArrTrack => ({ id, inst, vol: VOL_DEFAULT, mute: false, solo: false, notes: [] })
/** 预设两条：钢琴、笛子 */
export const defaultTracks = (): ArrTrack[] => [newTrack('t-piano', 'piano'), newTrack('t-flute', 'flute')]
export const emptyArrangement = (): Arrangement => ({ v: 2, bpm: BPM_DEFAULT, bars: BARS_DEFAULT, key: { ...KEY_DEFAULT }, tracks: defaultTracks(), sel: 't-piano' })
const SCALE_MAJOR = [0, 2, 4, 5, 7, 9, 11]
const SCALE_MINOR = [0, 2, 3, 5, 7, 8, 10]
/** 这个音在不在调内（格子里调外的那几行淡掉·弹的时候不容易错音） */
export const inKey = (p: number, k: KeySig) => (k.minor ? SCALE_MINOR : SCALE_MAJOR).includes((((p - k.root) % 12) + 12) % 12)
/** 调号显示：「E maj」「A min」（照音悦家·字母不翻） */
export const keySigName = (k: KeySig) => `${NAMES[((k.root % 12) + 12) % 12]} ${k.minor ? 'min' : 'maj'}`
export const KEY_CHOICES: readonly KeySig[] = [false, true].flatMap((minor) => Array.from({ length: 12 }, (_, root) => ({ root, minor })))
export function parseKeySig(v: unknown): KeySig {
  if (!v || typeof v !== 'object') return { ...KEY_DEFAULT }
  const o = v as Record<string, unknown>
  const r = int(o.root)
  return { root: r === null ? 0 : ((r % 12) + 12) % 12, minor: o.minor === true }
}
/** 吸附单位（格数·照音悦家标尺旁「小节▾」）：16 分音符／8 分／一拍／一小节 */
export const SNAP_CHOICES = [1, 2, STEPS_PER_BEAT, STEPS_PER_BAR] as const
export type Snap = (typeof SNAP_CHOICES)[number]
export const snapDown = (s: number, q: number) => Math.floor(s / q) * q
/** 量化（音悦家编辑器「量化」钮）：每个音的开头对齐到最近的吸附格、长度至少一个吸附单位；对齐后撞到同音高的 ⇒ 截短或丢掉；没变 ⇒ 原物件 */
export function quantizeNotes(notes: readonly Note[], q: number, total: number): Note[] | readonly Note[] {
  if (q <= 1 || !notes.length) return notes
  let out: Note[] | readonly Note[] = []
  for (const n of [...notes].sort((a, b) => a.s - b.s || a.p - b.p)) {
    const s = Math.min(Math.round(n.s / q) * q, total - q)
    out = addNote(out, { ...n, s, l: Math.max(q, Math.round(n.l / q) * q) }, total)
  }
  const same = out.length === notes.length && out.every((n) => { const o = notes.find((x) => x.id === n.id); return !!o && o.s === n.s && o.l === n.l })
  return same ? notes : out
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null)

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const
export const noteName = (p: number) => `${NAMES[((p % 12) + 12) % 12]}${Math.floor(p / 12) - 1}`
export const isBlack = (p: number) => [1, 3, 6, 8, 10].includes(((p % 12) + 12) % 12)
export const midiFreq = (p: number) => 440 * 2 ** ((p - 69) / 12)

export const totalSteps = (a: Pick<Arrangement, 'bars'>) => a.bars * STEPS_PER_BAR
/** 一格几秒 */
export const stepSec = (bpm: number) => 60 / bpm / STEPS_PER_BEAT
export const arrangeSeconds = (a: Pick<Arrangement, 'bars' | 'bpm'>) => totalSteps(a) * stepSec(a.bpm)

/** 电脑键盘对琴键（照常见的编曲软件：A 排白键、上一排黑键·按实体键位 code·跟输入法无关）：值＝比底音高几个半音 */
export const KEY_SEMITONE: Readonly<Record<string, number>> = {
  KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11,
  KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16, Quote: 17,
}
export const KEY_LABEL: Readonly<Record<string, string>> = { Semicolon: ';', Quote: "'" }
export const keyLabel = (code: string) => KEY_LABEL[code] ?? code.replace(/^Key/, '')
/** 屏幕琴键露出的范围：底音（C）起两个八度到 E（最右是白键·黑键不出界） */
export const KEYBOARD_SPAN = 29
export const BASE_DEFAULT = 60
export const BASE_MIN = PITCH_LO
export const BASE_MAX = PITCH_HI - KEYBOARD_SPAN + 1
export const shiftBase = (base: number, dir: -1 | 1) => clamp(base + 12 * dir, BASE_MIN, BASE_MAX - ((BASE_MAX - BASE_MIN) % 12))
export function pitchOfKey(code: string, base: number): number | null {
  const s = KEY_SEMITONE[code]
  if (s === undefined) return null
  const p = base + s
  return p >= PITCH_LO && p <= PITCH_HI ? p : null
}

const sortNotes = (ns: Note[]) => ns.sort((a, b) => a.s - b.s || a.p - b.p)
/** 这一格（音高 p·第 s 格）压着的音符 */
export const noteAt = (notes: readonly Note[], p: number, s: number) => notes.find((n) => n.p === p && s >= n.s && s < n.s + n.l) ?? null
/** 同音高从 s 起最多能放多长（不盖到后面那个同音高的音符·不超过尾巴） */
export function roomAt(notes: readonly Note[], p: number, s: number, total: number, ignoreId?: string): number {
  let end = total
  for (const n of notes) if (n.p === p && n.id !== ignoreId && n.s >= s) end = Math.min(end, n.s)
  for (const n of notes) if (n.p === p && n.id !== ignoreId && n.s < s && n.s + n.l > s) return 0
  return Math.max(0, end - s)
}

/** 加一个音符（空格才加·长度夹在空间内）；放不下 ⇒ 原物件 */
export function addNote(notes: readonly Note[], n: Omit<Note, 'v'> & { v?: number }, total: number): Note[] | readonly Note[] {
  if (notes.length >= MAX_NOTES || n.p < PITCH_LO || n.p > PITCH_HI || n.s < 0 || n.s >= total) return notes
  const room = roomAt(notes, n.p, n.s, total)
  if (room < 1) return notes
  return sortNotes([...notes, { id: n.id, p: n.p, s: n.s, l: clamp(Math.round(n.l), 1, room), v: clamp(n.v ?? 0.8, 0.05, 1) }])
}
export const removeNote = (notes: readonly Note[], id: string) => (notes.some((n) => n.id === id) ? notes.filter((n) => n.id !== id) : notes)
/** 改长短（夹在空间内·最少一格） */
export function resizeNote(notes: readonly Note[], id: string, l: number, total: number): Note[] | readonly Note[] {
  const n = notes.find((x) => x.id === id)
  if (!n) return notes
  const nl = clamp(Math.round(l), 1, Math.max(1, roomAt(notes, n.p, n.s, total, id)))
  return nl === n.l ? notes : notes.map((x) => (x.id === id ? { ...x, l: nl } : x))
}
/** 挪到别的音高／别的格子；落点撞到同音高别的音符 ⇒ 不动（原物件） */
export function moveNote(notes: readonly Note[], id: string, p: number, s: number, total: number): Note[] | readonly Note[] {
  const n = notes.find((x) => x.id === id)
  if (!n) return notes
  const np = clamp(Math.round(p), PITCH_LO, PITCH_HI), ns = clamp(Math.round(s), 0, total - n.l)
  if (np === n.p && ns === n.s) return notes
  if (roomAt(notes, np, ns, total, id) < n.l) return notes
  return sortNotes(notes.map((x) => (x.id === id ? { ...x, p: np, s: ns } : x)))
}
/** 小节变少 ⇒ 尾巴外的音符拿掉、跨出尾巴的截短 */
export function fitBars(notes: readonly Note[], total: number): Note[] {
  return notes.filter((n) => n.s < total).map((n) => (n.s + n.l > total ? { ...n, l: total - n.s } : n))
}

/** 录音：按下在 t0 秒、放开在 t1 秒（从曲子开头算·已扣掉循环）⇒ 落到最近的格子·长度至少一格；落点被占 ⇒ 截短或不加 */
export function recordNote(notes: readonly Note[], p: number, t0: number, t1: number, bpm: number, total: number, id: string, v = 0.8, q = 1): Note[] | readonly Note[] {
  const st = stepSec(bpm)
  const s = Math.round(t0 / st / q) * q
  if (s >= total || s < 0) return notes
  const l = Math.max(q, Math.round(Math.max(0, t1 - t0) / st / q) * q)
  return addNote(notes, { id, p, s: Math.max(0, s), l, v }, total)
}

/** 一串音符验值（同音高重叠的后者截短或丢掉·编号重复换新·seen 跨音轨共用） */
function parseNotes(raw: unknown, total: number, seen: Set<string>): Note[] {
  let notes: Note[] | readonly Note[] = []
  for (const n of Array.isArray(raw) ? raw : []) {
    if (!n || typeof n !== 'object') continue
    const r = n as Record<string, unknown>
    const p = int(r.p), s = int(r.s), l = int(r.l)
    const id = typeof r.id === 'string' && r.id && r.id.length <= 64 && !seen.has(r.id) ? r.id : `n${seen.size}-${p}-${s}`
    if (p === null || s === null || l === null || l < 1) continue
    const before = notes
    notes = addNote(notes, { id, p, s, l, v: typeof r.v === 'number' && Number.isFinite(r.v) ? r.v : 0.8 }, total)
    if (notes !== before) seen.add(id)
  }
  return [...notes]
}
const FILE_RE = /^[A-Za-z0-9-]{8,80}$/
/** 音频段验值：档编号不合 ⇒ 丢（整条当乐器轨读）；名字截 120 字；秒数夹 0～2 小时 */
export function parseClip(v: unknown): AudioClip | undefined {
  if (!v || typeof v !== 'object') return undefined
  const o = v as Record<string, unknown>
  if (typeof o.file !== 'string' || !FILE_RE.test(o.file)) return undefined
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0)
  const driveId = typeof o.driveId === 'string' && DRIVE_ID_RE.test(o.driveId) ? o.driveId : undefined
  const url = typeof o.url === 'string' && o.url.length <= 2000 && /^https:\/\//.test(o.url) ? o.url : undefined
  return { file: o.file, name: typeof o.name === 'string' ? o.name.slice(0, 120) : '', dur: clamp(num(o.dur), 0, 7200), at: clamp(num(o.at), 0, 7200), ...(driveId && url ? { driveId, url } : {}) }
}
const DRIVE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** 这个档传上云盘了：用这个档的音频音轨都记上云盘编号与网址；都记过了 ⇒ 原物件 */
export function tracksWithDrive(tracks: readonly ArrTrack[], file: string, d: { driveId: string; url: string }): ArrTrack[] {
  let hit = false
  const out = tracks.map((x) => {
    if (!x.audio || x.audio.file !== file || (x.audio.driveId === d.driveId && x.audio.url === d.url)) return x
    hit = true
    return { ...x, audio: { ...x.audio, driveId: d.driveId, url: d.url } }
  })
  return hit ? out : (tracks as ArrTrack[])
}
export function setClipDrive(a: Arrangement, file: string, d: { driveId: string; url: string }): Arrangement {
  const tracks = tracksWithDrive(a.tracks, file, d)
  return tracks === a.tracks ? a : { ...a, tracks }
}
const isInst = (x: unknown): x is InstrumentId => INSTRUMENTS.some((i) => i.id === x)
/** 读档验值：坏值丢掉·夹进范围；旧档（只有一串钢琴音符）⇒ 放进钢琴那条、另补一条笛子；一条音轨都没有 ⇒ 预设两条 */
export function parseArrangement(raw: unknown): Arrangement {
  let v = raw
  if (typeof v === 'string') { try { v = JSON.parse(v) } catch { return emptyArrangement() } }
  if (!v || typeof v !== 'object') return emptyArrangement()
  const o = v as Record<string, unknown>
  const bpm = clamp(int(o.bpm) ?? BPM_DEFAULT, BPM_MIN, BPM_MAX)
  const barsIn = int(o.bars) ?? BARS_DEFAULT
  const bars = (BARS_CHOICES as readonly number[]).includes(barsIn) ? barsIn : BARS_DEFAULT
  const total = bars * STEPS_PER_BAR
  const seen = new Set<string>()
  const ids = new Set<string>()
  let tracks: ArrTrack[] = []
  if (Array.isArray(o.tracks)) {
    for (const x of o.tracks) {
      if (!x || typeof x !== 'object' || tracks.length >= MAX_TRACKS) continue
      const r = x as Record<string, unknown>
      const id = typeof r.id === 'string' && r.id && r.id.length <= 64 && !ids.has(r.id) ? r.id : `t${tracks.length}`
      if (ids.has(id)) continue
      ids.add(id)
      const vol = typeof r.vol === 'number' && Number.isFinite(r.vol) ? clamp(r.vol, 0, 1) : VOL_DEFAULT
      const audio = parseClip(r.audio)
      if (audio) tracks.push({ id, inst: isInst(r.inst) ? r.inst : 'piano', vol, mute: r.mute === true, solo: r.solo === true, notes: [], audio, ...(Array.isArray(r.pieces) ? { pieces: parsePieces(r.pieces, audio) } : {}) })
      else {
        const cov = coverNotes(parseParts(r.parts, total), parseNotes(r.notes, total, seen), total)
        tracks.push({ id, inst: isInst(r.inst) ? r.inst : 'piano', vol, mute: r.mute === true, solo: r.solo === true, notes: cov.notes, parts: cov.parts })
      }
    }
  } else if (Array.isArray(o.notes)) {
    tracks = defaultTracks()
    const cov = coverNotes([], parseNotes(o.notes, total, seen), total)
    tracks[0] = { ...tracks[0], notes: cov.notes, parts: cov.parts }
  }
  if (!tracks.length) tracks = defaultTracks()
  const sel = typeof o.sel === 'string' && tracks.some((x) => x.id === o.sel) ? o.sel : tracks[0].id
  return { v: 2, bpm, bars, key: parseKeySig(o.key), tracks, sel }
}

// ── 音轨 ──
export const selectedTrack = (a: Pick<Arrangement, 'tracks' | 'sel'>): ArrTrack => a.tracks.find((x) => x.id === a.sel) ?? a.tracks[0]
export const noteCount = (a: Pick<Arrangement, 'tracks'>) => a.tracks.reduce((n, x) => n + x.notes.length, 0)
/** 换掉某条音轨的音符（没变／音频音轨 ⇒ 原物件） */
export function setTrackNotes(a: Arrangement, id: string, notes: readonly Note[]): Arrangement {
  const tr = a.tracks.find((x) => x.id === id)
  if (!tr || tr.notes === notes || tr.audio) return a
  const cov = coverNotes(tr.parts ?? [], notes, totalSteps(a))
  return { ...a, tracks: a.tracks.map((x) => (x.id === id ? { ...x, notes: cov.notes, parts: cov.parts } : x)) }
}
export type TrackPatch = { inst?: InstrumentId; vol?: number; mute?: boolean; solo?: boolean }
export function patchTrack(a: Arrangement, id: string, p: TrackPatch): Arrangement {
  if (!a.tracks.some((x) => x.id === id)) return a
  return { ...a, tracks: a.tracks.map((x) => (x.id !== id ? x : {
    ...x,
    ...(p.inst && isInst(p.inst) ? { inst: p.inst } : {}),
    ...(typeof p.vol === 'number' && Number.isFinite(p.vol) ? { vol: clamp(p.vol, 0, 1) } : {}),
    ...(typeof p.mute === 'boolean' ? { mute: p.mute } : {}),
    ...(typeof p.solo === 'boolean' ? { solo: p.solo } : {}),
  })) }
}
/** 加一条音轨（放在最下面·选中它）；满了 ⇒ 原物件 */
export function addTrack(a: Arrangement, inst: InstrumentId, id: string): Arrangement {
  if (a.tracks.length >= MAX_TRACKS || a.tracks.some((x) => x.id === id)) return a
  return { ...a, tracks: [...a.tracks, newTrack(id, inst)], sel: id }
}
/** 选中的是音频音轨（没有音符可录）⇒ 改选第一条乐器音轨·一条都没有就加一条钢琴；音轨满了加不了 ⇒ null */
export function recTarget(a: Arrangement, newId: string): Arrangement | null {
  if (!selectedTrack(a).audio) return a
  const inst = a.tracks.find((x) => !x.audio)
  if (inst) return { ...a, sel: inst.id }
  const b = addTrack(a, 'piano', newId)
  return b === a ? null : b
}
/** 加一条音频音轨（放在最下面·选中它）；满了 ⇒ 原物件 */
export function addAudioTrack(a: Arrangement, id: string, clip: AudioClip): Arrangement {
  if (a.tracks.length >= MAX_TRACKS || a.tracks.some((x) => x.id === id)) return a
  return { ...a, tracks: [...a.tracks, { ...newTrack(id, 'piano'), audio: { ...clip } }], sel: id }
}
/** 放得下这段声音要几小节（照现在的速度·挑最小够长的；最长那档也放不下 ⇒ 最长那档）·只增不减 */
export function barsToFit(sec: number, bpm: number, now: number): number {
  const need = sec / (stepSec(bpm) * STEPS_PER_BAR)
  const fit = BARS_CHOICES.find((b) => b >= need - 1e-9) ?? BARS_CHOICES[BARS_CHOICES.length - 1]
  return Math.max(now, fit)
}
/** 从曲子第 songSec 秒起放这段声音：何时开始（相对现在·秒）、从档里第几秒放、放多久（放到曲尾 songEnd 为止）；这段已经放完 ⇒ null */
export function clipPlan(c: Pick<AudioClip, 'at' | 'dur'>, songSec: number, songEnd: number): { delay: number; offset: number; len: number } | null {
  const end = Math.min(c.at + c.dur, songEnd)
  if (songSec >= end) return null
  const delay = Math.max(0, c.at - songSec)
  const offset = Math.max(0, songSec - c.at)
  const len = end - Math.max(songSec, c.at)
  return len > 0.001 ? { delay, offset, len } : null
}
/** 删一条音轨（至少留一条）；删的是选中那条 ⇒ 改选它下面那条（没有就上面那条） */
export function removeTrack(a: Arrangement, id: string): Arrangement {
  const i = a.tracks.findIndex((x) => x.id === id)
  if (i < 0 || a.tracks.length <= 1) return a
  const tracks = a.tracks.filter((x) => x.id !== id)
  return { ...a, tracks, sel: a.sel === id ? tracks[Math.min(i, tracks.length - 1)].id : a.sel }
}
/** 听得到的音轨：有任一条独奏 ⇒ 只放独奏的（独奏又静音的不放）；否则放没静音的 */
export function audibleTracks(a: Pick<Arrangement, 'tracks'>): ArrTrack[] {
  const solo = a.tracks.some((x) => x.solo)
  return a.tracks.filter((x) => !x.mute && (!solo || x.solo))
}
/** 小节变少：每条都截 */
export function fitBarsAll(a: Arrangement, bars: number): Arrangement {
  const total = bars * STEPS_PER_BAR
  return { ...a, bars, tracks: a.tracks.map((x) => {
    if (x.audio) return x
    const notes = fitBars(x.notes, total)
    const parts = (x.parts ?? []).filter((p) => p.s < total).map((p) => (p.s + p.l > total ? { ...p, l: total - p.s } : p))
    const cov = coverNotes(parts, notes, total)
    return { ...x, notes: cov.notes, parts: cov.parts }
  }) }
}

/** 这段时间（格子 [from, to)）要开始响的音符（播放排程用） */
export const notesStarting = (notes: readonly Note[], from: number, to: number) => notes.filter((n) => n.s >= from && n.s < to)

// ── 钢琴音色（自己调的·不用外部音色档）：几个泛音叠起来、敲下去马上最响再慢慢衰减；低音拖得长、高音短；高泛音衰减更快 ──
export type Overtone = { ratio: number; gain: number; decay: number }
export type PianoVoice = { freq: number; partials: Overtone[]; attack: number; release: number; cutoff0: number; cutoff1: number; hammer: number }
const PARTIALS: ReadonlyArray<[number, number]> = [[1, 1], [2, 0.42], [3, 0.2], [4, 0.11], [5, 0.06], [6, 0.035], [7, 0.02]]
/** 琴弦有点硬 ⇒ 高泛音比整数倍略高（B＝不谐和系数） */
const INHARM = 0.00035
export function pianoVoice(p: number, vel = 0.8): PianoVoice {
  const freq = midiFreq(p)
  const v = clamp(vel, 0.05, 1)
  const base = clamp(4.2 - (p - 36) * 0.06, 0.5, 4.2) // 秒·低音长高音短
  const bright = 0.6 + 0.4 * v // 弹越重越亮
  const partials = PARTIALS
    .map(([k, g]) => ({ ratio: k * Math.sqrt(1 + INHARM * k * k), gain: g * (k === 1 ? 1 : bright) * (p > 84 ? 0.6 : 1), decay: base / k ** 0.7 }))
    .filter((x) => freq * x.ratio < 16000)
  return { freq, partials, attack: 0.004, release: 0.18, cutoff0: Math.min(16000, freq * (6 + 10 * v)), cutoff1: Math.min(12000, freq * 3), hammer: 0.06 * v }
}

// ── 笛子音色：几乎只有基音、泛音很弱；气慢慢吹起来（起音比钢琴慢）、按着就一直响（不衰减）、带一点气声、吹一会儿才开始颤音 ──
export type FluteVoice = { freq: number; partials: Array<{ ratio: number; gain: number }>; attack: number; sustain: number; release: number; cutoff: number; breath: number; vibratoHz: number; vibratoDepth: number; vibratoDelay: number }
export function fluteVoice(p: number, vel = 0.8): FluteVoice {
  const freq = midiFreq(p)
  const v = clamp(vel, 0.05, 1)
  const partials = ([[1, 1], [2, 0.22 + 0.1 * v], [3, 0.08], [4, 0.03]] as const)
    .map(([ratio, gain]) => ({ ratio, gain }))
    .filter((x) => freq * x.ratio < 16000)
  return { freq, partials, attack: clamp(0.09 - (p - 60) * 0.001, 0.04, 0.12), sustain: 0.82, release: 0.12, cutoff: Math.min(14000, freq * 5), breath: 0.05 + 0.04 * v, vibratoHz: 5.2, vibratoDepth: 0.004, vibratoDelay: 0.25 }
}

// ── WAV（16 位 PCM·小端）·汇出成音频片段用 ──
export { encodeWav } from './wav'
/** 汇出的档名：编曲-月日-时分.wav（多乐器·不再叫钢琴编曲） */
export function exportName(lang: ArrLang, d: Date, ext: 'wav' | 'json' = 'wav'): string {
  const p2 = (n: number) => String(n).padStart(2, '0')
  const head = lang === 'en' ? 'arrangement' : lang === 'tw' ? '編曲' : '编曲'
  return `${head}-${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}.${ext}`
}
/** 汇出的长度：听得到的音轨里最后一个音符放完再留余音（最多到曲尾＋2 秒）；没音符 ⇒ 0 */
/** 合成素材时每条有内容、听得到的音轨各算一份（编号与名字·同名的照第几条编号）；只有一条 ⇒ 空（不另出分轨） */
export function stemTracks(a: Pick<Arrangement, 'tracks'>, labelOf: (tr: ArrTrack) => string): Array<{ id: string; label: string }> {
  const live = audibleTracks(a).filter((x) => (x.audio ? piecesOf(x).length > 0 : x.notes.length > 0))
  if (live.length < 2) return []
  const seen = new Map<string, number>()
  return live.map((x) => {
    const base = labelOf(x)
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    return { id: x.id, label: n > 1 ? `${base} ${n}` : base }
  })
}
/** 只留这一条音轨的编曲（算分轨用·不静音不独奏·时间位置不动） */
export function trackArrangement(a: Arrangement, trackId: string): Arrangement | null {
  const tr = a.tracks.find((x) => x.id === trackId)
  return tr ? { ...a, tracks: [{ ...tr, mute: false, solo: false }], sel: tr.id } : null
}
export function renderSeconds(a: Pick<Arrangement, 'bars' | 'bpm' | 'tracks'>): number {
  const aud = audibleTracks(a)
  const notes = aud.flatMap((x) => x.notes)
  const clips = aud.flatMap((x) => piecesOf(x).map((pc) => ({ at: pc.at, dur: pc.len })))
  if (!notes.length && !clips.length) return 0
  const st = stepSec(a.bpm)
  const song = arrangeSeconds(a)
  const lastNote = notes.length ? Math.min(song + 2, Math.max(...notes.map((n) => (n.s + n.l) * st)) + 1.5) : 0
  // 音频段放到曲尾就停（同播放）
  const lastClip = clips.length ? Math.max(...clips.map((c) => Math.min(c.at + c.dur, song))) : 0
  return Math.max(lastNote, lastClip)
}
export const VEDIT_ARRANGE_KEY = 'vedit-arrange-v1'

// ═══ 片段（·
// ）═══
// 段在同一条音轨上不重叠；挪、拉都夹在前后两段之间。乐器轨的段一律整格；音频轨的段用秒（换速度不会把声音拉长缩短）。
export const PIECE_MIN = 0.05
const barFloor = (s: number) => Math.floor(s / STEPS_PER_BAR) * STEPS_PER_BAR
const barCeil = (s: number) => Math.ceil(s / STEPS_PER_BAR) * STEPS_PER_BAR
const byS = <T extends { s: number }>(xs: T[]) => xs.sort((a, b) => a.s - b.s)
const freshId = (taken: ReadonlySet<string>, head: string) => { let i = 0; while (taken.has(`${head}${i ? `-${i}` : ''}`)) i++; return `${head}${i ? `-${i}` : ''}` }
/** 这个音符归哪一段（开头落在段里） */
export const partOfNote = (parts: readonly Part[], n: Pick<Note, 's'>) => parts.find((p) => n.s >= p.s && n.s < p.s + p.l) ?? null

function parseParts(raw: unknown, total: number): Part[] {
  const out: Part[] = []
  const ids = new Set<string>()
  for (const x of Array.isArray(raw) ? raw : []) {
    if (!x || typeof x !== 'object') continue
    const r = x as Record<string, unknown>
    const s = int(r.s), l = int(r.l)
    if (s === null || l === null || l < 1 || s < 0 || s >= total) continue
    const id = typeof r.id === 'string' && r.id && r.id.length <= 64 && !ids.has(r.id) ? r.id : freshId(ids, `pt${s}`)
    ids.add(id)
    out.push({ id, s, l: Math.min(l, total - s) })
  }
  return out
}
/** 音频段验值：夹进档长；一段都不合 ⇒ 空（这条没声音）·没给 pieces 的旧档另走 piecesOf 的缺省整段 */
function parsePieces(raw: unknown, c: AudioClip): AudioPiece[] {
  const out: AudioPiece[] = []
  const ids = new Set<string>()
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null)
  for (const x of Array.isArray(raw) ? raw : []) {
    if (!x || typeof x !== 'object') continue
    const r = x as Record<string, unknown>
    const at = num(r.at), off = num(r.off), len = num(r.len)
    if (at === null || off === null || len === null || at < 0 || off < 0 || off >= c.dur) continue
    const l = Math.min(len, c.dur - off)
    if (l < PIECE_MIN) continue
    const id = typeof r.id === 'string' && r.id && r.id.length <= 64 && !ids.has(r.id) ? r.id : freshId(ids, 'pc')
    ids.add(id)
    out.push({ id, at: Math.min(at, 7200), off, len: l })
  }
  out.sort((a, b) => a.at - b.at)
  return out.filter((p, i) => i === 0 || p.at >= out[i - 1].at + out[i - 1].len - 1e-9)
}
/** 音频轨的段（旧档没有 pieces ⇒ 整个档一段·从 audio.at 开始） */
export function piecesOf(tr: Pick<ArrTrack, 'audio' | 'pieces'>): AudioPiece[] {
  if (!tr.audio) return []
  if (tr.pieces) return tr.pieces
  return tr.audio.dur > 0 ? [{ id: 'pc', at: tr.audio.at, off: 0, len: tr.audio.dur }] : []
}
/** 段从曲子第 songSec 秒起怎么放（同 clipPlan·多了从档里第 off 秒放起） */
export function piecePlan(pc: AudioPiece, songSec: number, songEnd: number): { delay: number; offset: number; len: number } | null {
  const end = Math.min(pc.at + pc.len, songEnd)
  if (songSec >= end) return null
  const len = end - Math.max(songSec, pc.at)
  return len > 0.001 ? { delay: Math.max(0, pc.at - songSec), offset: pc.off + Math.max(0, songSec - pc.at), len } : null
}

/** 乐器轨的段要盖住所有音符：开头没落在段里的音符 ⇒ 前一段尾巴碰得到（同一小节以内）就把它撑过来·否则在空档里补一段（对齐小节·不盖到别段）；
 *  音符尾巴超出段尾 ⇒ 段往后撑到那一小节结束（撑不了就截短音符）。录音一小节一小节落进来会接成同一段·中间空一整小节以上才另起一段 */
export function coverNotes(parts0: readonly Part[], notes: readonly Note[], total: number): { parts: Part[]; notes: Note[] } {
  let ps = byS(parts0.filter((p) => p.l >= 1 && p.s >= 0 && p.s < total).map((p) => ({ ...p, l: Math.min(p.l, total - p.s) })))
  ps = ps.filter((p, i) => i === 0 || p.s >= ps[i - 1].s + ps[i - 1].l)
  const ids = new Set(ps.map((p) => p.id))
  const ns = [...notes].sort((a, b) => a.s - b.s || a.p - b.p)
  for (const n of ns) {
    if (partOfNote(ps, n)) continue
    let pi = -1
    for (let i = 0; i < ps.length; i++) if (ps[i].s <= n.s) pi = i
    const next = ps.find((p) => p.s > n.s)
    const nextStart = next ? next.s : total
    const want = Math.min(nextStart, Math.max(barCeil(n.s + n.l), n.s + 1))
    const prev = pi >= 0 ? ps[pi] : null
    if (prev && prev.s + prev.l >= barFloor(n.s)) ps[pi] = { ...prev, l: want - prev.s }
    else {
      const prevEnd = prev ? prev.s + prev.l : 0
      const s = Math.max(prevEnd, barFloor(n.s))
      const id = freshId(ids, `pt${s}`)
      ids.add(id)
      ps = byS([...ps, { id, s, l: want - s }])
    }
  }
  const out: Note[] = []
  for (const n of ns) {
    const i = ps.findIndex((p) => n.s >= p.s && n.s < p.s + p.l)
    if (i < 0) continue
    const end = ps[i].s + ps[i].l
    if (n.s + n.l > end) {
      const want = Math.min(i + 1 < ps.length ? ps[i + 1].s : total, barCeil(n.s + n.l))
      if (want > end) ps[i] = { ...ps[i], l: want - ps[i].s }
      const e2 = ps[i].s + ps[i].l
      out.push(n.s + n.l > e2 ? { ...n, l: e2 - n.s } : n)
    } else out.push(n)
  }
  return { parts: ps, notes: out }
}

/** 段在画面上的样子（格·音频段可带小数） */
export type Seg = { id: string; s: number; l: number }
export function segsOf(tr: ArrTrack, bpm: number): Seg[] {
  if (tr.audio) { const st = stepSec(bpm); return piecesOf(tr).map((p) => ({ id: p.id, s: p.at / st, l: p.len / st })) }
  return (tr.parts ?? []).map((p) => ({ ...p }))
}
/** 第 s 格压着的那一段 */
export const segAt = (tr: ArrTrack, bpm: number, s: number): Seg | null => segsOf(tr, bpm).find((g) => s >= g.s && s < g.s + g.l) ?? null
/** 前一段的尾巴、后一段的开头（单位同 xs） */
function room(xs: ReadonlyArray<{ id: string; s: number; l: number }>, id: string): { lo: number; hi: number } {
  const me = xs.find((x) => x.id === id)!
  let lo = 0, hi = Infinity
  for (const x of xs) {
    if (x.id === id) continue
    if (x.s + x.l <= me.s + 1e-9) lo = Math.max(lo, x.s + x.l)
    else if (x.s >= me.s + me.l - 1e-9) hi = Math.min(hi, x.s)
  }
  return { lo, hi }
}
const putTrack = (a: Arrangement, tr: ArrTrack): Arrangement => ({ ...a, tracks: a.tracks.map((x) => (x.id === tr.id ? tr : x)) })
const pieceSegs = (ps: readonly AudioPiece[]) => ps.map((p) => ({ id: p.id, s: p.at, l: p.len }))

/** 同轨拖动：段的开头挪到第 toS 格（夹在前后两段之间·不出曲子）；乐器段的音符一起挪；没变 ⇒ 原物件 */
export function moveSeg(a: Arrangement, trackId: string, segId: string, toS: number): Arrangement {
  const tr = a.tracks.find((x) => x.id === trackId)
  if (!tr) return a
  if (tr.audio) {
    const ps = piecesOf(tr), me = ps.find((p) => p.id === segId)
    if (!me) return a
    const { lo, hi } = room(pieceSegs(ps), segId)
    const songEnd = arrangeSeconds(a)
    const at = clamp(toS * stepSec(a.bpm), lo, Math.max(lo, Math.min(hi - me.len, songEnd - PIECE_MIN)))
    if (Math.abs(at - me.at) < 1e-9 || at + me.len > hi + 1e-9) return a
    return putTrack(a, { ...tr, pieces: ps.map((p) => (p.id === segId ? { ...p, at } : p)) })
  }
  const parts = tr.parts ?? [], me = parts.find((p) => p.id === segId)
  if (!me) return a
  const { lo, hi } = room(parts, segId)
  const s = clamp(Math.round(toS), lo, Math.min(hi, totalSteps(a)) - me.l)
  if (s === me.s || s < lo) return a
  const ds = s - me.s
  return putTrack(a, { ...tr, parts: parts.map((p) => (p.id === segId ? { ...p, s } : p)), notes: sortNotes(tr.notes.map((n) => (n.s >= me.s && n.s < me.s + me.l ? { ...n, s: n.s + ds } : n))) })
}
/** 拉两端（side 'l' 拉开头·'r' 拉尾巴·to＝那一端想到的格）：乐器段裁掉的音符拿掉、跨边界的截短；音频段裁到哪就从档里那一秒放（拉不过档头档尾）；没变 ⇒ 原物件 */
export function trimSeg(a: Arrangement, trackId: string, segId: string, side: 'l' | 'r', to: number): Arrangement {
  const tr = a.tracks.find((x) => x.id === trackId)
  if (!tr) return a
  if (tr.audio) {
    const ps = piecesOf(tr), me = ps.find((p) => p.id === segId)
    if (!me) return a
    const { lo, hi } = room(pieceSegs(ps), segId)
    const x = to * stepSec(a.bpm), end = me.at + me.len
    let next: AudioPiece
    if (side === 'l') {
      const at = clamp(x, Math.max(lo, me.at - me.off, 0), end - PIECE_MIN)
      next = { ...me, at, off: me.off + (at - me.at), len: end - at }
    } else {
      const e = clamp(x, me.at + PIECE_MIN, Math.min(hi, me.at + (tr.audio.dur - me.off)))
      next = { ...me, len: e - me.at }
    }
    if (Math.abs(next.at - me.at) < 1e-9 && Math.abs(next.len - me.len) < 1e-9) return a
    return putTrack(a, { ...tr, pieces: ps.map((p) => (p.id === segId ? next : p)) })
  }
  const parts = tr.parts ?? [], me = parts.find((p) => p.id === segId)
  if (!me) return a
  const { lo, hi } = room(parts, segId)
  const end = me.s + me.l
  const inMe = (n: Note) => n.s >= me.s && n.s < end
  if (side === 'l') {
    const s = clamp(Math.round(to), lo, end - 1)
    if (s === me.s) return a
    const notes = tr.notes.flatMap((n) => (!inMe(n) || n.s >= s ? [n] : n.s + n.l <= s ? [] : [{ ...n, s, l: n.s + n.l - s }]))
    return putTrack(a, { ...tr, parts: parts.map((p) => (p.id === segId ? { ...p, s, l: end - s } : p)), notes: sortNotes(notes) })
  }
  const e = clamp(Math.round(to), me.s + 1, Math.min(hi, totalSteps(a)))
  if (e === end) return a
  const notes = tr.notes.flatMap((n) => (!inMe(n) ? [n] : n.s >= e ? [] : n.s + n.l > e ? [{ ...n, l: e - n.s }] : [n]))
  return putTrack(a, { ...tr, parts: parts.map((p) => (p.id === segId ? { ...p, l: e - p.s } : p)), notes })
}
/** 在第 at 格裁成两段（Ctrl+B／裁刀）：后一段用 newId；乐器段跨刀口的音符也切成两个；刀口不在段里头 ⇒ 原物件 */
export function splitSeg(a: Arrangement, trackId: string, segId: string, at: number, newId: () => string): Arrangement {
  const tr = a.tracks.find((x) => x.id === trackId)
  if (!tr) return a
  if (tr.audio) {
    const ps = piecesOf(tr), me = ps.find((p) => p.id === segId)
    const x = at * stepSec(a.bpm)
    if (!me || x <= me.at + PIECE_MIN || x >= me.at + me.len - PIECE_MIN) return a
    const right: AudioPiece = { id: newId(), at: x, off: me.off + (x - me.at), len: me.at + me.len - x }
    return putTrack(a, { ...tr, pieces: ps.flatMap((p) => (p.id === segId ? [{ ...p, len: x - p.at }, right] : [p])) })
  }
  const parts = tr.parts ?? [], me = parts.find((p) => p.id === segId)
  const k = Math.round(at)
  if (!me || k <= me.s || k >= me.s + me.l) return a
  const notes = tr.notes.flatMap((n) => (n.s < k && n.s + n.l > k ? [{ ...n, l: k - n.s }, { ...n, id: newId(), s: k, l: n.s + n.l - k }] : [n]))
  return putTrack(a, { ...tr, parts: parts.flatMap((p) => (p.id === segId ? [{ ...p, l: k - p.s }, { id: newId(), s: k, l: p.s + p.l - k }] : [p])), notes: sortNotes(notes) })
}
/** 删段（乐器段连音符一起删）；音频轨删光了还留着这条轨（没声音） */
export function removeSegs(a: Arrangement, trackId: string, ids: readonly string[]): Arrangement {
  const tr = a.tracks.find((x) => x.id === trackId)
  if (!tr || !ids.length) return a
  const del = new Set(ids)
  if (tr.audio) {
    const ps = piecesOf(tr)
    return ps.some((p) => del.has(p.id)) ? putTrack(a, { ...tr, pieces: ps.filter((p) => !del.has(p.id)) }) : a
  }
  const parts = tr.parts ?? []
  const gone = parts.filter((p) => del.has(p.id))
  if (!gone.length) return a
  return putTrack(a, { ...tr, parts: parts.filter((p) => !del.has(p.id)), notes: tr.notes.filter((n) => !partOfNote(gone, n)) })
}
/** 复制下来的一段（贴上时用）：乐器段＝相对开头的音符；音频段＝档与那一截 */
export type SegCopy =
  | { kind: 'notes'; inst: InstrumentId; l: number; notes: Array<Omit<Note, 'id'>> }
  | { kind: 'audio'; clip: AudioClip; off: number; len: number }
export function copySeg(a: Arrangement, trackId: string, segId: string): SegCopy | null {
  const tr = a.tracks.find((x) => x.id === trackId)
  if (!tr) return null
  if (tr.audio) { const p = piecesOf(tr).find((x) => x.id === segId); return p ? { kind: 'audio', clip: { ...tr.audio }, off: p.off, len: p.len } : null }
  const p = (tr.parts ?? []).find((x) => x.id === segId)
  if (!p) return null
  return { kind: 'notes', inst: tr.inst, l: p.l, notes: tr.notes.filter((n) => n.s >= p.s && n.s < p.s + p.l).map(({ id: _id, ...n }) => { void _id; return { ...n, s: n.s - p.s } }) }
}
/** 从第 at 格起找第一个放得下 len 长的空位（单位同 xs）；放不下 ⇒ null */
function firstFree(xs: ReadonlyArray<{ s: number; l: number }>, at: number, len: number, end: number): number | null {
  let s = Math.max(0, at)
  for (const x of [...xs].sort((p, q) => p.s - q.s)) if (x.s < s + len - 1e-9 && x.s + x.l > s + 1e-9) s = x.s + x.l
  return s + len <= end + 1e-9 ? s : null
}
/** 贴上：从第 at 格起找空位放（撞到别段就往后找）；乐器段只贴进乐器轨、音频段只贴进同一个档的音频轨；放不下或种类不合 ⇒ null */
export function pasteSeg(a: Arrangement, trackId: string, c: SegCopy, at: number, newId: () => string): { arr: Arrangement; segId: string } | null {
  const tr = a.tracks.find((x) => x.id === trackId)
  if (!tr) return null
  const id = newId()
  if (c.kind === 'audio') {
    if (!tr.audio || tr.audio.file !== c.clip.file) return null
    const ps = piecesOf(tr)
    const s = firstFree(pieceSegs(ps), at * stepSec(a.bpm), c.len, arrangeSeconds(a) - PIECE_MIN + c.len)
    if (s === null) return null
    return { arr: putTrack(a, { ...tr, pieces: [...ps, { id, at: s, off: c.off, len: c.len }].sort((p, q) => p.at - q.at) }), segId: id }
  }
  if (tr.audio) return null
  const parts = tr.parts ?? []
  const s = firstFree(parts, Math.round(at), c.l, totalSteps(a))
  if (s === null) return null
  const notes = [...tr.notes, ...c.notes.map((n) => ({ ...n, id: newId(), s: n.s + s }))]
  return { arr: putTrack(a, { ...tr, parts: byS([...parts, { id, s, l: c.l }]), notes: sortNotes(notes) }), segId: id }
}
// ── ──
/** 一趟录音（按一次录音钮）：part＝这趟自己那一段的编号；from＝从第几格开录；ids＝这趟录进来的音符 */
/** to＝录到第几格 */
export type RecTake = { track: string; part: string; from: number; ids: ReadonlySet<string>; to?: number }
/** 把录好的音符换上去·这趟的音符自成一段：从开录那格（最多往前对齐到第一个音所在小节头）到最后一个音所在小节尾；
 *  别段压到这个范围的那截让出来（左边那截留原编号·右边那截另起编号·范围里原有的音符归这趟这段）；这趟还没音符 ⇒ 跟一般改音符一样 */
export function recordTake(a: Arrangement, notes: readonly Note[], take: RecTake): Arrangement {
  const tr = a.tracks.find((x) => x.id === take.track)
  if (!tr || tr.audio) return a
  const mine = notes.filter((n) => take.ids.has(n.id))
  if (!mine.length) return setTrackNotes(a, tr.id, notes)
  const total = totalSteps(a)
  const lo = Math.min(...mine.map((n) => n.s))
  const live = take.to !== undefined
  const s = Math.max(0, live ? Math.min(lo, take.from) : Math.min(lo, Math.max(take.from, barFloor(lo))))
  const e = Math.min(total, live ? Math.max(Math.ceil(take.to!), ...mine.map((n) => n.s + Math.max(1, n.l))) : Math.max(...mine.map((n) => Math.max(barCeil(n.s + n.l), n.s + 1))))
  const ids = new Set((tr.parts ?? []).map((p) => p.id))
  const parts: Part[] = []
  for (const p of tr.parts ?? []) {
    if (p.id === take.part) continue
    const pe = p.s + p.l
    if (pe <= s || p.s >= e) { parts.push(p); continue }
    if (p.s < s) parts.push({ ...p, l: s - p.s })
    if (pe > e) { const id = freshId(ids, `${p.id}-r`); ids.add(id); parts.push({ id, s: e, l: pe - e }) }
  }
  const cov = coverNotes([...parts, { id: take.part, s, l: e - s }], notes, total)
  return putTrack(a, { ...tr, notes: cov.notes, parts: cov.parts })
}
/** 合并得了吗：同一条音轨上至少两段 */
export function canMergeSegs(a: Pick<Arrangement, 'tracks'>, trackId: string, ids: readonly string[]): boolean {
  const tr = a.tracks.find((x) => x.id === trackId)
  if (!tr) return false
  const have = new Set((tr.audio ? piecesOf(tr) : tr.parts ?? []).map((p) => p.id))
  return new Set(ids.filter((id) => have.has(id))).size >= 2
}
/** 乐器段合并：从最前那段开头到最后那段结尾成一段（编号用最前那段的）·中间夹着的段一起并进来·中间空的就是没音符；音符不动 */
export function mergeParts(a: Arrangement, trackId: string, ids: readonly string[]): Arrangement {
  const tr = a.tracks.find((x) => x.id === trackId)
  if (!tr || tr.audio || !canMergeSegs(a, trackId, ids)) return a
  const parts = tr.parts ?? []
  const pick = byS(parts.filter((p) => ids.includes(p.id)))
  const s = pick[0].s, e = Math.max(...pick.map((p) => p.s + p.l))
  const rest = parts.filter((p) => p.s + p.l <= s || p.s >= e)
  return putTrack(a, { ...tr, parts: byS([...rest, { id: pick[0].id, s, l: e - s }]) })
}
/** 音频段合并要的范围（秒）：最前那段开头～最后那段结尾 */
export function mergeSpan(tr: Pick<ArrTrack, 'audio' | 'pieces'>, ids: readonly string[]): { lo: number; hi: number } | null {
  const pick = piecesOf(tr).filter((p) => ids.includes(p.id))
  if (pick.length < 2) return null
  return { lo: Math.min(...pick.map((p) => p.at)), hi: Math.max(...pick.map((p) => p.at + p.len)) }
}
/** 音频段合并：一段只能放档里连着的一截 ⇒ 先把这条轨照曲子时间重排成一个新档（每段放回它在曲子里的那几秒·段与段之间静音·见 layoutPieces）·
 *  换上新档后每段都从新档同一秒放起（off＝at）·选中那几段（连夹在中间的）并成一段；clip＝新档 */
export function mergeAudioPieces(a: Arrangement, trackId: string, ids: readonly string[], clip: AudioClip): Arrangement {
  const tr = a.tracks.find((x) => x.id === trackId)
  const span = tr ? mergeSpan(tr, ids) : null
  if (!tr || !tr.audio || !span) return a
  const ps = piecesOf(tr)
  const first = ps.filter((p) => ids.includes(p.id)).sort((p, q) => p.at - q.at)[0]
  const rest = ps.filter((p) => p.at + p.len <= span.lo + 1e-9 || p.at >= span.hi - 1e-9).map((p) => ({ ...p, off: p.at }))
  const pieces = [...rest, { id: first.id, at: span.lo, off: span.lo, len: span.hi - span.lo }].sort((p, q) => p.at - q.at)
  return putTrack(a, { ...tr, audio: { file: clip.file, name: clip.name, dur: clip.dur, at: 0 }, pieces })
}
/** 音频段合并后那份新档的档名：<原名>-合并.wav */
export const mergedFileName = (name: string, lang: ArrLang) => `${name.replace(/\.[^.]+$/, '') || 'audio'}-${lang === 'en' ? 'merged' : lang === 'tw' ? '合併' : '合并'}.wav`
/** 照曲子时间重排声音：每段把原档 [off, off+len) 那几秒放到新档 [at, at+len)·其余静音；回每个声道一条（长度＝最后一段结尾） */
export function layoutPieces(src: readonly Float32Array[], sampleRate: number, pieces: readonly AudioPiece[]): Float32Array[] {
  const end = Math.max(0, ...pieces.map((p) => p.at + p.len))
  const n = Math.max(1, Math.ceil(end * sampleRate))
  return src.map((ch) => {
    const out = new Float32Array(n)
    for (const p of pieces) {
      const from = Math.round(p.off * sampleRate), to = Math.round(p.at * sampleRate)
      const len = Math.min(Math.round(p.len * sampleRate), ch.length - from, n - to)
      if (len > 0 && from >= 0) out.set(ch.subarray(from, from + len), to)
    }
    return out
  })
}
/** 只留这一段的编曲（「添加到素材」汇出那一段用）：挪到曲子开头·只有这条音轨·不静音不独奏 */
export function segArrangement(a: Arrangement, trackId: string, segId: string): Arrangement | null {
  const tr = a.tracks.find((x) => x.id === trackId)
  if (!tr) return null
  const base = { ...tr, mute: false, solo: false }
  if (tr.audio) {
    const p = piecesOf(tr).find((x) => x.id === segId)
    return p ? { ...a, tracks: [{ ...base, pieces: [{ ...p, at: 0 }] }], sel: tr.id } : null
  }
  const p = (tr.parts ?? []).find((x) => x.id === segId)
  if (!p) return null
  const notes = tr.notes.filter((n) => n.s >= p.s && n.s < p.s + p.l).map((n) => ({ ...n, s: n.s - p.s }))
  return { ...a, tracks: [{ ...base, parts: [{ ...p, s: 0 }], notes }], sel: tr.id }
}
/** 「添加到素材」的档名：编曲片段-乐器-月日-时分.wav */
export function segExportName(lang: ArrLang, label: string, d: Date): string {
  const p2 = (n: number) => String(n).padStart(2, '0')
  const head = lang === 'en' ? 'clip' : lang === 'tw' ? '編曲片段' : '编曲片段'
  const safe = label.replace(/[\\/:*?"<>|]/g, '').slice(0, 40)
  return `${head}-${safe}-${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}.wav`
}
/** 左右键微调一步几格 */
export const nudgeStep = (snap: number, big: boolean) => (big ? STEPS_PER_BAR : Math.max(1, snap))

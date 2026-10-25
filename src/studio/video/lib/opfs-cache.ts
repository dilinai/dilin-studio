// 网页剪辑·素材的本机快取（浏览器 OPFS）：原档 o-<键>·剪辑用小预览档 p-<键>.mp4·声音波形 w-<键>.f32·上传的程序包。
// 判据全在 store.pure.ts·本档只做浏览器那几件事；不支持 OPFS 的浏览器一律回 null，页面照旧只用这次开页的暂时链接。
// · 预览档＝原档转成长边 960、每秒一个关键帧的 H.264（mediabunny·浏览器自带 WebCodecs）；判据在 codec.pure.ts；
//   画面解不开（HEVC 等）⇒ 回 undecodable·页面明说（⛔ 静默黑屏）。原档一直留着（汇出用原档）。
// · 各函数的 id 一律是快取键（store.pure mediaStoreKey·按内容）·⛔ 直接传素材编号（不同工程同名会互读）。
import { VEDIT_OPFS_DIR, isReadFail, quietSource, canStore, origName, peaksName, proxyName, thumbsName, PROXY_BITRATE, PROXY_KEYFRAME_SEC, type VeditMediaKind } from './store.pure'
import { proxyDecision, proxyRejectReason } from './codec.pure'
import { holdEncoderLatency } from './encoder-latency'
import { withTimeout } from './export.pure'
import { PEAKS_PER_SEC, accumulatePeaks } from './timeline.pure'
import { decodedProbe, type SoundProbe } from './sound-check.pure'

type Dir = FileSystemDirectoryHandle

let dirP: Promise<Dir | null> | null = null
/** 这一页的本机储存夹（读不到 ⇒ null·之后同一次开页不再试） */
export function veditDir(): Promise<Dir | null> {
  if (!dirP) {
    dirP = (async () => {
      try {
        if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) return null
        const root = await navigator.storage.getDirectory()
        // 请浏览器别在空间紧时自动清掉这一站的储存（不给也照样能存·只是可能被清）
        void navigator.storage.persist?.().catch(() => false)
        return await root.getDirectoryHandle(VEDIT_OPFS_DIR, { create: true })
      } catch { return null }
    })()
  }
  return dirP
}

export async function estimate(): Promise<{ quota?: number; usage?: number } | null> {
  try { return (await navigator.storage?.estimate?.()) ?? null } catch { return null }
}

/** 读一个档（没有 ⇒ null） */
export async function readStored(name: string): Promise<File | null> {
  const d = await veditDir()
  if (!d) return null
  try { return await (await d.getFileHandle(name)).getFile() } catch { return null }
}

async function removeStored(name: string): Promise<void> {
  const d = await veditDir()
  if (!d) return
  try { await d.removeEntry(name) } catch { /* 本来就没有 */ }
}

/** 写一个档：先写暂存名、写完才改成正式名（写到一半关页 ⇒ 下次读不到半截档） */
export async function writeStored(name: string, write: (w: FileSystemWritableFileStream) => Promise<void>): Promise<boolean> {
  const d = await veditDir()
  if (!d) return false
  const tmp = `${name}.part`
  try {
    const h = await d.getFileHandle(tmp, { create: true })
    const w = await h.createWritable()
    // mediabunny 的 StreamTarget 写完会自己 getWriter().close()（流仍被它锁着）⇒ 锁着就不再关
    try { await write(w); if (!w.locked) await w.close() } catch (e) { try { if (!w.locked) await w.abort() } catch { /* 已关 */ } throw e }
    const done = h as FileSystemFileHandle & { move?: (dir: Dir, name: string) => Promise<void> }
    if (typeof done.move === 'function') await done.move(d, name)
    else { // 不支持 move 的浏览器：再抄一遍
      const f = await h.getFile()
      const w2 = await (await d.getFileHandle(name, { create: true })).createWritable()
      await w2.write(f); await w2.close()
      await d.removeEntry(tmp)
    }
    return true
  } catch {
    await removeStored(tmp)
    return false
  }
}

/** 从电脑汇入的原档存一份进本机储存（空间不够／写不进 ⇒ false） */
export async function storeLocalOriginal(id: string, file: Blob): Promise<boolean> {
  if (!canStore(file.size, await estimate())) return false
  return writeStored(origName(id), (w) => w.write(file))
}



/** 这份素材在本机储存里的预览档（没有 ⇒ null） */
export const readProxy = (id: string) => readStored(proxyName(id))

/** 转预览档的结果：file＝预览档（没做 ⇒ null）；undecodable＝这个浏览器解不开这支影片的画面（转不了·页面要明说）；codec＝原档画面编码（mediabunny 名） */
export type ProxyResult = { file: File | null; undecodable?: boolean; codec?: string | null; /** 原档读不动了（被移走／改写／iCloud 没下载完）·页面换本机储存或云盘那份、都没有就明说 */ unreadable?: boolean }

/** 这份档案现在还读不读得动（读开头一小段·读不动 ⇒ true） */
export async function blobUnreadable(b: Blob): Promise<boolean> {
  try { await b.slice(0, Math.min(b.size, 64)).arrayBuffer(); return false } catch (e) { return isReadFail(e) || e instanceof DOMException }
}

/**（Safari「预览档转换中 0%」停住）：转档多久没进度就当编码器挂住 ⇒ 停掉这份、照放原档（⛔ 一直挂着——素材排的是同一条队·后面汇入的全卡）。题会把它改短。 */
export const PROXY_STALL = { ms: 30_000 }

/** 转预览档：原档 ⇒ p-<id>.mp4（H.264 8bit 4:2:0·长边 ≤960·每秒一个关键帧）。
 *  有声黑屏：不是「人人能放」的 H.264 ⇒ 不论大小一律转；解不开画面 ⇒ 回 undecodable（旧版这里静默回 null 照放原档 ⇒ 黑屏）；
 *  转档会丢画面轨 ⇒ 不做（⛔ 产出只有声音的预览档）。本来就小的 H.264／转不了 ⇒ file＝null；进度 0..1。 */
export async function makeProxy(id: string, kind: VeditMediaKind, src: File, duration: number, onProgress?: (p: number) => void, signal?: AbortSignal): Promise<ProxyResult> {
  if (kind !== 'video') return { file: null }
  const have = await readProxy(id)
  if (have) return { file: have }
  const mb = await import('mediabunny').catch(() => null)
  if (!mb) return { file: null }
  let readFail = false // 读档器后台预读读不动（原本漏成未处理拒绝）
  const input = new mb.Input({ source: new mb.BlobSource(src, quietSource((e) => { if (isReadFail(e)) readFail = true })), formats: mb.ALL_FORMATS })
  const dead = async () => readFail || (await blobUnreadable(src))
  try {
    const vt = await input.getPrimaryVideoTrack().catch(() => null)
    if (!vt) return { file: null, ...((await dead()) ? { unreadable: true } : {}) }
    const codec = vt.codec ?? null
    const canDecode = typeof VideoDecoder !== 'undefined' && (await vt.canDecode().catch(() => false))
    const decision = proxyDecision({
      codecString: await vt.getCodecParameterString().catch(() => null), canDecode,
      width: vt.displayWidth, height: vt.displayHeight, sizeBytes: src.size, duration,
    })
    if (decision.do === 'undecodable') return { file: null, undecodable: true, codec }
    if (decision.do === 'skip') return { file: null, codec }
    if (typeof VideoEncoder === 'undefined' || !(await veditDir()) || !canStore(src.size / 4, await estimate())) return { file: null, codec }
    const release = holdEncoderLatency(typeof navigator !== 'undefined' ? navigator.userAgent : '') // Safari H.264 走低延迟模式（vedit-encoder-latency）
    const ok = await writeStored(proxyName(id), async (w) => {
      const output = new mb.Output({ format: new mb.Mp4OutputFormat(), target: new mb.StreamTarget(w as unknown as WritableStream<{ type: 'write'; data: Uint8Array<ArrayBuffer>; position: number }>) })
      const conv = await mb.Conversion.init({
        input, output,
        video: { ...decision.size, codec: 'avc', bitrate: PROXY_BITRATE, keyFrameInterval: PROXY_KEYFRAME_SEC },
        // 声音照原样搬（能直接搬就不重编·AAC 编码器不是每个浏览器都有）；画面或声音搬不过去 ⇒ 不做这份预览档
      })
      if (!conv.isValid) throw new Error('proxy: unsupported')
      const reject = proxyRejectReason(conv.discardedTracks.map((d) => d.track.type))
      if (reject) throw new Error(`proxy: ${reject} would be dropped`)
      let lastP = -1, lastAt = Date.now(), watch: ReturnType<typeof setInterval> | undefined
      conv.onProgress = (p: number) => { if (p > lastP) { lastP = p; lastAt = Date.now() } onProgress?.(p) }
      const stop = () => { void conv.cancel() }
      signal?.addEventListener('abort', stop, { once: true })
      // 看门狗：PROXY_STALL.ms 没进度 ⇒ 取消（挂住的编码器 cancel 自己也可能不回·最多等 3 秒）·这份不做
      const stalled = new Promise<never>((_, rej) => {
        watch = setInterval(() => {
          if (Date.now() - lastAt < PROXY_STALL.ms) return
          clearInterval(watch)
          void withTimeout(conv.cancel().catch(() => {}), 3000, undefined)
          rej(Object.assign(new Error('proxy: encoder stalled'), { code: 'encoder_stalled' }))
        }, Math.min(1000, PROXY_STALL.ms / 4))
      })
      try { await Promise.race([conv.execute(), stalled]) } finally { clearInterval(watch); signal?.removeEventListener('abort', stop) }
    }).finally(release)
    return { file: ok ? await readProxy(id) : null, codec, ...(!ok && (await dead()) ? { unreadable: true } : {}) }
  } catch (e) { return { file: null, ...(isReadFail(e) || (await dead()) ? { unreadable: true } : {}) } } finally { input.dispose() }
}

/** 汇入时探声音轨（只读档头·不解整段）：结果见 sound-check.pure 的 SoundProbe */
export async function probeSound(src: Blob): Promise<SoundProbe> {
  if (typeof AudioDecoder === 'undefined') return 'unknown'
  const mb = await import('mediabunny').catch(() => null)
  if (!mb) return 'unknown'
  const input = new mb.Input({ source: new mb.BlobSource(src, quietSource()), formats: mb.ALL_FORMATS })
  try {
    const track = await input.getPrimaryAudioTrack().catch(() => null)
    if (!track) return (await blobUnreadable(src)) ? 'unknown' : 'none'
    return (await track.canDecode().catch(() => false)) ? 'ok' : 'undecodable'
  } catch { return 'unknown' } finally { input.dispose() }
}

/** 声音波形峰值表（每秒 PEAKS_PER_SEC 格·0..1）：本机储存有就读（本机算的或终端算好下载回来的）；没有 ⇒ 从 src 把声音一块一块解出来算·算好存一份。
 *  没声音／解不开／没 src ⇒ peaks 为 null；sound＝声音轨探测结果（解码器不报错却一格样本都没解出来也算 undecodable·不存波形） */
export async function makePeaks(id: string, src: Blob | null, duration: number): Promise<{ peaks: Float32Array | null; sound: SoundProbe }> {
  const have = await readStored(peaksName(id))
  if (have && have.size >= 4 && have.size % 4 === 0) { try { return { peaks: new Float32Array(await have.arrayBuffer()), sound: 'ok' } } catch { /* 坏了就重算 */ } }
  if (!src || typeof AudioDecoder === 'undefined') return { peaks: null, sound: 'unknown' }
  const mb = await import('mediabunny').catch(() => null)
  if (!mb) return { peaks: null, sound: 'unknown' }
  const input = new mb.Input({ source: new mb.BlobSource(src, quietSource()), formats: mb.ALL_FORMATS }) // 读不动 ⇒ 前台那一读照抛、这里回 null（⛔ 后台预读漏成未处理拒绝）
  try {
    const track = await input.getPrimaryAudioTrack().catch(() => null)
    if (!track) return { peaks: null, sound: (await blobUnreadable(src)) ? 'unknown' : 'none' }
    if (!(await track.canDecode().catch(() => false))) return { peaks: null, sound: 'undecodable' }
    const dur = duration > 0 ? duration : await input.computeDuration().catch(() => 0)
    if (!(dur > 0)) return { peaks: null, sound: 'unknown' }
    const peaks = new Float32Array(Math.ceil(dur * PEAKS_PER_SEC) + 1)
    const sink = new mb.AudioSampleSink(track)
    let frames = 0
    for await (const smp of sink.samples()) {
      try {
        frames += smp.numberOfFrames
        const chans: Float32Array[] = []
        for (let c = 0; c < Math.min(2, smp.numberOfChannels); c++) {
          const buf = new Float32Array(smp.numberOfFrames)
          smp.copyTo(buf, { planeIndex: c, format: 'f32-planar' })
          chans.push(buf)
        }
        accumulatePeaks(peaks, smp.sampleRate, smp.timestamp, chans)
      } finally { smp.close() }
    }
    const sound = decodedProbe(frames)
    if (sound !== 'ok') return { peaks: null, sound }
    void writeStored(peaksName(id), (w) => w.write(new Blob([peaks.buffer as ArrayBuffer])))
    return { peaks, sound }
  } catch { return { peaks: null, sound: (await blobUnreadable(src)) ? 'unknown' : 'undecodable' } } finally { input.dispose() }
}

/** 素材从素材区拿掉 ⇒ 本机储存里那几份（原档、预览档、波形）一起删 */
export async function forgetStored(id: string): Promise<void> {
  await Promise.all([removeStored(origName(id)), removeStored(proxyName(id)), removeStored(peaksName(id)), removeStored(thumbsName(id))])
}


/** 使用者上传的程序包本体（manifest＋已内嵌资源的入口页·JSON）存一份进本机储存 */
export async function storeProgramBundle(name: string, json: string): Promise<boolean> {
  return writeStored(name, async (w) => { await w.write(new Blob([json], { type: 'application/json' })) })
}

// ── 剪辑导出·边编边传的分流口──────────────────────────────
// renderVideo 边编边传时 mediabunny StreamTarget 的 writable：每笔写入同时进
//   ① 本机整档 LocalCopy（keepLocal·下载／上传失败后「再按一次存雲盤」整份传用）；
//   ② 上传器（startStreamUpload 回的 write／end／cancel）——它抛错（自己已失败／取消）⇒ 之后不再喂它，⛔ 往编码器抛（渲染照跑）。
// close 不收尾上传：commit() 才送最后一片＋complete（调用方核过「编码途中才打不开的素材」再 commit·⛔ 缺段的片先进了云盘）。
// 题：vedit-export-stream-upload.browser.test.cjs（真 mediabunny 编码进假上传口·上传中途失败渲染照完）。
import { LocalCopy } from './export-client.pure'
/** 边编边传的上传器（网站的分片上传口·游客版没有）：只用得到写、收尾、取消三只 */
type StreamUpload = { write: (position: number, data: Uint8Array) => void; end: () => void; cancel: () => void }

/** upload＝startStreamUpload 那只（缺 ⇒ 只留本机）；keepLocal＝另留整档在本机 */
export type RenderStream = { upload?: Pick<StreamUpload, 'write' | 'end' | 'cancel'> | null; keepLocal: boolean }
type Chunk = { type: 'write'; data: Uint8Array<ArrayBuffer>; position: number }

export function teeSink(stream: RenderStream) {
  let local: LocalCopy | null = stream.keepLocal ? new LocalCopy() : null
  let up = stream.upload ?? null
  let uploadDropped = false
  const upCall = (f: (u: NonNullable<typeof up>) => void) => { if (!up) return; try { f(up) } catch { up = null; uploadDropped = true } }
  const writable = new WritableStream<Chunk>({
    write(c) { local?.write(c.position, c.data); upCall((u) => u.write(c.position, c.data)) },
    abort() { upCall((u) => u.cancel()) },
  })
  return {
    writable,
    /** 上传器写不进去了（它自己失败／取消）——只给显示／题用 */
    uploadDropped: () => uploadDropped,
    /** 编完且核过：上传送最后一片＋complete；回本机整档（keepLocal=false ⇒ 空 blob）·之后放掉本机引用 */
    commit(type = 'video/mp4'): Blob {
      upCall((u) => u.end())
      const blob = local ? local.toBlob(type) : new Blob([], { type })
      local = null
      return blob
    },
    /** 渲染失败／取消：这次的上传作废（abort 会话）、本机那份放掉 */
    drop(): void {
      upCall((u) => u.cancel())
      up = null
      local?.clear(); local = null
    },
  }
}

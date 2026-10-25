// 单测用的记忆体目录句柄（够 store.ts／zip.ts 用的那部分 FileSystemDirectoryHandle）。
//   每次写档 lastModified 取 clock()（单调递增），可用 touch() 模拟「外面改了档」。
//   FakeOptions 模拟不同浏览器：move 有没有、肯不肯盖掉已存在的档；createWritable 是不是就地截断再写（非原子）；
//   onWrite 在每次 write() 时叫一次（题拿来在「写到一半」时看外部读者读到什么）。

let tick = 1_700_000_000_000
export function clock(): number { return ++tick }

class NotFound extends Error { name = 'NotFoundError' }

export interface FakeOptions {
  /** 'overwrite'（缺省·盖掉已存在的档）／'no-overwrite'（目标已在就丢错）／'none'（档案句柄没有 move）。 */
  move?: 'overwrite' | 'no-overwrite' | 'none'
  /** true ⇒ createWritable 一打开就把档截成空的、每次 write 就地接上（像就地截断再写的实作）；缺省 false＝close 才换上。 */
  nonAtomic?: boolean
  /** 每次 write() 时叫（参数＝正在写的档名）。 */
  onWrite?: (fileName: string) => void
}

export class FakeFile {
  kind = 'file' as const
  parent: FakeDir | null = null
  constructor(public name: string, public data: Uint8Array = new Uint8Array(), public mtime = clock(), public type = '', public opts: FakeOptions = {}) {
    if (opts.move === 'none') (this as { move?: unknown }).move = undefined
  }
  async getFile(): Promise<File> { return new File([this.data.slice().buffer as ArrayBuffer], this.name, { lastModified: this.mtime, type: this.type }) }
  async createWritable() {
    const chunks: Uint8Array[] = []
    const join = () => {
      const len = chunks.reduce((a, c) => a + c.length, 0)
      const out = new Uint8Array(len); let o = 0
      for (const c of chunks) { out.set(c, o); o += c.length }
      return out
    }
    if (this.opts.nonAtomic) { this.data = new Uint8Array(); this.mtime = clock() }
    return {
      write: async (d: Blob | string | ArrayBuffer | Uint8Array) => {
        const b = typeof d === 'string' ? new TextEncoder().encode(d) : d instanceof Blob ? new Uint8Array(await d.arrayBuffer()) : d instanceof Uint8Array ? d : new Uint8Array(d)
        if (this.opts.nonAtomic) {
          // 就地写：先写进一半，外部读者此刻读得到半截
          const half = b.slice(0, Math.floor(b.length / 2))
          chunks.push(half); this.data = join(); this.mtime = clock()
          this.opts.onWrite?.(this.name)
          chunks[chunks.length - 1] = b; this.data = join(); this.mtime = clock()
        } else {
          chunks.push(b)
          this.opts.onWrite?.(this.name)
        }
      },
      close: async () => { this.data = join(); this.mtime = clock() },
      abort: async () => {},
    }
  }
  /** FileSystemHandle.move(destDir, newName)／move(newName)。 */
  async move(a: FakeDir | string, b?: string): Promise<void> {
    const dest = typeof a === 'string' ? this.parent : a
    const name = typeof a === 'string' ? a : b ?? this.name
    if (!dest || !this.parent) throw new NotFound(this.name)
    const exists = dest.entries.get(name)
    if (exists && exists !== this) {
      if (this.opts.move === 'no-overwrite' || exists instanceof FakeDir) { const e = new Error('exists'); e.name = 'InvalidModificationError'; throw e }
    }
    this.parent.entries.delete(this.name)
    this.name = name
    this.parent = dest
    dest.entries.set(name, this)
  }
  async isSameEntry(o: unknown) { return o === this }
}

export class FakeDir {
  kind = 'directory' as const
  entries = new Map<string, FakeFile | FakeDir>()
  constructor(public name = 'root', public opts: FakeOptions = {}) {}
  private newFile(name: string, data?: Uint8Array): FakeFile {
    const f = new FakeFile(name, data, clock(), '', this.opts)
    f.parent = this
    this.entries.set(name, f)
    return f
  }
  async getFileHandle(name: string, o?: { create?: boolean }): Promise<FakeFile> {
    const e = this.entries.get(name)
    if (e instanceof FakeFile) return e
    if (e) { const err = new Error('type'); err.name = 'TypeMismatchError'; throw err }
    if (!o?.create) throw new NotFound(name)
    return this.newFile(name)
  }
  async getDirectoryHandle(name: string, o?: { create?: boolean }): Promise<FakeDir> {
    const e = this.entries.get(name)
    if (e instanceof FakeDir) return e
    if (e) { const err = new Error('type'); err.name = 'TypeMismatchError'; throw err }
    if (!o?.create) throw new NotFound(name)
    const d = new FakeDir(name, this.opts); this.entries.set(name, d); return d
  }
  async removeEntry(name: string) { if (!this.entries.delete(name)) throw new NotFound(name) }
  async *values() { for (const v of this.entries.values()) yield v }
  async isSameEntry(o: unknown) { return o === this }
  /** 测试用：外面（用户的 AI）直接改一个档。 */
  setText(name: string, text: string) {
    const f = this.entries.get(name)
    const data = new TextEncoder().encode(text)
    if (f instanceof FakeFile) { f.data = data; f.mtime = clock() } else this.newFile(name, data)
  }
  /** 测试用：只改修改时间、不改内容。 */
  touch(name: string) { const f = this.entries.get(name); if (f instanceof FakeFile) f.mtime = clock() }
  text(name: string): string { const f = this.entries.get(name); return f instanceof FakeFile ? new TextDecoder().decode(f.data) : '' }
  /** 测试用：外部读者此刻看到的 project.json（不存在 ⇒ null）。 */
  peek(name: string): string | null { const f = this.entries.get(name); return f instanceof FakeFile ? new TextDecoder().decode(f.data) : null }
}

/** 当 FileSystemDirectoryHandle 用（型别上骗过去）。 */
export function asDir(d: FakeDir): FileSystemDirectoryHandle { return d as unknown as FileSystemDirectoryHandle }

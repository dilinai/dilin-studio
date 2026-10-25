/**
 * 简报程序动画「死循环计时闸」·B 层顶层看门狗。
 *
 * 量的是每个程序框自己：顶层（网站页面）每 500ms 直接对该框的实 Window postMessage ping{ch,epoch}（ch 每次新随机），
 *   框内守卫回 top.postMessage beat{ch,epoch,g}；顶层只认 e.source＝该实 Window、epoch＝现行、ch＝这一世代发给它过的。
 *   ⛔ 信讯息自报的 id；⛔ 经 deck 转发。守卫装好会先报 hello（从这一刻起盯它）、A 层自己停下时报 stopped（不再盯）。
 * 判定：被盯的框 3 秒没有合格的 beat／hello ⇒ onStuck(ids)（宿主把它们记进封锁名单、重建 deck 停在同页、名单内的框静态）；判一次就停，宿主重建后 revive。
 * 撤旧（epoch+1·清掉旧 ch 与被盯名单）：reset()（宿主翻页／deck 重建时叫）、对应的框变了（targets 回的 Window 组不同·frames.length 变）、
 *   生命期恢复（visible／pageshow／resume）、宿主自己的 tick 间隔 > 1 秒（宿主卡或睡过·不判任何框·先重握手）。
 *   撤旧之后，原本被盯、框还是同一个的⇒新世代第一拍起限时重握手（3 秒内没回新世代的 beat／hello 照判）；翻页（reset({reloaded:true})）不留。
 *   hidden／freeze／pagehide ⇒ 暂停：撤掉全部截止、不发 ping。
 * targets() 回 null＝对应关系不可信（例：deck 的 frames.length 对不上组装时记的数目）⇒ 这一世代不启 B，A 层照常。
 * 保证：替换可达、名单内框静态、页码保住；不保证旧程序已被终止、动画已恢复。只在 Chrome／Edge 桌面 127 起启用（programWatchdogSupported）。
 * 纯逻辑（时钟／随机／送讯都注入）·客户端用；单测直喂。
 */

export const PROGRAM_WATCH_PING_MS = 500
export const PROGRAM_WATCH_DEADLINE_MS = 3000
export const PROGRAM_WATCH_GAP_MS = 1000
/** 每个框留几个最近发出的 ch（beat 回的是上一两次 ping 的） */
const KEEP_CH = 8

export type ProgramWatchTarget = { id: string; win: unknown }
export type ProgramWatchDeps = {
  targets: () => ProgramWatchTarget[] | null
  now: () => number
  rand: () => string
  post: (win: unknown, msg: unknown) => void
  onStuck: (ids: string[]) => void
  /**
   * 这次放映里已经封住的框（A 层判导走／hang／guard 报上来的、B 层先前判过卡住的——宿主那一份封锁名单）⇒ 不盯、不判卡住、它的 beat／hello 不算。
   *   ⛔ 导走后心跳当然停——以前被当成卡住、整场重建、提示写成「卡住了」。
   */
  sealed?: (id: string) => boolean
}

/**
 * 这次放映的封锁名单（组件 id ⇒ 为什么封）——A 层（deck 里盯 load／守卫）与 B 层（看门狗判卡住）共用一份，跨重建保留：
 *   重建放映时名单里的框一律标静态、盖各自的原因（blockProgramFramesHtml）。nav＝自己导走；hang／guard＝守卫停下；stuck＝B 层判卡住。
 */
export type ProgramSealWhy = 'nav' | 'hang' | 'guard' | 'stuck'
export type ProgramSeals = Map<string, ProgramSealWhy>
const SEAL_WHYS: ReadonlyArray<ProgramSealWhy> = ['nav', 'hang', 'guard', 'stuck']

/** 记进封锁名单：先封的原因为准（⛔ 后来的 stuck 盖掉 nav）。回 true＝新记的 */
export function addProgramSeal(seals: ProgramSeals, id: string, why: ProgramSealWhy): boolean {
  if (seals.has(id)) return false
  seals.set(id, why)
  return true
}

/**
 * deck 报上来的「这框 A 层已封」（盯 load 脚本 up()）：只认自家放映框（e.source＝deck 框的 contentWindow）、
 *   id 是这份放映框表里的程序框、原因是 nav／hang／guard。⚠️ 只会让框更静态（封）·不会放行任何东西 ⇒ 信 deck 自报的 id 无妨。
 */
export function programSealFromDeck(data: unknown, source: unknown, deckWin: unknown, ids: ReadonlyArray<string | null>): { id: string; why: ProgramSealWhy } | null {
  if (!source || source !== deckWin || !data || typeof data !== 'object') return null
  const m = data as { __dlp?: unknown; type?: unknown; id?: unknown; why?: unknown }
  if (m.__dlp !== 1 || m.type !== 'sealed' || typeof m.id !== 'string' || !m.id || !ids.includes(m.id)) return null
  const why = SEAL_WHYS.find((w) => w === m.why && w !== 'stuck')
  return why ? { id: m.id, why } : null
}

export class ProgramWatchdog {
  epoch = 0
  private paused = false
  private stopped = false
  private disabled = false
  private lastTick: number | null = null
  private cur: ProgramWatchTarget[] = []
  private issued = new Map<string, string[]>()
  /** 被盯的框 ⇒ 最近一次合格 beat／hello 的时刻 */
  private seen = new Map<string, number>()
  /**
   * 换世代时「原本被盯、框还是同一个」的那些（id ⇒ 实 Window）——
   *   旧挑战照样作废（issued 清掉·旧 epoch／旧 ch 的 beat 一律不算），但它们在新世代第一拍发 ping 时就重新列入被盯、
   *   从那一拍起 PROGRAM_WATCH_DEADLINE_MS 内要回新世代的 beat／hello，回不了照判卡住（⛔ 等它自己再报 hello——卡住的框报不了）。
   *   保留的情形：生命期 hide→show、宿主 tick 间隔过长、Window 组变了但这框还在（同 id 同 Window）。
   *   不留的情形：翻页（reset({ reloaded: true })·执行器会把旧页的框重载成静态＝合法不再回）、revive、targets 回 null。
   */
  private carry = new Map<string, unknown>()

  constructor(private readonly d: ProgramWatchDeps) {}

  /** 单测与宿主看状态用 */
  get watching(): string[] { return [...this.seen.keys()] }
  get enabled(): boolean { return !this.disabled && !this.paused && !this.stopped }

  /** 新世代：撤旧挑战；keep＝被盯的框（还对得上 cur 的）留到下一拍重握手 */
  private bump(keep: boolean) {
    if (keep) { for (const id of this.seen.keys()) { const x = this.cur.find((t) => t.id === id); if (x) this.carry.set(id, x.win) } }
    else this.carry.clear()
    this.epoch++; this.issued.clear(); this.seen.clear()
  }

  /**
   * 新世代。reloaded＝宿主翻页／换文件：框都会被重载（旧页的成了静态·不再回）⇒ 不留重握手；
   * 不带＝同一批框照旧在跑（例：宿主自己要重来一轮）⇒ 原本被盯的照样限时重握手。
   */
  reset(o: { reloaded?: boolean } = {}) { this.bump(!o.reloaded); this.lastTick = null; this.cur = []; this.disabled = false }

  /** 判过卡住之后宿主已重建 ⇒ 接着盯（新世代·被判的框已拿掉 ⇒ 不留） */
  revive() { this.stopped = false; this.reset({ reloaded: true }) }

  /** 生命期：hide＝hidden／freeze／pagehide；show＝visible／resume／pageshow（框没换 ⇒ 原本被盯的回来后限时重握手） */
  lifecycle(kind: 'hide' | 'show') {
    if (kind === 'hide') { this.paused = true; this.bump(true); this.lastTick = null }
    else { this.paused = false; this.reset() }
  }

  tick() {
    if (this.paused || this.stopped) return
    const now = this.d.now()
    // 宿主自己卡过或睡过 ⇒ 这一拍不判任何框·重握手（原本被盯的下一拍起限时）
    if (this.lastTick !== null && now - this.lastTick > PROGRAM_WATCH_GAP_MS) { this.bump(true); this.lastTick = now; return }
    this.lastTick = now
    const t = this.d.targets()
    if (!t) { if (!this.disabled) { this.bump(false); this.cur = []; this.disabled = true } return }
    if (this.disabled || !sameTargets(t, this.cur)) { if (this.disabled || this.cur.length) this.bump(!this.disabled); this.disabled = false; this.cur = t }
    // 留下来要重握手的：框还是同一个（同 id 同 Window）⇒ 从这一拍（新世代第一个 ping）起算期限
    if (this.carry.size) {
      for (const [id, w] of this.carry) if (this.cur.some((x) => x.id === id && x.win === w) && !this.seen.has(id)) this.seen.set(id, now)
      this.carry.clear()
    }
    // 已封的框不盯（A 层判导走／停下的·这次放映里本来就留静态）
    if (this.d.sealed) for (const id of [...this.seen.keys()]) if (this.d.sealed(id)) this.seen.delete(id)
    const stuck: string[] = []
    for (const [id, at] of this.seen) if (now - at > PROGRAM_WATCH_DEADLINE_MS) stuck.push(id)
    if (stuck.length) { this.stopped = true; this.d.onStuck(stuck); return }
    for (const x of this.cur) {
      const ch = this.d.rand()
      const l = this.issued.get(x.id) ?? []
      l.push(ch); if (l.length > KEEP_CH) l.shift()
      this.issued.set(x.id, l)
      try { this.d.post(x.win, { __dlp: 1, type: 'ping', ch, epoch: this.epoch }) } catch { /* 框没了 */ }
    }
  }

  onMessage(source: unknown, data: unknown) {
    if (this.stopped || !data || typeof data !== 'object') return
    const m = data as { __dlp?: unknown; type?: unknown; ch?: unknown; epoch?: unknown }
    if (m.__dlp !== 1) return
    if (m.type === 'stopped' || m.type === 'hang') {
      // A 层自己停下的框不再盯——暂停中、或换了世代还没到下一拍（cur 已清、只在 carry 里）也认，免得被留到新世代当卡住
      const y = this.cur.find((t) => t.win === source)
      if (y) this.seen.delete(y.id)
      for (const [id, w] of this.carry) if (w === source) this.carry.delete(id)
      return
    }
    if (this.paused || this.disabled) return
    const x = this.cur.find((t) => t.win === source)
    if (!x || this.d.sealed?.(x.id)) return
    if (m.type === 'beat') {
      if (m.epoch !== this.epoch || typeof m.ch !== 'string' || !(this.issued.get(x.id) ?? []).includes(m.ch)) return
      this.seen.set(x.id, this.d.now())
    } else if (m.type === 'hello') {
      this.seen.set(x.id, this.d.now())
    }
  }
}

function sameTargets(a: ProgramWatchTarget[], b: ProgramWatchTarget[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i].id !== b[i].id || a[i].win !== b[i].win) return false
  return true
}

/**
 * deck 拓扑：组装时记下的框表（deckIframeProgIds）对 deckWindow.frames[i]——先核 frames.length 等于框表长度，不等 ⇒ null（不启 B）。
 * 跨源也拿得到 frames／length／索引（WindowProxy）·⛔ 读 deck 的 DOM。
 */
export function deckWatchTargets(deckWin: unknown, map: ReadonlyArray<string | null>): ProgramWatchTarget[] | null {
  const w = deckWin as { frames?: { length?: unknown; [i: number]: unknown } } | null | undefined
  if (!w) return null
  let fr: { length?: unknown; [i: number]: unknown } | undefined
  try { fr = w.frames } catch { return null }
  if (!fr || fr.length !== map.length) return null
  const out: ProgramWatchTarget[] = []
  for (let i = 0; i < map.length; i++) {
    const id = map[i]
    if (id === null || id === '') continue
    let win: unknown
    try { win = fr[i] } catch { return null }
    if (!win) return null
    out.push({ id, win })
  }
  return out
}

/** 只在 Chrome／Edge 桌面 127 起启用（没 allow-same-origin 的沙盒框才与父页分程序）；手机、Safari、Firefox、iOS 上的 Chrome 一律不启 */
export function programWatchdogSupported(ua: string): boolean {
  if (!ua || /Android|Mobile|iPhone|iPad|iPod|CriOS|EdgiOS|FxiOS|OPR\/|SamsungBrowser/i.test(ua)) return false
  const m = /(?:Chrome|Chromium|HeadlessChrome)\/(\d+)/.exec(ua)
  return !!m && Number(m[1]) >= 127
}

/** 随机挑战码（16 位以上 [0-9a-z]） */
export function programWatchNonce(): string {
  let s = ''
  try { const a = new Uint32Array(4); globalThis.crypto.getRandomValues(a); for (const x of a) s += x.toString(36) } catch { /* 没有 crypto */ }
  while (s.length < 16) s += Math.floor(Math.random() * 2147483647).toString(36)
  return s
}

// 网页剪辑页·编辑手势（拖音量线／拖片段／拉两端／拖轨道排序）跟编辑遮罩（补审 ②）：
//   原写法只在按下那一下查「罩着没」——罩落前已经按下的拖动，罩落后照样一路改值、放手记进复原、停手自动存 ⇒ 罩期照样改了角色正在改的工程。
//   新写法：每一下手势登记在这只看守上（begin）；罩落那刻（页面 onLock）或拖动中途任何一步发现罩着（step）⇒ 这一下作废：
//     退回按下那刻的轨道（restore）·之后的移动／放手全不算（不改值、不进复原、不触发存档）；播放头、选取、卷动、检视不归它管（照常）。
// ⛔ 碰 DOM（页面把 restore／locked 接进来）。题：vedit-gesture.test.ts（纯）＋ vedit-gesture.chromium.mjs（真 Chromium 指针事件）。

export type GestureGuard<T> = {
  /** 按下：罩着 ⇒ false（这一下不开始）；否则登记（base＝按下那刻的轨道） */
  begin(base: T): boolean
  /** 每一步移动先问：还算不算（罩落了 ⇒ 当场作废并退回·回 false） */
  step(): boolean
  /** 放手：回按下那刻的轨道（要记复原就拿它）·作废过／没开始 ⇒ null */
  end(): T | null
  /** 罩落那刻：手上有一下 ⇒ 作废并退回（回 true） */
  abort(): boolean
  readonly active: boolean
}

export function createGestureGuard<T>(opts: { locked: () => boolean; restore: (base: T) => void; onAbort?: () => void }): GestureGuard<T> {
  let cur: { base: T } | null = null
  let dead = false
  const kill = (): boolean => {
    if (!cur || dead) return false
    dead = true
    opts.restore(cur.base)
    opts.onAbort?.()
    return true
  }
  return {
    begin(base) {
      if (opts.locked()) return false
      cur = { base }
      dead = false
      return true
    },
    step() {
      if (!cur || dead) return false
      if (opts.locked()) { kill(); return false }
      return true
    },
    end() {
      const c = cur
      const wasDead = dead
      cur = null
      dead = false
      if (!c || wasDead) return null
      if (opts.locked()) { opts.restore(c.base); opts.onAbort?.(); return null }
      return c.base
    },
    abort() { return kill() },
    get active() { return !!cur && !dead },
  }
}

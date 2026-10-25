
export interface WalkVersionRef { id: string }

export interface WalkState {
  /** burst 开始时取的版本列表快照（created_at DESC·[0]=最新一版=当前态的上一步） */
  versions: WalkVersionRef[]
  /** -1=停在 burst 起点（preBurst 现场）；0..n-1=当前显示 versions[idx] 那一版 */
  idx: number
  /** burst 起点的现场（redo 走到头时用它还原） */
  preBurst: { content: string; title: string; layers?: unknown }
  /** 状态机最后一次应用到编辑器的内容/标题（burst 有效性判据 + skip-identical 基准） */
  appliedContent: string
  appliedTitle: string
  /** 最后一次应用的组件签名（layersKey）；undefined＝这一轮不比组件 */
  appliedLayersKey?: string
}

/** layers：那一版的自由组件（null＝那版没有组件）；undefined＝那版没记（旧行）⇒ 不动编辑器里的组件 */
export interface RollbackResult { content: string; title: string; layers?: unknown }

/** 组件签名（比对同值行用）·调用方可换成净化后再序列化的版本 */
export const defaultLayersKey = (v: unknown): string => JSON.stringify(v ?? null)

function sameAsApplied(state: WalkState, r: RollbackResult, key: (v: unknown) => string): boolean {
  if (r.content !== state.appliedContent || r.title !== state.appliedTitle) return false
  if (r.layers === undefined || state.appliedLayersKey === undefined) return true
  return key(r.layers) === state.appliedLayersKey
}

function appliedFrom(state: WalkState, r: RollbackResult, key: (v: unknown) => string): Partial<WalkState> {
  return { appliedContent: r.content, appliedTitle: r.title, ...(r.layers !== undefined ? { appliedLayersKey: key(r.layers) } : {}) }
}
export type RollbackFetch = (versionId: string) => Promise<RollbackResult | null>

/** 单次按键内最多真发几次 rollback 调用（含被跳过的同值行）——防病态同值长链把一次按键变成风暴。 */
export const MAX_CALLS_PER_STEP = 12

export function startWalk(
  versions: WalkVersionRef[],
  current: { content: string; title: string; layers?: unknown },
  layersKey: (v: unknown) => string = defaultLayersKey,
): WalkState {
  return {
    versions,
    idx: -1,
    preBurst: { ...current },
    appliedContent: current.content,
    appliedTitle: current.title,
    ...(current.layers !== undefined ? { appliedLayersKey: layersKey(current.layers) } : {}),
  }
}

/** burst 是否仍有效：编辑器当前显示必须仍是本状态机最后应用的那份（否则外界已介入·重开 burst）。
 *  shownLayersKey：编辑器现在组件的签名（给了且状态机有记才比·挪过组件＝外界介入）。 */
export function isWalkCurrent(state: WalkState, shownContent: string, shownTitle: string, shownLayersKey?: string): boolean {
  if (state.appliedContent !== shownContent || state.appliedTitle !== shownTitle) return false
  return shownLayersKey === undefined || state.appliedLayersKey === undefined || state.appliedLayersKey === shownLayersKey
}

export interface StepOutcome {
  state: WalkState
  /** 真正应用了的新内容（null=没有可走的一步：到头了/全是同值行/调用失败） */
  applied: RollbackResult | null
  /** 'ok' 应用成功 · 'exhausted' 该方向没有更多真变化 · 'error' 某次 rollback 调用失败（state 未前进） */
  status: 'ok' | 'exhausted' | 'error'
  /** redo 专用：true=应还原 preBurst 现场（caller 本地 setContent + 保存·不走 rollback API） */
  restorePreBurst?: boolean
}

/** Ctrl+Z：沿快照向更旧一步（跳过与当前显示同值的行）。 */
export async function stepUndo(state: WalkState, doRollback: RollbackFetch, layersKey: (v: unknown) => string = defaultLayersKey): Promise<StepOutcome> {
  let calls = 0
  let j = state.idx + 1
  let lastTried = state.idx
  while (j < state.versions.length && calls < MAX_CALLS_PER_STEP) {
    const r = await doRollback(state.versions[j].id)
    calls++
    if (!r) return { state, applied: null, status: 'error' }
    lastTried = j
    if (sameAsApplied(state, r, layersKey)) { j++; continue }  // 同值行·继续走
    return {
      state: { ...state, idx: j, ...appliedFrom(state, r, layersKey) },
      applied: r,
      status: 'ok',
    }
  }
  // 到头/同值链耗尽：idx 推到最后尝试过的位置（下次按键不重扫同一段），内容没变。
  return { state: { ...state, idx: lastTried }, applied: null, status: 'exhausted' }
}

/** Ctrl+Shift+Z / Ctrl+Y：沿快照向更新一步；走到 -1 = 还原 burst 起点现场（caller 本地还原+保存）。 */
export async function stepRedo(state: WalkState, doRollback: RollbackFetch, layersKey: (v: unknown) => string = defaultLayersKey): Promise<StepOutcome> {
  let calls = 0
  let j = state.idx - 1
  while (j >= 0 && calls < MAX_CALLS_PER_STEP) {
    const r = await doRollback(state.versions[j].id)
    calls++
    if (!r) return { state, applied: null, status: 'error' }
    if (sameAsApplied(state, r, layersKey)) { j--; continue }
    return {
      state: { ...state, idx: j, ...appliedFrom(state, r, layersKey) },
      applied: r,
      status: 'ok',
    }
  }
  if (j < 0 && state.idx >= 0) {
    // 走回起点：preBurst 与当前不同才算一步（相同=没得走）。
    const p = state.preBurst
    if (!sameAsApplied(state, p, layersKey)) {
      return {
        state: { ...state, idx: -1, ...appliedFrom(state, p, layersKey) },
        applied: { ...p },
        status: 'ok',
        restorePreBurst: true,
      }
    }
    return { state: { ...state, idx: -1 }, applied: null, status: 'exhausted' }
  }
  return { state, applied: null, status: 'exhausted' }
}

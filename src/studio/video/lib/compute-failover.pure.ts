// 网页剪辑页「自動調配算力」·纯函数（⛔ fetch／DOM ⇒ 题直跑）：
//   交给终端（拆人声／识别字幕）失败 ⇒ 开关开着就决定下一步：本帐号另一台这项装好了的电脑（⛔ 再找已经失败过的那几台）→ 都没有 ⇒ 这台浏览器自己算 → 浏览器也不能 ⇒ 不接手（照旧报错）。
//   「失败」＝ upload／send／pickup／failed 四种；cancelled＝用户自己按取消 ⇒ ⛔ 接手。开关关着 ⇒ ⛔ 接手（照现状只报错）。
import { defaultChoice, shellChoices, type MediaDevice, type MediaKind } from './shell-media.pure'

/** runShellJob 抛的失败原因（同 ShellJobError.why） */
export type ShellFailWhy = 'upload' | 'send' | 'pickup' | 'failed' | 'cancelled'
/** 下一步：换到哪台电脑／改用这台浏览器；null ＝ 不接手（照旧报错） */
export type ComputeStep = { to: 'device'; dev: MediaDevice } | { to: 'web' } | null

/** 这种失败接不接手：只有真失败才接（取消、认不得的错 ⇒ 不接） */
export function canTakeOver(why: ShellFailWhy | null | undefined): boolean {
  return why === 'upload' || why === 'send' || why === 'pickup' || why === 'failed'
}

/** 决定下一步。tried＝这一趟已经交过（失败了）的电脑编号（含刚失败那台）；web＝这台浏览器能不能自己算这项。
 *  挑法：这项装好了（ready）、没试过的电脑——这个浏览器所在那台优先，其余照清单顺序；一台都没有 ⇒ 浏览器；浏览器也不能 ⇒ null。 */
export function nextComputeStep(o: {
  on: boolean
  why: ShellFailWhy | null | undefined
  kind: MediaKind
  devs: readonly MediaDevice[] | null
  tried: readonly string[]
  local?: string | null
  web: boolean
}): ComputeStep {
  if (!o.on || !canTakeOver(o.why)) return null
  const left = shellChoices(o.devs ?? [], o.kind).filter((d) => d.view[o.kind].state === 'ready' && !o.tried.includes(d.deviceId))
  const dev = defaultChoice(left, o.local ?? null)
  if (dev) return { to: 'device', dev }
  return o.web ? { to: 'web' } : null
}

/** 换过去时画面上那句（{device}＝电脑名；浏览器那条另一句） */
export function computeSwitchText(t: (k: 'vedit_compute_switch_device' | 'vedit_compute_switch_web') => string, step: Exclude<ComputeStep, null>): string {
  return step.to === 'device' ? t('vedit_compute_switch_device').replace('{device}', step.dev.name) : t('vedit_compute_switch_web')
}

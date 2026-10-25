// 剪辑页转到背景 ⇒ 正在播就停：同一份剪辑开两个分页时，背景那页照样在播、有声音、看不到是哪页在响。
//   只停不接：切回来⛔ 自动接着播（使用者自己按播放）。只碰 DOM 事件（单测给假的跑）。

/** 负控开关（只在 node 测试跑·正式页面恒 false）：环境变量 DILIN_NEG 含处名 ⇒ 退回修前行为 */
function neg(site: string): boolean {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
  return !!env?.DILIN_NEG && env.DILIN_NEG.split(',').includes(site) && typeof window === 'undefined'
}

/** 分页一转到背景（document.hidden）就叫 pause·回传拆掉的函数 */
export function pauseWhenHidden(doc: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>, pause: () => void): () => void {
  const on = () => { if (doc.visibilityState === 'hidden' && !neg('vedit_play_in_background')) pause() }
  doc.addEventListener('visibilitychange', on)
  return () => doc.removeEventListener('visibilitychange', on)
}

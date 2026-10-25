// 存成「我的模板」之前：先把编辑中的改动收尾、等存档队列清空、核过没有存档失败，再拿现在的版本号。
import type { SerialTaskQueue } from '../deck-edit'
import { editOutcomeOk, type EditDoneOutcome } from './edit-done-gate'

export type FlushDeps = {
  finishEdit: () => Promise<EditDoneOutcome>
  queue: Pick<SerialTaskQueue, 'enqueue'>
  failSeq: () => number
  failedNow: () => boolean
  revision: () => number | null
}
export type FlushResult = { ok: true; revision: number | null } | { ok: false; reason: 'save_failed' | 'queue_dropped' | 'edit_unconfirmed' }

export async function flushDeckBeforeSnapshot(d: FlushDeps): Promise<FlushResult> {
  if (d.failedNow()) return { ok: false, reason: 'save_failed' }
  const before = d.failSeq()
  if (!editOutcomeOk(await d.finishEdit())) return { ok: false, reason: 'edit_unconfirmed' }
  const drained = await d.queue.enqueue(async () => true)
  if (drained !== true) return { ok: false, reason: 'queue_dropped' }
  if (d.failSeq() !== before || d.failedNow()) return { ok: false, reason: 'save_failed' }
  return { ok: true, revision: d.revision() }
}

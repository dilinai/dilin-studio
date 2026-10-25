// 「收尾编辑」等待闸：叫预览框结束编辑后，等它回报脏页已入队（确认／逾时／丢失三种结果）。
export type EditDoneOutcome = 'none' | 'confirmed' | 'timeout' | 'lost'

export type EditDoneGate = {
  wait(timeoutMs: number): Promise<EditDoneOutcome>
  settle(outcome: 'confirmed' | 'lost'): void
  pending(): number
}

export function createEditDoneGate(): EditDoneGate {
  const waiters = new Set<(o: EditDoneOutcome) => void>()
  return {
    wait(timeoutMs) {
      return new Promise(resolve => {
        let timer: ReturnType<typeof setTimeout> | null = null
        const done = (o: EditDoneOutcome) => {
          if (!waiters.delete(done)) return
          if (timer) clearTimeout(timer)
          resolve(o)
        }
        waiters.add(done)
        timer = setTimeout(() => done('timeout'), timeoutMs)
      })
    },
    settle(outcome) {
      for (const f of [...waiters]) f(outcome)
    },
    pending: () => waiters.size,
  }
}

export function editOutcomeOk(o: EditDoneOutcome): boolean {
  return o === 'none' || o === 'confirmed'
}

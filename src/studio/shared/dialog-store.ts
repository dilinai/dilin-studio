// 自家弹窗的 Promise 形入口。
// 用法（就地替换浏览器原生框·动作语义不变）：
//   if (!(await confirmDialog({ message: t('cmd_respawn_confirm'), danger: true }))) return   ← 原 window.confirm
//   await alertDialog(t('drive_download_fail'))                                             ← 原 window.alert
//   const name = await promptDialog({ message: '…', defaultValue: '' })                     ← 原 window.prompt（取消 ⇒ null）
// 机制：本档是纯 TS 队列（不含 React）——调用方把请求塞进队列拿到一只 Promise；挂在根布局的 <DialogHost/>
//   订阅队列·把队首那条画成确认对话框（开源包里是 src/shell/ConfirmDialog.tsx）·用户点了钮才 settle。同一时刻只画一条·其余排队（FIFO）。
// 没挂宿主（SSR／单测／宿主没进树）：⛔ 不回退浏览器原生框——按各自「取消」值当场解掉（confirm=false·alert=undefined·prompt=null）并 console.warn，
//   fail-closed：拿不到人的确认就不做那件事。

export type DialogKind = 'confirm' | 'alert' | 'prompt'

export type DialogRequest = {
  kind: DialogKind
  /** 正文（原生框那句话）。 */
  message: string
  /** 标题·缺省由宿主按 kind 取三语字典（請確認／提示／請輸入）。 */
  title?: string
  /** 确定钮字·缺省 confirm=「確定」·alert=「知道了」·prompt=「確定」。 */
  confirmLabel?: string
  /** 取消钮字·缺省「取消」。 */
  cancelLabel?: string
  /** 红色确定钮（删除／重生这类不可逆）。缺省 false＝主色。 */
  danger?: boolean
  /** prompt 专用：输入框初值／占位。 */
  defaultValue?: string
  placeholder?: string
  /** prompt 专用（如引擎清单「輸入 key」）：'password'＝遮住输入（密钥类）。缺省 'text'。 */
  inputType?: 'text' | 'password'
}

export type DialogResult = boolean | string | null | undefined

export type PendingDialog = {
  id: number
  req: DialogRequest
  /** 宿主收尾用：confirm ⇒ true/false·alert ⇒ undefined·prompt ⇒ string（确定）／null（取消）。 */
  settle: (result: DialogResult) => void
}

type Listener = () => void

const queue: PendingDialog[] = []
const listeners = new Set<Listener>()
let seq = 0

function emit() { for (const l of [...listeners]) l() }

/** 宿主订阅：队列变动就叫一次。返回退订。 */
export function subscribeDialogs(fn: Listener): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/** 队首那条（宿主画它）；没有 ⇒ null。 */
export function currentDialog(): PendingDialog | null {
  return queue[0] ?? null
}

/** 排队条数（含正在画的那条）。 */
export function dialogQueueSize(): number { return queue.length }

/** 有没有宿主在听（没有 ⇒ 请求当场按取消值解掉）。 */
export function hasDialogHost(): boolean { return listeners.size > 0 }

/** 取消值：confirm=false·alert=undefined·prompt=null。 */
export function dismissValue(kind: DialogKind): DialogResult {
  return kind === 'confirm' ? false : kind === 'prompt' ? null : undefined
}

/** 通用入口：塞一条进队列·拿 Promise。宿主 settle 时解。 */
export function openDialog(req: DialogRequest): Promise<DialogResult> {
  if (!hasDialogHost()) {
    if (typeof console !== 'undefined') console.warn('[dialog] no DialogHost mounted; resolving as dismissed:', req.kind, req.message)
    return Promise.resolve(dismissValue(req.kind))
  }
  return new Promise<DialogResult>((resolve) => {
    const id = ++seq
    let done = false
    const settle = (result: DialogResult) => {
      if (done) return
      done = true
      const i = queue.findIndex(p => p.id === id)
      if (i >= 0) queue.splice(i, 1)
      resolve(result)
      emit()
    }
    queue.push({ id, req, settle })
    emit()
  })
}

/** 宿主按 id 收尾（用户点了钮／Esc／点遮罩）。找不到 ⇒ 静默（已被解过）。 */
export function settleDialog(id: number, result: DialogResult): void {
  const p = queue.find(x => x.id === id)
  if (p) p.settle(result)
}

type ConfirmOpts = Omit<DialogRequest, 'kind' | 'defaultValue' | 'placeholder'>
type AlertOpts = Omit<DialogRequest, 'kind' | 'cancelLabel' | 'danger' | 'defaultValue' | 'placeholder'>
type PromptOpts = Omit<DialogRequest, 'kind'>

/** 原 window.confirm(msg) ⇒ await confirmDialog(msg)／confirmDialog({ message, danger })。 */
export function confirmDialog(opts: ConfirmOpts | string): Promise<boolean> {
  const req: DialogRequest = typeof opts === 'string' ? { kind: 'confirm', message: opts } : { ...opts, kind: 'confirm' }
  return openDialog(req).then(r => r === true)
}

/** 原 window.alert(msg) ⇒ await alertDialog(msg)（不等也行：void alertDialog(msg)）。 */
export function alertDialog(opts: AlertOpts | string): Promise<void> {
  const req: DialogRequest = typeof opts === 'string' ? { kind: 'alert', message: opts } : { ...opts, kind: 'alert' }
  return openDialog(req).then(() => undefined)
}

/** 原 window.prompt(msg, def) ⇒ await promptDialog({ message, defaultValue })：确定 ⇒ 字串·取消 ⇒ null。 */
export function promptDialog(opts: PromptOpts | string): Promise<string | null> {
  const req: DialogRequest = typeof opts === 'string' ? { kind: 'prompt', message: opts } : { ...opts, kind: 'prompt' }
  return openDialog(req).then(r => (typeof r === 'string' ? r : null))
}

/** 单测用：清空队列（把没解的全按取消解掉）。 */
export function __resetDialogsForTest(): void {
  for (const p of [...queue]) p.settle(dismissValue(p.req.kind))
  queue.length = 0
}

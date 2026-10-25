import { useCallback, useRef } from 'react';

export interface DocSaveQueueDeps {
  /** 保存目标的当前标识（如 docId）。在 runSave 被调用的那一刻读一次、写进快照（D1）。 */
  getDocId: () => string | null | undefined;
  /** 当前应该发送的标题——同上，调用瞬间快照。 */
  getTitle: () => string;
  /** 当前应该发送的正文——同上，调用瞬间快照。 */
  getContent: () => string;
  /**
   * 🔴 D8（可选）：请求体里**其余一切可随导航变化的上下文**（独立页 = convId + messages）。
   * 与 docId/title/content 同样在 runSave 被调的那一刻读一次、写进快照，发送时由参数 `extra` 交回 doSave。
   * 不传 = 该调用侧的请求体只由 docId/title/content 决定（如 DocEditor：无对话上下文）。
   */
  getExtra?: () => unknown;
  /**
   * 真正执行一次保存（fetch PUT / externalMode.onSave 等）。
   * 🔴 D2：目标 docId 由**参数**给定——实现内部不得再读自家 docId ref / 闭包变量定目标，
   *    否则跨文档尾发又会写错文档（这正是 CONFIRMED② 的根）。
   * 🔴 D8：请求体的其余字段一律取自参数 `extra`（= getExtra 的调用瞬间快照），同样不得现读 ref。
   * 返回 true = 这次发送已确认成功落库（D4 的 resolve 值）；
   * 返回 false = 失败（doSave 内部自行处理错误 UI，这里不重复处理）。
   * 本函数**不应**抛出——失败请返回 false；真抛出时本 hook 当 false 处理（不让队列卡死）。
   */
  doSave: (
    docId: string | null | undefined,
    title: string,
    content: string,
    silent: boolean,
    extra: unknown,
  ) => Promise<boolean>;
}

/** 一个"保存意图"的快照 + 等它的所有 await 方（D1/D3/D4）。 */
interface SaveSnapshot {
  docId: string | null | undefined;
  title: string;
  content: string;
  silent: boolean;
  /** D8：请求体其余上下文的调用瞬间快照（getExtra 未传时为 undefined）。 */
  extra: unknown;
  /** 该快照（或合并吞掉它的那个快照）落库完成时统一 resolve——与取代者同命运（D4）。 */
  waiters: Array<(ok: boolean) => void>;
}

/**
 * 返回一个身份稳定（永不因依赖变化而重建）的 `runSave`。
 * 语义见文件头 D1-D7。返回的 Promise resolve 值 = 这一意图的值是否成功落库。
 */
export function useDocSaveQueue(
  deps: DocSaveQueueDeps,
): (opts?: { silent?: boolean }) => Promise<boolean> {
  /** 待发队列（FIFO）。在飞的那一项已被 shift 出队——所以尾值合并绝不会改到"已经发出去"的快照。 */
  const queueRef = useRef<SaveSnapshot[]>([]);
  /** flush 循环是否正在跑（= 串行化闸：同一时刻至多一发在飞）。 */
  const flushingRef = useRef(false);
  // depsRef：runSave 身份稳定（deps=[]），但每次渲染都要用最新的 getter/doSave（它们闭包了当前渲染的
  // state/props）——靠这层 ref 间接转发。注意 getter 只在"调用瞬间"被读（D1），不在发送时读。
  const depsRef = useRef(deps);
  depsRef.current = deps;

  const flush = useCallback(async () => {
    if (flushingRef.current) return;   // 已有一发在飞 → 由那个循环继续吃队列（串行化不变量）
    flushingRef.current = true;
    try {
      while (queueRef.current.length > 0) {
        const item = queueRef.current.shift()!;
        let ok = false;
        try {
          ok = await depsRef.current.doSave(item.docId, item.title, item.content, item.silent, item.extra);
        } catch {
          // 契约上 doSave 不该抛；真抛了也当失败处理——绝不能让异常冲出 while 把 flushingRef 卡在 true
          // （那会让此后所有保存永久排队不发）。
          ok = false;
        }
        // D4：等它的所有意图（含被尾值合并吞掉的那些）此刻才 resolve；D7：失败 resolve(false) 即止、不重试。
        for (const w of item.waiters) w(ok);
      }
    } finally {
      flushingRef.current = false;
    }
  }, []);

  const runSave = useCallback((opts?: { silent?: boolean }): Promise<boolean> => {
    // ── D1：快照就在此刻捕获，此后该意图的目标与值永不漂移 ──
    const { getDocId, getTitle, getContent, getExtra } = depsRef.current;
    // D8：请求体其余上下文（convId/messages…）同此刻定死——发送时 doSave 只用它、不再现读 ref。
    const extra = getExtra ? getExtra() : undefined;
    const snapshot: SaveSnapshot = {
      docId: getDocId(),
      title: getTitle(),
      content: getContent(),
      silent: !!opts?.silent,
      extra,
      waiters: [],
    };
    const promise = new Promise<boolean>(resolve => { snapshot.waiters.push(resolve); });

    // ── D3：按 docId 归并尾值的 FIFO ──
    const queue = queueRef.current;
    const tail = queue.length > 0 ? queue[queue.length - 1] : null;
    if (tail && tail.docId === snapshot.docId) {
      // 队尾就是同一文档的待发快照 → 用新快照的值取代它（合并中间所有输入只发最终值），
      // 并把它的 waiters 并入：被取代的意图与取代者同命运（D4）。
      tail.title = snapshot.title;
      tail.content = snapshot.content;
      // D8：extra 随 title/content 一起整份换成新快照的——合并 = 取"最后那个意图"的完整上下文，
      // 不做字段级混搭（否则会发出"新正文 + 旧 convId"这种从未真实存在过的组合）。
      tail.extra = snapshot.extra;
      // 只要其中一次是"非静默"的，这一发就按非静默走（用户手动点的保存该看见状态反馈）。
      tail.silent = tail.silent && snapshot.silent;
      tail.waiters.push(...snapshot.waiters);
    } else {
      // 队列空 / 队尾是别的文档 → 追加。不同 docId 绝不合并（合并就等于丢掉一个文档的保存意图）。
      queue.push(snapshot);
    }

    void flush();
    return promise;
  }, [flush]);

  return runSave;
}

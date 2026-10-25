
import { Extension } from '@tiptap/core';
import { getTextBetween, getTextSerializersFromSchema } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { Node as PMNode } from '@tiptap/pm/model';

/** 可见文字之后附一次 `(网址)`；可见文字本身就是那条网址时**不附**（避免同串出现两遍）。 */
export function appendHrefOnce(visible: string, href: string): string {
  if (!href) return visible;
  if (visible.trim() === href.trim()) return visible;
  return `${visible} (${href})`;
}

/** 取该 text 节点身上 link mark 的 href；没有 link mark 回空串。 */
function linkHrefOf(node: PMNode): string {
  const m = node.marks.find(mk => mk.type.name === 'link');
  return m ? ((m.attrs.href as string) || '') : '';
}

/** 与 @tiptap/core getTextBetween 的 `node.isText` 分支**逐字同**的裁切（照顾部分选中）。 */
function clip(node: PMNode, pos: number, from: number, to: number): string {
  return (node.text ?? '').slice(Math.max(from, pos) - pos, to - pos);
}

/**
 * 🔴 附加点必须落在**同一条链接的最后一个 text 节点**上，不是每个 text 节点。
 *   `[**粗**普通](u)` 在 PM 里是**两个** text 节点、带同一个 link mark——逐节点附加会输出两遍网址。
 *   判「我是不是这条 run 的末尾」＝看下一个兄弟还是不是同 href 的 text 且仍在选区内。
 *   判「整条 run 的可见文字等不等于 href」要往前把同 run 的兄弟拼回来（只比对，不重复输出）。
 */
function serializeTextWithLink(
  node: PMNode, pos: number, parent: PMNode | null, index: number, from: number, to: number,
): string {
  const self = clip(node, pos, from, to);
  const href = linkHrefOf(node);
  if (!href || !parent) return self;

  // ① 还没到 run 末尾 → 只出可见文字
  const nextPos = pos + node.nodeSize;
  const next = index + 1 < parent.childCount ? parent.child(index + 1) : null;
  if (next && next.isText && linkHrefOf(next) === href && nextPos < to) return self;

  // ② run 末尾：把同 run 已输出过的可见文字拼回来，只为比对
  let runText = self;
  let i = index - 1;
  let cursor = pos;
  while (i >= 0) {
    const prev = parent.child(i);
    const prevPos = cursor - prev.nodeSize;
    if (!prev.isText || linkHrefOf(prev) !== href || prevPos + prev.nodeSize <= from) break;
    runText = clip(prev, prevPos, from, to) + runText;
    cursor = prevPos;
    i -= 1;
  }
  return self + (appendHrefOnce(runText, href) === runText ? '' : ` (${href})`);
}

/**
 * 🔴 抽成导出的纯函数（不是为了好看）：真跑路径（下面插件）与测试**吃同一个函数**。
 *   若另拼一份影子实现来比对，两边一起错时测试照样绿（心法：别照着它另拼一份）。
 */
export function makeLinkTextSerializer(from: number, to: number) {
  return ({ node, pos, parent, index }: {
    node: PMNode; pos: number; parent: PMNode | null; index: number;
  }) => serializeTextWithLink(node, pos, parent, index, from, to);
}

export const PlainTextHrefSerializer = Extension.create({
  name: 'plainTextHrefSerializer',
  // 🔴 必须压过 @tiptap/core 内建的 clipboardTextSerializer——PM 的 someProp 取**第一个**提供该 prop
  //   的插件，插件次序由扩展 priority 决定（内建为默认 100）。
  priority: 1000,

  addProseMirrorPlugins() {
    const extensionThis = this;
    return [
      new Plugin({
        key: new PluginKey('plainTextHrefSerializer'),
        props: {
          clipboardTextSerializer: () => {
            const { editor } = extensionThis;
            const { state, schema } = editor;
            const { doc, selection } = state;
            const { ranges } = selection;
            const from = Math.min(...ranges.map(range => range.$from.pos));
            const to = Math.max(...ranges.map(range => range.$to.pos));
            const textSerializers = {
              ...getTextSerializersFromSchema(schema),
              // 🔴 只覆盖 text 这一格；linkCard 等节点仍走各自 renderText（保真半不回退）
              text: makeLinkTextSerializer(from, to),
            };
            return getTextBetween(doc, { from, to }, { textSerializers });
          },
        },
      }),
    ];
  },
});

export default PlainTextHrefSerializer;

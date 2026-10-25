
const FENCE_OPEN_RE = /^(`{3,}|~{3,})(.*)$/;

// 缩进宽度（tab 按跳到下一个 4 的倍数算·GFM 惯例）——用于「缩进 ≥4 空格不算围栏标记/属缩进代码块」判断。
export function leadingIndentWidth(line: string): number {
  let width = 0;
  for (const ch of line) {
    if (ch === ' ') width += 1;
    else if (ch === '\t') width += 4 - (width % 4);
    else break;
  }
  return width;
}

export function computeCodeLineMask(content: string): boolean[] {
  const lines = content.split('\n');
  const mask: boolean[] = new Array(lines.length).fill(false);
  let fenceChar: '`' | '~' | null = null; // 非 null=在围栏内·记录是哪种字符开的栏
  let fenceLen = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const indent = leadingIndentWidth(line);
    // 缩进 ≥4 空格不算围栏标记候选行（GFM）——避免把缩进代码块/列表项里的 ``` 文本误判成真围栏。
    const m = indent <= 3 ? FENCE_OPEN_RE.exec(trimmed) : null;
    let handled = false;
    if (m) {
      const marker = m[1][0] as '`' | '~';
      const len = m[1].length;
      const rest = m[2]; // 标记后剩下的内容（开栏允许 info string·闭栏必须只剩空白）
      if (fenceChar === null) {
        const invalidBacktickInfo = marker === '`' && rest.includes('`');
        if (!invalidBacktickInfo) {
          fenceChar = marker;
          fenceLen = len;
          mask[i] = true; // 开栏行本身也算代码行（不含可抽取正文）
          handled = true;
        }
      } else if (marker === fenceChar && len >= fenceLen && rest.trim() === '') {
        mask[i] = true; // 同字符+长度够+标记后只剩空白→真闭栏
        fenceChar = null;
        fenceLen = 0;
        handled = true;
      }
      // 字符不同 / 长度不够 / 标记后还有内容 / 非法 info string → 不切换围栏状态（GFM 语义）
      // 落到下方按「当前是否仍在围栏内」统一判 mask。
    }
    if (!handled) {
      if (fenceChar !== null) {
        mask[i] = true; // 栏内普通文本行（含撞不上闭栏条件的行）
      } else if (indent >= 4) {
        mask[i] = true; // GFM 缩进代码块（不在围栏内但缩进 ≥4 空格）
      } else {
        mask[i] = false;
      }
    }
  }
  return mask;
}

/** 把 content 里属于代码块（围栏/缩进）的行整行清空（保留行数不变，其余非代码内容原样保留）。 */
export function maskCodeLines(content: string): string {
  const lines = content.split('\n');
  const mask = computeCodeLineMask(content);
  return lines.map((l, i) => (mask[i] ? '' : l)).join('\n');
}

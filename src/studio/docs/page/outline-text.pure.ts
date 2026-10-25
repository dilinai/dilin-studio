// 左栏「目錄」那一行显示的字：markdown 标题去掉编辑器的行内标记，只留看得到的字
// （:color[字]{color=red}／:bg[…]{…}／:box[…]{…}／:font[…]{…} ⇒ 字；**粗**、*斜*、~~删~~、`码` ⇒ 字；[连结](网址) ⇒ 连结字）。
// 跟正文里那个标题的 textContent 一致，点目录跳过去才对得上。
export function outlineText(md: string): string {
  let s = md
  for (let i = 0; i < 4; i++) {
    const next = s.replace(/:(?:color|bg|box|font)\[((?:\\.|[^\]\\])*)\](?:\{[^}]*\})?/g, '$1')
    if (next === s) break
    s = next
  }
  s = s
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(\*|_)(.+?)\1/g, '$2')
    .replace(/~{2}(.+?)~{2}/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\\([\\\[\]{}*_`~#])/g, '$1')
  return s.trim()
}

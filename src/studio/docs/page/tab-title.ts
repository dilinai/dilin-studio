// 文件页浏览器分页标题：照站内其它编辑器（画板／剪辑 editorTabTitle）的写法「<标题> · <品牌>」；没标题就只写品牌。
//   品牌用字表 agent_dilin_name（台站「堤麟」·陆站「堤麟」·英文 Dilin）。题＝docs/__tests__/docs.test.ts。
export function docsTabTitle(title: string, brand: string): string {
  const s = (title || '').trim()
  return s ? `${s} · ${brand}` : brand
}

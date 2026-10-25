// 字体来源根网址
//   默认＝Google Fonts ＋ jsDelivr npm。陆版若两家都连不上·部署时设两个 NEXT_PUBLIC_ 变量指到自托管镜像（R2 上按同样目录结构放 css＋woff2 切片）·
//   catalog／load 一行不改。⛔ 只读 NEXT_PUBLIC_ 变量（区域判定同款口径·后端裸变量在客户端拿不到）。
//   镜像要求：Google 那条得能答 `/css2?family=…` 同形状的 css（或提前落成静态档同路径）；npm 那条按 `<包>@<版>/<档>` 路径放。

export function googleFontsBase(): string {
  const v = process.env.NEXT_PUBLIC_FONT_GOOGLE_BASE
  return (v && v.replace(/\/$/, '')) || 'https://fonts.googleapis.com'
}
export function npmCdnBase(): string {
  const v = process.env.NEXT_PUBLIC_FONT_NPM_CDN_BASE
  return (v && v.replace(/\/$/, '')) || 'https://cdn.jsdelivr.net/npm'
}

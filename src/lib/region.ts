// 地区判定（顶替网站的 core/lib/region.ts·同一个接口）：src/studio/shared/host.ts 从这里读。
//   tools/build.mjs 打包时把 NEXT_PUBLIC_DEPLOYMENT_REGION 代成 studio-oss.json 的 region（tw＝繁体站、cn＝简体站）。

export type Region = 'cn' | 'tw'

export function getRegion(): Region {
  return process.env.NEXT_PUBLIC_DEPLOYMENT_REGION === 'cn' ? 'cn' : 'tw'
}

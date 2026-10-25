// 只消費群組相容／取消的兩種既有 drops，頁面不顯示其中的內部編號。
export type ProjectGroupNotice = { projectId: string; repaired: boolean; review: boolean }
export type ProjectGroupNoticeSeen = Map<string, Set<string>>

/** 同程、同一原因只提醒一次；正常存讀或其它校形訊息不製造群組提示。
 *  簽名用舊群組／涉及片段，不用版次或新編號；自存換版與片段順序調整都不是新問題。 */
export function takeProjectGroupNotice(projectId: string, drops: unknown, seen: ProjectGroupNoticeSeen): ProjectGroupNotice | null {
  if (!projectId || !Array.isArray(drops)) return null
  const noted = seen.get(projectId) ?? new Set<string>()
  let repaired = false, review = false
  for (const reason of drops) {
    if (typeof reason !== 'string') continue
    const fixed = /^舊副本群組 (.+) 已換成相容編號 .+，成員保持不變$/.exec(reason)
    const check = /^片段 (.+) 的群組編號不合法，已取消群組$/.exec(reason)
    if (!fixed && !check) continue
    const signature = fixed ? `repaired:${fixed[1]}` : `review:${JSON.stringify(check![1].split('、').sort())}`
    if (noted.has(signature)) continue
    noted.add(signature)
    repaired ||= !!fixed; review ||= !!check
  }
  if (!repaired && !review) return null
  seen.set(projectId, noted)
  return { projectId, repaired, review }
}

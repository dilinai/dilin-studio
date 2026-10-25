// 剪輯工程共用編號契約：生成端與存讀端使用同一把尺，未擴大可接受字元或長度。
export const PROJECT_ID_MAX = 64
export const PROJECT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/

/** 副本的固定片段編號可直接作新群組編號；撞名才加尾碼，連尾碼也不超過工程上限。
 *  純函式：相同副本編號與既有群組得到同一結果。used 由呼叫方收齊，配出後亦由呼叫方登記。 */
export function unusedCopyGroupId(copyId: string, used: ReadonlySet<string>): string {
  const base = PROJECT_ID_RE.test(copyId) ? copyId : 'copy-group'
  let candidate = base
  for (let n = 1; used.has(candidate); n++) {
    const suffix = `_${n.toString(36)}`
    candidate = `${base.slice(0, PROJECT_ID_MAX - suffix.length)}${suffix}`
  }
  return candidate
}

/** 僅識別舊 Alt 補丁實際生成的形狀；還須由呼叫方核對該副本確在同組才能相容。
 *  尾碼為舊數字迴圈輸出的正安全整數，不收 0、前導零、任意冒號或一般非法ID。 */
export function legacyCopyGroupAnchor(group: string): string | null {
  const m = /^copy-group:([A-Za-z0-9_-]{1,64})(?::([1-9][0-9]{0,15}))?$/.exec(group)
  if (!m || (m[2] !== undefined && !Number.isSafeInteger(Number(m[2])))) return null
  return m[1]
}

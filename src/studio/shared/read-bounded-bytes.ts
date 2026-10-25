// 浏览器取图：边读边数字节·超上限立即 cancel（原在网站 Word 导出里·抽出来共用）
//   Word 导出（doc-export.ts）与简报 pptx 导出（aislides-pptx.ts）共用这一份·⛔ 各抄一份。
// 边读边计数、超顶立即 cancel——真正杜绝单次响应内存峰值。无 res.body(极老浏览器
// 不支持 streaming Response.body) 时退回整包读取+二次核验(残留同 v3 的有限风险·罕见环境兜底)。
// limit 由调用方按「单图上限 ∩ 文档剩余总预算」算好传入——剩余预算只剩 1MB 时
//   不该还允许把一张 10MB 的图整个读进来（读完必然被总预算拒，白吃一次内存峰值）。
export async function readBoundedBytes(res: Response, limit: number): Promise<Uint8Array | null> {
  const declaredLen = Number(res.headers.get('content-length') || '')
  if (Number.isFinite(declaredLen) && declaredLen > limit) return null
  if (!res.body) {
    const blob = await res.blob()
    if (blob.size > limit) return null
    return new Uint8Array(await blob.arrayBuffer())
  }
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) {
      total += value.byteLength
      if (total > limit) {
        await reader.cancel().catch(() => {})
        return null
      }
      chunks.push(value)
    }
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) { out.set(c, offset); offset += c.byteLength }
  return out
}

// 画板工程档（.dlcanvas／project.json 里那份引擎 JSON）的纯函数：分页拆合、档名、导出档名、放图位置、旧格式判定。
//   纯函数·isomorphic（sucrase 单测直载·⛔ @/ 别名）。登入版与游客版的画板页共用；
//   登入版只在服务端用的（档案外形核、大小上限、云盘放图网址、对话抬头）留在网站那边。ts。
//   档案格式：{ format:"dilin-canvas", version:1, createdBy, width, height, layers:[{ id, kind:raster|vector|text|group|smart, name, visible, opacity, blend, x, y, image?|data? … }] }

export const DRAWBOARD_EXT = '.dlcanvas'
export const DRAWBOARD_MIME = 'application/vnd.dilin.canvas+json'
export const DRAWBOARD_FORMAT = 'dilin-canvas'
export const DRAWBOARD_NAME_MAX = 80
/** 一份档最多几页（每页各自尺寸、名字） */
export const DRAWBOARD_PAGES_MAX = 100

export type DrawboardLayer = { id: string; kind: 'raster' | 'vector' | 'text' | 'group' | 'smart'; [k: string]: unknown }
/** 多页档：顶层＝第 1 页（旧档、旧画板照读得懂）·pageName＝第 1 页的名字（可无）·
 *  pages＝第 2 页起，每项是一份完整的单页工程档（format／version／width／height／layers…）另加 name。⛔ 页里再套 pages。 */
export type DrawboardPage = { format: typeof DRAWBOARD_FORMAT; version: number; width: number; height: number; layers: DrawboardLayer[]; name?: string; [k: string]: unknown }
export type DrawboardProject = { format: typeof DRAWBOARD_FORMAT; version: number; width: number; height: number; layers: DrawboardLayer[]; pageName?: string; pages?: DrawboardPage[]; [k: string]: unknown }

/** 多页：一份档 ⇒ 逐页（第 1 页＝顶层去掉 pageName／pages）·名字没有＝null */
export function splitDrawboardPages(p: DrawboardProject): { name: string | null; project: DrawboardProject }[] {
  const { pages, pageName, ...first } = p
  const out: { name: string | null; project: DrawboardProject }[] = [{ name: typeof pageName === 'string' && pageName ? pageName : null, project: first as DrawboardProject }]
  for (const pg of Array.isArray(pages) ? pages : []) {
    const { name, ...rest } = pg
    out.push({ name: typeof name === 'string' && name ? name : null, project: rest as DrawboardProject })
  }
  return out
}
/** 逐页 ⇒ 一份档（只有一页 ⇒ 跟旧档一模一样·没名字就不写 pageName）。各页自带的 pages／pageName 一律拿掉（⛔ 页里套页） */
export function joinDrawboardPages(list: readonly { name: string | null; project: unknown }[]): DrawboardProject {
  const clean = (x: unknown): Record<string, unknown> => {
    const o = { ...(x as Record<string, unknown>) }
    delete o.pages; delete o.pageName; delete o.name
    return o
  }
  const head = { ...clean(list[0]?.project) } as DrawboardProject
  if (list[0]?.name) head.pageName = list[0].name
  if (list.length > 1) head.pages = list.slice(1).map((pg) => ({ ...clean(pg.project), ...(pg.name ? { name: pg.name } : {}) }) as DrawboardPage)
  return head
}
/** 分页列上那一页的标签：没名字＝档名；有名字＝「档名 · 页名」（看得出是哪份档的哪一页） */
export function drawboardPageLabel(fileLabel: string, pageName: string | null): string {
  return pageName ? `${fileLabel} · ${pageName}` : fileLabel
}
/** 新页缺省名（照画板语言） */
export function defaultPageName(lang: string | null | undefined, n: number): string {
  return lang === 'en' ? `Page ${n}` : lang === 'zh-Hans' ? `第 ${n} 页` : `第 ${n} 頁`
}

/** 档名 ⇒ 画板名（去掉 .dlcanvas） */
export function drawboardTitle(fileName: string): string {
  const n = fileName.trim()
  return n.toLowerCase().endsWith(DRAWBOARD_EXT) ? n.slice(0, -DRAWBOARD_EXT.length) : n
}
export const isDrawboardFileName = (name: string | null | undefined): boolean => !!name && name.toLowerCase().endsWith(DRAWBOARD_EXT)
/** 画板名 ⇒ 档名可用的字（去斜线等·空 ⇒ 缺省名） */
export function safeDrawboardName(raw: string, fallback: string): string {
  const s = raw.replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, DRAWBOARD_NAME_MAX)
  return s || fallback
}
/** 导出 PNG 的档名：<画板名>.png ／ <画板名>@2x.png
 *  file.exportPNG 带了 name ⇒ 照 name 存（尾巴的 .png 先拿掉再补·不合法字元换空白；清完空了才退回画板名）——同画板本体 exportPNG(scale, name) 的拼法 */
export function exportPngName(title: string, scale: number, name?: string | null): string {
  const want = typeof name === 'string' ? safeDrawboardName(name.trim().replace(/\.png$/i, ''), '') : ''
  const base = want || safeDrawboardName(title, 'drawboard')
  return scale === 1 ? `${base}.png` : `${base}@${scale}x.png`
}

/** 放得进画板当像素层的图档种类（⛔ SVG：同源送出去等于开一个跑脚本的口） */
export const DRAWBOARD_IMAGE_MIMES: readonly string[] = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']
export const isDrawboardImage = (mime: string | null | undefined, name?: string | null): boolean =>
  (!!mime && DRAWBOARD_IMAGE_MIMES.includes(mime.toLowerCase())) || (!mime && !!name && /\.(png|jpe?g|webp|gif|avif)$/i.test(name))

/** 拖进画布那张图的左上角（文件 px）：图心对准放手那点；图跟画板 layer.addImageFromURL 同一套缩法（大过画布就等比缩进来·不放大）；
 *  左上角夹在画布里（⛔ 整张掉到画布外看不到）。iw/ih＝原图尺寸·dw/dh＝画布尺寸。 */
export function dropTopLeft(point: readonly [number, number], iw: number, ih: number, dw: number, dh: number): { x: number; y: number; w: number; h: number } {
  const k = Math.min(dw / iw, dh / ih, 1)
  const w = iw * k, h = ih * k
  const clampN = (v: number, hi: number) => Math.round(Math.min(Math.max(v, 0), Math.max(0, hi)))
  return { x: clampN(point[0] - w / 2, dw - w), y: clampN(point[1] - h / 2, dh - h), w, h }
}

/** PNG dataURL 的宽高（只解档头 IHDR 那 24 个字节·不解整张图）；不是 PNG／坏的 ⇒ null */
export function pngDataUrlSize(url: unknown): [number, number] | null {
  if (typeof url !== 'string') return null
  const m = /^data:image\/png;base64,/i.exec(url)
  if (!m) return null
  const head = url.slice(m[0].length, m[0].length + 32)
  if (head.length < 32) return null
  let bin: string
  try { bin = atob(head) } catch { return null }
  if (bin.length < 24 || bin.slice(12, 16) !== 'IHDR') return null
  const u32 = (i: number) => ((bin.charCodeAt(i) << 24) >>> 0) + (bin.charCodeAt(i + 1) << 16) + (bin.charCodeAt(i + 2) << 8) + bin.charCodeAt(i + 3)
  const w = u32(16), h = u32(20)
  return w > 0 && h > 0 ? [w, h] : null
}

/** 这一页是不是旧格式——画板载档会把「大片透明的整张大像素层」裁成内容那块，
 *  所以只要有像素层载进来的画布比存档里那张 PNG 小，就是旧格式（存回一次就只存内容那块、下次开快）。
 *  新格式（存的本来就是内容那块）载进来一样大 ⇒ false（⛔ 每开一次就转一次）；带蒙版等不裁的层也一样大 ⇒ 不算。
 *  live＝载完后这一层的画布宽高（照 id 找·找不到＝不算）。 */
export function drawboardOldLayout(page: unknown, live: (id: string) => readonly [number, number] | null): boolean {
  const layers = (page as { layers?: unknown } | null)?.layers
  if (!Array.isArray(layers)) return false
  for (const o of layers as Array<Record<string, unknown>>) {
    if (!o || o.kind !== 'raster' || typeof o.id !== 'string') continue
    const png = pngDataUrlSize(o.image)
    if (!png) continue
    const now = live(o.id)
    if (now && (now[0] < png[0] || now[1] < png[1])) return true
  }
  return false
}

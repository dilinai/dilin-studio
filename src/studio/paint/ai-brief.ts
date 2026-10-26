// Dilin Studio · Paint — the format notes the "copy for your AI" block appends after
// "which editor this is / which folder" (short; from FORMAT.md). No third-party product or service names.
import type { StudioLang } from '../shared/types'

const NOTES: Record<StudioLang, string> = {
  'zh-TW': `這是「畫板」（像素＋向量的繪圖編輯器）。請直接改資料夾裡的 project.json：
- 開頭固定 "format": "dilin-studio/paint", "version": 1；width／height 是畫布像素；layers 由下往上排。
- 每層有 id（唯一）、kind（raster 像素／text 文字／vector 向量／group 圖層組／smart 智慧型物件）、name、visible、opacity（0–1）、blend（normal、multiply、screen、overlay…）、x、y。
- 像素層的 image 寫 "assets/檔名.png"，圖檔放在 assets/。加圖：把圖放進 assets/，新增一層 {"id":"新 id","kind":"raster","name":"…","visible":true,"opacity":1,"blend":"normal","x":0,"y":0,"image":"assets/你的圖.png"}。
- 文字層 data：{"x","y","text","size","font","color","align","weight"}；向量層 data.shapes：[{"id","type":"rect|ellipse|path|…","x","y","w","h","fill","stroke","strokeWidth"}]；三角形用 {"type":"path","points":[[x,y],[x,y],[x,y]],"closed":true}。最底下保留白色 Background 層。不確定的欄位照現有圖層抄。
- 改字：直接改那個文字層 data 的 text（字號、字型、顏色改 size／font／color），改圖層名改 name；別在網頁畫布上用滑鼠點文字工具再打字（自動操作時鍵盤焦點不可靠，字會漏、圖層名也不會跟著改）。
- 編輯器存檔時會把圖改存成以內容命名的檔（16 個十六進位字元），你取名的檔不會被刪。
改好存檔，網頁一兩秒內就會更新；更新後資料夾裡的 project.check.json 會列出畫不出來的（errors）和沒被讀到的欄位（warnings），請讀它確認，有錯就照 hint 改；preview.png 是畫出來的樣子，project.layout.json 是每層實際佔的範圍（像素 [x0,y0,x1,y1]、有沒有超出畫布），對位置、大小要看它。`,
  'zh-CN': `这是「画板」（像素＋矢量的绘图编辑器）。请直接改文件夹里的 project.json：
- 开头固定 "format": "dilin-studio/paint", "version": 1；width／height 是画布像素；layers 由下往上排。
- 每层有 id（唯一）、kind（raster 像素／text 文字／vector 矢量／group 图层组／smart 智能对象）、name、visible、opacity（0–1）、blend（normal、multiply、screen、overlay…）、x、y。
- 像素层的 image 写 "assets/文件名.png"，图片放在 assets/。加图：把图放进 assets/，新增一层 {"id":"新 id","kind":"raster","name":"…","visible":true,"opacity":1,"blend":"normal","x":0,"y":0,"image":"assets/你的图.png"}。
- 文字层 data：{"x","y","text","size","font","color","align","weight"}；矢量层 data.shapes：[{"id","type":"rect|ellipse|path|…","x","y","w","h","fill","stroke","strokeWidth"}]；三角形用 {"type":"path","points":[[x,y],[x,y],[x,y]],"closed":true}。最底下保留白色 Background 层。不确定的栏位照现有图层抄。
- 改字：直接改那个文字层 data 的 text（字号、字体、颜色改 size／font／color），改图层名改 name；别在网页画布上用鼠标点文字工具再打字（自动操作时键盘焦点不可靠，字会漏、图层名也不会跟着改）。
- 编辑器存档时会把图改存成以内容命名的文件（16 个十六进制字符），你取名的文件不会被删。
改好存档，网页一两秒内就会更新；更新后文件夹里的 project.check.json 会列出画不出来的（errors）和没被读到的栏位（warnings），请读它确认，有错就照 hint 改；preview.png 是画出来的样子，project.layout.json 是每层实际占的范围（像素 [x0,y0,x1,y1]、有没有超出画布），对位置、大小要看它。`,
  en: `This is "Paint" (a raster + vector drawing editor). Edit project.json in the folder directly:
- It starts with "format": "dilin-studio/paint", "version": 1; width/height are the canvas size in pixels; "layers" go bottom to top.
- Each layer has id (unique), kind (raster / text / vector / group / smart), name, visible, opacity (0–1), blend (normal, multiply, screen, overlay, …), x, y.
- A raster layer's "image" is "assets/<file>.png" and the file lives in assets/. To add a picture: put it in assets/ and add a layer {"id":"a new id","kind":"raster","name":"…","visible":true,"opacity":1,"blend":"normal","x":0,"y":0,"image":"assets/your-picture.png"}.
- Text layer "data": {"x","y","text","size","font","color","align","weight"}; vector layer "data.shapes": [{"id","type":"rect|ellipse|path|…","x","y","w","h","fill","stroke","strokeWidth"}]; a triangle is {"type":"path","points":[[x,y],[x,y],[x,y]],"closed":true}. Keep the white Background layer at the bottom. When unsure about a field, copy an existing layer.
- To change words: edit that text layer's data.text (and size / font / color for the look); to rename it, change name. Do not click the text tool on the web canvas and type: under automated control keyboard focus is unreliable, letters get lost and the layer name does not follow.
- When the editor saves, pictures are re-saved under content names (16 hex characters); files you named are never deleted.
Save when done; the page updates within a second or two. Then read project.check.json in the folder: "errors" will not show, "warnings" are fields that are not read — fix them as the "hint" says. preview.png is what was drawn; project.layout.json gives each layer's real box in canvas pixels [x0, y0, x1, y1] and whether it is off the canvas — use it to check positions and sizes.`,
}

export const paintFormatNotes = (lang: StudioLang): string => NOTES[lang]

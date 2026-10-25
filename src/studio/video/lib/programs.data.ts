// 网页剪辑页·网站自带的程序包（程序片段轨·样例「花字标题弹入」·名字与参数标签三语）。
// 使用者上传的包另存本机（vedit-program.ts）；这里的包随网站版本走。
import type { ProgramBundle } from './program.pure'

const TITLE_POP_HTML = "<!doctype html><html><head><meta charset=\"utf-8\"><style>\nhtml,body{margin:0;width:100%;height:100%;background:transparent;overflow:hidden}\ncanvas{display:block;width:100%;height:100%}\n</style></head><body><canvas id=\"c\"></canvas><script>\n// 堤麟程序片段样例：只按 t 画，不用真实时钟\nconst cv = document.getElementById('c'), g = cv.getContext('2d');\nconst easeOutBack = x => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };\nconst clamp = (v, a, b) => Math.min(b, Math.max(a, v));\nwindow.dilinProgram = {\n  render(t, p, size) {\n    const w = size.w, h = size.h; cv.width = w; cv.height = h; g.clearRect(0, 0, w, h);\n    const text = String(p.text ?? '堤麟AI'), color = p.color || '#FFD25A';\n    const fs = (+p.size || 140) * h / 1080, sp = +p.speed || 1, style = p.style || 'pop';\n    const chars = [...text]; g.font = `900 ${fs}px \"Noto Sans CJK SC\",\"Noto Sans CJK TC\",sans-serif`;\n    g.textBaseline = 'middle'; g.lineJoin = 'round';\n    const widths = chars.map(ch => g.measureText(ch).width), total = widths.reduce((a, b) => a + b, 0);\n    let x = (w - total) / 2; const y = h / 2;\n    chars.forEach((ch, i) => {\n      const k = clamp((t * sp - i * 0.08) / 0.45, 0, 1);\n      if (style === 'type' && k <= 0) { x += widths[i]; return; }\n      let sc = 1, dy = 0, a = 1;\n      if (style === 'pop') { sc = easeOutBack(k); a = clamp(k * 3, 0, 1); }\n      else if (style === 'slide') { dy = (1 - easeOutBack(k)) * h * 0.25; a = k; }\n      else { a = 1; }\n      g.save(); g.globalAlpha = a; g.translate(x + widths[i] / 2, y + dy); g.scale(sc, sc);\n      g.lineWidth = fs * 0.14; g.strokeStyle = '#1a1208'; g.strokeText(ch, -widths[i] / 2, 0);\n      g.fillStyle = color; g.fillText(ch, -widths[i] / 2, 0);\n      g.restore(); x += widths[i];\n    });\n  }\n};\n</script></body></html>\n"

export const BUILTIN_PROGRAMS: ProgramBundle[] = [
  {
    id: 'b-title-pop',
    builtin: true,
    html: TITLE_POP_HTML,
    manifest: {
      name: { tw: '花字標題·彈入', cn: '花字标题·弹入', en: 'Title pop-in' },
      version: '1',
      engine: 'html',
      entry: 'index.html',
      defaultLength: 3,
      alpha: true,
      params: [
        { key: 'text', label: { tw: '文字', cn: '文字', en: 'Text' }, type: 'text', default: '堤麟AI' },
        { key: 'color', label: { tw: '字色', cn: '字色', en: 'Color' }, type: 'color', default: '#FFD25A' },
        { key: 'size', label: { tw: '字號', cn: '字号', en: 'Size' }, type: 'number', default: 140, min: 40, max: 300, step: 2 },
        { key: 'speed', label: { tw: '快慢', cn: '快慢', en: 'Speed' }, type: 'number', default: 1, min: 0.3, max: 3, step: 0.1 },
        { key: 'style', label: { tw: '出場', cn: '出场', en: 'Entrance' }, type: 'select', default: 'pop', options: [
          { value: 'pop', label: { tw: '彈入', cn: '弹入', en: 'Pop' } },
          { value: 'slide', label: { tw: '滑入', cn: '滑入', en: 'Slide' } },
          { value: 'type', label: { tw: '打字', cn: '打字', en: 'Type' } },
        ] },
      ],
    },
  },
]
const BY_ID = new Map(BUILTIN_PROGRAMS.map((b) => [b.id, b]))
export const builtinProgram = (id: string | undefined): ProgramBundle | null => (id ? BY_ID.get(id) ?? null : null)

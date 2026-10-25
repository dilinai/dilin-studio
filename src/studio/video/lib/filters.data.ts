// 滤镜库（62 款 15 类·JS／WebGL 逐像素差≤1/255）·缩图转 JPEG 放 public/vedit/filters/<id>.jpg·接法在 filter.pure.ts。
// 堤麟剪辑页「滤镜库」——自调。名字与参数都是自己定的，没照抄剪映。
// 同一套数学两种跑法：
//   applyFilter(gl, tex, params, strength, opts)   → WebGL2 实时（播放器）与逐帧汇出
//   applyFilterToImageData(img, params, strength)   → 纯 JS 逐像素（预览缩图、无 WebGL 时退路）
// 两边逐步对齐（同顺序、同常数、同整数噪声），同一张图最大差 ≤ 2/255。强度 0 ＝ 原片。

export type FilterCat =
  | 'hot' | 'new' | 'portrait' | 'landscape' | 'food' | 'night' | 'cinema' | 'film'
  | 'mono' | 'camera' | 'stylized' | 'indoor' | 'outdoor' | 'basic' | 'season'

export const FILTER_CATS: { id: FilterCat; tw: string; cn: string; en: string }[] = [
  { id: 'hot', tw: '熱門', cn: '热门', en: 'Popular' },
  { id: 'new', tw: '最新', cn: '最新', en: 'New' },
  { id: 'portrait', tw: '人像', cn: '人像', en: 'Portrait' },
  { id: 'landscape', tw: '風景', cn: '风景', en: 'Landscape' },
  { id: 'food', tw: '美食', cn: '美食', en: 'Food' },
  { id: 'night', tw: '夜景', cn: '夜景', en: 'Night' },
  { id: 'cinema', tw: '影視級', cn: '影视级', en: 'Cinematic' },
  { id: 'film', tw: '復古膠片', cn: '复古胶片', en: 'Vintage Film' },
  { id: 'mono', tw: '黑白', cn: '黑白', en: 'Mono' },
  { id: 'camera', tw: '相機模擬', cn: '相机模拟', en: 'Camera' },
  { id: 'stylized', tw: '風格化', cn: '风格化', en: 'Stylized' },
  { id: 'indoor', tw: '室內', cn: '室内', en: 'Indoor' },
  { id: 'outdoor', tw: '戶外', cn: '户外', en: 'Outdoor' },
  { id: 'basic', tw: '基礎', cn: '基础', en: 'Basic' },
  { id: 'season', tw: '季節', cn: '季节', en: 'Seasons' },
]

/** 全部可省略，省略＝0（不动）。范围：曝光／对比／饱和／色温／色调／高光／阴影 -1～1；褪色／暗角／颗粒／锐化／分色强度 0～1。 */
export type FilterParams = {
  exposure?: number     // 曝光（档，±1＝×2／÷2）
  contrast?: number     // 对比（以 0.5 为轴）
  saturation?: number   // 饱和（-1＝黑白）
  temperature?: number  // 色温（+暖 −冷）
  tint?: number         // 色调（+洋红 −绿）
  highlights?: number   // 高光（只动亮部）
  shadows?: number      // 阴影（只动暗部）
  fade?: number         // 褪色／抬黑
  vignette?: number     // 暗角
  grain?: number        // 颗粒（整数噪声，seed 换帧就变）
  sharpen?: number      // 锐化（上下左右四邻）
  split?: { highlight: string; shadow: string; amount: number } // 分色：高光色／阴影色（#rrggbb）＋强度
}
export type FilterItem = { id: string; name: { tw: string; cn: string; en: string }; cats: FilterCat[]; sample: 'portrait' | 'landscape'; params: FilterParams }

const F = (id: string, tw: string, cn: string, en: string, cats: FilterCat[], sample: 'portrait' | 'landscape', params: FilterParams): FilterItem =>
  ({ id, name: { tw, cn, en }, cats, sample, params })
const sp = (highlight: string, shadow: string, amount: number) => ({ highlight, shadow, amount })

export const FILTERS: FilterItem[] = [
  // ── 基础 ──
  F('crisp', '清透', '清透', 'Crisp', ['basic', 'hot'], 'landscape', { sharpen: 0.4, contrast: 0.08, saturation: 0.05 }),
  F('brighten', '提亮', '提亮', 'Brighten', ['basic'], 'portrait', { exposure: 0.2, shadows: 0.2 }),
  F('vivid', '鮮活', '鲜活', 'Vivid', ['basic', 'outdoor', 'hot'], 'landscape', { saturation: 0.3, contrast: 0.12 }),
  F('soft', '柔和', '柔和', 'Soft', ['basic', 'portrait'], 'portrait', { contrast: -0.15, highlights: -0.15, fade: 0.15 }),
  F('warm-touch', '暖意', '暖意', 'Warm Touch', ['basic', 'indoor'], 'portrait', { temperature: 0.25 }),
  F('cool-touch', '涼意', '凉意', 'Cool Touch', ['basic'], 'landscape', { temperature: -0.25 }),
  F('balanced', '均衡', '均衡', 'Balanced', ['basic'], 'landscape', { contrast: 0.05, highlights: -0.2, shadows: 0.15 }),

  // ── 人像 ──
  F('milky-skin', '奶霧膚', '奶雾肤', 'Milky Skin', ['portrait', 'hot'], 'portrait', { exposure: 0.12, saturation: -0.1, temperature: 0.05, tint: 0.05, fade: 0.1, highlights: -0.1 }),
  F('peach', '蜜桃', '蜜桃', 'Peach', ['portrait', 'new'], 'portrait', { temperature: 0.12, tint: 0.12, saturation: 0.05, exposure: 0.08 }),
  F('porcelain', '瓷白', '瓷白', 'Porcelain', ['portrait'], 'portrait', { exposure: 0.15, saturation: -0.2, temperature: -0.1, contrast: 0.05 }),
  F('sun-kissed', '日吻', '日吻', 'Sun-kissed', ['portrait', 'outdoor', 'season'], 'portrait', { temperature: 0.3, saturation: 0.1, split: sp('#ffcf8a', '#6a4a3a', 0.2) }),
  F('studio', '棚拍', '棚拍', 'Studio', ['portrait', 'indoor'], 'portrait', { contrast: 0.15, sharpen: 0.3, saturation: -0.05, vignette: 0.2 }),
  F('dewy', '晨露', '晨露', 'Dewy', ['portrait'], 'portrait', { exposure: 0.1, contrast: -0.1, saturation: 0.08, temperature: -0.05, highlights: 0.1 }),
  F('latte', '奶咖', '奶咖', 'Latte', ['portrait', 'indoor'], 'portrait', { temperature: 0.15, saturation: -0.15, fade: 0.2, split: sp('#f3dcc0', '#5a4636', 0.25) }),
  F('pink-haze', '粉霧', '粉雾', 'Pink Haze', ['portrait', 'stylized'], 'portrait', { tint: 0.2, fade: 0.2, exposure: 0.1, saturation: -0.05 }),

  // ── 风景 ──
  F('azure', '碧空', '碧空', 'Azure Sky', ['landscape', 'outdoor', 'hot'], 'landscape', { temperature: -0.15, saturation: 0.2, contrast: 0.1, highlights: -0.2 }),
  F('emerald', '青嶂', '青嶂', 'Emerald Hills', ['landscape'], 'landscape', { tint: -0.1, saturation: 0.15, shadows: 0.1 }),
  F('golden-hour', '金時', '金时', 'Golden Hour', ['landscape', 'outdoor', 'cinema'], 'landscape', { temperature: 0.35, saturation: 0.15, contrast: 0.1, split: sp('#ffb85c', '#3a2a5a', 0.2) }),
  F('mist', '嵐霧', '岚雾', 'Mist', ['landscape', 'season'], 'landscape', { contrast: -0.2, fade: 0.25, saturation: -0.2, temperature: -0.05 }),
  F('clear-day', '晴朗', '晴朗', 'Clear Day', ['landscape', 'outdoor'], 'landscape', { exposure: 0.05, contrast: 0.15, saturation: 0.15, sharpen: 0.25 }),
  F('deep-blue', '深藍', '深蓝', 'Deep Blue', ['landscape', 'stylized'], 'landscape', { temperature: -0.3, saturation: 0.1, shadows: -0.1, contrast: 0.1 }),
  F('highland', '高原', '高原', 'Highland', ['landscape', 'outdoor'], 'landscape', { contrast: 0.2, saturation: 0.25, highlights: -0.3, shadows: 0.15, sharpen: 0.2 }),

  // ── 美食 ──
  F('savory', '鮮香', '鲜香', 'Savory', ['food', 'hot'], 'portrait', { temperature: 0.15, saturation: 0.25, contrast: 0.1, sharpen: 0.2 }),
  F('bakery', '烘焙', '烘焙', 'Bakery', ['food', 'indoor'], 'portrait', { temperature: 0.25, fade: 0.1, exposure: 0.08, saturation: 0.05 }),
  F('fresh-greens', '鮮蔬', '鲜蔬', 'Fresh Greens', ['food'], 'landscape', { tint: -0.12, saturation: 0.2, exposure: 0.08 }),
  F('dessert', '甜點', '甜点', 'Dessert', ['food', 'new'], 'portrait', { exposure: 0.15, tint: 0.08, saturation: -0.05, contrast: -0.05 }),
  F('night-market', '夜市', '夜市', 'Night Market', ['food', 'night'], 'portrait', { temperature: 0.2, saturation: 0.3, contrast: 0.15, shadows: -0.1, vignette: 0.25 }),
  F('tea-house', '茶屋', '茶屋', 'Tea House', ['food', 'indoor', 'film'], 'portrait', { temperature: 0.1, saturation: -0.15, fade: 0.15, split: sp('#e8d9b0', '#3c4a3a', 0.2) }),

  // ── 夜景 ──
  F('neon-city', '霓城', '霓城', 'Neon City', ['night', 'stylized', 'hot'], 'portrait', { temperature: -0.15, tint: 0.15, saturation: 0.3, contrast: 0.15, split: sp('#ff7ad9', '#2a3cff', 0.3) }),
  F('moonlight', '月光', '月光', 'Moonlight', ['night'], 'landscape', { temperature: -0.35, saturation: -0.25, exposure: -0.05, contrast: 0.1 }),
  F('lamplight', '燈火', '灯火', 'Lamplight', ['night', 'indoor'], 'portrait', { temperature: 0.3, shadows: 0.1, saturation: 0.1, vignette: 0.2 }),
  F('midnight', '子夜', '子夜', 'Midnight', ['night', 'cinema'], 'landscape', { exposure: -0.1, contrast: 0.2, temperature: -0.2, highlights: 0.1, shadows: -0.15, vignette: 0.3 }),
  F('starry', '星夜', '星夜', 'Starry Night', ['night', 'new'], 'landscape', { temperature: -0.2, tint: 0.05, shadows: 0.2, saturation: 0.1, grain: 0.15 }),
  F('cyber', '賽博', '赛博', 'Cyber', ['night', 'stylized'], 'portrait', { temperature: -0.1, tint: -0.15, saturation: 0.35, contrast: 0.2, split: sp('#00ffd0', '#ff2a8a', 0.3) }),

  // ── 影视级 ──
  F('teal-amber', '青琥', '青琥', 'Teal & Amber', ['cinema', 'hot'], 'portrait', { contrast: 0.15, saturation: -0.05, split: sp('#ffb066', '#1f6f7a', 0.45) }),
  F('blue-hour', '藍調', '蓝调', 'Blue Hour', ['cinema'], 'landscape', { temperature: -0.2, contrast: 0.15, saturation: -0.15, vignette: 0.25 }),
  F('epic', '史詩', '史诗', 'Epic', ['cinema', 'outdoor'], 'landscape', { contrast: 0.25, saturation: -0.1, highlights: -0.2, shadows: -0.1, vignette: 0.35, sharpen: 0.2 }),
  F('wasteland', '荒原', '荒原', 'Wasteland', ['cinema', 'stylized'], 'landscape', { temperature: 0.25, saturation: -0.25, contrast: 0.15, fade: 0.1, grain: 0.15 }),
  F('drama', '劇場', '剧场', 'Drama', ['cinema'], 'portrait', { contrast: 0.3, saturation: -0.2, exposure: -0.05, vignette: 0.4 }),
  F('indie', '獨立', '独立', 'Indie', ['cinema', 'film', 'new'], 'portrait', { fade: 0.2, saturation: -0.15, temperature: 0.05, split: sp('#f0e2c0', '#2e4a5a', 0.3) }),

  // ── 复古胶片 ──
  F('warm-stock', '暖片', '暖片', 'Warm Stock', ['film', 'hot'], 'portrait', { temperature: 0.2, fade: 0.15, grain: 0.25, saturation: 0.05, split: sp('#ffd8a0', '#3a3050', 0.2) }),
  F('cool-stock', '冷片', '冷片', 'Cool Stock', ['film'], 'landscape', { temperature: -0.15, tint: -0.05, fade: 0.15, grain: 0.25 }),
  F('old-days', '舊時光', '旧时光', 'Old Days', ['film', 'season'], 'portrait', { fade: 0.3, saturation: -0.25, temperature: 0.15, grain: 0.2, vignette: 0.2 }),
  F('instant', '即顯', '即显', 'Instant', ['film', 'camera'], 'portrait', { exposure: 0.1, fade: 0.25, contrast: -0.1, temperature: 0.1, tint: 0.05, vignette: 0.15 }),
  F('cross-process', '交叉沖印', '交叉冲印', 'Cross Process', ['film', 'stylized'], 'landscape', { contrast: 0.2, saturation: 0.15, split: sp('#fff08a', '#2a5aa0', 0.4) }),
  F('dusty', '微塵', '微尘', 'Dusty', ['film'], 'landscape', { grain: 0.4, fade: 0.2, saturation: -0.1 }),

  // ── 黑白 ──
  F('mono-classic', '經典黑白', '经典黑白', 'Classic B&W', ['mono', 'basic'], 'portrait', { saturation: -1, contrast: 0.15 }),
  F('mono-soft', '灰調', '灰调', 'Soft Gray', ['mono'], 'landscape', { saturation: -1, contrast: -0.15, fade: 0.2 }),
  F('mono-hard', '硬調', '硬调', 'Hard B&W', ['mono', 'cinema'], 'portrait', { saturation: -1, contrast: 0.45, sharpen: 0.3, vignette: 0.3 }),
  F('sepia', '褐調', '褐调', 'Sepia', ['mono', 'film'], 'portrait', { saturation: -1, split: sp('#f1d29a', '#4a3222', 0.6) }),
  F('cold-mono', '冷黑白', '冷黑白', 'Cold Mono', ['mono'], 'landscape', { saturation: -1, contrast: 0.1, split: sp('#dfe9f2', '#24323e', 0.4) }),
  F('grainy-mono', '粗粒黑白', '粗粒黑白', 'Grainy B&W', ['mono', 'film'], 'portrait', { saturation: -1, contrast: 0.2, grain: 0.45 }),

  // ── 相机模拟（不用任何品牌名）──
  F('old-ccd', '舊數位', '旧数码', 'Old CCD', ['camera', 'new'], 'portrait', { sharpen: 0.4, saturation: 0.15, temperature: -0.05, highlights: 0.15, contrast: 0.1 }),
  F('disposable', '拋棄式', '一次性', 'Disposable', ['camera'], 'portrait', { exposure: 0.1, saturation: 0.2, contrast: 0.1, grain: 0.3, vignette: 0.3, temperature: 0.1 }),
  F('rangefinder', '旁軸', '旁轴', 'Rangefinder', ['camera'], 'landscape', { contrast: 0.15, saturation: -0.1, grain: 0.15, vignette: 0.2, split: sp('#f4e6c8', '#28343c', 0.15) }),
  F('hdr', '高動態', '高动态', 'HDR', ['camera', 'outdoor'], 'landscape', { highlights: -0.4, shadows: 0.4, saturation: 0.1, sharpen: 0.3 }),
  F('home-video', '家用攝影機', '家用摄像机', 'Home Video', ['camera'], 'portrait', { saturation: 0.1, sharpen: 0.2, contrast: -0.05, fade: 0.1, temperature: 0.08 }),
  F('toy-camera', '玩具相機', '玩具相机', 'Toy Camera', ['camera', 'stylized'], 'landscape', { saturation: 0.3, contrast: 0.25, vignette: 0.6 }),

  // ── 季节 ──
  F('autumn', '楓紅秋', '枫红秋', 'Autumn Maple', ['season', 'landscape', 'hot'], 'landscape', { temperature: 0.3, tint: 0.05, saturation: 0.2, split: sp('#ffc070', '#5a2a1a', 0.2) }),
  F('winter', '冬雪', '冬雪', 'Winter Snow', ['season'], 'landscape', { temperature: -0.25, exposure: 0.1, saturation: -0.15, highlights: 0.1 }),
  F('spring', '春櫻', '春樱', 'Spring Bloom', ['season', 'new'], 'portrait', { tint: 0.1, exposure: 0.1, saturation: 0.1, temperature: 0.05 }),
  F('midsummer', '盛夏', '盛夏', 'Midsummer', ['season', 'outdoor'], 'landscape', { saturation: 0.3, contrast: 0.15, temperature: 0.1, exposure: 0.05 }),
]

// ════════════════ 数学（GLSL 与 JS 同一套，改一边要改另一边）════════════════
// 顺序：锐化 → 曝光 → 色温色调 → 对比 → 高光阴影 → 饱和 → 分色 → 褪色 → 暗角 → 颗粒 → 夹到 0～1 → 按强度与原片混合。

export const FILTER_VERT = `#version 300 es
in vec2 aPos; out vec2 vUv;
void main(){ vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5); gl_Position = vec4(aPos, 0.0, 1.0); }`
// vUv 的 y 往下（第 0 行＝图片最上面一行）：上传纹理时 ⛔ 不要 UNPACK_FLIP_Y，画到画布上自然是正的。

export const FILTER_FRAG = `#version 300 es
precision highp float; precision highp int;
in vec2 vUv; out vec4 outColor;
uniform sampler2D uTex;
uniform float uExposure, uContrast, uSaturation, uTemp, uTint, uHigh, uShadow, uFade, uVignette, uGrain, uSharpen, uSplit, uStrength;
uniform vec3 uSplitHi, uSplitSh;
uniform uint uSeed;
float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float grainAt(ivec2 p){
  uint h = uint(p.x) * 1973u + uint(p.y) * 9277u + uSeed * 26699u;
  h ^= h >> 16; h *= 0x7feb352du; h ^= h >> 15; h *= 0x846ca68bu; h ^= h >> 16;
  return float(h & 0xffffu) / 65535.0 - 0.5;
}
void main(){
  vec2 ts = vec2(textureSize(uTex, 0));
  vec2 px = 1.0 / ts;
  vec3 src = texture(uTex, vUv).rgb;
  vec3 c = src;
  if (uSharpen > 0.0) {
    vec3 n = texture(uTex, vUv + vec2(px.x, 0.0)).rgb + texture(uTex, vUv - vec2(px.x, 0.0)).rgb
           + texture(uTex, vUv + vec2(0.0, px.y)).rgb + texture(uTex, vUv - vec2(0.0, px.y)).rgb;
    c = c + (c - n * 0.25) * (uSharpen * 1.5);
  }
  c *= exp2(uExposure);
  c += vec3(uTemp * 0.1 + uTint * 0.03, -uTint * 0.08, -uTemp * 0.1 + uTint * 0.03);
  c = (c - 0.5) * (1.0 + uContrast) + 0.5;
  float l = luma(c);
  c += uShadow * 0.35 * (1.0 - smoothstep(0.0, 0.55, l)) + uHigh * 0.35 * smoothstep(0.45, 1.0, l);
  l = luma(c);
  c = mix(vec3(l), c, 1.0 + uSaturation);
  if (uSplit > 0.0) { l = clamp(luma(c), 0.0, 1.0); c += (uSplitSh - 0.5) * (uSplit * 0.6 * (1.0 - l)) + (uSplitHi - 0.5) * (uSplit * 0.6 * l); }
  c = c * (1.0 - uFade * 0.3) + uFade * 0.25;
  float d = length(vUv - 0.5) * 1.41421356;
  c *= 1.0 - uVignette * 0.7 * smoothstep(0.35, 0.85, d);
  if (uGrain > 0.0) c += grainAt(ivec2(floor(vUv * ts))) * (uGrain * 0.12);
  c = clamp(c, 0.0, 1.0);
  outColor = vec4(mix(src, c, uStrength), 1.0);
}`

const hex3 = (h: string): [number, number, number] => {
  const n = parseInt(h.replace('#', ''), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

// ── WebGL2 ──
type Cached = { prog: WebGLProgram; vao: WebGLVertexArrayObject; loc: Record<string, WebGLUniformLocation | null> }
const cache = new WeakMap<WebGL2RenderingContext, Cached>()
function setup(gl: WebGL2RenderingContext): Cached {
  const hit = cache.get(gl); if (hit) return hit
  const sh = (type: number, src: string) => {
    const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s)
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('滤镜着色器编译失败：' + gl.getShaderInfoLog(s))
    return s
  }
  const prog = gl.createProgram()!
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, FILTER_VERT)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FILTER_FRAG))
  gl.bindAttribLocation(prog, 0, 'aPos'); gl.linkProgram(prog)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('滤镜程序连结失败：' + gl.getProgramInfoLog(prog))
  const vao = gl.createVertexArray()!; gl.bindVertexArray(vao)
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0); gl.bindVertexArray(null)
  const names = ['uTex', 'uExposure', 'uContrast', 'uSaturation', 'uTemp', 'uTint', 'uHigh', 'uShadow', 'uFade', 'uVignette', 'uGrain', 'uSharpen', 'uSplit', 'uStrength', 'uSplitHi', 'uSplitSh', 'uSeed']
  const loc: Cached['loc'] = {}; for (const n of names) loc[n] = gl.getUniformLocation(prog, n)
  const c = { prog, vao, loc }; cache.set(gl, c); return c
}

/**
 * 把 tex 套上滤镜画到「当前绑定的帧缓冲」（null＝画布本身），视口由呼叫方设（建议＝纹理尺寸）。
 * strength：0～1（界面 0～100%）。seed：颗粒噪声种子，汇出时传帧序号，颗粒才会逐帧变化。
 * 纹理请用 CLAMP_TO_EDGE；上传时 ⛔ UNPACK_FLIP_Y。
 */
export function applyFilter(gl: WebGL2RenderingContext, tex: WebGLTexture, params: FilterParams, strength: number, opts: { seed?: number } = {}) {
  const { prog, vao, loc } = setup(gl), p = params
  gl.useProgram(prog); gl.bindVertexArray(vao)
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(loc.uTex, 0)
  const f = (n: string, v: number | undefined) => gl.uniform1f(loc[n], v ?? 0)
  f('uExposure', p.exposure); f('uContrast', p.contrast); f('uSaturation', p.saturation); f('uTemp', p.temperature); f('uTint', p.tint)
  f('uHigh', p.highlights); f('uShadow', p.shadows); f('uFade', p.fade); f('uVignette', p.vignette); f('uGrain', p.grain); f('uSharpen', p.sharpen)
  f('uSplit', p.split?.amount); f('uStrength', Math.min(1, Math.max(0, strength)))
  gl.uniform3fv(loc.uSplitHi, hex3(p.split?.highlight ?? '#808080')); gl.uniform3fv(loc.uSplitSh, hex3(p.split?.shadow ?? '#808080'))
  gl.uniform1ui(loc.uSeed, (opts.seed ?? 0) >>> 0)
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); gl.bindVertexArray(null)
}

// ── 纯 JS（同一套数学）──
const ss = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
const lum = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b
function grainJs(x: number, y: number, seed: number) {
  let h = (Math.imul(x, 1973) + Math.imul(y, 9277) + Math.imul(seed, 26699)) >>> 0
  h = (h ^ (h >>> 16)) >>> 0; h = Math.imul(h, 0x7feb352d) >>> 0; h = (h ^ (h >>> 15)) >>> 0
  h = Math.imul(h, 0x846ca68b) >>> 0; h = (h ^ (h >>> 16)) >>> 0
  return (h & 0xffff) / 65535 - 0.5
}
/** 回传一份新的 ImageData（不改原图）。用于预览缩图与没有 WebGL 的退路。 */
export function applyFilterToImageData(img: ImageData, params: FilterParams, strength: number, seed = 0): ImageData {
  const { width: W, height: H, data: s } = img, out = new ImageData(W, H), o = out.data, p = params
  const E = Math.pow(2, p.exposure ?? 0), C = p.contrast ?? 0, S = p.saturation ?? 0, T = p.temperature ?? 0, Ti = p.tint ?? 0
  const Hi = p.highlights ?? 0, Sh = p.shadows ?? 0, Fa = p.fade ?? 0, V = p.vignette ?? 0, G = p.grain ?? 0, Sp = p.sharpen ?? 0
  const SA = p.split?.amount ?? 0, sh3 = hex3(p.split?.shadow ?? '#808080'), hi3 = hex3(p.split?.highlight ?? '#808080')
  const k = Math.min(1, Math.max(0, strength))
  const at = (x: number, y: number, ch: number) => s[((Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))) << 2) + ch] / 255
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) << 2
    const s0 = [s[i] / 255, s[i + 1] / 255, s[i + 2] / 255]
    let c = s0.slice()
    if (Sp > 0) for (let ch = 0; ch < 3; ch++) {
      const n = at(x + 1, y, ch) + at(x - 1, y, ch) + at(x, y + 1, ch) + at(x, y - 1, ch)
      c[ch] = c[ch] + (c[ch] - n * 0.25) * (Sp * 1.5)
    }
    c = c.map(v => v * E)
    c[0] += T * 0.1 + Ti * 0.03; c[1] += -Ti * 0.08; c[2] += -T * 0.1 + Ti * 0.03
    c = c.map(v => (v - 0.5) * (1 + C) + 0.5)
    let l = lum(c[0], c[1], c[2])
    const add = Sh * 0.35 * (1 - ss(0, 0.55, l)) + Hi * 0.35 * ss(0.45, 1, l)
    c = c.map(v => v + add)
    l = lum(c[0], c[1], c[2])
    c = c.map(v => l + (v - l) * (1 + S))
    if (SA > 0) {
      l = Math.min(1, Math.max(0, lum(c[0], c[1], c[2])))
      c = c.map((v, ch) => v + (sh3[ch] - 0.5) * (SA * 0.6 * (1 - l)) + (hi3[ch] - 0.5) * (SA * 0.6 * l))
    }
    c = c.map(v => v * (1 - Fa * 0.3) + Fa * 0.25)
    const u = (x + 0.5) / W - 0.5, w = (y + 0.5) / H - 0.5, d = Math.hypot(u, w) * Math.SQRT2
    const vg = 1 - V * 0.7 * ss(0.35, 0.85, d)
    c = c.map(v => v * vg)
    if (G > 0) { const g = grainJs(x, y, seed) * (G * 0.12); c = c.map(v => v + g) }
    for (let ch = 0; ch < 3; ch++) {
      const f = Math.min(1, Math.max(0, c[ch]))
      o[i + ch] = Math.round((s0[ch] + (f - s0[ch]) * k) * 255)
    }
    o[i + 3] = 255
  }
  return out
}

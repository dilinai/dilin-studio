/* 笔刷（B）：在像素层上画。一笔＝一条 brush.stroke 命令＝一步历史。
   🔴 滑鼠给的是文件坐标，图层可能被移动过 ⇒ 一律先换算成图层坐标再画（铁律④）。

   对照源（逐段翻译，各段注释标 档:行；路径都在 photocraft/crates/ 下）：
     paint/src/brush.rs              BrushSettings 与各动态区段的栏位、预设值 16-458
     paint/src/lib.rs                StrokePoint 41-70、Dab 78-128、dab_coverage 139-156
     paint/src/dynamics.rs           平滑 Smoother 42-126、按间距／时间落点 PathWalker 132-260、
                                     控制值 266-311、颜色动态 313-360、base_diameter 362-373、DabBuilder 375-507、
                                     笔姿 apply_pose 564-580、DabGenerator 582-657
     paint/src/render.rs             grid_center 28-37、笔尖光栅化 rasterize 144-237、覆盖率累积 accumulate 295-361、
                                     StrokeRenderer 374-519（含收笔尾巴预览 tail_preview 474-519）、合成 composite 563-657
     paint/src/retouch.rs:143-163    over_native（Normal 合成）
     paint/src/rng.rs                计数器式乱数 mix64/rand01/hash2/seed_from_bytes
     color/src/blend.rs              27 种混合模式 blend_channel 151-240、非分离模式 242-314、composite 316-342
     engine/src/brush_cmds.rs        parse_points 50-82、merge 84-104、resolve_brush 144-180、with_blend_mode 256-265、
                                     paint_stroke 267-273、LiveStroke 275-353、set_brush 564-597
     ui-egui/src/canvas.rs           stroke_params 179-187、begin/feed_live_stroke 223-261、tool_move 1939-1964、
                                     tool_event 1966-2142、finish_gesture 2144-2182、笔尖游标 1596-1646、brush_tip_centre 210-221
     ui-egui/src/paint_mouse.rs      右键：开笔刷挑选器、不画 51-128；每颗工具各自的平滑 13-40
     ui-egui/src/brush_picker.rs     挑选器：大小（数值＋对数滑杆）、硬度 89-112
     ui-egui/src/stroke_constraint.rs Shift 拖直线 15-83、Shift＋点接上一笔、橡皮筋预览 85-123
     ui-egui/src/brush_resize.rs     Ctrl+Alt 拖曳改直径／硬度 20-153
     ui-egui/src/shortcuts.rs:307-318 [ ] 改笔尖大小
     ui-egui/src/panels.rs:508-535   选项栏（大小 硬度 不透明度 流量 平滑 压力控制大小／不透明度）、smoothing_field 2205-2210 */
(function(){
'use strict';

/* ── 常数（照抄） ── */
const MAX_COORD        = 1e6;    // brush_cmds.rs:51
const LOCK_DISTANCE    = 3;      // stroke_constraint.rs:16
const HARDNESS_TRAVEL  = 200;    // brush_resize.rs:21
const SIZE_MIN = 1, SIZE_MAX = 5000;   // brush_resize.rs:23、brush_picker.rs:100
const BAR_SIZE_MAX     = 2500;   // panels.rs:513、shortcuts.rs:312
const MAX_STRING_PX    = 100;    // dynamics.rs:14
const SPEED_SPACING_MS = 8;      // dynamics.rs:18
const MIN_SPEED_STEP   = 0.5;    // dynamics.rs:21
const NOISE_SALT       = 0x006E6F697365n;   // render.rs:26

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const c01 = v => clamp(v, 0, 1);
const isNum = v => typeof v === 'number' && isFinite(v);
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const clone = v => JSON.parse(JSON.stringify(v));

/* ═══════════ rng.rs：计数器式乱数（BigInt 做 64 位） ═══════════ */
const M64 = (1n << 64n) - 1n;
function mix64(z){
  z = (z + 0x9E3779B97F4A7C15n) & M64;
  z = ((z ^ (z >> 30n)) * 0xBF58476D1CE4E5B9n) & M64;
  z = ((z ^ (z >> 27n)) * 0x94D049BB133111EBn) & M64;
  return z ^ (z >> 31n);
}
function rand01(seed, index, stream){
  const h = mix64(seed ^ mix64(((BigInt(index) * 0xD1B54A32D192ED03n) & M64) ^ ((BigInt(stream) * 0x8CB92BA72F3D8DD7n) & M64)));
  return Number(h >> 40n) / 16777216;
}
const randSigned = (s, i, t) => rand01(s, i, t) * 2 - 1;
function hash2(x, y, salt){
  const k = (BigInt(x >>> 0) << 32n) | BigInt(y >>> 0);
  return Number(mix64(k ^ ((salt * 0xA24BAED4963EE407n) & M64)) >> 40n) / 16777216;
}
function seedFromBytes(str){                         // FNV-1a 再 mix64
  let h = 0xCBF29CE484222325n;
  for (const b of new TextEncoder().encode(str)){ h ^= BigInt(b); h = (h * 0x100000001B3n) & M64; }
  return mix64(h);
}
const ST = { SIZE:1, ANGLE:2, ROUNDNESS:3, FLIP_X:4, FLIP_Y:5, SCATTER_X:6, SCATTER_Y:7, COUNT:8,
             OPACITY:9, FLOW:10, FG_BG:11, HUE:12, SAT:13, BRIGHT:14, DEPTH:15, WET:19, MIX:20 };

/* ═══════════ brush.rs：笔刷模型（camelCase 栏位与预设值照抄） ═══════════ */
const CONTROLS = ['off','fade','penPressure','penTilt','stylusWheel','rotation','initialDirection','direction'];
const dyn = () => ({ jitter:0, control:'off', fadeSteps:25, minimum:0 });          // brush.rs:48-52
function defaultBrush(){                                                            // brush.rs:419-458
  return {
    size:20, hardness:1, spacing:0.1, spacingEnabled:true, opacity:1, flow:1,
    pressureSize:true, pressureOpacity:false,
    color:[0,0,0,1], background:[1,1,1,1], erase:false, mode:'normal',
    angle:0, roundness:1, flipX:false, flipY:false, aliased:false,
    shapeDynamics:{ enabled:false, size:dyn(), tiltScale:0, angle:dyn(), roundness:dyn(),
                    flipXJitter:false, flipYJitter:false, brushProjection:false },
    scattering:{ enabled:false, scatter:dyn(), bothAxes:false, count:1, countJitter:dyn() },
    colorDynamics:{ enabled:false, perTip:true, fgBg:dyn(), hueJitter:0, saturationJitter:0, brightnessJitter:0, purity:0 },
    transfer:{ enabled:false, opacity:dyn(), flow:dyn(), wetness:dyn(), mix:dyn() },
    pose:{ enabled:false, tiltX:0, tiltY:0, rotation:0, pressure:1, overrideTilt:false, overrideRotation:false, overridePressure:false },
    noise:false, wetEdges:false, buildUp:false, buildUpRate:20,
    smoothing:{ amount:0, pulledString:false, catchUp:true, catchUpOnEnd:true, adjustForZoom:true },
    seed:0,
    /* 自订笔尖与 PS 画笔设置的纹理／双重画笔（brush_sections.rs:422-514；栏位名照 PS）：
       tip＝取样笔尖 id（BrushTips；''＝圆笔尖）；texture 栏位同混合器画笔（tools/mixer.js defTexture）；
       dualBrush＝第二支笔尖沿同一路径盖印，跟主笔尖的覆盖率照 mode 合成（只有两支都盖到的地方有颜料） */
    tip:'',
    texture:{ enabled:false, pattern:'', invert:false, scale:1, brightness:0, contrast:0, eachTip:false, mode:'multiply', depth:1 },
    dualBrush:{ enabled:false, tip:'', mode:'colorBurn', size:25, hardness:1, spacing:0.25, scatter:0, bothAxes:false, count:1, flip:false }
  };
}
const SCHEMA = defaultBrush();
const TEX_MODES = ['multiply','subtract','darken','overlay','colorDodge','colorBurn','linearBurn','hardMix','linearHeight','height'];   // 同 tools/mixer.js
const DUAL_MODES = ['multiply','darken','overlay','colorDodge','colorBurn','linearBurn','hardMix','linearHeight'];                     // PS 双重画笔的八种
const NUM_LIMITS = { 'texture.scale':[0.01, 10], 'texture.brightness':[-150, 150], 'texture.contrast':[-50, 100], 'texture.depth':[0, 1],
  'dualBrush.size':[1, 5000], 'dualBrush.hardness':[0, 1], 'dualBrush.spacing':[0.01, 10], 'dualBrush.scatter':[0, 10], 'dualBrush.count':[1, 16] };

/* color/src/blend.rs:43-73 LAYER_MODES（命令里用 camelCase 名字；大小写、空白、连字号都不计较） */
const MODES = ['normal','dissolve','darken','multiply','colorBurn','linearBurn','darkerColor','lighten','screen',
  'colorDodge','linearDodge','lighterColor','overlay','softLight','hardLight','vividLight','linearLight','pinLight',
  'hardMix','difference','exclusion','subtract','divide','hue','saturation','color','luminosity'];
const MODE_KEY = {}; MODES.forEach(m => MODE_KEY[m.toLowerCase()] = m); MODE_KEY.add = 'linearDodge'; MODE_KEY.lineardodgeadd = 'linearDodge';
const modeOf = s => (typeof s === 'string') ? (MODE_KEY[s.toLowerCase().replace(/[^a-z]/g, '')] || null) : null;

/* brush_cmds.rs:29-45 color：[r,g,b,a?]（0..1）或 "#rrggbb[aa]"；坏的用预设 */
function parseColor(v, d){
  if (Array.isArray(v) && v.length >= 3) return [+v[0] || 0, +v[1] || 0, +v[2] || 0, v.length > 3 ? (+v[3]) : 1];
  if (typeof v === 'string'){
    const h = v.replace(/^#/, '');
    if ((h.length === 6 || h.length === 8) && /^[0-9a-f]+$/i.test(h)){
      const c = i => parseInt(h.slice(i, i + 2), 16) / 255;
      return [c(0), c(2), c(4), h.length === 8 ? c(6) : 1];
    }
  }
  return d;
}
const hexOf = c => '#' + c.slice(0, 3).map(v => Math.round(c01(v) * 255).toString(16).padStart(2, '0')).join('');

/* brush_cmds.rs:84-104 merge ＋ 107-138 merge_brush：深合并，再照 serde 检查型别（不认得的栏位照 serde 预设忽略） */
function mergeInto(base, patch, schema, path, ignored){
  for (const k of Object.keys(patch)){
    const v = patch[k], sv = schema[k], p = path ? path + '.' + k : k;
    if (sv === undefined){ ignored.push(p); continue; }
    if (isObj(sv)){
      if (!isObj(v)) throw new Error(`invalid brush: \`${p}\` must be an object`);
      if (!isObj(base[k])) base[k] = clone(sv);           // 旧版存下的笔刷（没有 texture／dualBrush 这几节）补上预设再合并
      mergeInto(base[k], v, sv, p, ignored);
    } else if (Array.isArray(sv)){                       // 颜色
      const c = parseColor(v, null);
      if (!c) throw new Error(`invalid brush: \`${p}\` must be [r,g,b,a] or "#rrggbb"`);
      base[k] = c;
    } else if (k === 'seed'){
      base[k] = (typeof v === 'string' || isNum(v)) ? String(v) : 0;
    } else if (p === 'mode'){
      const m = modeOf(v); if (!m) throw new Error(`invalid brush: unknown blend mode \`${v}\``); base[k] = m;
    } else if (p === 'texture.mode' || p === 'dualBrush.mode'){
      const L = p === 'texture.mode' ? TEX_MODES : DUAL_MODES;
      if (!L.includes(v)) throw new Error(`invalid brush: \`${p}\` must be one of ${L.join('|')}`); base[k] = v;
    } else if (p === 'tip' || p === 'dualBrush.tip'){    // 取样笔尖：id 或名字（''＝圆笔尖）；找不到就报错，不偷偷换回圆笔尖
      if (typeof v !== 'string') throw new Error(`invalid brush: \`${p}\` must be a brush tip id or name ("" = round)`);
      if (!v){ base[k] = ''; continue; }
      const t = BrushTips.get(v);
      if (!t) throw new Error(`invalid brush: unknown brush tip \`${v}\` (see brush.tips.list)`);
      base[k] = t.id;
    } else if (k === 'control'){
      if (!CONTROLS.includes(v)) throw new Error(`invalid brush: \`${p}\` must be one of ${CONTROLS.join('|')}`); base[k] = v;
    } else if (typeof sv === 'string'){
      if (typeof v !== 'string') throw new Error(`invalid brush: \`${p}\` must be a string`); base[k] = v;
    } else if (typeof sv === 'number'){
      if (!isNum(v)) throw new Error(`invalid brush: \`${p}\` must be a number`);
      base[k] = NUM_LIMITS[p] ? clamp(v, NUM_LIMITS[p][0], NUM_LIMITS[p][1]) : v;
    } else if (typeof sv === 'boolean'){
      if (typeof v !== 'boolean') throw new Error(`invalid brush: \`${p}\` must be true/false`); base[k] = v;
    }
  }
}
function mergeBrush(base, patch){
  const out = clone(base), ignored = [];
  mergeInto(out, patch, SCHEMA, '', ignored);
  return { b: out, ignored };
}

/* ═══════════ lib.rs:139-156 dab_coverage ═══════════ */
function dabCoverage(d, radius, hardness){
  if (d >= radius + 0.5) return 0;
  const edge = Math.min(c01(radius + 0.5 - d), 1);
  const h = c01(hardness), inner = radius * h;
  let falloff;
  if (d <= inner || radius - inner < 1e-3) falloff = 1;
  else { const t = c01((d - inner) / (radius - inner)); falloff = 1 - t * t * (3 - 2 * t); }
  return edge * falloff;
}
function smoothstep(e0, e1, x){ const t = c01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); }   // render.rs:48-51

/* lib.rs:41-70 StrokePoint（滑鼠：满压、无倾斜） */
const mkPt = (x, y, o) => Object.assign({ x, y, pressure:1, tiltX:0, tiltY:0, rotation:0, wheel:1, time:0 }, o || {});
function lerpPt(a, b, f){                                  // dynamics.rs:23-36
  return { x:a.x + (b.x - a.x) * f, y:a.y + (b.y - a.y) * f,
    pressure:a.pressure + (b.pressure - a.pressure) * f, tiltX:a.tiltX + (b.tiltX - a.tiltX) * f,
    tiltY:a.tiltY + (b.tiltY - a.tiltY) * f, rotation:a.rotation + (b.rotation - a.rotation) * f,
    wheel:a.wheel + (b.wheel - a.wheel) * f, time:a.time + (b.time - a.time) * f };
}

/* ═══════════ dynamics.rs:42-115 Smoother（指数平滑／拉绳；收笔追到最后一点） ═══════════ */
class Smoother {
  constructor(cfg, zoom){ this.cfg = cfg; this.zoom = Math.max(zoom, 0.01); this.pos = null; this.last = null; }
  clone(){ return Object.assign(Object.create(Smoother.prototype), this); }
  active(){ return this.cfg.amount > 0; }
  push(p, out){
    const prev = this.last; this.last = p;
    if (!this.active()){ out.push(p); return; }
    const pos = this.pos;
    if (!pos){ this.pos = p; out.push(p); return; }
    const amount = c01(this.cfg.amount);
    if (this.cfg.pulledString){                            // 拉绳：绳长 amount×100 萤幕点
      let len = amount * MAX_STRING_PX;
      if (this.cfg.adjustForZoom) len /= this.zoom;
      const dx = p.x - pos.x, dy = p.y - pos.y, d = Math.sqrt(dx * dx + dy * dy);
      if (d > len){
        const k = (d - len) / d, np = Object.assign({}, p, { x: pos.x + dx * k, y: pos.y + dy * k });
        this.pos = np; out.push(np);
      }
      return;
    }
    const a = 1 - Math.min(amount, 0.95);                  // 每次迭代往指针走 a
    let iters = 1;
    if (prev && this.cfg.catchUp && p.time > prev.time) iters = clamp(Math.round((p.time - prev.time) / 16), 1, 64);
    let cur = pos;
    for (let i = 0; i < iters; i++){
      cur = Object.assign({}, p, { x: cur.x + (p.x - cur.x) * a, y: cur.y + (p.y - cur.y) * a });
      out.push(cur);
    }
    this.pos = cur;
  }
  finish(out){
    if (!this.active() || !this.cfg.catchUpOnEnd) return;
    if (this.pos && this.last && (this.pos.x !== this.last.x || this.pos.y !== this.last.y)){
      this.pos = this.last; out.push(this.last);
    }
  }
}

/* ═══════════ dynamics.rs:132-260 PathWalker ═══════════ */
class PathWalker {
  constructor(intervalMs){
    this.last = null; this.nextAt = 0; this.pendingFirst = null; this.initialDir = null; this.dir = 0; this.step = 0;
    this.interval = intervalMs; this.timeAcc = 0; this.speed = null; this.speedAcc = 0;
  }
  speedSpacing(ms){ this.speed = Math.max(ms, 0.1); return this; }
  clone(){ return Object.assign(Object.create(PathWalker.prototype), this); }
  emit(point, out){
    const s = { point, direction:this.dir, initialDirection:(this.initialDir === null ? this.dir : this.initialDir), step:this.step };
    this.step++; out(s);
  }
  push(p, stepLen, out){
    const a = this.last;
    if (!a){ this.last = p; this.pendingFirst = p; this.nextAt = stepLen(p); return; }
    const dx = p.x - a.x, dy = p.y - a.y, len = Math.sqrt(dx * dx + dy * dy);
    if (len > 1e-9){
      this.dir = Math.atan2(-dy, dx);                     // 视觉方向（y 朝上、逆时针）
      if (this.initialDir === null) this.initialDir = this.dir;
    }
    if (this.pendingFirst){ const f = this.pendingFirst; this.pendingFirst = null; this.emit(f, out); }
    if (len > 1e-9){
      if (this.speed === null){                            // 照间距
        while (this.nextAt <= len + 1e-9){
          const q = lerpPt(a, p, Math.min(this.nextAt / len, 1));
          this.emit(q, out);
          this.nextAt += Math.max(stepLen(q), 0.25);
        }
        this.nextAt -= len;
      } else {                                             // 间距关：照速度（时间）
        const iv = this.speed, dt = p.time - a.time;
        if (dt > 0 && isFinite(dt)){
          this.speedAcc += dt;
          const maxN = Math.max(Math.ceil(len / MIN_SPEED_STEP), 1);
          let n = 0;
          while (this.speedAcc >= iv && n < maxN){
            this.speedAcc -= iv;
            this.emit(lerpPt(a, p, c01((dt - this.speedAcc) / dt)), out); n++;
          }
          if (n === maxN) this.speedAcc = ((this.speedAcc % iv) + iv) % iv;
        } else this.emit(p, out);                          // 没时间戳：一个输入点一个笔印
      }
    }
    if (this.interval !== null){                           // 喷枪累积（要有时间戳）
      const dt = p.time - a.time;
      if (dt > 0){
        this.timeAcc += dt;
        while (this.timeAcc >= this.interval){
          this.timeAcc -= this.interval;
          this.emit(lerpPt(a, p, c01((dt - this.timeAcc) / dt)), out);
        }
      }
    }
    this.last = p;
  }
  finish(out){ if (this.pendingFirst){ const f = this.pendingFirst; this.pendingFirst = null; this.emit(f, out); } }
}

/* ═══════════ dynamics.rs:266-373 控制值／颜色动态／基础直径 ═══════════ */
function controlValue(c, fadeSteps, s){
  const p = s.point;
  switch (c){
    case 'fade':        return 1 - Math.min(s.step / Math.max(fadeSteps, 1), 1);
    case 'penPressure': return c01(p.pressure);
    case 'penTilt':     return 1 - c01(Math.hypot(p.tiltX, p.tiltY) / 90);
    case 'stylusWheel': return c01(p.wheel);
    case 'rotation':    return (((p.rotation % 360) + 360) % 360) / 360;
    default:            return 1;                         // off / initialDirection / direction
  }
}
function controlAngle(c, fadeSteps, s){
  const p = s.point, deg = r => r * 180 / Math.PI;
  switch (c){
    case 'fade':        return 360 * Math.min(s.step / Math.max(fadeSteps, 1), 1);
    case 'penPressure': return 360 * c01(p.pressure);
    case 'penTilt':     return (p.tiltX === 0 && p.tiltY === 0) ? 0 : deg(Math.atan2(-p.tiltY, p.tiltX));
    case 'stylusWheel': return 360 * c01(p.wheel);
    case 'rotation':    return p.rotation;
    case 'initialDirection': return deg(s.initialDirection);
    case 'direction':   return deg(s.direction);
    default:            return 0;
  }
}
const dynActive = d => d.jitter > 0 || d.control !== 'off';
function scalar(d, s, r){
  if (!dynActive(d)) return 1;
  const min = c01(d.minimum), cv = controlValue(d.control, d.fadeSteps, s);
  return Math.max((min + (1 - min) * cv) * (1 - c01(d.jitter) * r), min);
}
function rgbToHsv(c){
  const mx = Math.max(c[0], c[1], c[2]), mn = Math.min(c[0], c[1], c[2]), d = mx - mn;
  let h = 0;
  if (d > 0){
    if (mx === c[0]) h = ((((c[1] - c[2]) / d) % 6) + 6) % 6;
    else if (mx === c[1]) h = (c[2] - c[0]) / d + 2;
    else h = (c[0] - c[1]) / d + 4;
    h /= 6;
  }
  return [h, mx > 0 ? d / mx : 0, mx];
}
function hsvToRgb(h, s, v){
  const h6 = (((h % 1) + 1) % 1) * 6, i = Math.floor(h6), f = h6 - i;
  const p = v * (1 - s), q = v * (1 - s * f), t = v * (1 - s * (1 - f));
  switch (i){ case 0: return [v, t, p]; case 1: return [q, v, p]; case 2: return [p, v, t];
              case 3: return [p, q, v]; case 4: return [t, p, v]; default: return [v, p, q]; }
}
function dynamicColor(b, s, seed, index){                 // dynamics.rs:344-360
  const cd = b.colorDynamics, fg = b.color, bg = b.background;
  const base = cd.fgBg.control !== 'off' ? 1 - controlValue(cd.fgBg.control, cd.fgBg.fadeSteps, s) : 0;
  const t = c01(base + (1 - base) * c01(cd.fgBg.jitter) * rand01(seed, index, ST.FG_BG));
  const rgb = [0, 1, 2].map(i => fg[i] + (bg[i] - fg[i]) * t);
  let [h, sat, v] = rgbToHsv(rgb);
  h += randSigned(seed, index, ST.HUE) * c01(cd.hueJitter) * 0.5;
  sat = c01(sat + randSigned(seed, index, ST.SAT) * c01(cd.saturationJitter));
  const pu = clamp(cd.purity, -1, 1);
  sat = pu >= 0 ? sat + (1 - sat) * pu : sat * (1 + pu);
  v = c01(v + randSigned(seed, index, ST.BRIGHT) * c01(cd.brightnessJitter));
  const o = hsvToRgb(h, sat, v);
  return [o[0], o[1], o[2], fg[3] + (bg[3] - fg[3]) * t];
}
function baseDiameter(b, s){
  const sd = b.shapeDynamics; let f = 1;
  if (sd.enabled && sd.size.control !== 'off'){ const min = c01(sd.size.minimum); f = min + (1 - min) * controlValue(sd.size.control, sd.size.fadeSteps, s); }
  else if (b.pressureSize) f = c01(s.point.pressure);
  return b.size * f;
}

/* ═══════════ dynamics.rs:375-507 DabBuilder ═══════════ */
class DabBuilder {
  constructor(b){ this.b = b; this.seed = b._seed; this.strokeColor = null; this.nextIndex = 0; }
  clone(){ return Object.assign(Object.create(DabBuilder.prototype), this); }
  stepLen(p){
    const d = Math.max(baseDiameter(this.b, { point:p, direction:0, initialDirection:0, step:0 }), 1);
    return Math.max(d * Math.max(this.b.spacing, 0.01), 0.5);
  }
  build(s, out){
    const b = this.b, seed = this.seed, sd = b.shapeDynamics, sc = b.scattering;
    let count = 1;
    if (sc.enabled){
      const n = clamp(sc.count, 1, 16), k = scalar(sc.countJitter, s, rand01(seed, s.step, ST.COUNT));
      count = clamp(Math.round(n * k), 1, 16);
    }
    const baseD = baseDiameter(b, s);
    for (let c = 0; c < count; c++){
      const i = this.nextIndex++;
      const r = st => rand01(seed, i, st);
      // 形状
      let diameter = baseD, angle = b.angle, roundness = clamp(b.roundness, 0.01, 1), fx = b.flipX, fy = b.flipY;
      if (sd.enabled){
        if (sd.size.jitter > 0) diameter *= Math.max(1 - c01(sd.size.jitter) * r(ST.SIZE), c01(sd.size.minimum));
        angle += controlAngle(sd.angle.control, sd.angle.fadeSteps, s) + randSigned(seed, i, ST.ANGLE) * c01(sd.angle.jitter) * 180;
        roundness = clamp(roundness * scalar(sd.roundness, s, r(ST.ROUNDNESS)), 0.01, 1);
        if (sd.flipXJitter && r(ST.FLIP_X) < 0.5) fx = !fx;
        if (sd.flipYJitter && r(ST.FLIP_Y) < 0.5) fy = !fy;
      }
      // 倾斜缩放与笔投影
      let projAngle = 0, projScale = 1;
      if (sd.enabled){
        const tilt = clamp(Math.hypot(s.point.tiltX, s.point.tiltY), 0, 90);
        if (sd.size.control === 'penTilt' && sd.tiltScale > 0)
          roundness = clamp(roundness * (1 - clamp(sd.tiltScale, 0, 2) * 0.5 * tilt / 90), 0.01, 1);
        if (sd.brushProjection){
          angle += s.point.rotation;
          if (tilt > 0){ projAngle = Math.atan2(-s.point.tiltY, s.point.tiltX); projScale = Math.max(Math.cos(tilt * Math.PI / 180), 0.05); }
        }
      }
      const radius = Math.max(diameter / 2, 0.5);
      // 散布
      let cx = s.point.x, cy = s.point.y;
      if (sc.enabled && sc.scatter.jitter > 0){
        const amt = sc.scatter.jitter * controlValue(sc.scatter.control, sc.scatter.fadeSteps, s) * radius;
        const ox = randSigned(seed, i, ST.SCATTER_X) * amt, oy = randSigned(seed, i, ST.SCATTER_Y) * amt;
        if (sc.bothAxes){ cx += ox; cy += oy; }
        else { const dx = Math.cos(s.direction), dy = -Math.sin(s.direction); cx += -dy * ox; cy += dx * ox; }   // 垂直于行进方向
      }
      // 传递（不透明度上限、流量）
      const tr = b.transfer;
      let opacity = 1, flow = b.flow;
      if (tr.enabled){ opacity = scalar(tr.opacity, s, r(ST.OPACITY)); flow *= scalar(tr.flow, s, r(ST.FLOW)); }
      if (b.pressureOpacity && !(tr.enabled && tr.opacity.control !== 'off')) opacity *= c01(s.point.pressure);
      // 颜色
      let color = b.color;
      if (b.colorDynamics.enabled){
        if (b.colorDynamics.perTip) color = dynamicColor(b, s, seed, i);
        else { if (!this.strokeColor) this.strokeColor = dynamicColor(b, s, seed, 0); color = this.strokeColor; }
      }
      out.push({ cx, cy, radius, alpha:c01(flow), angle:angle * Math.PI / 180, roundness, flipX:fx, flipY:fy,
                 opacity:c01(opacity), color, index:i, projAngle, projScale });
    }
  }
}

/* dynamics.rs:564-580 apply_pose */
function applyPose(b, p){
  const o = b.pose; if (!o.enabled) return p;
  p = Object.assign({}, p);
  if (o.overrideTilt){ p.tiltX = o.tiltX; p.tiltY = o.tiltY; }
  if (o.overrideRotation) p.rotation = o.rotation;
  if (o.overridePressure) p.pressure = o.pressure;
  return p;
}

/* ═══════════ dynamics.rs:582-657 DabGenerator ═══════════ */
class DabGenerator {
  constructor(b, zoom){
    const interval = b.buildUp ? 1000 / clamp(b.buildUpRate, 0.1, 1000) : null;
    this.smoother = new Smoother(b.smoothing, zoom);
    this.walker = b.spacingEnabled ? new PathWalker(interval) : new PathWalker(interval).speedSpacing(SPEED_SPACING_MS);
    this.builder = new DabBuilder(b);
  }
  clone(){
    const g = Object.create(DabGenerator.prototype);
    g.smoother = this.smoother.clone(); g.walker = this.walker.clone(); g.builder = this.builder.clone();
    return g;
  }
  walk(pts, dabs){
    for (let p of pts){
      p = applyPose(this.builder.b, p);
      const steps = [];
      this.walker.push(p, q => this.builder.stepLen(q), s => steps.push(s));
      for (const s of steps) this.builder.build(s, dabs);
    }
  }
  push(pts, dabs){ const sm = []; for (const p of pts) this.smoother.push(p, sm); this.walk(sm, dabs); }
  finish(dabs){
    const sm = []; this.smoother.finish(sm); this.walk(sm, dabs);
    const steps = []; this.walker.finish(s => steps.push(s));
    for (const s of steps) this.builder.build(s, dabs);
  }
}

/* ═══════════ color/src/blend.rs：混合模式 ═══════════ */
function colorBurn(cb, cs){ return cb >= 1 ? 1 : cs <= 0 ? 0 : 1 - Math.min((1 - cb) / cs, 1); }
function colorDodge(cb, cs){ return cb <= 0 ? 0 : cs >= 1 ? 1 : Math.min(cb / (1 - cs), 1); }
function hardLight(cb, cs){ if (cs <= 0.5) return cb * 2 * cs; const s = 2 * cs - 1; return cb + s - cb * s; }
function softLightPs(cb, cs){ return cs <= 0.5 ? 2 * cb * cs + cb * cb * (1 - 2 * cs) : 2 * cb * (1 - cs) + Math.sqrt(Math.max(cb, 0)) * (2 * cs - 1); }
function blendChannel(m, cb, cs){
  switch (m){
    case 'darken': return Math.min(cb, cs);
    case 'multiply': return cb * cs;
    case 'colorBurn': return colorBurn(cb, cs);
    case 'linearBurn': return Math.max(cb + cs - 1, 0);
    case 'lighten': return Math.max(cb, cs);
    case 'screen': return cb + cs - cb * cs;
    case 'colorDodge': return colorDodge(cb, cs);
    case 'linearDodge': return Math.min(cb + cs, 1);
    case 'overlay': return hardLight(cs, cb);
    case 'softLight': return softLightPs(cb, cs);
    case 'hardLight': return hardLight(cb, cs);
    case 'vividLight': return cs <= 0.5 ? colorBurn(cb, 2 * cs) : colorDodge(cb, 2 * (cs - 0.5));
    case 'linearLight': return c01(cb + 2 * cs - 1);
    case 'pinLight': return cs <= 0.5 ? Math.min(cb, 2 * cs) : Math.max(cb, 2 * cs - 1);
    case 'hardMix': return cb + cs >= 1 - 1e-6 ? 1 : 0;
    case 'difference': return Math.abs(cb - cs);
    case 'exclusion': return cb + cs - 2 * cb * cs;
    case 'subtract': return Math.max(cb - cs, 0);
    case 'divide': return cs <= 0 ? (cb <= 0 ? 0 : 1) : Math.min(cb / cs, 1);
    default: return cs;                                   // normal / dissolve
  }
}
const lum = c => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
function clipColor(c){
  const l = lum(c), n = Math.min(c[0], c[1], c[2]), x = Math.max(c[0], c[1], c[2]);
  let o = c.slice();
  if (n < 0){ const d = l - n; o = o.map(v => Math.abs(d) < 1e-12 ? l : l + (v - l) * l / d); }
  if (x > 1){ const d = x - l; o = o.map(v => Math.abs(d) < 1e-12 ? l : l + (v - l) * (1 - l) / d); }
  return o;
}
const setLum = (c, l) => { const d = l - lum(c); return clipColor([c[0] + d, c[1] + d, c[2] + d]); };
const satOf = c => Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]);
function setSat(c, s){
  const idx = [0, 1, 2].sort((a, b) => c[a] - c[b]), [imin, imid, imax] = idx, o = [0, 0, 0];
  if (c[imax] > c[imin]){ o[imid] = (c[imid] - c[imin]) * s / (c[imax] - c[imin]); o[imax] = s; }
  o[imin] = 0; return o;
}
function blendRgb(m, cb, cs){
  switch (m){
    case 'hue':         return setLum(setSat(cs, satOf(cb)), lum(cb));
    case 'saturation':  return setLum(setSat(cb, satOf(cs)), lum(cb));
    case 'color':       return setLum(cs, lum(cb));
    case 'luminosity':  return setLum(cb, lum(cs));
    case 'darkerColor': return lum(cs) < lum(cb) ? cs : cb;
    case 'lighterColor':return lum(cs) > lum(cb) ? cs : cb;
    default: return [blendChannel(m, cb[0], cs[0]), blendChannel(m, cb[1], cs[1]), blendChannel(m, cb[2], cs[2])];
  }
}
function blendComposite(m, bd, src, opacity){            // blend.rs:322-342（W3C 通式，直通 alpha）
  const ab = bd[3], as = src[3] * opacity;
  if (as <= 0) return bd;
  const cb = [bd[0], bd[1], bd[2]], cs = [src[0], src[1], src[2]], b = blendRgb(m, cb, cs);
  const ao = as + ab * (1 - as);
  if (ao <= 0) return [0, 0, 0, 0];
  const o = [0, 0, 0, ao];
  for (let i = 0; i < 3; i++) o[i] = ((1 - as) * ab * cb[i] + (1 - ab) * as * cs[i] + as * ab * b[i]) / ao;
  return o;
}

/* ═══════════ render.rs：笔印 → 覆盖率缓冲 → 从下笔前的像素合成 ═══════════ */
function uni(a, b){ return a ? [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])] : b.slice(); }
function inter(r, x0, y0, x1, y1){
  const a = [Math.max(r[0], x0), Math.max(r[1], y0), Math.min(r[2], x1), Math.min(r[3], y1)];
  return (a[2] > a[0] && a[3] > a[1]) ? a : null;
}
/* render.rs:28-37 grid_center（铅笔／无反锯齿笔尖落在像素格上） */
function gridCenter(x, y, diameter){
  const n = isFinite(diameter) ? Math.max(Math.round(diameter), 1) : 1;
  const snap = v => n % 2 === 1 ? Math.floor(v) + 0.5 : Math.round(v);
  return [snap(x), snap(y)];
}
/* render.rs:144-150 dab_rect（圆笔尖：半径＋1） */
function dabRect(d){
  const rr = Math.ceil(d.radius) + 1, cx = Math.floor(d.cx), cy = Math.floor(d.cy);
  return [cx - rr, cy - rr, cx + rr + 1, cy + rr + 1];
}

/* ═══════════ 取样笔尖库（自订笔尖）：灰阶 alpha（0＝没颜料、255＝满），id＝「tip-」＋内容杂凑 ═══════════
   来源三处：内建（这里用程序生成，几张常用的）、本机预设库（localStorage dlcanvas.ps.brushPresets——定义画笔预设、读入 .abr 存的，
   menus/impl/ps-edit.js 的 BrushPresets 也读写这一份）、这份工程档（project.json 的 brushTips：用过／定义过／读入过的笔尖跟着档走）。
   本机库存的是 PackBits 压过再 base64（enc:'rle'）；旧版存的没有 enc＝原始 base64。localStorage 满了＝saved:false，笔尖照样在这份档里。 */
const TIP_LS = 'dlcanvas.ps.brushPresets';
const TIP_MAX = 2500;                          // 笔尖最长边（同定义画笔预设的上限）；.abr 里更大的等比缩下来
function b64enc(u8){ let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
function b64dec(str){ const s = atob(str), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
/* PackBits（Photoshop 的 RLE）：n≥0＝照抄 n+1 个；-127..-1＝下一个位元组重复 1-n 次；-128 跳过 */
function packBitsEncode(u8){
  const out = []; let i = 0;
  while (i < u8.length){
    let j = i + 1;
    while (j < u8.length && j - i < 128 && u8[j] === u8[i]) j++;
    if (j - i >= 2){ out.push(257 - (j - i), u8[i]); i = j; continue; }
    j = i;
    while (j < u8.length && j - i < 128 && !(j + 1 < u8.length && u8[j] === u8[j + 1])) j++;
    if (j === i) j = i + 1;
    out.push(j - i - 1); for (let k = i; k < j; k++) out.push(u8[k]); i = j;
  }
  return Uint8Array.from(out);
}
function packBitsDecode(src, at, end, out, outAt, outLen){
  let i = at, o = outAt; const stop = outAt + outLen;
  while (i < end && o < stop){
    let n = src[i++]; if (n > 127) n -= 256;
    if (n >= 0){ const m = Math.min(n + 1, stop - o, end - i); out.set(src.subarray(i, i + m), o); i += n + 1; o += m; }
    else if (n !== -128){ const v = src[i++], m = Math.min(1 - n, stop - o); out.fill(v, o, o + m); o += m; }
  }
  return { read: i - at, wrote: o - outAt };
}
function tipHash(w, h, a){                     // 两支 32 位 FNV-1a（不同起点）＝ 16 个十六进位字
  let h1 = 0x811c9dc5 ^ w, h2 = 0x01000193 ^ (h * 2654435761 >>> 0);
  for (let i = 0; i < a.length; i++){ h1 = Math.imul(h1 ^ a[i], 16777619); h2 = Math.imul(h2 ^ a[i] ^ (i & 255), 2246822519); }
  return 'tip-' + (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}
/* 等比缩到最长边 ≤ max（面积平均） */
function shrinkTip(w, h, a, max){
  const k = Math.max(w, h) / max; if (k <= 1) return { w, h, a };
  const nw = Math.max(1, Math.round(w / k)), nh = Math.max(1, Math.round(h / k)), o = new Uint8Array(nw * nh);
  for (let y = 0; y < nh; y++){ const y0 = Math.floor(y * h / nh), y1 = Math.max(y0 + 1, Math.floor((y + 1) * h / nh));
    for (let x = 0; x < nw; x++){ const x0 = Math.floor(x * w / nw), x1 = Math.max(x0 + 1, Math.floor((x + 1) * w / nw));
      let s = 0; for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) s += a[yy * w + xx];
      o[y * nw + x] = Math.round(s / ((y1 - y0) * (x1 - x0))); } }
  return { w:nw, h:nh, a:o };
}
/* 内建程序笔尖（种子固定 ⇒ 每台机器一模一样）：粉笔、喷溅、鬃毛、星点 */
function builtinTips(){
  const N = 128, mk = (name, f, spacing) => { const a = new Uint8Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) a[y * N + x] = Math.round(c01(f(x + 0.5 - N / 2, N / 2 - y - 0.5, x, y)) * 255);
    return { name, width:N, height:N, a, size:N, spacing, builtin:true }; };
  const S = BigInt(20261025), r = (i, s) => rand01(S, i, s);
  const dots = [], bristles = [];
  for (let i = 0; i < 70; i++){ const ang = r(i, 1) * Math.PI * 2, d = Math.sqrt(r(i, 2)) * 54; dots.push([Math.cos(ang) * d, Math.sin(ang) * d, 1.5 + r(i, 3) * 6 * (1 - d / 70)]); }
  for (let i = 0; i < 26; i++) bristles.push([-56 + r(i, 4) * 112, 1 + r(i, 5) * 2.5, 0.45 + r(i, 6) * 0.55]);
  return [
    mk('Chalk', (u, v, x, y) => { const d = Math.hypot(u, v) / 60; if (d >= 1) return 0; return (hash2(x, y, 0x63686Bn) < 0.72 - d * 0.5 ? 1 : 0) * (1 - smoothstep(0.75, 1, d)); }, 0.2),
    mk('Spatter', (u, v) => { let m = 0; for (const [cx, cy, rr] of dots){ const d = Math.hypot(u - cx, v - cy); if (d < rr + 1) m = Math.max(m, c01(rr + 0.5 - d)); } return m; }, 0.35),
    // 鬃毛：一排横向分布的小圆点（笔尖竖着一列鬃毛）⇒ 顺着横向拖成一条条平行的丝
    mk('Bristle', (u, v) => { let m = 0; for (const [by, bw, op] of bristles){ const d = Math.hypot(u * 0.8, v - by); if (d < bw + 1) m = Math.max(m, c01(bw + 0.5 - d) * op); } return m; }, 0.03),
    mk('Star', (u, v) => { const ang = Math.atan2(v, u), d = Math.hypot(u, v), rr = 34 + 24 * Math.cos(ang * 5); return c01(rr - d + 0.5) * c01((60 - d) / 4); }, 0.25)
  ];
}
const BrushTips = {
  mem: new Map(),        // id → {id, name, width, height, a:Uint8Array, size, spacing, source:'builtin'|'local'|'doc'}
  doc: new Set(),        // 这份工程档带着的笔尖 id（存进 project.json 的 brushTips）
  _ready: false,
  _init(){
    if (this._ready) return; this._ready = true;
    for (const t of builtinTips()) this._put(Object.assign(t, { id: tipHash(t.width, t.height, t.a) }), 'builtin');
    for (const e of this._readLS()){ const t = this._decode(e); if (t) this._put(t, 'local'); }
  },
  _readLS(){ try { const v = JSON.parse(localStorage.getItem(TIP_LS) || '[]'); return Array.isArray(v) ? v : []; } catch (e){ return []; } },
  _writeLS(list){ try { localStorage.setItem(TIP_LS, JSON.stringify(list)); return true; } catch (e){ return false; } },
  /* 存档格式 {id?, name, width, height, size, spacing, tip:base64, enc?:'rle'} → 记忆体格式；坏的回 null */
  _decode(e){
    try {
      if (!e || typeof e.tip !== 'string') return null;
      const w = e.width | 0, h = e.height | 0; if (!(w > 0 && h > 0 && w <= TIP_MAX * 2 && h <= TIP_MAX * 2)) return null;
      let a = b64dec(e.tip);
      if (e.enc === 'rle'){ const o = new Uint8Array(w * h); packBitsDecode(a, 0, a.length, o, 0, o.length); a = o; }
      if (a.length !== w * h) return null;
      return { id: typeof e.id === 'string' && /^tip-/.test(e.id) ? e.id : tipHash(w, h, a), name: String(e.name || 'Sampled Brush'), width:w, height:h, a,
               size: isNum(e.size) ? e.size : Math.max(w, h), spacing: isNum(e.spacing) ? e.spacing : 0.25 };
    } catch (err){ return null; }
  },
  _encode(t){ return { id:t.id, name:t.name, width:t.width, height:t.height, size:t.size, spacing:t.spacing, enc:'rle', tip:b64enc(packBitsEncode(t.a)) }; },
  _put(t, source){ const o = Object.assign({}, t, { source: (this.mem.get(t.id) || {}).source === 'builtin' ? 'builtin' : source }); delete o.builtin; this.mem.set(o.id, o); return o; },
  list(){ this._init(); return [...this.mem.values()]; },
  get(key){
    this._init(); if (typeof key !== 'string' || !key) return null;
    return this.mem.get(key) || [...this.mem.values()].find(t => t.name === key) || null;
  },
  /* 新增（定义画笔预设、读入 .abr）：{name, width, height, a, size?, spacing?} → {tip, saved}；opts.local＝存进本机库，opts.doc＝跟这份档走 */
  add(t, opts){
    this._init(); opts = opts || {};
    let { w, h, a } = shrinkTip(t.width, t.height, t.a, TIP_MAX);
    const scaled = w !== t.width;
    const tip = this._put({ id: tipHash(w, h, a), name: String(t.name || 'Sampled Brush'), width:w, height:h, a,
                            size: clamp(Math.round(scaled ? Math.max(w, h) : (isNum(t.size) ? t.size : Math.max(w, h))), 1, SIZE_MAX),
                            spacing: isNum(t.spacing) ? clamp(t.spacing, 0.01, 10) : 0.25 }, opts.local === false ? 'doc' : 'local');
    let saved = null;
    if (opts.local !== false){
      const list = this._readLS().filter(e => e && e.id !== tip.id && !(e.name === tip.name && !e.id));
      list.push(this._encode(tip)); saved = this._writeLS(list);
    }
    if (opts.doc !== false) this.doc.add(tip.id);
    return { tip, saved, scaled };
  },
  rename(key, name){
    const t = this.get(key); if (!t) return null; if (t.source === 'builtin') throw new Error('built-in brush tips cannot be renamed');
    t.name = String(name);
    const list = this._readLS(); let hit = false;
    list.forEach(e => { if (e && (e.id === t.id || (!e.id && this._decode(e) && this._decode(e).id === t.id))){ e.name = t.name; hit = true; } });
    if (hit) this._writeLS(list);
    return t;
  },
  remove(key){
    const t = this.get(key); if (!t) return null; if (t.source === 'builtin') throw new Error('built-in brush tips cannot be deleted');
    this._writeLS(this._readLS().filter(e => { if (!e) return false; if (e.id) return e.id !== t.id; const d = this._decode(e); return !d || d.id !== t.id; }));
    this.mem.delete(t.id); this.doc.delete(t.id); StampCache.dropTip(t.id);
    return t;
  },
  /* project.json 的 brushTips */
  serialize(){ this._init(); return [...this.doc].map(id => this.mem.get(id)).filter(Boolean).map(t => this._encode(t)); },
  loadDoc(arr){
    this._init(); this.doc = new Set();
    if (!Array.isArray(arr)) return 0;
    let n = 0;
    for (const e of arr){ const t = this._decode(e); if (!t) continue; if (!this.mem.has(t.id)) this._put(t, 'doc'); this.doc.add(t.id); n++; }
    return n;
  },
  /* 笔尖的 mip 链（浮点 0..1；每层长宽减半、面积平均）：缩小盖印时取够细的那层，不起锯齿 */
  mips(t){
    if (t._mips) return t._mips;
    const L0 = new Float32Array(t.a.length); for (let i = 0; i < L0.length; i++) L0[i] = t.a[i] / 255;
    const out = [{ w:t.width, h:t.height, a:L0 }];
    let cur = out[0];
    while (cur.w > 2 || cur.h > 2){
      const w = Math.max(1, cur.w >> 1), h = Math.max(1, cur.h >> 1), a = new Float32Array(w * h), fx = cur.w / w, fy = cur.h / h;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
        let s = 0, n = 0;
        for (let yy = Math.floor(y * fy); yy < Math.min(cur.h, Math.floor((y + 1) * fy)); yy++)
          for (let xx = Math.floor(x * fx); xx < Math.min(cur.w, Math.floor((x + 1) * fx)); xx++){ s += cur.a[yy * cur.w + xx]; n++; }
        a[y * w + x] = n ? s / n : 0;
      }
      cur = { w, h, a }; out.push(cur);
    }
    Object.defineProperty(t, '_mips', { value: out, enumerable:false });
    return out;
  },
  /* 给面板／游标的灰阶缩图（白＝颜料，透明底） */
  thumb(t, px){
    const c = document.createElement('canvas'); c.width = c.height = px; const x = c.getContext('2d');
    const k = px / Math.max(t.width, t.height), w = Math.max(1, Math.round(t.width * k)), h = Math.max(1, Math.round(t.height * k));
    const s = shrinkTip(t.width, t.height, t.a, Math.max(w, h)), img = x.createImageData(s.w, s.h);
    for (let i = 0; i < s.a.length; i++){ img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 230; img.data[i * 4 + 3] = s.a[i]; }
    x.putImageData(img, Math.floor((px - s.w) / 2), Math.floor((px - s.h) / 2));
    return c;
  }
};

/* ═══════════ Photoshop .abr（v6／v10，子版本 1／2）：'8BIM' 区块里的 'samp'＝取样笔尖；'desc' 里找名字 ═══════════
   版面照 GIMP app/core/gimpbrush-load.c（abr_supported、gimp_brush_load_abr_v6、gimp_brush_load_abr_brush_v6、abr_rle_decode）：
     档头 u16 版本、u16 子版本；区块 '8BIM' + 4 字键 + u32 长度；
     samp 里每个笔尖：u32 长度（补到 4 的倍数）、键（Pascal 字串：1 位元组长度＋UUID）连同杂项，子版本 1 共 47 位元组、子版本 2 共 301 位元组；
     再来 i32 top/left/bottom/right、i16 位元深度（8／16）、u8 压缩（0＝原始、1＝PackBits：先 height 个 u16 行长再逐行）。
   名字：'desc' 描述子里 "Nm  " TEXT（预设名）后面跟着的 "sampledData" TEXT（＝笔尖 UUID）就是那支笔尖的名字。
   读不了的给清楚的错误：v1／v2（Photoshop 5 以前）、其他版本号、没有 samp 区块（只有计算笔尖）。 */
function parseAbr(u8, baseName){
  if (!(u8 instanceof Uint8Array)) u8 = new Uint8Array(u8);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), n = u8.length;
  const need = (at, k) => { if (at + k > n) throw new Error('ABR file is truncated (unexpected end of data)'); };
  const str4 = at => String.fromCharCode(u8[at], u8[at + 1], u8[at + 2], u8[at + 3]);
  if (n < 4) throw new Error('not a Photoshop brush file (.abr): too short');
  const ver = dv.getUint16(0), sub = dv.getUint16(2);
  if (ver === 1 || ver === 2) throw new Error(`Photoshop .abr version ${ver} (Photoshop 5 and earlier) is not supported — open the brushes in Photoshop 6 or later and save them again`);
  if (ver !== 6 && ver !== 10) throw new Error(`not a supported Photoshop brush file (.abr): unknown version ${ver}`);
  if (sub !== 1 && sub !== 2) throw new Error(`unsupported Photoshop .abr version ${ver}.${sub} (only sub-versions 1 and 2 are known)`);
  // 区块
  const secs = {}; let at = 4;
  while (at + 12 <= n){
    if (str4(at) !== '8BIM') throw new Error(`ABR file is damaged: expected an '8BIM' block at byte ${at}`);
    const key = str4(at + 4), len = dv.getUint32(at + 8), start = at + 12;
    if (start + len > n) throw new Error(`ABR file is truncated ('${key}' block)`);
    if (!secs[key]) secs[key] = [start, start + len];
    at = start + len;
  }
  if (at < n && u8.subarray(at).some(v => v)) throw new Error(`ABR file is truncated or damaged: ${n - at} stray bytes at the end`);
  if (!secs.samp) throw new Error('this .abr has no sampled brush tips (only computed round brushes, which are just size/hardness settings) — nothing to import');
  // 名字（desc）
  const names = {};
  if (secs.desc){
    const [d0, d1] = secs.desc; let last = null;
    const text = p => { need(p, 4); const c = dv.getUint32(p); if (c > 4096) return null; need(p + 4, c * 2); let s = ''; for (let i = 0; i < c; i++) s += String.fromCharCode(dv.getUint16(p + 4 + i * 2)); return s.replace(/\0+$/, ''); };
    for (let p = d0 + 4; p + 4 <= d1; p++){
      if (u8[p] !== 0x54 || str4(p) !== 'TEXT') continue;               // 'TEXT'
      if (p >= d0 + 4 && str4(p - 4) === 'Nm  ') last = text(p + 4);
      else if (p >= d0 + 11 && String.fromCharCode(...u8.subarray(p - 11, p)) === 'sampledData'){ const id = text(p + 4); if (id && last) names[id] = last; }
    }
  }
  // 笔尖（samp）
  const [s0, s1] = secs.samp, tips = [], skipped = [];
  let p = s0, idx = 0;
  while (p + 4 <= s1){
    const size = dv.getUint32(p), next = p + 4 + Math.ceil(size / 4) * 4;
    if (size === 0 || p + 4 + size > s1) throw new Error(`ABR file is damaged: brush ${idx + 1} runs past the end of the 'samp' block`);
    const q = p + 4, klen = u8[q], uuid = String.fromCharCode(...u8.subarray(q + 1, q + 1 + Math.min(klen, 64)));
    const h0 = q + (sub === 1 ? 47 : 301); need(h0, 19);
    const top = dv.getInt32(h0), left = dv.getInt32(h0 + 4), bottom = dv.getInt32(h0 + 8), right = dv.getInt32(h0 + 12);
    const depth = dv.getInt16(h0 + 16), comp = u8[h0 + 18], w = right - left, h = bottom - top;
    idx++;
    const name = names[uuid] || `${baseName || 'ABR'} ${idx}`;
    if (!(w > 0 && h > 0 && w <= 30000 && h <= 30000) || (depth !== 8 && depth !== 16) || comp > 1){
      skipped.push({ index:idx, name, reason:`unsupported tip (${w}×${h}, ${depth}-bit, compression ${comp})` }); p = next; continue;
    }
    const bpp = depth >> 3, rowB = w * bpp, raw = new Uint8Array(rowB * h);
    let d = h0 + 19;
    if (!comp){ need(d, raw.length); raw.set(u8.subarray(d, d + raw.length)); }
    else {
      need(d, h * 2); const lens = []; for (let y = 0; y < h; y++) lens.push(dv.getUint16(d + y * 2)); d += h * 2;
      for (let y = 0; y < h; y++){ need(d, lens[y]); packBitsDecode(u8, d, d + lens[y], raw, y * rowB, rowB); d += lens[y]; }
    }
    const a = new Uint8Array(w * h);
    if (bpp === 1) a.set(raw); else for (let i = 0; i < a.length; i++) a[i] = raw[i * 2];   // 16 位：取高位元组（大端）
    if (!a.some(v => v > 0)){ skipped.push({ index:idx, name, reason:'empty tip' }); p = next; continue; }
    tips.push({ name, width:w, height:h, a, uuid });
    p = next;
  }
  return { version:`${ver}.${sub}`, tips, skipped };
}

/* ═══════════ 离屏笔印快取（大笔尖流畅的关键）：同一支笔尖、同大小／角度／圆度／翻转／投影／次像素位置 ⇒ 覆盖值只算一次 ═══════════
   取样笔尖一律走这里（每格要 mip 选层＋双线性取样，不快取就太慢）；圆笔尖半径 ≥ ROUND_STAMP_R 才走（小的直接算更快、也免得位置量化）。
   次像素量化到 1/4 像素；角度 0.25°；圆度 1/256。总量超过 STAMP_BUDGET 个浮点就从最旧的丢。 */
const ROUND_STAMP_R = 32, STAMP_BUDGET = 24e6;
const StampCache = {
  map: new Map(), used: 0, hits: 0, misses: 0,
  get(key, make){
    let s = this.map.get(key);
    if (s){ this.map.delete(key); this.map.set(key, s); this.hits++; return s; }
    s = make(); this.misses++;
    this.map.set(key, s); this.used += s.a.length + (s.wet ? s.wet.length : 0);
    while (this.used > STAMP_BUDGET && this.map.size > 1){ const [k, v] = this.map.entries().next().value; this.map.delete(k); this.used -= v.a.length + (v.wet ? v.wet.length : 0); }
    return s;
  },
  dropTip(id){ for (const [k, v] of [...this.map]) if (k.startsWith(id + '|')){ this.map.delete(k); this.used -= v.a.length + (v.wet ? v.wet.length : 0); } },
  clear(){ this.map.clear(); this.used = 0; this.hits = this.misses = 0; }
};
const q4 = v => Math.round(v * 4) / 4;
/* 一个笔印的快取盖印：{x0,y0,w,h,a,wet?}（图层坐标；a＝0..1 覆盖值，wet＝湿边系数） */
function stampFor(d, b, tip){
  const qx = q4(d.cx), qy = q4(d.cy), ix = Math.floor(qx), iy = Math.floor(qy), fx = qx - ix, fy = qy - iy;
  const proj = d.projScale < 0.999;
  const angQ = Math.round(d.angle * 180 / Math.PI * 4) / 4, roQ = Math.round(d.roundness * 256) / 256;
  const wet = !!b.wetEdges;
  let key, R;
  if (tip){
    const s = 2 * d.radius / Math.max(tip.width, tip.height);
    R = Math.hypot(tip.width * s / 2, tip.height * s * roQ / 2);
    key = `${tip.id}|${q4(d.radius)}|${angQ}|${roQ}|${d.flipX ? 1 : 0}${d.flipY ? 1 : 0}|${proj ? Math.round(d.projAngle * 180 / Math.PI) + ',' + Math.round(d.projScale * 100) : ''}|${fx},${fy}|${wet ? 1 : 0}|${b.aliased ? 1 : 0}`;
  } else {
    R = d.radius;
    const sym = roQ >= 1 && !proj;                     // 正圆：角度、翻转都没差
    key = `R|${q4(d.radius)}|${Math.round(c01(b.hardness) * 256)}|${sym ? 0 : angQ}|${roQ}|${proj ? Math.round(d.projAngle * 180 / Math.PI) + ',' + Math.round(d.projScale * 100) : ''}|${fx},${fy}|${wet ? 1 : 0}`;
  }
  const K = Math.ceil(R) + 2;
  const st = StampCache.get(key, () => {
    const W = 2 * K + 1, a = new Float32Array(W * W), wa = wet ? new Float32Array(W * W) : null;
    const ang = angQ * Math.PI / 180, sn = Math.sin(ang), cs = Math.cos(ang), sx = d.flipX ? -1 : 1, sy = d.flipY ? -1 : 1;
    const pr = proj ? [Math.cos(d.projAngle), Math.sin(d.projAngle), 1 / Math.max(d.projScale, 0.05) - 1] : null;
    let mip = null, s = 1, lv = 0, M = null, tw = 0, th = 0;
    if (tip){
      s = 2 * d.radius / Math.max(tip.width, tip.height); tw = tip.width; th = tip.height;
      const mips = BrushTips.mips(tip); lv = clamp(Math.floor(Math.log2(Math.max(1 / s, 1))), 0, mips.length - 1); M = mips[lv];
    }
    const r = d.radius, ro = Math.min(Math.max(roQ, 0.5 / r), 1), rm = Math.max(r * ro, 0.5), hard = b.hardness;
    const scl = 1 << lv, invS = 1 / s, invSro = 1 / (s * Math.max(roQ, 0.01));
    for (let j = 0; j < W; j++){
      const dy = (j - K) + 0.5 - fy;
      for (let i = 0; i < W; i++){
        const dx = (i - K) + 0.5 - fx;
        let ux = dx, uy = -dy;
        if (pr){ const t = (ux * pr[0] + uy * pr[1]) * pr[2]; ux += t * pr[0]; uy += t * pr[1]; }
        const u = (ux * cs + uy * sn) * sx, v = (-ux * sn + uy * cs) * sy;
        let val;
        if (!tip){
          const dd = Math.sqrt((u * ro) * (u * ro) + v * v);
          if (dd >= rm + 0.5) continue;
          val = dabCoverage(dd, rm, hard);
          if (wa) wa[j * W + i] = 0.5 + 0.5 * smoothstep(0.5, 1, dd / rm);
        } else {
          const tx = (tw / 2 + u * invS) / scl - 0.5, ty = (th / 2 - v * invSro) / scl - 0.5;   // 笔尖像素坐标（这一层 mip）
          const x0 = Math.floor(tx), y0 = Math.floor(ty), ax = tx - x0, ay = ty - y0;
          if (x0 < -1 || y0 < -1 || x0 >= M.w || y0 >= M.h) continue;
          const at = (x, y) => (x >= 0 && y >= 0 && x < M.w && y < M.h) ? M.a[y * M.w + x] : 0;
          val = (at(x0, y0) * (1 - ax) + at(x0 + 1, y0) * ax) * (1 - ay) + (at(x0, y0 + 1) * (1 - ax) + at(x0 + 1, y0 + 1) * ax) * ay;
          if (b.aliased) val = val >= 0.5 ? 1 : 0;
          if (wa) wa[j * W + i] = 0.5 + 0.5 * (1 - val);   // 取样笔尖的湿边：颜料越实越淡，边缘留得较深
        }
        if (val > 0) a[j * W + i] = val;
      }
    }
    return { K, w:W, h:W, a, wet:wa };
  });
  return { x0: ix - st.K, y0: iy - st.K, w: st.w, h: st.h, a: st.a, wet: st.wet };
}
/* 纹理／双重画笔的覆盖率合成（c＝笔画覆盖率，s＝纹理或第二支笔尖的值；1＝不挡）——同 tools/mixer.js makeGrain 的各模式 */
function maskCombine(mode, c, s){
  let o;
  switch (mode){
    case 'subtract':     o = c - (1 - s); break;
    case 'darken':       o = Math.min(c, s); break;
    case 'overlay':      o = c < 0.5 ? 2 * c * s : 1 - 2 * (1 - c) * (1 - s); break;
    case 'colorDodge':   o = c * (s + (1 - s) * c); break;
    case 'colorBurn':    o = 1 - Math.min(1, (1 - c) / Math.max(s, 1e-3)); break;
    case 'linearBurn':   o = c + s - 1; break;
    case 'hardMix':      o = c + s > 1 ? c : 0; break;
    case 'linearHeight': o = c * c01((s - (1 - c)) / Math.max(c, 1e-3)); break;
    case 'height':       o = c > 1 - s ? c : 0; break;
    default:             o = c * s;
  }
  return c01(o);
}
/* 纹理取样：用混合器画笔那支（tools/mixer.js makeGrain：图案灰度＋亮度／对比度／反相、文件坐标平铺、按模式与深度合成） */
const grainOf = tx => (tx && tx.enabled && window.MixerBrush && MixerBrush.makeGrain) ? MixerBrush.makeGrain(tx) : null;
/* 双重画笔的第二支笔：自己的笔尖、大小、间距、散布、数量；平滑跟主笔一样（路径对得上）；种子另起一条 */
function dualBrushOf(b){
  const db = b.dualBrush, s = defaultBrush();
  s.tip = db.tip || ''; s.size = clamp(db.size, 1, SIZE_MAX); s.hardness = c01(db.hardness); s.spacing = clamp(db.spacing, 0.01, 10);
  s.pressureSize = false; s.texture.enabled = false; s.dualBrush.enabled = false;
  const sc = clamp(db.scatter, 0, 10), cnt = clamp(Math.round(db.count), 1, 16);
  s.scattering = { enabled: sc > 0 || cnt > 1, scatter: Object.assign(dyn(), { jitter:sc }), bothAxes: !!db.bothAxes, count:cnt, countJitter:dyn() };
  if (db.flip){ s.shapeDynamics.enabled = true; s.shapeDynamics.flipXJitter = true; }
  s.smoothing = clone(b.smoothing); s.spacingEnabled = true; s.buildUp = b.buildUp; s.buildUpRate = b.buildUpRate;
  s._seed = (b._seed ^ 0x6475616C6272n) & M64;
  return s;
}

/* 覆盖率缓冲：{x0,y0,w,h,cov,col}；主缓冲＝整层，尾巴预览用一小块复本（render.rs:496-501 subset） */
const newBuf = (x0, y0, w, h, withCol) => ({ x0, y0, w, h, cov:new Float32Array(w * h), col: withCol ? new Float32Array(w * h * 3) : null });

class StrokeRenderer {
  /* b＝解析后的笔刷；W,H＝图层画布尺寸；ox,oy＝图层位移（杂讯／溶解的乱数用文件坐标，换图层位置也一样） */
  constructor(b, W, H, zoom, ox, oy){
    this.b = b; this.W = W; this.H = H; this.ox = ox || 0; this.oy = oy || 0;
    this.perDab = b.colorDynamics.enabled && !b.erase;     // render.rs:393
    this.main = newBuf(0, 0, W, H, this.perDab);
    this.gen = new DabGenerator(b, zoom);
    this.bounds = null; this.dirty = null; this.count = 0; this.record = null;
    this.tip = b.tip ? BrushTips.get(b.tip) : null;          // 取样笔尖（找不到＝resolveBrush 早就报错了）
    if (this.tip) BrushTips.doc.add(this.tip.id);            // 用过的笔尖跟着这份档存
    const tx = b.texture;
    this.grain = (tx && tx.enabled && !b._noTexture) ? grainOf(tx) : null;
    this.grainEach = !!(this.grain && tx.eachTip);
    // 双重画笔：第二支笔自己一个渲染器（同尺寸覆盖率缓冲），合成时照 dualBrush.mode 挡主笔
    this.sec = (b.dualBrush && b.dualBrush.enabled) ? new StrokeRenderer(dualBrushOf(b), W, H, zoom, ox, oy) : null;
    this.dualMode = this.sec ? b.dualBrush.mode : null;
  }
  /* 这个笔印会碰到的格子：走快取盖印的用盖印外框（取样笔尖斜放时比半径大），其余照 render.rs:144-150 */
  _useStamp(d){ return !!this.tip || (!this.b.aliased && d.radius >= ROUND_STAMP_R); }
  _rect(d){ if (!this._useStamp(d)) return dabRect(d); const s = stampFor(d, this.b, this.tip); return [s.x0, s.y0, s.x0 + s.w, s.y0 + s.h]; }
  /* 快取盖印版的 accumulate：每格只查表（杂讯、湿边、逐笔印纹理照原式加上） */
  _accumStamp(d, buf){
    const s = stampFor(d, this.b, this.tip);
    const r0 = inter([s.x0, s.y0, s.x0 + s.w, s.y0 + s.h], buf.x0, buf.y0, buf.x0 + buf.w, buf.y0 + buf.h);
    if (!r0) return null;
    const b = this.b, noise = b.noise, ceil = d.opacity, wetA = s.wet, wet = !!wetA, grain = this.grainEach ? this.grain : null;
    const cov = buf.cov, col = buf.col, color = d.color, A = s.a, alpha = d.alpha;
    for (let y = r0[1]; y < r0[3]; y++){
      const sr = (y - s.y0) * s.w - s.x0, br = (y - buf.y0) * buf.w - buf.x0;
      for (let x = r0[0]; x < r0[2]; x++){
        let val = A[sr + x];
        if (val <= 0) continue;
        if (noise && val < 1){ const n = hash2(x + this.ox, y + this.oy, NOISE_SALT); val += ((n < val ? 1 : 0) - val) * 0.7; }
        if (wet) val *= wetA[sr + x];
        if (grain) val = grain(val, x + this.ox, y + this.oy);
        const vv = val * alpha;
        if (vv <= 0) continue;
        const i = br + x, c = cov[i];
        const nv = wet ? Math.max(c, vv * ceil) : (ceil > c ? c + vv * (ceil - c) : c);
        if (nv <= c) continue;
        if (col){
          const k = c < 1 ? (nv - c) / (1 - c) : 0, j = i * 3;
          col[j] = color[0] * k + col[j] * (1 - k); col[j + 1] = color[1] * k + col[j + 1] * (1 - k); col[j + 2] = color[2] * k + col[j + 2] * (1 - k);
        }
        cov[i] = nv;
      }
    }
    return r0;
  }
  /* render.rs:153-237 rasterize（圆笔尖）＋ 297-361 accumulate：c ← c + v·(上限 − c)；湿边用 max */
  _accum(d, buf){
    if (this._useStamp(d)) return this._accumStamp(d, buf);
    const r0 = inter(dabRect(d), buf.x0, buf.y0, buf.x0 + buf.w, buf.y0 + buf.h);
    if (!r0) return null;
    const grain = this.grainEach ? this.grain : null;
    const b = this.b, aliased = b.aliased, wet = b.wetEdges, noise = b.noise, hard = b.hardness, ceil = d.opacity;
    const [cx, cy] = aliased ? gridCenter(d.cx, d.cy, 2 * d.radius) : [d.cx, d.cy];
    const sn = Math.sin(d.angle), cs = Math.cos(d.angle), fx = d.flipX ? -1 : 1, fy = d.flipY ? -1 : 1;
    const proj = d.projScale < 0.999 ? [Math.cos(d.projAngle), Math.sin(d.projAngle), 1 / Math.max(d.projScale, 0.05) - 1] : null;
    const r = d.radius, ro = Math.min(Math.max(d.roundness, 0.5 / r), 1), rm = Math.max(r * ro, 0.5);
    const reach2 = (rm + 0.5) * (rm + 0.5);
    const cov = buf.cov, col = buf.col, color = d.color;
    for (let y = r0[1]; y < r0[3]; y++){
      const dy = y + 0.5 - cy;
      for (let x = r0[0]; x < r0[2]; x++){
        const dx = x + 0.5 - cx;
        let ux = dx, uy = -dy;                              // 转成 y 朝上 → 投影 → 转 -angle → 翻转
        if (proj){ const t = (ux * proj[0] + uy * proj[1]) * proj[2]; ux += t * proj[0]; uy += t * proj[1]; }
        const u = (ux * cs + uy * sn) * fx, v = (-ux * sn + uy * cs) * fy;
        const d2 = (u * ro) * (u * ro) + v * v;
        if (d2 >= reach2) continue;
        const dd = Math.sqrt(d2);
        let val = aliased ? (dd <= rm ? 1 : 0) : dabCoverage(dd, rm, hard);
        if (val <= 0) continue;
        if (noise && val < 1){ const n = hash2(x + this.ox, y + this.oy, NOISE_SALT); val += ((n < val ? 1 : 0) - val) * 0.7; }
        if (wet) val *= 0.5 + 0.5 * smoothstep(0.5, 1, dd / rm);
        if (grain) val = grain(val, x + this.ox, y + this.oy);   // 纹理「为每个笔尖设置纹理」
        const vv = val * d.alpha;
        if (vv <= 0) continue;
        const i = (y - buf.y0) * buf.w + (x - buf.x0), c = cov[i];
        const nv = wet ? Math.max(c, vv * ceil) : (ceil > c ? c + vv * (ceil - c) : c);
        if (nv <= c) continue;
        if (col){                                          // 每个笔印自己的颜色（预乘，render.rs:349-355）
          const k = c < 1 ? (nv - c) / (1 - c) : 0, j = i * 3;
          col[j] = color[0] * k + col[j] * (1 - k); col[j + 1] = color[1] * k + col[j + 1] * (1 - k); col[j + 2] = color[2] * k + col[j + 2] * (1 - k);
        }
        cov[i] = nv;
      }
    }
    return r0;
  }
  _raster(dabs){
    for (const d of dabs){
      const r = this._accum(d, this.main);
      this.count++;
      if (this.record) this.record.push(d);
      if (r){ this.bounds = uni(this.bounds, r); this.dirty = uni(this.dirty, r); }
    }
  }
  /* 第二支笔（双重画笔）跟着同一批点走；它新盖到的格子也要重合成（主笔早盖过的地方会被它「打开」） */
  _secSync(){ if (this.sec && this.sec.dirty){ this.dirty = uni(this.dirty, this.sec.dirty); this.sec.dirty = null; } }
  push(pts){ const out = []; this.gen.push(pts, out); this._raster(out); if (this.sec){ this.sec.push(pts); this._secSync(); } }   // render.rs:463-466
  finish(){ const out = []; this.gen.finish(out); this._raster(out); if (this.sec){ this.sec.finish(); this._secSync(); } }       // render.rs:469-472
  /* render.rs:474-519 tail_preview：现在收笔会多出的那截（平滑的追赶尾巴、或单独第一点），画进主缓冲的一块复本 */
  tailPreview(){
    const g = this.gen.clone(), out = [];
    g.finish(out);
    if (!out.length) return null;
    let rect = null;
    for (const d of out){ const r = inter(this._rect(d), 0, 0, this.W, this.H); if (r) rect = uni(rect, r); }
    if (!rect) return null;
    const m = this.main, w = rect[2] - rect[0], h = rect[3] - rect[1], buf = newBuf(rect[0], rect[1], w, h, this.perDab);
    for (let y = 0; y < h; y++){
      const si = (rect[1] + y) * m.w + rect[0];
      buf.cov.set(m.cov.subarray(si, si + w), y * w);
      if (m.col) buf.col.set(m.col.subarray(si * 3, (si + w) * 3), y * w * 3);
    }
    for (const d of out) this._accum(d, buf);
    return { rect, buf };
  }
  /* render.rs:563-657 composite：永远从 pre（下笔前）算，所以能反复增量合成；k = 覆盖率 × 不透明度 × 选区 */
  composite(ctx, pre, rect, buf, sel){
    if (!rect) return;
    const r = inter(rect, Math.max(buf.x0, 0), Math.max(buf.y0, 0), Math.min(buf.x0 + buf.w, this.W), Math.min(buf.y0 + buf.h, this.H));
    if (!r) return;
    const [x0, y0, x1, y1] = r, w = x1 - x0, h = y1 - y0, W = this.W;
    const out = ctx.createImageData(w, h), od = out.data, pd = pre.data;
    const b = this.b, op = c01(b.opacity), mode = b.mode, erase = b.erase;
    const dissolve = mode === 'dissolve', normal = mode === 'normal' || dissolve;
    const cov = buf.cov, col = this.perDab ? buf.col : null, src = b.color.slice();
    // 整笔一次的遮罩：双重画笔（第二支笔的覆盖率照模式挡）、纹理（没勾「为每个笔尖设置纹理」＝整笔套一次图案）
    const dual = this.sec ? this.sec.main.cov : null, dmode = this.dualMode, grain = (this.grain && !this.grainEach) ? this.grain : null;
    for (let y = y0; y < y1; y++){
      const inY = !sel || (y + 0.5 >= sel[1] && y + 0.5 < sel[3]);
      for (let x = x0; x < x1; x++){
        const pi = (y * W + x) * 4, oi = ((y - y0) * w + (x - x0)) * 4;
        od[oi] = pd[pi]; od[oi + 1] = pd[pi + 1]; od[oi + 2] = pd[pi + 2]; od[oi + 3] = pd[pi + 3];
        const bi = (y - buf.y0) * buf.w + (x - buf.x0), c = cov[bi];
        if (c <= 0) continue;
        let cm = c;
        if (dual){ cm = maskCombine(dmode, cm, dual[y * W + x]); if (cm <= 0) continue; }
        if (grain){ cm = grain(cm, x + this.ox, y + this.oy); if (cm <= 0) continue; }
        const s = (inY && (!sel || (x + 0.5 >= sel[0] && x + 0.5 < sel[2]))) ? 1 : 0;
        let k = Math.min(cm * op * s, 1);
        if (k <= 0) continue;
        if (dissolve){ k = hash2(x + this.ox, y + this.oy, b._seed) < k ? 1 : 0; if (!k) continue; }
        if (erase){ od[oi + 3] = Math.round(pd[pi + 3] * (1 - k)); continue; }
        if (this.lockAlpha && pd[pi + 3] === 0) continue;                       // 锁透明像素：透明的格子不画（render.rs:629）
        if (col){ const j = bi * 3; src[0] = col[j] / c; src[1] = col[j + 1] / c; src[2] = col[j + 2] / c; }
        const dr = pd[pi] / 255, dg = pd[pi + 1] / 255, db = pd[pi + 2] / 255, da = pd[pi + 3] / 255;
        let o;
        if (normal){                                       // retouch.rs:143-163 over_native
          const sa = src[3] * k, oa = sa + da * (1 - sa);
          o = oa > 0 ? [(src[0] * sa + dr * da * (1 - sa)) / oa, (src[1] * sa + dg * da * (1 - sa)) / oa, (src[2] * sa + db * da * (1 - sa)) / oa, oa]
                     : [dr, dg, db, oa];
        } else o = blendComposite(mode, [dr, dg, db, da], src, k);
        od[oi] = Math.round(c01(o[0]) * 255); od[oi + 1] = Math.round(c01(o[1]) * 255);
        od[oi + 2] = Math.round(c01(o[2]) * 255); od[oi + 3] = this.lockAlpha ? pd[pi + 3] : Math.round(c01(o[3]) * 255);   // 锁透明像素：alpha 不变（retouch.rs:153 over_native）
      }
    }
    ctx.putImageData(out, x0, y0);
  }
}

/* 选区（文件坐标）→ 图层坐标 [x0,y0,x1,y1] */
function selFor(L){ const s = Doc.sel; return s ? [s.x - L.x, s.y - L.y, s.x - L.x + s.w, s.y - L.y + s.h] : null; }

/* brush_cmds.rs:53-82 parse_points：[x,y,pressure?,tiltX?,tiltY?,rotation?,timeMs?,wheel?] 或 {x,y,pressure,tiltX,tiltY,rotation,time,wheel} */
function parsePoints(raw){
  if (!Array.isArray(raw)) return { error:'missing `points`' };
  const pts = [];
  for (const v of raw){
    if (Array.isArray(v)){
      const g = i => isNum(v[i]) ? v[i] : undefined;
      if (g(0) === undefined || g(1) === undefined) continue;
      pts.push(mkPt(g(0), g(1), { pressure: g(2) !== undefined ? g(2) : 1, tiltX: g(3) || 0, tiltY: g(4) || 0,
        rotation: g(5) || 0, time: g(6) || 0, wheel: g(7) !== undefined ? g(7) : 1 }));
    } else if (isObj(v)){
      if (!isNum(v.x) || !isNum(v.y)) continue;
      const o = {}; ['pressure','tiltX','tiltY','rotation','time','wheel'].forEach(k => { if (isNum(v[k])) o[k] = v[k]; });
      pts.push(mkPt(v.x, v.y, o));
    }
  }
  if (!pts.length) return { error:'`points` is empty' };
  if (pts.some(q => !(Math.abs(q.x) <= MAX_COORD && Math.abs(q.y) <= MAX_COORD)))
    return { error:`point coordinates must be finite and within ±${MAX_COORD}` };
  return { pts };
}

/* 种子：参数 seed（数字或数字字串），不然由 points 杂凑（brush_cmds.rs:175-178） */
function seedOf(p){
  if (typeof p.seed === 'string' && /^\d+$/.test(p.seed)) return BigInt(p.seed) & M64;
  if (isNum(p.seed) && p.seed >= 0) return BigInt(Math.floor(p.seed)) & M64;
  return seedFromBytes(JSON.stringify(p.points === undefined ? null : p.points));
}

/* 指针：滑鼠一律满压（stylus.rs）；笔／触控才读压力、倾斜、旋转 */
const pressureOf = e => (e && e.pointerType && e.pointerType !== 'mouse' && e.pressure > 0) ? e.pressure : 1;
const poseOf = e => (e && e.pointerType === 'pen' && (e.tiltX || e.tiltY || e.twist)) ? [e.tiltX || 0, e.tiltY || 0, e.twist || 0] : null;

/* stroke_constraint.rs:37-50 */
function snappedDir(o, p, step){
  const dx = p[0] - o[0], dy = p[1] - o[1];
  if (!(isFinite(dx) && isFinite(dy)) || Math.hypot(dx, dy) < 1e-9 || step <= 0) return null;
  const a = Math.round(Math.atan2(dy, dx) / step) * step;
  return [Math.cos(a), Math.sin(a)];
}
function project(o, d, p){ const t = (p[0] - o[0]) * d[0] + (p[1] - o[1]) * d[1]; return [o[0] + d[0] * t, o[1] + d[1] * t]; }

/* ═══════════ 工具 ═══════════ */
const T = Tools.reg({
  id:'brush', icon:'✎', key:'B', group:'raster', order:10, for:'raster', needs:'raster', opts:[],
  hint:'ui.brushHint', cursor:'none',
  strings:{
    'zh-Hant':{ 'opt.brush.opacity':'不透明度', 'opt.brush.flow':'流量', 'opt.brush.smoothing':'平滑化',
                'opt.brush.pressureSize':'壓力控制大小', 'opt.brush.pressureOpacity':'壓力控制不透明度',
                'ui.brush.diameter':'直徑：', 'ui.brush.hardness':'硬度：', 'ui.brush.size':'尺寸', 'ui.brush.hardnessLabel':'硬度',
                'ui.brushHint':'Shift 拖曳＝直線；Shift＋點＝接上一筆；Ctrl+Alt 拖曳＝改大小／硬度；[ ]＝縮放筆尖；右鍵＝筆刷挑選器' },
    'zh-Hans':{ 'opt.brush.opacity':'不透明度', 'opt.brush.flow':'流量', 'opt.brush.smoothing':'平滑',
                'opt.brush.pressureSize':'压力控制大小', 'opt.brush.pressureOpacity':'压力控制不透明度',
                'ui.brush.diameter':'直径：', 'ui.brush.hardness':'硬度：', 'ui.brush.size':'大小', 'ui.brush.hardnessLabel':'硬度',
                'ui.brushHint':'Shift 拖动＝直线；Shift＋点＝接上一笔；Ctrl+Alt 拖动＝改大小／硬度；[ ]＝缩放笔尖；右键＝画笔预设选取器' },
    'en':     { 'opt.brush.opacity':'Opacity', 'opt.brush.flow':'Flow', 'opt.brush.smoothing':'Smoothing',
                'opt.brush.pressureSize':'Pressure for Size', 'opt.brush.pressureOpacity':'Pressure for Opacity',
                'ui.brush.diameter':'Diameter:', 'ui.brush.hardness':'Hardness:', 'ui.brush.size':'Size', 'ui.brush.hardnessLabel':'Hardness',
                'ui.brushHint':'Shift-drag: straight line · Shift-click: line from last stroke · Ctrl+Alt-drag: size/hardness · [ ]: brush size · right-click: brush picker' }
  },

  /* 笔刷现值（除 size／hardness 外）。size／hardness 跟橡皮擦、图章共用 ToolState（PhotoCraft 也共用一支 session brush）；
     平滑是笔刷自己的一份，起始 10%（engine/src/lib.rs:216-218、paint_mouse.rs:13-40） */
  brush: (() => { const b = defaultBrush(); b.smoothing.amount = 0.1; delete b.size; delete b.hardness; return b; })(),

  _drag:null,        // {L, b, ren, pre, sel, pts:[[x,y,p(,tx,ty,rot)]…] 文件坐标, start, axis, tail, hasPose}
  _resize:null,      // {anchor, start:[size,hardness], at}
  _lastEnd:null,     // {key, pt}：上一笔终点（Shift＋点从这里拉直线）
  _hover:null, _shift:false, _bound:false, _picker:null,
  lastParams:null,   // 最近一次滑鼠提交的 brush.stroke 参数（给自测与 agent 对照）

  /* 整支笔刷（含共用的 size／hardness） */
  current(){ const b = clone(this.brush); b.size = ToolState.size; b.hardness = ToolState.hardness; return b; },

  /* 「同一份文件」＝同一个 Doc.serial（每次 Doc.reset／Project.load +1，undo 不变）——
     Shift＋点不接到别份文件的笔上，撤销后仍接得上（stroke_constraint.rs:236-257：他们比 doc.id） */
  _docKey(){ return Doc.serial; },
  _lastEndValid(){ return !!(this._lastEnd && this._lastEnd.key === this._docKey()); },

  /* stroke_constraint.rs:63-83 constrain（绘画工具那支） */
  _constrain(d, p, shift){
    if (!shift){ d.axis = null; return p; }
    const last = d.pts[d.pts.length - 1];
    if (!d.axis) d.axis = { origin:[last[0], last[1]], dir:null };
    const a = d.axis;
    if (!a.dir){
      const reach = LOCK_DISTANCE / Math.max(UI.zoom, 1e-3);
      if (Math.hypot(p[0] - a.origin[0], p[1] - a.origin[1]) < reach) return a.origin.slice();
      a.dir = snappedDir(a.origin, p, Math.PI / 4);
    }
    return a.dir ? project(a.origin, a.dir, p) : a.origin.slice();
  },

  _docPt(ev){ const r = UI.canvas.getBoundingClientRect(); return [(ev.clientX - r.left) / UI.zoom, (ev.clientY - r.top) / UI.zoom]; },

  _bind(){
    if (this._bound || !window.UI || !UI.canvas) return;
    this._bound = true;
    UI.canvas.addEventListener('pointerleave', () => { this._hover = null; if (Tools.current() === this) UI.draw(); });
    // 右键开挑选器，不弹浏览器选单（paint_mouse.rs:51-83）
    UI.canvas.addEventListener('contextmenu', e => { if (Tools.current() === this) e.preventDefault(); });
    // Shift 按下／放开：橡皮筋预览跟着出现／消失；Esc／Enter 关挑选器（paint_mouse.rs:105）
    const k = (e, v) => {
      if (e.key === 'Shift'){ this._shift = v; if (Tools.current() === this) UI.draw(); }
      if (v && this._picker && (e.key === 'Escape' || e.key === 'Enter')) this._closePicker();
    };
    document.addEventListener('keydown', e => k(e, true));
    document.addEventListener('keyup',   e => k(e, false));
    // 挑选器外面按一下就关（paint_mouse.rs:124-127）
    document.addEventListener('pointerdown', e => { if (this._picker && !this._picker.contains(e.target)) this._closePicker(); }, true);
  },

  /* canvas.rs:2042-2105 Down */
  onDown(e, pt, P){
    this._bind();
    this._shift = !!e.shiftKey; this._hover = pt;
    // 右键／中键不画（paint_mouse.rs:1-5）；记下右键按下处，放开时没拖动才算「点」（egui secondary_clicked）
    if (e.button !== undefined && e.button !== 0){ this._rdown = [e.clientX, e.clientY]; return; }
    // brush_resize.rs:59-69：Ctrl+Alt 按下＝改笔尖，不画；正在画的那一笔不被接管
    if (!this._drag && e.ctrlKey && e.altKey){
      this._resize = { anchor:[pt[0], pt[1]], start:[ToolState.size, ToolState.hardness], at:pt };
      UI.draw(); return;
    }
    let L = Doc.active();
    if (!L || L.kind !== 'raster'){ P.ensureRaster(); L = Doc.active(); }
    if (!L || L.kind !== 'raster') return;
    const pr = pressureOf(e), pose = poseOf(e);
    // canvas.rs:2091-2097：Shift＋点 且 这份文件有上一笔 ⇒ 先放上一笔终点，整条直线算同一笔
    const from = (e.shiftKey && this._lastEndValid()) ? this._lastEnd.pt : null;
    const pts = [pose ? [pt[0], pt[1], pr, ...pose] : [pt[0], pt[1], pr]];
    if (from) pts.unshift([from[0], from[1], pr]);
    const W = L.data.canvas.width, H = L.data.canvas.height, ctx = L.data.ctx;
    // canvas.rs:223-232 begin_live_stroke：参数与提交时同一套（同一支笔刷、同一个种子）
    const rb = resolveBrush({ points: pts, zoom: UI.zoom });
    if (rb.error) return;
    const d = { L, b: rb.b, pts, start: from || [pt[0], pt[1]], axis:null, tail:null, hasPose: !!pose,
                pre: ctx.getImageData(0, 0, W, H), sel: selFor(L),
                ren: new StrokeRenderer(rb.b, W, H, UI.zoom, L.x, L.y) };
    d.ren.lockAlpha = !!(window.Locks && Locks.alpha(L));      // 即时预览也照锁透明像素画，放开时不跳
    this._drag = d;
    this._feed(d, pts);
    UI.draw();
  },

  /* 即时预览（brush_cmds.rs:331-352 LiveStroke::push）：新点进渲染器 → 合成碰到的格子 → 先盖掉上一截尾巴 → 画「现在收笔会多出的尾巴」 */
  _feed(d, pts){
    const L = d.L, ctx = L.data.ctx;
    d.ren.push(pts.map(q => mkPt(q[0] - L.x, q[1] - L.y, { pressure:q[2], tiltX:q[3] || 0, tiltY:q[4] || 0, rotation:q[5] || 0 })));
    let dirty = d.ren.dirty; d.ren.dirty = null;
    if (d.tail) dirty = uni(dirty, d.tail);
    d.ren.composite(ctx, d.pre, dirty, d.ren.main, d.sel);
    const t = d.ren.tailPreview();
    d.tail = t ? t.rect : null;
    if (t) d.ren.composite(ctx, d.pre, t.rect, t.buf, d.sel);
  },

  /* canvas.rs:1939-1964 tool_move ＋ 2106-2109 feed_live_stroke（一帧里的每个指针样本都喂进去：getCoalescedEvents） */
  onMove(e, pt, P){
    this._bind();
    this._hover = pt; this._shift = !!e.shiftKey;
    if (this._resize){ this._resizeTo(pt); return; }
    const d = this._drag;
    if (!d){ UI.draw(); return; }                          // 只是悬停：重画笔尖圈／橡皮筋
    const evs = (e.getCoalescedEvents && UI.canvas) ? e.getCoalescedEvents() : [];
    const samples = evs.length > 1 ? evs.map(ev => [this._docPt(ev), ev]) : [[pt, e]];
    const fresh = [];
    for (const [q0, ev] of samples){
      const [x, y] = this._constrain(d, [q0[0], q0[1]], e.shiftKey);
      const last = d.pts[d.pts.length - 1];
      if (Math.abs(last[0] - x) + Math.abs(last[1] - y) > 0.25){
        const pose = poseOf(ev); if (pose) d.hasPose = true;
        const q = pose ? [x, y, pressureOf(ev), ...pose] : [x, y, pressureOf(ev)];
        d.pts.push(q); fresh.push(q);
      }
    }
    if (fresh.length) this._feed(d, fresh);
    UI.draw();
  },

  /* canvas.rs:2110-2140 Up ＋ 2144-2182 finish_gesture */
  onUp(e, pt, P){
    if (e.button === 2 && !this._drag && !this._resize){                 // 右键点一下（没拖）＝开挑选器
      const r = this._rdown; this._rdown = null;
      if (r && Math.hypot(e.clientX - r[0], e.clientY - r[1]) < 6) this._openPicker(e);
      return;
    }
    if (this._resize){ this._resizeTo(pt); this._resize = null; UI.draw(); return; }
    const d = this._drag; this._drag = null;
    if (!d){ UI.draw(); return; }
    const [x, y] = this._constrain(d, [pt[0], pt[1]], e.shiftKey);
    const last = d.pts[d.pts.length - 1];
    if (last[0] !== x || last[1] !== y) d.pts.push([x, y, last[2]]);
    const end = d.pts[d.pts.length - 1];
    // 先把预览还原，再走命令重画：历史快照才是下笔前的样子，agent 走同一条命令也得到一模一样的像素
    d.L.data.ctx.putImageData(d.pre, 0, 0);
    // stylus.rs:184-200 stroke_points：任何一点带倾斜就全部补成 6 栏
    const points = d.pts.map(q => d.hasPose ? [q[0], q[1], q[2], q[3] || 0, q[4] || 0, q[5] || 0] : [q[0], q[1], q[2]]);
    const params = { points, erase:false, zoom: UI.zoom, seed: String(d.b._seed), layerId: d.L.id };
    this.lastParams = params;
    CMD.run('brush.stroke', params);
    this._lastEnd = { key: this._docKey(), pt:[end[0], end[1]] };     // 下一次 Shift＋点从这里接（要在命令推历史之后记）
  },

  /* brush_resize.rs:87-99 update ＋ 47-55 resized（工具状态，不进历史） */
  _resizeTo(pt){
    const r = this._resize; r.at = pt;
    const z = (window.UI && UI.zoom > 0) ? UI.zoom : 1;
    const dx = pt[0] - r.anchor[0], dy = pt[1] - r.anchor[1];
    const size = clamp(Math.round(r.start[0] + 2 * (isFinite(dx) ? dx : 0)), SIZE_MIN, SIZE_MAX);
    let hard = c01(r.start[1] + (isFinite(dy) ? dy : 0) * z / HARDNESS_TRAVEL);
    hard = Math.round(hard * 100) / 100;
    if (size !== ToolState.size || hard !== ToolState.hardness) CMD.run('brush.set', { size, hardness: hard });
    else UI.draw();
  },

  /* shortcuts.rs:307-318：[ 缩小、] 放大（×1.25 取整，至少 +1）；没按修饰键才算 */
  onKey(e){
    if ((e.key !== '[' && e.key !== ']') || e.ctrlKey || e.metaKey || e.altKey) return false;
    const size = ToolState.size;
    const next = e.key === '['
      ? Math.round(Math.max(size / 1.25, 1))
      : Math.max(Math.round(Math.min(size * 1.25, BAR_SIZE_MAX)), size + 1);
    if (next !== size) CMD.run('brush.set', { size: next });
    return true;
  },

  onDeactivate(){
    if (this._drag){ this._drag.L.data.ctx.putImageData(this._drag.pre, 0, 0); this._drag = null; }   // 画到一半换工具：还原、不提交
    this._resize = null; this._hover = null; this._closePicker();
  },

  /* ── 右键的笔刷挑选器（brush_picker.rs:89-112：大小＝数值＋对数滑杆、硬度滑杆；预设库没抄） ── */
  _openPicker(e){
    this._bind(); this._closePicker();
    const box = document.createElement('div');
    box.id = 'brushPicker';
    box.style.cssText = 'position:fixed;z-index:50;background:#2a2d33;color:#ddd;border:1px solid #444;border-radius:6px;'
      + 'padding:10px 12px;width:260px;font:12px sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.5)';
    const row = (label, el, tail) => {
      const r = document.createElement('div'); r.style.cssText = 'display:flex;align-items:center;gap:8px;margin:4px 0';
      const s = document.createElement('span'); s.textContent = label; s.style.cssText = 'width:52px;color:#aaa';
      r.appendChild(s); r.appendChild(el); if (tail) r.appendChild(tail); box.appendChild(r);
    };
    const num = mk('number', { min:SIZE_MIN, max:SIZE_MAX, value:ToolState.size }); num.dataset.picker = 'size'; num.style.width = '70px';
    const px = document.createElement('span'); px.textContent = 'px';
    const log = mk('range', { min:0, max:Math.log(SIZE_MAX), step:0.001, value:Math.log(Math.max(ToolState.size, 1)) });
    log.dataset.picker = 'sizeLog'; log.style.width = '100%';
    const hard = mk('range', { min:0, max:100, step:1, value:Math.round(ToolState.hardness * 100) }); hard.dataset.picker = 'hardness'; hard.style.flex = '1';
    const hv = document.createElement('span'); hv.textContent = Math.round(ToolState.hardness * 100) + '%';
    num.oninput = () => { if (num.value !== '' && isFinite(+num.value)) CMD.run('brush.set', { size: clamp(Math.round(+num.value), SIZE_MIN, SIZE_MAX) }); };
    log.oninput = () => CMD.run('brush.set', { size: clamp(Math.round(Math.exp(+log.value)), SIZE_MIN, SIZE_MAX) });
    hard.oninput = () => CMD.run('brush.set', { hardness: c01(+hard.value / 100) });
    row(Lang.t('ui.brush.size'), num, px);
    box.appendChild(log);
    row(Lang.t('ui.brush.hardnessLabel'), hard, hv);
    document.body.appendChild(box);
    // 整块留在萤幕内（paint_mouse.rs:109-113）
    const bw = box.offsetWidth, bh = box.offsetHeight;
    box.style.left = clamp(e.clientX, 0, Math.max(0, innerWidth - bw)) + 'px';
    box.style.top  = clamp(e.clientY, 0, Math.max(0, innerHeight - bh)) + 'px';
    this._picker = box;
  },
  _closePicker(){ if (this._picker){ this._picker.remove(); this._picker = null; } },
  _syncPicker(){
    const p = this._picker; if (!p) return;
    p.querySelectorAll('[data-picker]').forEach(el => {
      if (el === document.activeElement) return;
      const k = el.dataset.picker;
      if (k === 'size') el.value = ToolState.size;
      else if (k === 'sizeLog') el.value = Math.log(Math.max(ToolState.size, 1));
      else if (k === 'hardness'){ el.value = Math.round(ToolState.hardness * 100); el.nextSibling.textContent = el.value + '%'; }
    });
  },

  /* 选项栏（panels.rs:508-535）：每一格都只是叫 brush.set */
  buildOptions(box, add, mk){
    const num = (key, val, min, max, toOpt) => {
      const n = mk('number', { min, max, value: val });
      n.dataset.brush = key; n.style.width = '64px';
      n.onchange = n.oninput = () => { if (n.value !== '' && isFinite(+n.value)) CMD.run('brush.set', toOpt(+n.value)); };
      return n;
    };
    const b = this.brush;
    add('size',     num('size', ToolState.size, 1, BAR_SIZE_MAX, v => ({ size: clamp(v, 1, BAR_SIZE_MAX) })));
    add('hardness', num('hardness', Math.round(ToolState.hardness * 100), 0, 100, v => ({ hardness: c01(v / 100) })));
    add('brush.opacity',   num('opacity',   Math.round(b.opacity * 100), 0, 100, v => ({ opacity: c01(v / 100) })));
    add('brush.flow',      num('flow',      Math.round(b.flow * 100), 1, 100, v => ({ flow: clamp(v, 1, 100) / 100 })));
    add('brush.smoothing', num('smoothing', Math.round(b.smoothing.amount * 100), 0, 100, v => ({ smoothing: { amount: c01(v / 100) } })));
    const chk = key => {
      const c = mk('checkbox', { checked: !!b[key] }); c.dataset.brush = key;
      c.onchange = () => CMD.run('brush.set', { [key]: c.checked });
      return c;
    };
    add('brush.pressureSize', chk('pressureSize'));
    add('brush.pressureOpacity', chk('pressureOpacity'));
  },
  /* 选项改了（快捷键、Ctrl+Alt 拖、挑选器、agent 叫命令）⇒ 对齐选项栏数字，不重建（免得打字时失焦） */
  _syncBar(){
    this._syncPicker();
    if (Tools.current() !== this) return;
    const b = this.brush;
    const v = { size: ToolState.size, hardness: Math.round(ToolState.hardness * 100), opacity: Math.round(b.opacity * 100),
                flow: Math.round(b.flow * 100), smoothing: Math.round(b.smoothing.amount * 100) };
    document.querySelectorAll('#optBody [data-brush]').forEach(el => {
      if (el === document.activeElement) return;
      const k = el.dataset.brush;
      if (el.type === 'checkbox') el.checked = !!b[k];
      else if (k in v) el.value = v[k];
    });
  },

  /* 叠画：canvas.rs:1596-1646 笔尖圈（预设「正常笔尖」＝ r·(0.5+0.5·硬度)；半径 > 6 加中心十字）、
     brush_resize.rs:101-153 改笔尖时圈固定在起点＋红色笔尖预览＋读数、stroke_constraint.rs:95-123 Shift 橡皮筋 */
  drawOverlay(ctx, s){
    const z = (window.UI && UI.zoom > 0) ? UI.zoom : 1;
    const dpr = s / z;
    const ring = (cx, cy, r) => {
      ctx.lineWidth = dpr;
      ctx.strokeStyle = 'rgba(0,0,0,' + (140 / 255) + ')';
      ctx.beginPath(); ctx.arc(cx, cy, (r + 0.5) * dpr, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,' + (220 / 255) + ')';
      ctx.beginPath(); ctx.arc(cx, cy, r * dpr, 0, Math.PI * 2); ctx.stroke();
    };
    const cross = (cx, cy, len) => {
      for (const [w, c] of [[2.5, 'rgba(0,0,0,' + (140 / 255) + ')'], [1, 'rgba(255,255,255,' + (220 / 255) + ')']]){
        ctx.lineWidth = w * dpr; ctx.strokeStyle = c; ctx.beginPath();
        ctx.moveTo(cx - len * dpr, cy); ctx.lineTo(cx + len * dpr, cy);
        ctx.moveTo(cx, cy - len * dpr); ctx.lineTo(cx, cy + len * dpr); ctx.stroke();
      }
    };
    ctx.save();
    const full = Math.max(ToolState.size / 2 * z, 1);
    if (this._resize){
      const r = this._resize, cx = r.anchor[0] * s, cy = r.anchor[1] * s, R = full * dpr;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R), red = 'rgba(255,0,0,' + (110 / 255) + ')';
      g.addColorStop(0, red); g.addColorStop(c01(ToolState.hardness), red); g.addColorStop(1, 'rgba(255,0,0,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
      ring(cx, cy, full);
      const at = r.at || r.anchor, tx = at[0] * s + 16 * dpr, ty = at[1] * s + 16 * dpr;
      const lines = [Lang.t('ui.brush.diameter') + ' ' + Math.round(ToolState.size) + ' px',
                     Lang.t('ui.brush.hardness') + ' ' + Math.round(ToolState.hardness * 100) + '%'];
      ctx.font = (12 * dpr) + 'px sans-serif';
      const wBox = Math.max(...lines.map(t => ctx.measureText(t).width)) + 12 * dpr;
      ctx.fillStyle = 'rgba(30,32,36,0.9)'; ctx.fillRect(tx, ty, wBox, 40 * dpr);
      ctx.fillStyle = '#fff'; ctx.textBaseline = 'top';
      lines.forEach((t, i) => ctx.fillText(t, tx + 6 * dpr, ty + (5 + i * 16) * dpr));
      ctx.restore(); return;
    }
    const h = this._hover;
    if (h){
      const cx = h[0] * s, cy = h[1] * s;
      const tip = this.brush.tip ? BrushTips.get(this.brush.tip) : null;
      // 取样笔尖：游标画笔尖的样子（PS 的「正常画笔笔尖」游标），外加整个直径的圈
      if (tip && full * dpr > 4){
        if (!this._tipCur || this._tipCur.id !== tip.id){ this._tipCur = { id:tip.id, c:BrushTips.thumb(tip, 128) }; }
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(-(this.brush.angle || 0) * Math.PI / 180); ctx.scale(this.brush.flipX ? -1 : 1, (this.brush.flipY ? -1 : 1) * Math.max(this.brush.roundness, 0.01));
        ctx.globalAlpha = 0.45; ctx.drawImage(this._tipCur.c, -full * dpr, -full * dpr, 2 * full * dpr, 2 * full * dpr); ctx.restore();
      }
      const r = tip ? full : Math.max(full * (0.5 + 0.5 * c01(ToolState.hardness)), 1);
      ring(cx, cy, r);
      if (r > 6) cross(cx, cy, 3);
      if (this._shift && !this._drag && this._lastEndValid()){
        const a = this._lastEnd.pt;
        for (const [w, c] of [[2.5, 'rgba(0,0,0,' + (120 / 255) + ')'], [1, 'rgba(255,255,255,' + (230 / 255) + ')']]){
          ctx.lineWidth = w * dpr; ctx.strokeStyle = c; ctx.beginPath();
          ctx.moveTo(a[0] * s, a[1] * s); ctx.lineTo(cx, cy); ctx.stroke();
        }
      }
    }
    ctx.restore();
  }
});

/* brush_cmds.rs:144-180 resolve_brush ＋ 256-265 with_blend_mode：工具现值 ← brush 补丁 ← 纯量参数；颜色＝前景色 */
function resolveBrush(p){
  let b = T.current(), ignored = [];
  if (isObj(p.brush)){
    try { const r = mergeBrush(b, p.brush); b = r.b; ignored = r.ignored; }
    catch (err){ return { error: err.message }; }
  }
  if (isNum(p.size))      b.size = Math.max(p.size, 0.5);
  if (isNum(p.hardness))  b.hardness = c01(p.hardness);
  if (isNum(p.opacity))   b.opacity = c01(p.opacity);
  if (isNum(p.flow))      b.flow = c01(p.flow);
  if (isNum(p.spacing))   b.spacing = clamp(p.spacing, 0.01, 10);
  if (isNum(p.smoothing)) b.smoothing.amount = c01(p.smoothing);
  const fg = parseColor(window.UI ? UI.fill() : '#000000', [0, 0, 0, 1]);
  b.color = parseColor(p.color, fg);
  b.erase = p.erase === true;
  b._seed = seedOf(p);
  for (const [k, id] of [['tip', b.tip], ['dualBrush.tip', b.dualBrush && b.dualBrush.tip]])   // 笔尖被删了／这台机器没有：说清楚，不偷偷画圆的
    if (id && !BrushTips.get(id)) return { error: `unknown brush tip \`${id}\` in \`${k}\` (see brush.tips.list; pick another with brush.tips.select)` };
  if (b.erase) b.mode = 'normal';                     // 橡皮擦没有混合模式
  else { const m = modeOf(p.mode); if (m) b.mode = m; }
  return { b, ignored };
}

/* JSON 版笔刷（brush.get／brush.set 的回传） */
function brushJson(b){ const o = clone(b); o.seed = String(b.seed); delete o._seed; return o; }

/* ═══════════ 命令（agent 与人走同一条路） ═══════════ */

/* brush_cmds.rs:267-273 paint_stroke ＋ 215-230 stroke_with ＋ render.rs:661-677 render_stroke */
CMD.reg('brush.stroke', {i18n:'', undoable:true,
  params:'{points:[[x,y,pressure?,tiltX?,tiltY?,rotation?,timeMs?,wheel?]…] 或 [{x,y,pressure?,…}] 文件坐标（滑鼠 pressure=1）, '
       + 'brush?:{…BrushSettings 补丁，同 brush.set}, size? px, hardness? 0..1, opacity? 0..1 整笔上限, flow? 0..1 每个笔印, '
       + 'spacing? 0.01..10（直径倍数，预设 0.1）, smoothing? 0..1, color? "#rrggbb"|[r,g,b,a]（预设＝前景色）, '
       + 'mode? normal|dissolve|multiply|screen|overlay|…（27 种）, erase? bool=false, zoom?=1（拉绳平滑用）, seed? 数字或数字字串, layerId?} '
       + '笔刷一笔（有选区只画选区内）；回传 {ok, dabs 笔印数, damage:[x,y,w,h] 文件坐标, seed}'},
  p => {
    const L = p.layerId ? Doc.byId(p.layerId) : Doc.active();
    if (!L) return {ok:false, error:'no active layer'};
    if (L.kind !== 'raster') return {ok:false, error:`active layer is a ${L.kind} layer, not a pixel layer`};
    const r = parsePoints(p.points);
    if (r.error) return {ok:false, error:r.error};
    const rb = resolveBrush(p);
    if (rb.error) return {ok:false, error:rb.error};
    const b = rb.b, W = L.data.canvas.width, H = L.data.canvas.height, ctx = L.data.ctx;
    const ren = new StrokeRenderer(b, W, H, isNum(p.zoom) ? p.zoom : 1, L.x, L.y);
    ren.lockAlpha = !!(window.Locks && Locks.alpha(L));        // 锁透明像素（brush_cmds.rs target_surface 的 lock）；擦除的改刷背景色由 CMD.run 的 Locks.alphaAfter 收尾
    ren.push(r.pts.map(q => Object.assign({}, q, { x: q.x - L.x, y: q.y - L.y })));   // 文件坐标 → 图层坐标
    ren.finish();
    if (ren.bounds) ren.composite(ctx, ctx.getImageData(0, 0, W, H), ren.bounds, ren.main, selFor(L));
    const d = ren.bounds;
    const out = { ok:true, dabs: ren.count, seed: String(b._seed),
                  damage: d ? [d[0] + L.x, d[1] + L.y, d[2] - d[0], d[3] - d[1]] : [0, 0, 0, 0] };
    if (rb.ignored.length) out.ignored = rb.ignored;
    return out;
  });

/* brush_cmds.rs:564-597 set_brush（tools.setBrush）：深合并进工具笔刷；工具状态，不进历史（brush_resize.rs:7-9） */
CMD.reg('brush.set', {i18n:'',
  params:'{reset? bool（回出厂预设）, brush?:{…}, 或直接给 BrushSettings 栏位（camelCase、深合并）：size 1..5000, hardness 0..1, '
       + 'spacing, spacingEnabled, opacity, flow, pressureSize, pressureOpacity, background [r,g,b,a]|"#rrggbb", mode, angle, roundness, '
       + 'flipX, flipY, aliased, shapeDynamics{enabled,size{jitter,control,fadeSteps,minimum},tiltScale,angle{…},roundness{…},flipXJitter,flipYJitter,brushProjection}, '
       + 'scattering{enabled,scatter{…},bothAxes,count,countJitter{…}}, colorDynamics{enabled,perTip,fgBg{…},hueJitter,saturationJitter,brightnessJitter,purity}, '
       + 'transfer{enabled,opacity{…},flow{…}}, pose{enabled,tiltX,tiltY,rotation,pressure,overrideTilt,overrideRotation,overridePressure}, '
       + 'noise, wetEdges, buildUp, buildUpRate, smoothing{amount,pulledString,catchUp,catchUpOnEnd,adjustForZoom}, seed, '
       + 'tip:取样笔尖 id|名字（""＝圆笔尖；见 brush.tips.list）, '
       + 'texture{enabled, pattern:图案 id|名字（ps.pattern.list）, invert, scale 0.01..10（1＝100%）, brightness -150..150, contrast -50..100, eachTip, mode:' + TEX_MODES.join('|') + ', depth 0..1}, '
       + 'dualBrush{enabled, tip:笔尖 id|名字|"", mode:' + DUAL_MODES.join('|') + ', size px, hardness 0..1, spacing 0.01..10, scatter 0..10, bothAxes, count 1..16, flip}} '
       + 'control ∈ off|fade|penPressure|penTilt|stylusWheel|rotation|initialDirection|direction。回传整支笔刷。传 {} 只读'},
  p => {
    let b = T.current();
    if (p.reset === true){ b = defaultBrush(); }
    const patch = Object.assign({}, p); ['preset', 'reset', 'coalesce'].forEach(k => delete patch[k]);
    let ignored = [];
    try {
      if (isObj(patch.brush)){ const r = mergeBrush(b, patch.brush); b = r.b; ignored = ignored.concat(r.ignored); }
      delete patch.brush;
      const r = mergeBrush(b, patch); b = r.b; ignored = ignored.concat(r.ignored);
    } catch (err){ return {ok:false, error: err.message}; }
    ToolState.size = clamp(b.size, SIZE_MIN, SIZE_MAX);
    ToolState.hardness = c01(b.hardness);
    delete b.size; delete b.hardness; delete b._seed;
    b.color = T.brush.color;                            // 颜色跟前景色走，不存在笔刷里
    T.brush = b;
    [b.tip, b.dualBrush && b.dualBrush.tip].forEach(id => { if (id) BrushTips.doc.add(id); });   // 选过的取样笔尖跟着这份档存
    T._syncBar();
    if (window.UI && UI.canvas) UI.draw();
    const out = brushJson(T.current()); out.ok = true;
    if (ignored.length) out.ignored = ignored;
    return out;
  });

CMD.reg('brush.get', {i18n:'', params:'{} 读整支笔刷现值（含共用的 size／hardness）'}, () => {
  const out = brushJson(T.current()); out.color = hexOf(parseColor(window.UI ? UI.fill() : '#000000', [0, 0, 0, 1])); out.ok = true;
  return out;
});

/* ═══════════ 取样笔尖命令（画笔面板、定义画笔预设、读入 .abr 都走这几条；agent 同一条路） ═══════════ */
const tipInfo = t => ({ id:t.id, name:t.name, width:t.width, height:t.height, size:t.size, spacing:t.spacing, source:t.source, inDocument:BrushTips.doc.has(t.id) });
CMD.reg('brush.tips.list', {i18n:'', params:'{} 取样笔尖清单（内建、本机预设库、这份档带的）→ {ok, current:目前笔刷的笔尖 id|"", tips:[{id,name,width,height,size,spacing,source:"builtin|local|doc",inDocument}]}'},
  () => ({ ok:true, current:T.brush.tip || '', tips:BrushTips.list().map(tipInfo) }));
CMD.reg('brush.tips.select', {i18n:'', params:'{tip:id|名字（""＝回圆笔尖）, size?:px（缺省＝笔尖原大小）, spacing?:0.01..10（缺省＝笔尖自带的）} 笔刷换成这支笔尖（PS 画笔笔尖形状点一支）→ 整支笔刷'}, p => {
  if (typeof p.tip !== 'string') return {ok:false, error:'missing `tip` (an id or name from brush.tips.list, or "" for the round tip)'};
  if (!p.tip) return CMD.run('brush.set', { tip:'' });
  const t = BrushTips.get(p.tip); if (!t) return {ok:false, error:`unknown brush tip \`${p.tip}\` (see brush.tips.list)`};
  return CMD.run('brush.set', { tip:t.id, size: clamp(Math.round(isNum(p.size) ? p.size : t.size), SIZE_MIN, SIZE_MAX), spacing: isNum(p.spacing) ? clamp(p.spacing, 0.01, 10) : t.spacing });
});
/* 新增一支（定义画笔预设：menus/impl/ps-edit.js 算好灰阶后叫这条）：alpha＝base64 的 width×height 位元组（0..255，255＝满） */
CMD.reg('brush.tips.add', {i18n:'', params:'{name, width, height, alpha:base64（width×height 个 0..255，255＝满颜料）, size?, spacing?=0.25, select?=true, local?=true（存进本机预设库）} 新增取样笔尖（也跟这份档存）→ {ok, tip, saved, selected}'}, p => {
  const w = p.width | 0, h = p.height | 0;
  if (!(w > 0 && h > 0)) return {ok:false, error:'`width` and `height` must be positive'};
  let a = p.alpha instanceof Uint8Array ? p.alpha : null;
  if (!a && typeof p.alpha === 'string'){ try { a = b64dec(p.alpha); } catch (e){ return {ok:false, error:'`alpha` is not valid base64'}; } }
  if (!a || a.length !== w * h) return {ok:false, error:`\`alpha\` must be ${w}×${h} = ${w * h} bytes`};
  if (!a.some(v => v > 0)) return {ok:false, error:'the brush tip is empty (all alpha 0)'};
  const r = BrushTips.add({ name: typeof p.name === 'string' && p.name.trim() ? p.name.trim() : 'Sampled Brush', width:w, height:h, a, size:p.size, spacing:p.spacing }, { local: p.local !== false });
  let selected = false;
  if (p.select !== false){ const s = CMD.run('brush.tips.select', { tip:r.tip.id }); selected = !!(s && s.ok); }
  const out = { ok:true, tip:tipInfo(r.tip), saved:r.saved, selected };
  if (r.scaled) out.note = `scaled down to ${r.tip.width}×${r.tip.height} (brush tips are limited to ${TIP_MAX} px)`;
  if (r.saved === false) out.warning = 'the browser storage is full: the tip was not added to the local preset library (it is still kept in this document)';
  return out;
});
CMD.reg('brush.tips.importAbr', {i18n:'', params:'{data:base64（.abr 档的内容）, name?:档名（没名字的笔尖叫「档名 N」）, select?:bool=true（选第一支）} 读入 Photoshop 画笔档 .abr（v6／v10 的取样笔尖；v1／v2 旧档、只有计算笔尖的档回清楚的错误）→ {ok, version, imported:[{id,name,width,height}], skipped:[…]}'}, p => {
  let u8 = p.bytes instanceof Uint8Array ? p.bytes : (p.bytes instanceof ArrayBuffer ? new Uint8Array(p.bytes) : null);
  if (!u8){ if (typeof p.data !== 'string' || !p.data) return {ok:false, error:'missing `data` (the .abr file as base64)'};
    try { u8 = b64dec(p.data.replace(/^data:[^,]*,/, '')); } catch (e){ return {ok:false, error:'`data` is not valid base64'}; } }
  const base = String(p.name || 'ABR').replace(/\.abr$/i, '');
  let r; try { r = parseAbr(u8, base); } catch (e){ return {ok:false, error:e.message}; }
  if (!r.tips.length) return {ok:false, error:'no usable sampled brush tips in this .abr', version:r.version, skipped:r.skipped};
  const imported = []; let full = false, scaled = 0;
  for (const t of r.tips){ const x = BrushTips.add(t); if (x.saved === false) full = true; if (x.scaled) scaled++; imported.push(tipInfo(x.tip)); }
  if (p.select !== false) CMD.run('brush.tips.select', { tip:imported[0].id });
  const out = { ok:true, version:r.version, imported, skipped:r.skipped };
  if (scaled) out.note = `${scaled} tip(s) scaled down to ${TIP_MAX} px`;
  if (full) out.warning = 'the browser storage is full: some tips were not added to the local preset library (they are still kept in this document)';
  return out;
});
CMD.reg('brush.tips.edit', {i18n:'', params:'{action:"rename|delete", tip:id|名字, name?} 改名／删除自己的取样笔尖（内建的不能改；删掉的若正在用＝笔刷回圆笔尖）→ {ok}'}, p => {
  try {
    if (p.action === 'rename'){ const n = String(p.name || '').trim(); if (!n) return {ok:false, error:'missing `name`'}; const t = BrushTips.rename(p.tip, n); return t ? {ok:true, tip:tipInfo(t)} : {ok:false, error:`unknown brush tip \`${p.tip}\``}; }
    if (p.action === 'delete'){
      const t = BrushTips.remove(p.tip); if (!t) return {ok:false, error:`unknown brush tip \`${p.tip}\``};
      if (T.brush.tip === t.id) T.brush.tip = '';
      if (T.brush.dualBrush && T.brush.dualBrush.tip === t.id) T.brush.dualBrush.tip = '';
      T._syncBar(); return {ok:true, deleted:t.id};
    }
  } catch (e){ return {ok:false, error:e.message}; }
  return {ok:false, error:'`action` must be rename or delete'};
});

/* 工程档：用过／定义过／读入过的取样笔尖存进 project.json 的 brushTips（别台机器开这份档，笔刷预设照样画得出来） */
if (window.Project && !Project.__brushTips){
  Project.__brushTips = true;
  const ser0 = Project.serialize, load0 = Project.load;
  Project.serialize = function(){ const o = ser0.apply(this, arguments); if (o && !Array.isArray(o) && BrushTips.doc.size){ const t = BrushTips.serialize(); if (t.length) o.brushTips = t; } return o; };
  Project.load = function(json){ BrushTips.loadDoc(json && json.brushTips); return load0.apply(this, arguments); };
}
window.BrushTips = BrushTips;

/* 给自测与 agent 用的纯函数（不改文件） */
T._engine = { dabCoverage, parsePoints, StrokeRenderer, mergeBrush, defaultBrush, blendChannel, rand01, seedFromBytes,
              DabGenerator, mkPt, seedOf, scalar, ST,   // 混合器画笔借笔尖形状／形状动态（tools/mixer.js tipDabs）
              parseAbr, packBitsEncode, packBitsDecode, stampFor, StampCache, maskCombine, BrushTips, TEX_MODES, DUAL_MODES };

})();

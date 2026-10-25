/* 铅笔（PS 的 B 组第二颗）：在像素层上画「无反锯齿」的硬边笔迹——每个像素不是全画就是不画，笔印落在像素格上。
   一笔＝一条 pencil.stroke 命令＝一步历史（＝ArtCraft 的 paint.pencil）。
   🔴 滑鼠给的是文件坐标，图层可能被移动过 ⇒ 一律先换算成图层坐标再画（铁律④）。

   对照源（逐段翻译，各段注释标 档:行；路径都在 photocraft/crates/ 下）：
     engine/src/brush_cmds.rs        resolve_brush 144-180、stroke_target 198-203、erase_locked 205-212、stroke_with 215-230、
                                     apply_auto_erase 232-240、pencil_brush 242-254、with_blend_mode 256-265、
                                     LiveStroke::begin_with 299-324（paint.pencil 也即时预览）、pencil 355-360、命令说明 676-683
     engine/src/brush_cmds/tests.rs  pencil_is_aliased_and_auto_erases 84-101、live_pencil_matches_the_committed_pencil 316-347
     paint/src/render.rs             grid_center 28-37、grid_square 39-46、rasterize 的 aliased 分支 159/163/207
     paint/src/brush_tests.rs        pencil_is_aliased 116-129、pencil_dabs_sit_on_the_pixel_grid 132-167
     ui-egui/src/canvas.rs           stroke_params 179-187（铅笔多带 autoErase）、strokes_live/stroke_command 189-197、
                                     pencil_cursor_rect 199-208、begin/feed_live_stroke 223-261、Down 2042-2105、Up 2110-2140、
                                     finish_gesture 2144-2182、铅笔方块游标 1626-1638
     ui-egui/src/pencil_tests.rs     即时预览＋一步历史、自动抹除、Shift 点连线、Ctrl+Alt 改大小、方块游标贴像素格
     ui-egui/src/panels.rs:482-507   选项栏：大小、模式、不透明度、平滑、自动抹除（没有硬度与流量：铅笔永远是硬的）
     ui-egui/src/paint_mouse.rs      13-40 平滑是「每颗工具各一份」（第一次 10%）；51-128 右键开笔刷挑选器、不画
     ui-egui/src/stroke_constraint.rs、brush_resize.rs、shortcuts.rs:307-318   Shift 拉直线／接上一笔、Ctrl+Alt 拖改大小、[ ] 改大小
   笔刷引擎（dab、间距、平滑、覆盖率累积、合成）从 tools/brush.js 原样复制一份过来（它照 paint/src/*.rs 翻好），算法一致、不 import。
   笔刷设定跟笔刷工具共用一支（ArtCraft 的 session brush：s.tools.brush）——大小／硬度在 ToolState、其余在 Tools.get('brush')；
   铅笔改模式／不透明度／大小也走 brush.set，跟 ArtCraft 一样两颗工具看到同一支笔。 */
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
    seed:0
  };
}
const SCHEMA = defaultBrush();

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
      mergeInto(base[k], v, sv, p, ignored);
    } else if (Array.isArray(sv)){                       // 颜色
      const c = parseColor(v, null);
      if (!c) throw new Error(`invalid brush: \`${p}\` must be [r,g,b,a] or "#rrggbb"`);
      base[k] = c;
    } else if (k === 'seed'){
      base[k] = (typeof v === 'string' || isNum(v)) ? String(v) : 0;
    } else if (k === 'mode'){
      const m = modeOf(v); if (!m) throw new Error(`invalid brush: unknown blend mode \`${v}\``); base[k] = m;
    } else if (k === 'control'){
      if (!CONTROLS.includes(v)) throw new Error(`invalid brush: \`${p}\` must be one of ${CONTROLS.join('|')}`); base[k] = v;
    } else if (typeof sv === 'number'){
      if (!isNum(v)) throw new Error(`invalid brush: \`${p}\` must be a number`); base[k] = v;
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
  }
  /* render.rs:153-237 rasterize（圆笔尖）＋ 297-361 accumulate：c ← c + v·(上限 − c)；湿边用 max */
  _accum(d, buf){
    const r0 = inter(dabRect(d), buf.x0, buf.y0, buf.x0 + buf.w, buf.y0 + buf.h);
    if (!r0) return null;
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
  push(pts){ const out = []; this.gen.push(pts, out); this._raster(out); }      // render.rs:463-466
  finish(){ const out = []; this.gen.finish(out); this._raster(out); }          // render.rs:469-472
  /* render.rs:474-519 tail_preview：现在收笔会多出的那截（平滑的追赶尾巴、或单独第一点），画进主缓冲的一块复本 */
  tailPreview(){
    const g = this.gen.clone(), out = [];
    g.finish(out);
    if (!out.length) return null;
    let rect = null;
    for (const d of out){ const r = inter(dabRect(d), 0, 0, this.W, this.H); if (r) rect = uni(rect, r); }
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
    for (let y = y0; y < y1; y++){
      const inY = !sel || (y + 0.5 >= sel[1] && y + 0.5 < sel[3]);
      for (let x = x0; x < x1; x++){
        const pi = (y * W + x) * 4, oi = ((y - y0) * w + (x - x0)) * 4;
        od[oi] = pd[pi]; od[oi + 1] = pd[pi + 1]; od[oi + 2] = pd[pi + 2]; od[oi + 3] = pd[pi + 3];
        const bi = (y - buf.y0) * buf.w + (x - buf.x0), c = cov[bi];
        if (c <= 0) continue;
        const s = (inY && (!sel || (x + 0.5 >= sel[0] && x + 0.5 < sel[2]))) ? 1 : 0;
        let k = Math.min(c * op * s, 1);
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

/* ═══════════ 以上从 tools/brush.js 复制（brush.js 28-679 行）；以下是铅笔自己的 ═══════════ */

const CMD_ID = 'pencil.stroke';
const PENCIL_SIZE_MAX = 5000;                         // panels.rs:489 铅笔选项栏大小 1..5000

/* render.rs:39-46 grid_square：大小 diameter 的铅笔笔印在 (x,y) 会碰到的整像素方块 [x0,y0,x1,y1]（＝铅笔游标） */
function gridSquare(x, y, diameter){
  const n = isFinite(diameter) ? clamp(Math.round(diameter), 1, 100000) : 1;
  const [cx, cy] = gridCenter(x, y, n);
  const h = n / 2;
  return [cx - h, cy - h, cx + h, cy + h];
}

/* 界面这一侧的状态（tool_options.pencil_auto_erase、每颗工具一份的平滑） */
const U = {
  autoErase: false,                                   // state.rs:394,464 预设关
  smoothing: 0.1,                                     // paint_mouse.rs:35 Photoshop 第一次 10%
  fallback: { opacity: 1, mode: 'normal' }            // 笔刷工具没载入时才用
};

/* 背景色＝PS 版面第二个色块（engine.js Locks.alphaAfter 同一个来源） */
function bgColor(){
  const el = typeof document !== 'undefined' && document.getElementById('strokeColor');
  return parseColor((el && el.value) || '#ffffff', [1, 1, 1, 1]);
}
const fgColor = () => parseColor(window.UI ? UI.fill() : '#000000', [0, 0, 0, 1]);

/* session brush：笔刷工具那一支（含共用的 size／hardness）；平滑换成铅笔自己那一份（paint_mouse.rs sync_tool_smoothing） */
function sessionBrush(){
  const B = Tools.get('brush');
  let b;
  if (B && typeof B.current === 'function') b = B.current();
  else { b = defaultBrush(); b.size = ToolState.size; b.hardness = ToolState.hardness; b.opacity = U.fallback.opacity; b.mode = U.fallback.mode; }
  b.smoothing = Object.assign({}, b.smoothing, { amount: U.smoothing });
  return b;
}

/* brush_cmds.rs:146-180 resolve_brush ＋ 258-265 with_blend_mode ＋ 244-254 pencil_brush：
   session brush ← brush 补丁 ← 纯量参数；颜色＝前景色；然后强制 aliased、没给 hardness／flow 就是 1 */
function pencilBrush(p){
  let b = sessionBrush(), ignored = [];
  if (isObj(p.brush)){
    try { const r = mergeBrush(b, p.brush); b = r.b; ignored = r.ignored; }
    catch (err){ return { error: `${CMD_ID}: ${err.message}` }; }
  }
  if (isNum(p.size))      b.size = Math.max(p.size, 0.5);
  if (isNum(p.hardness))  b.hardness = c01(p.hardness);
  if (isNum(p.opacity))   b.opacity = c01(p.opacity);
  if (isNum(p.flow))      b.flow = c01(p.flow);
  if (isNum(p.spacing))   b.spacing = clamp(p.spacing, 0.01, 10);
  if (isNum(p.smoothing)) b.smoothing.amount = c01(p.smoothing);
  b.color = parseColor(p.color, fgColor());
  b.background = bgColor();
  b.erase = p.erase === true;
  b._seed = seedOf(p);
  if (b.erase) b.mode = 'normal';                     // 橡皮擦没有混合模式
  else { const m = modeOf(p.mode); if (m) b.mode = m; }
  b.aliased = true;                                   // 每个像素全画或不画、笔印落在像素格上
  if (!isNum(p.hardness)) b.hardness = 1;
  if (!isNum(p.flow)) b.flow = 1;
  return { b, ignored };
}

/* brush_cmds.rs:207-212 erase_locked：锁透明像素的层擦不掉 alpha ⇒ 改刷背景色 */
function eraseLocked(b, lock, bg){ if (b.erase && lock){ b.erase = false; b.color = bg.slice(); } }

/* brush_cmds.rs:234-240 apply_auto_erase：起笔那一点的像素＝前景色（不透明、每色差 < 1.5/255）⇒ 整笔改画背景色。
   p0 是文件坐标，读的是图层自己的像素（换算成图层坐标）。回 true＝这笔改画背景色了 */
function applyAutoErase(b, L, p0, fg, bg){
  if (!p0) return false;
  const c = L.data.canvas, x = Math.floor(p0.x - L.x), y = Math.floor(p0.y - L.y);
  if (!(x >= 0 && y >= 0 && x < c.width && y < c.height)) return false;   // 层外＝透明
  const d = L.data.ctx.getImageData(x, y, 1, 1).data;
  if (d[3] > 0 && [0, 1, 2].every(i => Math.abs(d[i] / 255 - fg[i]) < 1.5 / 255)){ b.color = bg.slice(); return true; }
  return false;
}

/* 命令与即时预览共用：解析笔刷 → 锁透明擦除改背景色 → 自动抹除（brush_cmds.rs:215-227、299-318） */
function prepare(L, p, pts){
  const rb = pencilBrush(p);
  if (rb.error) return rb;
  const b = rb.b, fg = b.color.slice(), bg = b.background.slice();
  const lock = !!(window.Locks && Locks.alpha(L));
  eraseLocked(b, lock, bg);
  const autoErased = p.autoErase === true ? applyAutoErase(b, L, pts[0], fg, bg) : false;
  return { b, lock, autoErased, ignored: rb.ignored };
}

/* brush_cmds.rs:355-360 pencil ＋ 215-230 stroke_with */
function pencilStroke(p){
  const L = p.layerId ? Doc.byId(p.layerId) : Doc.active();
  if (!L) return {ok:false, error:'no active layer'};
  if (L.kind !== 'raster') return {ok:false, error:`active layer is a ${L.kind} layer, not a pixel layer`};
  // 锁像素／全锁：engine.js 的 Locks 把关表还没有 pencil.stroke，这里自己挡（同 commands.rs:66 paint_surface）
  if (window.Locks){ const k = Locks.blocks(L, 'pixels'); if (k){ Locks.notify(Locks.message(L, k)); return Locks.fail(L, k, CMD_ID); } }
  const r = parsePoints(p.points);
  if (r.error) return {ok:false, error:`${CMD_ID}: ${r.error}`};
  const pr = prepare(L, p, r.pts);
  if (pr.error) return {ok:false, error:pr.error};
  const b = pr.b, W = L.data.canvas.width, H = L.data.canvas.height, ctx = L.data.ctx;
  const ren = new StrokeRenderer(b, W, H, isNum(p.zoom) ? p.zoom : 1, L.x, L.y);
  ren.lockAlpha = pr.lock;
  ren.push(r.pts.map(q => Object.assign({}, q, { x: q.x - L.x, y: q.y - L.y })));   // 文件坐标 → 图层坐标
  ren.finish();
  if (ren.bounds) ren.composite(ctx, ctx.getImageData(0, 0, W, H), ren.bounds, ren.main, selFor(L));
  const d = ren.bounds;
  const out = { ok:true, dabs: ren.count, seed: String(b._seed), autoErased: pr.autoErased, color: hexOf(b.color), erase: b.erase,
                damage: d ? [d[0] + L.x, d[1] + L.y, d[2] - d[0], d[3] - d[1]] : [0, 0, 0, 0] };
  if (pr.ignored.length) out.ignored = pr.ignored;
  return out;
}

/* 选项现值（给 agent 与选项栏） */
function optionsJson(){
  const b = sessionBrush();
  return { ok:true, autoErase: U.autoErase, smoothing: U.smoothing, size: ToolState.size, mode: b.mode, opacity: b.opacity };
}

/* ═══════════ 工具 ═══════════ */
const MODE_NAMES = {
  'zh-Hant': ['正常','溶解','變暗','色彩增值','加深顏色','線性加深','顏色變暗','變亮','濾色','加亮顏色','線性加亮（增加）','顏色變亮','覆蓋','柔光','實光','強烈光源','線性光源','小光源','實色疊印混合','差異化','排除','減去','分割','色相','飽和度','顏色','明度'],
  'zh-Hans': ['正常','溶解','变暗','正片叠底','颜色加深','线性加深','深色','变亮','滤色','颜色减淡','线性减淡（添加）','浅色','叠加','柔光','强光','亮光','线性光','点光','实色混合','差值','排除','减去','划分','色相','饱和度','颜色','明度'],
  'en': ['Normal','Dissolve','Darken','Multiply','Color Burn','Linear Burn','Darker Color','Lighten','Screen','Color Dodge','Linear Dodge (Add)','Lighter Color','Overlay','Soft Light','Hard Light','Vivid Light','Linear Light','Pin Light','Hard Mix','Difference','Exclusion','Subtract','Divide','Hue','Saturation','Color','Luminosity']
};
const STR = {
  'zh-Hant':{ 'opt.pencil.size':'大小', 'opt.pencil.mode':'模式', 'opt.pencil.opacity':'不透明', 'opt.pencil.smoothing':'平滑化', 'opt.pencil.autoErase':'自動擦除',
              'ui.pencil.diameter':'直徑：', 'ui.pencil.hardness':'硬度：', 'ui.pencil.size':'尺寸', 'ui.pencil.hardnessLabel':'硬度',
              'ui.pencilHint':'Shift 拖曳＝直線；Shift＋點＝接上一筆；Ctrl+Alt 拖曳＝改大小；[ ]＝縮放筆尖；右鍵＝筆刷挑選器' },
  'zh-Hans':{ 'opt.pencil.size':'大小', 'opt.pencil.mode':'模式', 'opt.pencil.opacity':'不透明度', 'opt.pencil.smoothing':'平滑', 'opt.pencil.autoErase':'自动抹除',
              'ui.pencil.diameter':'直径：', 'ui.pencil.hardness':'硬度：', 'ui.pencil.size':'大小', 'ui.pencil.hardnessLabel':'硬度',
              'ui.pencilHint':'Shift 拖动＝直线；Shift＋点＝接上一笔；Ctrl+Alt 拖动＝改大小；[ ]＝缩放笔尖；右键＝画笔预设选取器' },
  'en':     { 'opt.pencil.size':'Size', 'opt.pencil.mode':'Mode', 'opt.pencil.opacity':'Opacity', 'opt.pencil.smoothing':'Smoothing', 'opt.pencil.autoErase':'Auto Erase',
              'ui.pencil.diameter':'Diameter:', 'ui.pencil.hardness':'Hardness:', 'ui.pencil.size':'Size', 'ui.pencil.hardnessLabel':'Hardness',
              'ui.pencilHint':'Shift-drag: straight line · Shift-click: line from last stroke · Ctrl+Alt-drag: size · [ ]: brush size · right-click: brush picker' }
};
Object.keys(MODE_NAMES).forEach(lg => MODE_NAMES[lg].forEach((n, i) => STR[lg]['ui.pencil.mode.' + MODES[i]] = n));

const T = Tools.reg({
  id:'pencil', icon:'✏', group:'raster', order:11, for:'raster', needs:'raster', opts:[],
  hint:'ui.pencilHint', cursor:'none',                  // canvas.rs:1637 自己画方块游标、藏系统游标
  strings: STR,
  ui: U,

  _drag:null,        // {L, b, ren, pre, sel, pts:[[x,y,p(,tx,ty,rot)]…] 文件坐标, start, axis, tail, hasPose, autoErased}
  _resize:null,      // {anchor, start:[size,hardness], at}
  _lastEnd:null,     // {key, pt}：上一笔终点（Shift＋点从这里拉直线）
  _hover:null, _shift:false, _bound:false, _picker:null, _rdown:null,
  lastParams:null,   // 最近一次滑鼠提交的 pencil.stroke 参数（给自测与 agent 对照）

  _docKey(){ return Doc.serial; },
  _lastEndValid(){ return !!(this._lastEnd && this._lastEnd.key === this._docKey()); },

  /* stroke_constraint.rs:63-83 constrain */
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
    UI.canvas.addEventListener('contextmenu', e => { if (Tools.current() === this) e.preventDefault(); });
    const k = (e, v) => {
      if (e.key === 'Shift'){ this._shift = v; if (Tools.current() === this) UI.draw(); }
      if (v && this._picker && (e.key === 'Escape' || e.key === 'Enter')) this._closePicker();
    };
    document.addEventListener('keydown', e => k(e, true));
    document.addEventListener('keyup',   e => k(e, false));
    document.addEventListener('pointerdown', e => { if (this._picker && !this._picker.contains(e.target)) this._closePicker(); }, true);
  },

  /* 滑鼠提交与即时预览共用的参数（canvas.rs:181-187 stroke_params：铅笔多带 autoErase） */
  _params(points, extra){
    return Object.assign({ points, erase:false, autoErase: U.autoErase, smoothing: U.smoothing, zoom: UI.zoom }, extra || {});
  },

  /* canvas.rs:2042-2105 Down */
  onDown(e, pt, P){
    this._bind();
    this._shift = !!e.shiftKey; this._hover = pt;
    if (e.button !== undefined && e.button !== 0){ this._rdown = [e.clientX, e.clientY]; return; }   // 右键：不画（paint_mouse.rs:1-5）
    if (!this._drag && e.ctrlKey && e.altKey){                           // brush_resize.rs：Ctrl+Alt 按下＝改笔尖，不画
      this._resize = { anchor:[pt[0], pt[1]], start:[ToolState.size, ToolState.hardness], at:pt };
      UI.draw(); return;
    }
    let L = Doc.active();
    if (!L || L.kind !== 'raster'){ P.ensureRaster(); L = Doc.active(); }
    if (!L || L.kind !== 'raster') return;
    // 锁像素／全锁：整个手势不给（_registry.js 的 TOOL_LOCKS 还没列铅笔，这里自己挡）
    if (window.Locks && Locks.deny(L, 'pixels')){ P.down = false; UI.draw(); return; }
    const pr = pressureOf(e), pose = poseOf(e);
    const from = (e.shiftKey && this._lastEndValid()) ? this._lastEnd.pt : null;   // Shift＋点：从上一笔终点连直线、算同一笔
    const pts = [pose ? [pt[0], pt[1], pr, ...pose] : [pt[0], pt[1], pr]];
    if (from) pts.unshift([from[0], from[1], pr]);
    const W = L.data.canvas.width, H = L.data.canvas.height, ctx = L.data.ctx;
    // brush_cmds.rs:301-324 LiveStroke::begin_with("paint.pencil")：同一支笔、同一个种子、同样的自动抹除判断
    const params = this._params(pts, { layerId: L.id });
    const parsed = parsePoints(params.points);
    if (parsed.error) return;
    const prep = prepare(L, params, parsed.pts);
    if (prep.error) return;
    const d = { L, b: prep.b, pts, start: from || [pt[0], pt[1]], axis:null, tail:null, hasPose: !!pose, autoErased: prep.autoErased,
                pre: ctx.getImageData(0, 0, W, H), sel: selFor(L),
                ren: new StrokeRenderer(prep.b, W, H, UI.zoom, L.x, L.y) };
    d.ren.lockAlpha = prep.lock;
    this._drag = d;
    this._feed(d, pts);
    UI.draw();
  },

  /* brush_cmds.rs:335-352 LiveStroke::push：新点进渲染器 → 合成碰到的格子 → 盖掉上一截尾巴 → 画「现在收笔会多出的尾巴」 */
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

  /* canvas.rs:1939-1964 tool_move ＋ feed_live_stroke */
  onMove(e, pt, P){
    this._bind();
    this._hover = pt; this._shift = !!e.shiftKey;
    if (this._resize){ this._resizeTo(pt); return; }
    const d = this._drag;
    if (!d){ UI.draw(); return; }
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

  /* canvas.rs:2110-2140 Up ＋ 2144-2182 finish_gesture：还原预览、走 pencil.stroke 正式落一次（带同一个种子） */
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
    d.L.data.ctx.putImageData(d.pre, 0, 0);
    const points = d.pts.map(q => d.hasPose ? [q[0], q[1], q[2], q[3] || 0, q[4] || 0, q[5] || 0] : [q[0], q[1], q[2]]);
    const params = this._params(points, { seed: String(d.b._seed), layerId: d.L.id });
    this.lastParams = params;
    this.lastResult = CMD.run(CMD_ID, params);
    this._lastEnd = { key: this._docKey(), pt:[end[0], end[1]] };
  },

  /* brush_resize.rs:87-99 update ＋ 47-55 resized（工具状态，不进历史） */
  _resizeTo(pt){
    const r = this._resize; r.at = pt;
    const z = (window.UI && UI.zoom > 0) ? UI.zoom : 1;
    const dx = pt[0] - r.anchor[0], dy = pt[1] - r.anchor[1];
    const size = clamp(Math.round(r.start[0] + 2 * (isFinite(dx) ? dx : 0)), SIZE_MIN, SIZE_MAX);
    let hard = c01(r.start[1] + (isFinite(dy) ? dy : 0) * z / HARDNESS_TRAVEL);
    hard = Math.round(hard * 100) / 100;
    if (size !== ToolState.size || hard !== ToolState.hardness) CMD.run('pencil.setOptions', { size, hardness: hard });
    else UI.draw();
  },

  /* shortcuts.rs:307-318：[ 缩小、] 放大（×1.25 取整，至少 +1，上限 2500） */
  onKey(e){
    if ((e.key !== '[' && e.key !== ']') || e.ctrlKey || e.metaKey || e.altKey) return false;
    const size = ToolState.size;
    const next = e.key === '['
      ? Math.round(Math.max(size / 1.25, 1))
      : Math.max(Math.round(Math.min(size * 1.25, BAR_SIZE_MAX)), size + 1);
    if (next !== size) CMD.run('pencil.setOptions', { size: next });
    return true;
  },

  onDeactivate(){
    if (this._drag){ this._drag.L.data.ctx.putImageData(this._drag.pre, 0, 0); this._drag = null; }   // 画到一半换工具：还原、不提交
    this._resize = null; this._hover = null; this._closePicker();
  },

  /* 右键的笔刷挑选器（paint_mouse.rs:101-128 ＋ brush_picker.rs:89-112：大小＝数值＋对数滑杆、硬度；预设库没抄） */
  _openPicker(e){
    this._bind(); this._closePicker();
    const box = document.createElement('div');
    box.id = 'pencilPicker';
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
    num.oninput = () => { if (num.value !== '' && isFinite(+num.value)) CMD.run('pencil.setOptions', { size: clamp(Math.round(+num.value), SIZE_MIN, SIZE_MAX) }); };
    log.oninput = () => CMD.run('pencil.setOptions', { size: clamp(Math.round(Math.exp(+log.value)), SIZE_MIN, SIZE_MAX) });
    hard.oninput = () => CMD.run('pencil.setOptions', { hardness: c01(+hard.value / 100) });
    row(Lang.t('ui.pencil.size'), num, px);
    box.appendChild(log);
    row(Lang.t('ui.pencil.hardnessLabel'), hard, hv);
    document.body.appendChild(box);
    const bw = box.offsetWidth, bh = box.offsetHeight;
    box.style.left = clamp(e.clientX, 0, Math.max(0, innerWidth - bw)) + 'px';
    box.style.top  = clamp(e.clientY, 0, Math.max(0, innerHeight - bh)) + 'px';
    this._picker = box;
  },
  _closePicker(){ if (this._picker){ this._picker.remove(); this._picker = null; } },

  /* 选项栏（panels.rs:482-507）：大小、模式、不透明度、平滑、自动抹除；每一格都只是叫 pencil.setOptions */
  buildOptions(box, add, mk){
    const o = optionsJson();
    const num = (key, val, min, max, toOpt) => {
      const n = mk('number', { min, max, value: val });
      n.dataset.pencil = key; n.style.width = '64px';
      n.onchange = n.oninput = () => { if (n.value !== '' && isFinite(+n.value)) CMD.run('pencil.setOptions', toOpt(+n.value)); };
      return n;
    };
    add('pencil.size', num('size', o.size, 1, PENCIL_SIZE_MAX, v => ({ size: clamp(v, 1, PENCIL_SIZE_MAX) })));
    const sel = document.createElement('select'); sel.dataset.pencil = 'mode';
    MODES.forEach(m => { const op = document.createElement('option'); op.value = m; op.textContent = Lang.t('ui.pencil.mode.' + m); sel.appendChild(op); });
    sel.value = o.mode;
    sel.onchange = () => CMD.run('pencil.setOptions', { mode: sel.value });
    add('pencil.mode', sel);
    add('pencil.opacity',   num('opacity',   Math.round(o.opacity * 100), 0, 100, v => ({ opacity: c01(v / 100) })));
    add('pencil.smoothing', num('smoothing', Math.round(o.smoothing * 100), 0, 100, v => ({ smoothing: c01(v / 100) })));
    const cb = mk('checkbox', { checked: o.autoErase }); cb.dataset.pencil = 'autoErase';
    cb.onchange = () => CMD.run('pencil.setOptions', { autoErase: cb.checked });
    add('pencil.autoErase', cb);
  },
  /* 选项改了 ⇒ 对齐选项栏与挑选器，不重建（免得打字时失焦） */
  _syncBar(){
    const o = optionsJson();
    const v = { size: o.size, opacity: Math.round(o.opacity * 100), smoothing: Math.round(o.smoothing * 100), mode: o.mode };
    if (this._picker) this._picker.querySelectorAll('[data-picker]').forEach(el => {
      if (el === document.activeElement) return;
      const k = el.dataset.picker;
      if (k === 'size') el.value = ToolState.size;
      else if (k === 'sizeLog') el.value = Math.log(Math.max(ToolState.size, 1));
      else if (k === 'hardness'){ el.value = Math.round(ToolState.hardness * 100); el.nextSibling.textContent = el.value + '%'; }
    });
    if (Tools.current() !== this) return;
    document.querySelectorAll('#optBody [data-pencil]').forEach(el => {
      if (el === document.activeElement) return;
      const k = el.dataset.pencil;
      if (el.type === 'checkbox') el.checked = !!o[k];
      else if (k in v) el.value = v[k];
    });
  },

  /* 叠画：canvas.rs:1626-1638 铅笔方块游标（外黑 160／内白 230、各 1 个实体像素，边贴实体像素；太小就加中心十字）、
     brush_resize.rs:101-153 改大小时圈固定在起点＋红色笔尖预览＋读数、stroke_constraint.rs:95-123 Shift 橡皮筋 */
  drawOverlay(ctx, s){
    const z = (window.UI && UI.zoom > 0) ? UI.zoom : 1;
    const dpr = s / z;
    const cross = (cx, cy, len) => {
      for (const [w, c] of [[2.5, 'rgba(0,0,0,' + (140 / 255) + ')'], [1, 'rgba(255,255,255,' + (220 / 255) + ')']]){
        ctx.lineWidth = w * dpr; ctx.strokeStyle = c; ctx.beginPath();
        ctx.moveTo(cx - len * dpr, cy); ctx.lineTo(cx + len * dpr, cy);
        ctx.moveTo(cx, cy - len * dpr); ctx.lineTo(cx, cy + len * dpr); ctx.stroke();
      }
    };
    ctx.save();
    if (this._resize){
      const full = Math.max(ToolState.size / 2 * z, 1);
      const r = this._resize, cx = r.anchor[0] * s, cy = r.anchor[1] * s, R = full * dpr;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R), red = 'rgba(255,0,0,' + (110 / 255) + ')';
      g.addColorStop(0, red); g.addColorStop(c01(ToolState.hardness), red); g.addColorStop(1, 'rgba(255,0,0,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = dpr;
      ctx.strokeStyle = 'rgba(0,0,0,' + (140 / 255) + ')'; ctx.beginPath(); ctx.arc(cx, cy, R + 0.5 * dpr, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,' + (220 / 255) + ')'; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
      const at = r.at || r.anchor, tx = at[0] * s + 16 * dpr, ty = at[1] * s + 16 * dpr;
      const lines = [Lang.t('ui.pencil.diameter') + ' ' + Math.round(ToolState.size) + ' px',
                     Lang.t('ui.pencil.hardness') + ' ' + Math.round(ToolState.hardness * 100) + '%'];
      ctx.font = (12 * dpr) + 'px sans-serif';
      const wBox = Math.max(...lines.map(t => ctx.measureText(t).width)) + 12 * dpr;
      ctx.fillStyle = 'rgba(30,32,36,0.9)'; ctx.fillRect(tx, ty, wBox, 40 * dpr);
      ctx.fillStyle = '#fff'; ctx.textBaseline = 'top';
      lines.forEach((t, i) => ctx.fillText(t, tx + 6 * dpr, ty + (5 + i * 16) * dpr));
      ctx.restore(); return;
    }
    const h = this._hover;
    if (h){
      const q = this.cursorRect(h, s);
      if (q){
        const [X0, Y0, X1, Y1] = q;
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(0,0,0,' + (160 / 255) + ')';                         // StrokeKind::Outside
        ctx.strokeRect(X0 - 0.5, Y0 - 0.5, X1 - X0 + 1, Y1 - Y0 + 1);
        ctx.strokeStyle = 'rgba(255,255,255,' + (230 / 255) + ')';                   // StrokeKind::Inside
        if (X1 - X0 > 1 && Y1 - Y0 > 1) ctx.strokeRect(X0 + 0.5, Y0 + 0.5, X1 - X0 - 1, Y1 - Y0 - 1);
        if ((X1 - X0) / dpr < 6) cross(h[0] * s, h[1] * s, 4);                      // 方块太小看不出在哪：加热点十字
      }
      if (this._shift && !this._drag && this._lastEndValid()){
        const a = this._lastEnd.pt;
        for (const [w, c] of [[2.5, 'rgba(0,0,0,' + (120 / 255) + ')'], [1, 'rgba(255,255,255,' + (230 / 255) + ')']]){
          ctx.lineWidth = w * dpr; ctx.strokeStyle = c; ctx.beginPath();
          ctx.moveTo(a[0] * s, a[1] * s); ctx.lineTo(h[0] * s, h[1] * s); ctx.stroke();
        }
      }
    }
    ctx.restore();
  },
  /* canvas.rs:202-208 pencil_cursor_rect：grid_square 换到画布像素、四边对齐到实体像素（s＝文件→画布像素倍率）。
     铅笔笔印在图层坐标对格；图层位移是整数时与文件坐标同一张格 */
  cursorRect(h, s){
    const sq = gridSquare(h[0], h[1], ToolState.size);
    if (!sq.every(isFinite)) return null;
    return [Math.round(sq[0] * s), Math.round(sq[1] * s), Math.round(sq[2] * s), Math.round(sq[3] * s)];
  }
});

/* ═══════════ 命令（agent 与人走同一条路） ═══════════ */
CMD.reg(CMD_ID, {i18n:'', undoable:true,
  params:'{points:[[x,y,pressure?,tiltX?,tiltY?,rotation?,timeMs?,wheel?]…] 或 [{x,y,pressure?,…}] 文件坐标（滑鼠 pressure=1）, '
       + 'brush?:{…BrushSettings 补丁，同 brush.set}, size? px（预设＝工具大小）, opacity? 0..1, hardness? 0..1（预设强制 1）, flow? 0..1（预设强制 1）, '
       + 'spacing? 0.01..10, smoothing? 0..1（预设＝铅笔自己的平滑）, color? "#rrggbb"|[r,g,b,a]（预设＝前景色）, '
       + 'mode? normal|dissolve|multiply|screen|overlay|…（27 种，预设＝笔刷现值）, erase? bool=false（锁透明像素的层改刷背景色）, '
       + 'autoErase? bool=false（起笔那一像素＝前景色 ⇒ 整笔改画背景色）, zoom?=1, seed? 数字或数字字串, layerId?} '
       + '铅笔一笔：无反锯齿、笔印落在像素格上（有选区只画选区内）；回传 {ok, dabs, damage:[x,y,w,h] 文件坐标, seed, autoErased, color, erase}'},
  p => pencilStroke(p));

CMD.reg('pencil.setOptions', {i18n:'',
  params:'{autoErase?:bool, smoothing?:0..1（铅笔自己那一份）, size?:1..5000 px, mode?:"normal"|"multiply"|…（27 种）, opacity?:0..1, hardness?:0..1} '
       + '铅笔选项（＝选项栏；size／mode／opacity／hardness 写进跟笔刷共用的那支笔：brush.set）。传 {} 只读 → {autoErase, smoothing, size, mode, opacity}'},
  p => {
    if (typeof p.autoErase === 'boolean') U.autoErase = p.autoErase;
    if (isNum(p.smoothing)) U.smoothing = c01(p.smoothing);
    const patch = {};
    if (isNum(p.size)) patch.size = clamp(Math.round(p.size), SIZE_MIN, PENCIL_SIZE_MAX);
    if (isNum(p.hardness)) patch.hardness = c01(p.hardness);
    if (isNum(p.opacity)) patch.opacity = c01(p.opacity);
    if (p.mode !== undefined){
      const m = modeOf(p.mode);
      if (!m) return {ok:false, error:`pencil.setOptions: unknown blend mode \`${p.mode}\``};
      patch.mode = m;
    }
    if (Object.keys(patch).length){
      if (CMD.map['brush.set']){
        const r = CMD.run('brush.set', patch);
        if (r && r.ok === false) return r;
      } else {
        if (patch.size !== undefined) ToolState.size = patch.size;
        if (patch.hardness !== undefined) ToolState.hardness = patch.hardness;
        if (patch.opacity !== undefined) U.fallback.opacity = patch.opacity;
        if (patch.mode !== undefined) U.fallback.mode = patch.mode;
      }
    }
    T._syncBar();
    if (window.UI && UI.canvas) UI.draw();
    return optionsJson();
  });

/* 给自测与 agent 用的纯函数（不改文件） */
T._engine = { gridCenter, gridSquare, pencilBrush, dabCoverage, parsePoints, StrokeRenderer };

window.Pencil = T;
})();

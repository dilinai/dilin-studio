// 网页剪辑页·特效与转场：标在原有素材片段上的点缀，不放进「程序片段」轨道。
// 自写的特效库（30 转场＋29 特效·GLSL）：着色器原始码就是这一档（最早由一次性脚本批量产出，之后直接改这一档）。
// 接口：转场 vec4 transition(vec2 uv)·getFrom／getTo·progress 0→1；特效 vec4 effect(vec2 uv)·getTex／getPrev(uv,k)·amount 强度包络·progress 窗内进度·time 秒。
// ease：转场 linear＝进度照时间匀速（其余头尾放缓）；特效 none＝整段恒定强度（其余在片段头尾淡入淡出）。len＝转场自己的默认长度（秒·缺＝全站默认）。
// uv 左上 (0,0)、右下 (1,1)。左清单分类照剪映那排·一款可在几类。缩图＝public/vedit/fx/<id>.jpg。
export type FxKind = 'transition' | 'effect'
export type FxItem = { id: string; kind: FxKind; name: { tw: string; cn: string; en: string }; cats: string[]; params: Record<string, number>; ease: string; len?: number; body: string }
export const FX_COMMON_GLSL = "// ===== 堤麟特效库 共用函数（自写）=====\n#define PI 3.14159265\nfloat hash11(float p){ p = fract(p*.1031); p *= p+33.33; p *= p+p; return fract(p); }\nfloat hash21(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*.1031); p3 += dot(p3, p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }\nvec2 hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*vec3(.1031,.1030,.0973)); p3 += dot(p3, p3.yzx+33.33); return fract((p3.xx+p3.yz)*p3.zy); }\nfloat vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);\n  return mix(mix(hash21(i),hash21(i+vec2(1,0)),f.x), mix(hash21(i+vec2(0,1)),hash21(i+vec2(1,1)),f.x), f.y); }\nfloat fbm(vec2 p){ float s=0., a=.5; for(int i=0;i<5;i++){ s+=a*vnoise(p); p=p*2.03+17.1; a*=.5; } return s; }\nfloat luma(vec3 c){ return dot(c, vec3(.299,.587,.114)); }\nvec2 asp(vec2 p){ return vec2((p.x-.5)*ratio, p.y-.5); }          // 以中心为原点、等比坐标\nvec2 unasp(vec2 q){ return vec2(q.x/ratio+.5, q.y+.5); }\nvec2 rot(vec2 v, float a){ float c=cos(a), s=sin(a); return vec2(c*v.x-s*v.y, s*v.x+c*v.y); }\nvec2 zoomAt(vec2 p, vec2 c, float z){ return c + (p-c)/z; }\nvec2 mirrorUV(vec2 p){ return 1.-abs(1.-mod(p,2.)); }               // 出界镜像，免黑边\n\n// 按来源取色：0=from 1=to 2=tex\nvec4 src(int w, vec2 p){ p = mirrorUV(p); return w==0 ? getFrom(p) : (w==1 ? getTo(p) : getTex(p)); }\n\n// 方向动态模糊：沿 dir 方向采 n 次\nvec4 dirBlur(int w, vec2 p, vec2 dir){ vec4 c=vec4(0.); for(int i=0;i<24;i++){ float t=float(i)/23.-.5; c+=src(w, p+dir*t); } return c/24.; }\n// 径向（变焦）模糊：朝 center 方向拉\nvec4 zoomBlur(int w, vec2 p, vec2 center, float strength){ vec4 c=vec4(0.); for(int i=0;i<24;i++){ float t=float(i)/23.; c+=src(w, mix(p, center, t*strength)); } return c/24.; }\n// 旋转模糊\nvec4 spinBlur(int w, vec2 p, float ang){ vec4 c=vec4(0.); vec2 q=asp(p); for(int i=0;i<20;i++){ float t=float(i)/19.-.5; c+=src(w, unasp(rot(q, ang*t))); } return c/20.; }\n// 近似高斯模糊（黄金角散点 32 次）\nvec4 softBlur(int w, vec2 p, float r){ vec4 c=src(w,p); float tot=1.; for(int i=1;i<32;i++){ float a=float(i)*2.39996; float d=sqrt(float(i)/31.)*r; c+=src(w, p+vec2(cos(a)/ratio, sin(a))*d); tot+=1.; } return c/tot; }\n// 色差：RGB 三通道沿 off 分开\nvec3 rgbSplit(int w, vec2 p, vec2 off){ return vec3(src(w,p+off).r, src(w,p).g, src(w,p-off).b); }\n// 屏幕／加亮混合\nvec3 screen(vec3 a, vec3 b){ return 1.-(1.-a)*(1.-b); }\n// 胶片暖色漏光（程序生成）\nvec3 lightLeak(vec2 p, float t){ float n=fbm(vec2(p.x*1.6+t*.7, p.y*1.2-t*.4)); vec3 c=mix(vec3(1.,.35,.08), vec3(1.,.82,.45), n); return c*smoothstep(.35,.95,n+.25*sin(t*3.+p.x*4.)); }\n// 网点：v 亮度 0..1 ⇒ 1＝白纸 0＝墨点；cells＝每屏高几格；ang＝网角（弧度）\nfloat halftone(vec2 uv, float v, float cells, float ang){\n  vec2 c = fract(rot(asp(uv)*cells, ang)) - .5;\n  float r = sqrt(clamp(1.-v, 0., 1.))*.72;\n  return smoothstep(r-.07, r+.07, length(c));\n}\n// 光谱色（h 0..1 红→黄→绿→青→蓝→紫）\nvec3 spectrum(float h){ return clamp(abs(fract(h+vec3(0.,2./3.,1./3.))*6.-3.)-1., 0., 1.); }\n// 纸色（米白＋细纤维起伏）\nvec3 paperTone(vec2 uv){ vec2 p = uv*vec2(ratio,1.); return vec3(.96,.94,.89)*(.9+.1*fbm(p*70.)) - .05*smoothstep(.8,.98,vnoise(rot(p,.7)*vec2(240.,10.))); }\n"
export const FX_ITEMS: FxItem[] = [
 {
  "id": "tr-blur_dissolve",
  "kind": "transition",
  "name": {
   "tw": "模糊溶解",
   "cn": "模糊溶解",
   "en": "Blur dissolve"
  },
  "cats": [
   "effects-hot",
   "effects-dissolve",
   "effects-blur",
   "effects-new"
  ],
  "params": {
   "radius": 0.045
  },
  "ease": "inout",
  "body": "// 名称: 模糊溶解\n// 对标: 模糊溶解、视差溶解、交叉缩放的柔和版\n// 融合: 前片虚焦→交叉→后片对焦，带一点呼吸放大\nuniform float radius; // = 0.045 最大模糊半径\nvec4 transition(vec2 uv){\n  float p = progress; float k = sin(p*PI);\n  vec2 c = vec2(.5);\n  vec3 a = softBlur(0, zoomAt(uv,c,1.+.05*p), radius*k).rgb;\n  vec3 b = softBlur(1, zoomAt(uv,c,1.05-.05*p), radius*k).rgb;\n  return vec4(mix(a,b,smoothstep(.3,.7,p)),1.);\n}\n"
 },
 {
  "id": "tr-chroma_whip",
  "kind": "transition",
  "name": {
   "tw": "色差甩鏡",
   "cn": "色差甩镜",
   "en": "Chroma whip"
  },
  "cats": [
   "effects-hot",
   "effects-camera",
   "effects-blur",
   "effects-new",
   "effects-glitch"
  ],
  "params": {
   "dir": 0.0
  },
  "ease": "inout",
  "body": "// 名称: 色差甩鏡\n// 对标: 甩镜、RGB 甩镜、色散转场\n// 融合: 横甩拉丝模糊＋红绿蓝三通道各自错开甩过（接缝软过渡）＋中段微放大提亮\nuniform float dir; // = 0 0向左甩 1向右甩\nvec4 transition(vec2 uv){\n  float p = progress, v = sin(p*PI);\n  vec2 d = dir < .5 ? vec2(1,0) : vec2(-1,0);\n  vec2 q = zoomAt(uv, vec2(.5), 1. + .1*v) + d*p;\n  vec2 bl = d*(.4*v*v + .02);\n  vec3 col;\n  for (int k = 0; k < 3; k++) {\n    vec2 qq = q + d*(float(k)-1.)*.03*v;\n    float m = smoothstep(-.04, .04, d.x > 0. ? 1. - qq.x : qq.x);\n    vec4 s = mix(dirBlur(1, qq-d, bl), dirBlur(0, qq, bl), m);\n    col[k] = s[k];\n  }\n  col *= 1. + .22*v*v;\n  return vec4(col,1.);\n}\n"
 },
 {
  "id": "tr-crash_zoom",
  "kind": "transition",
  "name": {
   "tw": "衝焦變焦",
   "cn": "冲焦变焦",
   "en": "Crash zoom"
  },
  "cats": [
   "effects-hot",
   "effects-camera",
   "effects-blur",
   "effects-new",
   "effects-shoot"
  ],
  "params": {
   "power": 1.0
  },
  "ease": "inout",
  "body": "// 名称: 冲焦变焦\n// 对标: 交叉变焦、交叉放大、镜头放大、变形缩放\n// 融合: 前片猛推＋径向模糊，切点闪一下，后片从放大态收回\nuniform float power; // = 1.0 推焦力度\nvec4 transition(vec2 uv){\n  float p = progress; vec2 c = vec2(.5);\n  float s = sin(p*PI);\n  vec3 col;\n  if(p < .5){ float z = 1.+ 2.*power*p*p; col = zoomBlur(0, zoomAt(uv,c,z), c, .35*s*power).rgb; }\n  else { float q = 1.-p; float z = 1.+ 2.*power*q*q; col = zoomBlur(1, zoomAt(uv,c,z), c, .35*s*power).rgb; }\n  col += pow(s,6.)*.35;\n  return vec4(col,1.);\n}\n"
 },
 {
  "id": "tr-cube",
  "kind": "transition",
  "name": {
   "tw": "立方體翻轉",
   "cn": "立方体翻转",
   "en": "Cube flip"
  },
  "cats": [
   "effects-slides",
   "effects-new",
   "effects-warp"
  ],
  "params": {
   "back": 0.35
  },
  "ease": "inout",
  "body": "// 名称: 立方体翻转\n// 对标: 立方体、3D屏幕翻转、垂直旋转\n// 融合: 3D 立方体转面＋转动时后退＋侧面明暗\nuniform float back; // = 0.35 转动时往后退的量\nvec4 transition(vec2 uv){\n  float p = progress; float a = p*PI/2.;\n  float hh = .5/ratio;\n  float F = 1.6;\n  vec3 ro = vec3(0., 0., -.5 - F - back*sin(p*PI));\n  vec3 rd = normalize(vec3(uv.x-.5, (uv.y-.5)/ratio, F));\n  // 世界 → 立方体本地（绕 Y 轴）\n  float ca = cos(a), sa = sin(a);\n  vec3 o = vec3(ro.x*ca - ro.z*sa, ro.y, ro.x*sa + ro.z*ca);\n  vec3 d = vec3(rd.x*ca - rd.z*sa, rd.y, rd.x*sa + rd.z*ca);\n  vec3 col = vec3(.04,.045,.06)*(1.-.5*abs(uv.y-.5));\n  float best = 1e9;\n  // 前面 z=-0.5 → 前片\n  float t1 = (-.5 - o.z)/d.z; vec3 h1 = o + d*t1;\n  if(t1>0. && abs(h1.x)<=.5 && abs(h1.y)<=hh){ best=t1; col = getFrom(vec2(h1.x+.5, h1.y/(2.*hh)+.5)).rgb * (.55+.45*ca); }\n  // 右面 x=+0.5 → 后片\n  float t2 = (.5 - o.x)/d.x; vec3 h2 = o + d*t2;\n  if(t2>0. && t2<best && abs(h2.z)<=.5 && abs(h2.y)<=hh){ col = getTo(vec2(h2.z+.5, h2.y/(2.*hh)+.5)).rgb * (.55+.45*sa); }\n  return vec4(col,1.);\n}\n"
 },
 {
  "id": "tr-dip_black",
  "kind": "transition",
  "name": {
   "tw": "暗角閃黑",
   "cn": "暗角闪黑",
   "en": "Dip to black"
  },
  "cats": [
   "effects-dissolve",
   "effects-new"
  ],
  "params": {
   "depth": 1.0
  },
  "ease": "inout",
  "body": "// 名称: 暗角闪黑\n// 对标: 闪黑、淡入淡出(黑)、叠黑（浅）、黑场转场\n// 融合: 闪黑＋暗角由四周收拢\nuniform float depth; // = 1.0 黑的程度 0~1\nvec4 transition(vec2 uv){\n  float p = progress;\n  float k = 1.-abs(p*2.-1.);\n  vec3 col = p < .5 ? getFrom(uv).rgb : getTo(uv).rgb;\n  float v = length(asp(uv))/ (.5*length(vec2(ratio,1.)));\n  float vig = smoothstep(1.2 - k*1.3, .2 - k*1.3, v);\n  col *= mix(1., vig*(1.-k*depth*.6), k*depth);\n  return vec4(col,1.);\n}\n"
 },
 {
  "id": "tr-door",
  "kind": "transition",
  "name": {
   "tw": "開門",
   "cn": "开门",
   "en": "Doors open"
  },
  "cats": [
   "effects-slides",
   "effects-new",
   "effects-split"
  ],
  "params": {
   "vertical": 0.0
  },
  "ease": "inout",
  "body": "// 名称: 开门\n// 对标: 开门、水平分开、HorizontalOpen\n// 融合: 前片从中缝向两侧拉开＋门缝光＋后片从里推出\nuniform float vertical; // = 0 1=上下开\nvec4 transition(vec2 uv){\n  float p = progress;\n  float x = vertical>.5 ? uv.y : uv.x;\n  float h = .5*p;\n  vec3 b = getTo(zoomAt(uv, vec2(.5), 1.15-.15*p)).rgb;\n  vec3 col;\n  if(abs(x-.5) < h) col = b;\n  else { vec2 q = uv; if(vertical>.5) q.y += (uv.y<.5 ? h : -h); else q.x += (uv.x<.5 ? h : -h); col = getFrom(q).rgb*(1.-.35*p); }\n  col += vec3(1.,.95,.85)*exp(-pow((abs(x-.5)-h)*80.,2.))*sin(p*PI);\n  return vec4(col,1.);\n}\n"
 },
 {
  "id": "tr-film_burn",
  "kind": "transition",
  "name": {
   "tw": "膠片灼燒",
   "cn": "胶片灼烧",
   "en": "Film burn"
  },
  "cats": [
   "effects-hot",
   "effects-new",
   "effects-light"
  ],
  "params": {},
  "ease": "inout",
  "body": "// 名称: 胶片灼烧\n// 对标: 胶片动态、胶片扭曲动态、模糊曝光\n// 融合: 灼烧孔洞蔓延＋橙色焦边＋漏光过曝\nvec4 transition(vec2 uv){\n  float p = progress;\n  float n = fbm(uv*vec2(ratio,1.)*3.5 + seed*3.);\n  float th = p*1.35 - .2;\n  float hole = n + (1.-uv.x)*.25 - th;\n  float m = smoothstep(-.02, .02, hole);\n  vec3 col = mix(getTo(uv).rgb, getFrom(uv).rgb, m);\n  float e = exp(-hole*hole*600.);\n  col += vec3(1.,.45,.08)*e*2.2 + vec3(1.,.85,.4)*exp(-hole*hole*4000.);\n  col = screen(col, lightLeak(uv, p*3.)*sin(p*PI)*.7);\n  return vec4(col,1.);\n}\n"
 },
 {
  "id": "tr-flash_dissolve",
  "kind": "transition",
  "name": {
   "tw": "閃白疊化",
   "cn": "闪白叠化",
   "en": "Flash dissolve"
  },
  "cats": [
   "effects-dissolve",
   "effects-new",
   "effects-light"
  ],
  "params": {
   "frames": 7.0,
   "flash": 1.0
  },
  "ease": "linear",
  "body": "// 名称: 闪白叠化\n// 对标: 回忆快闪原片（情侣回忆-15场景）换图那一下：叠化＋闪一下白光\n// 融合: 切点前照常放前片；切点后 7 格内后片线性叠进来，同时盖一层白光 35%→22%→12%→6%→2% 很快退掉\n// 缓动: linear\n// 默认长度: 0.4667\n// 进度 0→1 横跨切点两侧（各半）·前半不动画面；后半 frames＝叠化格数（照原片 30fps 7 格）\nuniform float frames; // = 7 叠化几格（后半窗分成几格）\nuniform float flash; // = 1.0 白光强度（1＝原片）\nfloat whiteAt(float k){\n  // 原片 since=0..4 的白光比例，格与格之间线性接\n  if(k < 0.) return 0.;\n  if(k < 1.) return mix(.35, .22, k);\n  if(k < 2.) return mix(.22, .12, k-1.);\n  if(k < 3.) return mix(.12, .06, k-2.);\n  if(k < 4.) return mix(.06, .02, k-3.);\n  if(k < 5.) return mix(.02, 0., k-4.);\n  return 0.;\n}\nvec4 transition(vec2 uv){\n  vec3 a = getFrom(uv).rgb;\n  if(progress < .5) return vec4(a, 1.);\n  float k = (progress - .5) * 2. * frames;   // 切点后第几格（0 起）\n  float m = clamp((k + 1.) / frames, 0., 1.); // 后片占比：第 0 格就 1/7\n  vec3 col = mix(a, getTo(uv).rgb, m);\n  float w = whiteAt(k * 7. / frames) * flash;\n  col = col * (1. - w) + w;\n  return vec4(col, 1.);\n}\n",
  "len": 0.4667
 },
 {
  "id": "tr-flash_white",
  "kind": "transition",
  "name": {
   "tw": "閃白衝焦",
   "cn": "闪白冲焦",
   "en": "Flash white"
  },
  "cats": [
   "effects-hot",
   "effects-new",
   "effects-light"
  ],
  "params": {
   "zoom": 0.08,
   "glow": 1.0
  },
  "ease": "inout",
  "body": "// 名称: 闪白冲焦\n// 对标: 闪白、闪白03、闪光放大、闪光缩小\n// 融合: 过曝闪白＋前后片轻推焦＋闪光瞬间柔焦\nuniform float zoom; // = 0.08 推焦量\nuniform float glow; // = 1.0 曝光强度\nvec4 transition(vec2 uv){\n  float p = progress;\n  float f = pow(1.-abs(p*2.-1.), 2.2)*glow;\n  vec2 c = vec2(.5);\n  vec2 ua = zoomAt(uv, c, 1.+zoom*smoothstep(0.,.5,p));\n  vec2 ub = zoomAt(uv, c, 1.+zoom*(1.-smoothstep(.5,1.,p)));\n  vec3 a = softBlur(0, ua, .012*f).rgb, b = softBlur(1, ub, .012*f).rgb;\n  vec3 col = mix(a, b, smoothstep(.42,.58,p));\n  col = mix(col, vec3(1.), clamp(f*.95,0.,1.)) + col*f*.3;\n  return vec4(col,1.);\n}\n"
 },
 {
  "id": "tr-glitch",
  "kind": "transition",
  "name": {
   "tw": "故障換台",
   "cn": "故障换台",
   "en": "Glitch switch"
  },
  "cats": [
   "effects-hot",
   "effects-new",
   "effects-glitch"
  ],
  "params": {
   "power": 1.0
  },
  "ease": "inout",
  "body": "// 名称: 故障换台\n// 对标: 故障转场、信号故障、闪烁故障、播放毛刺\n// 融合: 块状错位＋RGB 分离＋扫描线＋随机前后片抽帧互换\nuniform float power; // = 1.0 故障强度\nvec4 transition(vec2 uv){\n  float p = progress; float k = sin(p*PI)*power;\n  float t = floor(p*24.)+seed*13.;\n  float row = floor(uv.y*mix(8.,40.,hash11(t)));\n  float r = hash21(vec2(row, t));\n  vec2 q = uv;\n  if(r > 1.-k*.7) q.x += (hash21(vec2(row,t+3.))-.5)*.15*k;\n  vec2 blk = floor(uv*vec2(12.,7.));\n  if(hash21(blk+t) > 1.-k*.25) q += (hash22(blk+t)-.5)*.05*k;\n  bool useB = p > .5;\n  if(hash21(vec2(t,7.)) < k*.45) useB = !useB;\n  int w = useB ? 1 : 0;\n  vec3 col = rgbSplit(w, q, vec2(.025*k*(hash11(t+1.)-.3), .004*k));\n  col *= .9 + .1*sin(uv.y*res.y*1.5);\n  col = mix(col, vec3(hash21(uv*res+t)), .12*k*k);\n  return vec4(col,1.);\n}\n"
 },
 {
  "id": "tr-gold_wipe",
  "kind": "transition",
  "name": {
   "tw": "金線擦除",
   "cn": "金线擦除",
   "en": "Gold wipe"
  },
  "cats": [
   "effects-slides",
   "effects-new",
   "effects-light"
  ],
  "params": {
   "angle": 20.0,
   "width": 0.06,
   "r": 1.0,
   "g": 0.82,
   "b": 0.45
  },
  "ease": "inout",
  "body": "// 名称: 金线擦除\n// 对标: 线性擦除（快速）、向右擦除、画笔擦除\n// 融合: 斜向软边擦除＋擦除线发金光＋线后一小段光晕\nuniform float angle; // = 20 擦除角度（度）\nuniform float width; // = 0.06 软边宽度\nuniform float r; // = 1.0 线颜色 R\nuniform float g; // = 0.82 线颜色 G\nuniform float b; // = 0.45 线颜色 B\nvec4 transition(vec2 uv){\n  float a = radians(angle);\n  vec2 n = vec2(cos(a), sin(a));\n  vec2 q = asp(uv);\n  float span = .5*(abs(n.x)*ratio + abs(n.y)) + width;\n  float pos = dot(q, n) - mix(-span, span, progress);\n  float m = smoothstep(-width, width, pos);\n  vec3 col = mix(getTo(uv).rgb, getFrom(uv).rgb, m);\n  vec3 gold = vec3(r,g,b);\n  col += gold*exp(-pos*pos/(width*width*.04))*1.2;\n  col = screen(col, gold*exp(-max(-pos,0.)*12.)*step(pos,0.)*.35*sin(progress*PI));\n  return vec4(col,1.);\n}\n"
 },
 {
  "id": "tr-halftone_rip",
  "kind": "transition",
  "name": {
   "tw": "網點撕紙揭露",
   "cn": "网点撕纸揭露",
   "en": "Halftone rip"
  },
  "cats": [
   "effects-slides",
   "effects-new",
   "effects-glitch"
  ],
  "params": {
   "cells": 70.0
  },
  "ease": "inout",
  "body": "// 名称: 網點撕紙揭露\n// 对标: 漫画网点、印刷撕页\n// 融合: 竖向撕口扫过＋撕口前方旧画面逐渐变黑白网点＋纤维白边＋投影\nuniform float cells; // = 70 网点密度\nvec4 transition(vec2 uv){\n  vec2 q = asp(uv);\n  float span = .5*ratio + .14;\n  float j = (fbm(vec2(q.y*5., seed*4.2))-.5)*.14 + (vnoise(vec2(q.y*70., 1.))-.5)*.016;\n  float e = q.x - (mix(-span, span, progress) + j);\n  vec3 fr = getFrom(uv).rgb;\n  float h = smoothstep(.45, .05, e);\n  vec3 dots = mix(vec3(.08), vec3(.95,.94,.9), halftone(uv, luma(fr), cells, radians(45.)));\n  fr = mix(fr, dots, h);\n  float rim = .010 + .014*vnoise(vec2(q.y*90., 6.));\n  vec3 to = getTo(uv).rgb*(1.-.4*exp(min(e,0.)*35.));\n  vec3 col = mix(paperTone(uv), fr, smoothstep(rim-.002, rim+.002, e));\n  col = mix(to, col, smoothstep(-.002, .002, e));\n  return vec4(col,1.);\n}\n"
 },
 {
  "id": "tr-ink",
  "kind": "transition",
  "name": {
   "tw": "水墨暈染",
   "cn": "水墨晕染",
   "en": "Ink bleed"
  },
  "cats": [
   "effects-hot",
   "effects-dissolve",
   "effects-new",
   "effects-warp"
  ],
  "params": {
   "scale": 3.0,
   "gold": 0.0
  },
  "ease": "inout",
  "body": "// 名称: 水墨晕染\n// 对标: 水墨古风3、蒸汽溶解、融合\n// 融合: 墨团噪声扩散＋墨边加深＋可选金色描边\nuniform float scale; // = 3.0 墨团大小（越大越碎）\nuniform float gold; // = 0 1=墨边换成金线\nvec4 transition(vec2 uv){\n  float p = progress;\n  float n = fbm(asp(uv)*scale + seed*7.);\n  float d = length(asp(uv));\n  float field = n*.75 + (1.-d)*.45;\n  float th = mix(1.25, .05, p);\n  float m = smoothstep(th, th-.04, field);\n  float edge = smoothstep(.07, 0., abs(field-th+.02)) * sin(p*PI);\n  vec3 col = mix(getTo(uv).rgb, getFrom(uv).rgb, m);\n  if(gold > .5) col += vec3(1.,.8,.4)*edge*1.1;\n  else col = mix(col, vec3(.05,.05,.06), edge*.85);\n  return vec4(col,1.);\n}\n"
 },
 {
  "id": "tr-iris",
  "kind": "transition",
  "name": {
   "tw": "光圈開",
   "cn": "光圈开",
   "en": "Iris open"
  },
  "cats": [
   "effects-slides",
   "effects-new",
   "effects-shoot"
  ],
  "params": {
   "out_": 0.0
  },
  "ease": "inout",
  "body": "// 名称: 光圈开\n// 对标: 圆形（入）、圆形（出）、星星\n// 融合: 圆形展开＋环形光边＋开圆时后片轻缩\nuniform float out_; // = 0 0由中心开 1由外向内收\nvec4 transition(vec2 uv){\n  float p = out_>.5 ? 1.-progress : progress;\n  vec2 q = asp(uv); float d = length(q);\n  float R = p * .5*length(vec2(ratio,1.)) * 1.05;\n  float m = smoothstep(R+.01, R-.01, d);\n  if(out_>.5) m = 1.-m;\n  vec3 b = getTo(zoomAt(uv, vec2(.5), 1.+.08*(1.-progress))).rgb;\n  vec3 col = mix(getFrom(uv).rgb, b, m);\n  col += vec3(1.,.9,.7)*exp(-pow((d-R)*60.,2.))*sin(progress*PI)*1.2;\n  return vec4(col,1.);\n}\n"
 },
 {
  "id": "tr-leak_dissolve",
  "kind": "transition",
  "name": {
   "tw": "漏光疊化",
   "cn": "漏光叠化",
   "en": "Light-leak dissolve"
  },
  "cats": [
   "effects-dissolve",
   "effects-new",
   "effects-light"
  ],
  "params": {
   "leak": 0.9
  },
  "ease": "inout",
  "body": "// 名称: 漏光叠化\n// 对标: 叠化、溶解、叠加溶解、模糊曝光\n// 融合: 交叉叠化＋暖色胶片漏光扫过\nuniform float leak; // = 0.9 漏光强度\nvec4 transition(vec2 uv){\n  float p = progress;\n  vec3 col = mix(getFrom(uv).rgb, getTo(uv).rgb, smoothstep(.2,.8,p));\n  vec3 l = lightLeak(uv + vec2(p*.6-.3, 0.), p*2.+seed);\n  float k = sin(p*PI);\n  col = screen(col, l*k*leak);\n  col += k*k*.12*leak;\n  return vec4(col,1.);\n}\n"
 },
 {
  "id": "tr-luma_dissolve",
  "kind": "transition",
  "name": {
   "tw": "亮度溶解",
   "cn": "亮度溶解",
   "en": "Luma dissolve"
  },
  "cats": [
   "effects-dissolve",
   "effects-new",
   "effects-light"
  ],
  "params": {
   "soft": 0.12
  },
  "ease": "inout",
  "body": "// 名称: 亮度溶解\n// 对标: 亮度蒙版转场、Luma fade\n// 融合: 照旧画面亮度，亮处先溶出新画面、暗处最后＋溶解边一圈微光\nuniform float soft; // = 0.12 溶解边宽\nvec4 transition(vec2 uv){\n  float g = 1. - luma(softBlur(0, uv, .02).rgb) + (vnoise(uv*res/24.)-.5)*.06;\n  float k = progress*(1. + 2.*soft) - soft;\n  float m = 1. - smoothstep(k-soft, k+soft, g);\n  vec3 col = mix(getFrom(uv).rgb, getTo(uv).rgb, m);\n  col += vec3(1.,.95,.85)*exp(-pow((g-k)/soft, 2.)*4.)*.25*sin(progress*PI);\n  return vec4(col,1.);\n}\n"
 },
 {
  "id": "tr-pixel_dissolve",
  "kind": "transition",
  "name": {
   "tw": "像素溶解",
   "cn": "像素溶解",
   "en": "Pixel dissolve"
  },
  "cats": [
   "effects-dissolve",
   "effects-new",
   "effects-glitch"
  ],
  "params": {
   "cells": 48.0
  },
  "ease": "inout",
  "body": "// 名称: 像素溶解\n// 对标: 像素溶解、随机溶解 01/02/03、网格淡出\n// 融合: 先马赛克变粗→方块随机翻成后片→再变清晰\nuniform float cells; // = 48 最粗时横向格数\nvec4 transition(vec2 uv){\n  float p = progress; float k = sin(p*PI);\n  float n = mix(400., cells, k);\n  vec2 g = vec2(n, n/ratio);\n  vec2 cell = floor(uv*g);\n  vec2 q = (cell+.5)/g;\n  q = mix(uv, q, step(.05,k));\n  float rnd = hash21(cell+seed);\n  float sw = smoothstep(rnd-.08, rnd+.08, (p-.15)/.7);\n  return vec4(mix(getFrom(q).rgb, getTo(q).rgb, sw),1.);\n}\n"
 },
 {
  "id": "tr-prism_flash",
  "kind": "transition",
  "name": {
   "tw": "光學稜鏡閃切",
   "cn": "光学棱镜闪切",
   "en": "Prism flash cut"
  },
  "cats": [
   "effects-new",
   "effects-light",
   "effects-shoot"
  ],
  "params": {
   "angle": 20.0
  },
  "ease": "inout",
  "body": "// 名称: 光學稜鏡閃切\n// 对标: 闪光转场、棱镜光、彩虹光切\n// 融合: 正中一记白闪切换＋斜向彩虹棱镜光带扫过＋闪时 RGB 分离与微放大\nuniform float angle; // = 20 光带角度（度）\nvec4 transition(vec2 uv){\n  float f = exp(-pow((progress-.5)*6.5, 2.));\n  int w = progress < .5 ? 0 : 1;\n  vec2 p = zoomAt(uv, vec2(.5), 1. + .06*f);\n  vec3 col = rgbSplit(w, p, vec2(.03*f, 0.));\n  float a = radians(angle); vec2 n = vec2(cos(a), sin(a));\n  float span = .5*(abs(n.x)*ratio + abs(n.y)) + .3;\n  float s = dot(asp(uv), n) - mix(-span, span, progress);\n  vec3 band = spectrum(s/.16 + .5)*exp(-s*s/.02) + vec3(1.)*exp(-s*s/.0006)*.8;\n  col = screen(col, band*(.35 + .9*f));\n  col = mix(col, vec3(1.), f*.55);\n  return vec4(col,1.);\n}\n"
 },
 {
  "id": "tr-pull_out",
  "kind": "transition",
  "name": {
   "tw": "拉遠換景",
   "cn": "拉远换景",
   "en": "Pull out"
  },
  "cats": [
   "effects-camera",
   "effects-new"
  ],
  "params": {},
  "ease": "inout",
  "body": "// 名称: 拉远换景\n// 对标: 镜头缩小、基本缩小、3D 缩放\n// 融合: 前片拉远缩小成画中画、后片从放大态落定，外圈径向模糊\nvec4 transition(vec2 uv){\n  float p = progress; vec2 c = vec2(.5); float s = sin(p*PI);\n  float za = mix(1., .35, smoothstep(0.,.6,p));\n  vec2 qa = zoomAt(uv, c, za);\n  float inA = step(abs(qa.x-.5),.5)*step(abs(qa.y-.5),.5);\n  float zb = mix(1.8, 1., smoothstep(.25,1.,p));\n  vec3 b = zoomBlur(1, zoomAt(uv,c,zb), c, -.25*s).rgb;\n  vec3 a = getFrom(qa).rgb;\n  float fa = inA * (1.-smoothstep(.45,.8,p));\n  // 画中画的白边与投影\n  vec2 e = abs(qa-.5); float edge = step(.5, max(e.x,e.y)) * step(max(e.x,e.y), .5+.012/za) * (1.-smoothstep(.45,.8,p));\n  vec3 col = mix(b*(1.-.35*fa*0.), a, fa);\n  col = mix(col, vec3(1.), edge);\n  return vec4(col,1.);\n}\n"
 },
 {
  "id": "tr-push",
  "kind": "transition",
  "name": {
   "tw": "推移動態模糊",
   "cn": "推移动态模糊",
   "en": "Push blur"
  },
  "cats": [
   "effects-hot",
   "effects-slides",
   "effects-blur",
   "effects-new"
  ],
  "params": {
   "dir": 0.0,
   "blur": 0.12,
   "sweep": 0.0
  },
  "ease": "inout",
  "body": "// 名称: 推移动态模糊\n// 对标: 平移、向左擦除/推、屏幕视差、向下拖动、运动模糊类\n// 融合: 推移＋随速度的方向模糊＋可选斜向光扫\nuniform float dir; // = 0 方向 0左 1右 2上 3下（画面往哪边走）\nuniform float blur; // = 0.12 模糊长度\nuniform float sweep; // = 0 光扫强度 0~1\nvec4 transition(vec2 uv){\n  float p = progress;\n  vec2 d = dir<.5 ? vec2(1,0) : (dir<1.5 ? vec2(-1,0) : (dir<2.5 ? vec2(0,1) : vec2(0,-1)));\n  vec2 q = uv + d*p;\n  float v = sin(p*PI);\n  vec3 col;\n  bool inA = (d.x>0. && q.x<1.) || (d.x<0. && q.x>0.) || (d.y>0. && q.y<1.) || (d.y<0. && q.y>0.);\n  if(inA) col = dirBlur(0, q, d*blur*v).rgb; else col = dirBlur(1, q-d, d*blur*v).rgb;\n  float band = dot(uv-.5, normalize(vec2(1.,.6))) - (p*2.4-1.2);\n  col = screen(col, vec3(1.,.92,.75)*exp(-band*band*90.)*sweep*v);\n  return vec4(col,1.);\n}\n"
 },
 {
  "id": "tr-shake_zoom",
  "kind": "transition",
  "name": {
   "tw": "震屏衝焦",
   "cn": "震屏冲焦",
   "en": "Shake zoom"
  },
  "cats": [
   "effects-camera",
   "effects-new",
   "effects-shoot"
  ],
  "params": {
   "shake": 0.03
  },
  "ease": "inout",
  "body": "// 名称: 震屏冲焦\n// 对标: 摇晃缩放、闪光回声、冲击波\n// 融合: 节拍放大＋随机抖动＋色差＋切点亮闪\nuniform float shake; // = 0.03 抖动幅度\nvec4 transition(vec2 uv){\n  float p = progress; float k = sin(p*PI);\n  float t = floor(p*30.);\n  vec2 j = (hash22(vec2(t,seed))-.5)*shake*k;\n  vec2 q = zoomAt(uv+j, vec2(.5), 1.+.25*k);\n  int w = p<.5 ? 0 : 1;\n  vec3 col = rgbSplit(w, q, vec2(.012*k,0.));\n  col += pow(k,8.)*.4;\n  return vec4(col,1.);\n}\n"
 },
 {
  "id": "tr-shutter",
  "kind": "transition",
  "name": {
   "tw": "快門",
   "cn": "快门",
   "en": "Shutter"
  },
  "cats": [
   "effects-slides",
   "effects-new",
   "effects-split"
  ],
  "params": {},
  "ease": "inout",
  "body": "// 名称: 快门\n// 对标: 相机快门06、垂直快门、照片定格\n// 融合: 上下黑帘合拢→咔嚓白闪→帘子打开\nvec4 transition(vec2 uv){\n  float p = progress;\n  float c = p<.5 ? smoothstep(0.,.45,p) : 1.-smoothstep(.55,1.,p);\n  float y = abs(uv.y-.5);\n  float m = step(.5*(1.-c), y);\n  vec3 col = p<.5 ? getFrom(uv).rgb : getTo(uv).rgb;\n  col = mix(col, vec3(.02), m);\n  col += vec3(1.)*exp(-pow((p-.5)*14.,2.))*.9;\n  return vec4(col,1.);\n}\n"
 },
 {
  "id": "tr-slats",
  "kind": "transition",
  "name": {
   "tw": "斜條百葉",
   "cn": "斜条百叶",
   "en": "Slats"
  },
  "cats": [
   "effects-slides",
   "effects-new",
   "effects-split"
  ],
  "params": {
   "count": 9.0,
   "angle": 30.0
  },
  "ease": "inout",
  "body": "// 名称: 斜条百叶\n// 对标: 多段斜条展开、多段斜条收拢、行拆分、百叶窗\n// 融合: 斜向条带依次翻开＋条带边缘高光\nuniform float count; // = 9 条数\nuniform float angle; // = 30 倾斜角度\nvec4 transition(vec2 uv){\n  float a = radians(angle);\n  vec2 q = rot(asp(uv), a);\n  float idx = floor((q.x+1.2)*count/2.4);\n  float local = fract((q.x+1.2)*count/2.4);\n  float delay = idx/count*.5;\n  float t = clamp((progress-delay)/.5, 0., 1.);\n  t = t*t*(3.-2.*t);\n  float m = step(local, t);\n  vec3 col = mix(getFrom(uv).rgb, getTo(uv).rgb, m);\n  col += vec3(1.)*exp(-pow((local-t)*40.,2.))*step(.001,t)*step(t,.999)*.6;\n  return vec4(col,1.);\n}\n"
 },
 {
  "id": "tr-spin",
  "kind": "transition",
  "name": {
   "tw": "旋轉換景",
   "cn": "旋转换景",
   "en": "Spin"
  },
  "cats": [
   "effects-camera",
   "effects-new",
   "effects-warp"
  ],
  "params": {
   "turns": 1.0
  },
  "ease": "inout",
  "body": "// 名称: 旋转换景\n// 对标: 转动、顺时针扫、向右旋转的光标\n// 融合: 画面旋转＋旋转模糊＋中段缩小\nuniform float turns; // = 1.0 转几圈\nvec4 transition(vec2 uv){\n  float p = progress; float k = sin(p*PI);\n  float a = turns*2.*PI*p;\n  vec2 q = asp(uv);\n  vec2 r = rot(q, a)*(1.-.35*k);\n  vec2 s = unasp(r);\n  int w = p<.5 ? 0 : 1;\n  vec3 col = spinBlur(w, s, .9*k*turns).rgb;\n  return vec4(col,1.);\n}\n"
 },
 {
  "id": "tr-static_tv",
  "kind": "transition",
  "name": {
   "tw": "雪花換台",
   "cn": "雪花换台",
   "en": "TV static"
  },
  "cats": [
   "effects-new",
   "effects-glitch"
  ],
  "params": {},
  "ease": "inout",
  "body": "// 名称: 雪花换台\n// 对标: 信号故障、老电视、胶片扭曲\n// 融合: 画面上下滚动失步＋雪花噪点满屏＋色彩抽离\nvec4 transition(vec2 uv){\n  float p = progress; float k = pow(sin(p*PI), 1.5);\n  vec2 q = uv; q.y = fract(q.y + k*.35*sin(p*20.));\n  q.x += sin(uv.y*30.+p*60.)*.01*k;\n  vec3 col = p<.5 ? getFrom(q).rgb : getTo(q).rgb;\n  col = mix(col, vec3(luma(col)), k*.7);\n  float n = hash21(floor(uv*res/2.)+floor(p*60.)*3.1);\n  col = mix(col, vec3(n), smoothstep(.45,.98,k));\n  col *= .85 + .15*step(.5, fract(uv.y*res.y/3.));\n  return vec4(col,1.);\n}\n"
 },
 {
  "id": "tr-swirl",
  "kind": "transition",
  "name": {
   "tw": "漩渦",
   "cn": "漩涡",
   "en": "Swirl"
  },
  "cats": [
   "effects-new",
   "effects-warp"
  ],
  "params": {
   "turns": 1.6
  },
  "ease": "inout",
  "body": "// 名称: 漩涡\n// 对标: 漩涡、风车、扭曲变焦\n// 融合: 中心旋涡扭曲＋中段缩放＋旋转方向模糊感\nuniform float turns; // = 1.6 最大扭转圈数\nvec4 transition(vec2 uv){\n  float p = progress; float k = sin(p*PI);\n  vec2 q = asp(uv); float d = length(q);\n  float a = turns*2.*PI*k*smoothstep(.9,0.,d);\n  vec2 r = rot(q, a) * (1.+.4*k);\n  vec2 s = unasp(r);\n  vec3 col = mix(getFrom(mirrorUV(s)).rgb, getTo(mirrorUV(s)).rgb, smoothstep(.4,.6,p));\n  return vec4(col,1.);\n}\n"
 },
 {
  "id": "tr-torn_paper_diag",
  "kind": "transition",
  "name": {
   "tw": "斜向撕紙快切",
   "cn": "斜向撕纸快切",
   "en": "Diagonal paper tear"
  },
  "cats": [
   "effects-hot",
   "effects-slides",
   "effects-new"
  ],
  "params": {
   "angle": 30.0,
   "rough": 1.0
  },
  "ease": "inout",
  "body": "// 名称: 斜向撕紙快切\n// 对标: 撕纸快切、斜切转场\n// 融合: 斜向锯齿撕口快扫＋纤维白边＋投影＋撕到中段一下轻微抖动\nuniform float angle; // = 30 撕口角度（度）\nuniform float rough; // = 1.0 撕口粗糙度\nvec4 transition(vec2 uv){\n  float a = radians(angle); vec2 n = vec2(cos(a), sin(a)), t = vec2(-n.y, n.x);\n  vec2 q = asp(uv) + vec2(0., (hash11(floor(progress*30.))-.5)*.006*sin(progress*PI));\n  float s = dot(q, n), w = dot(q, t);\n  float span = .5*(abs(n.x)*ratio + abs(n.y)) + .14;\n  float j = (fbm(vec2(w*5., seed*2.3))-.5)*.14*rough + (vnoise(vec2(w*70., 5.))-.5)*.016*rough;\n  float e = s - (mix(-span, span, progress) + j);\n  float rim = .010 + .014*vnoise(vec2(w*90., 9.));\n  vec3 to = getTo(uv).rgb*(1.-.4*exp(min(e,0.)*35.));\n  vec3 col = mix(paperTone(uv), getFrom(uv).rgb, smoothstep(rim-.002, rim+.002, e));\n  col = mix(to, col, smoothstep(-.002, .002, e));\n  return vec4(col,1.);\n}\n"
 },
 {
  "id": "tr-torn_paper_split",
  "kind": "transition",
  "name": {
   "tw": "雙邊撕紙打開",
   "cn": "双边撕纸打开",
   "en": "Paper tear open"
  },
  "cats": [
   "effects-new",
   "effects-split"
  ],
  "params": {
   "rough": 1.0
  },
  "ease": "inout",
  "body": "// 名称: 雙邊撕紙打開\n// 对标: 撕纸开幕、中间撕开\n// 融合: 正中竖向撕开＋左右两片往外拉开（撕口吻合）＋两片纤维白边＋中缝投影\nuniform float rough; // = 1.0 撕口粗糙度\nvec4 transition(vec2 uv){\n  vec2 q = asp(uv);\n  float off = progress*(.5*ratio + .16);\n  float s0 = (fbm(vec2(q.y*5., seed*1.7))-.5)*.14*rough + (vnoise(vec2(q.y*70., 2.))-.5)*.016*rough;\n  float eL = s0 - (q.x + off), eR = (q.x - off) - s0;\n  float rL = .010 + .014*vnoise(vec2(q.y*90., 4.)), rR = .010 + .014*vnoise(vec2(q.y*90., 8.));\n  vec3 to = getTo(uv).rgb*(1.-.45*exp(-min(abs(eL),abs(eR))*30.)*step(eL,0.)*step(eR,0.));\n  vec3 L = mix(paperTone(uv), getFrom(unasp(vec2(q.x+off, q.y))).rgb, smoothstep(rL-.002, rL+.002, eL));\n  vec3 R = mix(paperTone(uv+.37), getFrom(unasp(vec2(q.x-off, q.y))).rgb, smoothstep(rR-.002, rR+.002, eR));\n  vec3 col = mix(to, L, smoothstep(-.002, .002, eL));\n  col = mix(col, R, smoothstep(-.002, .002, eR));\n  return vec4(col,1.);\n}\n"
 },
 {
  "id": "tr-torn_paper_v",
  "kind": "transition",
  "name": {
   "tw": "直向撕紙揭露",
   "cn": "直向撕纸揭露",
   "en": "Torn paper reveal"
  },
  "cats": [
   "effects-slides",
   "effects-new"
  ],
  "params": {
   "rough": 1.0
  },
  "ease": "inout",
  "body": "// 名称: 直向撕紙揭露\n// 对标: 撕纸、纸张撕开、拼贴转场\n// 融合: 竖向锯齿撕口由左往右扫＋撕口白纸纤维边＋新画面边缘投影\nuniform float rough; // = 1.0 撕口粗糙度\nvec4 transition(vec2 uv){\n  vec2 q = asp(uv);\n  float span = .5*ratio + .14;\n  float j = (fbm(vec2(q.y*5., seed*3.1))-.5)*.14*rough + (vnoise(vec2(q.y*70., 7.))-.5)*.016*rough;\n  float e = q.x - (mix(-span, span, progress) + j);\n  float rim = .010 + .014*vnoise(vec2(q.y*90., 3.));\n  vec3 to = getTo(uv).rgb*(1.-.4*exp(min(e,0.)*35.));\n  vec3 col = mix(paperTone(uv), getFrom(uv).rgb, smoothstep(rim-.002, rim+.002, e));\n  col = mix(to, col, smoothstep(-.002, .002, e));\n  return vec4(col,1.);\n}\n"
 },
 {
  "id": "tr-whip",
  "kind": "transition",
  "name": {
   "tw": "甩鏡",
   "cn": "甩镜",
   "en": "Whip pan"
  },
  "cats": [
   "effects-hot",
   "effects-camera",
   "effects-blur",
   "effects-new",
   "effects-shoot"
  ],
  "params": {
   "dir": 0.0
  },
  "ease": "inout",
  "body": "// 名称: 甩镜\n// 对标: 运镜类、快速翻转、移位缩放\n// 融合: 横甩＋强拉丝模糊＋中段轻微放大与提亮\nuniform float dir; // = 0 0向左甩 1向右甩\nvec4 transition(vec2 uv){\n  float p = progress; float v = sin(p*PI);\n  vec2 d = dir<.5 ? vec2(1,0) : vec2(-1,0);\n  vec2 c = vec2(.5);\n  vec2 q = zoomAt(uv, c, 1.+.12*v) + d*p;\n  vec2 bl = d*(.45*v*v + .02);\n  bool inA = d.x>0. ? q.x<1. : q.x>0.;\n  vec3 col = inA ? dirBlur(0,q,bl).rgb : dirBlur(1,q-d,bl).rgb;\n  col *= 1.+.25*v*v;\n  return vec4(col,1.);\n}\n"
 },
 {
  "id": "fx-analog_print",
  "kind": "effect",
  "name": {
   "tw": "精緻類比印刷",
   "cn": "精致模拟印刷",
   "en": "Analog print"
  },
  "cats": [
   "scene-mood",
   "scene-retro"
  ],
  "params": {},
  "ease": "inout",
  "body": "// 名称: 精緻類比印刷\n// 对标: 印刷质感、复古海报、Risograph\n// 融合: 微小套色偏移＋墨色略收饱和＋暖纸底与纸纹＋细颗粒\nvec4 effect(vec2 uv){\n  vec3 base = getTex(uv).rgb;\n  float s = .0025*amount;\n  vec3 col = vec3(getTex(uv + vec2(s, .5*s)).r, base.g, getTex(uv - vec2(.5*s, s)).b);\n  col = pow(col, vec3(1.08));\n  col = mix(vec3(luma(col)), col, .85);\n  col = col*vec3(1., .97, .9) + vec3(.04, .035, .02);\n  col *= .93 + .1*fbm(uv*vec2(ratio,1.)*140.);\n  col += (hash21(uv*res + floor(time*12.)) - .5)*.05;\n  return vec4(mix(base, col, amount),1.);\n}\n"
 },
 {
  "id": "fx-blur",
  "kind": "effect",
  "name": {
   "tw": "模糊",
   "cn": "模糊",
   "en": "Blur"
  },
  "cats": [
   "scene-basic"
  ],
  "params": {
   "mode": 0.0,
   "radius": 0.03
  },
  "ease": "inout",
  "body": "// 名称: 模糊\n// 对标: 超模糊、基本模糊、横向模糊、十字模糊、毛玻璃、表面模糊\n// 融合: 一支四种模式：0 柔焦 1 横向 2 十字星芒 3 毛玻璃\nuniform float mode; // = 0 模式\nuniform float radius; // = 0.03 模糊半径\nvec4 effect(vec2 uv){\n  float r = radius*amount;\n  vec3 col;\n  if(mode < .5) col = softBlur(2, uv, r).rgb;\n  else if(mode < 1.5) col = dirBlur(2, uv, vec2(r*3./ratio, 0.)).rgb;\n  else if(mode < 2.5){ vec3 base = getTex(uv).rgb; vec3 h = dirBlur(2, uv, vec2(r*4./ratio,0.)).rgb, v = dirBlur(2, uv, vec2(0.,r*4.)).rgb;\n    col = base + (max(h,v)-base)*.8 + max(vec3(0.), max(h,v)-.6)*1.2*amount; }\n  else { vec2 j = (hash22(floor(uv*res/2.))-.5)*r*1.5; col = softBlur(2, uv+j, r*.4).rgb*1.05 + .04*amount; }\n  return vec4(col,1.);\n}\n"
 },
 {
  "id": "fx-blur_snap",
  "kind": "effect",
  "name": {
   "tw": "模糊清晰彈回",
   "cn": "模糊清晰弹回",
   "en": "Blur snap"
  },
  "cats": [
   "scene-hot",
   "scene-basic",
   "scene-dynamic"
  ],
  "params": {},
  "ease": "inout",
  "body": "// 名称: 模糊清晰彈回\n// 对标: 失焦对焦、模糊弹入、对焦回弹\n// 融合: 开头大虚焦＋微放大提亮 ⇒ 一下收清晰＋回弹一点点\nvec4 effect(vec2 uv){\n  float k = clamp(progress, 0., 1.);\n  float bl = pow(1. - smoothstep(0., .45, k), 2.)*amount;\n  float z = 1. + amount*(.08*(1. - smoothstep(0., .45, k)) - .025*sin(clamp((k-.45)/.4, 0., 1.)*PI));\n  vec3 col = softBlur(2, zoomAt(uv, vec2(.5), z), .03*bl).rgb;\n  col = mix(col, col*1.08 + .03, bl);\n  return vec4(col,1.);\n}\n"
 },
 {
  "id": "fx-cmyk_offset",
  "kind": "effect",
  "name": {
   "tw": "CMYK 錯位",
   "cn": "CMYK 错位",
   "en": "CMYK offset"
  },
  "cats": [
   "scene-cool",
   "scene-retro"
  ],
  "params": {
   "shift": 1.0,
   "cells": 110.0
  },
  "ease": "inout",
  "body": "// 名称: CMYK 錯位\n// 对标: 印刷错版、四色网点、套色不准\n// 融合: 青洋红黄三版各自错开（随时间轻晃）＋四色各自网角网点＋纸底\nuniform float shift; // = 1.0 错位量\nuniform float cells; // = 110 网点密度\nvec4 effect(vec2 uv){\n  vec3 base = getTex(uv).rgb;\n  float s = .007*shift*amount*(1. + .4*sin(time*3.));\n  float C = 1. - getTex(uv + vec2(s, 0.)).r, M = 1. - getTex(uv + vec2(-.5*s, s)).g, Y = 1. - getTex(uv + vec2(0., -s)).b;\n  float K = min(min(1.-base.r, 1.-base.g), 1.-base.b)*.6;\n  float hc = 1. - halftone(uv, 1.-C, cells, radians(15.)), hm = 1. - halftone(uv, 1.-M, cells, radians(75.));\n  float hy = 1. - halftone(uv, 1.-Y, cells, 0.), hk = 1. - halftone(uv, 1.-K, cells, radians(45.));\n  vec3 col = paperTone(uv)*(1. - .92*vec3(hc, hm, hy))*(1. - .85*hk);\n  return vec4(mix(base, col, amount),1.);\n}\n"
 },
 {
  "id": "fx-cyber_pulse",
  "kind": "effect",
  "name": {
   "tw": "賽博脈衝",
   "cn": "赛博脉冲",
   "en": "Cyber pulse"
  },
  "cats": [
   "scene-cool"
  ],
  "params": {
   "bpm": 120.0
  },
  "ease": "inout",
  "body": "// 名称: 赛博脉冲\n// 对标: 蓝色赛博脉冲、紫色赛博脉冲、宠物赛博疾驰\n// 融合: 按拍子的青紫色差＋边缘霓虹描光＋扫描线\nuniform float bpm; // = 120 拍速\nvec4 effect(vec2 uv){\n  float ph = fract(time*bpm/60.); float k = exp(-ph*5.)*amount;\n  vec3 col = rgbSplit(2, uv, vec2(.012*k, 0.));\n  vec2 px = 1./res;\n  float e = length(vec2(luma(getTex(uv+vec2(px.x,0.)).rgb)-luma(getTex(uv-vec2(px.x,0.)).rgb),\n                        luma(getTex(uv+vec2(0.,px.y)).rgb)-luma(getTex(uv-vec2(0.,px.y)).rgb)));\n  vec3 neon = mix(vec3(0.,.9,1.), vec3(1.,.2,.9), uv.x);\n  col += neon*smoothstep(.05,.3,e)*(.35+k)*amount;\n  col = mix(col, col*vec3(.85,.95,1.15), amount*.6);\n  col *= 1.-.1*amount*step(.5,fract(uv.y*res.y/3.));\n  return vec4(col,1.);\n}\n"
 },
 {
  "id": "fx-echo",
  "kind": "effect",
  "name": {
   "tw": "殘影",
   "cn": "残影",
   "en": "Echo"
  },
  "cats": [
   "scene-dynamic"
  ],
  "params": {
   "trail": 0.75
  },
  "ease": "inout",
  "body": "// 名称: 残影\n// 对标: 残影 02、闪光回声、宠物幻影放大\n// 融合: 前几帧叠成拖影＋拖影偏色发光\nuniform float trail; // = 0.75 拖影浓度\nvec4 effect(vec2 uv){\n  vec3 c0 = getTex(uv).rgb;\n  vec3 acc = c0; float w = 1.;\n  for(int k=1;k<=4;k++){ float wk = pow(trail, float(k)); vec3 ck = getPrev(uv,k).rgb; acc += ck*wk; w += wk; }\n  vec3 tr = acc/w;\n  tr = screen(tr, (tr-c0)*vec3(.4,.6,1.)*1.5);\n  return vec4(mix(c0, max(c0, tr), amount),1.);\n}\n"
 },
 {
  "id": "fx-glitch",
  "kind": "effect",
  "name": {
   "tw": "閃爍故障",
   "cn": "闪烁故障",
   "en": "Glitch"
  },
  "cats": [
   "scene-hot",
   "scene-cool"
  ],
  "params": {
   "power": 1.0,
   "rate": 0.35
  },
  "ease": "inout",
  "body": "// 名称: 闪烁故障\n// 对标: 闪烁故障、扭曲故障、播放毛刺、Distortion\n// 融合: 间歇爆发的横条错位＋RGB 分离＋块状色偏＋扫描线\nuniform float power; // = 1.0 故障强度\nuniform float rate; // = 0.35 爆发频率 0~1\nvec4 effect(vec2 uv){\n  float t = floor(time*20.)+seed*31.;\n  float burst = step(1.-rate, hash11(floor(time*6.)+seed)) * amount * power;\n  float k = burst*(.5+.5*hash11(t));\n  vec2 q = uv;\n  float row = floor(uv.y*mix(10.,50.,hash11(t+2.)));\n  if(hash21(vec2(row,t)) > 1.-k*.6) q.x += (hash21(vec2(row,t+5.))-.5)*.18*k;\n  vec2 blk = floor(uv*vec2(16.,9.));\n  vec3 col = rgbSplit(2, q, vec2(.02*k, 0.));\n  if(hash21(blk+t) > 1.-k*.12) col = col.brg;\n  col *= 1. - .12*k*step(.5, fract(uv.y*res.y/2.));\n  return vec4(col,1.);\n}\n"
 },
 {
  "id": "fx-glow",
  "kind": "effect",
  "name": {
   "tw": "柔光輝光",
   "cn": "柔光辉光",
   "en": "Soft glow"
  },
  "cats": [
   "scene-mood",
   "scene-light"
  ],
  "params": {
   "power": 1.0,
   "thresh": 0.6
  },
  "ease": "inout",
  "body": "// 名称: 柔光辉光\n// 对标: Glow、柔化、光滑 02、自动增强\n// 融合: 亮部提取泛光＋整体柔焦叠加＋轻提对比\nuniform float power; // = 1.0 辉光强度\nuniform float thresh; // = 0.6 多亮才发光\nvec4 effect(vec2 uv){\n  vec3 base = getTex(uv).rgb;\n  vec3 bl = softBlur(2, uv, .035).rgb;\n  vec3 bloom = max(bl - thresh, 0.)/(1.-thresh);\n  vec3 col = screen(base, bloom*power*amount*1.2);\n  col = mix(col, screen(col, bl*.25), amount*.5);\n  col = mix(col, smoothstep(0.,1.,col), amount*.3);\n  return vec4(col,1.);\n}\n"
 },
 {
  "id": "fx-ink_monochrome",
  "kind": "effect",
  "name": {
   "tw": "水墨單色",
   "cn": "水墨单色",
   "en": "Ink monochrome"
  },
  "cats": [
   "scene-mood",
   "scene-retro"
  ],
  "params": {},
  "ease": "inout",
  "body": "// 名称: 水墨單色\n// 对标: 水墨、国风黑白、墨染\n// 融合: 亮度转墨色浓淡＋轮廓勾墨线＋墨晕不均＋宣纸底色\nvec4 effect(vec2 uv){\n  vec3 base = getTex(uv).rgb;\n  vec2 px = 1.5/res;\n  float l = luma(softBlur(2, uv, .002).rgb);\n  float e = abs(luma(getTex(uv+vec2(px.x,0.)).rgb) - luma(getTex(uv-vec2(px.x,0.)).rgb))\n          + abs(luma(getTex(uv+vec2(0.,px.y)).rgb) - luma(getTex(uv-vec2(0.,px.y)).rgb));\n  float bleed = fbm(uv*vec2(ratio,1.)*7.);\n  float tone = clamp(smoothstep(.12, .85, l) + (bleed-.5)*.3 - e*2.2, 0., 1.);\n  vec3 col = mix(vec3(.06,.07,.08), paperTone(uv)*vec3(1.,.98,.93), tone);\n  return vec4(mix(base, col, amount),1.);\n}\n"
 },
 {
  "id": "fx-ken_burns",
  "kind": "effect",
  "name": {
   "tw": "慢推運鏡",
   "cn": "慢推运镜",
   "en": "Slow push-in"
  },
  "cats": [
   "scene-basic"
  ],
  "params": {
   "zoom": 0.15,
   "panx": 0.04,
   "pany": -0.02
  },
  "ease": "inout",
  "body": "// 名称: 慢推运镜\n// 对标: 慢速缩放、平滑放大、滚动缩放\n// 融合: 匀速推近＋同时缓慢平移（静态图也能有镜头感）\nuniform float zoom; // = 0.15 推近量\nuniform float panx; // = 0.04 横向平移\nuniform float pany; // = -0.02 纵向平移\nvec4 effect(vec2 uv){\n  float p = smoothstep(0.,1.,progress);\n  vec2 c = vec2(.5)+vec2(panx,pany)*p;\n  return getTex(zoomAt(uv, c, 1.+zoom*p));\n}\n"
 },
 {
  "id": "fx-letterbox",
  "kind": "effect",
  "name": {
   "tw": "電影寬銀幕",
   "cn": "电影宽银幕",
   "en": "Cinema bars"
  },
  "cats": [
   "scene-basic",
   "scene-border"
  ],
  "params": {
   "aspect": 2.39
  },
  "ease": "inout",
  "body": "// 名称: 电影宽银幕\n// 对标: 影院风、电影开场 04、开幕\n// 融合: 上下黑边滑入成 2.39:1＋轻微青橙电影调\nuniform float aspect; // = 2.39 目标画幅\nvec4 effect(vec2 uv){\n  float target = ratio/aspect;\n  float bar = (1.-target)*.5*amount;\n  vec3 col = getTex(uv).rgb;\n  float l = luma(col);\n  col = mix(col, col*mix(vec3(.9,1.,1.12), vec3(1.12,1.,.88), smoothstep(.2,.8,l)), amount*.7);\n  col *= step(bar, uv.y)*step(uv.y, 1.-bar);\n  return vec4(col,1.);\n}\n"
 },
 {
  "id": "fx-light_leak",
  "kind": "effect",
  "name": {
   "tw": "漏光",
   "cn": "漏光",
   "en": "Light leak"
  },
  "cats": [
   "scene-hot",
   "scene-mood",
   "scene-light",
   "scene-retro"
  ],
  "params": {
   "power": 0.8
  },
  "ease": "inout",
  "body": "// 名称: 漏光\n// 对标: Cool Film、胶片擦除、Four Seasons 的暖光\n// 融合: 程序生成的暖色流动漏光＋整体微提亮\nuniform float power; // = 0.8 漏光强度\nvec4 effect(vec2 uv){\n  vec3 base = getTex(uv).rgb;\n  vec3 l = lightLeak(uv*vec2(1.,.8), time*.5+seed);\n  vec3 col = screen(base, l*power*amount);\n  return vec4(col + .03*amount,1.);\n}\n"
 },
 {
  "id": "fx-mono_halftone",
  "kind": "effect",
  "name": {
   "tw": "黑白網點",
   "cn": "黑白网点",
   "en": "Mono halftone"
  },
  "cats": [
   "scene-cool",
   "scene-retro"
  ],
  "params": {
   "cells": 90.0,
   "angle": 45.0
  },
  "ease": "inout",
  "body": "// 名称: 黑白網點\n// 对标: 漫画网点、报纸印刷、黑白波普\n// 融合: 提对比后转黑白网点（45° 网角）＋米白纸底\nuniform float cells; // = 90 网点密度\nuniform float angle; // = 45 网角（度）\nvec4 effect(vec2 uv){\n  vec3 base = getTex(uv).rgb;\n  float l = clamp((luma(base)-.5)*1.25 + .5, 0., 1.);\n  vec3 ink = mix(vec3(.07,.07,.08), paperTone(uv), halftone(uv, l, cells, radians(angle)));\n  return vec4(mix(base, ink, amount),1.);\n}\n"
 },
 {
  "id": "fx-mosaic",
  "kind": "effect",
  "name": {
   "tw": "馬賽克",
   "cn": "马赛克",
   "en": "Mosaic"
  },
  "cats": [
   "scene-basic"
  ],
  "params": {
   "cells": 40.0,
   "cx": 0.5,
   "cy": 0.5,
   "rw": 2.0,
   "rh": 2.0
  },
  "ease": "inout",
  "body": "// 名称: 马赛克\n// 对标: 经典马赛克、动态马赛克、局部马赛克、Mosaic\n// 融合: 方格马赛克＋可框局部（打码）＋框边柔化\nuniform float cells; // = 40 横向格数（越小越粗）\nuniform float cx; // = 0.5 区域中心 x\nuniform float cy; // = 0.5 区域中心 y\nuniform float rw; // = 2 区域宽（≥1 即全画面）\nuniform float rh; // = 2 区域高\nvec4 effect(vec2 uv){\n  vec2 g = vec2(cells, cells/ratio);\n  vec2 q = (floor(uv*g)+.5)/g;\n  vec2 d = abs(uv-vec2(cx,cy)) - vec2(rw,rh)*.5;\n  float inside = 1.-smoothstep(0., .01, max(d.x,d.y));\n  return vec4(mix(getTex(uv).rgb, getTex(q).rgb, inside*amount),1.);\n}\n"
 },
 {
  "id": "fx-old_film",
  "kind": "effect",
  "name": {
   "tw": "老電影",
   "cn": "老电影",
   "en": "Old film"
  },
  "cats": [
   "scene-hot",
   "scene-retro"
  ],
  "params": {
   "sepia": 0.8
  },
  "ease": "inout",
  "body": "// 名称: 老电影\n// 对标: 老电影、胶片颗粒、黄金时代、复古\n// 融合: 褪色暖调＋颗粒＋划痕＋亮度闪烁＋片门晃动＋暗角\nuniform float sepia; // = 0.8 褪色程度\nvec4 effect(vec2 uv){\n  float a = amount;\n  float tf = floor(time*24.);\n  vec2 q = uv + vec2(0., (hash11(tf)-.5)*.004*a);\n  vec3 col = getTex(q).rgb;\n  float l = luma(col);\n  vec3 sep = vec3(l*1.07+.04, l*.95+.02, l*.78);\n  col = mix(col, sep, sepia*a);\n  col *= 1. + (hash11(tf+3.)-.5)*.12*a;\n  col += (hash21(uv*res+tf)-.5)*.14*a;\n  float sx = hash11(tf+9.);\n  col = mix(col, col*.55, a*step(.6,hash11(tf+11.))*exp(-pow((uv.x-sx)*res.x/1.5,2.)));\n  float v = length(asp(uv)); col *= mix(1., smoothstep(1.05,.35,v), a);\n  return vec4(col,1.);\n}\n"
 },
 {
  "id": "fx-prism_glint",
  "kind": "effect",
  "name": {
   "tw": "稜鏡掠光",
   "cn": "棱镜掠光",
   "en": "Prism glint"
  },
  "cats": [
   "scene-mood",
   "scene-light"
  ],
  "params": {
   "angle": 25.0
  },
  "ease": "inout",
  "body": "// 名称: 稜鏡掠光\n// 对标: 棱镜光、彩虹漏光、镜头掠光\n// 融合: 斜向彩虹光带扫过＋中心细白芯＋后面一道淡彩虹残影\nuniform float angle; // = 25 光带角度（度）\nvec4 effect(vec2 uv){\n  vec3 base = getTex(uv).rgb;\n  float a = radians(angle); vec2 n = vec2(cos(a), sin(a));\n  float span = .5*(abs(n.x)*ratio + abs(n.y)) + .45;\n  float s = dot(asp(uv), n) - mix(-span, span, progress);\n  vec3 light = spectrum(s/.24 + .5)*exp(-s*s/.0144)*.9 + vec3(1.)*exp(-s*s/.0004)*.6;\n  float s2 = s + .35;\n  light += spectrum(s2/.16 + .5)*exp(-s2*s2/.0064)*.35;\n  return vec4(screen(base, light*amount),1.);\n}\n"
 },
 {
  "id": "fx-rgb_split",
  "kind": "effect",
  "name": {
   "tw": "色差",
   "cn": "色差",
   "en": "RGB split"
  },
  "cats": [
   "scene-hot",
   "scene-cool"
  ],
  "params": {
   "power": 1.0
  },
  "ease": "inout",
  "body": "// 名称: 色差\n// 对标: Chromatic Aberration、黑白RGB、宠物 RGB 轮廓\n// 融合: 由中心向外的径向色散＋边缘略模糊\nuniform float power; // = 1.0 色散量\nvec4 effect(vec2 uv){\n  vec2 d = uv-.5; float r = length(d);\n  vec2 off = d*r*.06*power*amount;\n  return vec4(rgbSplit(2, uv, off),1.);\n}\n"
 },
 {
  "id": "fx-scan",
  "kind": "effect",
  "name": {
   "tw": "全息掃描",
   "cn": "全息扫描",
   "en": "Hologram scan"
  },
  "cats": [
   "scene-cool"
  ],
  "params": {
   "r": 0.2,
   "g": 0.9,
   "b": 1.0
  },
  "ease": "inout",
  "body": "// 名称: 全息扫描\n// 对标: 射线扫描 04、宠物全息扫描、宠物扫描、蓝色矩阵扫描\n// 融合: 扫描光带由上往下＋扫过处网格与青色调＋细扫描线\nuniform float r; // = 0.2 色 R\nuniform float g; // = 0.9 色 G\nuniform float b; // = 1.0 色 B\nvec4 effect(vec2 uv){\n  vec3 base = getTex(uv).rgb;\n  vec3 tint = vec3(r,g,b);\n  float y = fract(progress*1.2 - .1);\n  float dist = uv.y - y;\n  float band = exp(-dist*dist*900.);\n  float trailM = smoothstep(-.25, 0., dist)*step(dist, 0.);\n  vec2 gp = fract(uv*vec2(ratio,1.)*24.);\n  float grid = max(step(.95, gp.x), step(.95, gp.y));\n  vec3 holo = mix(base, tint*luma(base)*1.6, .6) + tint*grid*.35;\n  vec3 col = mix(base, holo, trailM*amount);\n  col += tint*band*1.4*amount;\n  col *= 1. - .08*amount*step(.5, fract(uv.y*res.y/3.));\n  return vec4(col,1.);\n}\n"
 },
 {
  "id": "fx-scanline_focus",
  "kind": "effect",
  "name": {
   "tw": "掃描聚焦",
   "cn": "扫描聚焦",
   "en": "Scanline focus"
  },
  "cats": [
   "scene-basic",
   "scene-cool"
  ],
  "params": {
   "band": 0.2
  },
  "ease": "inout",
  "body": "// 名称: 掃描聚焦\n// 对标: 扫描对焦、扫描光带、焦点扫描\n// 融合: 一道清晰光带由上往下扫＋带外模糊压暗加扫描线＋带边发冷光\nuniform float band; // = 0.2 清晰带宽\nvec4 effect(vec2 uv){\n  vec3 base = getTex(uv).rgb;\n  float y = mix(-.15, 1.15, progress);\n  float d = abs(uv.y - y);\n  float f = smoothstep(band*.5, band*.5 + .1, d)*amount;\n  vec3 bl = softBlur(2, uv, .014*f).rgb;\n  vec3 col = mix(base, bl*.72, f);\n  col *= 1. - .12*f*step(.5, fract(uv.y*res.y/3.));\n  col += vec3(.55,.9,1.)*exp(-pow((d - band*.5)/.004, 2.))*.5*amount;\n  return vec4(col,1.);\n}\n"
 },
 {
  "id": "fx-shake",
  "kind": "effect",
  "name": {
   "tw": "手持晃動",
   "cn": "手持晃动",
   "en": "Handheld shake"
  },
  "cats": [
   "scene-hot",
   "scene-dynamic"
  ],
  "params": {
   "power": 1.0,
   "speed": 1.0
  },
  "ease": "inout",
  "body": "// 名称: 手持晃动\n// 对标: 轻微晃动、镜头抖动类、运动曝光抖动\n// 融合: 平滑噪声位移＋微转动＋略放大藏边\nuniform float power; // = 1.0 晃动幅度\nuniform float speed; // = 1.0 晃动快慢\nvec4 effect(vec2 uv){\n  float t = time*speed*3.;\n  vec2 o = vec2(vnoise(vec2(t,1.3))-.5, vnoise(vec2(2.7,t))-.5)*.035*power*amount;\n  float a = (vnoise(vec2(t*.7,9.1))-.5)*.03*power*amount;\n  vec2 q = unasp(rot(asp(uv), a)/(1.+.05*power*amount)) + o;\n  return getTex(q);\n}\n"
 },
 {
  "id": "fx-shockwave",
  "kind": "effect",
  "name": {
   "tw": "衝擊波",
   "cn": "冲击波",
   "en": "Shockwave"
  },
  "cats": [
   "scene-dynamic",
   "scene-light"
  ],
  "params": {
   "cx": 0.5,
   "cy": 0.5,
   "power": 1.0
  },
  "ease": "inout",
  "body": "// 名称: 冲击波\n// 对标: 冲击波、心脏开放运动、呐喊声波\n// 融合: 环形折射波由中心扩散＋波前色散＋亮边\nuniform float cx; // = 0.5 波心 x\nuniform float cy; // = 0.5 波心 y\nuniform float power; // = 1.0 扭曲强度\nvec4 effect(vec2 uv){\n  vec2 c = vec2(cx,cy);\n  vec2 d = (uv-c)*vec2(ratio,1.); float r = length(d);\n  float R = progress*1.4; float w = .09;\n  float x = (r-R)/w;\n  float ring = exp(-x*x*3.)*amount*power;\n  vec2 n = r>0. ? d/r : vec2(0.);\n  vec2 off = n*sin(x*3.)*.04*ring/vec2(ratio,1.);\n  vec3 col = vec3(getTex(uv-off*1.2).r, getTex(uv-off).g, getTex(uv-off*.8).b);\n  col += ring*.15;\n  return vec4(col,1.);\n}\n"
 },
 {
  "id": "fx-soft_bloom",
  "kind": "effect",
  "name": {
   "tw": "柔光",
   "cn": "柔光",
   "en": "Soft bloom"
  },
  "cats": [
   "scene-mood",
   "scene-light"
  ],
  "params": {
   "sigma": 0.0208,
   "mixk": 0.3,
   "lift": 0.03
  },
  "ease": "none",
  "body": "// 名称: 柔光\n// 对标: 回忆快闪原片（情侣回忆-15场景）那层柔光：亮部微微发光、暗部轻轻提亮\n// 融合: 画面高斯模糊（σ≈画高 2%）以滤色叠回 30%，再把暗部提亮 3%（强度 1＝原片）\n// 缓动: none\nuniform float sigma; // = 0.0208 模糊半径（占画高）\nuniform float mixk; // = 0.3 模糊那层叠回多少\nuniform float lift; // = 0.03 暗部提亮\nvec4 effect(vec2 uv){\n  vec3 base = getTex(uv).rgb;\n  // 13×13 格高斯（间距 σ/3·涵盖 ±2σ）\n  vec3 acc = vec3(0.); float tot = 0.;\n  for(int j=-6;j<=6;j++){\n    for(int i=-6;i<=6;i++){\n      vec2 d = vec2(float(i), float(j)) * (sigma/3.);\n      float wt = exp(-dot(d,d)/(2.*sigma*sigma));\n      acc += getTex(clamp(uv + vec2(d.x/ratio, d.y), 0., 1.)).rgb * wt;\n      tot += wt;\n    }\n  }\n  vec3 b = acc / tot;\n  float a = amount;\n  vec3 col = 1. - (1. - base) * (1. - b * mixk * a);\n  col = col * (1. - lift * a) + lift * a;\n  return vec4(col, 1.);\n}\n"
 },
 {
  "id": "fx-sparkle",
  "kind": "effect",
  "name": {
   "tw": "星光迸發",
   "cn": "星光迸发",
   "en": "Sparkle burst"
  },
  "cats": [
   "scene-hot",
   "scene-mood",
   "scene-light"
  ],
  "params": {
   "density": 1.0,
   "size": 1.8
  },
  "ease": "inout",
  "body": "// 名称: 星光迸发\n// 对标: 星光迸发、闪耀粒子、萌宠星光闪闪、金粉飘动\n// 融合: 亮部生成十字星芒＋随机闪烁＋缓慢上飘\nuniform float density; // = 1.0 星星多少\nuniform float size; // = 1.8 星星大小\nvec4 effect(vec2 uv){\n  vec3 base = getTex(uv).rgb;\n  vec3 add = vec3(0.);\n  for(int L=0; L<2; L++){\n    float sc = (L==0 ? 14. : 26.)*density;\n    vec2 p = uv*vec2(ratio,1.)*sc + vec2(0., time*(L==0?.6:1.1));\n    vec2 id = floor(p); vec2 f = fract(p)-.5;\n    float h = hash21(id+float(L)*7.);\n    if(h > (L==0 ? .78 : .86)){\n      vec2 o = (hash22(id)-.5)*.6; vec2 d = f-o;\n      vec2 cuv = (id+.5+o - vec2(0., time*(L==0?.6:1.1)))/sc/vec2(ratio,1.);\n      float lit = smoothstep(.45,.8, luma(getTex(cuv).rgb)) *.8 + .2;\n      float tw = pow(.5+.5*sin(time*6.+h*40.), 3.);\n      float s = size*(L==0 ? 1. : .6)*sc;        // 尺寸按画面高度比例换成格单位\n      float core = exp(-dot(d,d)/pow(.006*s,2.));\n      float rays = exp(-abs(d.y)/(.0015*s))*exp(-abs(d.x)/(.03*s)) + exp(-abs(d.x)/(.0015*s))*exp(-abs(d.y)/(.03*s));\n      float star = core*1.5 + rays;\n      add += vec3(1.,.92,.7)*min(star,3.)*tw*lit;\n    }\n  }\n  return vec4(base + add*amount,1.);\n}\n"
 },
 {
  "id": "fx-tv_wall",
  "kind": "effect",
  "name": {
   "tw": "電視牆",
   "cn": "电视墙",
   "en": "TV wall"
  },
  "cats": [
   "scene-border",
   "scene-multi",
   "scene-retro"
  ],
  "params": {
   "n": 3.0
  },
  "ease": "inout",
  "body": "// 名称: 电视墙\n// 对标: TVwall、分屏、宠物分身\n// 融合: 画面复制成 N×N 格＋格间细缝＋随机一格闪白\nuniform float n; // = 3 每行几格\nvec4 effect(vec2 uv){\n  float k = mix(1., n, step(.01, amount));\n  vec2 g = uv*k; vec2 id = floor(g); vec2 f = fract(g);\n  vec3 col = getTex(f).rgb;\n  float gap = .015*k;\n  float m = step(gap, f.x)*step(f.x, 1.-gap)*step(gap*ratio, f.y)*step(f.y, 1.-gap*ratio);\n  col *= mix(1., m, step(1.5,k));\n  col += step(.85, hash21(id+floor(time*4.)))*.25*step(1.5,k);\n  return vec4(mix(getTex(uv).rgb, col, step(.01,amount)),1.);\n}\n"
 },
 {
  "id": "fx-vhs",
  "kind": "effect",
  "name": {
   "tw": "錄影帶",
   "cn": "录像带",
   "en": "VHS"
  },
  "cats": [
   "scene-hot",
   "scene-retro"
  ],
  "params": {},
  "ease": "inout",
  "body": "// 名称: 录像带\n// 对标: Radio Explike FX、播放毛刺、复古、TVwall 的旧屏感\n// 融合: 色度渗色＋跟踪噪声带＋扫描线＋轻微桶形\nvec4 effect(vec2 uv){\n  float a = amount;\n  vec2 q = uv; vec2 c = q-.5; q = .5 + c*(1.+.06*a*dot(c,c));\n  float bandY = fract(time*.13+seed*.3);\n  float band = exp(-pow((uv.y-bandY)*25.,2.));\n  q.x += (hash11(floor(uv.y*res.y/2.)+floor(time*30.))-.5)*.03*band*a;\n  q.x += sin(uv.y*80.+time*10.)*.0015*a;\n  vec3 col;\n  col.r = softBlur(2, q+vec2(.004*a,0.), .004*a).r;\n  col.g = getTex(q).g;\n  col.b = softBlur(2, q-vec2(.004*a,0.), .006*a).b;\n  col = mix(col, col*vec3(1.05,.98,1.08)+.03, a);\n  col += band*.18*a*hash21(uv*res+time);\n  col *= 1. - .15*a*step(.5, fract(uv.y*res.y/4.));\n  if(q.x<0.||q.x>1.||q.y<0.||q.y>1.) col = vec3(0.);\n  return vec4(col,1.);\n}\n"
 },
 {
  "id": "fx-vignette",
  "kind": "effect",
  "name": {
   "tw": "暗角",
   "cn": "暗角",
   "en": "Vignette"
  },
  "cats": [
   "scene-basic",
   "scene-mood"
  ],
  "params": {
   "power": 0.8,
   "breathe": 0.0
  },
  "ease": "inout",
  "body": "// 名称: 暗角\n// 对标: 黑色暗角、边框\n// 融合: 椭圆暗角＋可调柔边，可随拍子轻微呼吸\nuniform float power; // = 0.8 暗角深度\nuniform float breathe; // = 0 呼吸幅度 0~1\nvec4 effect(vec2 uv){\n  float b = 1.+breathe*.08*sin(time*6.);\n  float v = length((uv-.5)*vec2(1.,1.))*1.35*b;\n  float m = mix(1., smoothstep(1.,.25,v), power*amount);\n  return vec4(getTex(uv).rgb*m,1.);\n}\n"
 },
 {
  "id": "fx-washi_paper",
  "kind": "effect",
  "name": {
   "tw": "日系和紙柔質",
   "cn": "日系和纸柔质",
   "en": "Washi paper"
  },
  "cats": [
   "scene-mood",
   "scene-retro"
  ],
  "params": {},
  "ease": "inout",
  "body": "// 名称: 日系和紙柔質\n// 对标: 日系胶片、和纸、柔雾低反差\n// 融合: 轻柔焦＋降饱和低反差暖调＋和纸云纹与纤维\nvec4 effect(vec2 uv){\n  vec3 base = getTex(uv).rgb;\n  vec3 c = softBlur(2, uv, .0025).rgb;\n  c = mix(vec3(luma(c)), c, .7);\n  c = c*.82 + vec3(.15, .14, .12);\n  vec2 p = uv*vec2(ratio,1.);\n  vec2 w = p + .015*vec2(fbm(p*6.), fbm(p*6. + 9.));\n  float f1 = smoothstep(.82, .97, vnoise(rot(w, .6)*vec2(160., 12.)));\n  float f2 = smoothstep(.84, .98, vnoise(rot(w, -1.1)*vec2(130., 10.) + 5.));\n  c = c*(.94 + .08*fbm(p*18.)) + (f1 + f2)*.03;\n  return vec4(mix(base, c, amount),1.);\n}\n"
 },
 {
  "id": "fx-xerox_pulse",
  "kind": "effect",
  "name": {
   "tw": "影印機脈衝",
   "cn": "复印机脉冲",
   "en": "Xerox pulse"
  },
  "cats": [
   "scene-hot",
   "scene-dynamic",
   "scene-retro"
  ],
  "params": {
   "bpm": 120.0
  },
  "ease": "inout",
  "body": "// 名称: 影印機脈衝\n// 对标: 影印质感、复印机、粗颗粒黑白\n// 融合: 高反差黑白＋碳粉颗粒阈值＋影印条纹＋按节拍闪亮抖一下\nuniform float bpm; // = 120 节拍\nvec4 effect(vec2 uv){\n  float beat = fract(time*bpm/60.), pulse = exp(-beat*6.);\n  float tf = floor(time*12.);\n  vec2 q = uv + vec2((hash11(tf)-.5)*.008*pulse, 0.);\n  vec3 base = getTex(uv).rgb;\n  float l = luma(getTex(q).rgb);\n  float n = vnoise(uv*res*.3 + tf)*.5 + hash21(uv*res + tf)*.5;\n  float th = .5 + (n-.5)*.3 - .1*pulse;\n  float b = smoothstep(th-.05, th+.05, l);\n  float streak = smoothstep(.93, 1., vnoise(vec2(uv.y*260., tf*.37)));\n  vec3 xer = mix(vec3(.06), vec3(.93,.93,.9), b) - streak*.25*b;\n  xer *= 1. + .25*pulse;\n  return vec4(mix(base, xer, amount),1.);\n}\n"
 },
 {
  "id": "fx-zoom_punch",
  "kind": "effect",
  "name": {
   "tw": "節拍衝焦",
   "cn": "节拍冲焦",
   "en": "Beat zoom"
  },
  "cats": [
   "scene-hot",
   "scene-dynamic"
  ],
  "params": {
   "bpm": 120.0,
   "power": 1.0
  },
  "ease": "inout",
  "body": "// 名称: 节拍冲焦\n// 对标: 快速变焦、跳入 02、运动快速变焦、运动心跳、缩放效果\n// 融合: 按拍子放大回弹＋径向模糊＋拍点微亮\nuniform float bpm; // = 120 每分钟拍数\nuniform float power; // = 1.0 冲击强度\nvec4 effect(vec2 uv){\n  float ph = fract(time*bpm/60.);\n  float k = exp(-ph*7.)*amount*power;\n  vec2 c = vec2(.5);\n  vec3 col = zoomBlur(2, zoomAt(uv, c, 1.+.12*k), c, .12*k).rgb;\n  col *= 1.+.18*k;\n  return vec4(col,1.);\n}\n"
 }
]

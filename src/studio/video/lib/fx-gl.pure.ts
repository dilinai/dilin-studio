// 剪辑页特效转场·把桌面 GLSL 330 着色器包成浏览器 WebGL2（#version 300 es）片段着色器。纯字串·题直接跑。
// 约定同fx.py：uniform progress／time／ratio／seed／amount·vec2 res·取色 getFrom／getTo／getTex／getPrev(uv,k)；uv 左上 (0,0)。
// 中间各道画进帧缓冲（纹理第 0 行＝画面顶·跟 uv 同向）；最后一道 copy 画到屏幕时上下翻一次（屏幕第 0 行在底）。
import { FX_COMMON_GLSL, type FxItem } from './fx.data'

export const FX_VERT = `#version 300 es
in vec2 in_pos; out vec2 uv;
void main(){ uv = in_pos*0.5+0.5; gl_Position = vec4(in_pos,0.0,1.0); }`

export const FX_HEAD = `#version 300 es
precision highp float;
precision highp int;
in vec2 uv; out vec4 fragColor;
uniform float progress, time, ratio, seed, amount;
uniform vec2 res;
uniform sampler2D tFrom, tTo, tTex, tP1, tP2, tP3, tP4;
vec4 getFrom(vec2 p){ return texture(tFrom, p); }
vec4 getTo(vec2 p){ return texture(tTo, p); }
vec4 getTex(vec2 p){ return texture(tTex, p); }
vec4 getPrev(vec2 p, int k){ if(k<=1) return texture(tP1,p); if(k==2) return texture(tP2,p); if(k==3) return texture(tP3,p); return texture(tP4,p); }
`
/** 一款特效／转场的完整片段着色器源码 */
export function fxFragment(it: Pick<FxItem, 'kind' | 'body'>): string {
  const main = it.kind === 'transition'
    ? 'void main(){ fragColor = vec4(clamp(transition(uv).rgb,0.,1.),1.); }'
    : 'void main(){ fragColor = vec4(clamp(effect(uv).rgb,0.,1.),1.); }'
  return `${FX_HEAD}${FX_COMMON_GLSL}\n${it.body}\n${main}`
}
/** 最后一道：中间结果画到屏幕（上下翻） */
export const FX_COPY_FRAG = `#version 300 es
precision highp float;
in vec2 uv; out vec4 fragColor;
uniform sampler2D tTex;
void main(){ fragColor = vec4(texture(tTex, vec2(uv.x, 1.0-uv.y)).rgb, 1.0); }`
/** 转场另一段按自己的缩放放进来（中间结果→中间结果·不翻）：rel＝另一段缩放÷这段缩放·以画面中心缩放·缩出去的边补黑（如回忆快闪：前片停在 100%、后片 108% 起） */
export const FX_SCALE_FRAG = `#version 300 es
precision highp float;
in vec2 uv; out vec4 fragColor;
uniform sampler2D tTex;
uniform vec2 rel;
void main(){ vec2 p = (uv-0.5)/rel+0.5; fragColor = (p.x<0.0||p.x>1.0||p.y<0.0||p.y>1.0) ? vec4(0.,0.,0.,1.) : vec4(texture(tTex, p).rgb, 1.0); }`
/** 另一段要不要另外缩放（差不到千分之一当一样大） */
export const needsRel = (rel: readonly [number, number] | undefined): rel is readonly [number, number] => !!rel && (Math.abs(rel[0] - 1) > 1e-3 || Math.abs(rel[1] - 1) > 1e-3)
/** 着色器里写的参数（uniform float 名）——默认值在资料档 params */
export const FX_SAMPLERS = ['tFrom', 'tTo', 'tTex', 'tP1', 'tP2', 'tP3', 'tP4'] as const

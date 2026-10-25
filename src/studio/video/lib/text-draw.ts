// 网页剪辑页·文字片段的 Canvas 画法（汇出成片用·文字栏的属性汇出也要照画）。
// 跟画面叠字（VeditFancyText·CSS）吃同一份 resolveTextLook：字体／粗斜体／字色／字间距行间距／对齐／缩放／位置／旋转／不透明度／描边／背景／底线两边一致。
// 给了 at（这一刻在片段里第几秒）⇒ 再叠上 textAnimPose 的姿势（位移／缩放／旋转／透明度／打字机露字）·画面叠字同一份。
// 一行一行用那支 drawFancyText 画（它只画单行）·整块背景、底线、旋转、不透明度由本档包。
import { drawBubbleTail, drawFancyText, measureFancy, FANCY_LINE_HEIGHT } from './fancy-text.data'
import type { TextBody } from './timeline.pure'
import { BASELINE_BELOW_MIDDLE, UNDERLINE, displayText, layoutText, resolveTextLook, type TextLook } from './text-style.pure'
import { POSE_IDLE, charCount, charMatrix, charPoses, textAnimPose, visibleChars, type AnimPose, type CharPose } from './text-anim.pure'

function makeCanvas(w: number, h: number): { getContext(k: '2d'): unknown } {
  return typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h })
}

/** 这一刻在片段里的时间：t＝片段起点到现在（秒）；length＝片段长；offset＝片段的 offset（剪开后接着播·循环动画用） */
export type TextAt = { t: number; length: number; offset?: number }

/** 把一段文字画进成片的一格（frameW×frameH＝成片画面像素·ctx 的座标就是画面座标）；at 缺＝不算动画（静止样子） */
export function drawTextBody(ctx: CanvasRenderingContext2D, b: TextBody, frameW: number, frameH: number, at?: TextAt): void {
  const look = resolveTextLook(b)
  const pose = at ? textAnimPose(b.anim, at.t, at.length, (at.offset ?? 0) + at.t) : POSE_IDLE
  // 逐字动画（in-pc-*／out-pc-*）：每个字的姿势·画面叠字同一份 charPoses→charMatrix
  const pcs = at ? charPoses(b.anim, charCount(displayText(b)), at.t, at.length) : null
  const alpha = look.opacity * pose.alpha
  if (alpha <= 0) return
  if (alpha < 1) {
    // 不透明度要「整块一起淡」（同 CSS opacity）：先在离屏画满再一次贴回·免得描边与字面叠的地方透出深浅
    const off = makeCanvas(Math.ceil(frameW), Math.ceil(frameH))
    const o = off.getContext('2d') as CanvasRenderingContext2D
    drawSolid(o, b, look, pose, frameW, frameH, pcs)
    ctx.save(); ctx.globalAlpha *= alpha; ctx.drawImage(off as CanvasImageSource, 0, 0); ctx.restore()
    return
  }
  drawSolid(ctx, b, look, pose, frameW, frameH, pcs)
}

/** 不管透明度地画（透明度由外层一次套） */
function drawSolid(ctx: CanvasRenderingContext2D, b: TextBody, look: TextLook, pose: AnimPose, frameW: number, frameH: number, pcs: CharPose[] | null = null): void {
  const px = look.fontScale * frameH
  const { bg, ...rest } = look.style
  const measure = (s: string) => measureFancy(ctx, s, rest, px).textW
  // 打字机：排版照整段字（字不跳位）·只画前面看得到的那几个
  const text = displayText(b) // 竖排＝转成一字一行（画面叠字同一串）
  const lay = layoutText(text, look, px, measure)
  let left = visibleChars(text, pose.reveal)
  ctx.save()
  // 顺序同画面叠字的 CSS：移到字块中心＋动画位移 → 旋转 → 缩放 → 回到左上角
  ctx.translate(b.x * frameW + pose.tx * px, b.y * frameH + pose.ty * px)
  const rot = look.rotate + pose.rot
  if (rot) ctx.rotate((rot * Math.PI) / 180)
  if (pose.sx !== 1 || pose.sy !== 1) ctx.scale(pose.sx, pose.sy)
  ctx.translate(-lay.w / 2, -lay.h / 2)
  if (bg) {
    ctx.fillStyle = bg.color; ctx.beginPath()
    ;(ctx as unknown as { roundRect: (x: number, y: number, w: number, h: number, r: number) => void }).roundRect(0, 0, lay.w, lay.h, bg.radius * px); ctx.fill()
    drawBubbleTail(ctx, bg.shape, bg.color, 0, lay.h, px) // 气泡尾巴
  }
  let ci = 0
  for (const ln of lay.lines) {
    const chars = Array.from(ln.text)
    if (pcs) {
      // 逐字：每个字以自己的中心套 charMatrix（e／f 是 em ⇒ ×字号）·透明度各自乘
      const y = ln.cy - (px * FANCY_LINE_HEIGHT) / 2
      chars.forEach((ch, k) => {
        const q = pcs[ci++]
        if (!q || q.alpha <= 0) return
        const x0 = ln.x + (k ? measure(chars.slice(0, k).join('')) : 0), w = measure(ch), cx = x0 + w / 2
        const [ma, mb, mc, md, me, mf] = charMatrix(q)
        ctx.save(); ctx.translate(cx, ln.cy); ctx.transform(ma, mb, mc, md, me * px, mf * px); ctx.translate(-cx, -ln.cy)
        if (q.alpha < 1) ctx.globalAlpha *= q.alpha
        drawFancyText(ctx, ch, rest, { x: x0, y, fontSize: px })
        ctx.restore()
      })
      if (look.underline) { ctx.fillStyle = look.underline; ctx.fillRect(ln.x, ln.cy + (BASELINE_BELOW_MIDDLE + UNDERLINE.offset) * px, ln.w, UNDERLINE.thickness * px) }
      continue
    }
    const shown = left >= chars.length ? ln.text : chars.slice(0, Math.max(0, left)).join('')
    left -= chars.length
    if (!shown) continue
    const w = shown === ln.text ? ln.w : measure(shown)
    drawFancyText(ctx, shown, rest, { x: ln.x, y: ln.cy - (px * FANCY_LINE_HEIGHT) / 2, fontSize: px })
    if (look.underline) { ctx.fillStyle = look.underline; ctx.fillRect(ln.x, ln.cy + (BASELINE_BELOW_MIDDLE + UNDERLINE.offset) * px, w, UNDERLINE.thickness * px) }
  }
  ctx.restore()
}

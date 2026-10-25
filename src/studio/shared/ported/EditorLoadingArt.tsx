'use client'
// 编辑页载入插画（各编辑器一款）与整页载入画面。


import { useId } from 'react'
import { palette } from '../theme/color-palette'

export type EditorLoadingKind = 'slides' | 'doc' | 'sheet' | 'site'

const A = palette.aurora
const L = palette.illo
const W = palette.white

const KEYFRAMES =
  '@keyframes ela-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}' +
  '@keyframes ela-grow{0%,100%{transform:scaleY(.5)}50%{transform:scaleY(1)}}' +
  '@keyframes ela-type{0%{transform:scaleX(.06)}70%,100%{transform:scaleX(1)}}' +
  '@keyframes ela-blink{0%,100%{opacity:.35}50%{opacity:1}}' +
  '@keyframes ela-clap{0%,55%,100%{transform:rotate(0)}15%{transform:rotate(-18deg)}30%{transform:rotate(0)}}' +
  '.ela-bar{transform-box:fill-box;transform-origin:50% 100%}' +
  '.ela-typeline{transform-box:fill-box;transform-origin:0 50%}' +
  '.ela-clap{transform-box:fill-box;transform-origin:0 100%}' +
  '.ela-idle .ela-work{animation:none!important}' +
  '@media (prefers-reduced-motion:reduce){.ela-anim{animation:none!important}}'

export function EditorLoadingArt({ kind, className = 'w-[200px] max-w-[56vw] h-auto', idle = false }: {
  kind: EditorLoadingKind
  className?: string
  idle?: boolean
}) {
  const id = 'ela' + useId().replace(/[^a-zA-Z0-9_-]/g, '')
  return (
    <svg viewBox="0 0 200 150" className={idle ? `${className} ela-idle` : className} aria-hidden="true" focusable="false"
      data-testid="editor-loading-art" data-kind={kind} data-idle={idle ? '1' : undefined}>
      <defs>
        <radialGradient id={`${id}-glow`} cx="50%" cy="60%" r="55%">
          <stop offset="0%" stopColor={A.violetBlue} stopOpacity="0.55" />
          <stop offset="60%" stopColor={A.pink} stopOpacity="0.18" />
          <stop offset="100%" stopColor={A.tintBg} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-hero`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={A.violet} />
          <stop offset="100%" stopColor={A.pink} />
        </linearGradient>
        <linearGradient id={`${id}-card`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={W} />
          <stop offset="100%" stopColor={A.tintBg} />
        </linearGradient>
      </defs>
      <style>{KEYFRAMES}</style>

      <ellipse cx="100" cy="92" rx="88" ry="52" fill={`url(#${id}-glow)`} />

      {kind === 'slides' && <SlidesBody id={id} />}
      {kind === 'doc' && <DocBody id={id} />}
      {kind === 'sheet' && <SheetBody id={id} />}
      {kind === 'site' && <SiteBody id={id} />}

      <Stars big={kind === 'slides' || kind === 'sheet' ? [26, 30] : undefined} />
    </svg>
  )
}

function Stars({ big = [40, 40] }: { big?: [number, number] }) {
  return (
    <>
      <g fill={A.violet} className="motion-safe:animate-pulse">
        <path d={`M${big[0]} ${big[1]} l2.2 5.3 5.3 2.2 -5.3 2.2 -2.2 5.3 -2.2 -5.3 -5.3 -2.2 5.3 -2.2 z`} />
      </g>
      <g fill={A.pink} className="motion-safe:animate-pulse" style={{ animationDelay: '0.7s' }}>
        <path d="M176 70 l1.6 3.9 3.9 1.6 -3.9 1.6 -1.6 3.9 -1.6 -3.9 -3.9 -1.6 3.9 -1.6 z" />
      </g>
      <g fill={A.blue} className="motion-safe:animate-pulse" style={{ animationDelay: '1.4s' }}>
        <path d="M108 16 l1.3 3.2 3.2 1.3 -3.2 1.3 -1.3 3.2 -1.3 -3.2 -3.2 -1.3 3.2 -1.3 z" />
      </g>
    </>
  )
}

function Face({ y = 18 }: { y?: number }) {
  return (
    <>
      <circle cx="16" cy={y} r="1.9" fill={L.ink} />
      <circle cx="30" cy={y} r="1.9" fill={L.ink} />
      <path d={`M18 ${y + 6} q5 4.5 10 0`} stroke={L.ink} strokeWidth="1.6" strokeLinecap="round" fill="none" />
      <circle cx="11" cy={y + 5} r="2.2" fill={A.pink} opacity="0.7" />
      <circle cx="35" cy={y + 5} r="2.2" fill={A.pink} opacity="0.7" />
    </>
  )
}

function FaceCard({ id, x, y, strip }: { id: string; x: number; y: number; strip: string }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <g className="ela-anim" style={{ animation: 'ela-float 2.8s ease-in-out infinite' }}>
        <rect x="0" y="0" width="46" height="34" rx="6" fill={`url(#${id}-card)`} stroke={A.violetBlue} strokeWidth="1.5" />
        <rect x="0" y="0" width="46" height="8" rx="6" fill={strip} />
        <rect x="0" y="4" width="46" height="4" fill={strip} />
        <circle cx="5.5" cy="4" r="1.3" fill={A.pink} />
        <circle cx="9.5" cy="4" r="1.3" fill={W} />
        <circle cx="13.5" cy="4" r="1.3" fill={A.blue} />
        <Face />
      </g>
    </g>
  )
}

function SlidesBody({ id }: { id: string }) {
  const bars = [
    { x: 114, h: 20, fill: A.violet, delay: '0s' },
    { x: 124, h: 30, fill: A.pink, delay: '0.25s' },
    { x: 134, h: 24, fill: A.blue, delay: '0.5s' },
  ]
  return (
    <>
      <ellipse cx="100" cy="134" rx="36" ry="3.2" fill={L.base} />
      <path d="M100 112 L80 133 M100 112 L120 133 M100 112 V134" stroke={L.line} strokeWidth="4" strokeLinecap="round" fill="none" />

      <rect x="94" y="34" width="12" height="8" rx="2" fill={L.ink} />
      <rect x="44" y="40" width="112" height="74" rx="6" fill={L.ink} />
      <rect x="49" y="45" width="102" height="62" rx="3.5" fill={W} />

      <rect x="56" y="51" width="42" height="4.5" rx="2.25" fill={`url(#${id}-hero)`} />
      <rect x="56" y="58.5" width="26" height="2.6" rx="1.3" fill={L.line} />
      {[{ y: 70, w: 30, c: A.violet }, { y: 79, w: 24, c: A.pink }, { y: 88, w: 28, c: A.blue }].map(r => (
        <g key={r.y}>
          <circle cx="58" cy={r.y} r="1.8" fill={r.c} />
          <rect x="62.5" y={r.y - 1.2} width={r.w} height="2.4" rx="1.2" fill={L.line} />
        </g>
      ))}
      <rect x="110" y="99" width="36" height="1.6" rx="0.8" fill={L.base} />
      {bars.map(b => (
        <rect key={b.x} x={b.x} y={99 - b.h} width="7" height={b.h} rx="2" fill={b.fill}
          className="ela-bar ela-anim ela-work" style={{ animation: `ela-grow 1.6s ease-in-out ${b.delay} infinite` }} />
      ))}
      {[92, 100, 108].map((cx, i) => (
        <circle key={cx} cx={cx} cy="110.5" r="1.3" fill={W}
          className="ela-anim ela-work" style={{ animation: `ela-blink 1.2s ease-in-out ${i * 0.4}s infinite` }} />
      ))}

      <g transform="translate(126 10)">
        <g className="ela-anim" style={{ animation: 'ela-float 2.8s ease-in-out infinite' }}>
          <rect x="0" y="9" width="46" height="31" rx="5" fill={`url(#${id}-card)`} stroke={A.violetBlue} strokeWidth="1.5" />
          <rect x="1" y="10" width="44" height="5" fill={A.violetBlue} />
          <g transform="translate(0 16)"><Face y={8} /></g>
          <g className="ela-clap ela-anim ela-work" style={{ animation: 'ela-clap 2.4s ease-in-out infinite' }}>
            <rect x="0" y="1" width="46" height="8" rx="2.5" fill={L.ink} />
            <path d="M8 1 h6 l-4 8 h-6 z" fill={A.violet} />
            <path d="M22 1 h6 l-4 8 h-6 z" fill={A.pink} />
            <path d="M36 1 h6 l-4 8 h-6 z" fill={A.blue} />
          </g>
        </g>
      </g>
    </>
  )
}

function DocBody({ id }: { id: string }) {
  return (
    <>
      <ellipse cx="96" cy="130" rx="40" ry="3.2" fill={L.base} />
      <rect x="66" y="34" width="70" height="92" rx="6" fill={L.base} />
      <path d="M64 28 h44 l16 16 v76 a6 6 0 0 1 -6 6 h-54 a6 6 0 0 1 -6 -6 v-86 a6 6 0 0 1 6 -6 z"
        fill={W} stroke={L.ink} strokeWidth="2.4" strokeLinejoin="round" />
      <path d="M108 28 v10 a6 6 0 0 0 6 6 h10 z" fill={A.violetBlue} stroke={L.ink} strokeWidth="2.4" strokeLinejoin="round" />
      <rect x="66" y="40" width="32" height="6" rx="3" fill={`url(#${id}-hero)`} />
      <rect x="66" y="53" width="50" height="2.6" rx="1.3" fill={L.line} />
      <rect x="66" y="60" width="44" height="2.6" rx="1.3" fill={L.line} />
      <rect x="66" y="67" width="48" height="2.6" rx="1.3" fill={L.line} />
      <rect x="66" y="75" width="22" height="17" rx="3" fill={A.blue} />
      <path d="M69 89 l5 -6 4 4 3 -3 5 5 z" fill={W} opacity="0.85" />
      <circle cx="82" cy="80" r="2" fill={W} opacity="0.9" />
      <rect x="92" y="77" width="24" height="2.4" rx="1.2" fill={L.line} />
      <rect x="92" y="83" width="18" height="2.4" rx="1.2" fill={L.line} />
      <rect x="92" y="89" width="21" height="2.4" rx="1.2" fill={A.pink} />
      <rect x="66" y="99" width="46" height="2.6" rx="1.3" fill={L.line} />
      <rect x="66" y="106" width="40" height="2.6" rx="1.3" fill={A.violet}
        className="ela-typeline ela-anim ela-work" style={{ animation: 'ela-type 2.4s ease-out infinite' }} />
      <rect x="108" y="103.5" width="1.6" height="7.5" rx="0.8" fill={L.ink}
        className="ela-anim ela-work" style={{ animation: 'ela-blink 0.9s steps(2, jump-none) infinite' }} />

      <FaceCard id={id} x={124} y={14} strip={A.pink} />
    </>
  )
}

function SheetBody({ id }: { id: string }) {
  const colX = [55, 80.5, 106, 131.5]
  const rowY = [63, 76.5, 90, 103.5]
  const lit = [
    { c: 0, r: 1, fill: A.violet, delay: '0s' },
    { c: 2, r: 2, fill: A.pink, delay: '0.5s' },
    { c: 1, r: 3, fill: A.blue, delay: '1s' },
  ]
  return (
    <>
      <ellipse cx="100" cy="130" rx="60" ry="3.2" fill={L.base} />
      <rect x="38" y="42" width="124" height="80" rx="6" fill={L.ink} />
      <rect x="43" y="47" width="114" height="70" rx="3.5" fill={W} />
      <rect x="43" y="47" width="114" height="9" rx="3.5" fill={L.soft} />
      <circle cx="49" cy="51.5" r="2" fill={A.violet} />
      <rect x="54" y="50.3" width="14" height="2.4" rx="1.2" fill={L.line} />
      <rect x="140" y="50.3" width="12" height="2.4" rx="1.2" fill={A.pink} />
      <rect x="43" y="56" width="114" height="7" fill={L.soft} />
      <rect x="43" y="56" width="12" height="61" fill={L.soft} />
      {colX.map(x => <rect key={x} x={x + 8} y="58.3" width="9" height="2.4" rx="1.2" fill={L.line} />)}
      {rowY.map(y => <rect key={y} x="47.5" y={y + 5.5} width="4" height="2.4" rx="1.2" fill={L.line} />)}
      {[...colX, 157].map(x => <rect key={`v${x}`} x={x - 0.5} y="56" width="1" height="61" fill={L.base} />)}
      {[56, ...rowY].map(y => <rect key={`h${y}`} x="43" y={y - 0.5} width="114" height="1" fill={L.base} />)}
      {rowY.map((y, ri) => colX.map((x, ci) => (
        (ri + ci) % 3 === 2 ? null :
          <rect key={`${x}-${y}`} x={x + 3.5} y={y + 5.5} width={ci % 2 ? 12 : 16} height="2.4" rx="1.2" fill={L.line} />
      )))}
      {lit.map(k => (
        <rect key={`${k.c}-${k.r}`} x={colX[k.c] + 1.5} y={rowY[k.r] + 1.5} width="22.5" height="10.5" rx="2" fill={k.fill}
          className="ela-anim ela-work" style={{ animation: `ela-blink 1.5s ease-in-out ${k.delay} infinite` }} />
      ))}

      <FaceCard id={id} x={124} y={14} strip={A.blue} />
    </>
  )
}

function SiteBody({ id }: { id: string }) {
  const cards = [
    { x: 58, fill: A.violetBlue, delay: '0s' },
    { x: 87.5, fill: A.pink, delay: '0.5s' },
    { x: 117, fill: A.blue, delay: '1s' },
  ]
  return (
    <>
      <path d="M38 118 h124 l8 9 a3 3 0 0 1 -2.6 4.5 H32.6 A3 3 0 0 1 30 127 z" fill={L.base} />
      <rect x="86" y="118" width="28" height="3" rx="1.5" fill={L.line} />
      <rect x="48" y="52" width="104" height="68" rx="6" fill={L.ink} />
      <rect x="53" y="57" width="94" height="58" rx="3.5" fill={W} />
      <rect x="53" y="57" width="94" height="9" rx="3.5" fill={L.soft} />
      <circle cx="60" cy="61.5" r="2" fill={A.violet} />
      <rect x="65" y="60.3" width="12" height="2.4" rx="1.2" fill={L.line} />
      <rect x="121" y="60.3" width="8" height="2.4" rx="1.2" fill={L.line} />
      <rect x="131" y="60.3" width="8" height="2.4" rx="1.2" fill={L.line} />
      <rect x="141" y="60.3" width="4" height="2.4" rx="1.2" fill={A.pink} />
      <rect x="58" y="70" width="84" height="18" rx="3" fill={`url(#${id}-hero)`} opacity="0.85" />
      <rect x="64" y="75" width="30" height="3" rx="1.5" fill={W} opacity="0.9" />
      <rect x="64" y="80.5" width="20" height="2.4" rx="1.2" fill={W} opacity="0.7" />
      {cards.map(c => (
        <g key={c.x}>
          <rect x={c.x} y="92" width="25" height="18" rx="2.5" fill={A.tintBgAlt} stroke={L.base} />
          <rect x={c.x + 3.5} y="95" width="18" height="6" rx="1.5" fill={c.fill}
            className="ela-anim ela-work" style={{ animation: `ela-blink 1.5s ease-in-out ${c.delay} infinite` }} />
          <rect x={c.x + 3.5} y="103.5" width="12" height="2" rx="1" fill={L.line} />
        </g>
      ))}

      <FaceCard id={id} x={122} y={22} strip={A.violetBlue} />
    </>
  )
}

export function EditorLoadingScreen({ kind, label, className, style, labelClassName = '', testId }: {
  kind: EditorLoadingKind
  label: string
  className: string
  style?: React.CSSProperties
  labelClassName?: string
  testId?: string
}) {
  return (
    <div className={`${className} flex-col gap-3`} style={style} data-testid={testId ?? 'editor-loading-screen'} aria-busy="true">
      <EditorLoadingArt kind={kind} />
      <div className={labelClassName}>{label}</div>
    </div>
  )
}

export default EditorLoadingArt

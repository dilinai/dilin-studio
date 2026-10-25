'use client'
// 网页剪辑页·时间轴影片片段上的缩图条：每份素材一只藏起来的 <video> 依序跳到要的那几秒、画成小 JPEG 存进快取。
// 哪几格、取哪一秒在 _lib/filmstrip.pure.ts（filmstripTiles）。抓不到（跨网域没开 CORS、档读不到）⇒ 那格留空（片段照旧显底色）。
// 后要的先抓（刚捲到眼前的那几格先出来）·快取最多 FILM_CACHE_MAX 张（满了丢最旧的）。
// 终端做好的缩图拼图（sprite）有那一格 ⇒ 从拼图裁（⛔ 跳影片）·拉很近、格子比拼图细的 ⇒ 照旧自己抓。
import { useEffect, useMemo, useReducer } from 'react'
import { filmKey, filmstripTiles } from '../lib/filmstrip.pure'
import { spriteCell } from '../lib/cloud-proxy.pure'

export type FilmSprite = { url: string; every: number; cols: number; n: number }
const sprites = new Map<string, Promise<HTMLImageElement | null>>()
function spriteImg(url: string): Promise<HTMLImageElement | null> {
  let p = sprites.get(url)
  if (!p) {
    p = new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = url })
    sprites.set(url, p)
  }
  return p
}
/** 从拼图裁得到的那几格裁好进快取·回裁不到的那几秒（交给 <video> 抓） */
async function fromSprite(mediaId: string, sp: FilmSprite, times: number[]): Promise<number[]> {
  const rest: number[] = []
  const cells: Array<{ t: number; col: number; row: number }> = []
  for (const t of times) { const c = spriteCell(t, sp); if (c) cells.push({ t, col: c.col, row: c.row }); else rest.push(t) }
  if (!cells.length) return rest
  const im = await spriteImg(sp.url)
  const cols = Math.min(sp.n, sp.cols), rows = Math.ceil(sp.n / sp.cols)
  if (!im || !im.naturalWidth || !im.naturalHeight) return times
  const tw = im.naturalWidth / cols, th = im.naturalHeight / rows
  const c = document.createElement('canvas')
  c.height = FILM_H; c.width = Math.max(1, Math.round((tw / th) * FILM_H))
  const x = c.getContext('2d')
  if (!x) return times
  for (const cell of cells) {
    x.clearRect(0, 0, c.width, c.height)
    x.drawImage(im, cell.col * tw, cell.row * th, tw, th, 0, 0, c.width, c.height)
    let url: string | null = null
    try { url = c.toDataURL('image/jpeg', 0.7) } catch { url = null }
    if (url) put(filmKey(mediaId, cell.t), url); else rest.push(cell.t)
  }
  bump()
  return rest
}

const FILM_H = 48
const FILM_CACHE_MAX = 1500
const SEEK_TIMEOUT_MS = 4000
const cache = new Map<string, string | null>()
const listeners = new Set<() => void>()
const bump = () => { for (const f of listeners) f() }
type Grabber = { url: string; v: HTMLVideoElement; queue: Array<{ key: string; t: number }>; busy: boolean; dead: boolean }
const grabbers = new Map<string, Grabber>()

function put(key: string, v: string | null) {
  cache.delete(key); cache.set(key, v)
  if (cache.size > FILM_CACHE_MAX) cache.delete(cache.keys().next().value!)
}
function grabberFor(mediaId: string, url: string): Grabber {
  let g = grabbers.get(mediaId)
  if (g && g.url !== url) { g.dead = true; g.v.removeAttribute('src'); g.v.load(); g = undefined }
  if (!g) {
    const v = document.createElement('video')
    v.muted = true; v.playsInline = true; v.preload = 'auto'
    if (!url.startsWith('blob:')) v.crossOrigin = 'anonymous'
    v.src = url
    g = { url, v, queue: [], busy: false, dead: false }
    grabbers.set(mediaId, g)
  }
  return g
}
function seek(v: HTMLVideoElement, t: number): Promise<boolean> {
  return new Promise((ok) => {
    const done = (r: boolean) => { clearTimeout(timer); v.removeEventListener('seeked', on); v.removeEventListener('error', off); ok(r) }
    const on = () => done(true), off = () => done(false)
    const timer = setTimeout(() => done(false), SEEK_TIMEOUT_MS)
    v.addEventListener('seeked', on); v.addEventListener('error', off)
    const go = () => { v.currentTime = t }
    if (v.readyState >= 1) go(); else v.addEventListener('loadedmetadata', go, { once: true })
  })
}
async function pump(g: Grabber) {
  if (g.busy) return
  g.busy = true
  const c = document.createElement('canvas')
  while (g.queue.length && !g.dead) {
    const job = g.queue.pop()! // 后要的先抓
    if (cache.has(job.key)) continue
    let url: string | null = null
    if (await seek(g.v, job.t)) {
      const w = g.v.videoWidth, h = g.v.videoHeight
      if (w > 0 && h > 0) {
        c.height = FILM_H; c.width = Math.max(1, Math.round((w / h) * FILM_H))
        const x = c.getContext('2d')
        if (x) { x.drawImage(g.v, 0, 0, c.width, c.height); try { url = c.toDataURL('image/jpeg', 0.6) } catch { url = null } } // 跨网域没开 CORS ⇒ 画布被污染
      }
    }
    put(job.key, url); bump()
  }
  g.busy = false
}
function want(mediaId: string, url: string, times: number[], sprite?: FilmSprite) {
  const need0 = times.filter((t) => !cache.has(filmKey(mediaId, t)))
  if (!need0.length) return
  if (sprite) { void fromSprite(mediaId, sprite, need0).then((rest) => { if (rest.length) grab(mediaId, url, rest) }); return }
  grab(mediaId, url, need0)
}
function grab(mediaId: string, url: string, need: number[]) {
  const g = grabberFor(mediaId, url)
  const seen = new Set(g.queue.map((j) => j.key))
  for (const t of need.reverse()) { const key = filmKey(mediaId, t); if (!seen.has(key)) g.queue.push({ key, t }) } // 反着推 ⇒ 左边的先出来
  void pump(g)
}

/** 片段里的缩图条（铺满片段·放在最底层·不接滑鼠） */
export default function VeditFilmstrip({ mediaId, url, sprite, offset, srcLen, widthPx, duration, reverse }: { mediaId: string; url: string; sprite?: FilmSprite; offset: number; srcLen: number; widthPx: number; duration: number; reverse?: boolean }) {
  const [, tick] = useReducer((n: number) => n + 1, 0)
  useEffect(() => { listeners.add(tick); return () => { listeners.delete(tick) } }, [])
  const tiles = useMemo(() => filmstripTiles({ offset, srcLen, widthPx, tileW: 64, duration, reverse }), [offset, srcLen, widthPx, duration, reverse])
  const key = tiles.map((x) => x.t).join(',')
  useEffect(() => { if (url) want(mediaId, url, tiles.map((x) => x.t), sprite) }, [mediaId, url, key, sprite?.url]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden data-testid="vedit-clip-film" data-tiles={tiles.length}>
      {tiles.map((x, i) => {
        const src = cache.get(filmKey(mediaId, x.t))
        return src ? <div key={i} className="absolute top-0 bottom-0 bg-cover bg-center opacity-60" style={{ left: x.x, width: x.w, backgroundImage: `url(${src})` }} data-t={x.t} /> : null
      })}
    </div>
  )
}

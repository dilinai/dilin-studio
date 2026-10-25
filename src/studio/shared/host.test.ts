/**
 * Dilin Studio 宿主网址题：studioHref 在网站版与开源单页版（NEXT_PUBLIC_STUDIO_STANDALONE=1）两种设定下的输出。
 *   重点是「一定开一份新的」那条（appNew）：单页版的 app() 本来就是 index.html?app=<编辑器>（带 ?），
 *   调用处若自己再接 `?new=1` ⇒ ?app=video?new=1，单页壳 URLSearchParams 读到的 app 是「video?new=1」、认不出编辑器、退回总页；
 *   网站版 /studio/video?new=1 反而没事 ⇒ 两种设定都要量，且要照单页壳那条路（URLSearchParams）读回来验。
 * 跑法（在 studio 根目录跑）：node -e "require('sucrase/register/ts');require('sucrase/register/tsx');require('./shared/host.test.ts')"
 * 药（各改坏一处，对应题必红）：
 *   host.ts 单页版 appNew 改回「app() 那串 + ?new=1」字串拼接 ⇒ ②③红（网站版同样改法 ⇒ ① 照样绿·这正是网站上看不出的原因）；
 *   StudioHome／ProjectPage／SharePage 任一处改回 `${studioHref.app(app)}?new=1` ⇒ ④红。
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { STUDIO_APP_IDS, isStudioAppId } from './types'

const STUDIO = resolve(__dirname, '..')
const tests: Array<[string, () => void | Promise<void>]> = []
const ok = (n: string, f: () => void | Promise<void>) => tests.push([n, f])

;(globalThis as { React?: unknown }).React = require('react')     // sucrase 转 JSX 用 React.createElement
const { renderToStaticMarkup } = require('react-dom/server') as typeof import('react-dom/server')
const h = require('react').createElement as typeof import('react').createElement

type Host = typeof import('./host')
const RELOAD = ['./host', './ui/common', './ui/StudioHome']
/** studioHref 在 host.ts 载入那刻照 isStandalone() 定型 ⇒ 换设定要把 host 与用到它的模组一起重载；跑完还原设定并再清一次，别污染后面的题。 */
function withStandalone<T>(standalone: boolean, fn: (host: Host) => T): T {
  const prev = process.env.NEXT_PUBLIC_STUDIO_STANDALONE
  const purge = () => { for (const m of RELOAD) delete require.cache[require.resolve(m)] }
  if (standalone) process.env.NEXT_PUBLIC_STUDIO_STANDALONE = '1'; else delete process.env.NEXT_PUBLIC_STUDIO_STANDALONE
  purge()
  try { return fn(require('./host') as Host) } finally {
    if (prev === undefined) delete process.env.NEXT_PUBLIC_STUDIO_STANDALONE; else process.env.NEXT_PUBLIC_STUDIO_STANDALONE = prev
    purge()
  }
}
const ID = 'a'.repeat(32)
const BASE = 'https://dilinai.com/'   // 只为把相对网址解析成 URL（单页壳用的是 location.search·同一套 URLSearchParams）

ok('① 网站版：root＝/dilin；app／appNew／project 是 /studio/<编辑器>、?new=1、/<编号>', () => withStandalone(false, host => {
  assert.equal(host.isStandalone(), false)
  assert.equal(host.studioHref.root(), '/dilin')
  for (const app of STUDIO_APP_IDS) {
    assert.equal(host.studioHref.app(app), `/studio/${app}`)
    assert.equal(host.studioHref.appNew(app), `/studio/${app}?new=1`)
    assert.equal(host.studioHref.project(app, ID), `/studio/${app}/${ID}`)
  }
}))

ok('② 单页版：root＝index.html；app／appNew／project 是 index.html?app=<编辑器>、&new=1、&id=<编号>（appNew 用 & 接·⛔ 第二个 ?）', () => withStandalone(true, host => {
  assert.equal(host.isStandalone(), true)
  assert.equal(host.studioHref.root(), 'index.html')
  for (const app of STUDIO_APP_IDS) {
    assert.equal(host.studioHref.app(app), `index.html?app=${app}`)
    assert.equal(host.studioHref.appNew(app), `index.html?app=${app}&new=1`)
    assert.equal(host.studioHref.project(app, ID), `index.html?app=${app}&id=${ID}`)
    for (const href of [host.studioHref.appNew(app), host.studioHref.project(app, ID)]) assert.equal(href.split('?').length, 2, `${href} 只准一个 ?`)
  }
}))

ok('③ 单页壳照 URLSearchParams 读回来：appNew 的 app 是编辑器本名、new=1 认得（wantsNewProject）；project 的 app／id 对、不带 new；总页图示真渲染出 &new=1', () => withStandalone(true, host => {
  const { wantsNewProject } = require('./ui/DirectOpen') as typeof import('./ui/DirectOpen')
  for (const app of STUDIO_APP_IDS) {
    // 单页壳 Route()：new URLSearchParams(location.search).get('app') ⇒ 不是编辑器名就退回总页
    const u = new URL(host.studioHref.appNew(app), BASE)
    assert.equal(u.pathname, '/index.html')
    assert.equal(u.searchParams.get('app'), app, `appNew(${app}) 读回的 app`)
    assert.ok(isStudioAppId(u.searchParams.get('app')), '壳认得这个编辑器')
    assert.equal(u.searchParams.get('new'), '1')
    assert.equal(wantsNewProject(u.search), true)
    const p = new URL(host.studioHref.project(app, ID), BASE)
    assert.equal(p.searchParams.get('app'), app)
    assert.equal(p.searchParams.get('id'), ID)
    assert.equal(p.searchParams.get('new'), null)
    assert.equal(wantsNewProject(p.search), false)
    // 不带 new 的 app()：壳进 DirectOpen、沿用「刚开没动过」那份
    assert.equal(wantsNewProject(new URL(host.studioHref.app(app), BASE).search), false)
  }
  const Home = (require('./ui/StudioHome') as typeof import('./ui/StudioHome')).default
  const html = renderToStaticMarkup(h(Home))
  for (const app of STUDIO_APP_IDS) {
    const m = html.match(new RegExp(`<a [^>]*data-testid="studio-app-${app}"[^>]*>`))
    assert.ok(m, app)
    assert.ok(m[0].includes(`href="index.html?app=${app}&amp;new=1"`), m[0])   // HTML 里 & 写成 &amp;
    assert.ok(!m[0].includes('?new=1'), `总页图示还在接第二个 ?：${m[0]}`)
  }
}))

ok('④ 源码：带 new=1 的网址只准由 host.ts 的 appNew 拼；studio 里没有任何「studioHref.xxx(…)}?」自己接参数的写法；三处「开一份新的」都走 appNew', () => {
  const R = (p: string) => readFileSync(join(STUDIO, p), 'utf8')
  for (const f of ['shared/ui/StudioHome.tsx', 'shared/ui/ProjectPage.tsx', 'shared/ui/SharePage.tsx']) assert.ok(R(f).includes('studioHref.appNew(app)'), `${f} 没走 appNew`)
  const bad: string[] = []
  const walk = (dir: string) => {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n)
      if (statSync(p).isDirectory()) { if (n !== 'node_modules') walk(p); continue }
      if (!/\.tsx?$/.test(n) || /\.test\.tsx?$/.test(n)) continue
      const src = readFileSync(p, 'utf8')
      if (/studioHref\.\w+\([^)]*\)\}[?&]/.test(src) || /studioHref\.\w+\([^)]*\)\s*\+\s*['"`][?&]/.test(src)) bad.push(relative(STUDIO, p).split(sep).join('/'))
    }
  }
  walk(STUDIO)
  assert.deepEqual(bad, [], '这些档在 studioHref 网址后面自己接参数（单页版会接出第二个 ?）')
  assert.match(R('shared/host.ts'), /appNew: \(app: string\) => `index\.html\?app=\$\{app\}&new=1`/)
  assert.match(R('shared/host.ts'), /appNew: \(app: string\) => `\/studio\/\$\{app\}\?new=1`/)
})

void (async () => {
  let fail = 0
  for (const [n, f] of tests) {
    try { await f(); console.log(`  ✓ ${n}`) } catch (e) { fail++; console.log(`  ✗ ${n}\n    ${(e as Error).stack?.split('\n').slice(0, 4).join('\n    ')}`) }
  }
  console.log(`studio host href → ${tests.length - fail} 过 ${fail} 败`)
  process.exit(fail ? 1 : 0)
})()

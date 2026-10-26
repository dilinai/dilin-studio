#!/usr/bin/env node
// 打包 app/（双击启动档或直接打开 app/index.html 用的那份）：
//   esbuild 把 src/shell/main.tsx 连同 src/studio 打成一支 app/app.js（编辑器自己的样式另出 app/app.css）；
//   tailwind 照 src/ 里用到的 class 把 src/shell/site.css 产成 app/site.css；public/ 原样拷进 app/。
// 跑法：npm install 之后 npm run build（＝node tools/build.mjs）。

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { aiBriefHtml, injectAiBrief } from './ai-brief.mjs'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const APP = join(REPO, 'app')
const manifest = JSON.parse(readFileSync(join(REPO, 'studio-oss.json'), 'utf8'))
const nodePaths = [join(REPO, 'node_modules'), ...(process.env.NODE_PATH || '').split(delimiter).filter(Boolean)]
const req = createRequire(join(REPO, 'package.json'))

function load(name) {
  try { return req(req.resolve(name, { paths: nodePaths })) } catch { /* 下面再找 */ }
  if (name === 'esbuild' && process.env.STUDIO_ESBUILD) return req(process.env.STUDIO_ESBUILD)
  throw new Error(`找不到套件 ${name}：請先在這個資料夾跑 npm install`)
}

const esbuild = load('esbuild')
const postcss = load('postcss')
const tailwindcss = load('tailwindcss')
const autoprefixer = load('autoprefixer')

rmSync(APP, { recursive: true, force: true })
mkdirSync(APP, { recursive: true })

const result = await esbuild.build({
  entryPoints: [join(REPO, 'src', 'shell', 'main.tsx')],
  bundle: true,
  outfile: join(APP, 'app.js'),
  format: 'iife',
  platform: 'browser',
  target: ['chrome100', 'edge100', 'firefox100', 'safari15'],
  jsx: 'automatic',
  minify: true,
  charset: 'utf8',
  nodePaths,
  tsconfig: join(REPO, 'tsconfig.json'),
  define: {
    'process.env.NODE_ENV': '"production"',
    'process.env.NEXT_PUBLIC_STUDIO_STANDALONE': '"1"',
    'process.env.NEXT_PUBLIC_DEPLOYMENT_REGION': JSON.stringify(manifest.region), 'process.env.DEPLOYMENT_REGION': JSON.stringify(manifest.region),
    'process.env.NEXT_PUBLIC_STUDIO_GITHUB_URL': JSON.stringify(manifest.repoUrl || ''),
  },
  banner: { js: 'var process=globalThis.process||{env:{}};' },
  loader: { '.woff': 'file', '.woff2': 'file', '.ttf': 'file', '.eot': 'file', '.png': 'file', '.jpg': 'file', '.gif': 'file', '.svg': 'file' },
  assetNames: 'assets/[name]-[hash]',
  logLevel: 'warning',
  metafile: true,
})
if (!existsSync(join(APP, 'app.css'))) writeFileSync(join(APP, 'app.css'), '')

// 命令列版的核心（tools/<编辑器>-cli.mjs import 它）：读档检查、命令表、跑命令、纯算得出的汇出都是纯函数 ⇒ 各打成 node 跑的一支
//   剪辑（FCPXML／剪映…）、文件（改正文、Markdown）、简报（元件／页操作）
for (const ed of ['video', 'docs', 'slides']) await esbuild.build({
  entryPoints: [join(REPO, 'src', 'studio', ed, 'cli-core.ts')],
  bundle: true,
  outfile: join(APP, `${ed}-cli-core.mjs`),
  format: 'esm',
  platform: 'node',
  target: ['node18'],
  minify: true,
  charset: 'utf8',
  nodePaths,
  tsconfig: join(REPO, 'tsconfig.json'),
  define: { 'process.env.NEXT_PUBLIC_STUDIO_STANDALONE': '"1"', 'process.env.NEXT_PUBLIC_DEPLOYMENT_REGION': JSON.stringify(manifest.region) },
  loader: { '.woff': 'empty', '.woff2': 'empty', '.ttf': 'empty', '.png': 'empty', '.jpg': 'empty', '.gif': 'empty', '.svg': 'empty', '.css': 'empty' },
  logLevel: 'warning',
})

// 表格命令列版的核心（tools/sheets-cli.mjs import 它）：读档检查、读格算公式、表格操作、xlsx／csv 读写都是纯函数 ⇒ 同样打成 node 跑的一支（SheetJS 一起打进去）
await esbuild.build({
  entryPoints: [join(REPO, 'src', 'studio', 'sheets', 'cli-core.ts')],
  bundle: true,
  outfile: join(APP, 'sheets-cli-core.mjs'),
  format: 'esm',
  platform: 'node',
  target: ['node18'],
  minify: true,
  charset: 'utf8',
  nodePaths,
  tsconfig: join(REPO, 'tsconfig.json'),
  define: { 'process.env.NEXT_PUBLIC_STUDIO_STANDALONE': '"1"', 'process.env.NEXT_PUBLIC_DEPLOYMENT_REGION': JSON.stringify(manifest.region) },
  // SheetJS 在 node 里会 require('stream')、require('fs') ⇒ esm 包里先备一个 require
  banner: { js: "import{createRequire as __dilinReq}from'node:module';const require=__dilinReq(import.meta.url);" },
  loader: { '.woff': 'empty', '.woff2': 'empty', '.ttf': 'empty', '.png': 'empty', '.jpg': 'empty', '.gif': 'empty', '.svg': 'empty', '.css': 'empty' },
  logLevel: 'warning',
})

const tw = tailwindcss({ content: [join(REPO, 'src', '**', '*.{ts,tsx,html}')], theme: { extend: {} }, plugins: [] })
const cssIn = readFileSync(join(REPO, 'src', 'shell', 'site.css'), 'utf8')
const css = await postcss([tw, autoprefixer]).process(cssIn, { from: join(REPO, 'src', 'shell', 'site.css'), to: join(APP, 'site.css') })
writeFileSync(join(APP, 'site.css'), css.css)

cpSync(join(REPO, 'public'), APP, { recursive: true })
// index.html 塞进给 AI 读的说明（见 ai-brief.mjs）：AI 抓这页网址就读得到怎么改、格式长什么样
writeFileSync(join(APP, 'index.html'), injectAiBrief(readFileSync(join(REPO, 'src', 'shell', 'index.html'), 'utf8'), aiBriefHtml(REPO)))
writeFileSync(join(APP, 'version.json'), JSON.stringify({ name: manifest.name, version: manifest.version, versions: manifest.versions, sourceCommit: manifest.sourceCommit }, null, 2) + '\n')

const kb = n => `${Math.round(n / 1024)} KB`
const outs = Object.entries(result.metafile.outputs).map(([f, o]) => ({ name: f.replace(/\\/g, '/').replace(/^(.*\/)?app\//, ''), bytes: o.bytes }))
const main = outs.filter(o => !o.name.startsWith('assets/')).map(o => `${o.name} ${kb(o.bytes)}`)
console.log(`app/ 打好了：${main.join('、')}、site.css ${kb(css.css.length)}、字型等 ${outs.length - main.length} 檔`)

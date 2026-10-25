#!/usr/bin/env node
// 做「交给用户的链接」：用户点开就把工程读进他的浏览器、进编辑页，能看也能手改（规矩见 AGENTS.md「交成品」）。
//
//   node tools/make-link.mjs <project.json 或工程资料夹> [--app <编辑器>] [--local]
//     ⇒ 小工程整份塞进链接（#p=）：只带 project.json。资料夹里 assets/ 有档 ⇒ 不做（素材带不进链接），请改用 --url。
//   node tools/make-link.mjs --url <https 网址> --app <编辑器> [--local]
//     ⇒ 工程放在网上（zip 或 project.json，要公开、能直接下载），链接带上那个网址（?import=）。
//   --local  链接改开本机这份（http://localhost:41730/index.html?app=…），先自己点开看对不对用
//   --base <网址>  自己指定开在哪（缺省＝studio-oss.json 的 site＋/studio/<编辑器>）
//
// #p= 的做法：project.json 物件 ⇒ JSON.stringify（不缩排）⇒ UTF-8 ⇒ deflate-raw 压缩 ⇒ base64url（不补 =）。网页那边用 DecompressionStream('deflate-raw') 解。

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { deflateRawSync } from 'node:zlib'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(REPO, 'studio-oss.json'), 'utf8'))
const APPS = ['docs', 'sheets', 'slides', 'video', 'paint']
const HASH_MAX = 60000   // 跟网页 src/studio/shared/import-link.ts 的 LINK_HASH_MAX_CHARS 一样

function fail(msg) { console.error(`✗ ${msg}`); process.exit(1) }

const args = process.argv.slice(2)
const opt = { app: '', url: '', local: false, base: '', path: '' }
for (let i = 0; i < args.length; i++) {
  const a = args[i]
  if (a === '--app') opt.app = args[++i] || ''
  else if (a === '--url') opt.url = args[++i] || ''
  else if (a === '--local') opt.local = true
  else if (a === '--base') opt.base = args[++i] || ''
  else if (a.startsWith('--')) fail(`不認得的選項 ${a}`)
  else opt.path = a
}

function baseFor(app) {
  if (opt.base) return opt.base
  if (opt.local) return `http://localhost:41730/index.html?app=${app}`
  return `${manifest.site}/studio/${app}`
}

if (opt.url) {
  if (!APPS.includes(opt.app)) fail(`--url 要配 --app（${APPS.join('／')}）`)
  let u
  try { u = new URL(opt.url) } catch { fail('--url 不是網址') }
  if (u.protocol !== 'https:') fail('只收 https:// 的網址')
  const base = baseFor(opt.app)
  console.log(`${base}${base.includes('?') ? '&' : '?'}import=${encodeURIComponent(u.toString())}`)
  process.exit(0)
}

if (!opt.path) fail('用法：node tools/make-link.mjs <project.json 或工程資料夾> [--app <編輯器>]，或 --url <https 網址> --app <編輯器>')
let file = opt.path
if (existsSync(file) && statSync(file).isDirectory()) {
  const assets = join(file, 'assets')
  if (existsSync(assets) && readdirSync(assets).some(n => !n.startsWith('.'))) {
    fail('這個工程有素材（assets/ 裡有檔），素材帶不進連結：請把 project.json 和 assets/ 一起壓成 zip、放到公開能下載的 https 網址，再用 --url')
  }
  file = join(file, 'project.json')
}
if (!existsSync(file)) fail(`找不到 ${file}`)
let json
try { json = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, '')) } catch (e) { fail(`project.json 不是合法的 JSON：${e.message}`) }
const m = typeof json?.format === 'string' ? json.format.match(/^dilin-studio\/(\w+)$/) : null
if (!m || !APPS.includes(m[1])) fail('project.json 的 format 要是 "dilin-studio/<編輯器>"（docs、sheets、slides、video、paint）')
if (opt.app && opt.app !== m[1]) fail(`--app ${opt.app} 跟 project.json 的 format（${m[1]}）對不上`)
if (!Number.isInteger(json.version) || json.version < 1) fail('project.json 的 version 要是正整數')
const data = deflateRawSync(Buffer.from(JSON.stringify(json), 'utf8'), { level: 9 }).toString('base64url')
if (data.length > HASH_MAX) fail(`工程太大，塞進連結有 ${data.length} 字（上限 ${HASH_MAX}）：請改用 zip＋--url`)
console.log(`${baseFor(m[1])}#p=${data}`)

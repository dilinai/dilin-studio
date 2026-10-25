#!/usr/bin/env node
// 本机小服务（Node 版）：把 app/ 放在 http://localhost:41730/ 上、自动打开浏览器。只听本机（127.0.0.1 与 ::1），别台电脑连不进来。
//   埠固定 41730：工程存在浏览器里时，是记在「这个网址」底下的，换埠就看不到之前的工程。要换：PORT=xxxx node tools/serve.mjs
//   已经开着一份（同一埠回得出 version.json）⇒ 直接打开浏览器就结束。
//   也开本机 MCP 给 AI（http://localhost:41730/mcp·只吃 stdio 的 AI 用 tools/mcp-stdio.mjs）：AI 下的命令在开着的画板／剪辑页里跑（tools/agent-mcp.mjs）。
// 跑法：node tools/serve.mjs [--no-open]

import { createServer, get } from 'node:http'
import { createReadStream, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { createAgentHub } from './agent-mcp.mjs'

const PORT = Number(process.env.PORT || 41730)
const APP = join(dirname(fileURLToPath(import.meta.url)), '..', 'app')
const URL_ = `http://localhost:${PORT}/`
const VERSION = (() => { try { return String(JSON.parse(readFileSync(join(APP, 'version.json'), 'utf8')).version || '') } catch { return '' } })()
const agent = createAgentHub({ port: PORT, version: VERSION })
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.wasm': 'application/wasm', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.webm': 'video/webm',
}

function openBrowser(url) {
  if (process.argv.includes('--no-open')) return
  const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]]
  try { spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).unref() } catch { /* 开不了就请使用者自己点 */ }
}

const server = createServer(async (req, res) => {
  try { if (await agent.handle(req, res)) return } catch (e) { if (!res.headersSent) res.writeHead(500).end(); console.error(e); return }
  let path
  try { path = decodeURIComponent(new URL(req.url || '/', 'http://x').pathname) } catch { res.writeHead(400).end(); return }
  if (path.endsWith('/')) path += 'index.html'
  const file = normalize(join(APP, path))
  if (file !== APP && !file.startsWith(APP + sep)) { res.writeHead(403).end(); return }
  let st
  try { st = statSync(file) } catch { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('not found'); return }
  if (st.isDirectory()) { res.writeHead(302, { Location: path + '/' }).end(); return }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' })
  if (req.method === 'HEAD') { res.end(); return }
  createReadStream(file).pipe(res)
})

/** 埠上已经开着的那份：不是 Dilin Studio ⇒ null；是 ⇒ 它的 version.json（版本＋来源提交） */
function runningStudio() {
  return new Promise(resolve => {
    const r = get({ host: '127.0.0.1', port: PORT, path: '/version.json', timeout: 1500 }, res => {
      let body = ''
      res.on('data', c => { body += c })
      res.on('end', () => { try { const j = JSON.parse(body); resolve(j && j.name === 'dilin-studio' ? j : null) } catch { resolve(null) } })
    })
    r.on('error', () => resolve(null))
    r.on('timeout', () => { r.destroy(); resolve(null) })
  })
}
/** 这份包自己的 version.json（app/ 里；读不到 ⇒ null） */
function ownVersion() {
  try { return JSON.parse(readFileSync(join(APP, 'version.json'), 'utf8')) } catch { return null }
}

server.on('error', async e => {
  const other = e.code === 'EADDRINUSE' ? await runningStudio() : null
  if (other) {
    // 同一份（版本、来源提交都一样）才直接开浏览器；别的版本还开着 ⇒ 不去开它（不然开到的是旧版、自己还以为是新版）
    const mine = ownVersion()
    if (!mine || (other.version === mine.version && other.sourceCommit === mine.sourceCommit)) {
      console.log(`Dilin Studio 已經開著：${URL_}`)
      openBrowser(URL_)
      process.exit(0)
    }
    console.error(`埠 ${PORT} 上已經開著另一份 Dilin Studio（${other.version || '?'}），這份是 ${mine.version || '?'}。請先關掉那份的視窗（或按 Ctrl+C），再重開這份。`)
    process.exit(1)
  }
  console.error(e.code === 'EADDRINUSE' ? `埠 ${PORT} 被別的程式佔了。請關掉它，或用 PORT=別的數字 再開（換埠看不到之前存在瀏覽器裡的工程）。` : String(e))
  process.exit(1)
})

server.listen(PORT, '127.0.0.1', () => {
  // ::1（IPv6 本机）也听一份：有的系统 localhost 先解析到 ::1
  const v6 = createServer(server.listeners('request')[0])
  v6.on('error', () => {})
  v6.listen(PORT, '::1')
  console.log(`Dilin Studio 開在 ${URL_}（關掉這個視窗或按 Ctrl+C 就停）`)
  console.log(`給 AI 的 MCP：${URL_}mcp（要開著畫板或剪輯那頁）`)
  openBrowser(URL_)
})

#!/usr/bin/env node
// Dilin Studio 画板命令列版：不开画面，用这台电脑的 Chrome／Edge／Chromium 无头开一页画板（同一套引擎、同一套命令与参数规格），
// 读进工程（或照分层打开一份 PSD／SVG／PDF／Illustrator .ai）→ 照步骤跑命令 → 汇出分层 PSD／.ai／PNG／工程档。也能只开着给 AI 接 MCP（serve）。零依赖（node 内建）。
//
// 跑法：
//   node tools/paint-cli.mjs run [--project <工程资料夹或 project.json> | --open <档.psd|.psb|.svg|.pdf|.ai|.kra|.ora|.xcf|.procreate>] [--steps <steps.json>] [--step '<{"command":…,"params":{…}}>' …] [--out <档.psd|档.ai|档.png|资料夹/>]
//   node tools/paint-cli.mjs serve [--project <…>]      ⇒ 印出 MCP 网址（http://localhost:<埠>/mcp），按 Ctrl+C 停
//   node tools/paint-cli.mjs commands [--filter <字>]    ⇒ 列命令与参数规格（JSON）
// 选项：--port <埠>（缺省 41731；跟开着的单机版 41730 错开）、--chrome <浏览器执行档>（或环境变数 CHROME）、--timeout <秒>（每件活·缺省 120）
// steps.json＝[{ "command": "layer.newText", "params": { … } }, …]（同 paint_batch；遇到第一个错就停、退出码 1）。

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function parse(argv) {
  const o = { cmd: argv[0], steps: [], port: 41731, timeout: 120 }
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i], v = () => { if (i + 1 >= argv.length) die(`${a} 後面要接值`); return argv[++i] }
    if (a === '--project') o.project = v()
    else if (a === '--open') o.open = v()
    else if (a === '--steps') o.stepsFile = v()
    else if (a === '--step') o.steps.push(JSON.parse(v()))
    else if (a === '--out') o.out = v()
    else if (a === '--port') o.port = Number(v())
    else if (a === '--chrome') o.chrome = v()
    else if (a === '--timeout') o.timeout = Number(v())
    else if (a === '--filter') o.filter = v()
    else die(`不認得的選項 ${a}`)
  }
  return o
}
function die(msg) { console.error(msg); console.error('用法：node tools/paint-cli.mjs run|serve|commands …（見檔頭說明）'); process.exit(2) }

/** 这台电脑的 Chrome／Edge／Chromium */
export function findBrowser(env = process.env, platform = process.platform, exists = existsSync) {
  if (env.CHROME) return env.CHROME
  const L = platform === 'darwin'
    ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Chromium.app/Contents/MacOS/Chromium', '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser']
    : platform === 'win32'
      ? [env['PROGRAMFILES'], env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean).flatMap((d) => [join(d, 'Google/Chrome/Application/chrome.exe'), join(d, 'Microsoft/Edge/Application/msedge.exe'), join(d, 'Chromium/Application/chrome.exe')])
      : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium', '/usr/bin/microsoft-edge']
  return L.find((p) => exists(p)) || null
}

function post(port, path, body, timeoutMs) {
  return new Promise((res, rej) => {
    const b = JSON.stringify(body)
    const q = request({ host: '127.0.0.1', port, path, method: 'POST', timeout: timeoutMs, headers: { Host: `localhost:${port}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) } }, (r) => {
      let out = ''; r.setEncoding('utf8'); r.on('data', (c) => { out += c }); r.on('end', () => { try { res({ status: r.statusCode, j: JSON.parse(out) }) } catch { res({ status: r.statusCode, j: out }) } })
    })
    q.on('timeout', () => q.destroy(new Error('timeout'))); q.on('error', rej); q.end(b)
  })
}
const job = async (port, j, timeoutS) => (await post(port, '/_agent/cli', { editor: 'paint', job: j, timeoutMs: timeoutS * 1000 }, timeoutS * 1000 + 5000)).j

/** 读工程：资料夹（project.json＋assets/）或单一 project.json */
export function readProject(p) {
  const file = statSync(p).isDirectory() ? join(p, 'project.json') : p
  const json = JSON.parse(readFileSync(file, 'utf8'))
  const adir = join(dirname(file), 'assets'), assets = {}
  if (existsSync(adir)) for (const n of readdirSync(adir)) { const f = join(adir, n); if (statSync(f).isFile()) assets[n] = readFileSync(f).toString('base64') }
  return { json, assets }
}

/** 汇出档名 ⇒ 格式 */
export function formatOf(out) {
  const e = extname(out).toLowerCase()
  if (e === '.psd') return 'psd'
  if (e === '.ai') return 'ai'
  if (e === '.psb') return 'psb'
  if (e === '.ora') return 'ora'
  if (e === '.png') return 'png'
  if (e === '' || out.endsWith('/') || out.endsWith('\\')) return 'project'
  return null
}

async function boot(o) {
  const browser = o.chrome || findBrowser()
  if (!browser) throw new Error('這台電腦找不到 Chrome／Edge／Chromium：裝一個，或用 --chrome <執行檔> 指定')
  const kids = []
  const prof = mkdtempSync(join(tmpdir(), 'dilin-paint-cli-'))
  const stop = () => {
    for (const k of kids) { try { k.kill() } catch { /* 已停 */ } }
    // 启动器早退了（Windows）⇒ 真正的浏览器不是我们的子行程，按这次专用的设定档资料夹找出来关掉
    if (process.platform === 'win32') {
      try { spawnSync('powershell', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${prof.replace(/'/g, "''")}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`], { stdio: 'ignore', timeout: 10000 }) } catch { /* 关不掉就算了 */ }
    }
    setTimeout(() => { try { rmSync(prof, { recursive: true, force: true }) } catch { /* 浏览器还没放手 */ } }, 500) }
  try {
    const srv = spawn(process.execPath, [join(HERE, 'serve.mjs'), '--no-open'], { env: { ...process.env, PORT: String(o.port) }, stdio: ['ignore', 'ignore', 'pipe'] })
    kids.push(srv)
    let err = ''; srv.stderr.on('data', (d) => { err += d })
    for (let i = 0; ; i++) {
      if (srv.exitCode !== null) throw new Error(`本機小服務沒起來：${err.trim() || srv.exitCode}`)
      const r = await post(o.port, '/mcp', { jsonrpc: '2.0', id: 1, method: 'ping' }, 1000).catch(() => null)
      if (r && r.status === 200) break
      if (i > 100) throw new Error('本機小服務 10 秒內沒起來')
      await sleep(100)
    }
    const url = `http://localhost:${o.port}/index.html?app=paint&new=1&cli=1`
    const ch = spawn(browser, ['--headless=new', `--user-data-dir=${prof}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--window-size=1400,900', url], { stdio: 'ignore' })
    kids.push(ch)
    for (let i = 0; ; i++) {
      // Windows：chrome.exe 常把活交给另一个行程、自己退出码 0 ⇒ 只有非 0 才算没起来，0 就接着等页面连上
      if (ch.exitCode !== null && ch.exitCode !== 0) throw new Error(`瀏覽器沒起來（${browser}·退出碼 ${ch.exitCode}）`)
      const r = await post(o.port, '/mcp', { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'studio_pages', arguments: {} } }, 2000).catch(() => null)
      const t = r && r.j && r.j.result && r.j.result.content && r.j.result.content[0] && r.j.result.content[0].text
      if (t && t.startsWith('[') && JSON.parse(t).some((p) => p.editor === 'paint')) break
      if (i > 300) throw new Error('畫板 60 秒內沒開好')
      await sleep(200)
    }
    if (o.project) {
      const pr = readProject(resolve(o.project))
      const r = await job(o.port, { kind: 'load', json: pr.json, assets: pr.assets }, o.timeout)
      if (!r || !r.ok) throw new Error(`讀不進工程：${r && (r.message || r.error)}`)
    }
    return { stop }
  } catch (e) { stop(); throw e }
}

async function main() {
  const o = parse(process.argv.slice(2))
  if (!['run', 'serve', 'commands'].includes(o.cmd)) die('第一個參數要是 run、serve 或 commands')
  if (o.stepsFile) { const s = JSON.parse(readFileSync(o.stepsFile, 'utf8')); if (!Array.isArray(s)) die('--steps 檔要是陣列'); o.steps.unshift(...s) }
  if (o.open){   // 照分层打开：同「档案▸开启」——开一个新分页再读进去（ps.document.open；⛔ ps.file.openAs 就地换掉宿主那份＝宿主解绑、页面离开）
    const ext = extname(o.open).toLowerCase(), mime = {'.pdf':'application/pdf', '.ai':'application/pdf', '.svg':'image/svg+xml', '.psd':'image/vnd.adobe.photoshop'}[ext] || 'application/octet-stream'
    if (!existsSync(o.open)) die(`找不到 ${o.open}`)
    o.steps.unshift({ command: 'ps.document.open', params: { url: `data:${mime};base64,${readFileSync(o.open).toString('base64')}`, name: o.open.split(/[\\/]/).pop() } })
  }
  const fmt = o.out ? formatOf(o.out) : null
  if (o.out && !fmt) die('--out 要是 .psd、.psb、.ai、.ora、.png，或一個資料夾（存 project.json＋assets/）')
  const { stop } = await boot(o)
  let code = 0
  try {
    if (o.cmd === 'serve') {
      console.log(`畫板命令列版開著：MCP ${`http://localhost:${o.port}/mcp`}（工具同單機版：paint_list_commands／paint_run／paint_batch／paint_preview／paint_export）。按 Ctrl+C 停。`)
      await new Promise((r) => { process.on('SIGINT', r); process.on('SIGTERM', r) })
      return
    }
    if (o.cmd === 'commands') {
      const r = await job(o.port, { kind: 'list', ...(o.filter ? { filter: o.filter } : {}) }, o.timeout)
      process.stdout.write(JSON.stringify(r.ok ? r.result : r, null, 1) + '\n')
      if (!r.ok) code = 1
      return
    }
    if (o.steps.length) {
      const r = await job(o.port, { kind: 'batch', steps: o.steps }, o.timeout)
      process.stdout.write(JSON.stringify(r.ok ? r.result : r, null, 1) + '\n')
      if (!r.ok || (r.result && r.result.error)) { code = 1; return }
    }
    if (o.out) {
      const r = await job(o.port, { kind: 'export', format: fmt, save: false }, o.timeout)
      if (!r.ok) { console.error(`匯出失敗：${r.message || r.error}`); code = 1; return }
      const files = r.result.files
      if (fmt === 'project') {
        for (const f of files) { const p = join(o.out, f.name); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, Buffer.from(f.base64, 'base64')) }
        console.log(`已存：${resolve(o.out)}（${files.map((f) => f.name).join('、')}）`)
      } else {
        mkdirSync(dirname(resolve(o.out)), { recursive: true })
        writeFileSync(o.out, Buffer.from(files[0].base64, 'base64'))
        console.log(`已存：${resolve(o.out)}（${files[0].bytes} 位元組）`)
        if (Array.isArray(r.result.notes) && r.result.notes.length) console.log(`照畫面嵌成圖的：${r.result.notes.join('；')}`)
      }
    }
  } finally { stop(); process.exitCode = code }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e && e.message ? e.message : e); process.exit(1) })

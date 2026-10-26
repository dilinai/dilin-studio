// Dilin Studio 命令列版共用：用这台电脑的 Chrome／Edge／Chromium 无头开一页编辑器（同一套页面），经本机小服务把活交给那页。
//   tools/docs-cli.mjs、tools/slides-cli.mjs 要浏览器排版的汇出（Word、PDF、网页版、PowerPoint）用它；纯算得出的不开浏览器。
//   跟浏览器讲话走两条：本机小服务（tools/serve.mjs＋agent-mcp.mjs）的 /_agent/cli ⇒ 页面里的 load／export／read 活；
//   DevTools 协定（--remote-debugging-pipe·不开埠）⇒ 页面上跑一句 JS、列印成 PDF。零依赖（node 内建）。

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findBrowser } from './paint-cli.mjs'

export { findBrowser }
const HERE = dirname(fileURLToPath(import.meta.url))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export function post(port, path, body, timeoutMs) {
  return new Promise((res, rej) => {
    const b = JSON.stringify(body)
    const q = request({ host: '127.0.0.1', port, path, method: 'POST', timeout: timeoutMs, headers: { Host: `localhost:${port}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) } }, (r) => {
      let out = ''; r.setEncoding('utf8'); r.on('data', (c) => { out += c }); r.on('end', () => { try { res({ status: r.statusCode, j: JSON.parse(out) }) } catch { res({ status: r.statusCode, j: out }) } })
    })
    q.on('timeout', () => q.destroy(new Error('timeout'))); q.on('error', rej); q.end(b)
  })
}

/** DevTools 协定走管线（fd 3 写、fd 4 读·每则讯息以 \0 结尾） */
export function cdpOverPipe(write, read) {
  let seq = 0, buf = ''
  const wait = new Map()
  read.setEncoding('utf8')
  read.on('data', (chunk) => {
    buf += chunk
    let i
    while ((i = buf.indexOf('\0')) >= 0) {
      const msg = buf.slice(0, i); buf = buf.slice(i + 1)
      let m; try { m = JSON.parse(msg) } catch { continue }
      const w = m.id !== undefined && wait.get(m.id)
      if (w) { wait.delete(m.id); m.error ? w.rej(new Error(`${m.error.message}${m.error.data ? ` (${m.error.data})` : ''}`)) : w.res(m.result) }
    }
  })
  return {
    send(method, params = {}, sessionId) {
      const id = ++seq
      return new Promise((res, rej) => { wait.set(id, { res, rej }); write.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0') })
    },
  }
}

/**
 * 开一页：起本机小服务（另一个埠·不跟开着的单机版 41730 撞）→ 无头浏览器开 index.html?app=<编辑器>&new=1&cli=1 → 等那页接上小服务。
 * 回 { job(活, 秒), evaluate(式子), cdp, session, stop }；o.project＝{ json, assets } ⇒ 先换成这份工程。
 */
export async function openPage(o) {
  const browser = o.chrome || findBrowser()
  if (!browser) throw new Error('這台電腦找不到 Chrome／Edge／Chromium：裝一個，或用 --chrome <執行檔> 指定')
  const kids = []
  const prof = mkdtempSync(join(tmpdir(), `dilin-${o.app}-cli-`))
  const stop = () => {
    for (const k of kids) { try { k.kill() } catch { /* 已停 */ } }
    // 启动器早退了（Windows）⇒ 真正的浏览器不是我们的子行程，按这次专用的设定档资料夹找出来关掉
    if (process.platform === 'win32') {
      try { spawnSync('powershell', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${prof.replace(/'/g, "''")}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`], { stdio: 'ignore', timeout: 10000 }) } catch { /* 关不掉就算了 */ }
    }
    setTimeout(() => { try { rmSync(prof, { recursive: true, force: true }) } catch { /* 浏览器还没放手 */ } }, 500)
  }
  const job = async (j, timeoutS = o.timeout) => (await post(o.port, '/_agent/cli', { editor: o.app, job: j, timeoutMs: timeoutS * 1000 }, timeoutS * 1000 + 5000)).j
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
    const url = `http://localhost:${o.port}/index.html?app=${o.app}&new=1&cli=1`
    const ch = spawn(browser, ['--headless=new', `--user-data-dir=${prof}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--remote-debugging-pipe', '--window-size=1400,900', url], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] })
    kids.push(ch)
    const cdp = cdpOverPipe(ch.stdio[3], ch.stdio[4])
    for (let i = 0; ; i++) {
      // Windows：chrome.exe 常把活交给另一个行程、自己退出码 0 ⇒ 只有非 0 才算没起来
      if (ch.exitCode !== null && ch.exitCode !== 0) throw new Error(`瀏覽器沒起來（${browser}·退出碼 ${ch.exitCode}）`)
      const r = await post(o.port, '/mcp', { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'studio_pages', arguments: {} } }, 2000).catch(() => null)
      const t = r && r.j && r.j.result && r.j.result.content && r.j.result.content[0] && r.j.result.content[0].text
      if (t && t.startsWith('[') && JSON.parse(t).some((p) => p.editor === o.app)) break
      if (i > 300) throw new Error(`${o.app} 頁 60 秒內沒開好`)
      await sleep(200)
    }
    const { targetInfos } = await cdp.send('Target.getTargets')
    const target = targetInfos.find((t) => t.type === 'page' && t.url.includes(`localhost:${o.port}`))
    if (!target) throw new Error('找不到那一頁（DevTools）')
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true })
    const evaluate = async (expression) => {
      const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId)
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
      return r.result.value
    }
    if (o.project) {
      const r = await job({ kind: 'load', json: o.project.json, assets: o.project.assets })
      if (!r || !r.ok) throw new Error(`讀不進工程：${r && (r.message || r.error)}`)
    }
    return { job, evaluate, cdp, session: sessionId, stop }
  } catch (e) { stop(); throw e }
}

/** 工程资料夹或 project.json ⇒ project.json 的完整路径（找不到 ⇒ 丢错） */
export function projectFile(p) {
  if (!existsSync(p)) throw new Error(`找不到 ${p}`)
  const f = statSync(p).isDirectory() ? join(p, 'project.json') : p
  if (!existsSync(f)) throw new Error(`找不到 ${f}`)
  return resolve(f)
}

/** --out ⇒ 汇出档完整路径：给的是这种副档名的档就照用，不然当资料夹（缺省＝工程资料夹） */
export function outPath(out, projDir, base, ext) {
  if (out && extname(out).toLowerCase() === `.${ext}`) return resolve(out)
  return join(out ? resolve(out) : projDir, `${base}.${ext}`)
}

/** 页面汇出档（base64）⇒ Buffer */
export const fileBytes = (f) => Buffer.from(f.base64, 'base64')

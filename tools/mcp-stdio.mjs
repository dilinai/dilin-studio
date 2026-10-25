#!/usr/bin/env node
// 只吃 stdio 的 AI 工具用这支接本机 MCP：每一行 JSON-RPC 转给开着的本机小服务（http://localhost:41730/mcp），回包照行写回。
//   本机小服务要先开着（start-mac.command／start-windows.bat／start-linux，或 node tools/serve.mjs）；没开 ⇒ 每问都回一句「先打开 Dilin Studio」。
//   埠不是 41730 ⇒ PORT=xxxx node tools/mcp-stdio.mjs
// 设定：AI 工具的 MCP 设定里命令填 node、参数填 <这个仓>/tools/mcp-stdio.mjs

import { request } from 'node:http'
import { createInterface } from 'node:readline'

const PORT = Number(process.env.PORT || 41730)
const DOWN = `Dilin Studio is not running on this computer (nothing answers on http://localhost:${PORT}). Ask the user to start it (start-mac.command, start-windows.bat, start-linux, or node tools/serve.mjs) and open the editor, then try again.`

function post(body) {
  return new Promise((resolve) => {
    const req = request({ host: '127.0.0.1', port: PORT, path: '/mcp', method: 'POST', headers: { 'Content-Type': 'application/json', Host: `localhost:${PORT}`, 'Content-Length': Buffer.byteLength(body) } }, (res) => {
      let out = ''
      res.setEncoding('utf8')
      res.on('data', (c) => { out += c })
      res.on('end', () => resolve({ status: res.statusCode, out }))
    })
    req.on('error', () => resolve(null))
    req.end(body)
  })
}

/** 服务没开着 ⇒ 照协议自己回（初始化与工具清单也要回得出来，AI 才看得到这句） */
function offline(m) {
  if (!m || m.id === undefined) return null
  const ok = (result) => ({ jsonrpc: '2.0', id: m.id, result })
  if (m.method === 'initialize') return ok({ protocolVersion: (m.params && m.params.protocolVersion) || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'dilin-studio', version: 'offline' }, instructions: DOWN })
  if (m.method === 'ping') return ok({})
  if (m.method === 'tools/list') return ok({ tools: [{ name: 'studio_pages', description: DOWN, inputSchema: { type: 'object', properties: {} } }] })
  if (m.method === 'tools/call') return ok({ content: [{ type: 'text', text: DOWN }], isError: true })
  return { jsonrpc: '2.0', id: m.id, error: { code: -32000, message: DOWN } }
}

const rl = createInterface({ input: process.stdin })
let chain = Promise.resolve()
rl.on('line', (line) => {
  const t = line.trim()
  if (!t) return
  chain = chain.then(async () => {
    let m
    try { m = JSON.parse(t) } catch { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) + '\n'); return }
    const r = await post(t)
    if (!r) { const o = offline(m); if (o) process.stdout.write(JSON.stringify(o) + '\n'); return }
    if (r.status === 202 || !r.out) return
    process.stdout.write(r.out.replace(/\n/g, ' ') + '\n')
  })
})
rl.on('close', () => { chain.then(() => process.exit(0)) })

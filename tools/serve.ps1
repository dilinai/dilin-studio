# 本机小服务（Windows 版·用 Windows 自带的 PowerShell，不用另装东西）：把 app\ 放在 http://localhost:41730/ 上、自动打开浏览器。只听本机。
#   埠固定 41730：工程存在浏览器里时记在这个网址底下。已经开着一份 ⇒ 直接打开浏览器就结束。
param([switch]$NoOpen)
$ErrorActionPreference = 'Stop'
$port = if ($env:PORT) { [int]$env:PORT } else { 41730 }
$app = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\app'))
$url = "http://localhost:$port/"
$types = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.mjs' = 'text/javascript; charset=utf-8'; '.css' = 'text/css; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'; '.txt' = 'text/plain; charset=utf-8'; '.svg' = 'image/svg+xml'; '.png' = 'image/png'; '.jpg' = 'image/jpeg'
  '.jpeg' = 'image/jpeg'; '.gif' = 'image/gif'; '.webp' = 'image/webp'; '.ico' = 'image/x-icon'; '.woff' = 'font/woff'; '.woff2' = 'font/woff2'
  '.ttf' = 'font/ttf'; '.wasm' = 'application/wasm'; '.mp3' = 'audio/mpeg'; '.mp4' = 'video/mp4'; '.webm' = 'video/webm'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($url)
try { $listener.Start() } catch {
  try {
    $v = Invoke-RestMethod -Uri ($url + 'version.json') -TimeoutSec 2
    if ($v.name -eq 'dilin-studio') {
      Write-Host "Dilin Studio 已經開著：$url"
      if (-not $NoOpen) { Start-Process $url }
      exit 0
    }
  } catch {}
  Write-Host "埠 $port 被別的程式佔了。請關掉它再開（換埠看不到之前存在瀏覽器裡的工程）。"
  exit 1
}
Write-Host "Dilin Studio 開在 $url（關掉這個視窗就停）"
if (-not $NoOpen) { Start-Process $url }

while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $res = $ctx.Response
  try {
    $path = [System.Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath)
    if ($path.EndsWith('/')) { $path += 'index.html' }
    $file = [System.IO.Path]::GetFullPath((Join-Path $app ($path.TrimStart('/').Replace('/', '\'))))
    if (-not $file.StartsWith($app + '\') -and $file -ne $app) { $res.StatusCode = 403 }
    elseif (-not [System.IO.File]::Exists($file)) { $res.StatusCode = 404 }
    else {
      $ext = [System.IO.Path]::GetExtension($file).ToLower()
      $res.ContentType = if ($types.ContainsKey($ext)) { $types[$ext] } else { 'application/octet-stream' }
      $res.AddHeader('Cache-Control', 'no-cache')
      $res.AddHeader('X-Content-Type-Options', 'nosniff')
      $bytes = [System.IO.File]::ReadAllBytes($file)
      $res.ContentLength64 = $bytes.Length
      if ($ctx.Request.HttpMethod -ne 'HEAD') { $res.OutputStream.Write($bytes, 0, $bytes.Length) }
    }
  } catch { try { $res.StatusCode = 500 } catch {} }
  finally { try { $res.Close() } catch {} }
}

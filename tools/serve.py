#!/usr/bin/env python3
# 本机小服务（Python 版·电脑上没有 Node 时用）：把 app/ 放在 http://localhost:41730/ 上、自动打开浏览器。只听本机（127.0.0.1）。
#   埠固定 41730：工程存在浏览器里时记在这个网址底下；要换：PORT=xxxx python3 tools/serve.py
#   已经开着一份 ⇒ 直接打开浏览器就结束。
import http.server, json, os, sys, urllib.request, webbrowser, functools

PORT = int(os.environ.get('PORT', '41730'))
APP = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'app')
URL = 'http://localhost:%d/' % PORT


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = dict(http.server.SimpleHTTPRequestHandler.extensions_map, **{
        '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
        '.wasm': 'application/wasm', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.webp': 'image/webp',
    })

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('X-Content-Type-Options', 'nosniff')
        super().end_headers()

    def log_message(self, *args):
        pass


def already_ours():
    try:
        with urllib.request.urlopen('http://127.0.0.1:%d/version.json' % PORT, timeout=1.5) as r:
            return json.loads(r.read().decode('utf-8')).get('name') == 'dilin-studio'
    except Exception:
        return False


def main():
    no_open = '--no-open' in sys.argv
    try:
        httpd = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), functools.partial(Handler, directory=APP))
    except OSError:
        if already_ours():
            print('Dilin Studio 已經開著：' + URL)
            if not no_open:
                webbrowser.open(URL)
            return
        print('埠 %d 被別的程式佔了。請關掉它，或用 PORT=別的數字 再開（換埠看不到之前存在瀏覽器裡的工程）。' % PORT)
        sys.exit(1)
    print('Dilin Studio 開在 %s（關掉這個視窗或按 Ctrl+C 就停）' % URL)
    if not no_open:
        webbrowser.open(URL)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()

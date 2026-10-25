#!/bin/sh
# Dilin Studio：在 http://localhost:41730 開啟（Linux）。有 Node 用 Node，沒有就用 Python 3，再沒有用 Perl。關掉這個視窗或按 Ctrl+C 就停。
cd "$(dirname "$0")" || exit 1
if command -v node >/dev/null 2>&1; then exec node tools/serve.mjs "$@"; fi
if command -v python3 >/dev/null 2>&1; then exec python3 tools/serve.py "$@"; fi
if command -v perl >/dev/null 2>&1; then exec perl tools/serve.pl "$@"; fi
echo "需要 Node、Python 3 或 Perl 其中一樣才能開（這台電腦一樣都沒有）。"
exit 1

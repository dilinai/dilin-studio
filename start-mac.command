#!/bin/sh
# Dilin Studio：在 http://localhost:41730 開啟（Mac·點兩下就跑）。有 Node 用 Node，沒有就用 Mac 自帶的 Perl。關掉這個視窗就停。
cd "$(dirname "$0")" || exit 1
if command -v node >/dev/null 2>&1; then exec node tools/serve.mjs "$@"; fi
exec perl tools/serve.pl "$@"

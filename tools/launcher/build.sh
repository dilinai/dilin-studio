#!/bin/sh
# 重新編譯 Linux 啟動器（倉根的 start-linux 與 start-linux-arm64）。靜態連結：不挑發行版。
set -e
cd "$(dirname "$0")/../.."
gcc -static -Os -s -o start-linux tools/launcher/start-linux.c
aarch64-linux-gnu-gcc -static -Os -s -o start-linux-arm64 tools/launcher/start-linux.c

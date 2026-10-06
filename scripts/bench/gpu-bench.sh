#!/usr/bin/env bash
# WSL launcher for gpu-bench.mjs: copies it next to playwright-core on the Windows side and runs it with
# Windows Node (Chrome's CDP port is only reachable from Windows). Results land in C:\wsp-tools\bench and are
# copied to docs/performance/cpuperf/. All arguments are passed through (see gpu-bench.mjs).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
drv=/mnt/c/wsp-tools/drv
cp "$here/gpu-bench.mjs" "$drv/gpu-bench.mjs"
cd "$drv"
/mnt/c/wsp-tools/node-v24.14.1-win-x64/node.exe 'C:\wsp-tools\drv\gpu-bench.mjs' "$@"
mkdir -p "$here/../../docs/performance/cpuperf"
cp /mnt/c/wsp-tools/bench/*.json /mnt/c/wsp-tools/bench/*.md "$here/../../docs/performance/cpuperf/" 2>/dev/null || true

#!/usr/bin/env bash
# WSL launcher for gpu-profile.mjs: copies it next to playwright-core on the Windows side and runs it with
# Windows Node (Chrome's CDP port is only reachable from Windows). --out writes C:\wsp-tools\bench\<out>.cpuprofile.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
drv=/mnt/c/wsp-tools/drv
cp "$here/gpu-profile.mjs" "$drv/gpu-profile.mjs"
cd "$drv"
/mnt/c/wsp-tools/node-v24.14.1-win-x64/node.exe 'C:\wsp-tools\drv\gpu-profile.mjs' "$@"

#!/usr/bin/env bash
# WSL launcher for gpu-passes.mjs (Windows Node next to playwright-core; CDP 9333 is only reachable from Windows).
# Results: C:\wsp-tools\bench\perfgpu\<label>.json, screenshots C:\wsp-tools\shots\perfgpu\.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
drv=/mnt/c/wsp-tools/drv
cp "$here/gpu-passes.mjs" "$drv/gpu-passes.mjs"
cd "$drv"
args=(); for a in "$@"; do if [ -f "$a" ] && [[ "$a" == *.js ]]; then cp "$a" "$drv/eval-$(basename "$a")"; args+=("C:\\wsp-tools\\drv\\eval-$(basename "$a")"); else args+=("$a"); fi; done
/mnt/c/wsp-tools/node-v24.14.1-win-x64/node.exe 'C:\wsp-tools\drv\gpu-passes.mjs' "${args[@]}"

#!/usr/bin/env bash
# WSL launcher for heap-probe.mjs (Windows Node next to playwright-core; CDP 9333 is only reachable from Windows).
# Wrap in the shared GPU lock: flock /tmp/wsp-gpu.lock scripts/bench/heap-probe.sh --base http://<ip>:5511 ...
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
drv=/mnt/c/wsp-tools/drv
cp "$here/heap-probe.mjs" "$drv/heap-probe-stages.mjs"
cd "$drv"
/mnt/c/wsp-tools/node-v24.14.1-win-x64/node.exe 'C:\wsp-tools\drv\heap-probe-stages.mjs' "$@"

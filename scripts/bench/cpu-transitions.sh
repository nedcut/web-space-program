#!/usr/bin/env bash
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
# Re-exec under the shared lock before copying drivers or opening Chrome.
if [[ "${WSP_CPU_LOCKED:-}" != 1 ]]; then
  exec flock /tmp/wsp-gpu.lock env WSP_CPU_LOCKED=1 bash "$0" "$@"
fi
cp "$here/cpu-transitions.mjs" /mnt/c/wsp-tools/drv/cpu-transitions.mjs
cd /mnt/c/wsp-tools/drv
/mnt/c/wsp-tools/node-v24.14.1-win-x64/node.exe 'C:\wsp-tools\drv\cpu-transitions.mjs' "$@"
mkdir -p "$here/../../docs/performance/perfcpu"
cp "/mnt/c/wsp-tools/bench/${2:-transitions}.json" "$here/../../docs/performance/perfcpu/"

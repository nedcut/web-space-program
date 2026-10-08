#!/usr/bin/env bash
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
if [[ "${WSP_CPU_LOCKED:-}" != 1 ]]; then
  exec flock /tmp/wsp-gpu.lock env WSP_CPU_LOCKED=1 bash "$0" "$@"
fi
cp "$here/cpu-pass2.mjs" "$here/trace-stream.mjs" /mnt/c/wsp-tools/drv/
trap 'mkdir -p "$here/../../docs/performance/perfcpu2"; cp /mnt/c/wsp-tools/bench/"${2}"* "$here/../../docs/performance/perfcpu2/" 2>/dev/null || true' EXIT
cd /mnt/c/wsp-tools/drv
/mnt/c/wsp-tools/node-v24.14.1-win-x64/node.exe 'C:\wsp-tools\drv\cpu-pass2.mjs' "$@"

#!/usr/bin/env bash
# Uses the established flight suite, preserving raw CDP traces as well as summaries.
# Example: cpu-flight.sh --base http://<WSL-IP>:5334 --label before --throttle 4 --cases journey,moon --seconds 120
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
if [[ "${WSP_CPU_LOCKED:-}" != 1 ]]; then
  exec flock /tmp/wsp-gpu.lock env WSP_CPU_LOCKED=1 bash "$0" "$@"
fi
cp "$here/gpu-bench.mjs" /mnt/c/wsp-tools/drv/cpu-flight.mjs
label=run
args=("$@")
for ((i=0; i<$#; i++)); do
  if [[ "${args[i]}" == --label ]]; then label="${args[i+1]}"; fi
done
cd /mnt/c/wsp-tools/drv
/mnt/c/wsp-tools/node-v24.14.1-win-x64/node.exe 'C:\wsp-tools\drv\cpu-flight.mjs' --save-traces 1 "$@"
mkdir -p "$here/../../docs/performance/perfcpu"
cp /mnt/c/wsp-tools/bench/"$label"* "$here/../../docs/performance/perfcpu/"

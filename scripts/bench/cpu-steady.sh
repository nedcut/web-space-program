#!/usr/bin/env bash
# Interleaved steady pad/ascent/orbit CPU A/B. Example:
#   cpu-steady.sh steady-4x 4 medium 2 main=http://<WSL-IP>:5350 after=http://<WSL-IP>:5352
# STEADY_PROFILE=1 also saves a CDP .cpuprofile per window (see cpu-profile-report.mjs).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
if [[ "${WSP_CPU_LOCKED:-}" != 1 ]]; then
  exec flock /tmp/wsp-gpu.lock env WSP_CPU_LOCKED=1 bash "$0" "$@"
fi
cp "$here/cpu-steady.mjs" /mnt/c/wsp-tools/drv/
cd /mnt/c/wsp-tools/drv
WSLENV=STEADY_SECS:STEADY_PROFILE /mnt/c/wsp-tools/node-v24.14.1-win-x64/node.exe 'C:\wsp-tools\drv\cpu-steady.mjs' "$@"
mkdir -p "$here/../../docs/performance/perfcpu2/round2"
cp /mnt/c/wsp-tools/bench/"$1".json "$here/../../docs/performance/perfcpu2/round2/"

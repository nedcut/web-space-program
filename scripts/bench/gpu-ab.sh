#!/usr/bin/env bash
# Interleaved A/B on the real-GPU Chrome: for every case, runs revision A then B (then repeats), so both see the
# same machine/GPU conditions (the browser and GPU are shared with other work). Writes medians per case to
# docs/performance/cpuperf/ab-<name>.{json,md}.
#   scripts/bench/gpu-ab.sh <name> <baseA> <baseB> "<cases>" <reps> [extra gpu-bench args…]
# e.g. scripts/bench/gpu-ab.sh dpr2 http://localhost:5318 http://localhost:5315 "pad,orbit" 2 --dpr 2
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
name=$1; A=$2; B=$3; cases=$4; reps=$5; shift 5
drv=/mnt/c/wsp-tools/drv; out='C:\wsp-tools\bench\ab'; mkdir -p /mnt/c/wsp-tools/bench/ab
cp "$here/gpu-bench.mjs" "$drv/gpu-bench.mjs"
cd "$drv"
for r in $(seq "$reps"); do
  for c in ${cases//,/ }; do
    for side in A B; do
      base=$A; [ "$side" = B ] && base=$B
      /mnt/c/wsp-tools/node-v24.14.1-win-x64/node.exe 'C:\wsp-tools\drv\gpu-bench.mjs' --label "$name-$side-$c-r$r" --base "$base" --cases "$c" --out "$out" "$@" | grep -E "^==|^!!" || true
    done
  done
done
node "$here/gpu-ab-report.mjs" "$name" /mnt/c/wsp-tools/bench/ab "${AB_OUT:-$here/../../docs/performance/cpuperf}"

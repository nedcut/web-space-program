#!/usr/bin/env bash
# Interleaved A/B of GPU frame cost with gpu-passes.mjs: for each repetition and case, runs build A then build B
# back to back (same browser/GPU conditions; the harness is shared). Report: docs/performance/perfgpu/ab-<name>.md.
#   flock /tmp/wsp-gpu.lock scripts/bench/gpu-passes-ab.sh <name> <baseA> <baseB> "<cases>" <reps> [gpu-passes args…]
# Extra args apply to both sides; A-only / B-only args: AB_A_ARGS / AB_B_ARGS environment variables.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
name=$1; A=$2; B=$3; cases=$4; reps=$5; shift 5
for r in $(seq "$reps"); do
  for c in ${cases//,/ }; do
    for side in A B; do
      base=$A; extra=${AB_A_ARGS:-}; [ "$side" = B ] && { base=$B; extra=${AB_B_ARGS:-}; }
      shots=0; [ "$r" = 1 ] && shots=1
      # shellcheck disable=SC2086
      "$here/gpu-passes.sh" --base "$base" --label "ab-$name-$side-$c-r$r" --cases "$c" --shots "$shots" "$@" $extra | grep -E "^==|^!!" || true
    done
  done
done
node "$here/gpu-passes-report.mjs" "$name" /mnt/c/wsp-tools/bench/perfgpu "${AB_OUT:-$here/../../docs/performance/perfgpu}"

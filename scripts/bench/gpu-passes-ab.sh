#!/usr/bin/env bash
# Interleaved A/B of GPU frame cost with gpu-passes.mjs: for each repetition and case, runs build A then build B
# back to back (same browser/GPU conditions; the harness is shared). Report: docs/performance/perfgpu/ab-<name>.md.
#   scripts/bench/gpu-passes-ab.sh <name> <baseA> <baseB> "<cases>" <reps> [gpu-passes args…]
# Each A/B pair holds the shared GPU lock (/tmp/wsp-gpu.lock) so other harness users interleave between pairs.
# Extra args apply to both sides; A-only / B-only args: AB_A_ARGS / AB_B_ARGS environment variables.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
name=$1; A=$2; B=$3; cases=$4; reps=$5; shift 5
for r in $(seq "$reps"); do
  for c in ${cases//,/ }; do
    shots=0; [ "$r" = 1 ] && shots=1
    # shellcheck disable=SC2086
    flock /tmp/wsp-gpu.lock bash -c '
      "$0" --base "$1" --label "$2-A-$4-r$5" --cases "$4" --shots "$6" ${@:7} ${AB_A_ARGS:-} | grep -E "^==|^!!"
      "$0" --base "$3" --label "$2-B-$4-r$5" --cases "$4" --shots "$6" ${@:7} ${AB_B_ARGS:-} | grep -E "^==|^!!"
      true' "$here/gpu-passes.sh" "$A" "ab-$name" "$B" "$c" "$r" "$shots" "$@"

  done
done
node "$here/gpu-passes-report.mjs" "$name" /mnt/c/wsp-tools/bench/perfgpu "${AB_OUT:-$here/../../docs/performance/perfgpu}"

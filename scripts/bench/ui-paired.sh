#!/usr/bin/env bash
# Run from the perfui worktree. All measurements use production bundles; Chrome must expose CDP 9333.
# flock -w 60 /tmp/wsp-gpu.lock bash scripts/bench/ui-paired.sh
set -euo pipefail
bench_script="$(wslpath -w "$PWD/scripts/bench/ui-bench.mjs")"
win_node=/mnt/c/wsp-tools/node-v24.14.1-win-x64/node.exe
base=http://172.24.204.38:5336
WSP_UI_BASELINE=7bd6e4f9 WSP_PROFILE=1 npx vite build > .tmp/ui-before-build.log
"$win_node" "$bench_script" before-gpu "$base"
"$win_node" "$bench_script" before-gpu-detail "$base" detail
WSP_PROFILE=1 npx vite build > .tmp/ui-after-build.log
"$win_node" "$bench_script" after-gpu "$base"
"$win_node" "$bench_script" after-gpu-detail "$base" detail

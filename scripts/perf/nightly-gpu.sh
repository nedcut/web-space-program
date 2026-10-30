#!/usr/bin/env bash
set -euo pipefail
# Install this launcher at /home/nedcut/.t3/projects/wsp-tools/nightly-gpu.sh.
# No path to the development worktree is retained.
main=/home/nedcut/.t3/projects/web-space-program
repo=/home/nedcut/.t3/projects/wsp-wt/perf-nightly
nodewin=/mnt/c/wsp-tools/node-v24.14.1-win-x64/node.exe
if [[ "${1:-}" != --locked ]]; then
  exec flock /tmp/wsp-gpu.lock timeout 600 bash "$0" --locked
fi
if [[ ! -d "$repo" ]]; then
  git clone --no-hardlinks "$main" "$repo"
  git -C "$repo" remote set-url origin "$(git -C "$main" remote get-url origin)"
fi
[[ "$(git -C "$repo" rev-parse --show-toplevel)" == "$repo" ]] || exit 1
git -C "$repo" fetch origin main
# Only this dedicated, disposable nightly checkout is reset.
git -C "$repo" checkout --detach --force origin/main
sha="$(git -C "$repo" rev-parse HEAD)"
if cmp -s "$main/package-lock.json" "$repo/package-lock.json"; then
  [[ -e "$repo/node_modules" ]] || ln -s "$main/node_modules" "$repo/node_modules"
else
  [[ ! -L "$repo/node_modules" ]] || rm "$repo/node_modules"
  (cd "$repo" && npm ci)
fi
cd "$repo"
npm run build
pid=""
driver="/mnt/c/wsp-tools/drv/nightly-perf-$$.mjs"
output="/mnt/c/wsp-tools/bench/nightly-perf-$$"
cleanup() { [[ -z "$pid" ]] || kill "$pid" 2>/dev/null || true; rm -f "$driver"; }
trap cleanup EXIT
node node_modules/vite/bin/vite.js preview --host 0.0.0.0 --port 5568 --strictPort > /tmp/wsp-nightly-server.log 2>&1 &
pid=$!
for i in {1..60}; do
  kill -0 "$pid" || { cat /tmp/wsp-nightly-server.log; exit 1; }
  if curl -fsS http://localhost:5568/ >/dev/null; then break; fi
  sleep 1
done
# Override only for pre-merge harness calibration; normal scheduled runs use main.
harness_root="${WSP_PERF_HARNESS_ROOT:-$repo}"
if [[ ! -f "$harness_root/scripts/perf/nightly-gpu.mjs" ]]; then
  harness_root=/home/nedcut/.t3/projects/wsp-tools/perf-nightly-harness
fi
cp "$harness_root/scripts/bench/gpu-bench.mjs" "$driver"
mkdir -p "$output"
host="$(hostname -I | awk '{print $1}')"
"$nodewin" "$(wslpath -w "$driver")" --base "http://$host:5568" --nightly 1 --cases pad,ascent,orbit,moon,map,editor --seconds 10 --settle 10000 --trace 0 --out "$(wslpath -w "$output")" --label nightly
history="$HOME/.t3/projects/wsp-traces/perf-history"
mkdir -p "$history"
cp "$output/nightly-dpr2.json" "$history/raw-$(date -u +%Y%m%dT%H%M%S)-$$.json"
harness="$(sha256sum "$driver" | cut -d" " -f1)"
node "$harness_root/scripts/perf/nightly-gpu.mjs" "$output/nightly-dpr2.json" "$sha" "$history" "$harness"

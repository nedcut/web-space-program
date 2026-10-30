#!/usr/bin/env bash
set -euo pipefail
repo="$(cd "$(dirname "$0")/../.." && pwd)"
nodewin=/mnt/c/wsp-tools/node-v24.14.1-win-x64/node.exe
# Launch before acquiring the shared GPU lock. Reuse the owner's CDP profile.
if ! "$nodewin" -e "fetch('http://127.0.0.1:9333/json/version').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"; then
  /mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe -NoProfile -Command 'Start-Process "C:\Program Files\Google\Chrome\Application\chrome.exe" -ArgumentList "--remote-debugging-port=9333","--user-data-dir=C:\wsp-chrome-profile","--no-first-run"' >/dev/null
fi
if [[ "${1:-}" != --locked ]]; then
  exec flock /tmp/wsp-gpu.lock timeout 600 bash "$0" --locked
fi
temp="$(mktemp -d)"
pid=""
driver="/mnt/c/wsp-tools/drv/nightly-perf-$$.mjs"
output="/mnt/c/wsp-tools/bench/nightly-perf-$$"
cleanup() { [[ -z "$pid" ]] || kill "$pid" 2>/dev/null || true; rm -rf "$temp"; rm -f "$driver"; }
trap cleanup EXIT
cd "$repo"
git fetch origin main
sha="$(git rev-parse origin/main)"
git archive "$sha" | tar -x -C "$temp"
if cmp -s "$repo/package-lock.json" "$temp/package-lock.json"; then
  ln -s "$repo/node_modules" "$temp/node_modules"
else
  (cd "$temp" && npm ci)
fi
(cd "$temp" && npm run build)
(cd "$temp" && exec node "$temp/node_modules/vite/bin/vite.js" preview --host 0.0.0.0 --port 5568 --strictPort) >"$temp/server.log" 2>&1 &
pid=$!
for i in {1..60}; do
  kill -0 "$pid" || { cat "$temp/server.log"; exit 1; }
  if curl -fsS http://localhost:5568/ >/dev/null; then break; fi
  sleep 1
done
cp "$repo/scripts/bench/gpu-bench.mjs" "$driver"
mkdir -p "$output"
host="$(hostname -I | awk '{print $1}')"
"$nodewin" "$(wslpath -w "$driver")" --base "http://$host:5568" --nightly 1 --cases pad,ascent,orbit,moon,map,editor --seconds 10 --settle 5000 --trace 0 --out "$(wslpath -w "$output")" --label nightly
history="$HOME/.t3/projects/wsp-traces/perf-history"
mkdir -p "$history"
cp "$output/nightly-dpr2.json" "$history/raw-$(date -u +%Y%m%dT%H%M%S)-$$.json"
harness="$(sha256sum "$driver" | cut -d" " -f1)"
node "$repo/scripts/perf/nightly-gpu.mjs" "$output/nightly-dpr2.json" "$sha" "$history" "$harness"

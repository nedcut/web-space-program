# CPU pass 2 evidence

See [the report](../../PERFORMANCE.md#cpu-pass-2-2026-10-07-cxperfcpu2) for results and limitations.
Production captures use Windows Chrome CDP 9333, hardware RTX 3060 Ti / Ryzen 5600X,
1470×920 CSS, DPR 2, Medium unless marked High, adaptive quality off. This is not Apple/120 Hz
validation. Every browser job acquires `/tmp/wsp-gpu.lock`; there is no concurrent benchmark.

## Capture index

| Prefix | Revision | Purpose |
|---|---|---|
| `cpu2-pair-before-transitions-4x` | `49e6b30e` | Clean cold/warm hub, editor, launch, map, quicksave/load baseline |
| `cpu2-pair-final-transitions-4x` | `0e719a71` | Matched transitions after visual reuse, target retention and streaming changes |
| `cpu2-before-journey-continuous-4x` | `49e6b30e` | Continuous ascent, orbit, warp up/down, Moon crossing |
| `cpu2-complete-journey-4x` | `cbf6d24b` | Same journey including impact-query guard, before bitmap-release follow-up |
| `cpu2-release-journey-4x` | `b91881a1` | Final journey, including worker bitmap release |
| `cpu2-before-soi-4x` | `49e6b30e` | Isolated Kestrel Moon SOI baseline |
| `cpu2-final-soi-4x` | `0e719a71` | Identified unnecessary HUD impact paths |
| `cpu2-complete-soi-4x` | `cbf6d24b` | Same fixture after guarding impact paths |
| `cpu2-before-imagery-high-4x` / `cpu2-final-imagery-high-4x` | `49e6b30e` / `0e719a71` | Initial High pair; surface ready only, clouds not settled |
| `cpu2-before-imagery-complete-4x` / `cpu2-complete-imagery-4x` | `49e6b30e` / `cbf6d24b` | Fully loaded High repeat; native-step outliers in both |
| `cpu2-before-imagery-release-4x` / `cpu2-release-imagery-4x` | `49e6b30e` / `b91881a1` | Final High pair; surface/cloud source ready, three-second bake settle |
| `cpu2-before-journey-1x*` / `cpu2-complete-journey-1x*` | `49e6b30e` / `cbf6d24b` | Existing `cpu-flight.sh` 120-second unthrottled journey pair |
| `earth-stalls-1x-pair.jsonl` | `49e6b30e` / `cbf6d24b` | Existing trace-free High imagery probe, 30 seconds, before then after |

The continuous journeys use Meridian, orbit assist, 15-second autosave and 4× **physics warp**
during ascent. Physics warp is distinct from CDP's 4× CPU throttle. Orbit/return windows use 1×
physics; the warp-up fixture uses 100,000× rails warp. Moon entry starts outside the SOI and
crosses through `World.tick`; it does not just assign the central body.

`comparison.csv` summarizes window durations, long-task counts/maxima, rAF percentiles/gaps,
trailing CPU and cumulative imagery peaks for the matched 4× runs.

`.json` contains measurement windows, browser long tasks, rAF intervals, stage marks, app CPU,
imagery state, GL errors and console/page errors. `.trace.json.gz` is Chrome trace-event JSON;
`.samples.json` is sampled JS attribution using matching production source maps. `.tasks.json`
contains trace-task detail. Screenshots verify the imagery after streaming.

The raw `.trace.json.gz` files (about 148 MB) and the full-size imagery screenshots are not committed;
they are archived outside the repository (`~/.t3/projects/wsp-traces/perfcpu2/`). The derived `.json`,
`.samples.json` and `.tasks.json` summaries here are complete without them.

The app profiler averages the **last 240 frames**, not the whole ascent. Browser observations
span the marked window. Trace drain occurs outside that window, but simulation/imagery may keep
running during drain. Imagery maxima are cumulative from scene construction, so a maximum can
occur between exported windows. The old `cpu-flight.sh` readout includes trace drain; its raw
trace covers 120 seconds but the reported observation interval is longer and differs per build.
Do not use those raw counts/FPS as equal-duration trace-free results.

## Diagnostics, excluded from primary comparisons

- `cpu2-before-flight-4x`, `cpu2-before-flight-route-4x`, `cpu2-before-flight-traced-4x`: renderer
  stalls on direct entry at 4×. The completed harness enters through Space Center.
- `cpu2-before-journey-4x`: earlier segmented ascent missed staging during trace drain; a near-radial
  Moon fixture also exposed the pre-existing “True anomaly outside hyperbolic asymptotes” prediction
  exception. Its error trace is retained. The final fixture has transverse velocity.
- `cpu2-final-journey-4x`: export hit V8's string limit after ascent; observations are retained,
  but this is not a completed journey. The renderer-PID streaming exporter fixes that failure.
- `cpu2-after-transitions-4x`: rejected 512 KiB/two-operation streaming budget delayed imagery.
- `cpu2-final-transitions-4x`: overlapped host tests. Use the clean `cpu2-pair-*` captures instead.
- `cpu2-before-transitions-4x`: initial discovery run. Selected cold scene traces remain for
  attribution. Superseded diagnostic traces stay outside Git; their JSON summaries remain here.
- To limit repository growth, older imagery repeats retain summaries/screenshots and the cited
  streaming-attribution trace. The pre-release journey retains its ascent trace; the final journey
  retains every window. Isolated SOI runs retain their crossing traces, not repeated loading traces.

## Reproduction

Build each revision separately with production source maps, serve with `vite preview` on 5350–5359,
and use the host reachable from Windows. Never run against the development server. For example:

```sh
npx vite build --sourcemap --outDir dist-cpu-release
npx vite preview --outDir dist-cpu-release --host 0.0.0.0 --port 5354 --strictPort
# cpu-pass2.sh acquires /tmp/wsp-gpu.lock itself:
bash scripts/bench/cpu-pass2.sh http://172.24.204.38:5354 cpu2-check-transitions 4 transitions
bash scripts/bench/cpu-pass2.sh http://172.24.204.38:5354 cpu2-check-flight 4 flight
bash scripts/bench/cpu-pass2.sh http://172.24.204.38:5354 cpu2-check-imagery 4 imagery high
bash scripts/bench/cpu-pass2.sh http://172.24.204.38:5354 cpu2-check-soi 4 soi
node scripts/bench/cpu-trace-samples.mjs path/to/ascent.trace.json.gz dist-cpu-release
```

For a paired batch, hold one `flock /tmp/wsp-gpu.lock` across both calls and set
`WSP_CPU_LOCKED=1` inside that batch. External drivers such as `earthgfx-stalls.mjs` must also be
wrapped in this lock. The Windows driver executable is
`/mnt/c/wsp-tools/node-v24.14.1-win-x64/node.exe`; the wrapper copies scripts into
`C:\wsp-tools\drv` and results from `C:\wsp-tools\bench` into this directory.

[Validation logs](validation/README.md) record the final required checks.

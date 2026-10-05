# Performance pass — 2026-10-04

Baseline revision: `f77318c765d173e3a1ce57c4375cda044c42e3bb`. Worktree: `wsp-wt/perf`, branch `cx/perf`.

## Method and reproduction

Node v24.14.1, AMD Ryzen 5 5600X, shared Linux/WSL host. These CPU timings are **not laptop FPS estimates**. Other agents were running workloads; absolute timings and small differences are noisy. Unchanged terrain/navball/trajectory routines provide controls. No hard timing assertions were added to tests.

```sh
npx tsx scripts/bench/run.ts             # all simulation/readout scenarios
npx tsx scripts/bench/run.ts telemetry   # optional substring filter
npx tsx scripts/bench/render.ts          # headless scene CPU/mesh metrics
npx tsx scripts/bench/kernels.ts         # isolated hull/mass/ground kernels
npx tsx scripts/bench/determinism.ts     # ten 100-step trace hashes
```

`run.ts` uses five warm-up batches and nine measured batches, reporting the median and nearest-rank p95 of **batch means**, in microseconds per operation. Physics batches contain 100 fixed 20 ms World ticks; every batch starts from a fresh scenario. Stock Kestrel has 9 parts, Selene 28. Atmosphere is 15 km above Earth, vacuum is a 2,000 km Earth orbit, landed is lunar ground contact, pad remains clamped. Neutral coasting inputs keep the cases reproducible; these are not sustained engine-burn benchmarks. Rails tests assert that the requested 1,000,000× warp remains unclamped. Trajectory timing forces cache expiry. Terrain tests cover every surface preset represented in the catalogue, at 997 deterministic distributed directions. Chunks use Low's 24-quad resolution. Comms rebuild includes 20 vessels and all body occluders. Active ISRU resets input/product stores per operation; absent ISRU uses ordinary stock hardware. Science includes context and non-sandbox progression hooks.

Telemetry calls the actual controller method on a headless receiver; navball's arrow initializer is extracted verbatim from the controller and transpiled with the existing tsx/esbuild dependency. No fake readout implementation or WebGL constructor runs. Telemetry is measured on an unchanged pad vessel, so it measures the cache-hit case; changing fuel, crew, pressure or staging recomputes Δv immediately.

Raw runs, intermediate experiments and matching trace hashes are retained in [results.json](performance/results.json). The original landed Node CPU profile is [landed.cpuprofile](performance/landed.cpuprofile). Excluding startup, procedural crater height/noise dominated landed sampling; this pass does not approximate terrain or change contact physics.

For the `BENCH_BASELINE=1` kernel/render comparison, make temporary `*.baseline.ts` copies beside the corresponding modules using `git show f77318c:<path> > <path-with-.baseline.ts>`. The five modules are `src/game/universe.ts`, `src/sim/vessel/{assembly,shapes}.ts`, `src/render/map/MapView.ts`, and `src/render/planet/quadtree.ts`. Remove those copies afterward. Vessel structural baseline was measured before batching; the baseline switch only switches map/quadtree/kernel modules. The full original/modified World runs used identical scripts with the original tracked implementation temporarily restored inside this worktree, then restored the modified files in `finally`.

## Full CPU before/after

Use the broad physics results as observations, not claims of a general speedup. Explicit hot-path improvements are supported separately by isolated measurements and allocation/mesh counts below.

| Operation | Before median µs | After median µs | Before p95 µs | After p95 µs |
|---|---:|---:|---:|---:|
| tick/stock-kestrel/9parts/pad | 9.290 | 5.732 | 11.347 | 19.101 |
| tick/stock-kestrel/9parts/atmosphere | 82.141 | 75.179 | 97.035 | 96.536 |
| tick/stock-kestrel/9parts/vacuum | 59.947 | 58.057 | 86.493 | 87.281 |
| tick/stock-kestrel/9parts/landed | 1080.811 | 1046.718 | 1156.506 | 1132.713 |
| tick/stock-selene/28parts/pad | 3.655 | 2.550 | 8.217 | 2.580 |
| tick/stock-selene/28parts/atmosphere | 110.290 | 101.769 | 133.632 | 126.679 |
| tick/stock-selene/28parts/vacuum | 87.596 | 86.830 | 92.706 | 124.484 |
| tick/stock-selene/28parts/landed | 3054.930 | 2869.610 | 3453.364 | 3066.225 |
| rails/1e6 | 21.483 | 16.493 | 27.243 | 23.863 |
| trajectory/map | 23.394 | 15.107 | 28.126 | 25.555 |
| deltaV/stock-kestrel | 50.314 | 45.475 | 62.975 | 66.908 |
| deltaV/stock-selene | 180.270 | 177.071 | 268.965 | 277.293 |
| heightAt/star | 0.032 | 0.032 | 0.057 | 0.056 |
| heightAt/mercury | 3.432 | 3.272 | 3.783 | 4.246 |
| heightAt/venus | 2.338 | 2.368 | 2.916 | 2.896 |
| heightAt/earth | 2.719 | 2.457 | 3.004 | 3.489 |
| heightAt/mars | 4.050 | 4.239 | 4.648 | 4.422 |
| heightAt/gasGiant | 0.037 | 0.033 | 0.047 | 0.057 |
| heightAt/iceGiant | 0.034 | 0.034 | 0.066 | 0.063 |
| heightAt/icy | 3.170 | 4.067 | 3.285 | 4.272 |
| heightAt/rocky | 2.873 | 2.319 | 3.401 | 2.924 |
| heightAt/lunar | 3.593 | 3.639 | 4.506 | 3.836 |
| heightAt/io | 2.704 | 2.146 | 2.986 | 3.359 |
| heightAt/europa | 1.999 | 1.610 | 2.386 | 1.642 |
| heightAt/enceladus | 2.947 | 2.663 | 3.803 | 3.108 |
| heightAt/titan | 1.708 | 1.666 | 2.149 | 2.238 |
| chunk/earth/24 | 2124.442 | 2046.384 | 2949.345 | 2916.341 |
| chunk/moon/24 | 1879.408 | 1861.032 | 2275.806 | 1954.279 |
| comms/rebuild/20vessels | 37.497 | 19.360 | 61.047 | 33.636 |
| science/context | 7.431 | 7.381 | 9.908 | 11.690 |
| science/progression | 1.092 | 1.077 | 2.196 | 2.720 |
| isru/absent | 0.594 | 0.043 | 1.026 | 0.074 |
| isru/active | 4.726 | 4.577 | 9.569 | 8.688 |
| telemetry/stock-kestrel | 85.657 | 40.814 | 93.771 | 43.037 |
| navball/stock-kestrel | 0.518 | 0.501 | 0.987 | 0.979 |
| telemetry/stock-selene | 254.728 | 47.980 | 312.627 | 55.941 |
| navball/stock-selene | 0.342 | 0.314 | 0.794 | 0.930 |

## Retained changes and rejected experiments

- Δv uses a weak vessel cache with an exact topology/resource/staging/crew/pressure/gravity signature. Resource values are not rounded. Massless EC is excluded only when no engine consumes it. Cached arrays are read-only at call sites. Definitions and resource densities retain their existing immutable contract.
- Comms stations cache their immutable body-fixed location and terrain altitude per Universe. Rotation, vessel positions, occlusion and routes are still evaluated at the current UT.
- Hull sample arrays are reused per immutable PartDef, removing up to 16 vector objects plus the array per cylindrical-part contact gathering. Earth ground sampling no longer calls the same height function twice to identify water. ISRU caches machinery membership by topology and avoids regolith sampling for vessels without machinery.
- HUD resource/stage panels and formatted readouts are memoized. Exact duplicate telemetry publications are suppressed, including correct handling of NaN; precision/gamepad/stage-hold changes still publish. Time and changing flight data retain their cadence. The performance overlay refreshes independently at 2 Hz, including while paused. React commit timings were not measured because the browser was inaccessible.
- Map node/apsis sprite materials are pooled; hidden nodes cannot be picked. Comms overlay GPU buffers grow only when capacity is exceeded rather than being disposed every frame.
- Planet scratch transforms are reused. Quadtree placement reuses selection sets, avoids per-chunk temporary arrays and skips unchanged matrices. Existing live uniform updates and selection traversal remain; no stale-camera LOD approximation was introduced. Scatter exits before terrain sampling when even maximum terrain height is too far below the camera. Shadow projection only refits when vessel bounds change.
- Opaque static part leaves are merged by compatible material/layout, and repeated geometry is instanced. Transparent leaves and animated hardware retain their hierarchy. Bounds are computed for frustum culling (ordinary part meshes already had culling enabled). Batches are rebuilt on layout changes and own only their new geometry; template resources stay shared. Uncontrolled debris without command modules beyond 2 km from the active origin uses a 3 px point and skips part animation. The active vessel remains detailed.

| Isolated case | Before µs | After µs | Decision |
|---|---:|---:|---|
| hullPoints/28parts | 6.229 | 0.339 | Keep |
| ground/earth/pad | 6.636 | 5.306 | Keep |
| In-place mass accumulation experiment | 4.605 | 5.569 | Reverted: no measured win |

The existing ephemeris already caches exact current-time states and rotations. A four-time snapshot cache was tested and **reverted**: Selene vacuum stepping increased from 232 to 354 µs in the paired experiment, with no reliable overall improvement. The original one-time cache remains. Navball math was already sub-microsecond in the stable run; it was measured but not rewritten. No approximation, timestep change, resource quantization or altered science cadence was retained.

Intermediate telemetry measurements after the first cache change were 234→106 µs for Selene; final longer-warmup measurements are in the main table. Raw stage experiments are retained for audit, including a run overlapping shared-host test load; they are not substituted for the final table.

## Rendering measurements and quality

**Actual flight pad/orbit `renderer.info` counts and laptop GPU frame time remain unverified.** The dev server on port 5186 returned HTTP 200 locally, but T3 preview navigation repeatedly failed at localhost and timed out at the environment IP. No browser screenshot, visual pass or GPU speedup is claimed.

The following are headless visible vessel meshes (potential colour-pass submissions), excluding planet/site, shadows, postprocessing and navball. Triangle totals include instance multiplicity and remain unchanged:

| Vessel | Before meshes | After meshes | Before triangles | After triangles |
|---|---:|---:|---:|---:|
| Kestrel | 59 | 52 | 19,724 | 19,724 |
| Selene | 236 | 195 | 62,400 | 62,400 |

| Render CPU case | Before median µs | After median µs |
|---|---:|---:|
| map/update | 41.040 | 27.290 |
| quadtree/place/512 | 45.534 | 21.889 |
| quadtree/place/512/moving | 46.448 | 46.589 |

The fixed map fixture replaces three sprites/materials every baseline frame and zero after pooling. Quadtree's stationary case benefits from unchanged-matrix detection; moving-frame CPU time is effectively unchanged, with fewer temporary allocations. Existing launch scenery and surface scatter were already merged/instanced and were retained.

Low now renders its scene and HDR/post chain at 0.5× instead of 0.85× linear scale (about 65% fewer target pixels), disables bloom by default, and retains no shadows/scatter/clouds. Explicitly enabling Low shadows uses a 512 map; Medium uses its specified 1024 instead of the controller's hard-coded 2048. Custom user overrides remain supported.

Graphics → **Adaptive render scale** is opt-in. More than 25 ms/frame continuously for 3 seconds lowers the scale multiplier by 0.1; less than 12 ms/frame for 3 seconds raises it by 0.1. The multiplier stays within 0.5–1 of the user's chosen render scale, and disabling it restores that ceiling. Suspended frames of at least one second reset the counters. Resizing reuses the composer/passes. The FPS setting displays FPS, full-frame calls, triangles and effective scale. `renderer.info.autoReset=false` plus one reset before the composer accumulates scene, shadow and post calls, rather than reporting only the final fullscreen pass; the separately rendered navball is excluded.

To complete GPU validation on the owner's laptop, select Low and enable the FPS/draw-call readout, open `/?flight=stock-selene` and then `/?flight=stock-selene&scenario=orbit`, and wait for terrain loading to finish. Record the overlay at the same viewport/camera after warmup for each revision. The existing `window.__flight` hook also exposes `pipeline.stats`, `pipeline.effectiveRenderScale` and `pipeline.renderer.info`. The missing measurements must not be inferred from headless mesh counts.

## Correctness and scope

- `npx tsc --noEmit` passed.
- `npx vitest run --maxWorkers=2` passed 45 files / 632 tests, including new cache, adaptive quality, batching ownership/bounds and debris LOD tests.
- Ten baseline/final traces hash **bit-identically** across every one of 100 steps for both stock craft in launch, atmosphere, vacuum, landed and 1e6× rails scenarios. Wall-clock vessel IDs are fixed in the trace harness; simulation UT and all serialized numerical state are compared without rounding.
- Render changes still need visual verification on a working browser and an integrated GPU. Cache-hit telemetry timings do not predict burning-vessel cache misses. This is a measured reduction in selected hot paths and render submissions, not a laptop frame-rate guarantee.

## Files changed

- `DECISIONS.md`
- `PROGRESS.md`
- `docs/PERFORMANCE.md`
- `docs/performance/landed.cpuprofile`
- `docs/performance/results.json`
- `scripts/bench/determinism.ts`
- `scripts/bench/kernels.ts`
- `scripts/bench/render.ts`
- `scripts/bench/run.ts`
- `src/flight/FlightScene.tsx`
- `src/flight/controller.ts`
- `src/flight/hud/Hud.tsx`
- `src/game/comms.ts`
- `src/game/stageDeltaVCache.ts`
- `src/game/store.ts`
- `src/game/universe.ts`
- `src/game/world.ts`
- `src/render/core/adaptiveQuality.ts`
- `src/render/core/quality.ts`
- `src/render/core/renderer.ts`
- `src/render/map/MapView.ts`
- `src/render/planet/PlanetRenderer.ts`
- `src/render/planet/quadtree.ts`
- `src/render/planet/scatter/SurfaceScatter.ts`
- `src/render/vessel/VesselView.ts`
- `src/render/vessel/staticBatch.ts`
- `src/sim/vessel/isru.ts`
- `src/sim/vessel/shapes.ts`
- `src/ui/SettingsPanel.tsx`
- `src/util/snapshotEqual.ts`
- `tests/performance.test.ts`


## Transfer planning workers — 2026-10-04 (`cx/planner`)

The synchronous algorithms are unchanged and remain the before case; the after case sends the same
snapshot through `requestPlan` to the production `planner.worker-*.js` bundle. Moon and Saturn
transfer results are also checked for exact numeric equivalence in `tests/planning.test.ts`.

**Measurement scope:** Node v24.14.1 on the shared Linux/WSL Ryzen 5 5600X host. A small
`worker_threads` transport shim executes the actual built Web Worker entry point (`self.postMessage`
and `self.onmessage`), exercising its request/response protocol and client termination. This measures
main-thread event-loop responsiveness, **not browser frame time or FPS**. Other agents were active.
The separate browser measurement below uses the collaborative browser reached through the host's
Tailscale address after loopback/environment-port/WSL-address navigation failed.

Each scenario warms the synchronous planner once, then alternates three synchronous/worker trials.
The table reports medians. “Call” measures synchronous work before returning (before: the entire
search; after: worker creation and message dispatch). “Max timer gap” is each trial's largest gap
between 4 ms main-thread heartbeat callbacks; it includes host scheduling and GC. A 20 ms settling
window captures the delayed callback after a synchronous search. Worker elapsed time includes fresh
worker startup, module initialization, calculation, row yields, serialization and result delivery.

Parking orbits are inclined 0.5 rad around Earth at UT 2030-07-20 12:00, 120 km altitude at Standard
and 220 km at Real. Saturn grids use the UI's 36×36 cells, one synodic departure period and
0.65–1.35 times the Hohmann flight duration. Every Moon case found a transfer; every worker grid
streamed 36 rows. Before cases serviced zero heartbeats during calculation; after cases serviced
61–1,204. Raw samples: [planning.json](performance/planning.json).

| Case | Before call ms | After call ms | Before max timer gap ms | After max timer gap ms | After elapsed ms |
|---|---:|---:|---:|---:|---:|
| Standard / Moon transfer | 2686.13 | 0.97 | 2686.60 | 13.26 | 2676.32 |
| Standard / Saturn 36×36 grid | 35.63 | 0.71 | 36.10 | 14.08 | 344.61 |
| Real / Moon transfer | 4480.91 | 1.25 | 4480.94 | 20.89 | 4526.75 |
| Real / Saturn 36×36 grid | 17.76 | 0.65 | 17.81 | 10.52 | 349.92 |

The worker removes the multi-second Moon calculation from the main thread. Small grids cost more
elapsed time because each request starts a fresh worker and yields between rows; the main thread
remains available and Cancel immediately terminates refinement work. No speedup in total planning
time is claimed. Worker construction is lazy and each worker is terminated on completion, error or
cancellation. The production worker is about 72 kB uncompressed, with no React/three.js dependencies.

Reproduce the recorded event-loop measurement:

```sh
npm run build
npx tsx scripts/bench/planning-node.ts
```

### Browser main-thread call measurements

The actual module Web Worker also ran in the T3 collaborative browser: Electron 44.4.2 / Chrome
152.0.7977.130 on macOS, reporting 12 logical cores (CPU model not collected). These are separate
measurements from the Linux backend above; absolute times must not be compared across those hosts.
The idle HTML harness loads Vite development modules over the host's Tailscale address. We warmed
each synchronous case once, then alternated three before/after samples. The same orbits and 36×36
UI grids were used. Main-thread call duration, measured directly with `performance.now()`, includes
the entire synchronous search before and worker construction/postMessage after. Snapshot preparation
and UI drawing are outside this measurement.

| Case | Before main-thread call ms | After main-thread call ms | After elapsed ms |
|---|---:|---:|---:|
| Standard / Moon transfer | 643.00 | 0.10 | 971.60 |
| Standard / Saturn 36×36 grid | 7.40 | 0.10 | 386.20 |
| Real / Moon transfer | 1021.20 | 0.10 | 1332.50 |
| Real / Saturn 36×36 grid | 7.10 | 0.10 | 495.50 |

Raw samples and browser identification: [planning-browser.json](performance/planning-browser.json).
The embedded preview throttled timers to roughly one second and did not service a six-frame rAF
probe within 15 seconds. Its Long Tasks observer returned no entries even for the synchronous stalls.
Consequently its raw timer/Long Task fields are **not valid frame or long-task measurements**; only
the direct call timings above are reported. The measured small Saturn grid itself took about 7 ms,
not one second on this browser. Fresh worker startup and row scheduling increase its elapsed time;
this change provides cancellation and progressive display rather than faster overall grid calculation.

Reproduce in an idle same-origin page:

```sh
npx vite --host 0.0.0.0 --port 5196 --strictPort
# Open http://<reachable-host>:5196/scripts/bench/planning.html
```

```js
const { benchmarkPlanning } = await import('/scripts/bench/planning.ts');
await benchmarkPlanning('standard', 'moon', false);
await benchmarkPlanning('standard', 'moon', true);
// Also use 'real' and 'saturn'; warm once, then alternate three samples.
```

For UI checks, import `/scripts/bench/planning-ui.tsx` and call `mountPlanningUi()` in the same harness.
It mounts the actual ManeuverPanel and TransferWindow against a real-scale parking-orbit World without
requiring a WebGL scene. In the collaborative browser, Cancel during Moon encounter refinement
terminated its worker and retained the existing 42 m/s node. Cancelling the Saturn plot on the tenth
row left exactly nine painted departure columns and retained the same node. This verifies progressive
canvas updates and actionable cancellation independently of the unavailable frame-rate measurement.
A subsequent uncancelled Moon request installed a verified 3,127 m/s transfer with a fresh World node ID.

The no-Worker Node fallback preserves the async API and numerical results but can still block during
transfer refinement; only pre-start and porkchop-row boundaries yield in that path.

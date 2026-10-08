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


# Laptop performance pass 2 — 2026-10-05 (`op/perf2`)

The owner reported that the game "still feels slow" on a real laptop. No hardware GPU is available to this
pass, so it measures what headless Chromium (SwiftShader) can measure reliably — main-thread CPU per section,
allocation, draw calls, triangles, shader programs and runtime compiles, pixels shaded and loading phases — and
leaves GPU frame time to the new in-game overlay. SwiftShader frame times are **not** laptop frame times and are
not used for any claim below.

## Revisions and method

| Label | Revision | Notes |
|---|---|---|
| base | `90de7092` + profiler/probe hooks only | Instrumentation adds a few `performance.now()` calls; no behavioural change. |
| pre | `abeb7eff` | All changes in this pass, before merging `main`. Isolates this pass. |
| final | merge of `main` `18633d73` | Includes the parallel art pass (worker textures, physical materials), flight feel (render interpolation) and part action windows. |

Host: shared Ryzen 5 5600X / WSL2, Node 24, Playwright Chromium with `--use-angle=swiftshader`; other agents were
running, so timings are noisy (interleaved repeats are shown where a claim depends on them). Reproduce:

```sh
npm run build && npx vite preview --port 5201 --strictPort &
node scripts/perf-probe.mjs --cases startup,pad,orbit,map,saturn --nogpu --cpu --heap --size 640x360   # CPU / allocation
node scripts/perf-probe.mjs --cases session --size 640x360                                             # runtime shader compiles
node scripts/perf-probe.mjs --cases pad,orbit,map,saturn --size 1280x720 --dpr 1.5                     # draws / programs / pixels
node scripts/perf-probe.mjs --cases pad --loadcpu /tmp/load.cpuprofile                                # loading profile
node scripts/perf-probe.mjs --cases pad --shaders                                                      # per-program link stalls
```

`--nogpu` replaces the composer/map submission with a no-op so the remaining main-thread work runs at its natural
60 Hz; `--cpu` adds a CDP CPU profile (per-function and per-bundle self time), `--heap` a sampling heap profile
including collected objects, `--gpu` a gl.finish()-bracketed per-pass/per-group proxy (SwiftShader only — useful
for spotting a pathological pass, not for ranking). Raw JSON: [performance/perf2](performance/perf2).

## What the evidence said

1. **Pixels, not JavaScript, are the laptop bottleneck.** With GPU submission removed, the whole flight frame
   (simulation, planets/quadtree, vessels, FX, HUD, navball, audio, telemetry) costs 1.2–2.6 ms of main thread
   on this desktop; three.js scene submission adds 2–3 ms (≈4–8 ms total on a laptop CPU). GC averaged
   0.12–0.27 ms/frame from ~220–400 kB/frame of short-lived allocation, mostly ephemeris/vector temporaries.
   Medium, however, rendered at up to 1.5× device pixels: on a 1.5× laptop panel that is 2.25× the pixels of
   1080p through the HDR scene, per-pixel atmosphere ray-march (16 view / 6 aerial steps), bloom chain, tonemap
   and FXAA — the likely cause of "slow" on an integrated GPU.
2. **Shader compiles caused the big hitches.** A scripted session (ignite, open map, close map, stage, pause,
   resume) linked **24 programs after loading**: 8 on the first map open and 14 on the first decouple. On
   Windows/ANGLE each link of these shaders typically costs tens to hundreds of milliseconds, i.e. a visible
   freeze. Two root causes:
   - The decouple/explosion flash toggled a `PointLight`'s visibility. The light count is part of every
     three.js program key, so all lit materials (terrain, ocean, parts, plumes, particles) recompiled.
   - three r186 silently replaces `PCFSoftShadowMap` with `PCFShadowMap` at the first shadow render, so any
     program compiled before that (including a warm-up) used a stale key.
3. **Draw calls came from part hierarchies.** Ring Skimmer drew 407 calls per frame (Gossamer's folding solar
   arrays alone: 141 — six draws per multi-material panel box); one of each catalogue part totals 1,556 draws.
   The Kestrel pad frame drew 191 calls / 635 k triangles, 226 k of them launch-site vegetation that also went
   through the shadow pass because each species was a single instanced mesh spanning the 6 km plateau.
4. **Loading was dominated by synchronous work:** shader linking (first frame), procedural canvas textures
   (launch site ~0.4 s; part textures ~1.9 s on this desktop before the art pass moved them to workers),
   PMREM baking and the main menu eagerly loading three.js + compiling the Saturn backdrop at startup.

## Changes

| Change | Where |
|---|---|
| Medium caps device-pixel ratio at 1 (High keeps 2); editor uses the preset cap | `render/core/quality.ts`, `editor/scene/EditorView.ts` |
| Adaptive render scale on by default; 1 s windows of missed vsync intervals + GPU timer queries; ignores CPU-bound slowness; cooldown doubles after oscillation; also in the Space Center | `render/core/adaptiveQuality.ts`, `renderer.ts`, `ui/hub/HubScene.ts` |
| First-run GPU tiering (unmasked WebGL renderer): weak iGPUs/software/mobile → Low, others → Medium; one-time re-tune for existing players (`graphicsProfile`) with a notice | `util/gpuTier.ts`, `render/core/quality.ts`, `main.tsx` |
| Low: atmosphere 8/3 steps (was 10/4), 35 % launch-site vegetation | `quality.ts`, `render/site/LaunchSite.ts` |
| Shader warm-up: flight + map scenes compiled with `compileAsync` behind the loading screen (first frame updates without drawing) | `flight/controller.ts` |
| Flash light resident at zero intensity; `PCFShadowMap` set explicitly; `checkShaderErrors` off in production | `render/fx/FlightFx.ts`, `render/core/renderer.ts` |
| Part templates: regroup repeated materials in multi-material meshes; merge unnamed same-material sibling leaves in their parent frame (animation, names, userData preserved; test covers every part stowed/deployed) | `render/parts/optimize.ts` |
| Vegetation bucketed in 1.4 km cells (frustum + shadow culling) | `render/site/LaunchSite.ts` |
| Launch-site canvases reused hub→flight and cached in IndexedDB (PNG, keyed by args + code hash; bit-identical) | `render/core/textureCache.ts`, `render/site/textures.ts` |
| Menu loads three.js/Saturn on idle; Space Center/editor prefetch the next scene; editor renders on change only | `ui/MenuBackdrop.tsx`, `ui/App.tsx`, `EditorView.ts` |
| Navball skips identical frames; maneuver panel re-renders at 10 Hz unless a jog is held | `flight/hud/navball.ts`, `ManeuverPanel.tsx` |
| Performance overlay (F8 or Settings → Graphics): fps, 4 s frame graph, p50/p95/p99, hitches, CPU per section, GPU ms, draws, programs, resolution, copyable report | `util/frameProfiler.ts`, `flight/hud/PerfOverlay.tsx` |
| Fixed (merge): Low part templates were cached under the High key, so Low rebuilt every part mesh | `render/parts/index.ts` |

## Before / after

**Runtime shader programs linked after loading** (scripted session; deterministic counts):

| Step | base | pre | final |
|---|---:|---:|---:|
| Ignite + lift-off | 2 | 0 | 0 |
| First map open | 8 | 1 | 1 |
| First stage (decouple flash) | 14 | 1 | 2 |
| **Total** | **24** | **2** | **3** |

Programs compiled during loading rose accordingly (pad: 52 → 75 pre / 79 final), off the frame path and in
parallel where `KHR_parallel_shader_compile` exists (Chrome on Windows/macOS).

**Pixels shaded per frame at Medium** (3D scene and every post pass scale with this):

| Display (CSS px × DPR) | base | after | Change |
|---|---:|---:|---:|
| 1920×1080 × 1.0 | 2.07 MP | 2.07 MP | 0 |
| 1920×1080 × 1.25 | 3.24 MP | 2.07 MP | −36 % |
| 1920×1080 × 1.5 (typical 14–15″ Windows laptop) | 4.67 MP | 2.07 MP | −56 % |
| 1440×900 × 2 (MacBook Air) | 2.92 MP | 1.30 MP | −56 % |

The probe at 1280×720 CSS, DPR 1.5 confirms the canvas: 1920×1080 → 1280×720.

**Draw calls / triangles** (1280×720, Medium):

| Case | base | pre | final (incl. art pass) |
|---|---:|---:|---:|
| Kestrel on the pad | 191 calls / 635 k tris | 187 / 477 k | 197 / 482 k |
| Kestrel in orbit | 160 / 157 k | 166 / 208 k | 201 / 366 k |
| Ring Skimmer (Gossamer at Saturn) | 407 / 183 k | 255 / 183 k | 259 / 188 k |
| One of each catalogue part | 1,556 draws | 1,138 | — |

Orbit triangles/draws in *final* grew with the merged art pass's higher-detail parts, not this pass.

**three.js submission CPU at Saturn** (CDP self time of the three.js bundle, interleaved repeats, same host):
base 3.27 ms/frame → pre 2.59 / 2.70 ms (−18 %); `render` section 3.71 → 3.08 / 3.15 ms.

**Main thread without GPU submission** (`--nogpu`, ms/frame avg; all three are within run-to-run noise — this
pass did not target sim/planet CPU, which was already small):

| Case | base | pre | final |
|---|---:|---:|---:|
| Pad | 1.34 | 1.18 | 1.77 |
| Orbit | 1.30 | 1.16 | 2.06 |
| Map | 2.17 | 1.70 | 2.60 |
| Saturn | 1.36 | 1.21 | 1.92 |

The *final* increase follows the merged features (resource/staging HUD modules, render interpolation) and host
load; GC stayed at 0.12–0.27 ms/frame.

**Loading** (headless, cold profile each run): menu interactive 600–670 ms → 136–368 ms because three.js and
the Saturn backdrop now load on idle (first-request menu payload 432 → 236–274 kB). Flight "ready" in
SwiftShader (~20 s, terrain + software shading) is not representative; the constructor phase is 2.0–2.8 s → 0.7–1.5 s
in *final* (mostly the art pass replacing the RoomEnvironment PMREM and moving part textures to workers).
Warm loads skip launch-site canvas drawing; restored canvases hash identically to freshly drawn ones (29/29 canvas textures before the merge; 8/8 launch-site textures after it, where a warm flight constructor took 228 ms).

## Not changed / limits

- No laptop GPU frame time is claimed. Use the overlay (below).
- Bloom stays as is: at 2 MP its ~16 M texture taps are estimated at ≈0.2 ms on an Iris Xe class GPU; a
  quarter-resolution chain would visibly soften Medium for little gain.
- The navball keeps its own WebGL context (drawn only when it changes).
- Ephemeris/vector allocation (the largest allocator) lives in the deterministic sim; GC cost did not justify
  touching it. All ten determinism traces are bit-identical to `main`.
- Programs compiled for scenes that appear later (other planets' renderers, EVA, new effects) can still compile on
  first use; the overlay's program count makes such hitches visible.

## What to measure on the laptop

1. Start the game once (Settings → Graphics will show the auto-picked preset; a Space Center notice explains it).
2. In flight press **F8**. Let it settle for 5 s in each of: Kestrel on the pad, `?flight=stock-kestrel&scenario=orbit`,
   the map (M), and the Ring Skimmer mission. Press **Copy report** and paste the text.
3. Key numbers: frame p99 (target < 25 ms), hitches > 25 ms, GPU ms (if shown; target < 14 ms at 60 Hz), CPU ms,
   draws, resolution (%) — if adaptive keeps dropping the resolution, the GPU is the limit; if CPU ms is high with
   GPU ms low, report the largest CPU sections.
4. Repeat once with Low, and once with Medium and adaptive off, to compare.
5. Note the first stage separation and the first map open: they should no longer freeze.


# CPU / memory pass 3 — real GPU — 2026-10-06 (`op/cpuperf`)

Scope: simulation, flight controller, HUD/React, worker scheduling, audio, memory/GC, startup. GPU/render findings
are at the end ("Findings for the graphics agent"); render code was not changed except a new, render-agnostic
`src/render/releaseRenderer.ts` used by the scene owners.

## Benchmark suite (real GPU, repeatable)

All numbers below come from **real Chrome on the RTX 3060 Ti desktop** (Windows Chrome over CDP, Ryzen 5 5600X),
production builds, Medium quality, 1470×920 CSS px (a 14″ MacBook viewport), DPR 2 (Retina emulation) unless noted.

| Script | What it measures |
|---|---|
| `scripts/bench/gpu-bench.sh` (`gpu-bench.mjs`) | Per scenario: rAF pacing (fps, p50/p95/p99, frames > 25/50 ms), in-game `frameProfiler` CPU sections, Long Tasks, CDP `Performance.getMetrics` (heap, DOM nodes, listeners, layout/style counts, script/task time), a trace per window (GC pauses, per-thread busy time incl. workers, main-thread work vs. compositor "Commit" wait), React commits and component renders (DevTools-hook), worker message counts, `renderer.info`; plus load timeline (menu interactive, controller, ready, time to stable fps, load long tasks; cold and warm), a 3-minute soak (orbit at 1000× toggling the map, heap after forced GC) and a 10× menu→flight→map→editor→flight scene-cycle leak test. Writes JSON + markdown. |
| `scripts/bench/gpu-ab.sh` (+ `gpu-ab-report.mjs`) | Interleaved A/B: each case alternates the two builds so both see the same machine/GPU state (the browser and GPU are shared with other agents); medians → `docs/performance/cpuperf/ab-*.md`. |
| `scripts/bench/gpu-profile.sh` | V8 CPU profile over a load or a scenario with per-long-frame / per-long-task attribution and optional sampling heap profile (allocation by function). Use an unminified build (`vite build --minify false --outDir dist-prof`). |
| `scripts/bench/gpu-leaks.sh` | Scene cycles in-page, heap-snapshot census diff and shortest retaining paths of surviving `FlightController`/`EditorView`/`WebGLRenderer`/detached DOM. |

Scenarios: main menu, pad (Kestrel), ascent (Meridian, full throttle, physics warp 4×), Earth orbit, rails warp
1000× and 100 000× (new `?scenario=highorbit`, 1500 km Earth orbit so every warp level is allowed), map view,
Moon terminal descent (`?mission=suicide-burn`), Saturn ring skimmer, editor with the 73-part Ringrunner Real
(idle and orbiting the camera) and the Tracking Station. Automation hooks: `window.__game` (store) and the existing
`window.__flight` / `__perf` / `__editor`.

```sh
npm run build && npx vite preview --port 5315 --strictPort --host 0.0.0.0 &
scripts/bench/gpu-bench.sh --label after --dpr 2                     # full suite incl. soak + cycles (~25 min)
scripts/bench/gpu-ab.sh dpr2 http://localhost:<before> http://localhost:5315 "pad,ascent,orbit" 2 --dpr 2
```

Limits: CDP CPU throttling (`--throttle`) proved unreliable on this CDP-connected Chrome (with DPR emulation, and
later even at DPR 1, pages stalled for minutes with an idle main thread), so no throttled numbers are reported.
Apple-silicon single-thread performance is at least that of the 5600X, so the CPU columns are a fair proxy for the
owner's MacBook; its GPU at Retina resolution is the open risk (see graphics findings). Absolute fps on this desktop
is GPU/vsync-bound at 60 and mostly unchanged by CPU work; CPU ms, GC, hitches and long tasks are what this pass moves.
The first full baseline (`baseline-dpr2.md`) was taken while the machine was contended (pad 51 fps, 7.2 ms CPU);
**the before/after claims below use the interleaved A/B runs only.**

## Bottlenecks found

1. **Scene-change memory leak (real, unbounded).** Every flight, editor, Space Center and navball renderer stayed
   reachable forever: three r186 registers per-renderer `dispose` listeners on shared materials, geometries and
   textures (part material/template caches, the module-level DFG LUT) and keeps per-renderer state in WeakMaps keyed by
   them; `renderer.dispose()` removes neither. Through the canvas's DOM listeners each retained renderer pinned a whole
   `EditorView` / scene. Also `window.__flight` and the 15 s shader-warm-up timer pinned the last `FlightController`
   (World, scene, GL context). Baseline: **+1,167 DOM nodes, +560 listeners and +1.9 MB per cycle; 17 live
   `WebGLRenderer`s after 3 cycles** (contexts accumulate towards Chrome's ~16 limit, after which the oldest is lost).
2. **Simulation evaluated all 61 body ephemerides several times per physics step.** Sun-occlusion (`env.sun`, used by
   hazards/solar power every step and every rails hazard sample), the SOI search (`findDominantBody`, every step) and
   the radiation model computed every body's position at times that defeat the one-time ephemeris cache. Rails at
   1e6× spent 58% of its time in `sun()`; at 100 000× the browser showed sim 0.93 ms/frame and **GC 14 ms/s**.
3. **Ground contact sampled terrain three times per hull point** (height + finite-difference normal) even for points
   metres above the ground: Selene landed on the Moon cost **3.0 ms per 20 ms physics step** in Node (4× that at
   physics warp 4×); ascent near the pad 0.9 ms/frame of sim in the browser with GC 14 ms/s and 15 frames > 25 ms.
4. **Per-frame planet bookkeeping** evaluated all 61 bodies at the render time each frame to decide which planet
   renderers to create (0.3–0.5 ms/frame incl. allocation).
5. **Startup:** `autoConfigureGraphics()` created a throwaway WebGL context (~30 ms main thread) on every boot because
   the GPU probe was a default argument evaluated before the "already tuned" check. Everything else in loading is
   render-side (see findings).
6. **HUD/React:** 13–15 commits/s at telemetry rate, ~30 components per commit, 0.05–0.1 ms/frame in production —
   small. Unchanged telemetry sub-objects were re-created every publish, so memoised parts never bailed out, and key
   labels / warp-level titles were re-derived with regexes and `Intl` on every update.
7. Not bottlenecks (measured, left alone): telemetry builder 0.04–0.2 ms/frame, audio 0.03–0.2 ms/frame, input
   0.08 ms, workers ≤ 0.5 % busy outside terrain streaming, soak heap slope 0.8–0.9 MB/min levelling off at ~20 MB
   (no growth in DOM nodes, listeners, geometries or textures over 3 minutes), Tracking Station ~1 ms/frame JS.

## Changes

| Change | Where | Exact? |
|---|---|---|
| `releaseRenderer` / `detachRenderer`: detach the renderer's own dispose listeners (the listener present on every object it drew) from everything reachable from its scene, dispose the shared DFG LUT, force context loss. Used by FlightController (flight + map scenes), EditorView, HubScene, Navball. EditorView removes its canvas listeners; the warm-up timer is cleared; `window.__flight` is dropped on unmount. | `render/releaseRenderer.ts`, `flight/controller.ts`, `flight/FlightScene.tsx`, `flight/hud/navball.ts`, `editor/scene/EditorView.ts`, `ui/hub/HubScene.ts` | n/a (tests) |
| Heliocentric distance bounds per body from its elements (`sim/orbit/bounds.ts`); bodies that cannot reach the vessel (SOI), the vessel→Sun segment (occlusion) or 30 radii (radiation) are skipped without evaluating their ephemeris | `sim/orbit/bounds.ts`, `sim/orbit/soi.ts`, `game/universe.ts` | Yes — brute-force equivalence test over ~2,000 positions incl. shadows, two scales |
| Optional `Environment.clearOfGround` (one height sample): hull/leg points > 5 cm above the local surface skip the 3-sample ground/normal evaluation (their penetration depth is negative anyway) | `sim/vessel/env.ts`, `sim/vessel/contact.ts`, `game/universe.ts` | Same decisions; 10 determinism traces bit-identical |
| Ephemeris builds each body's conic once instead of spreading a new orbit object per evaluation | `sim/orbit/ephemeris.ts` | Yes |
| Planet layer skips bodies that cannot be within renderer-creation range | `flight/planets.ts` | Same decisions |
| GPU probe only when a re-tune is due | `main.tsx` | — |
| Telemetry structural sharing (`shareUnchanged`), stable HUD callbacks, memoised crew cards, cached key labels and warp titles | `util/snapshotEqual.ts`, `flight/controller.ts`, `flight/hud/{Hud,CrewCards,TopBar}.tsx`, `input/bindings.ts` | — |

Rejected after measuring: a 4-slot multi-time ephemeris cache (vacuum 360 → 430 µs/tick, as in pass 1); a WeakMap
cache of the perifocal rotation per orbit (no gain once orbits are prebuilt). Code-splitting the menu further was not
done: the entry chunk is 107 kB gz of which react-dom is ~60 %; scenarios/tutorial/settings/multiplayer code is ~40 kB
raw and the menu becomes interactive in ~0.5–0.65 s on this machine.

## Before / after

**Simulation, Node** (`scripts/bench/run.ts`, paired runs in the same session, median µs per 20 ms World tick;
[node-sim.json](performance/cpuperf/node-sim.json)):

| Case | Before | After | Change |
|---|---:|---:|---:|
| Kestrel pad | 81.3 | 29.0 | −64 % |
| Kestrel atmosphere | 176.1 | 101.6 | −42 % |
| Kestrel vacuum | 143.1 | 74.9 | −48 % |
| Kestrel landed (Moon) | 1,130.8 | 471.9 | −58 % |
| Selene pad | 74.5 | 33.5 | −55 % |
| Selene atmosphere | 208.7 | 128.0 | −39 % |
| Selene vacuum | 175.0 | 99.3 | −43 % |
| Selene landed (Moon) | 3,007.8 | 1,183.9 | −61 % |
| Rails 1,000,000× | 5,119.3 | 1,333.4 | −74 % |

All ten 100-step determinism traces (`scripts/bench/determinism.ts`) hash identically before and after.

**Real GPU, interleaved A/B, DPR 2** (medians of 2 runs per side; CPU = frameProfiler main-thread ms/frame; GC from
the trace; full table with more columns: [ab-dpr2.md](performance/cpuperf/ab-dpr2.md), DPR 1: [ab-dpr1.md](performance/cpuperf/ab-dpr1.md)):

| Scenario | fps | p99 ms | frames > 25 ms / 10 s | CPU ms/frame | sim ms | render ms | main-thread work % | GC ms/s (max pause) | long tasks/min | heap MB | React renders/s |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pad | 60 → 60 | 16.8 → 16.8 | 0 → 0 | 4.06 → 3.36 | 0.16 → 0.09 | 2.97 → 2.55 | 27.9 → 22.4 | 3.8 (2.3) → 1.3 (1.4) | 0 → 0 | 28 → 43 | 379 → 344 |
| ascent (phys 4×) | 58.7 → 60 | 33.4 → 16.8 | 15.5 → 0 | 4.38 → 3.89 | 0.92 → 0.56 | 2.45 → 2.37 | 34.3 → 29.3 | 14.2 (2.6) → 5.2 (2.9) | 0 → 0 | 45 → 34 | 472 → 440 |
| orbit | 59.6 → 58.5 | 16.8 → 25.1 | 2 → 15.5 | 3.13 → 3.18 | 0.25 → 0.16 | 2.22 → 2.41 | 21.2 → 20.9 | 4.5 (2.4) → 1.8 (1.5) | 5 → 5 | 51 → 56 | 407 → 369 |
| rails 1000× | 60 → 60 | 16.8 → 16.8 | 0 → 0 | 2.08 → 1.98 | 0.24 → 0.18 | 1.25 → 1.30 | 15.1 → 14.1 | 2.6 (2.0) → 1.8 (2.2) | 0 → 0 | 39 → 44 | 417 → 384 |
| rails 100 000× | 60 → 60 | 16.8 → 16.8 | 0 → 0 | 2.72 → 2.09 | 0.93 → 0.33 | 1.23 → 1.27 | 19.6 → 15.6 | 14.3 (3.1) → 2.8 (2.3) | 0 → 0 | 66 → 42 | 422 → 388 |
| map | 60 → 60 | 16.8 → 16.8 | 0 → 0 | 1.53 → 1.50 | 0.23 → 0.18 | 0.36 → 0.38 | 13.0 → 12.5 | 2.7 → 2.1 | 0 → 0 | 39 → 32 | 402 → 384 |
| Moon descent | 60 → 60 | 16.8 → 16.8 | 0 → 0 | 3.21 → 2.95 | 0.33 → 0.24 | 1.96 → 1.92 | 22.1 → 20.3 | 5.9 (2.4) → 3.0 (2.3) | 0 → 0 | 63 → 35 | 550 → 502 |
| Saturn ring skimmer | 60 → 60 | 16.8 → 16.8 | 0 → 0 | 2.23 → 2.21 | 0.29 → 0.26 | 1.38 → 1.45 | 15.7 → 15.1 | 4.2 (1.9) → 2.9 (1.7) | 0 → 0 | 69 → 36 | 550 → 512 |
| editor 73 parts, orbiting camera | 59.8 → 59.8 | 16.8 → 16.8 | 1 → 1 | (2.51 → 2.47 script) | – | – | 16.7 → 16.3 | 0.7 → 1.0 | 0 → 0 | 41 → 31 | 43 → 43 |
| Tracking Station | 60 → 60 | 16.8 → 16.8 | 0 → 0 | (1.05 → 1.07 script) | – | – | 7.7 → 7.8 | 1.6 → 2.0 | 0 → 0 | 15 → 12 | 251 → 248 |
| main menu | 60 → 60 | 16.8 → 16.8 | 0 → 0 | (0.11 script) | – | – | 1.4 | 0.03 → 0.07 | 0 → 0 | 12 → 12 | 0 |

The orbit row's after-side hitches came from one of the two runs (the other had 1); its CPU, sim and GC columns
improved like the rest, and the frames were GPU-side (see findings) — treat orbit pacing as unchanged within noise.
"Main-thread work" is busy time minus Blink's `Commit` (which blocks on compositor/GPU back-pressure and accounted for
50–75 % of every second in flight: the main thread mostly waits for the GPU side).

**Loading** (A/B medians, DPR 2, fresh browser context): cold — menu interactive 589 → 628 ms (noise), controller
1,641 → 1,604 ms, ready 5,891 → 5,054 ms, main-thread long tasks during load 1,130 → 1,086 ms (largest 440 ms, render
side); warm (second visit) — ready 6,684 → 4,747 ms, long tasks 864 → 816 ms. The ready time includes terrain worker
streaming and is noisy; the deterministic saving is the ~30 ms GPU probe per boot.

**Memory over a 3-minute flight** (orbit at 1000×, map toggled every 15 s; heap after forced GC): 17.3 → 20.3 MB,
slope 0.78 MB/min and flattening (0.9 before), DOM nodes 535 → 524, listeners 284 constant, geometries 110 → 155 and
textures 56 → 58 after the first map open, then flat. No leak.

**Scene cycles** (10 × menu→flight→map→editor→flight→menu, per cycle after forced GC):

| | Before | After |
|---|---:|---:|
| DOM nodes | +1,167 | +3 (harness-driven cycles) / +51 (in-page driver; the heap snapshot shows no detached DOM — the counter also counts nodes referenced by performance-timeline entries, e.g. +68 `LayoutShiftAttribution`s over 4 cycles) |
| Event listeners | +560 | 0 / +7 |
| Live `WebGLRenderer`s after 3 cycles | 17 | 2 (thumbnail renderer + menu backdrop, both alive by design) |
| Retained FlightController / EditorView after 3 cycles | 2 / 3 | 0 / 0 |
| JS heap (`JSHeapUsedSize`) | +1.9 MB | +2.1 MB |

The remaining heap growth is not application objects: a heap-snapshot census diff over 4 cycles shows +1.5 MB of
which ~1.0 MB is V8 optimized machine code (`InstructionStream`), 0.25 MB bytecode/`TrustedByteArray`, and DevTools
network buffers; no detached DOM, no surviving controllers/scenes/renderers. Worth re-checking in a long real session;
V8 normally ages such code out.

## Findings for the graphics agent

Measured on the same harness before merging `main` (DPR 2, Medium, 1470×920 CSS → canvas 1470×920 because Medium
then capped DPR at 1; map at 2940×1840). Profiles: `scripts/bench/gpu-profile.sh` on an unminified build.

1. **three.js submission dominates main-thread CPU**: `render` 1.3–2.6 ms/frame and planets `update` 0.1–0.4 ms of a
   2–4 ms frame (pad 2.55 of 3.36 ms). Pad: 455 draw calls / 1.08 M triangles, orbit 349 / 0.71 M.
2. **Programs are re-resolved on every draw of the planet renderer**: `WebGLRenderer.setProgram → getProgram →
   getParameters / getProgramCacheKey` runs each frame under `PlanetRenderer.render` (1.8 s of 10 s inclusive in
   `setProgram` during load+flight; `getParameters` alone allocates **4.7 MB/s**, `getProgramCacheKeyParameters`
   0.8 MB/s). three only does this when `needsProgramChange` is true for a material each draw — typically a material
   drawn into targets with different tone-mapping/colour space (HDR target vs. canvas), a per-frame
   `material.needsUpdate`, or changing `receiveShadow`/clipping/instancing state. Fixing it removes most of the
   render-path allocation and a chunk of the 2.5 ms.
3. **Uniform upload allocations**: `setValueM4` allocates **4.5 MB/s** (matrix uniforms passed as fresh arrays or
   `elements` copies), `setValueV3f` 1.4 MB/s, `painterSortStable` 1.3 MB/s. Total page allocation on the pad was
   ~33 MB/s before this pass, mostly in the render path; after the sim fixes the render path is the main GC source
   (GC 1.3–3 ms/s, max pause ~1.5–3 ms).
4. **Main thread waits on the GPU side**: Blink `Commit` occupies 50–75 % of each second in flight; orbit shows
   bursts of 33 ms frames with only ~3 ms of main-thread JS and GPU timer 8.8 ms (pad 5.6 ms). Earlier warp-1000×
   runs showed frames of 100–277 ms and long tasks up to 813 ms whose JS share was 15–55 ms (native GL waits).
   Candidates: synchronous GL queries (`getError`, timer-query polling, `getParameter`), texture uploads
   (`texSubImage2D` 61–69 ms in single frames right after load) and first-use program introspection (`WebGLUniforms`
   51 ms in one frame).
5. **Loading (cold, ~1.1 s of long tasks)**: FlightController construction is one 627 ms task, of which LaunchSite
   procedural textures 260 ms (`speckle` 184, runway 46, road 33 — cached on warm loads) and `createBatches` 303 ms;
   shader warm-up has a 218 ms synchronous part (`WebGLShader`, `replaceLightNums`) before `compileAsync`;
   `buildTransmittanceLUT` 25–34 ms on the main thread (menu and flight); the menu's Saturn backdrop costs a 70 ms
   context init (`getExtension`) and ~1.5 s of 75–83 ms frames with ~2–4 ms of JS while it streams in. Moving the
   speckle/canvas generation and batching into a worker (OffscreenCanvas) would remove the largest cold-load stall.
6. **Map view layout**: `MapView` positions labels with `style.left/top` every frame — 58 layouts/s and 62 style
   recalcs/s in the map (baseline run); use `transform: translate(...)` (already used for markers). Tracking Station:
   42 style recalcs/s; `MapView.update` ~0.6 ms/frame there.
7. **Renderer teardown**: `RenderPipeline.dispose()` and `ui/planetPreview.ts` should use
   `src/render/releaseRenderer.ts` (or equivalent) so any future scene owner cannot reintroduce the retention above.
8. These runs predate the `op/gfx` merge: Medium then rendered 1470×920 at DPR 2 (DPR capped at 1). Since that merge
   Medium renders at device resolution (2940×1840 on Retina, 4× the pixels) with SMAA, so the GPU side — and the
   `Commit` back-pressure in item 4 — will weigh more on the MacBook than measured here; the CPU-side numbers in this
   pass are resolution-independent. The map renders at 2940×1840 and is cheap (0.4 ms GPU, 29 draws). A smoke run of
   the merged build at DPR 2 measured the Kestrel pad at **47 fps, 93 frames > 25 ms in 6 s, CPU 5.1 ms/frame** (vs
   60 fps / 3.4 ms before the merge) while map, Saturn and the editor stayed at 60 fps — the device-resolution Medium
   preset is now the dominant cost on the pad.
9. After merging `main`, the simulation wins hold (Node, per 20 ms tick, main → merged): Selene landed 3.68 → 1.63 ms,
   vacuum 0.60 → 0.36 ms, rails 1e6× 7.33 → 2.21 ms; determinism traces identical to `main`. The contact fast path is
   forwarded through the relative-frame environment that `op/moonxfer` now uses for all unpacked vessels.

# Flight graphics fidelity and GPU cost — 2026-10-06 (`op/gfx`)

Measured on the real GPU (Windows Chrome 154, RTX 3060 Ti) with a 1470×920 CSS viewport at
emulated DPR 2 (MacBook Retina), i.e. a 2940×1840 drawing buffer. GPU ms come from
`EXT_disjoint_timer_query_webgl2` (`pipeline.gpuMs`). Per-component costs were measured
with two methods. The first hides one material family and differences the timer reading.
The second (`renderer bench`) renders 30 frames between two `readPixels` syncs. fps values
are noisy: another agent's game tab shared the GPU, and DevTools DPR emulation adds
compositor work. Read fps as a range and the GPU ms as the comparison.

The driver lives outside the repo (`C:\wsp-tools\drv\gfx.mjs`, `js/bench.js`, `js/prof.js`).
It sets `wsp.settings.v1` for the preset, emulates DPR, measures and screenshots through CDP.

## Per-pass GPU cost at DPR 2, Medium (ms)

| Pass / component | Pad before | Pad after | Low orbit before | Low orbit after |
|---|---:|---:|---:|---:|
| Whole frame (GPU timer) | 17.2 | 6.6–7.3 | 32.2 | 7.2–7.7 |
| Clouds (Earth shell) | 2.3 | ≈0.3 | **16.7** | 2.5 |
| Aurora volume (whole-screen march) | **5.6** | ≈0 | **6.6** | ≈0 |
| Milky Way band | 4.5 | ≈0 (baked) | 2.5 | ≈0 |
| Terrain (incl. aerial perspective) | 2.5 | 1.0–2.0 | 4.0 | 1.1 |
| Ocean | — | ≈0.5 | 2.1 | 0.65 |
| Sky shell | 1.5 | 1.5 | 2.0 | 1.6 |
| Vessel parts (PBR) | ≈1.0 | ≈1.0 | ≈0.1 | ≈0.1 |
| Shadow map | <0.2 | <0.2 | <0.1 | <0.1 |
| Bloom | 0.4 | 0.2–0.3 | 0.4 | 0.24 |
| AA | FXAA 0.3 | SMAA 0.4–0.6 | FXAA 0.3 | SMAA 0.5 |

The "before" column is the old code forced to DPR 2. Medium previously ran at DPR 1: 5.7 ms
on the pad and 8.7 ms in orbit, at a quarter of the pixels. Medium now spends about the same
GPU time at four times the pixel count.

## Presets at DPR 2 (RTX 3060 Ti)

| Preset | Drawing buffer | Pad GPU ms / fps | Orbit GPU ms / fps |
|---|---|---|---|
| Low | 735×460 (unchanged: half of 1×) | 0.3 / 60 | 0.3 / 60 |
| Medium, adaptive off | 2940×1840 | 6.6–7.3 / 34–46 | 7.7 / 38–45 |
| Medium, adaptive on (default) | settles at 0.8 (DPR 1.6) | 4.8 / ~57 | — |
| High | 2940×1840 + 4× MSAA | 13.1 / 33 | 11.8 / 37 |

Before this pass, High at DPR 2 measured 27 ms / 22 fps on the pad.

The emulated DPR 2 viewport costs this machine extra compositing that the timer queries do
not see. Even with the scene materials hidden, the composer at full resolution ran at only
about 45 fps. This is why adaptive resolution no longer trusts a low timer reading when the
main thread is idle. On a Mac the native Retina compositor path differs, so check the F8
overlay there.

## Changes

| Change | Files |
|---|---|
| Medium: DPR up to 2 + SMAA. High: MSAA 4× + SMAA. Low: FXAA, unchanged resolution | `render/core/quality.ts`, `renderer.ts` |
| Adaptive: tier-based start, predicted-scale jumps, one-window reaction when severe, CPU-aware GPU-idle veto | `render/core/adaptiveQuality.ts`, `renderer.ts` |
| GPU-baked procedural cube maps in strips (cloud field, Milky Way) | `render/core/proceduralCube.ts`, `planet/cloudMap.ts`, `sky/Starfield.ts` |
| Cloud shading: detail erosion, cumulus cells, HG phase, grey bases, cloud shadows on surfaces | `planet/materials.ts`, `PlanetRenderer.ts`, `uniforms.ts` |
| Aurora early rejection (polar slab / night side) | `planet/effects.ts` |
| Per-vertex aerial perspective (terrain, ocean) and ocean sky reflection | `planet/materials.ts` |
| Submerged-chunk culling bounds include sea level (ocean holes) | `planet/quadtree.ts` |
| GLSL portability fixes + test (Mac green wash) | `sky/SunGlare.ts`, several shaders, `tests/glsl-portability.test.ts` |
| Shadow range/bias/softness | `flight/controller.ts` |

Before/after images (left: before at Medium's old DPR 1; right: after at DPR 2) are in
`docs/screenshots/gfx/`. `sea-fixed.jpg` shows the descending-capsule view that used to show
the ocean hole.

**Note for the CPU/perf agent:** these are render-side only. `PlanetRenderer.update` now steps
the cloud bake for its first ~24 frames (one strip each) and `Starfield.update` steps the
Milky Way for its first ~6. Both are GPU work of a fraction of a millisecond each. Main-thread
frame time is reported as `pipeline.cpuMs`.

## Coherent cloud field — 2026-10-06 (`cx/clouds`)

The previous cumulus shader thresholded several noise octaves into isolated bright cells over otherwise
clear terrain and sea. Coverage now comes entirely from one baked R8 cube map: large fronts, six
mid-latitude curls, an undulating ITCZ, subtropical gaps, and coastal stratocumulus decks. A 128×64
terrain-derived land mask locates those decks west of this game's fictional continents. Removing the
whole-field longitude drift keeps the decks over their ocean basins. This remains static procedural
weather; it does not add a weather simulation or volumetric cloud march.

Cube faces retain 512/1024/1536 resolution on Low/Medium/High (Low still disables clouds by default).
They use trilinear mipmaps and 4× anisotropy, with no equirectangular seam or polar convergence.
R8 replaces RG8: logical mip storage is approximately 2/8/18 MiB rather than 4/16/36 MiB, plus an
8 KiB bake-only geography texture. Octaves are limited by resolution **and** attenuated by the bake's
derivative footprint, including where a vortex compresses a front. Runtime detail only modulates
existing cover, with each octave independently footprint-filtered and faded over 60–350 km viewing
distance. It cannot generate bright dots in a clear area.

Lighting retains the HG forward lobe, grey bases, aerial perspective, and shared cloud shadows on
terrain/ocean/scatter. Cloud tops receive less self-shadowing. One back-face shell pass writes the
analytic cloud intersection's logarithmic depth; this handles cameras above, below, and between the
true cloud layer and the conservative proxy mesh without changing material variants.

### Verification method

Windows Chrome through CDP `127.0.0.1:9333`, hardware ANGLE/D3D11 NVIDIA GeForce RTX 3060 Ti;
1470×920 CSS, DPR 2, 2940×1840 buffer, adaptive resolution off. Dev server is **5318** in the clouds
worktree (owner approved this because cpuperf already owns 5317). Orbit uses stock Meridian at
~150 km. The shell cost is a GPU-timer difference with only its material hidden; surface cloud
shadows remain enabled in both measurements. Final measurements bracket the hidden run with two
visible runs, discard 40 settling frames per phase, and take the median of 110 smoothed GPU samples.
The baseline used 120-frame medians with a 1.5 s settling interval. Full-scene differences include
normal host/GPU scheduling noise; these are not isolated shader microbenchmarks or laptop FPS claims.

`node scripts/clouds-check.mjs <base-url> <shot.png> <query> [flight|preview]` reproduces screenshots,
GPU timing, console errors, and cube coverage. On Windows it uses the owner's installed Playwright
at `C:/wsp-tools/drv/package.json`; `WSP_PLAYWRIGHT_PACKAGE` can override that location. The preview
now exposes its renderer/scene/planet for this dev-only check and polls the existing GPU timer.
`mapviz2.mjs` with `scripts/clouds-views.json` captures the globe, pole, 20 km, shell crossing, grey
undersides and pad sky from one warmed High-quality preview.

Coverage is measured from all six GPU-baked faces with solid-angle weights
`(1 + s² + t²)^(-3/2)`, not from a screenshot. High gives **65.19% at density > 0.1**;
56.52% exceeds 0.2 and 39.46% exceeds 0.5. The softest wisps raise density > 0.01 coverage to
80.03%; mean density is 0.376. This defines “coverage” explicitly rather than treating every
nonzero transparent edge as an opaque cloud. Globe shell cost is about **0.23 ms** on High at
1,200 km altitude, where runtime detail is fully faded. Readback reported WebGL error 0 and no
browser/shader errors. Raw baseline and globe measurements are in `docs/performance/clouds-*.json`.

Validation: `npm run lint`, `npx tsc --noEmit`, `npx vitest run --maxWorkers=3` (**89 files / 1,015 tests**,
307.36 s), and `npm run build` pass. Final shader adjustments also pass the focused cloud geography
and GLSL portability tests; final lint/type/build checks pass. Existing bundle-size and ineffective
dynamic-import build advisories remain. `git merge main` reported already up to date.

Final Medium orbit measurement: cloud shell **2.35 → 1.10 ms**, full scene **7.72 → 6.90–6.94 ms**.
The final hidden-shell phase was 5.82 ms; the baseline hidden-shell phase was 5.37 ms. The difference
between those controls illustrates the background variation, so the shell deltas are the useful
comparison. The bake still runs once in strips and the steady-state shader still uses two cube
lookups (density and self-shadow) plus distance/footprint-filtered detail. No new per-frame bake.

Inspected screenshots: [before orbit](screenshots/clouds/before-orbit.png),
[150 km orbit](screenshots/clouds/orbit.png), [1,200 km globe](screenshots/clouds/globe.png),
[20 km](screenshots/clouds/20km.png), [pad sky](screenshots/clouds/pad-sky.png),
[grey bases](screenshots/clouds/grey-base.png), [polar view](screenshots/clouds/polar.png),
and [7 km shell crossing](screenshots/clouds/shell-crossing.png). Pad sky is at the exact launch-site
latitude/longitude; the separate stock-Meridian pad flight was also checked in Windows Chrome.
No console/shader errors occurred in the final sweep. The cloud layer is still a thin shell, so it
reads as a sheet when very close; this work improves satellite-scale structure without adding
volumetric marching to the GPU budget.

# Render snappiness pass — 2026-10-06 (`op/snappy`)

Goal (owner): "super snappy" on a Retina MacBook (M-series, DPR 2, Medium) without visible quality loss. All numbers:
Windows Chrome 154 over CDP, RTX 3060 Ti, production builds, Medium, 1470×920 CSS px at **DPR 2 (2940×1840)**,
adaptive resolution **off** unless stated. "Before" = `main` at the time of measuring, "after" = this branch merged
with it; runs are interleaved A/B (`scripts/bench/gpu-ab.sh`) because the browser/GPU is shared with other agents.

## What limited the frame

- **The pad missed vsync with only 6.9 ms of GPU timer time** (47.6 fps, ~120 frames > 25 ms per 10 s). A knob
  sweep (`scripts/bench/gpu-knobs.mjs`, which also traces Chrome's GPU-process main thread) showed: frame rate
  tracks pixel count (renderScale 0.75 → 60 fps, 0 hitches), not bloom/SMAA/composer/shadows (each ≤ 1.5 fps);
  the GPU-process main thread was 57 % busy and ~5 ms of it is fixed DPR-2 compositing even with an empty scene.
  On this machine 60 fps at DPR 2 needs the timer at ≈ 4.5 ms. A readPixels-fenced throughput test put the whole
  frame at 6.24 ms; on an M-series base GPU (≈ 4–5× less fill/ALU than a 3060 Ti) that is ~25–30 ms, so fill
  cost is the lever that decides at which resolution adaptive settles on the owner's Mac.
- **Per-pixel waste** (fenced, pad, ms of a 6.24 ms frame): terrain 1.66 — Earth night-light noise (5 simplex
  evaluations per land pixel) ran in full daylight and was then multiplied by zero; sky shell 1.54 — the 16-step
  march also ran for every pixel below the horizon, which terrain covers (log-depth `gl_FragDepth` writes disable
  early-Z, so hidden pixels pay in full); site 1.23 (PBR + 4-step aerial perspective on ~70 % of the screen);
  post chain 1.07 (SMAA 0.55, bloom 0.27).
- **Draw calls**: 888 on the pad, 604 of them terrain chunks. LOD error was measured in device pixels, so DPR 2
  roughly doubled chunk count, CPU submission and per-vertex aerial-perspective work.
- **Program re-resolution**: shared part/site materials were drawn by both `InstancedMesh` (static part batches,
  site light poles) and plain meshes, so three re-ran `getProgram` (`getParameters` + cache key) for each such
  material twice per frame — 14 per frame on the pad, 717 ms of an 8.4 s profile under `setProgram`.
  (`setValueM4`'s ~5 MB/s is inside three; GC was ~1 ms/s before and after, so it was not chased further.)
- **Map**: labels positioned with `left/top` every frame — 59 layouts/s.
- **Load**: one ~450 ms constructor task (site canvas textures: `speckle` alone 123 ms of string-built `rgba()`
  fills), a ~435 ms first-update task (all planet renderers at once, 30 ms transmittance LUT), a ~200 ms
  synchronous shader warm-up, then 170 + 80 ms first frames (texture uploads, uniform introspection).

## Changes

| Change | Where | Visual effect |
|---|---|---|
| Daylight early-out for Earth night lights | `planet/materials.ts` | none (output was × 0) |
| Sky rays that hit the ground sphere march 4 steps instead of 16 (covered by terrain/ocean/far sphere) | `planet/materials.ts` | none on screen; gap fallback only |
| Site aerial perspective 1 / 2 / 4 steps by distance (< 4 km / < 20 km / beyond) — per-segment integration is exact in a homogeneous medium | `site/aerial.ts` | none visible |
| Terrain LOD tolerance × √(pixel ratio): DPR 1 unchanged, Retina ≤ 2.5 CSS px | `core/renderer.ts` (`lodViewportHeight`), flight/hub/preview | far silhouettes marginally coarser; not visible in A/B shots |
| Instanced material variants (cached clone, shared textures and shader patches) | `core/materialVariants.ts`, `vessel/staticBatch.ts`, `site/LaunchSite.ts` | none |
| Map labels/markers: `translate3d`, cached style writes (only on change) | `map/styleWriter.ts`, `map/MapView.ts` | none |
| Sliced shader warm-up: one representative per program configuration, ≤ 8 ms per frame, rescans for late objects, then pre-pays uniform introspection and texture uploads | `core/compileInSlices.ts`, `flight/controller.ts` | loading screen keeps animating |
| Speckle fills with two constant colours + `globalAlpha` (±1/255) | `site/textures.ts` | none |
| Transmittance LUT memoised per atmosphere; ≤ 1 non-focus planet renderer created per frame | `planet/atmosphereParams.ts`, `flight/planets.ts` | none |
| Adaptive resolution: mean-rate trigger (ProMotion/no timer), reductions judged as an episode and undone when they do not help | `core/adaptiveQuality.ts` | stays sharp when the limit is not pixels |
| `RenderPipeline.detach()/dispose()` via `releaseRenderer` helpers (flight, hub, tracking, planet preview) | `core/renderer.ts`, `releaseRenderer.ts` | — |

Rejected: vertex-computed log depth for the sky (early-Z) — breaks near-plane clipping of a shell around the
camera; cheaper AA (FXAA) or quarter-res bloom at DPR 2 — 0.2–0.3 ms each for a visible change; BatchedMesh terrain
— large change for CPU only, while this machine and the Mac are fill/GPU-side limited.

## Per-pass GPU cost at DPR 2 (pad, readPixels-fenced, ms)

Component costs are differences with that material family hidden (`scripts/bench/knobs/families.js`); "after
shaders" is the build with the three shader changes only, "after" the full change set (adds the LOD tolerance).

| Component | Before | After shaders | After |
|---|---:|---:|---:|
| Whole frame | 6.24 | 4.49 | 3.87 |
| Terrain (incl. per-vertex aerial perspective) | 1.66 | 0.93 | — |
| Sky shell | 1.54 | 0.83 | — |
| Launch site | 1.23 | 1.13 | — |
| Post chain with an empty scene (bloom, output, SMAA, copies) | 1.07 | 1.11 | — |
| GPU timer in the running frame loop | 6.9 | 4.9 | 4.45 |

Shadow map, environment lighting, plumes, scatter and parts are each ≤ 0.2 ms here.

## Before / after (interleaved A/B, DPR 2, adaptive off)

Pre-merge run ([ab-snappy1](performance/snappy/ab-snappy1.md), 2 runs per side, medians):

| Scenario | fps | frames > 25 ms / 10 s | GPU ms | draws | CPU ms/frame | render ms | GC ms/s | layouts+styles /s |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| pad | 47.6 → 56.3 | 120.5 → 36.5 | 6.91 → 4.45 | 888 → 621 | 5.28 → 3.88 | 3.98 → 2.87 | 1.30 → 1.27 | 9.1 → 9.1 |
| orbit | 45.7 → 52.7 | 171 → 80 | 5.93 → 4.17 | 533 → 442 | 4.31 → 3.47 | 3.26 → 2.56 | 1.09 → 1.11 | 4.6 → 5.3 |
| map | 54.9 → 56.2 | 63 → 52.5 | 0.47 → 0.34 | 32 → 32 | 1.75 → 1.62 | 0.44 → 0.45 | 1.79 → 2.07 | 113.8 → 32.5 |

(The map's base fps was below its usual 60 because another agent's game tab shared the GPU during this run.)

FINAL_AB_PLACEHOLDER

**Load** (fresh context, Kestrel): flight constructor 446 → 392 ms; the 435 ms first-update task → 348 ms; shader
warm-up from one ~200 ms task to ≤ 8 ms slices (≈ 470 ms wall, behind the loading screen); first drawn frame
167 → 94 ms and the 75 ms second frame gone (V8 profiles, unminified builds). Interleaved A/B (pre-merge): ready
6.75 → 5.02 s cold, 6.30 → 4.29 s warm; largest load long task 432 → 380 ms cold, 276 → 200 ms warm.

**Program churn**: getProgram re-resolutions per frame 14 → 0 on the pad, in orbit and on the Meridian pad.

**Visuals**: [pad](screenshots/snappy/pad-before-after.jpg) / [orbit](screenshots/snappy/orbit-before-after.jpg)
(left before, right after, DPR 2, same resolution) and 1:1 crops (`*-crop-before-after.jpg`) are indistinguishable.

## Left / next

- On this desktop the pad at fixed DPR 2 is ~56 fps: ~5 ms of compositing for a DPR-2-emulated canvas sits outside
  the timer, so hitting 60 here needs ≈ 4.2 ms of GPU timer. Adaptive resolution covers it (0.9 is enough).
- Remaining per-pixel cost is honest work: site PBR (1.1 ms on the pad), SMAA (0.6), sky (0.8 above the horizon).
- CPU: ~620 draws on the pad, 4.4 µs each in three; merging terrain chunks (BatchedMesh / multi-draw) is the next
  CPU lever if a CPU-bound device shows up.
- Cold load: the remaining long tasks are WebGL context creation (~45 ms), uncached site textures (~120 ms, cached
  after the first visit) and Earth's renderer build (~100 ms).

## Coastal ground art (cx/groundart, 2026-10-06)

Ground art retains the HDR → bloom → tonemap → SMAA pipeline and adds no render pass. New façade pieces/signs share merged material batches. Coastal trees use instanced near/coarse crowns with a 1.2–1.6 km dither transition and 7–10 km fade; terrain detail reuses existing triplanar samples. Grass colour is evaluated in terrain workers. Site textures, including the two small new window/sign atlases, use the existing memory/IndexedDB cache. Earth terrain receives the existing solar comparison-depth map; its pad footprint is widened to 420 m, avoiding a second cascade.

Real Windows Chrome / ANGLE D3D11 / RTX 3060 Ti, **1470×920 CSS, DPR 2 (2940×1840), Medium, scale 1, adaptive off**, stock Kestrel on the pad. Baseline `b6ec2204`, ground-art implementation `0a1d9086`. Production snapshots were served from a single Vite on port 5334. `scripts/bench/gpu-ab.sh` completed this interleaved pair using the F8 timer:

| Measurement | Before | After | Delta |
|---|---:|---:|---:|
| Whole scene GPU | 4.851 ms | 5.061 ms | +0.210 ms |
| Draw calls | 621 | 637 | +16 |
| Triangles | 1,472,767 | 3,358,445 | +1,885,678 |
| Textures | 84 | 87 | +3 |

Raw pair: [before](performance/groundart/groundart-final-A-pad-r1-dpr2.json), [after](performance/groundart/groundart-final-B-pad-r1-dpr2.json). This pair meets the +1 ms / under-6 ms pad target. It is one completed pair from the standard harness, not a confidence interval. Concurrent agents shared Chrome/GPU; do not infer an FPS improvement from these captures.

Two further interleaved pairs sampled the same F8 timer at DPR 2 through page-specific CDP (`scripts/groundart/timing.mjs`, 120 settling frames + 300 samples per case). Median GPU times were **4.897 → 5.550 ms** and **5.026 → 5.489 ms**: average **4.962 → 5.519 ms (+0.558 ms)**, both after medians below 6 ms and both increments below 1 ms. [Raw repeated timings](performance/groundart/groundart-timing.json). All four cases report the RTX renderer, 2940×1840 canvas and WebGL error 0. These isolate the ground-art implementation; the later main merge's flight-handling changes were separately smoke-tested on the pad.

A later instrumented pass run (`scripts/groundart/passes.mjs`, hardware elapsed queries, no disjoint or GL errors) measured scene + shadows **4.556 → 5.383 ms**, bloom **0.354 → 0.342 ms**, SMAA **0.574 → 0.575 ms**, output **0.129 → 0.132 ms** (per-pass medians). It confirms the added work is in scene/shadows, with about **+0.83 ms** there. Whole-frame rolling timers in these more contended runs were **7.013 → 6.444 ms**; the absolute under-6 ms target therefore is not guaranteed under concurrent GPU load. Preserve this evidence alongside the cleaner pair: [before passes](performance/groundart/groundart-before-passes.json), [after passes](performance/groundart/groundart-after-passes.json). No GPU timing claim is made for Apple hardware.

Interleaved cold/warm direct-flight loads (`scripts/groundart/load.mjs`, two rounds, fresh browser context per side, one reload for warm cache):

| Ready mark | Before | After |
|---|---:|---:|
| Cold, round 1 | 6.640 s | 4.177 s |
| Cold, round 2 | 6.449 s | 6.394 s |
| Warm, round 1 | 3.138 s | 3.229 s |
| Warm, round 2 | 2.878 s | 2.868 s |

Cold constructor times were **394–405 → 398–410 ms**; maximum cold main-thread task **412 → 416 ms**. Warm ready time changed by **+91 / −10 ms**. The first warm after run had a 348 ms constructor task versus 219 ms maximum before; the second settled to 198 versus 182 ms. There is no increase in the measured worst-case load stall, but the small sample and shared machine do not establish a startup speedup. [Raw load evidence](performance/groundart/groundart-load.json). New atlases are cached; no added network art assets or dependencies. Isolated ground-art precache grew about **9 KiB (0.4%)**; the later main merge also adds unrelated UX code.

Before/after DPR-2 images and critical review: [ground-art screenshots](screenshots/groundart/README.md). Six views cover chase pad, Space Center, 2 km coastal land, sunset, Earth night orbit and lunar surface. The standalone preview initially exposed an incomplete comparison sampler; an explicit 1×1 depth fallback fixed it. Accepted views returned WebGL error 0. Main was merged; lint, typecheck, **98 files / 1,099 tests**, and production build passed.

Remaining visual limitations: the coastal height field/hydrology is unchanged; no geographic wetland reconstruction or new distant settlement meshes. Crowns retain a faceted silhouette. The single wide shadow map softens nearby fine shadows compared with a true cascade. Night work lighting is a bounded material wash, not local shadow-casting lights. Existing warm aerial perspective is retained; no extra volumetric fog pass. The city mask is fictional, coast/latitude weighted, and intentionally subtle.

## Adjustable graphics / Ultra — 2026-10-07 (`cx/gfxsettings`)

Ultra is opt-in; first-run GPU tiering still selects Low for weak/integrated hardware or Medium otherwise.
Graphics profile 2 preserves existing profile-1 settings instead of resetting manual choices. Advanced changes
persist under the existing settings key. Custom retains its base preset and stores only overrides.

| Preset | Max DPR × scale | AA | Sun shadow | Terrain error / spacing | Sky / aerial samples | Baked width | Stars | Particle pool |
|---|---|---|---|---|---|---|---|---|
| Low | 1 × 0.5 | FXAA | off | 6 px / 6 m | 8 / 3 | 512 | 4,000 | 128 |
| Medium | 2 × 1 | SMAA | 1024² | 3.5 px / 3 m | 16 / 6 | 1024 | 9,000 | 512 |
| High | 2 × 1 | MSAA 4× + SMAA | 2048² | 2 px / 1.5 m | 24 / 8 | 2048 | 16,000 | 1024 |
| Ultra | 2 × 1 | MSAA 4× + SMAA | 4096² | 1 px / 0.75 m | 32 / 12 | 4096 | 24,000 | 2048 |

Ultra also increases chunk resolution to 48, scatter radius to 1536 m, cloud cube faces to 2048²,
and resolved planet-effect sample budgets. Part detail stays High. Earth exposes the exact shared
texture/atmosphere/cloud/ocean/night-light grades; each preset uses its own grade, with night lights enabled.
Low retains its legacy clouds-off default (its Earth cloud resource grade is Low); selecting Low cloud quality
explicitly enables the low-resolution shell. Ocean quality independently selects its aerial sample budget.
This branch wires existing effects and does not build the realistic Earth artwork.

Advanced controls: render scale 50–150%, Retina limit 1/1.5/2/3, AA off/FXAA/SMAA/MSAA+SMAA,
shadows off/Low/Medium/High/Ultra, terrain detail, ground clutter/vegetation (including off), atmosphere,
clouds (including off), Earth texture, ocean, night lights, bloom, stars/Milky Way (including off), particles,
part detail, 30/60/120/unlimited frame cap, and adaptive resolution. Rows include visible cost explanations
and title tooltips. Resolution/AA/shadows/bloom/particles are live in flight; resource/geometry changes rebuild
single-player flight from a snapshot without a page reload. Multiplayer defers structural changes until re-entry.
Other scenes use new graphics resources on entry. Frame caps pace flight, hub, editor and tracking, and adaptation
uses the selected cap rather than treating intentional 30 fps pacing as overload. Unlimited retains the existing
60 fps adaptive-resolution target; turning adaptation off allows full display-rate rendering.

Screenshots and viewport checks: [1024×768](screenshots/gfxsettings/settings-1024x768.png),
[800×768](screenshots/gfxsettings/settings-800x768.png),
[lower controls](screenshots/gfxsettings/settings-800x768-lower.png). Both menus fit within the viewport,
scroll independently of the header, and have no horizontal overflow or clipped selects.

Hardware integration: Windows Chrome over CDP 9333, hardware ANGLE/D3D11 RTX 3060 Ti.
[Advanced-control checks](performance/gfxsettings/live-controls.json) passed 15 changes;
[pipeline checks](performance/gfxsettings/pipeline-controls.json) passed scale, bloom, scattering and adaptive on/off.
Both also exercised all four frame caps, with no browser/GL errors. Observed frame rates can be below a cap;
this verifies an upper limit, not the ability to achieve 120 fps on this hardware/display.
Run `scripts/bench/gfxsettings-check.mjs` beside Windows `playwright-core` against the dev server for these
source-module integration checks (optional third argument `pipeline` skips the advanced-resource checks).

Limits: one sun shadow map (no cascade system); MSAA remains four samples and the device clamps supported
sample counts. Ultra substantially increases render-target/geometry/texture memory and does not promise
60 or 120 fps at Retina resolution. Terrain, scatter and larger texture bakes can take time to settle.
Frame caps limit cadence rather than guaranteeing it. The editor retains its existing native antialiasing
path rather than the flight HDR/post-processing chain. The 120 Hz control and adaptation budget are covered,
but an actual ProMotion/Apple-GPU run was not available. No Apple performance claim is made.
## Real Earth terrain (2026-10-07, cx/realearth)

The ETOPO sampler replaces many continental/warp/noise evaluations with bilinear int16 lookups and bounded fine detail. Following the batch-mean methodology above, an alternating baseline/current comparison (5 warmups, 9 batches × 8 chunks, 24 quads) measured median **4.193 → 0.712 ms** for the existing Earth chunk, **3.796 → 0.827 ms** for a coastal-face chunk, and **4.489 → 1.222 ms** for a whole-face chunk. p95 improved in every case. Shared host / simultaneous test load; these establish no chunk CPU regression, not a promised FPS uplift. The separate initial existing-harness run measured 2.079 ms before / 0.616 ms after the first integration; use the final paired artifact for comparisons.

Raw samples, exact baseline revision, reproduction and the identical 20-second ascent hashes are in [realearth evidence](screenshots/realearth/README.md). The grid is **16,777,216 bytes** on disk and resident; float64 interpolation uses JS scalars, with no float64 raster copy or extra masks. Ordinary non-isolated browsers retain 16 MiB main + 16 MiB per terrain worker (64 MiB for three workers). Cross-origin-isolated hosts share one 16 MiB buffer; loading temporarily retains the fetched buffer too. Worker messages send the grid only once, independent of LOD and preset registrations. Browser PWA precache includes the grid (about 18.4 MiB total app precache at the initial integration); no optional high-resolution pack is shipped.

### Final merged-code hardware measurements

Revision `e5aaf9af` incorporates main's real Earth geography (`8e91a05d`). Production build, Windows Chrome
CDP 9333 / ANGLE D3D11 / NVIDIA GeForce RTX 3060 Ti; 1470×920 CSS at DPR 2, adaptive resolution off,
preset render scales, no cap. Each case has its own browser context and waits 15 seconds after the loading
screen before a 10-second capture. Orbit is `?flight=stock-kestrel&scenario=orbit`; pad is `?flight=stock-kestrel`.
GPU columns are the pipeline's **final exponentially smoothed elapsed-query readings**, not medians of raw
GPU samples. FPS and pacing statistics cover the capture window. All eight cases returned WebGL error 0.

| Preset | Pad GPU ms | Orbit GPU ms | Pad fps | Orbit fps | Pad / orbit draws |
|---|---:|---:|---:|---:|---:|
| Low | 1.04 | 0.88 | 52.60 | 59.50 | 220 / 166 |
| Medium | 6.66 | 4.95 | 25.89 | 28.15 | 704 / 418 |
| High | 12.89 | 9.10 | 20.67 | 22.61 | 1391 / 710 |
| Ultra | 19.84 | 10.56 | 15.68 | 25.64 | 2032 / 997 |

Low renders 735×460 pixels; Medium/High/Ultra render 2940×1840. This comparison measures the complete
preset policies, including Low's reduced resolution. Ultra increases pad geometry to about 16.1 million
triangles and ~2,032 draws in this capture, versus High's ~7.2 million and ~1,391. The larger 4096-wide
bake now retains close-up terrain instead of hiding it behind a smooth far sphere. Shared CPU/GPU use,
background scheduling and remaining terrain/texture work make absolute FPS and small timing differences
noisy. These are observed costs, not guaranteed 60/120 fps or measurements of Apple hardware.

Raw captures: [Low](performance/gfxsettings/gfxsettings-merged-low-dpr2.json),
[Medium](performance/gfxsettings/gfxsettings-merged-medium-dpr2.json),
[High](performance/gfxsettings/gfxsettings-merged-high-dpr2.json),
[Ultra](performance/gfxsettings/gfxsettings-merged-ultra-dpr2.json). Each has a matching Markdown readout.
Earlier captures are explicitly archived under `performance/gfxsettings/pre-earth-merge/` and are not the
final merged-code comparison. Reproduction (Windows driver location and Node match the owner's harness):

```sh
npm run build
npx vite preview --host 0.0.0.0 --port 5327 --strictPort
bash scripts/bench/gpu-bench.sh --base http://<WSL-IP>:5327 --label gfxsettings-merged-ultra \
  --quality ultra --dpr 2 --cases pad,orbit --seconds 10 --settle 15000 --trace 0
```

Final merged-code validation: lint, `npx tsc --noEmit`, production build, and full
`npx vitest run --maxWorkers=2` pass: **109 files / 1,327 tests**, 407.78 s.

Ultra cold readiness in the final harness was about **30.3 s on the pad / 24.8 s in orbit**. Larger
terrain/texture resources make initial preparation and structural setting rebuilds noticeably slower;
these startup durations are separate from the steady rendering measurements above.

## Real Earth imagery (2026-10-07, op/earthgfx)

Full tables, method and screenshots: [`docs/screenshots/earthgfx/README.md`](screenshots/earthgfx/README.md); raw
logs in `docs/performance/earthgfx/`. Summary (RTX 3060 Ti, DPR 2, paired readPixels-fenced frames, shared GPU):
Medium flight low orbit +0.03…+0.09 ms and pad +0.07…+0.14 ms vs main (within noise), 1,500 km orbit −0.01 ms,
night side −0.64 ms, open-ocean glint −0.21 ms; after merging op/perfgpu, low orbit −0.05 ms (two pairs) and the pad
within noise. High +1.3 ms and Ultra +0.6 ms over main's same preset. Imagery
streaming peaks at 5.2 ms of main-thread time in one frame (High). Tools: `scripts/bench/earthgfx-ab.mjs` (preview
views), `earthgfx-flightfam.mjs` (flight, per material family), `earthgfx-stalls.mjs` (frame intervals and long
tasks while streaming), `earthgfx-texleak.mjs` (textures across 12 month swaps), `earthgfx-shots.mjs`. Wrap GPU
runs in `flock /tmp/wsp-gpu.lock` — the harness is shared.
## Loading and main-thread CPU — cx/perfcpu, 2026-10-07

Baseline: `7bd6e4f9` (real Earth already integrated). Final loading implementation: `b4f9f3ec`.
Production builds only; Medium, adaptive resolution off, 1470×920 CSS pixels at DPR 2.
Hardware: shared Windows Chrome 154 / ANGLE D3D11 / RTX 3060 Ti / Ryzen 5600X.
Every Windows browser run acquired `/tmp/wsp-gpu.lock`. These are single paired samples,
not confidence intervals or measurements of the owner's M-series MacBook/120 Hz display.
CDP CPU throttling at both 2× and 4× stalled the Windows renderer (including evaluation),
so hardware results below use **1×**. Separate local Chromium/WSL **4×** diagnostics
replace WebGL draw calls with no-ops; they retain three.js submission and software-driver
overhead and cannot establish laptop FPS or the 4 ms hardware CPU target.

### Loading results

Milliseconds from the automated route/action to readiness. Cold means a fresh browser
context; warm means a same-context reload with HTTP/IndexedDB caches, not retained JS
modules. Service workers are blocked to keep the cache boundary reproducible. Restores
within either sequence benefit from the new in-memory surface cache.

| Transition | Cold before | Cold after | Warm before | Warm after |
|---|---:|---:|---:|---:|
| Navigation → interactive menu | 1,565 | 1,210 | 2,654 | 1,289 |
| Menu → Space Center | 3,718 | 885 | 1,089 | 610 |
| Space Center → editor | 4,984 | 856 | 4,664 | 804 |
| Editor → controllable pad | 6,912 | 3,197 | 7,530 | 3,249 |
| Flight → map | 156 | 105 | 144 | 94 |
| Quickload | 6,519 | 2,763 | 6,441 | 2,741 |
| Revert to launch | 6,613 | 2,925 | 6,399 | 2,722 |
| Flight → tracking station | 612 | 312 | 521 | 332 |

Menu readiness is the visible action plus two animation frames. Scene route probes exclude
human dialog time; tracking uses the save/store route because flight has no direct tracking
button. Launch/restore waits for a new controller, surface readiness, shader warm-up and
loading overlay opacity zero, excluding its 550 ms DOM-removal fade. Map waits two frames.
Raw predicates and complete long-task counts are in `scripts/bench/cpu-transitions.mjs`.
The menu warm target and cold transition target were met in this sample; warm launch still
misses 3 seconds by 249 ms. Loading is not hitch-free: the largest warm editor task fell
from **4,219 to 356 ms**, and warm launch still has a 170 ms task.

The editor V8 profile attributed approximately 4.3 seconds to eagerly preparing the entire
thumbnail catalogue (including roughly 3.5 seconds of geometry/AO work). Preparation now
builds one part per scheduled frame and pauses when the palette unmounts. The full catalogue
no longer blocks entry or competes with launch. Other changes:

- Overlap application loading, immutable Earth fetch and texture-cache decode; preserve the
  Earth initialization barrier before scene creation.
- Skip construction of hidden launch scenery in distant/Earth-orbit and lunar scenes; freeze
  immutable local matrices and avoid a duplicate site subtree update.
- Slice map shader warm-up, as already done for flight. Require baked surface/terrain for
  readiness while cosmetic scatter streams afterward; screenshot `idle` still waits for it.
- Cache immutable surface-bake pixels in the shared worker pool with a **16 MiB LRU limit**
  and in-flight deduplication. Keep GPU textures scene-owned and disposable. Oversized bakes
  bypass retention. Warm quickload/revert no longer repeat the identical worker bake.
- Reuse exact integer-Kelvin radiance calculations and skip empty vessel-link indexing.

### Steady flight pacing

Trace-free paired 10-second captures (`perfcpu-pacing-{before,after}-dpr2.json`). CPU is the
instrumented flight-loop average over its rolling sample, including render submission;
frame percentiles are rAF intervals, not JS execution time. After captures predate only the
surface-bake cache, which cannot hit in these fresh-context steady-flight cases.

| Scene | CPU ms before → after | Frame p50/p95/p99 ms before → after | Long tasks before → after |
|---|---:|---|---:|
| Pad | 7.17 → 6.20 | 33.3/50/50 → 33.3/33.4/50 | 2 → 0 |
| Ascent, physics 4× | 8.33 → 8.72 | 33.3/50/50.1 → 33.3/50/50.1 | 1 → 0 |
| Orbit | 3.11 → 3.15 | 16.7/33.4/33.4 → 16.7/33.4/33.4 | 0 → 0 |
| Rails warp 100,000× | 2.24 → 2.08 | 16.7/16.8/16.8 → 16.7/16.8/16.8 | 0 → 0 |
| Map | 1.59 → 1.59 | 16.7/16.7/16.8 → 16.7/16.8/16.8 | 0 → 0 |
| Moon terminal descent | 3.50 → 3.59 | 16.7/16.8/33.3 → 16.7/16.7/16.8 | 0 → 0 |

There is **no demonstrated broad steady-flight CPU speedup**: most differences are noise.
The primary win is removing large loading stalls. Ten seconds without long tasks does not
prove hitch-free gameplay. The Moon case is terminal descent, not an Earth→Moon transfer
or a complete SOI-crossing test. Inbound lazy site creation remains synchronous. First-use
part geometry/shader compilation and scene constructors can still exceed 50 ms.

### Reproduction and evidence

From the assigned worktree, serve `npx vite build && npx vite preview --port 5334 --strictPort --host`.
The wrappers below acquire the shared GPU lock internally (do not nest a second lock):

```sh
bash scripts/bench/cpu-transitions.sh http://<WSL-IP>:5334 my-transitions 1
bash scripts/bench/cpu-flight.sh --base http://<WSL-IP>:5334 --label my-pacing --throttle 1 --trace 0 --cases pad,ascent,orbit,warp100k,map,moon --seconds 10 --settle 5000
bash scripts/bench/cpu-flight.sh --base http://<WSL-IP>:5334 --label my-journey --throttle 1 --cases journey --seconds 120 --settle 3000
bash scripts/bench/cpu-flight.sh --base http://<WSL-IP>:5334 --label my-moon --throttle 1 --cases moon --seconds 10 --settle 5000
node scripts/bench/cpu-trace-report.mjs docs/performance/perfcpu/my-moon-moon.trace.json.gz
node scripts/bench/gpu-bench.mjs --local 1 --cpu-only 1 --base http://localhost:5334 --label my-cpu --throttle 4 --cases pad,ascent,orbit,warp100k,map,moon --seconds 10 --settle 5000 --save-traces 1 --size 1470x920 --dpr 2
```

`journey` flies a stock Meridian with orbit assist at physics 4×, autosaves every 15 seconds,
and opens/closes map during ascent. Trace exports retain only the benchmark renderer and
its workers. Long traces are streamed to avoid V8's whole-string limit. Trace-enabled rAF
samples include transfer/readout time and thus exceed the nominal recording period; use
`--trace 0` for comparable pacing windows. Initial journey export attempts failed (errors
retained in JSON); their interval summaries are diagnostic, not paired 120-second traces.
The editor CPU profile, transition JSON, pacing JSON and compressed Chrome traces are under
`docs/performance/perfcpu/`. Unzip `.trace.json.gz` before importing into Chrome Performance.

Local 4× diagnostic CPU milliseconds (draw calls disabled, not rendered performance):

| Scene | Before | After |
|---|---:|---:|
| Pad | 55.73 | 25.13 |
| Ascent | 69.51 | 40.34 |
| Orbit | 30.71 | 22.39 |
| Warp 100,000× | 22.15 | 13.68 |
| Map | 22.39 | 9.86 |
| Moon descent | 25.83 | 28.23 |

These highly amplified software-driver numbers vary substantially with host scheduling.
They do not support a claim of a corresponding hardware speedup. The after ascent still
recorded 63 long tasks over 12.55 seconds, and its maximum traced GC pause was 22.35 ms.
The requested ≤4 ms at 4× is not demonstrated. Raw diagnostic rAF/GC data is retained for
repeatability, but the hardware trace-free table is the flight pacing comparison.

Final hardware trace evidence (`perfcpu-journey-traced-*`, `perfcpu-moon-traced-*`): the
scripted ascent completed orbit assist at **81.32 × 85.07 km**. Its recorded trace contains
**two** main-thread tasks >50 ms (75.27 and 74.15 ms). The first is dominated by native
waiting around a Mojo reply, with essentially no nested JS; the second includes 43.60 ms
of animation-frame work and 29.14 ms of compositor `Commit`. Trace main-thread occupancy
is 78.09% Commit waiting and 21.78% other work; those inclusive event timings are not CPU
utilization. Largest traced GC pause: **5.73 ms**. Moon descent has **zero** >50 ms tasks,
with largest GC pause **2.82 ms**. The baseline short Moon trace has one 50.4 ms native-wait
task; baseline short pad/ascent/orbit/map/high-warp traces have none. `trace-reports.json`
contains task attribution without double-counting nested Chrome task wrappers.

The earlier baseline journey observed 8 long tasks in 199.14 seconds, with frame
p50/p95/p99 33.2/33.4/50 ms; the final journey observed 2 in 217.59 seconds, with
16.7/33.4/33.4 ms. These differently extended readout windows are **not a controlled
before/after comparison**. The baseline journey raw export failed; the shorter baseline
ascent/Moon traces and successful final full ascent are retained. No claim is made that
SOI transitions, every staging combination, or all allocation/GC hitches are solved.

Validation after merging `main` (still `7bd6e4f9`): `npm run lint`, `npx tsc --noEmit`,
`npx vitest run --maxWorkers=2` (**112 files / 1,334 tests**, 216.99 s), and `npm run build`
all pass. All ten `scripts/bench/determinism.ts` hashes are byte-identical before/after
(`determinism-{before,after}.txt`). No `src/sim` changes. The build retains its existing
large-chunk warning. Port 5334 preview was stopped after measurements; no server remains.
## UI responsiveness — 2026-10-07 (`cx/perfui`)

Baseline application source: `7bd6e4f9`. Only `wsp-wt/perfui` was changed. Production Vite bundles,
local WSL Playwright Chromium, 4× CDP CPU throttle, 1470×920 CSS / DPR 2, Low graphics. Chromium uses
**SwiftShader**, so full-scene timings include a substantial software GPU bottleneck and do not estimate
Apple/ProMotion performance. Eight repetitions per interaction. No timing assertions were added to CI.

The probe records capture-event → second rAF, an upper bound on the next paint opportunity; final probes
also record event timestamp → second rAF, including input queue delay. These are INP-style observations,
not official INP, actual presentation timestamps, or completion times for deferred search results.
Raw samples, frame gaps, failures and methodology: [UI evidence](performance/ui/README.md).

| Catalogue interaction | Before capture p75 ms | After capture p75 ms | After timestamp p75 ms |
|---|---:|---:|---:|
| Search text feedback | 1543.4 | 35.3 | 36.3 |
| Card hover / tooltip | 1334.1 | 42.1 | 55.6 |
| List scroll | 397.7 | 56.9 | 63.4 |
| Symmetry key | 1296.7 | 83.6 | 99.0 |
| Pick / cancel | 4600.4 | 74.2 | 84.5 |
| Held-pointer entry (few discrete events, not drag FPS) | 2263.5 | 107.8 | 112.8 |

[Before](performance/ui/before.json), [after final palette](performance/ui/final-v2.json).
The latter includes the shared IntersectionObserver, deferred result filtering and scene invalidation fix;
it precedes the last refinement that waits 350 ms after input before submitting a thumbnail draw.
Earlier intermediate captures remain under explicit `after` / `final` names; they are not substituted for
this table. Initial thumbnail work overlaps the interaction sequence intentionally.

| Thumbnail result, measured after editor hook exists | Before | After final palette |
|---|---:|---:|
| Cold first 18 images | 25,630 ms | 14,274 ms |
| Warm first 18 images, same-context page reload | 15,122 ms | 225 ms |
| Images generated by end of interaction sequence | 168 / 168 | 31 / 168 |

Warm reload retains IndexedDB but resets module caches. The after count is deliberate viewport/scroll-margin
loading, not missing images: invisible catalogue entries are requested as they approach the viewport.
The timing excludes scene construction and eager baseline mesh generation before the editor hook exists.
Cold image generation still takes seconds on this software renderer; a cold-start laptop speed claim is not made.

The 100-part fixture extends Selene with 72 surface-attached Thimble tanks. It checks actual stack snapping,
100 → 101 parts on attachment, and exact restoration to 100 on undo. The baseline detail run completed
large-craft/flight samples, then failed at an ambiguous Settings locator; its completed samples remain in
[baseline detail diagnostics](performance/ui/before-detail-failed.json). The locator was corrected.

| Large-craft / flight evidence | Before | After | Scope |
|---|---:|---:|---|
| 100-part symmetry capture p75 | 6794.1 ms | 107.3 ms | Complete software-rendered scenes, intermediate after |
| 100-part undo/redo capture p75 | 1930.7 ms | 165.3 ms | Complete software-rendered scenes, intermediate after |
| 100-part attach handler | 933.5 ms | 34.1 ms | Direct handler CPU time; final exact soot is deferred |
| Continuous held motion | 0.99 fps | 1.05 fps | Complete software-rendered scene; GPU bottleneck persists |
| Corrected held motion | — | 59.28 fps | Final **CPU isolation**, scene GPU drawing suppressed |
| Final 100-part undo/redo | — | 74.4 ms | Timestamp-to-paint p75, CPU isolation |
| Final resources panel toggle | — | 85.4 ms | Timestamp-to-paint p75, CPU isolation |
| Final settings open/close | — | 73.0 ms | Timestamp-to-paint p75, CPU isolation |

Full-scene [intermediate after](performance/ui/after-detail.json) and
[final CPU isolation](performance/ui/final-cpu-fixed.json) must not be treated as the same workload.
Isolation replaces only editor scene draws and flight pipeline submission with no-ops; controls, picking,
placement, React, physics and panel updates remain live. It is a diagnostic for the assigned UI/CPU work,
not a promised in-game FPS result. The 14-second drag stall in the first isolated run came from
`Object3D.clone()` JSON-serializing `userData.baseMat`, including texture canvases, when creating symmetry
ghosts. Materials now live in weak maps, with lamp/tint behavior preserved. The regression test throws if
cloning tries to serialize a material. A separate test verifies identical batched/synchronous soot colors,
unchanged templates and correct results when the hall recenters between batches.

**React:** production profiling builds record `Profiler.actualDuration`, render work associated with a
commit, not DOM commit duration. Eight-second settled flight captures observed maxima **8.3 ms before**,
**4.2 ms in the full-scene after**, and **7.6 / 10.1 ms** in two isolated after runs. Most work is well below
these maxima. The strict “no commit over 8 ms” target is therefore **not consistently established**.
Flight already publishes telemetry at 10 Hz, shares unchanged fields and memoizes staging; navball rendering
runs independently. We did not replace this with a new 60 Hz React subscription.

**Retained fixes:** visible-only, one-at-a-time idle thumbnails; async shader preparation / PNG encoding;
optional persistent PNG cache keyed by the hashed production thumbnail chunk; per-card subscriptions,
shared viewport observer, CSS containment and deferred search results; cached reference Earth and exact
unchanged-craft readouts; cached attach nodes; unchanged tint traversal avoidance; visual-only scene
invalidation and retained shadows for resource/staging changes; exact soot applied in cancellable idle
batches; preflight fuel/Mach advisories in a worker with stale-result rejection and an idle fallback;
nearly opaque panel gradients without live-canvas backdrop blur; ref/rAF panel dragging with one storage
write on release, stable pointer capture and correct combined UI/HUD scale.

The only shared-render changes are additive batched-soot support and weak-map lamp/tint bookkeeping.
Flight soot still runs synchronously through the same math. No sim physics, shader shading, art values,
resource quantization or stage/undo semantics changed. Preview caches are bounded or limited to the catalogue;
renderer cleanup follows the project's shared-resource disposal helper. Storage failures fall back to generation.

### Reproduction

```sh
npx vite build
npx vite preview --port 5336 --strictPort --host
# In another terminal in this same worktree:
node scripts/bench/ui-bench.mjs after
WSP_PROFILE=1 npx vite build
node scripts/bench/ui-bench.mjs after-detail http://localhost:5336 detail
node scripts/bench/ui-bench.mjs after-cpu http://localhost:5336 cpu
# Read-only baseline overlay, with identical profiling instrumentation:
WSP_UI_BASELINE=7bd6e4f9 WSP_PROFILE=1 npx vite build
node scripts/bench/ui-bench.mjs before-detail http://localhost:5336 detail
# Restore ordinary production when done:
npm run build
```

`WSP_UI_BASELINE` overlays the ten original UI files from git without changing the checkout. Current shared
soot/lamp helpers remain; synchronous soot math is unchanged. `scripts/bench/ui-paired.sh` runs the same
catalogue/detail probes with Windows Node and Chrome CDP 9333; invoke it through
`flock -w 60 /tmp/wsp-gpu.lock bash scripts/bench/ui-paired.sh` while the production preview is running.
The attempted hardware run stopped before scene entry because its renderer did not respond to CDP
navigation/evaluation. Only the probe-owned tab was closed, and the lock was released; no hardware result
is claimed. The runner does not modify the shared Windows driver directory.

**Limits:** not every target is met. Full flight/100-part GPU FPS is unverified on Apple hardware and remains
poor under SwiftShader. Cold thumbnail/scene work still produces long tasks. Timestamp-inclusive symmetry
in the isolated cold sequence reached 307 ms despite 70 ms after capture. Menu hover varied from 29 to
328 ms across cold backdrop runs. Maneuver-node dragging, Tracking Station label updates and actual 120 Hz
ProMotion presentation were not separately benchmarked. These results support the scoped fixes and retain
unfavorable samples rather than claiming universal sub-100 ms interaction or 60/120 fps.


**Final validation:** lint (including architecture layering), `npx tsc --noEmit`, ordinary `npm run build`,
and the full `npx vitest run --maxWorkers=2` suite pass: 113 files / 1,332 tests. The final
`git merge main` was already up to date; the complete test suite passed again afterward.
# GPU frame cost for Retina Macs — 2026-10-07 (`op/perfgpu`)

Goal (owner): the game feels slow on an Apple M-series MacBook (Retina, DPR 2, 120 Hz). An M1/M2 base GPU has
roughly 1/4–1/6 of an RTX 3060 Ti's throughput, so the target was Medium at DPR 2 ≤ ~2.5 ms GPU on the 3060 Ti in
the common scenes, without visible quality loss at normal viewing.

## Method

Windows Chrome over CDP (RTX 3060 Ti, ANGLE/D3D11), production builds (`vite build` + `vite preview`), 1470×920 CSS px
at DPR 2 (2940×1840 device pixels), adaptive resolution off, every run in its own browser context, shared harness
serialised with `flock /tmp/wsp-gpu.lock`. New driver `scripts/bench/gpu-passes.mjs` (`gpu-passes.sh`):

- **fenced GPU ms** — one `EXT_disjoint_timer_query_webgl2` elapsed query around 20 back-to-back renders of the
  settled scene, median of 5 batches. This is pure GPU time (no vsync, compositor or CPU submission), the number
  that scales to a weaker GPU. The pipeline's own timer is parked while measuring (queries cannot nest).
- **per-pass GPU ms** — elapsed queries around every composer pass in the running game loop (scene incl. shadow
  map, bloom, tone map, SMAA, upscale).
- **families** (`--families 1`) — fenced cost difference with one material family hidden (terrain, sky, clouds,
  vegetation, site, parts …); `scripts/bench/perfgpu/toggles.js` does the same per object group, `tris.js` is a
  frustum-culled triangle census, `upscale-cost.js` isolates the upscaler.
- **paired A/B** — `scripts/bench/gpu-passes-ab.sh` alternates baseline and candidate per case and repetition (each
  pair holds the GPU lock), `gpu-passes-report.mjs` writes medians to `docs/performance/perfgpu/ab-<preset>.md`.

The GPU was shared with other agents' game tabs throughout; absolute numbers move ±15 % between runs, so claims
use the paired medians. "loop fps" on this desktop is dominated by DPR-2 emulation/compositing and contention and
is not a laptop prediction.

## What was hot (baseline `7bd6e4f9`, Medium, DPR 2, fenced GPU ms; families from one profiling run)

| Scene | Frame | Scene pass | Post chain (bloom / tone map / SMAA) | Biggest families (ms, hidden-family differences) |
|---|---:|---:|---|---|
| Pad | 4.58 | 4.11 | 0.34 / 0.13 / 0.58 | PBR site + vegetation + parts 1.57, sky 0.78, terrain 0.72, empty-scene post 0.83, clouds 0.26, shadow map 0.21 |
| Ascent | 3.55 | 3.22 | 0.34 / 0.12 / 0.53 | sky 1.13, clouds 0.47, terrain 0.52, glare 0.43, particles/other 0.50, plumes 0.28 |
| Orbit (Earth in view) | 3.92 | 3.90 | 0.33 / 0.12 / 0.54 | ocean 0.69, terrain 0.61, clouds 0.60, sky 0.47 |
| Moon surface (descent) | 1.72 | 1.41 | ≈1.0 total | geometry/draw bound (563 draws), regolith detail |
| Map | 0.48 | — | — | 32 draws |
| Editor (73 parts, orbiting) | 1.30 | — | — | separate renderer, native MSAA |

1. **Resolution.** Every Medium pixel cost was paid at 2940×1840. Scene and post scale with pixels.
2. **Launch-site vegetation geometry.** The pad drew 3.48 M triangles: pines 0.92 M and scrub 0.51 M, all of
   them also in the shadow map. Each 1.4 km cell drew every instance with the detailed model and only *discarded*
   the far ones per fragment, so ~1,500 detailed pines (728 triangles each) and ~2,100 scrubs were vertex-shaded
   twice to cover a few pixels. This is why halving the pixels first cut the pad's scene pass by only ~20 %.
3. **Post chain bandwidth.** The composer ping-pong buffers were half-float (and MSAA on High) after tone mapping,
   SMAA's edge/weight targets half-float, and bloom ended with a full-resolution read-modify-write of the HDR target.
4. **Sun glare** — a full-screen additive pass with `atan`, two `cos` and `pow(x, 60/120)` per pixel.
5. Not mine to change now: sky shell, clouds, ocean and terrain shading (`op/earthgfx` replaces them). The sky is
   transparent but log-depth `gl_FragDepth` writes defeat early-Z, so covered sky pixels still march (see "Limits").

## Changes

| Change | Where | Effect |
|---|---|---|
| Retina internal resolution + edge-adaptive upscale + contrast-limited sharpen (one full-screen pass; flat footprints take a bilinear early-out) | `render/core/UpscalePass.ts`, `renderer.ts` (`resolutionPlan`), `quality.ts`, `ui/AdvancedGraphics.tsx` | Medium 70 %, High 85 %, Ultra native; Low keeps its old canvas stretch by default (opt-in). Terrain LOD keeps device resolution. Advanced: Native / Quality 85 % / Balanced 70 % / Performance 58 % |
| Adaptive resolution lowers the internal resolution under the same upscaler (canvas stays native); mid-tier GPUs (Apple base M-series, "Apple GPU") start at the Retina scale instead of a further ×0.75 | `renderer.ts` | adaptive steps are much less visible |
| Vegetation per-instance LOD bands (CPU partition on ≥ 20 m camera moves) + mid level (no limbs, 20-face sphere-shaded crowns) | `site/LaunchSite.ts`, `planet/scatter/geometry.ts` | pad 3.48 M → 2.29 M triangles |
| HDR scene target owned by the pipeline; 8-bit ping-pong/SMAA targets; bloom blend fused into tone mapping | `renderer.ts`, `fusedBloom.ts` | bloom 0.19 → 0.145, tone map 0.066 → 0.04, SMAA 0.30 → 0.27 ms (internal res) |
| Sun glare rays via triple-angle identities and repeated squaring (max abs diff 5e-6) | `sky/SunGlare.ts` | cheaper full-screen pass |
| Photo captures render at full device resolution; F8 report shows the true 3D scale and "upscaled" | `renderer.ts`, `hud/PerfOverlay.tsx` | — |

## Before / after (paired A/B, DPR 2, adaptive off)

Baseline `7bd6e4f9` (main) vs this branch at `03a5fa0e` (the later commits change no rendering except Low's
default, see below). Medians of interleaved runs; Medium 3 pairs, Low/High 2 pairs per scene. Full tables with loop
GPU, fps, per-pass and triangle columns: [Medium](performance/perfgpu/ab-medium.md),
[Low](performance/perfgpu/ab-low.md), [High](performance/perfgpu/ab-high.md).

**Fenced GPU ms per frame (RTX 3060 Ti):**

| Scene | Medium | High | Low |
|---|---:|---:|---:|
| Pad | 4.51 → **2.77** (−39 %) | 11.86 → 8.65 (−27 %) | 0.6 → 0.6–0.9 ¹ |
| Ascent (max-Q, 4× physics warp) | 3.56 → **2.03** (−43 %) | 7.73 → 5.20 (−33 %) | ≈ ¹ |
| Orbit, Earth in view | 3.92 → **2.26** (−42 %) | 8.09 → 5.60 (−31 %) | 0.92 → 0.84 |
| Moon surface (terminal descent) | 1.72 → **1.57** (−8 %) | 4.98 → 4.17 (−16 %) | 0.75 → 0.73 |
| Map | 0.40 → 0.39 (unchanged, draws direct at 2×) | 0.45 → 0.47 | 0.41 → 0.40 |
| Editor, 73 parts, orbiting | 1.30 → 1.23 (unchanged renderer) | 1.89 → 2.10 (noise) | 1.28 → 1.51 (noise) |

Per pass, Medium pad: scene 4.13 → 2.80 ms, post chain 1.05 → 0.79 ms (incl. 0.33 ms upscale); triangles
3.48 M → 2.29 M. The smoothed in-loop GPU timer (the number the F8 overlay shows) moved 5.50 → 3.77 (pad),
4.35 → 3.12 (ascent), 4.63 → 2.85 (orbit). The Moon gains least: its scene is geometry/draw bound and its lunar
regolith is high-frequency everywhere, so the upscaler takes its full path (0.47 ms).

¹ Low frames are below 1 ms and run-to-run noise (0.5–1.3 ms) dominates. The measured build upscaled Low too
(+0.05–0.09 ms, 10–15 % of a Low frame); the final build keeps Low's old canvas stretch by default, so Low gets only
the vegetation saving (pad 546 k → 360 k triangles).

**Visual check** (left before, right after; device resolution, normal viewing size and 1:1 crops):
[pad](screenshots/perfgpu/pad-before-after.jpg) ([1:1](screenshots/perfgpu/pad-crop-1to1.jpg)),
[ascent](screenshots/perfgpu/ascent-before-after.jpg) ([1:1](screenshots/perfgpu/ascent-crop-1to1.jpg)),
[orbit](screenshots/perfgpu/orbit-before-after.jpg) ([1:1](screenshots/perfgpu/orbit-crop-1to1.jpg)),
[Moon](screenshots/perfgpu/moon-before-after.jpg) ([1:1](screenshots/perfgpu/moon-crop-1to1.jpg)),
[map](screenshots/perfgpu/map-before-after.jpg), [editor](screenshots/perfgpu/editor-before-after.jpg).
At normal size they are indistinguishable; at 1:1 the finest decal text and lunar regolith grain are slightly
softer. Sky, cloud, coastline and vessel differences are timing (different moment of the flight), not rendering.
Functional checks: live switching of every Retina level, map toggle, photo capture (now full device resolution),
Space Center, Tracking Station and menu — WebGL error 0, no console errors.

## Estimated Mac frame rate

Taking the brief's ratio (M1/M2 base ≈ 1/4–1/6 of the 3060 Ti) on the fenced GPU time, Medium at Retina:

| Scene | Before (GPU ms → fps cap) | After |
|---|---|---|
| Pad | 18–27 ms → 37–55 fps | 11–17 ms → ~60 fps (adaptive trims the rest) |
| Ascent | 14–21 ms → 47–70 fps | 8–12 ms → 80–120 fps |
| Orbit | 16–24 ms → 42–64 fps | 9–14 ms → 70–110 fps |
| Moon surface | 7–10 ms | 6–9 ms → 110–120+ fps |
| Map / editor | 2–8 ms | unchanged (already ≥ 120 / ~60–120 fps) |

These are GPU-only estimates; the Mac's compositor, CPU frame (~3–4 ms here) and browser scheduling add to them,
and adaptive resolution is on by default (it targets 60 fps on unlimited/120 Hz caps). A real Mac profile (F8 →
Copy report) is the next confirmation.

## Limits / next

- **Earth sky, clouds, ocean and terrain shaders** are untouched (owned by `op/earthgfx`, about to change). On the
  pad they are now the largest items (terrain 0.6, sky 0.3, ocean 0.2 ms at internal resolution).
- **Log depth defeats early-Z / Apple hidden-surface removal** for every opaque and transparent fragment (all
  shaders write `gl_FragDepth`). Reversed float depth would restore it; the prototype needs float depth attachments,
  map/hub/canvas depth handling, custom depth writers and shadow sampling changes and `EXT_clip_control`. It gained
  ~5 % on the pad here (more expected on Apple TBDR), not shipped.
- The upscaler costs 0.2–0.5 ms here (≈ 1–2 ms on a base M1) on textured scenes; mediump math is used so Apple's
  fp16 ALUs run it at double rate. Luma-only sharpening and an isotropic shortcut showed no measurable gain within
  the harness noise.
- No Apple hardware was available; all numbers are RTX 3060 Ti with DPR-2 emulation under shared-GPU contention.

Reproduce: `npx vite build && npx vite preview --port 5332 --strictPort --host`, baseline build on 5331, then
`scripts/bench/gpu-passes-ab.sh medium http://<ip>:5331 http://<ip>:5332 "pad,ascent,orbit,map,moon,editor" 3 --quality medium`.

# GPU pass 2 (2026-10-07–08, cx/perfgpu2)

This pass follows the merged Earth imagery/lighting work. It reduces draw submission and redundant atmospheric work without changing preset resolution, imagery packs, terrain LOD, shadow settings or cloud octaves. The strict **Medium ≤2.5 ms target is narrowly missed on the pad**: 2.795→2.512 ms (−10.1%), with candidate samples 2.476/2.512/2.521 ms. The other four measured scenes meet the target. Low remains inexpensive; High and Ultra improve in the GPU-heavy scenes. This is evidence from five specific scenes, not a bound on every camera/weather/time-of-day combination.

## Production measurements

Main is pinned at `49e6b30ed46444906fd98d63fe8cc205d50cd9fd`; the candidate contains the implementation through `3fabddca`. Windows Chrome / RTX 3060 Ti, CDP 9333, 1470×920 CSS and DPR 2. Medium/High/Ultra output 2940×1840; their internal render ratios remain 1.4/1.7/2.0. Low retains its 735×460 flight canvas and browser stretch. Map uses its separate native-resolution path. Adaptive quality is disabled; Medium/High use the ready 8k Earth pack, and Ultra uses the available 8k fallback.

Each cell below is the median of **three interleaved A→B pairs**, holding `flock /tmp/wsp-gpu.lock` across each pair. Flight is paused and imagery is ready. Low/Medium/High terrain is idle; Ultra has the streaming limitation below. Each fenced sample is a timer-query median of five 20-render batches with readback fences. Draw-submission gaps inside a batch are included; this is not pure fragment-shader ALU cost. Loop fps/pass timers are separate, noisy diagnostics rather than a 120 Hz or Apple result. All 120 final runs have no console errors, GL error 0 and paused simulation. Terrain is idle in 102 runs. Ultra pad/orbit/map have four in-flight builds on both sides in all three repetitions, despite stable selected geometry and matching rendered triangle counts. These Ultra cells describe a streaming scene, not a fully idle workload; ascent has a small geometry variation (10,642,085→10,612,133 median triangles). No samples are dropped.

| Scene | Low ms | Medium ms | High ms | Ultra ms |
|---|---:|---:|---:|---:|
| Pad | 0.578 → 0.560 | 2.795 → 2.512 | 7.065 → 6.306 | 14.170 → 13.072 |
| Ascent | 0.515 → 0.511 | 2.331 → 2.153 | 5.869 → 5.718 | 14.444 → 14.109 |
| Orbit | 0.509 → 0.499 | 2.381 → 2.037 | 5.319 → 4.982 | 10.184 → 9.764 |
| Map | 0.332 → 0.329 | 0.333 → 0.329 | 0.331 → 0.328 | 0.328 → 0.324 |
| Moon | 0.490 → 0.504 | 1.392 → 1.257 | 2.584 → 2.438 | 4.977 → 4.749 |

| Scene | Medium paired Δ ms | Candidate range ms | Draw calls A → B | Triangles A → B |
|---|---:|---:|---:|---:|
| Pad | -0.274 | 2.476–2.521 | 708 → 238 | 2290653 → 2290653 |
| Ascent | -0.190 | 2.141–2.181 | 574 → 272 | 872646 → 872646 |
| Orbit | -0.347 | 2.034–2.051 | 442 → 183 | 743766 → 743766 |
| Map | -0.004 | 0.329–0.329 | 32 → 32 | 50056 → 50056 |
| Moon | -0.114 | 1.253–1.298 | 557 → 358 | 631561 → 631561 |

| Scene | Medium scene-pass ms A → B | Medium post-pass sum ms A → B |
|---|---:|---:|
| Pad | 2.526 → 2.806 | 0.788 → 0.790 |
| Ascent | 2.620 → 2.575 | 0.652 → 0.653 |
| Orbit | 2.837 → 2.073 | 0.668 → 0.667 |
| Map | — → — | — → — |
| Moon | 1.688 → 1.390 | 0.887 → 0.889 |

Low Moon has a small aggregate median increase (0.490→0.504 ms), while its median paired change is −0.007 ms; the mixed individual changes do not establish a consistent regression or win. Low remains near parity overall.

Scene/post timers above are taken in the running render loop; their medians need not sum to the fenced result. Post processing has not changed, so small differences are timing variation. The pad’s smoothed loop GPU timer is 3.401→3.584 ms despite the fenced improvement; that live-loop diagnostic does not establish a pacing win. Batch timing includes submission gaps, and the shared host/compositor/clock state also differs from the back-to-back render batches. Apple/live-frame validation remains necessary.

## Where the work was

The first production family profile found substantial terrain, launch-site/vessel PBR and vegetation work on the pad, plus redundant Earth sky integration behind opaque ground. A separate frozen profile showed ascent sky/cloud costs around 0.54/0.48 ms and orbit ocean/cloud around 0.62/0.33 ms. These family numbers are differences between whole-frame draws with a family hidden, not independent costs; negative deltas in the archived JSON are noise/interactions.

The later diagnostic profile, before the last cloud/phase changes, measured pad terrain/ocean/sky/clouds/vegetation/PBR deltas of 0.48/0.09/0.23/0.11/0.29/0.57 ms. Ascent sky was ~0.35 ms; orbit ocean/clouds ~0.48/0.51 ms; map was cheap (~0.33 ms); Moon terrain was ~0.38 ms. `gpu-profile.sh` and `earthgfx-flightfam.mjs` also identified render/draw submission on the pad, but their CPU/readback wall-time results are not fenced GPU figures. Raw profiles and paired reports are in [performance/perfgpu2/](performance/perfgpu2/README.md).

## Changes and isolated comparisons

| Experiment | Three-pair fenced median A → B ms | Median paired Δ ms | Disposition |
|---|---:|---:|---|
| Adaptive daylight aerial integration, pad | 3.068 → 2.808 | −0.260 | Keep; all three improve |
| Wider terrain/ocean/cloud math group, pad | 2.819 → 3.159 | −0.128 | Reject; aggregate median regresses, retain unfavorable sample |
| Conservative sky occlusion, pad | 2.712 → 2.572 | −0.104 | Keep; two wins, one unfavorable pair |
| Terrain/ocean batches, pad | 2.668 → 2.475 | −0.174 | Keep; all three improve |
| Terrain/ocean batches, orbit | 2.023 → 2.017 | −0.010 | Essentially parity |
| Terrain/ocean batches, Moon | 1.487 → 1.264 | −0.220 | Keep; all three improve |
| Shared terrain texture fetches, pad | 2.529 → 2.527 | −0.016 | Equivalent compiler hint; no robust RTX win claimed |
| Zero-coverage Medium cloud noise, pad | 2.530 → 2.493 | −0.045 | Keep; all three improve |
| Mie `pow(x,1.5)` → `x*sqrt(x)`, pad | 2.494 → 2.496 | +0.002 | Equivalent algebra; no RTX win claimed |

The incremental sky/batch tests share experimental shaders on both sides to isolate their changes. Those rejected shaders are removed from the final matrix. Early stationary pad runs were unpaused because the old wrapper split multiword `--pre` arguments; the wrapper now preserves arguments. Complete raw pairs, including unfavorable samples, are retained. The README identifies superseded partial matrices and recovered old reports.

- **Aerial integration:** Low/Medium use one or two segments for short, almost level daylight rays whose radial span (including chord sag) is small relative to the aerosol scale height. This is an approximation for varying density; constant-density exponential integration is exact. Sunset/night, long horizon rays, increased haze step multipliers and High/Ultra keep the original budget. Airless bodies return before ray math.
- **Sky overdraw:** discard only Earth rays certainly behind an inner sphere below the global terrain minimum, triangle sag and a precision margin. Compute the discriminant constant in CPU Float64. Limit the shortcut to cameras within two Earth radii to avoid distant Float32 discriminant errors; horizon pixels keep the original march.
- **Terrain/ocean draw submission:** reusable `BatchedMesh` slots preserve geometry, normalized attributes, per-object frustum culling and floating-origin transforms. GPU capacity follows peak selected chunks, with slot reuse across LOD replacements. Low and browsers without `WEBGL_multi_draw` keep ordinary meshes; hub/map/portraits retain their existing path. On the pad draw calls fall 708→238 at exactly 2,290,653 triangles.
- **Clouds/shader expressions:** Medium skips multiplicative detail noise on exactly zero baked coverage after derivative evaluation. Terrain colour/coverage and slope share matching texture reads while retaining cyclic accumulation order. The Mie algebra preserves the scattering model. No new half-precision planet arithmetic is shipped without Apple evidence.

## Visual comparison and verification

Main is on the left; candidate on the right. Normal comparisons show each frame at 1470 px wide (Retina viewing size); device-pixel crops are 1:1. No visible detail loss or missing ground/ocean/cloud geometry was found in these comparisons. Flight setup timing produces small altitude/camera, countdown and animated cloud/plume differences, so these are visual comparisons rather than identical-frame pixel proofs. The aerial approximation remains a model change, documented above.

| Medium scene | Normal comparison | Device-pixel crop |
|---|---|---|
| Pad | [before/after](screenshots/perfgpu2/pad-before-after.jpg) | [crop](screenshots/perfgpu2/pad-crop-1to1.jpg) |
| Ascent | [before/after](screenshots/perfgpu2/ascent-before-after.jpg) | [haze/coast crop](screenshots/perfgpu2/ascent-crop-1to1.jpg) |
| Orbit | [before/after](screenshots/perfgpu2/orbit-before-after.jpg) | [ocean/cloud crop](screenshots/perfgpu2/orbit-crop-1to1.jpg) |
| Map | [before/after](screenshots/perfgpu2/map-before-after.jpg) | [crop](screenshots/perfgpu2/map-crop-1to1.jpg) |
| Moon | [before/after](screenshots/perfgpu2/moon-before-after.jpg) | [terrain crop](screenshots/perfgpu2/moon-crop-1to1.jpg) |

Additional pad comparisons: [Low](screenshots/perfgpu2/low/pad-before-after.jpg), [High](screenshots/perfgpu2/high/pad-before-after.jpg), [Ultra](screenshots/perfgpu2/ultra/pad-before-after.jpg), with corresponding `pad-crop-1to1.jpg` files.

Final checks on the unchanged candidate source: `npm run lint`, `npx tsc --noEmit`, `npx vitest run --maxWorkers=3` (**128 files, 1,390 passed, one skipped**), and `npm run build` pass. Added tests exercise the geometric sky bound, Float64 rebasing before matrix upload, normalized attributes, batch growth and 500 LOD slot replacements. The production build retains the existing large-chunk warning.

## Remaining work

The pad needs at least another 0.012 ms median reduction to cross the strict target, and a larger reduction for useful headroom. Its remaining PBR/vegetation work and ~0.8 ms post chain are worth investigating next; the current sky bound is deliberately conservative. Reversed float depth remains an architectural follow-up, as recorded in the previous pass. Ultra’s continuing pad/orbit/map terrain builds deserve a separate cache/streaming investigation. Real Apple/Safari timing, multi-draw support/performance, and sustained 120 Hz behavior are unmeasured. Sunset/night, thick haze, distant views and other bodies retain safeguards but are outside this five-scene timing matrix. No claim of Mac frame rate is made from RTX scaling alone.
## CPU pass 2 (2026-10-07, cx/perfcpu2)

This pass removes specific main-thread work, but **does not meet the no-task-over-50-ms or
4-ms-at-4× flight targets**. Do not interpret the Windows results as an Apple M-series / 120 Hz
certification. The final fully textured High orbit comparison still spends about 27–29 ms/frame in the
flight profiler at 4× CPU throttle; renderer submission is the largest section.

### Method and artifacts

- Production baseline: `49e6b30e`. Initial implementation: `0e719a71` (its final comment/test-mock
  change has no runtime effect), on 5352. `cbf6d24b` adds the impact-query guard, on 5353;
  `b91881a1` adds the final bitmap-release follow-up, on 5354. Tables identify their revisions.
  Baseline served on 5350; all captures use immutable, sourcemapped production builds.
- Windows Chrome over CDP 9333, hardware RTX 3060 Ti, Ryzen 5600X; 1470×920 CSS, DPR 2. Medium
  unless marked High; adaptive quality disabled, audio muted, standard universe scale. These
  captures include real GPU submission. CDP CPU throttle is 4× unless explicitly labelled 1×.
- Results are single matched runs, not confidence intervals; cache/driver/native-wait variance remains.
  Every Chrome job holds `/tmp/wsp-gpu.lock`. `scripts/bench/cpu-pass2.sh` adds page-scoped sampled
  traces for cold/warm Space Center → editor → launch → map → save/restore and for ascent, warp,
  and an actual inbound Moon SOI crossing. The flight journey uses the same 4× **physics warp**
  as `cpu-flight.sh`; that setting is independent of CDP's 4× CPU throttle. Autosave is enabled
  every 15 seconds during the journey. Final orbit measurements return to 1× physics.
- Long-task columns use the browser PerformanceObserver, in milliseconds. They include ordinary
  flight frames during each window, not just the named action's synchronous handler. Window
  duration includes explicit settling waits and must not be called input latency. CPU columns
  use the app's frame profiler (the last 240 frames, not a whole-ascent average); loading windows
  that show zero are not valid steady CPU samples. Long tasks and rAF intervals cover the full window.
- Trace draining is outside each marked measurement window. Simulation/streaming can continue
  between windows, so imagery maxima are cumulative and streaming-wait durations exclude those
  gaps. `cpu-trace-report.mjs` reports outer trace tasks; `cpu-trace-samples.mjs` attributes V8
  samples to the matching build's source maps. Sampled inclusive durations are attribution aids,
  not precise function timings. It correlates profile IDs across sampling threads and caps
  individual sample weights to avoid assigning unsampled native waits to JavaScript.
- Raw JSON, selected compressed traces and imagery screenshots are in `docs/performance/perfcpu2/`;
  its README maps capture labels to revisions. Superseded diagnostics retain summaries only.
  Direct-to-editor/direct-flight 4× attempts stalled the renderer and are retained as failed
  captures. Going through Space Center completed; failures do not count as performance samples.
  `cpu2-after-*` is an intermediate, rejected streaming schedule that left imagery absent too
  long. `cpu2-final-transitions-4x` partly overlapped the first test run on the host and is
  diagnostic only; the later `cpu2-pair-*` transition runs are the comparison pair.

### Changes and attribution

- **Staging:** detached vessels adopt existing part visuals by `PartState` identity before the
  donor view rebuilds. This avoids re-creating thermal geometry/plumes and repeating a whole
  assembly soot bake for hardware that already exists. Existing soot remains after separation;
  new/moved layouts still bake. A disposal/identity regression test also supplies an unrelated
  identical craft, so local part UID collisions cannot transfer another craft's mesh.
- **Map entry/exit:** keep flight HDR/bloom/AA attachments resident while drawing the map directly
  to the canvas. Skip unchanged canvas sizing; resize flight attachments on return only when
  resolution changed. This trades retained GPU memory for avoiding repeated allocation.
- **Earth streaming:** decode and crop in a dedicated idle-terminated worker, transfer ImageBitmap
  strips, and yield between crops in the compatibility fallback. Before, `createImageBitmap`
  appeared as hundreds of milliseconds of main-thread sampling across the cold hub trace,
  despite returning promises. Uploads are now 1 MiB, merges 1 Mpx, at most four operations under
  a 0.75 ms soft budget. Driver allocations/mipmap generation are indivisible and can exceed it.
  The bundled surface has priority over clouds; existing surface imagery remains during upgrades.
- **Other texture/worker setup:** one-texel part placeholders replace eager full-size buffers;
  final worker pixels are adopted without a copy, preserving repeat-clone Sources. GPU storage
  is explicitly released before dimensions change. Terrain workers receive one immutable Blob
  and materialise Earth grid copies off the main thread, with an initialization barrier.
- **UI/shaders:** the empty inspector no longer schedules rAF or reads layout every frame.
  Production editor and thumbnail renderers omit synchronous shader info-log checks, matching
  flight; development retains diagnostics. Settings/Advanced Graphics display Low/Medium/High/
  Ultra, Off, FXAA, SMAA, MSAA + SMAA and Unlimited, without changing saved values. Chrome's
  captured option text verifies the labels.
- **HUD impact queries (final follow-up):** a safe orbit/flyby returns no impact, yet previously
  asked for a six-patch trajectory first. The Moon traces attributed 60–70 ms of repeated sampled
  main-thread work to that unused path. Move the trajectory query behind the existing impact
  possibility test; suborbital impacts still use the SOI-limited horizon. Tests cover a safe orbit,
  hyperbolic flyby, and a real terrain impact. Map prediction remains on demand; its incidental
  cache warming by the closed-map HUD is removed.
- **Still expensive:** cold site canvas textures/scene construction, first render texture
  allocation, three.js material/draw submission, and native GPU/IPC waits. The baseline cold hub
  samples attribute roughly 1.7 s inclusive to launch-site construction and 195 ms self to Earth
  worker registration. Editor scene creation/texture upload and thumbnail rendering remain
  substantial. HUD telemetry outside the unnecessary path query is smaller than rendering. The final continuous
  trace also isolates synchronous autosave persistence; see the remaining-work section below.

### Initial surface-ready High orbit comparison, production 4×

| Measurement | Before | After |
|---|---:|---:|
| Imagery cumulative main-thread step peak | 7.1 ms | 5.4 ms |
| Additional traced wait for 8k after load/trace drain | 2.77 s | 23.06 s |
| Following 8-second CPU average | 25.83 ms | 25.33 ms |
| Following 8-second long-task maximum | 86 ms | 80 ms |
| Following 8-second long-task count | 131 | 133 |

Both report 8k surface ready, GL error 0, and no page/console errors; the screenshot was inspected.
This first pair did not wait for the cloud source, so it is not a fully settled comparison.
The smaller steps spread streaming over more frames, a material trade-off on a throttled renderer.
The CPU result is essentially unchanged, not a claimed large frame-rate gain. Other transition
captures still show imagery step outliers above 50 ms; the soft budget is **not** a hard bound.

### Final fully loaded High imagery pair, production 4×

`cpu2-before-imagery-release-4x` → `cpu2-release-imagery-4x` compares `49e6b30e` with
`b91881a1` under one Chrome lock. This pair waits for both the 8k surface and cloud source,
then allows three seconds for baking before the eight-second steady window. Both runs have
GL error 0 and no page/console errors; the final screenshot has the expected surface/clouds.

| Measurement | Before | Final |
|---|---:|---:|
| Cumulative imagery step maximum | 8.8 ms | 57.5 ms |
| Traced streaming wait after load/drain | 3.27 s | 31.57 s |
| Streaming-window long-task maximum | 113 ms | 100 ms |
| Settled flight CPU average / p95 | 27.37 / 32.10 ms | 28.64 / 34.20 ms |
| Settled long-task maximum / count | 79 ms / 126 | 81 ms / 123 |

This is **not a steady CPU improvement**. A smaller upload budget cannot preempt native
allocation/mipmap calls, and the measured 57.5 ms cumulative outlier remains unresolved. It
was not located within the exported streaming window, so its exact native cause is not established.
An earlier fully loaded pair (`cpu2-before-imagery-complete-4x` → `cpu2-complete-imagery-4x`)
also recorded cumulative step outliers, 54.6 → 59.3 ms; the initial 7.1 → 5.4 ms result is not a
reliable worst-case bound. Full imagery arrives much later at 4× throttle. The unthrottled
trace-free result below demonstrates a smaller typical measured peak on this machine, not a
promise that streaming never hitches.

### Clean cold/warm transition pair, production 4×

These paired runs hold the Chrome lock across before and after. They compare `49e6b30e` with
`0e719a71`; the later safe-orbit HUD guard does not affect the pad sequence. Values are maximum
observed long tasks; no row is a claim that every task for that action improved.

| Window | Cold before → after (ms) | Warm before → after (ms) |
|---|---:|---:|
| Space Center first load | 2322 → 1518 | 523 → 522 |
| Editor entry | 1290 → 1333 | 1189 → 1215 |
| Launch | 690 → 714 | 643 → 611 |
| Map open | 87 → 79 | 85 → 65 |
| Map close | 99 → 86 | 100 → 85 |
| Quicksave window | 65 → 77 | 73 → 77 |
| Quickload | 619 → 525 | 528 → 524 |

Frame gaps tell the same mixed story: cold hub maximum rAF gap 3383 → 2150 ms, editor
1383 → 1433 ms, launch 1083 → 1167 ms, and quickload 967 → 867 ms. The complete window
rAF p95/p99/max and long-task counts are indexed in `perfcpu2/comparison.csv`.

Editor-entry maxima are essentially unchanged/slightly worse. Quicksave-window maxima are ordinary
render frames, not evidence that serialization itself takes 77 ms. Warm launch ready-window duration
was 10.07 → 8.29 s and quickload 8.72 → 7.29 s, but the after build still has no imagery level at that
instant versus before's 4k. **Do not call those readiness reductions equivalent-visual loading wins.**
By map open the after build has 4k; by map close the baseline has 8k while after still has 4k. Thus
map-window CPU averages also cannot establish settled-flight gains. The map sizing regression test
independently verifies that toggling does not reallocate flight attachments and that a real resize
while in map mode is applied when returning.

### Moon SOI query follow-up, production 4×

The matched Kestrel flyby fixture starts 20 km outside the Moon's SOI, moving inward at 1500 m/s
with 250 m/s transverse velocity. It crosses through `World.tick`, rather than assigning `body`
to Moon. Both runs finish with body `moon`, GL error 0 and no page/console errors.

| 25-second crossing window | Before (`cpu2-before-soi-4x`) | Final (`cpu2-complete-soi-4x`) |
|---|---:|---:|
| Maximum long task | 156 ms | 106 ms |
| Long-task count | 378 | 92 |
| Trailing flight CPU average | 19.60 ms | 12.82 ms |
| Trailing flight CPU p95 | 25.10 ms | 15.80 ms |
| Trailing telemetry section average | 2.67 ms | 1.46 ms |

Source-mapped samples establish removal of unnecessary repeated impact-path queries once the
Moon-frame orbit cannot intersect the surface. They do not establish that every millisecond of
the total average reduction is caused by that guard: render submission also varied between runs.
The remaining 102–106 ms tasks include required pre-crossing Earth impact queries and a later
`warpTargets` trajectory refresh. Those still spend about 46–50 ms sampled in prediction before
adding the rest of the frame/native overhead. Moving or incrementally evaluating those necessary
queries remains work for a subsequent pass.

An initially near-radial fixture exposed `True anomaly outside hyperbolic asymptotes`
through optional prediction and unmounted the flight scene. Its JSON/error trace is retained as a
failed diagnostic (`cpu2-before-journey-4x`); it is not treated as a normal SOI timing. The nonzero
impact-parameter fixture avoids that degeneracy. This pass does not repair that pre-existing
numerical edge case.

### Continuous ascent and complete flight, production 4× pair before bitmap cleanup

`cpu2-before-journey-continuous-4x` → `cpu2-complete-journey-4x` uses Meridian, orbit assist,
15-second autosave, and 4× physics warp for ascent. Each ascent is **one continuous trace**,
including liftoff and both automatic stage transitions; its total duration is 131.61 → 131.73 s.
Both finish the assist in an orbit with periapsis about 82.2 km. The orbit window returns to 1×
physics, then the fixture tests 100,000× rails warp, returning to physics, and Moon SOI entry.
All final windows report GL error 0, with no page/console errors.

| Window / identified event | Maximum long task before → `cbf6d24b` (ms) |
|---|---:|
| Pad, after loading | 105 → 84 |
| Liftoff / first accelerated physics frame | 173 → 189 |
| First stage separation | 208 → 122 |
| Following upper-stage activation | 86 → 76 |
| Whole ascent (all tasks, not just staging) | 208 → 189 |
| Orbit, 1× physics | 124 → 131 |
| Rails warp up | 131 → 125 |
| Return to physics | 85 → 65 |
| Moon crossing after high warp | 125 → 132 |

Stage events are located by the recorded stage-transition marks and the preceding main task,
not by choosing an arbitrary short interval. The baseline separation trace attributes about
99 ms inclusive to `VesselView.rebuild`, including 56 ms in `bakeEngineSoot`. Reusing the visuals
removes that repeat bake. The worst liftoff frame is mostly accelerated physics; it did not improve.
The complete ascent still has 2016 → 2000 observed long tasks. The trailing orbit CPU average is
19.87 → 19.00 ms (p95 23.40 → 22.00), well above the requested 4 ms. These results distinguish a
specific staging improvement from the unresolved recurring cost of flight.

The post-warp Moon case and the isolated Kestrel Moon case have different craft, epoch and paths.
Both are reported: the improved isolated query result must not conceal the 125 → 132 ms maximum
in the complete journey. Necessary path/warp-target prediction remains synchronous.

### Final bitmap-release follow-up, production 4×

The preceding ascent exposed a **152.7 ms** task with **80.0 ms sampled in ImageBitmap.close**:
smaller upload strips had multiplied the synchronous closes performed when releasing a level.
`b91881a1` transfers the final-owned bitmaps back to the decode worker for release, recreating
that worker if idle termination already occurred. The compatibility fallback closes one bitmap
per timer task. Ownership and fallback behavior have regression tests.

`cpu2-release-journey-4x` repeats the complete continuous journey after that fix. It reaches
orbit, completes both warp transitions and enters the Moon SOI with GL error 0 and no page/console
errors. Main-thread `close` samples across ascent fall from **193 samples / approximately
105 ms sampled self time to zero**; no repeated bitmap-close task appears in the final trace.
That removes the identified cleanup cause, not all other tasks occurring while imagery streams.

| Window / event | Baseline `49e6b30e` → final `b91881a1` maximum task (ms) |
|---|---:|
| Pad | 105 → 84 |
| Liftoff / first accelerated physics frame | 173 → 165 |
| First stage separation | 208 → 129 |
| Following upper-stage activation | 86 → 76 |
| Whole ascent | 208 → 165 |
| Orbit, 1× physics | 124 → 128 |
| Rails warp up | 131 → 145 |
| Return to physics | 85 → 77 |
| Moon crossing after high warp | 125 → 134 |

Ascent duration is 131.61 → 131.77 seconds, long-task count 2016 → 2005, and the orbit's trailing
CPU average 19.87 → 19.11 ms (p95 23.40 → 22.20). The final liftoff maximum contains about
80 ms sampled under `World.tick`; staging no longer contains the repeated soot bake. This is
still far from the requested steady flight budget. Final ascent rAF maximum is 183.4 ms.

The longest final autosave task is **136.9 ms**, with **68.4 ms sampled under
saveWorldToStorage** (about 48 ms under slot-index rewriting, including JSON/storage work).
Other periodic saves spend 56–64 ms in that path. The small pad quicksave window did not reveal
this accumulated multi-slot cost. Async serialization/storage with ordering and failure guarantees
remains necessary; no save format or persistence contract was changed in this pass.

### Unthrottled hardware corroboration (not the 4× target)

The trace-free `earthgfx-stalls.mjs` pair uses High/DPR 2 for 30 seconds after flight readiness.
Baseline → `cbf6d24b`: imagery step peak **4.7 → 2.2 ms**, post-ready long tasks **1 → 0**
(maximum 51 → 0 ms). Both finish at 8k. Ready time is 9.16 → 8.85 s; rAF maxima are 50.1 ms
in both. `earth-stalls-1x-pair.jsonl` preserves both complete outputs. The probe now uses an isolated
context, blocks service workers, sets options before navigation, and closes the context on failure;
the old shared-context/favicon setup raced navigation and its failure log is retained.

The existing `cpu-flight.sh` 120-second journey pair also reaches orbit in both builds:

| 1× CDP CPU, 4× physics journey | Before | `cbf6d24b` |
|---|---:|---:|
| Observed long tasks | 14 | 2 |
| Maximum long task | 62 ms | 55 ms |
| Trailing flight CPU average / p95 | 4.69 / 6.40 ms | 3.16 / 4.10 ms |
| rAF p99 / maximum | 33.5 / 100.0 ms | 33.4 / 66.7 ms |

That older driver's rAF/PerformanceObserver readout includes trace draining: reported intervals
are 213.33 and 188.04 seconds, while each raw trace covers the requested 120-second flight window.
Do not treat the raw counts or FPS as equal-duration trace-free results. The two after trace tasks
are **55.072 ms (40.431 ms Commit wait + 14.034 ms animation callback)** and **52.256 ms
(33.946 ms Commit wait + 17.814 ms animation callback)**. They are largely compositor waiting,
not a claim of two 55 ms JavaScript computations. GPU/shader integration and Apple validation remain
necessary; these tasks were not eliminated by this CPU pass.

### Remaining work and verification

- The final High load trace still has a **1625 ms** editor mount task (649 ms sampled in
  `texSubImage2D`), an **869 ms** craft-load task dominated by part AO, and an **795 ms** first
  flight-frame task with launch-site/planet construction. These are loading costs, not steady CPU.
- First trusted input still initializes audio synchronously even at master volume zero:
  **233 ms** in that load capture, with about 184 ms sampled under audio initialization. The
  navball's first render also contributes to a **147 ms** HUD task (about 71 ms sampled under
  navball update, including texture upload). Neither path is rewritten here.
- Normal 4× flight has many frames over 50 ms: render submission/native waiting and accelerated
  physics need larger structural changes. The staging visual fix is not a general frame-budget fix.
- Periodic autosaves still parse/stringify the full slot collection and synchronously write
  localStorage. Their final trace attribution is 56–68 ms under persistence; this is a real CPU
  hitch, separate from compositor waiting. Save ordering/durability must survive a future async path.
- Required impact and warp-target predictions still run synchronously. Near-radial optional
  prediction can throw; the separate numerical fix is unfinished.
- Native texture allocation/mipmap operations remain indivisible, and imagery streaming takes
  longer at 4×. Worker strip disposal addresses one measured release hitch, not all GL stalls.
- Integrate the parallel GPU work, then repeat on the owner's Apple M-series machine at 120 Hz.
  Windows compositor waits and CPU-throttle results cannot certify Mac smoothness.

Final runtime revision `b91881a1` passes `npm run lint`, `npx tsc --noEmit`,
`npx vitest run --maxWorkers=3` (**131 files; 1397 passed, 1 skipped**), and `npm run build`.
The trace-stream parser's Node tests also pass (2). New tests exercise detached-visual ownership,
map target sizing, shared part-texture Sources, worker grid delivery, image strips/disposal, and
safe-orbit/flyby/suborbital prediction behavior. Logs are in `perfcpu2/validation/`.

### Round 2: steady frame, imagery budget, autosave, near-radial (2026-10-08)

Round 2 targets the recurring per-frame cost rather than one-off hitches. Revisions: main `49e6b30e` (5350),
round 1 `079e0a7b` (5351), round 2 final `d8f0b01c` (5353). Same Windows Chrome / RTX 3060 Ti / Ryzen 5600X
host, 1470×920 DPR 2, Medium, adaptive quality off, production sourcemapped builds, one Chrome lock per run.
Evidence: `docs/performance/perfcpu2/round2/`. **The 4 ms at 4× target is still not met**; see the end.

#### Where the frame went

`scripts/bench/cpu-steady.sh` (new) enters through Space Center → editor → Meridian → launch, waits for
imagery, then measures 8 s windows: pad, assisted ascent 8 s after liftoff, and a circular orbit
(`devScenario('orbit')`, 1× physics). Builds are interleaved and the order alternates per repetition;
`STEADY_PROFILE=1` adds a CDP CPU profile per window, attributed by `cpu-profile-report.mjs`
(`CALLERS=` gives a caller split). `cpu2-draws.mjs` counts draws per scene subtree.

Round 1's orbit spent ~14.5 of 17.7 ms/frame (4×) inside three.js render submission. The cause was draw
count, not shader cost: **pad 813, ascent 735, orbit 436 draws**. Per frame on the pad there were ~440 Earth
terrain chunks plus ~90 ocean meshes (about 40 chunks per quadtree level, L6–L14), ~115 vessel meshes plus
113 in the shadow pass, and ~70 launch-site draws. Each draw costs ~30 µs at 4× (≈7 µs real) in
`renderBufferDirect`/`setProgram`/VAO binding. Material sorting was already optimal (71 material switches for
71 materials on the pad). Every frame the scene's own `updateMatrix()` also forced a world-matrix multiply on
all ~1500 objects, including ~700 hidden cached chunks.

#### Changes (in commit order)

- **Terrain chunk size** (`c9522354`): `chunkResolution` doubled on every preset; selection still keys on vertex
  spacing, so screen error stays within target with one fewer level. Pad terrain 535 → ~200 draws.
- **Static containers + shadow cache** (`e3f9cd65`): flight scene, planet roots and quadtree groups no longer
  force descendant matrix updates; the controller updates matrices once per frame. `ShadowMapCache` redraws the
  sun's depth map only when an in-volume caster, the light or the map changed by more than ¼ texel. Pad skipped
  472 of 523 shadow passes, coasting orbit ~95%; ascent still redraws every frame (rotating vessel).
- **Ephemeris time slots** (`5043ade1`): four LRU time slots; render/physics/world time no longer evict each
  other's Kepler solves (`bodyRotation` alone was 0.9 ms/frame at 4× in orbit).
- **Rigid batching of animated parts** (`72ce768f`): only gimbals, deployables, gear joints, exhaust anchors, lamp
  lenses and EVA limbs stay individual. Meridian vessel draws ~115 → ~82.
- **Near-radial conics** (`38ce1010`), **autosave** (`831777a3`), **imagery budget** (`0441a5d1`): below.
- **Small per-frame items** (`3f1c9abd`, `d8f0b01c`): hidden batched leaves skip matrixWorld; lamp appearance
  applies on change; the quadtree reuses its selection while the body-fixed view and chunk set are unchanged.

Screenshots of pad, close-up engines, ascent and orbit match round 1 (`scripts/bench/cpu2-shots.mjs`);
no page errors.

#### Steady frame, production 4× CPU throttle

Two interleaved repetitions each (`r2-steady-4x.json`); app frame profiler, mean of per-run averages.

| Window | main | round 1 | round 2 | round 1 → 2 |
|---|---:|---:|---:|---:|
| Pad CPU avg / p95 (ms) | 28.5 / 32.8 | 28.2 / 33.4 | **18.0 / 21.3** | −36% |
| Ascent CPU avg / p95 (ms) | 32.4 / 37.3 | 31.7 / 37.2 | **24.0 / 28.2** | −24% |
| Orbit CPU avg / p95 (ms) | 18.3 / 21.7 | 17.5 / 20.1 | **12.7 / 15.1** | −27% |
| Pad / ascent / orbit fps (4×) | 16.3 / 14.9 / 19.7 | 16.3 / 15.0 / 20.1 | 19.5 / 17.0 / 22.1 | |
| Orbit long tasks > 50 ms per 8 s | 47 | 30 | 8 | |
| Main-pass + shadow draws, sampled frame (pad / ascent / orbit) | 814 / 739 / 431 | 813 / 739 / 436 | 458 / 425 / 188 | |

`task/f` (CDP TaskDuration per frame, which includes GPU-process waits) falls less: orbit 51 → 46 ms.
The remainder is native command submission/compositor time that scales with draws and passes.

#### Steady frame, production unthrottled (1×)

Two interleaved repetitions (`r2-steady-1x.json`). The display is 60 Hz, so all builds hold ~59 fps and the
rAF interval cannot show the saving; CPU per frame is the relevant figure for a 120 Hz Mac.

| Window | main | round 1 | round 2 |
|---|---:|---:|---:|
| Pad CPU avg / p95 (ms) | 4.83 / 5.90 | 4.81 / 5.85 | **3.03 / 3.70** |
| Ascent CPU avg / p95 (ms) | 4.91 / 6.15 | 4.94 / 6.10 | **3.69 / 4.70** |
| Orbit CPU avg / p95 (ms) | 3.10 / 4.00 | 3.09 / 3.80 | **2.21 / 2.75** |
| Long tasks > 50 ms | 0 | 0 | 0 |

At 120 Hz (8.3 ms) these leave 4.6–6.1 ms for GPU/compositor work instead of 3.4–5.2 ms. The ratio between
4× and 1× is ~6×, not 4×: CDP throttling also slows native submission work.

#### Imagery regression (c)

The regression was throughput, not a single stall. Total upload work was unchanged (main 567 ms in 164 × 4 MiB
ops; round 1 636 ms in 655 × 1 MiB), but round 1's fixed 0.75 ms budget admitted one unit per frame once the
CPU was slow, so the 8k stream took 34.8 s at 4× against main's 10.0 s. Round 2 spends ~6% of the measured frame
interval (1–3 ms), admits a unit only if its predicted cost fits, and starts allocation/mip-generation units only
at the start of a frame. Worker decoding and 1 MiB strips stay.

| High, 8k | main | round 1 | round 2 |
|---|---:|---:|---:|
| 4× stream span | 10.0 s | 34.8 s | **12.7–13.5 s** |
| 4× worst imagery `step()` | 7.7 ms | 5.3 ms | 6.0–6.5 ms |
| 1× worst imagery `step()`, 3 runs | 15.8 / 5.2 / 5.2 ms | 2.5 / 2.0 / 1.5 ms | 3.8 / 2.7 / 3.2 ms |
| 1× long tasks after ready | 0 | 0 | 0 |

The round-1 57.5 ms "cumulative imagery maximum" did not reproduce in eight runs. The only >40 ms operations
near imagery were part-texture allocations at load (decal atlas 2048², ~48 ms at 4×). Round 2 keeps most of
the unthrottled gain (about 1 ms worse than round 1, still below main) and recovers most of the streaming time.
Full tables: `round2/imagery-4x-1x.md`.

#### Autosave (b)

Measured with `cpu2-autosave.mjs`: Meridian after 20 s of ascent, ten slots across three programs (377 KB index),
4×, four autosaves per build, Chrome trace for the following idle callbacks.

| 4× | main | round 1 | round 2 |
|---|---:|---:|---:|
| Synchronous in-frame autosave | 12.5–15.3 ms | 12.8–14.6 ms | **1.6–2.0 ms** |
| Largest follow-up idle task | — | — | 3.7–13.0 ms |

The synchronous part is now the snapshot (`serializeWorld`). Stringify, slot-index write and legacy-key write run
as separate idle tasks. The index caches each slot's JSON while storage holds the text it wrote, so a write
stringifies only the new slot (Node, ~0.7–0.8 MB index of 75 KB slots: 6.7 → 1.2 ms per write, including
the new slot's stringify; the first write after load or an outside change still parses everything).
The largest idle task (≤ 13 ms at 4×, ≈ 3 ms real) is one stringify or `setItem` and grows with save size; the
journey traces' 56–68 ms (long flight logs) should shrink proportionally but were not re-run.
Readers, other saves and `pagehide` flush the queue; format and keys are unchanged (tests compare against the old
algorithm, check outside edits, ordering, flush-before-read and single error reporting).

#### Near-radial prediction (e)

A straight inbound Moon approach (zero or 1e-6 m/s transverse speed) threw `True anomaly outside hyperbolic
asymptotes` from `stateToElements` (via `World.orbitOf` in HUD predictions) at the SOI crossing. The hyperbolic
mean anomaly now comes from the state, e·sinh F = r·v / √(μ|a|). `tests/near-radial.test.ts` fails before the fix
and passes after, covering the World crossing with HUD, map and warp-target predictions and element round trips.

#### Still open

- **4 ms at 4× is not met** (orbit 12.7, pad 18.0, ascent 24.0). What remains is mostly per-draw three.js
  overhead: the pad still draws ~350 objects in the main pass (≈200 terrain/ocean, ≈80 vessel, ≈45 site
  materials). Getting further needs structural work: multi-draw/`BatchedMesh` terrain with batching-aware
  shaders (the parallel GPU branch owns those), a site material atlas, or caching the static parts of the
  frame. Ascent also redraws the shadow map every frame.
- Physics (~2.7 ms/frame at 4× in ascent), packed/prelaunch hazard stepping and the 10 Hz stage-Δv/prediction
  telemetry tick (~1 ms real) were left alone: reducing them would change simulation or readout results.
- React HUD reconciliation is ~1.5 ms/frame at 4× (≈0.4 ms real), spread thinly across components.
- Accelerated physics at liftoff, required warp-target/impact predictions and load-time construction/upload
  (round-1 items d) were not reworked in this round.
- Apple M-series / 120 Hz validation is still required; these are Windows and CDP-throttle numbers.

Validation at `d8f0b01c`: `npm run lint`, `npx tsc --noEmit`, `npx vitest run --maxWorkers=3`
(**134 files; 1408 passed, 1 skipped**) and `npm run build` pass.

## GPU check after merging CPU pass 2 onto GPU pass 2 (2026-10-08)

CPU pass 2 doubles terrain chunk resolution (fewer, larger chunks: fewer draws, more triangles), so the merged build was re-measured against main after GPU pass 2 (`d6362301`) with `gpu-passes-ab.sh`, Medium, DPR 2, three interleaved pairs, production builds:

| Scene | Fenced GPU ms main → merged | Triangles main → merged |
|---|---:|---:|
| Pad | 2.49 → 2.44 | 2.29 M → 2.25 M |
| Ascent | 1.97 → 2.02 | 0.75 M → 1.12 M |
| Orbit | 1.98 → 2.05 | 0.68 M → 1.05 M |

All scenes stay within the ≤2.5 ms Medium budget; the +0.05 ms in ascent/orbit is the extra terrain vertices. Apple tile GPUs may weigh vertex work more than the RTX; revisit chunk resolution if the owner's F8 report shows vertex-bound frames. Raw CPU traces and full-size imagery screenshots for CPU pass 2 (~160 MB) are archived outside the repository.

# Firefox / Zen pass — 2026-10-08 (`op/ffperf`)

Target: the owner's Zen on an M1-class MacBook (120 Hz Retina). Their F8 report in Earth orbit/re-entry: 89 fps,
frame p50 8.7 / p95 19.3 / p99 25.1 ms with only 2.4 ms main-thread CPU, 281–416 draws, render submit 1.3–1.8 ms.
Firefox remotes WebGL: every GL call is a command executed later by the GPU process, so the page's "CPU" can be low
while the GPU process (or a synchronous wait on it) drops frames.

## Method

- **Windows Firefox 143** (RTX 3060 Ti, ANGLE/D3D11), production builds, Medium, adaptive resolution off, 1600×915,
  DPR 1. This PC's Firefox vsync is 30 Hz, so steady-state A/Bs run Firefox in ASAP mode
  (`layout.frame_rate = 0`): the frame interval is then the whole pipeline's cost (page + GPU process + GPU), not
  vsync. `scripts/windows-firefox/ab.mjs` (40 s warm-up, 10 s window; `GLCOUNT=1` counts GL calls per frame) and
  `timeline.mjs` (per-second log from navigation; with `GLCOUNT=1` it lists the GL calls of every frame over 40 ms).
  Main = `422423e3`, served from a detached worktree. Results are single A/B pairs and noisy (the PC is shared).
- **Attribution** (which objects issue which calls) used Playwright Firefox on Linux (software GL) with
  `renderBufferDirect`/GL-prototype wrappers; draw lists do not depend on the GPU. Firefox exposes neither
  `WEBGL_multi_draw` nor timer queries nor parallel shader compile (Windows 143 and Linux).
- **Chrome**: `gpu-passes-ab.sh` (fenced GPU ms, Medium, DPR 2, 3 interleaved pairs) and the timeline driver for
  imagery streaming.

## Where the frame went (orbit, Meridian above the pad, one Firefox frame)

~1,660 GL calls for ~223 draws: vessel ~70 draws / ~770 calls (32 materials, 13 programs), Earth terrain+ocean
89 chunks / ~355 calls (no multi-draw: one mesh each), launch site 28 draws / ~330 calls (the orbit scenario starts
above the pad, inside its 200 km hide distance), post-processing ~94 + ~60 pass-setup calls. Uniform tracing found
`directionalShadowMatrix` re-uploaded on every material switch (~60/frame) and the bloom kernels on every blur pass:
three caches single uniforms but never array uniforms. In re-entry the vessel was 62% of all calls.

Spikes, from `timeline.mjs` and temporary section probes:

| Spike | Firefox cost | Cause | Fix |
|---|---:|---|---|
| Imagery streaming (~10 s after load) | 5–16 ms per unit, one unit every frame | Bitmaps copied through a 2D canvas (the Firefox crop workaround) are read back synchronously on upload; the budget always admitted one unit per frame | Pixel strips in Firefox; credit budget |
| Cloud-field bake, ~20 s into a flight | 1,052 ms once (587 ms with a warm shader cache) | Bake program compiled and linked on its first strip; Firefox has no parallel compile | Compiled in the warm-up (`offscreenWarmup`) |
| Imagery merge, first strip | ~16 ms | Same, small shader | Same |
| Sky-environment re-bake, ≤ 1/s in ascent/re-entry | allocation + every PBR material re-resolving its program | `PMREMGenerator.fromScene` allocates a new target per bake; new texture ⇒ program re-resolve | Re-bake into the existing target |

After the changes no program links after the loading screen in the orbit test (was 1). Loading and the first
40 s of flight, Windows Firefox (30 Hz vsync, `timeline.mjs`, orbit, two interleaved pairs):

| | loading screen closed | frames > 40 ms after loading | > 100 ms | worst |
|---|---:|---:|---:|---:|
| main | 16 s / 12 s | 11 / 8 | 4 / 4 | 947 / 934 ms (cloud-bake compile) |
| branch | 14 s / 14 s | 1 / 2 | 0 / 0 | < 100 ms |

With the branch, the bundled 4k imagery was on screen 11.6 s after navigation and the 8k pack 17.8 s, no imagery unit
over 6 ms. (One earlier pair under heavy machine load — load average > 30 — showed the branch loading in 37 s with
many 40–600 ms frames; it did not reproduce in the two clean pairs above.)

## Changes

1. `imageStrips.ts`/`earthImagery.ts`: Firefox gets packed `Uint8Array` strips from the decode worker (red only for
   masks: ¼ of the bytes and strips); streaming budget is a credit (overruns repaid by skipped frames; units charged
   at least the running estimate because Firefox's timer has 1 ms resolution). Merged imagery read back from the GPU
   is byte-identical to the old path.
2. `skyEnv.ts`: re-bakes render into the previous PMREM target.
3. `uniformCache.ts`: compare-before-upload cache for float/vector/matrix array uniforms, per program.
4. *Tried and dropped:* sorting opaque draws by program before material saved ~70 calls (4%) but cost ~0.1 ms of
   Chrome GPU on the pad (fenced 2.43–2.45 → 2.53–2.56 ms, over the 2.5 ms budget).
5. `flight/planets.ts`: terrain/ocean `BatchedMesh` also without `WEBGL_multi_draw` (three's per-chunk fallback:
   `uniform1i` + `drawElements` per chunk, one program setup and VAO).
6. `VesselView.ts`: deployables (solar arrays, bays, legs, gear) join a second static batch after 30 still frames.
7. `navball.ts`: redraw tolerance 2e-4 instead of 1e-6 (the second WebGL context and 2D overlay redrew every frame
   in a coasting orbit).
8. `offscreenWarmup.ts`: cube bakes and the imagery merge register proxies the flight warm-up compiles (against an
   empty scene: light counts are part of three's program key).

## Before / after

Final branch (`7b3f0e63`, after merging main) against current main (`29a067d0`).

GL calls per frame, orbit: Windows Firefox counted over a 10 s window **1,655 → 1,481 (−10.5%)**; draws 221 → 212.
Per subtree (Linux Firefox, one frame, before the sort was dropped): vessel 765 → 656, Earth 355 → 304, launch
site 329 → 268, post 94 → 72.

Windows Firefox 143, ASAP mode, Medium, 1600×915, interleaved pairs (rAF interval in ms; render = app "Render
submit" section; CPU = app main-thread frame time):

| Window | main mean / p50 / p95 / p99 | branch mean / p50 / p95 / p99 | render ms | CPU ms | navball ms |
|---|---|---|---|---|---|
| Orbit, GL counting on | 7.13 / 7.1 / 10.2 / 11.9 | **5.91 / 5.3 / 9.4 / 10.6** | 3.17 → 2.69 | 4.00 → 3.36 | 0.21 → 0.07 |
| Orbit | 6.70 / 6.4 / 9.1 / 11.0 | **5.56 / 5.1 / 9.0 / 10.6** | 2.78 → 2.14 | 3.63 → 2.78 | 0.26 → 0.09 |
| Orbit | 6.53 / 6.3 / 8.8 / 11.3 | 7.80 / 7.3 / 14.4 / 17.5 | 2.69 → 4.74 | 3.50 → 6.35 | 0.20 → 0.29 |
| Re-entry | 7.34 / 7.2 / 10.9 / 12.5 | **6.61 / 6.2 / 10.2 / 12.1** | 2.73 → 2.52 | 3.75 → 3.53 | 0.21 → 0.17 |

Three of four pairs improve the mean frame interval by 10–17%. In the third pair every section of the branch run was
slower, including simulation, which this branch does not touch (0.10 → 0.30 ms); the PC was shared with other
agents (load average > 30 at times), so read single pairs with caution. Earlier pairs against the older main
(`422423e3`, with the program-major sort still in) gave orbit 7.49 → 5.59 and 9.83 → 7.34 ms, re-entry
11.71 → 8.17 and 11.21 → 11.06 ms. Screenshots of an orbit pair match (mean absolute difference 2–4/255, one second
of simulation apart).

Chrome (RTX 3060 Ti), `gpu-passes-ab.sh`, Medium, DPR 2, fenced GPU ms, 3 interleaved pairs (medians):

| Case | main → branch |
|---|---:|
| Pad | 2.44 → 2.55 (+4%, scene pass 2.09 → 2.25) |
| Ascent | 2.03 → 2.02 |
| Orbit | 2.05 → 2.04 |

Chrome steady orbit CPU 2.4 → 2.35 ms, draws 139 → 130; imagery streaming finished in ~4 s after loading on both
(texSubImage2D activity), no regression from the credit budget.

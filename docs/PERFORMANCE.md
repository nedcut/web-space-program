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

Measured on the same harness (DPR 2, Medium, 1470×920 CSS → canvas 1470×920 because Medium caps DPR at 1; map at
2940×1840). Profiles: `scripts/bench/gpu-profile.sh` on an unminified build.

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
8. Medium at Retina already renders 1470×920 (DPR capped at 1); the map renders at 2940×1840 but is cheap
   (0.4 ms GPU, 29 draws).

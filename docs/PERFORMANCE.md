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

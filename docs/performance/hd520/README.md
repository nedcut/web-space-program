# Low-end laptop pass — 2026-10-14

Intel Core i5-6200U (2C/4T, 2.3–2.8 GHz), 8 GB, Intel HD Graphics 520 (Mesa, ANGLE GL), Chromium 152 on
Wayland, DPR 1, 1280×720 viewport, on AC. Real GPU: `gpu-bench.mjs` against a local Chromium with
`--remote-debugging-port=9333` (`--out` to a local dir). Auto-detection classifies this GPU as weak → Low.

| Scenario | Medium fps (GPU ms) | Low fps (GPU ms) | Low @0.75 scale fps (GPU ms) |
|---|---:|---:|---:|
| pad | 26 (38) | 60 (9.1) | 60 (13.3) |
| ascent | 26 (28) | 60 (8.6) | – |
| orbit | 31 (33) | 60 (8.1) | 60 (12.5) |
| moon | 58 (16) | 60 (5.7) | – |
| map / warp / tracking | 60 | – | – |

Medium is GPU-bound (CPU ≈ 6 ms/frame); its pad cost is mostly resolution-independent (~1.4 M triangles even at
0.6 scale). Low holds 60 fps with headroom; 0.75 scale also holds 60.

## Fixed in this pass

- **Engine soot bake ~5× faster, bit-identical** (`render/parts/soot.ts`): the streak hash takes 29 values per
  seed (now tables, was 4 `sin` per call); sources whose contribution is provably < 1e-3 (the existing cutoff)
  return before any `exp`; normals are transformed lazily. Verified on all stock craft: 0 of 18.6 M colour
  components differ. Node: selene-real 17.2 s → 3.4 s, ringrunner-real 16.9 s → 3.2 s, selene 450 → 91 ms.
  Browser flight load freeze for selene-real 5.9 s → 4.0 s; editor post-load long tasks 3.4 s → 1.45 s.
  `npx tsx scripts/bench/soot.ts [filter]` measures it.
- **Adaptive resolution held during flight loading** (`controller.ts`, `RenderPipeline.holdAdaptive`): loading
  frames sank the scale to its floor before the loading screen lifted; Low then ran at 0.25 effective for ~15 s.
  Now held until 2 s after `sceneReady`.
- **Weak-tier adaptive start** is 1.0 when the preset is already at ≤ 0.5 render scale (Low), not 0.6 (was 0.3
  effective at start).
- **Silent audio layers leave the Web Audio graph** (`audio/index.ts`, `GameAudio.level`): all ~37 pooled
  continuous layers (every engine type's roar/rumble/crackle/whine, wind, buffet, plasma, mechanics, neighbour
  engines) stayed connected at zero gain, and each costs its looping source and biquad every render quantum.
  The audio render thread used 38–43 % of a core during a plain ascent; now 15–17 % (4 of 37 layers connected).
  Layers reconnect at the first audible frame. Measured by per-thread `/proc` CPU of the renderer process.
- **Launch-site vegetation skips unchanged repacks** (`LaunchSite.updateVegetationLod`): a climbing camera moves
  past the 20 m step every frame, and each LOD level was repacked and re-uploaded although a cell wholly inside
  one band packs to the same arrays. `packBand` self time in a 10 s ascent 112 → 41 ms.
- `gpu-bench.mjs --profile 1` saves a CPU profile per measured window (for `cpu-profile-report.mjs`).

## Open findings (not changed)

- Selene-real flight load still has a 4 s single task (soot ~0.8 s, part mesh build ~1.1 s, first render).
  Next steps: bake soot in idle slices or a worker, or reuse the editor's bake.
- Every flight load: ~1.3 s first-frame task (launch-site texture generation, `textureCache` PNG encoding
  ~450 ms on a cold cache, GL texture uploads). Shader compiles only block ~180 ms (warm-up works).
- Low could default to 0.75 render scale on this GPU class (adaptive still drops it under load).
- Ascent allocates ~72 MB/min at Low (GC ~19 ms/s); no long tasks.
- `rails/1e6` is ~2.6 ms/tick: hazard sub-stepping at max warp (`advancePackedHazards`), affordable.
- First user gesture builds the audio graph synchronously (~125 ms keydown/click on this laptop): assigning the
  3.5 s stereo reverb impulse to the convolver alone is 115–185 ms, the noise buffers 40–60 ms. In normal play
  this is the first menu click. Deferring the reverb buffer or a shorter impulse would cut it (the latter
  changes the music's sound).
- The music reverb convolver (two threads, ~6 % of a core together) keeps running when music volume is 0.
- Editor at load: soot still takes ~1.7 s of idle-batch work over the first seconds for a Real-scale craft;
  steady state is idle.
- `scripts/bench/run.ts` telemetry/navball section is stale after the controller `systems` refactor (crashes at
  the end; all earlier rows are valid).

# Vessel art, pass 2 — real-GPU before/after

Windows Chrome on the RTX 3060 Ti over CDP 9333. Viewport 1470×920 CSS px, DPR 2 (2940×1840), Medium, render scale 1, adaptive resolution off, with shadows, bloom, clouds and scatter on. All art is original and procedural; nothing is downloaded. These PNGs are not shipped in the bundle.

## Quick look (side-by-side crops, before | after)

- [compare-editor-selene-close.png](compare-editor-selene-close.png): Selene upper stages in the hangar.
- [compare-pad-close.png](compare-pad-close.png): Selene first stage on the pad at dusk.
- [compare-orbit-close.png](compare-orbit-close.png): sunlit orbit at 220 km with Earth behind.
- [compare-engine-chinook.png](compare-engine-chinook.png): Chinook lifter engine.
- [compare-editor-pebblecatcher-close.png](compare-editor-pebblecatcher-close.png): small probe.

The full frames are `before-*.png` / `after-*.png` for each of these:
- `editor-selene`, `editor-meridian` and `editor-pebblecatcher`, each with a `-close` version
- `engine-zephyr` and `engine-chinook`
- `pad` and `pad-close` (default chase camera)
- `orbit` and `orbit-close` (day side; camera overhead, so the planet fills the background and the sun rakes across the hull at about 70°)
- `orbit-engine`

## What changed

- **Painted skin** (`texgen/recipes.ts` `panel`, 1024², one tile covers 2 m): staggered 0.5 × 1 m panels. Each panel has its own paint tone, warmth and gloss. Seams are 8 mm with rolled lips, and there are rivet rows, doubler plates, a screwed access hatch, fine stencil data lines, grime falling from the seams and sparse chips. The scale is chosen to read at 10–20 m, where the old 2 mm seams were sub-pixel.
- **Tank geometry**:
  - Stepped bare-aluminium end frames with a lip, a machined groove and a bolt flange, plus larger bolts.
  - Raised weld lands.
  - A cable raceway with tie-down straps and a pressurisation line in clamps.
  - Hat stringers on charcoal tanks and adapters.
  - A ribbed, foam-sprayed intertank band between metal flanges on long foam tanks.
  - More segments (96 for r > 0.9 m).
- **Markings**: a vertical "WEB SPACE PROGRAM" wordmark and a new original program flag on long tanks. The existing badges, plates and stencils are kept; tank decals clear the raised lands.
- **Weathering in vertex colour** (`weather()` in `builders/structure.ts`): engine soot toward the bottom, stains hanging from the top frame, faint handling dirt and a per-part paint batch tint. These read at whole-vehicle distance and break up texture tiling.
- **Baked ambient occlusion** (`ao.ts`): every template rigid group is voxelised, and each vertex casts 24 cosine-weighted rays. Moving subtrees (legs, panels, gear, control surfaces) occlude only themselves. A floor of 0.42 keeps enclosed bays readable. Bake time is about 12 ms per part on average (2.1 s for all 168 parts headless), once per template.
- **Engines**: chunkier white gimbal actuators with a chrome rod, a lower clevis and a hydraulic hose; hat bands on lifter/compact bells; one throat-to-exit tube heat ramp (the wrapping tile left a visible tone step).
- **Foam**: overlapping spray-pass bands, deeper tan mottling, some sheen and a stronger normal.
- **Hangar light**: lower studio IBL (0.62) and hemisphere, a stronger key moved more frontal, half the fill, a stronger warm rim and a new cool kicker from behind-right. Cylinders now show a terminator instead of even front light.

## Cost

The paired A/B uses the fixed 30-part fixture (Selene plus two cloned panels), in the same paused flight scene and camera, through the full HDR → bloom → tonemap → SMAA compositor. Adjacent old/new frames run in randomised order with 120 warm-up frames and ≥ 240 timer queries per root (`scripts/bench/partsart2-paired.mjs`; baseline source = commit 68e66116 copied to the ignored `.tmp/partsart-baseline/src`).

| Measure | Before | After |
|---|---:|---:|
| Paired GPU delta (median) | — | **+0.19 ms** (`first-paired-gpu30.json`), **+0.30 ms** final run under concurrent test load (`final-paired-gpu30.json`) |
| Compositor draws | 1,043 | 1,057 |
| Program re-resolutions after warm-up | 0 | 0 |
| Scene programs (orbit) | 91 | 91 |
| Selene vertices / triangles (High, 28 parts, before trimming the final budget) | 69.3k / 67.7k | 101.9k / 103.8k |

Both runs are within the +1.0 ms budget. Every part stays inside the existing 8.5k-triangle test budget. The new fine geometry (weld lands, stringers, straps, intertank) is High-detail only, so Low keeps the cheap silhouette. Vertex colour adds 12 bytes per vertex. The 1024² panel texture takes about 1.05 s in a texture worker on the first visit, then loads from the IndexedDB cache (`TEX_VERSION` 12). The precache grows from 2,385.80 to 2,394.96 KiB.

## Reproduce

```sh
npx vite --host 0.0.0.0 --port 5336 --strictPort
WIN_NODE=/mnt/c/wsp-tools/node-v24.14.1-win-x64/node.exe
"$WIN_NODE" "$(wslpath -w "$PWD/scripts/bench/partsart2.mjs")" after editor,engine,pad,orbit
"$WIN_NODE" "$(wslpath -w "$PWD/scripts/bench/partsart2-paired.mjs")" final
```

## Left

- Stains and soot are generic per part. They do not know which part sits above an engine, and there is no accumulated soot after burns.
- AO is per part: there is no contact shadow between neighbouring parts, and moving subtrees get no AO from their parents.
- Pods, legs and solar panels kept their existing modelled detail and gain only AO and lighting.
- The flag and the stencil data repeat with the 2 m tile.
- No geometric distance LOD beyond the existing High/Low preset switch.

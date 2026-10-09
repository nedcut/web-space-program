# Colour-only vessel batches — 2026-10-09

Branch `op/variantmerge`, baseline main `fc1dfef7`, implementation `52211c54`.

Accent paints, anodised metal colours and gold/silver foil now batch by family. A shared white material uses
the original linear material colour multiplied into the existing AO/soot vertex colours. This happens once
when building batch-owned geometry; individual source materials/geometry remain unchanged. Thermal and rigid
node slots, node-aware shadows, and the existing context-recovery hooks are retained. Other material differences
(roughness, normal scale, clearcoat, emission, etc.) still require separate draws. See DECISIONS.md.

## Chrome measurements

Windows Chrome over CDP `:9333`, RTX 3060 Ti, production builds, stock Selene, Standard scale, Medium,
1470×920 CSS pixels / DPR 2 (2940×1840 output, effective render pixel ratio 1.4), adaptive resolution off.
Every browser run held `/tmp/wsp-gpu.lock`. Order: before/after, before/after, after/before. Each case settles
for 12 seconds after loading, samples CPU for 4 seconds, then measures GPU with fenced timer queries
(median of five batches of 20 renders). Both pad and orbit run at 60 fps on this display.

| Case | Draws before → after | Full-frame CPU ms before → after | Render-submission CPU ms before → after | Fenced GPU ms before → after |
| --- | --- | --- | --- | --- |
| Pad | 106 → **103** | 1.818 → **1.726** | 1.709 → **1.632** | 2.439 → **2.429** |
| Orbit | 59 → **56** | 1.633 → **1.566** | 1.457 → **1.392** | 2.010 → **2.007** |

Means of three runs for render CPU/GPU; full-frame CPU uses the last two runs, which also enabled `__perf`
(flight loop plus navball/HUD work). The first pair used the earlier vesselbatch driver's pipeline CPU metric.
Full-frame CPU improves by about 0.09 ms on the pad and 0.07 ms in orbit here. GPU differences are within noise;
this is a draw-submission saving, with no demonstrated GPU speedup. No M-series or Firefox timing claim.

Raw render CPU / fenced GPU milliseconds, in run order:

- Pad before: 1.697/2.437, 1.750/2.448, 1.680/2.433; after: 1.642/2.449, 1.653/2.410, 1.601/2.428.
- Orbit before: 1.437/2.017, 1.453/1.998, 1.481/2.015; after: 1.383/1.998, 1.416/2.007, 1.376/2.016.

Triangle counts match exactly: pad 2,351,543, orbit 1,083,289. Program counts match: pad 90, orbit 88.
Texture counts match: pad 102, orbit 101. All six runs report no browser errors. The lower baseline than
last night's 123/91 draws reflects the current main checkout; the comparison uses its saved production build.

## Visuals and interactions

Same-frame comparisons in CDP Chrome freeze the simulation and camera, capture the new batch, then hide it and
restore the original individual meshes/materials for another capture. This holds lighting, textures, pose and
simulation state constant. Every screenshot pair is `ctx-{pad,orbit}-{state}-{batched,individual}.png`.
The pad probe is a close-up; the orbit probe includes the complete craft. Ordinary full-scene before/after
screenshots also accompany all six timing runs.

| State | Pad changed pixels / mean difference | Orbit changed pixels / mean difference |
| --- | --- | --- |
| Gimballed craft | 0.004% / 0.0001 | 0.007% / 0.0003 |
| Forced context loss + restore | 0.002% / 0.0000 | 0.004% / 0.0001 |
| Different engine pose after restore | 0.003% / 0.0001 | 0.004% / 0.0002 |
| Return to original pose | 0.001% / 0.0000 | 0.006% / 0.0001 |
| Every part at 1,500 K | 0.001% / 0.0000 | 0.001% / 0.0000 |
| Stress overlay cleared | 0.002% / 0.0001 | 0.004% / 0.0001 |
| After staging/separation | 0.008% / 0.0005 | 0.005% / 0.0001 |

Difference is maximum RGB-channel difference per pixel, averaged over the image, in 0–255 code values.
The sparse differences are edge/specular pixels; there is no visible colour change. The existing baseline batch
also differs slightly from individual meshes. After restore, all 51 moving nodes and all 29 batch meshes remain;
re-posing works. Separation produces two vessels and a 20-part active craft (46 nodes, 24 batch meshes).
The equivalent main build uses 32 and 27 batch meshes respectively.

Flight staging hover displays a visible ring, and clicking opens one inspector with a strong selection ring
(`ctx-{pad,orbit}-{hover,selection}.png`). The stress overlay replaces all 296 individual vessel meshes with its
green material; clearing it restores the coloured batches. Editor before/after screenshots at 1470×920 DPR 1
are **pixel-identical** in all five states: normal, selected, stage-highlighted, hovered and cleared
(`editor-{before,after}-{normal,selected,stage,hover,cleared}.png`). Material colours and highlight emission
values also match exactly (`editor-materials.json`). No editor page errors.

### Existing context-recovery limitation

The forced-loss probe also changes background scenery (most visibly launch-site surfaces) and logs
`INVALID_OPERATION` warnings when deleting old GL objects. Running the same probe on saved main `fc1dfef7`
reproduces the pad scenery change and the identical warning totals (200 `delete`, 56 `deleteVertexArray`,
then the browser's warning cap). The new vessel batch still matches the original individual meshes after
recovery and after another pose change. This task does not fix the existing scene-wide restoration issue;
the before/after-loss whole-scene screenshots are **not** pixel-identical. Main-control evidence is in
`main-visual.log` and `ctx-main-*-*.png`.

## Checks and remaining coverage

- `npm run lint`, `npx tsc --noEmit`, `npm run build`: passed.
- `npx vitest run --maxWorkers=2`: 177 files, 1,676 passed, one skipped (293 seconds).
- New regressions cover explicit material-family compatibility, highlight clone isolation, multi-material
  face colours with AO/soot, repeated batching without double tint, source ownership, and heat/node slots.
  Existing moving-node/context-restore, thermal and editor-material tests also pass.
- No simulation changes. No new per-frame work, allocations, vertex attributes or shader variants.
- Firefox/Zen and M-series hardware were not re-measured for this change; Chrome evidence is on the RTX 3060 Ti.

## Reproduction and evidence

- Source/builds: `/home/nedcut/.t3/projects/wsp-wt/variantmerge/`, `dist-cpu-before` (main) and `dist` (branch).
  Preview ports used: 5516 and 5517.
- Drivers and logs: `/home/nedcut/.t3/projects/wsp-traces/variantmerge/`; drivers in its `drivers/` directory
  are copies of the existing `vb-gpu-passes.mjs` / `ctxloss-vb.mjs` harnesses, with full-frame CPU collection
  and interaction probes added. Windows copies are `C:\wsp-tools\drv\variant-gpu.mjs`,
  `C:\wsp-tools\drv\variant-editor.mjs`, `C:\wsp-tools\drv-ff\variant-visual.mjs`.
- Raw timing JSON: trace directory `bench/{before,after}-{1,2,3}.json` and `C:\wsp-tools\bench\variantmerge\`.
- PNGs: `C:\wsp-tools\shots\variantmerge\` (large media intentionally outside git).

Example timing run (with a preview server already running):

```sh
flock /tmp/wsp-gpu.lock timeout 300 \
  /mnt/c/wsp-tools/node-v24.14.1-win-x64/node.exe \
  'C:\wsp-tools\drv\variant-gpu.mjs' \
  --base http://172.24.204.38:5517 --label after-repeat \
  --craft stock-selene --cases pad,orbit \
  --out 'C:\wsp-tools\bench\variantmerge' --shotdir 'C:\wsp-tools\shots\variantmerge'
```

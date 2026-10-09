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

# Part surfaces — real-GPU acceptance

Original procedural art, captured in Windows Chrome on the RTX 3060 Ti through CDP 9333. Viewport 1470×920 CSS pixels, DPR 2 (2940×1840 screenshots), Medium, render scale 1, adaptive resolution off; shadows, bloom, clouds and scatter on. No downloaded art or new runtime dependencies. These evidence PNGs are not shipped in the game bundle.

## Visual comparison

Quick links: [editor close-up](after-editor-pebblecatcher-close.png), [engine](after-engine.png), [pad](after-pad-close.png), [sunlit orbit](after-orbit-close.png), [re-entry](after-reentry.png), [burn glow](after-burn.png). Compare each `before-*.png` with its `after-*.png` counterpart:

- `editor-meridian`, `editor-selene`, `editor-pebblecatcher`, plus `-close`: painted aluminium, thermal white, orange foam, foil, solar cells, windows, RCS housings and leg hardware under hangar lighting.
- `engine`: cooling jacket, plumbing and the nozzle extension. The extension now uses one axial temper gradient; softer normal relief and a rough oxide finish replace the repeated rainbow/chrome appearance. Its silhouette has a finite exit angle.
- `pad` / `pad-close`, `orbit` / `orbit-close`: shared PBR textures and sky/planet PMREM under flight lighting. Camera and orbit attitude are controlled for repeatability. The ground belongs to a separate workstream.
- `reentry`: three-part capsule fixture, initialized at 22 km with a steep 4.5 km/s entry, then stepped through the actual simulation until a skin node exceeds 1100 K. This is an accelerated diagnostic entry, not the stock scenario's default trajectory. At 6.64 s the final shield reaches 1101.0 K; capsule nodes remain below 311 K. The shield glows independently through the static batch.
- `burn`: controlled rendering fixture applying 30 seconds of burn history to the bottom engine's heat controller. Demonstrates bell glow and excludes claims about a complete powered-flight simulation.

Inspection drove two iterations: the first foil recipe was too smooth, and panel chips still looked like black zipper teeth. The final shared atlases use continuous warped folds and much smaller, sparser chips. Glass reflects the environment without fake emission. Ablator is charcoal rather than brown; it retains a procedural char pattern. Small RCS housings and landing-leg clevises/brackets have bevels; Low retains boxes. Existing tubes, ribs, trusses, docking guide petals, pistons and solar grids remain batched.

## Cost and verification

The fixed 30-part fixture is Selene plus two cloned solar panels. Vessel geometry:

| Measure | Before | After | Change |
|---|---:|---:|---:|
| Submitted vertices (instances expanded) | 67,613 | 70,013 | +2,400 / 3.55% |
| Triangles | 67,380 | 68,148 | +768 / 1.14% |
| Vessel draw groups | 248 | 248 | 0 |
| Full-scene shader programs (latest merged base) | 91 | 91 | 0 |

**Final adjacent-pair GPU delta: +0.285 ms across 240 pairs**, within the +0.5 ms budget. Separate medians were **5.099 → 5.501 ms** (+0.402 ms); both roots issued **1,043 compositor draws** and **zero vessel program re-resolutions**. The final full-run timer measured **5.732 ms cold / 5.642 ms changing heat**; its per-pass medians were render **4.452**, bloom **0.334**, output **0.129**, SMAA **0.573 ms**. The matching baseline full run was **5.231 / 5.234 ms**. Use the adjacent-pair delta for the normal-craft budget rather than subtracting independently timed runs.

The accepted implementation uses a **128 KiB shared float radiance texture**, plus one scalar vertex/instance index. It replaces per-part thermal material clones without splitting batches. Variants remain shared by source material and distinct for instanced draws; static geometry retains template identity. Temperature changes upload the lookup only when rounded radiance changes. No new screen-space pass; the flight PMREM uses 128-pixel faces, updated at most once per second.

We also tested streaming RGB attributes (about 630 KiB visible data on this fixture). That version met the cold budget but cost **6.773 ms** when all 30 parts changed heat, versus **5.234 ms** for the baseline. Returning to the compact lookup measured **5.356 ms cold / 5.300 ms changing heat** on the otherwise identical final-source snapshot. This rejected experiment is preserved in `attributes-*.json`; its timings must not be attributed to the delivered shader. The final acceptance data is `final-paired-gpu30.json`, `final-gpu30.json`, and `final-before-gpu30.json`.

Separate full-scene runs drifted from 5.75 to 7.75 ms while the machine was shared. Their raw JSON is retained (`before1`, `after1`, `after2`); those non-contemporaneous measurements alone cannot establish the incremental budget. `final-paired-gpu30.json` instead renders adjacent old/new vessel pairs, randomizing order within each pair (fixed seed; avoids binding either root to a fixed odd/even compositor buffer) in the same paused scene, camera, environment and full HDR→bloom→tonemap→SMAA compositor. It discards 120 warm-up frames, then collects at least 240 disjoint-checked timer queries per root. It retains each frame pair and reports the median adjacent-pair difference, as well as the separate medians. This isolates the changed parts from between-run load/terrain variation. The old root uses the baseline materials and original heat implementation; the new root uses the updated surfaces and shared radiance lookup. The PMREM change is outside this isolated comparison; its update frequency and resolution both decrease.

Raw full-run JSON also includes per-pass timer queries using the same `EXT_disjoint_timer_query_webgl2` extension as F8. Those passes are measured in a separate phase, so their medians need not sum to the earlier full-frame median. Program-resolution counters in the screenshot metrics instrument `customProgramCacheKey` on visible vessel materials after warm-up.

## Reproduction

Start only this worktree's server:

```sh
node scripts/bench/partsart-baseline.mjs
npx vite --host 0.0.0.0 --port 5333 --strictPort
```

The baseline helper copies the current source into ignored `.tmp/partsart-baseline`, then restores only files changed by the two implementation commits from `b6ec2204`. Thus unrelated merged main changes are identical. It is served on the same port, without switching source files under tests or causing HMR in the current scene.

From WSL in this worktree, run Windows Node against the already-running GPU Chrome:

```sh
WIN_NODE=/mnt/c/wsp-tools/node-v24.14.1-win-x64/node.exe
"$WIN_NODE" "$(wslpath -w "$PWD/scripts/bench/partsart.mjs")" before editor,engine,pad,orbit,reentry,burn http://localhost:5333/.tmp/partsart-baseline
"$WIN_NODE" "$(wslpath -w "$PWD/scripts/bench/partsart.mjs")" after editor,engine,pad,orbit,reentry,burn
"$WIN_NODE" "$(wslpath -w "$PWD/scripts/bench/partsart-gpu.mjs")" final
"$WIN_NODE" "$(wslpath -w "$PWD/scripts/bench/partsart-paired.mjs")" final
```

Drivers create and close only their own tabs. The focused CDP transport avoids attaching to unrelated agents' renderers and reuses the supplied Windows Playwright driver's WebSocket implementation for large Retina PNG responses. It does not invoke Playwright browser-wide attachment or download dependencies. Every PNG is checked for the requested 2940×1840 dimensions. Stop the Vite process after verification.

## Checks

After merging current main: `npm run lint`, `npm run typecheck`, `npx vitest run --maxWorkers=2` (**99 files / 1,102 tests**, 214.78 s), and `npm run build` pass. Build precache: 51 entries / 2385.80 KiB; existing large-chunk and mixed-import warnings remain. Added regressions cover independent instanced temperatures, merged thermal indices, and stress-overlay restoration; existing heat tests exercise burn warm-up/cool-down.

## Remaining limits

Skin glow uses the hottest of six simulation skin nodes across the part, rather than directionally interpolating the individual faces. Charring is a static procedural material, not accumulated erosion. Reflections approximate the sun, sky and lit planet disc; they do not capture nearby vessels or terrain meshes. Existing texture AO remains; there is no added SSAO. The existing plasma envelope can obscure capsule details. Whole-machine frame pacing and adaptive-resolution acceptance still depend on shared GPU load; timer queries measure WebGL work rather than Windows compositor cost.

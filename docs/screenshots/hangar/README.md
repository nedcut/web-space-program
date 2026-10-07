# Hangar presentation — cx/hangar

Final integration baseline: `main` at `94e5930ed246ccc8ffdb82ee98873580b431970b`.
Both sides of the screenshot comparison use the integrated toolbar/preflight UI.
Earlier dirty-shadow runs used `f4784124`; the hangar renderer and the two stock
fixtures are unchanged by the intervening upstream integration.
Original procedural art only. Captured in hardware Windows Chrome / ANGLE D3D11 on
NVIDIA RTX 3060 Ti, 1470×920 CSS pixels, DPR 2 (2940×1840), Medium, shadows on,
render scale 1, adaptive scaling off. No headless fallback was needed.

## Visual evidence

| Craft / framing | Before | After |
|---|---|---|
| Selene, wide | [before](before-selene-wide.png) | [after](after-selene-wide.png) |
| Selene, close | [before](before-selene-close.png) | [after](after-selene-close.png) |
| Meridian, wide | [before](before-meridian-wide.png) | [after](after-meridian-wide.png) |
| Meridian, close | [before](before-meridian-close.png) | [after](after-meridian-close.png) |

[Selection](after-selection.png), [free attach target](after-nodes.png),
[snapped attachment](after-snap.png). The scripted snap/place/undo check records
part counts and the selected attach-node key in the metrics JSON.

## Method

`scripts/bench/hangar.mjs` captures the actual editor HUD, then imports a frozen
baseline EditorView beside the current one. Both receive the same EditorSession,
camera settings and drawing-buffer dimensions. Pause both editor loops and render
the two complete scenes alternately through **their actual editor renderers**, with the order of
each adjacent pair randomized (seed 91817). Measure `EXT_disjoint_timer_query_webgl2`
around each full render (including the shadow pass when dirty). Flush explicitly, reject
disjoint samples and bound query waits. Discard 40 warm-up pairs and retain 120.
This is direct WebGL render cost, excluding browser composition and startup/probe
bakes. It does not infer laptop FPS from the desktop GPU.

Reproduce within this worktree, with Windows Chrome CDP on 9333:

```sh
mkdir -p .tmp/hangar-baseline
git archive 94e5930ed246ccc8ffdb82ee98873580b431970b src | tar -x -C .tmp/hangar-baseline
npx vite --port 5322 --strictPort --host
# In another terminal; replace the address with hostname -I's WSL address:
/mnt/c/wsp-tools/node-v24.14.1-win-x64/node.exe "$(wslpath -w "$PWD/scripts/bench/hangar.mjs")" after http://172.24.204.38:5322 paired
```

An optional final argument `craft` or `hall` isolates that layer; `full` repeats the
whole scene and `dirty` forces a fresh shadow pass on every sample. These diagnostic runs write under `.tmp/hangar-profile/`, keeping
intermediate screenshots out of the evidence directory. Program-resolution counts
include warm-up and help distinguish shader churn from steady rendering cost.

## Scope and limits

- Only editor rendering changes. Part colour overrides clone the shared materials;
  the isolation regression test checks unchanged flight colours, maps, defines,
  material types and shader cache keys. Flight shader features are unchanged.
- Floor reflections are a one-time box-projected hall probe, not a live craft mirror.
  The contact shadow is a soft elliptical footprint, not screen-space AO or a
  physically accurate projection. Its spread/opacity follow craft clearance.
- Coplanar decal labels do not cast a second shadow over their underlying hull.
- The shadow map is reused while the assembled craft and lights are stationary,
  including camera orbits. Session edits and held-part movements invalidate it.
  The floor uses the corrected contact shadow instead of filtered directional shadows.
- Matte cladding uses vertex diffuse lighting. Craft PBR, surface AO, shadow quality,
  render resolution, original markings and the editor's render-on-change behavior
  remain in place. No new screen-space pass or additional light was added.
- Attach targets are camera-facing, 6–10 CSS-pixel radius, with dark keylines;
  the snapping target pulses separately. Existing selection tints remain.
- GPU acceptance covers these two stock craft and two fixed camera framings on
  Medium/DPR 2. Startup time, all possible custom craft, other presets and laptop
  hardware were not benchmarked.

## Final steady-render GPU measurements

Raw adjacent pairs: [after-metrics.json](after-metrics.json). Both scenes use the
original editor resolution and shadow-map size. No frame-skipping is included in
the measured render calls.

| Case | Main median ms | Final median ms | Paired delta ms | Main → final draws |
|---|---:|---:|---:|---:|
| meridian-wide | 0.927 | 0.717 | -0.212 | 286 → 156 |
| meridian-close | 0.909 | 0.667 | -0.241 | 256 → 126 |
| selene-wide | 0.964 | 0.727 | -0.238 | 557 → 292 |
| selene-close | 0.987 | 0.715 | -0.274 | 518 → 253 |

These measurements supersede exploratory runs using a shared renderer across two
independently initialized scenes. That diagnostic imposed different scene/program
switching behavior from production and showed higher Selene deltas; it was useful
for investigation but is not the final native-editor acceptance method. The final
optimization also avoids redrawing hundreds of static shadow-caster meshes.

## Forced shadow-refresh check

`dirty` forces a new shadow map on **every** timed render, so the steady-frame
cache cannot hide editing-frame costs. Raw data: [dirty-metrics.json](dirty-metrics.json).

| Case | Main median ms | Final median ms | Paired delta ms |
|---|---:|---:|---:|
| meridian-wide | 0.924 | 0.758 | -0.165 |
| meridian-close | 0.907 | 0.715 | -0.192 |
| selene-wide | 0.959 | 1.191 | +0.227 |
| selene-close | 0.983 | 1.027 | +0.035 |

Final post-integration Vitest: **106 files / 1,126 tests passed** against main
`94e5930e`, including the decal-shadow/material regression. Lint, TypeScript and
production build pass.
The browser reports GL error 0, zero failed programs and zero steady shader
program re-resolutions. The shadow-cache and stack-attachment smoke checks pass.

A second forced-refresh run ([dirty-repeat-metrics.json](dirty-repeat-metrics.json))
measured Selene wide **0.963 → 1.284 ms**, close **0.985 → 1.167 ms**,
Meridian wide **0.925 → 0.756 ms**, close **0.907 → 0.713 ms**.
Across both final forced-refresh runs, the largest difference between medians is
**+0.322 ms** (largest median adjacent-pair delta **+0.302 ms**), below **+0.5 ms**.
No steady program re-resolutions, GL errors or failed shader programs were observed.

Post-integration check against `94e5930e`:
[integrated-dirty-metrics.json](integrated-dirty-metrics.json). With every shadow
forced dirty, Selene wide is **0.963 → 1.170 ms (+0.207 ms)** and close is
**0.986 → 1.015 ms**; Meridian wide is **0.926 → 0.759 ms** and close is
**0.908 → 0.717 ms**. The +0.322 ms worst repeat above remains the conservative
acceptance result across the final runs. All final before/after screenshots use
the integrated UI and unchanged comparison cameras.

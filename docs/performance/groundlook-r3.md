# Groundlook round three: water city-light emission

Base: merged main `853c4465` (includes capefix and mapbiomes), fast-forwarded into
`cx/groundlook`. Runtime change is confined to `src/render/planet/materials.ts`.

## Fix and daylight finding

The ocean shader added the global Black Marble night map to **every water
fragment at 60% strength**. Coarse coastal/urban light pixels consequently lit
whole lakes and lagoons, much more strongly than the regional land treatment.
This term was already present in `36ae7880`, before groundlook.

Remove that emission. Procedural terrain streets and the far sphere now apply
their existing water weight too; regional terrain glow already did. Water retains
its sky/sun lighting. No new lookups, textures, geometry, draws or CPU frame work.

The pale daylight lake fill and narrow rims are **pre-existing ocean seabed
shading**, not regional imagery. Disabling regional imagery leaves them visible;
disabling only `col = mix(col, bed + vSkyRefl * F, shallowW)` removes them. That
seabed code is identical in the pre-groundlook baseline `e995b809` and merged
main. No daylight shading is changed here. Resolving its treatment where imagery
water and terrain depth disagree is separate work for the lead.

## Before/after evidence

All media and raw measurements: `/mnt/c/wsp-tools/shots/groundlook-r3/`
(Windows: `C:\wsp-tools\shots\groundlook-r3\`).

- `before-orlando-night.png` / `after-orlando-night.png`
- `before-orlando-day.png` / `after-orlando-day.png`
- `before-cape-night.png` / `after-cape-night.png`
- `before-cape-day.png` / `after-cape-day.png`
- `no-region-{orlando,cape}-day.png`: diagnostic, regional pack disabled.
- `no-seabed-{orlando,cape}-day.png`: diagnostic, ocean seabed blend disabled.
- `lights-off-{orlando,cape}-night.png`: diagnostic, all city lights disabled.

Development server, `http://localhost:5548/planet-preview.html`, 1470×920, DPR 1,
Medium, Standard scale. Common query:
`body=earth&ui=0&settle=1&quality=medium&dec=20&month=7&alt=3000&pitch=-30`.
Orlando: `lat=28.45&lon=-81.45&head=0`; Cape:
`lat=28.5&lon=-80.83&head=90`; night `hour=1`, day `hour=12`. Waited for ready,
then at least 15 seconds; all captures report global **8k** and regional loaded.

Pixel checks (`pixels.json`, coordinates in the 1470×920 screenshots): Orlando
lake (995,525) changes RGB 68/40/15 → 0/0/0; shoreline (1114,312) 127/86/42 →
0/0/0. Cape lagoon (1050,873) changes 127/86/45 → 0/0/0. Those after values
match the lights-off control. Nearby city pixels remain unchanged: Orlando
(700,850) 23/14/5 and Cape (990,825) 21/13/4; they turn black in the lights-off
control. Day captures retain the pale water treatment (small wave/edge differences
between independent loads; mean absolute channel delta 0.0015 Orlando / 0.0524
Cape on the 0–255 scale).

Final captures report no page/console/HTTP errors or GL errors. The initial
before probe had one resource 404 on its first page, not a shader failure; the
final fresh-load capture/measurement run had none.

## Medium GPU timing

Windows Chrome / RTX 3060 Ti. Same-scene before/after shader swaps, all other
assets/settings resident and unchanged. Eight balanced B/A/A/B/A/B/B/A rounds,
120 untimed draws after each swap, five timer queries of 30 full-pipeline draws
per round: 20 samples per variant. Median GPU milliseconds:

| Requested preview view | Before | After | Change |
| --- | ---: | ---: | ---: |
| Orlando night | 1.20013 | 1.18265 | -1.46% |
| Orlando day | 1.13118 | 1.12715 | -0.36% |
| Cape night | 1.38127 | 1.34488 | -2.63% |
| Cape day | 1.36810 | 1.37925 | +0.82% |

Day views are within the requested ±1%. Night views are faster after removing
the light-map work; their improvement exceeds 1%, so they are not literally
unchanged within ±1%. No measured regression above 1% in these views.
Raw data: `final.json`. Drivers: `C:\wsp-tools\drv\groundlook-r3-{probe,final}.mjs`;
exact reverse shader patch: `groundlook-r3-patch.json`. Logs:
`/tmp/groundlook-r3-{probe,final}.log`.

The production flight controls also stay within **±1%**. Same paired method,
frozen flight scenes, 1470×920 CSS at DPR 2 (2940×1840 output canvas), Medium,
adaptive quality off:

| Production scene | Before | After | Change |
| --- | ---: | ---: | ---: |
| Pad | 2.44926 | 2.44169 | -0.31% |
| 10 km ascent | 2.10752 | 2.10431 | -0.15% |
| 30 km ascent | 1.59753 | 1.60317 | +0.35% |
| Orbit | 2.03745 | 2.02738 | -0.49% |

`flight.json` contains the raw samples, renderer and settings; all four cases
report no console/page/GL errors. Drivers:
`C:\wsp-tools\drv\groundlook-r3-flight.mjs` and `groundlook-r3-flight-eval.js`;
log `/tmp/groundlook-r3-flight.log`. The production build came from the final
runtime diff in this worktree; only documentation was edited afterward.

## Verification and limits

- `npm run lint`: passed (`/tmp/groundlook-r3-lint.log`).
- `npx tsc --noEmit`: passed (`/tmp/groundlook-r3-tsc.log`).
- `npm run build`: passed (`/tmp/groundlook-r3-build.log`, existing chunk-size warning).
- `npx vitest run --maxWorkers=2`: **208 files passed, 1,922 tests passed, one
  skipped**, 352.30 s (`/tmp/groundlook-r3-vitest.log`).
- All requested after captures compiled/rendered without console, HTTP or GL errors.
- Distant-globe smoke: `after-far-night.png`, 3,500 km altitude, nadir, same
  Orlando night parameters; ready, mode `far`, global 8k, no errors
  (`/tmp/groundlook-r3-smoke.log`).
- Mac / M-series, Zen / Firefox, other quality levels and 120 Hz frame pacing are
  not measured. The existing pale daytime water is deliberately left for separate
  work, with its shader-level diagnosis above. No claim of physically accurate
  city reflections or exact real-world shorelines.

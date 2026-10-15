# Regional flight ground appearance — cx/groundlook

Base: `e995b809`. Runtime/asset head: `66beca43`. No push or merge. This branch
changes flight terrain imagery, not map UI, simulation heights or launch geometry.

## Result and decisions

- Florida/Gulf/Caribbean gets a static 4096×2560 colour patch over 100–60°W,
  10–35°N. Its north/south sample spacing is about 1.09 km, 4.5× finer than the
  existing global 8k imagery. This is not a global 500 m upgrade. Global monthly
  imagery remains visible outside the region and at orbital distances.
- Natural Earth urban footprints and Black Marble brightness add grey roofs,
  green suburbs and street texture by day, with intermittent lamps and a diffuse
  glow at night. Orlando, Miami and Tampa have geographically placed footprints;
  individual streets/buildings are original procedural texture, not surveyed data.
- Satellite colour drives restrained field, canopy and damp-green detail. This is
  a visual approximation, not the simulation's biome classification. The regional
  contribution fades in between 250 and 750 m viewing distance; below 250 m the
  existing local surface material remains. It fades out over 0.06–0.16 Earth radii
  (about 38–102 km in Standard scale).
- One planar detail lookup replaces coarse triplanar noise in the region's
  interior. No city meshes, extra draw calls or per-frame CPU allocation were added.
  Colour and urban density share one RGBA texture; night brightness uses R8.
- Medium and higher stream the pack after global imagery. Low and capped far-only
  renderers skip it. Missing downloads leave global imagery intact. Upload/merge
  work uses the existing per-frame budget, and context restore re-streams the pack.
  It loads for Earth flight even when the camera is outside the covered region.
- Added tracked pack size: **3.657 MB** (decimal, including manifest). Steady GPU
  storage is approximately **67 MiB** including mips, with temporary upload
  textures and decoded CPU strips in addition during loading. Public-domain NASA
  and Natural Earth source URLs, licence statements and input/output SHA-256 hashes
  are recorded in the pack manifest and `public/earth/ATTRIBUTION.md`.

## Verification

Final lint, standalone TypeScript check and production build passed. Loader,
fallback, disposal, context restore and asset provenance checks are in
`tests/earth-ground.test.ts`; the focused terrain/imagery run passed 15 tests.
The final full two-worker Vitest result is recorded below when complete.

Windows Firefox captured Florida at 30 km and 1.2 km and Orlando at 3 km by day
and night with the regional pack active, with no page/console errors. Forced
WebGL loss/restoration recovered Orlando; the before/after-restoration PNGs are
byte-identical. Chrome's final capture set and GPU measurements are described below.

All ten final Chrome captures completed on runtime head `66beca43`, with 8k imagery
and the regional pack settled and no page/console errors. These overwrite the
earlier `final-*` captures made during optimization; only the last capture log
listed below identifies the final set.

## GPU acceptance

**The no-measurable-slowdown gate is not met. Do not merge this as a performance-
approved change.** Final paired medians show a 0.122 ms / 5.7% regression at 10 km;
earlier variants also consistently regressed there. The 30 km reduction does not
offset this requirement. Pad and orbit results vary between runs, and the final
orbit comparison is also slower.

| Scene | Before GPU ms | After GPU ms | Change | Before / after F8 CPU ms |
| --- | ---: | ---: | ---: | ---: |
| Pad | 2.415 | 2.453 | +1.5% | 2.243 / 2.262 |
| 10 km ascent | 2.131 | 2.253 | +5.7% | 2.420 / 2.376 |
| 30 km ascent | 1.765 | 1.700 | −3.7% | 2.089 / 2.156 |
| Orbit | 2.019 | 2.124 | +5.2% | 1.708 / 1.718 |

All four cases had the regional pack active. Further shader optimization, a
different detail design or an explicitly agreed quality tradeoff remains for the
lead; this report does not waive the Medium budget.

Measurement uses Windows Chrome on RTX 3060 Ti, production build, Medium,
1470×920 CSS pixels at DPR 2, balanced 0.70 rendering scale, adaptive off. The
final build is frozen at `wsp-traces/groundlook-packed-dist`, port 5545. The GPU
lock serializes browser jobs; the full Node tests overlapped this run, so F8 CPU
figures are shared-host observations rather than isolated CPU benchmarks.

`scripts/bench/groundlook/shader-ab.js` switches both baseline vertex and fragment
sources versus final sources in the same frozen flight scene. It performs six
alternating rounds (before/after/after/before/before/after), each with five
timer queries of 30 full-pipeline draws. Reported GPU numbers are medians of all
15 samples per variant. A 1.5 s ordinary-rendering F8 window precedes each batch;
CPU numbers are medians of its three average CPU times per variant. Regional
textures stay resident for both variants. Thus this isolates steady shader cost;
it does not measure loading or memory pressure differences between builds.

Raw final evidence: `C:\wsp-tools\shots\groundlook\groundlook-packed-ab.json`.
The eval wrapper with baseline sources is
`C:\wsp-tools\drv\groundlook-exact-eval.js`. An initial separate production
baseline exists in `groundlook-before.json` at DPR 1; it is not numerically
comparable to this DPR 2 table. Earlier `after1`, `after2`, `accepted`, `final`,
`final-fixed` and other diagnostic JSON files describe superseded variants.

## Screenshot evidence

All media stays outside Git in `C:\wsp-tools\shots\groundlook\`
(`/mnt/c/wsp-tools/shots/groundlook/`). The Chrome files pair identical camera,
season, light and quality settings, with the global 8k level settled:

| View | Baseline | Final |
| --- | --- | --- |
| Florida, 600 km | `before-fl-600k.png` | `final-fl-600k.png` |
| Florida, 120 km | `before-fl-120k.png` | `final-fl-120k.png` |
| Florida, 30 km | `before-fl-30k.png` | `final-fl-30k.png` |
| Florida, 7.5 km oblique | `before-fl-8k-oblique.png` | `final-fl-8k-oblique.png` |
| Cape, 1.2 km | `before-fl-1k.png` | `final-fl-1k.png` |
| Orlando, 3 km day | `before-orlando-day.png` | `final-orlando-day.png` |
| Orlando, 3 km night | `before-orlando-night.png` | `final-orlando-night.png` |
| Miami, 3 km day | `before-miami-day.png` | `final-miami-day.png` |
| Tampa, 3 km day | `before-tampa-day.png` | `final-tampa-day.png` |

`final-dateline.png` checks that the regional patch does not appear on the opposite
hemisphere. Firefox equivalents use `ff-final-`; restoration is
`ff-restored-orlando.png`. Shot definitions are in
`C:\wsp-tools\drv\groundlook-final.json`. Chrome's last capture log is
`/tmp/groundlook-packed-shots.log`; Firefox's is `/tmp/groundlook-firefox-final.log`.

## Remaining acceptance and limitations

- The Medium no-measurable-slowdown requirement is a merge gate; see the final GPU
  result above. The branch should not be called performance-approved without it.
- M4 Pro, macOS Zen/Firefox and 120 Hz performance have not been measured.
- Integration with capefix/mapbiomes has not been tested. The circular Cape
  plateau and coarse shoreline still appear in this branch's screenshots because
  their geometry is deliberately left to capefix.
- Close-up urban fabric is a repeating 2D texture, and rural detail remains
  stylized. The source colour is static and uses about 1 km samples. No claim of
  photogrammetric cities, real roads or precise marsh/forest classification.
- Browser visuals use the development-only planet preview; GPU timing uses the
  production flight scene. Loading hitch and peak-memory acceptance are unmeasured.

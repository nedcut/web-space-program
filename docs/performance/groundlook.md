# Regional flight ground appearance — round two

Branch `cx/groundlook`; runtime head `19a895da`. Merged main `ab4713ed` (mapbiomes)
in `34677a86`. Original shader baseline remains `e995b809`; round-one head was
`91e97c7c`. Nothing pushed or merged to main.

## Result and owner-visible changes

- Retains the sharper 4096×2560 Florida/Gulf/Caribbean imagery (100–60°W,
  10–35°N; about 1.09 km source samples). It is a regional improvement, not a
  global 500 m upgrade. Global monthly imagery remains outside the region.
- City footprints now soften through Natural Earth coverage, Black Marble density,
  and imagery water/vegetation colour. Roof tones blend with the source colour.
  A new original 2048px texture over 3072 game metres supplies variable parcels,
  parks, fine local streets and sparse curved arterials. Roads and buildings are
  illustrative, not surveyed. This is still a repeating 2D surface texture.
- Warm road lights are intermittent and density-weighted. The old procedural
  emission inside the region caused the detached glowing cross/square artifacts;
  that contribution is removed. Regional night brightness remains at distance.
- Rural Cape colour now actually uses the regional imagery: the old vertex water
  rejection excluded that view. Generic coarse sand/green detail is replaced by
  imagery and restrained canopy variation. The source is still blurry close up.
- Fine city detail fades with pixel footprint and from 10–16 km viewing distance;
  canopy fades from 3–10 km. Colour blends from local material over 250–750 m,
  stays fully regional to 0.12 Earth radii and fades out by 0.16 radii. Camera
  altitude fades regional shading in over 50–150 m, preserving pad material.
- Three prewarmed terrain programs avoid paying regional shader overhead at the
  pad, outside the Gulf and in orbit. Material switches add no draws. The existing
  update adds comparisons and one uniform weight, with no per-frame allocation.
  `flight/controller.ts` is the one cross-area touch: rewarm inactive programs
  after context restoration and ignore stale warmup completion.
- Asset namespace is now `gulf-v2` to invalidate the old cached city layout.
  Tracked pack totals **5,158,630 bytes (5.159 MB)**, about 1.50 MB above round one.
  Steady regional texture storage is approximately **88 MiB including mipmaps**,
  up from 67 MiB. Loading uses additional temporary textures/decoded strips.
  NASA/Natural Earth source licences and input/output hashes are in the manifest
  and `public/earth/ATTRIBUTION.md`. Low and far-only renderers skip the pack.

Main changed paths: `scripts/earth-imagery/ground.mjs`, `public/earth/imagery/packs/gulf-v2/`,
`src/render/planet/{earthGround,materials,PlanetRenderer,quadtree}.ts`, the regional
loader/imagery binding, and `src/flight/controller.ts`. See commits for exact scope.

## Production Medium GPU acceptance

**The requested approximately 1% at 10 km and maximum 2% per scene are met in
this RTX 3060 Ti run.** This does not establish M4 Pro / Zen performance.

| Scene | Baseline GPU ms | Final GPU ms | Change | Baseline / final F8 CPU ms |
| --- | ---: | ---: | ---: | ---: |
| Pad | 2.40984 | 2.40419 | −0.23% | 2.023 / 1.883 |
| 10 km ascent | 2.12710 | 2.14879 | +1.02% | 2.249 / 2.365 |
| 30 km ascent | 1.58783 | 1.60696 | +1.20% | 2.033 / 1.933 |
| Orbit | 2.02175 | 2.03475 | +0.64% | 1.597 / 1.569 |

Windows Chrome CDP on RTX 3060 Ti, frozen production build
`/home/nedcut/.t3/projects/wsp-traces/groundlook-r2-dist7`, Medium, 1470×920 CSS
pixels at DPR 2, balanced 0.70 rendering scale, adaptive off. All four cases
reported no page/console errors. The shared GPU lock serialized browser jobs;
Node tests overlapped, so CPU numbers are shared-host observations, not isolated
CPU acceptance. Do not compare this table directly to prior runs' absolute times.

`scripts/bench/groundlook/shader-ab.js` alternates the original baseline vertex
and fragment sources against the final sources in the same frozen flight scene.
Eight balanced rounds B/A/A/B/A/B/B/A each contain five timer queries of 30
full-pipeline draws: twenty samples per variant; the table reports their medians.
Each round has a 1.5 s ordinary-rendering F8 window, then 120 untimed draws to
exclude GPU clock ramp-up. CPU numbers are medians of four F8 averages per variant.
Regional assets remain resident in both cases: this measures steady shader cost,
not loading/memory differences or frame pacing. Base/detail/far retain the same
baseline shader defines needed by the original sources for a fair comparison.

Raw evidence: `C:\wsp-tools\shots\groundlook\groundlook-r2-steady7.json`.
Wrapper: `C:\wsp-tools\drv\groundlook-r2-steady-eval.js`.
Log: `/tmp/groundlook-r2-steady7.log`. Earlier numbered variants are diagnostic,
not the final acceptance run. Round one's +5.7% at 10 km was rejected.
Final commit `19a895da` only adds the global material to hidden warmup proxies;
rendered shaders/geometry are identical to the measured `724ea3da` build.

## Verification

- `npm run lint` passed: `/tmp/groundlook-r2-final-lint.log`.
- `npx tsc --noEmit` passed: `/tmp/groundlook-r2-final-tsc.log`.
- `npm run build` passed: `/tmp/groundlook-r2-build8.log` (existing chunk-size warning).
- `npx vitest run --maxWorkers=2` passed **208 files, 1,918 tests; one skipped**,
  339.37 s: `/tmp/groundlook-r2-variants-full-tests.log`. This was before the final
  one-line addition of the base warmup representative; the 17 focused tests, lint
  and build were repeated afterward (`/tmp/groundlook-r2-final-focused.log`).
- Focused loader/lifecycle/compile checks passed 17 tests. Real WebGL Float32
  transform feedback checks 16,261 Gulf positions against exact spherical UVs:
  maximum projection error **0.141 m Standard / 1.405 m Real**.
- Production browser smoke passed on `19a895da`: pad → 10 km → 30 km uses
  base/detail/far without new terrain programs; forced context restoration warms
  all three, and returning to the pad adds no programs. No page/console errors.
  Raw evidence: `C:\wsp-tools\shots\groundlook\groundlook-r2-switches3.json`;
  driver expression: `C:\wsp-tools\drv\groundlook-r2-switches.js`.
  Frozen final build: `wsp-traces/groundlook-r2-dist8`.

## Screenshot evidence

Media directory: `/mnt/c/wsp-tools/shots/groundlook/` (Windows equivalent
`C:\wsp-tools\shots\groundlook\`). Each row has `r2-before-<view>.png`
and `r2-after-<view>.png`, with identical camera/light/quality and settled global
8k plus regional assets. The baseline uses the original shader sources. Original
round-one `final-*` files remain for comparison with the rejected city rendering.

| View suffix | Scene |
| --- | --- |
| `fl-600k`, `fl-120k`, `fl-30k` | Same Florida altitude views as round one |
| `fl-8k-oblique` | Florida 7.5 km, oblique |
| `fl-1k` | Cape 1.2 km rural close view |
| `orlando-day`, `orlando-night` | Orlando 3 km |
| `orlando-1k-day`, `orlando-1k-night` | Orlando 1 km |
| `orlando-10k-day`, `orlando-10k-night` | Orlando 10 km |
| `orlando-500m-day`, `orlando-500m-night` | Additional close/detail sampling check |
| `miami-day`, `tampa-day` | Miami and Tampa 3 km |
| `dateline` | Opposite hemisphere leakage check |

Definitions: `scripts/bench/groundlook/views.json`; baseline capture log
`/tmp/groundlook-r2-before-shots.log`; final capture log
`/tmp/groundlook-r2-after7-shots.log`, with `fl-30k` replaced by the successful
`/tmp/groundlook-r2-after7-retry.log` capture (the first was interrupted by a dev
reload). All 16 final captures are ready with no page/console errors. Visual
inspection covers the softer Orlando edge, irregular warm roads without detached
crosses, filtered distant detail, retained Florida imagery and the Cape limitation
below. Browser visuals use the development planet
preview; the GPU table uses production flight. No media is committed to Git.

## Remaining acceptance and limitations

- M4 Pro, macOS Zen/Firefox, 120 Hz frame pacing, loading hitches and peak memory
  remain unmeasured. The current CPU data cannot establish CPU equivalence.
- Main's mapbiomes is integrated. capefix is not integrated in this branch; the
  Cape plateau/coast geometry remains visible and belongs to that workstream.
  In `fl-1k`, the generic sand/green noise is gone, but the image-water colour
  reveals a hard raised rim from the old plateau. Rural/coast visual acceptance
  therefore still needs capefix integration; this is not a fully resolved shoreline.
- This is static kilometre-scale imagery plus stylized 2D detail, not
  photogrammetry, real roads, or precise forest/marsh classification. Sampled
  views check 0.5, 1, 3, 10 and 30 km; they cannot prove all possible camera angles
  or every intermediate altitude is alias-free.

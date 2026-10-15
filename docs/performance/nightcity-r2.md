# Close night-city streets, round two

Baseline: `de884c28` (round one); runtime candidate: `4cffc5e7` on `cx/nightcity`.
Main was still `87b49595` when work began; `git merge main` reported up to date.
Runtime scope: `src/render/planet/{materials,earthGround,PlanetRenderer}.ts`.

## What changed

- Magnified Black Marble pixels now supply a softly filtered district envelope,
  not a luminous ground surface. The existing original irregular parcel texture
  supplies intermittent street and parcel lamps, with sodium-orange roads and
  cooler points over dark blocks. Black Marble brightness controls occupancy;
  the daytime urban polygon no longer cuts holes in nighttime detail.
- Night parcels span 6,144 playable metres, twice the daytime tile extent. This
  keeps streets readable at 10 km. The filtered detail blends back to round-one
  mapped radiance over 14–16 km surface viewing distance; the far regional shader
  and global/orbital light network retain round-one shading. Detail is illustrative,
  not surveyed streets. Existing neighbourhood reflection/offset varies repetition.
- Fully covered Gulf terrain at full night, between 750 m and 16 km viewing
  distance, uses an ambient-plus-lamps path. It preserves the full imagery water
  mask, cloud attenuation, sky light, planetshine and atmospheric haze. Global
  colour, already sampled for water, supplies the faint ambient base. It skips
  daytime canopy/roof/material calculations and direct sunlight blocked by Earth.
  Twilight, patch boundaries, daylight and distant terrain retain the ordinary
  surface path. Disabling night lights still disables lamps.
- A fourth prewarmed terrain program contains the night path. The original
  daytime program avoids its register/branch cost; the shared-program candidate
  measured +1.36% in the daylight 10 km flight fixture. One allocation-free
  camera/sun dot product selects the night program before sunset. All four
  programs participate in the existing warmup, context-restoration and disposal
  paths. This adds a compiled program; incremental cold-load cost is not measured.
- Daytime urban tiles and the round-one lake-rim fix are retained. There are no
  new textures, downloads, draws, per-frame allocations or simulation/map changes.
- Paris daytime tint is deferred: the runtime Natural Earth urban mask is Gulf-only.
  Global Black Marble radiance is not a built-up mask. A global urban asset and
  loading contract would be additional work. Close night detail outside the Gulf
  also remains round-one behaviour.

## Evidence and method

Final screenshots and raw timings:
`/mnt/c/wsp-tools/shots/nightcity/r2-accepted/` (Windows
`C:\wsp-tools\shots\nightcity\r2-accepted\`). Earlier `r2/` and `r2-final/` captures are rejected
iterations and are not final evidence.

The production preview artifact is
`/home/nedcut/.t3/projects/wsp-traces/nightcity-r2-specialized/`; it includes the ordinary app
and planet verification page with the same runtime sources as `npm run build`.
Round-one reference artifact: `../nightcity-final/`.

Chrome/RTX 3060 Ti, Medium, adaptive quality off. Preview: 1470×920, DPR 1,
Standard Earth, July, declination 20°, local noon/01:00. Same seven views as round
one: Orlando/Cape/Paris at 3 km, Florida at 10/50/150 km, Paris at 150 km. Orlando
is 28.45°N, 81.45°W; the 3 km view pitches −30°, 10/50 km −60°, orbit −90°.
Files are `{before,after}-{orlando,cape,paris,florida10,florida50,florida-orbit,paris-orbit}-{day,night}.png`.

Each same-scene shader A/B uses eight balanced B/A/A/B/A/B/B/A rounds, 120 warmup
renders after each swap, then five GPU timer queries of 30 full-pipeline renders.
Tables report medians of 20 samples per version, in milliseconds. Disjoint or
unavailable queries fail the run. Reverse source patches are generated against
`de884c28`; a separate loaded round-one artifact checks exact reconstructed shader
sources. All browser drivers run serially under `/tmp/wsp-gpu.lock`.

Full-flight fixtures retain the round-one method: 1470×920 CSS, DPR 2, frozen stock
Kestrel, orbit-assist climbs to 10/50 km. Midnight fixtures move the body-fixed
vessel to its lowest solar elevation and point the camera toward Earth. These are
GPU throughput measurements, not sustained 120 Hz frame pacing measurements.

Drivers: `C:\wsp-tools\drv\nightcity-r2-accepted.mjs`, `nightcity-r2-specialized-patch.json`,
`nightcity-r2-specialized-flight-eval.js`, `nightcity-midnight.mjs`, `nightcity-r2-accepted-validate.mjs`,
and `C:\wsp-tools\drv-ff\nightcity-r2-accepted.mjs`.

Mac M-series/macOS Zen performance and sustained 120 Hz remain unverified.

## Repository checks

- `npm run lint`: passed, including the 77-module simulation boundary check.
- `npx tsc --noEmit`: passed.
- `npx vitest run --maxWorkers=2`: 208 files passed; 1,936 tests passed,
  one skipped; 500.89 seconds, clean exit 0. This final run uses the four-program
  implementation. An earlier run reported the same passes but its shell exited
  143 after the summary; the clean final run supersedes it.
- `npm run build`: passed, with the existing bundle-size warning.
- Logs: `/tmp/nightcity-r2-accepted-{lint,tsc,build}.log` and
  `/tmp/nightcity-r2-tests-specialized.log`.

## Production preview GPU milliseconds

| View | Day before → after | Night before → after |
| --- | ---: | ---: |
| orlando | 1.1088 → 1.1087 (-0.00%) | 1.1624 → 1.0541 (-9.32%) |
| cape | 1.3363 → 1.3389 (+0.19%) | 1.3202 → 1.1530 (-12.67%) |
| paris | 1.0161 → 1.0166 (+0.05%) | 1.2993 → 1.2979 (-0.11%) |
| florida10 | 0.8869 → 0.8834 (-0.40%) | 0.9421 → 0.9016 (-4.30%) |
| florida50 | 1.0158 → 1.0118 (-0.39%) | 1.0713 → 1.0709 (-0.04%) |
| florida-orbit | 1.1086 → 1.1059 (-0.25%) | 1.1065 → 1.1048 (-0.15%) |
| paris-orbit | 1.1131 → 1.1132 (+0.01%) | 1.1319 → 1.1322 (+0.02%) |

## Full-flight GPU milliseconds

| Scene | Day before → after | Midnight before → after |
| --- | ---: | ---: |
| pad | 2.4560 → 2.4551 (-0.04%) | 2.0865 → 2.0880 (+0.07%) |
| climb10 | 2.0565 → 2.0593 (+0.13%) | 2.0143 → 1.8708 (-7.12%) |
| climb50 | 1.4666 → 1.4734 (+0.47%) | 1.8339 → 1.8523 (+1.01%) |
| orbit | 1.9949 → 2.0034 (+0.43%) | 2.0560 → 2.0497 (-0.31%) |

All 14 preview and eight flight cases produced valid GPU samples and GL error 0.
The initial preview request logged one resource 404; subsequent previews and all
flight cases had no page/console errors. `near.json`, `far.json`, `flight-day.json`,
and `flight-night.json` retain every raw sample.

Baseline validation matched all 12 reconstructed fragment shader sources exactly
to the separate round-one artifact. `validation.json` records no errors.

Firefox passed Orlando 3 km day, 3 km night, 10 km night, and Florida 50 km
night, with 8K imagery, GL error 0 and no page/console errors (`firefox.json`).
This is shader compatibility evidence; it does not measure Mac/Zen performance.

## Control repeat, preservation, and restoration

The +1.01% 50 km midnight flight result did not reproduce: the independent repeat
measured **1.8354 → 1.8343 ms (−0.06%)**, with GL error 0 and no console/page errors
(`night50-repeat.json`). The original result remains in the table. The distant
shader path is unchanged; these results support no reproducible Medium GPU
regression on this machine, rather than a claim of exact zero cost on all hardware.

Pixel comparisons (`pixels.json`) show identical before/after pixels for Florida
50 km and both orbital views, day and night. Orlando daytime differs by at most
one 8-bit channel level. Orlando lake (995,525) and Cape lagoon (1050,873) remain
RGB 0/0/0 at night. The close 3 km and 10 km captures show dark blocks and resolved
street/point lighting in place of the magnified tan wash.

The fourth program is prewarmed before use and after forced WebGL context loss.
`restore-current.json` records four terrain representatives, one compiled night
program before and after recovery, warmup completed, three fresh frames with
GL error 0, and resumed rendering with GL error 0. The round-one control has
three representatives and likewise recovers (`restore-baseline.json`). Both
leave a pending `INVALID_OPERATION` (1282) during forced recovery, then render
cleanly after it is drained. This is an existing transient diagnostic, not a new
night-program failure; its underlying source was not investigated further.

Restoration driver: `C:\wsp-tools\drv\nightcity-r2-restore-control-eval.js`.
Additional artifacts include `no-bloom-orlando-night.png` and
`no-lights-orlando-night.png`. No browser profiles or preview servers are left
running by this task.

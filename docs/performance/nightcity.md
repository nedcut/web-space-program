# Flight Earth city and lake polish

Close-night follow-up: [round two](nightcity-r2.md) supersedes the close-detail
limitation below; this document retains the round-one distant/day/lake evidence.

Base: `87b49595`, branch `cx/nightcity`. Runtime changes are confined to
`src/render/planet/{materials,earthGround}.ts`. No map, simulation, data, asset,
worker, loading, draw-count or frame-allocation changes.

## Visible changes and decisions

- Black Marble supplies the nighttime network, cores and suburban falloff. Loaded
  imagery no longer gets the unrelated procedural street grid or repeating tiled
  lamps. Regional and global emission use the same warm-to-cream intensity curve.
  A restrained near-field gain (0.22) rises smoothly to 2.0 between 10 and 60 km
  viewing distance; the previous global gain was 1.6, while the regional diffuse
  gain was only about 0.023–0.052. These are art exposure controls, not calibrated
  radiance. The initial constant gain of 2.4 was rejected after it overexposed
  magnified city pixels.
- Daytime neighbourhoods reflect and offset the existing tile independently and
  reduce its overlay strength to 65%. Explicit texture gradients keep filtering
  stable across tile boundaries. Mapped urban density remains authoritative.
- The lake rims/fill were the ocean seabed term, not regional imagery. Negative
  mesh depth was clamped to zero, giving maximal sand colour where imagery put
  water over a dry mesh. Seabed and foam now require positive physical water depth;
  resolved seabed colour fades over the existing 200–2,000 m wave-detail range.
  Surface geometry, masks, sky reflection and the no-city-emission ocean remain.
  A separate check caught coastal pixels lit by the terrain's **distance-faded**
  water weight. Emission now uses the full sampled water mask, reusing the same
  sample/coast calculation and leaving daylight's distance blend unchanged.
- No new source data: existing public-domain NASA/Natural Earth provenance and
  imagery manifests are unchanged. The fine daytime parcel texture is illustrative.
  Black Marble resolution limits still show at low altitude, particularly outside
  the Gulf pack; this does not create surveyed streets or buildings.

## Method and artifacts

Media/raw measurements: `C:\wsp-tools\shots\nightcity\`
(`/mnt/c/wsp-tools/shots/nightcity/`). Final acceptance is in its `accepted/`
subdirectory. Production artifacts:
`/home/nedcut/.t3/projects/wsp-traces/nightcity-{baseline,final}/`.
The current artifact includes the ordinary app and the planet verification page;
its runtime sources are identical to the normal `npm run build` output.

Windows Chrome 155, RTX 3060 Ti, Medium, adaptive quality off. Shader A/B runs
swap exact baseline/current fragment sources in the **same frozen, resident
scene**, with eight balanced B/A/A/B/A/B/B/A rounds. Each swap receives 120 warmup
draws; each round measures five GPU timer queries of 30 full-pipeline draws.
Reported medians contain 20 samples per variant. Queries reject disjoint or
unavailable results. Reverse patches reconstruct both baseline source files
exactly; no template substitutions occur inside patch strings.

Preview screenshots: 1470×920, DPR 1, Standard scale, July imagery, solar
declination 20°, local time noon or 01:00. Files:
`{before,after}-{orlando,cape,paris,florida10,florida50,florida-orbit,paris-orbit}-{day,night}.png`.
The first three are at 3 km altitude / −30° pitch, the next two at 10/50 km /
−60°, orbit at 150 km / −90°. Orlando: 28.45°N, 81.45°W; Cape: 28.5°N,
80.83°W (heading east); Paris: 48.85°N, 2.35°E. Other headings north.
Each capture waits for terrain ready, global 8k and another 15 seconds.

Drivers: `C:\wsp-tools\drv\nightcity-accepted.mjs`, `nightcity-patch.json`,
`nightcity-flight-eval.js`, `nightcity-midnight.mjs`, `nightcity-flight-pair.mjs` (same flight fixtures in day and night),
`nightcity-check-final.mjs`, and `C:\wsp-tools\drv-ff\nightcity-final.mjs`. Commands use `flock /tmp/wsp-gpu.lock`
with `timeout 600` **inside** the lock. No simultaneous GPU runs.

## Verification

- `npm run lint`: passed; simulation boundary checks passed (77 modules).
- `npx tsc --noEmit`: passed.
- `npx vitest run --maxWorkers=2`: 208 files passed, 1,936 tests passed, one skipped
  (315.19 seconds; a repeat under concurrent machine load also passed in
  865.86 seconds). After the final mask adjustment, the two material suites passed
  again: 30 tests.
- `npm run build`: passed; existing bundle-size warning.
- Logs: `/tmp/nightcity-{lint,tsc,tests,tests-final,material-tests,build}.log`.

## Production preview GPU times

| View | Day before → after (ms) | Night before → after (ms) |
| --- | ---: | ---: |
| orlando | 1.1350 → 1.1096 (-2.24%) | 1.1898 → 1.1739 (-1.34%) |
| cape | 1.3609 → 1.3457 (-1.12%) | 1.3382 → 1.3220 (-1.21%) |
| paris | 1.0409 → 1.0225 (-1.77%) | 1.6398 → 1.2980 (-20.85%) |
| florida10 | 0.8973 → 0.8844 (-1.45%) | 0.9547 → 0.9430 (-1.23%) |
| florida50 | 1.0348 → 1.0214 (-1.30%) | 1.0892 → 1.0819 (-0.67%) |
| florida-orbit | 1.1026 → 1.0980 (-0.41%) | 1.1037 → 1.1079 (+0.38%) |
| paris-orbit | 1.1216 → 1.1103 (-1.01%) | 1.1364 → 1.1315 (-0.43%) |

`accepted/final.json` contains all 14 final-build cases and raw samples. All GL errors were zero;
one initial preview request logged a resource 404, with no shader or runtime
errors. Other final preview cases logged no errors. The earlier parent-directory `quick.json` and `final.json`
are superseded candidates, not final acceptance evidence.

The largest increase is 0.38%, within measurement noise. Removing procedural
street shading saves substantially more in the close Paris night view. These
measurements support no measurable Medium regression on this GPU; they do not
establish M-series Mac/Zen performance or 120 Hz frame pacing.

Pixel checks (`pixels.json`): Orlando lake centre (995,525) and Cape lagoon
(1050,873) remain RGB 0/0/0 at night. Nearby city pixels rise from 23/14/5 to
135/117/92 (Orlando) and 21/13/4 to 130/112/87 (Cape). Orlando lake daytime
107/158/159 becomes 59/120/139; Cape lagoon 98/152/152 becomes 54/115/131.

The additional water-mask correction removes the rejected candidate's coastal
emission at (1371,406), RGB 88/66/41 → 0/0/0, and (922,239), 60/39/18 → 0/0/0.
It uses the existing global water/coast calculation without another texture fetch.
With bloom and SMAA disabled, the ambiguous shoreline pixel (1114,312) is also
0/0/0. The surface-family diagnostic (`surface-mask.png`) identifies it and the
lake centre as ocean pixels; the faint colour in the normal image is edge
antialiasing from neighbouring lit land, not surface emission. Disabling city
lights leaves both water pixels unchanged and turns the nearby city sample black.
`validation.json` confirms all 12 reconstructed baseline shader sources exactly
match the separately built baseline runtime, with no errors.

## Full-flight GPU times

1470×920 CSS, DPR 2 (2940×1840 output), Medium, adaptive off, frozen stock Kestrel
flight scenes. 10/50 km fixtures use the orbit assist ascent, paused at altitude.
The daylight run uses the ordinary flight camera. Midnight fixtures advance the
body-fixed vessel to its lowest solar elevation over one body rotation and pitch
the camera toward Earth; baseline/current use the same resulting frozen scene.
The earlier half-rotation night fixtures landed near dawn and the orbital camera
faced away from Earth; they are not night acceptance evidence.

Daylight measurements (`flight-final.json`):

| Scene | Before (ms) | After (ms) | Change |
| --- | ---: | ---: | ---: |
| pad | 2.4275 | 2.4409 | +0.55% |
| climb10 | 2.0761 | 2.0626 | -0.65% |
| climb50 | 1.4766 | 1.4650 | -0.79% |
| orbit | 2.0087 | 1.9952 | -0.68% |

Midnight measurements (`flight-midnight.json`), solar elevation about −45.5°:

| Scene | Before (ms) | After (ms) | Change |
| --- | ---: | ---: | ---: |
| pad | 2.1072 | 2.0887 | -0.88% |
| climb10 | 2.0149 | 2.0183 | +0.17% |
| climb50 | 1.8398 | 1.8367 | -0.17% |
| orbit | 2.0407 | 2.0413 | +0.03% |

All eight daylight/midnight flight cases have valid GPU samples and no console,
page or GL errors. The largest increase is +0.55% (0.0134 ms) at the daylight pad;
there is no measured regression above 1% on this GPU. The midnight runner saved
all four cases and screenshots, then its shell returned SIGTERM during teardown;
the recorded measurements are complete. Logs: `/tmp/nightcity-flight-final.log`
and `/tmp/nightcity-midnight.log`.

Firefox 143 on Windows passed all four final production smoke cases: Orlando
3 km daytime, Orlando 500 m daytime, Florida 50 km night and Paris 50 km night.
All loaded 8K imagery, with no page/console errors and GL error 0. Evidence:
`firefox.json` and `/tmp/nightcity-firefox-clean.log`; runner exited successfully.
The isolated test profile disables service workers to prevent the previously
registered navigation fallback from routing preview fixtures to the main app.
This is shader compatibility evidence, not a service-worker acceptance test.

Mac M-series, macOS Zen and sustained 120 Hz remain unverified. Close-up night
structure remains limited by the source Black Marble resolution.

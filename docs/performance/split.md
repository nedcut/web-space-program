# Map and flight collaborators (round 2)

`op/split2` starts from main `0f8fef3a`, including the docking-mode fix. Round 1
(`op/split`) is reference material only; none of its implementation bridges was copied.
This is the smaller responsibility split allowed by the round-two brief. Public map
contracts remain re-exported from `MapView.ts` and flight/HUD entry points stay intact.

## Module map

Paths are relative to `src/`. State listed below is private to the collaborator;
none receives a `MapView` or `FlightController` reference.

| File | Owned state | API | Lines |
| --- | --- | --- | ---: |
| `flight/controller/FlightLighting.ts` | Sun, ambient and night lights; stars, glare, sky environment; shadow cache and scratch vectors | `placeSun`, `update`, `setQuality`, `invalidate`, `updateShadows`, `dispose` | 143 |
| `flight/controller/FlightCameraRig.ts` | Pivot smoothing, liftoff/touchdown history, tower anchor and obstruction raycaster, framing scratch | `update`, diagnostic `towerPickMs` | 188 |
| `render/map/MapFrame.ts` | Projection scratch; explicit catalog, ephemeris and camera dependencies | `scenePosition`, `toScreen`, `patchFrameTime`, `framedBodyPosition` | 63 |
| `render/map/MapLines.ts` | Line material registry, shared uniforms, trajectory snapshots/version, landing and communications buffers | Line creation/removal, resize/frame/occluder updates, trajectory/landing/comms updates; read-only trajectory version | 232 |
| `render/map/MapMarkers.ts` | Orbit marker cache, DOM/position/caption pools, pins, approach geometry and scratch | `update`, `pick`, `tooltip`, `menu`, `togglePin`, `setApproach`, `setWarmup` | 233 |
| `render/map/mapTypes.ts` | None; original input/event contracts moved unchanged | Map data types | 85 |
| `flight/controller.ts` | Simulation/input orchestration, view lifecycle, FX/event routing, telemetry and public commands | Existing public controller API | 1409 |
| `render/map/MapView.ts` | Bodies/fleet, camera gestures, node dragging/gizmo and update/disposal ordering | Existing public map API | 1410 |

The two original files total 3,587 lines; the resulting runtime modules total 3,763:
**net +176 lines (4.9%)**. This is above the approximate +150-line guide, and both
owners remain above 1,000 lines. These limits are reported explicitly rather than
met by moving orchestration into methods with access to the entire owner.

No new `this:` functions, owner mirror types, double casts, prototype installation,
or owner-bound extracted functions were introduced. The pre-existing
`FlightControllerInternals` bridge for assist/audio/navball/scenarios/telemetry is
unchanged. New hot-path arguments are existing objects or scalars; no frame contexts
are allocated. The sun direction now uses collaborator-owned scratch instead of a
new vector per frame. Camera drive input remains the same stable input object.

## Seams retained deliberately

- **Map camera gestures and node gizmo:** they share pointer capture, drag offsets,
  hover priority, node time sliding, zoom anchors, selected-node state and HUD
  obstacle reservations. Extracting these together needs a separate interaction
  design; splitting individual methods would recreate round one's shared owner.
- **Map bodies/fleet:** sphere/icon picking, orbital highlights, planet resources,
  surface overlays and label priority still operate on the same body visuals.
  Marker captions own their boxes and append them to the existing frame's accepted
  label list. Nodes still reserve HUD space before markers, then surface labels run.
- **Flight FX/events/lifecycle:** event feedback reads donor part visuals before
  vessel removal, camera kicks precede burst effects, active-loss replay follows
  debris, and thermal heat feeds camera/audio/telemetry. This round preserves that
  ordering in the controller rather than adding a wide FX context.
- **Telemetry, commands and scenario helpers:** existing authority and public HUD
  adapters remain in place. Moving a handful of publisher fields alone would add
  another forwarding API without substantially simplifying their current coupling.

## Verification

The source audit compares parsed method bodies against `0f8fef3a`, ignoring only
comments/formatting and enumerated receiver/argument renames. It matches 14 extracted
method bodies, both extracted lighting blocks and 101 retained bodies. Constructors
and frame integration are reviewed separately; this is not a claim of automatic equivalence for the whole
program. No tests or assertions were changed. Five existing benchmark diagnostics
were updated to read the relocated private lighting/trajectory state:
`cpu2-draws.mjs`, `gfxsettings-check.mjs`, `partsart.mjs`, `knobs/site.js` and
`check-nbody-browser.mjs`. All five pass `node --check`, and lint passes after the
updates. Their benchmark procedures were not otherwise changed.

Focused map checks: 27 tests across presentation, maneuver interaction and zoom passed.
- `npm run lint`: passed, including simulation layering across 77 modules.
- `npx tsc --noEmit`: passed.
- `npx vitest run --maxWorkers=2`: 214 files passed; 2,000 tests passed and one skipped
  (482.17 seconds).
- `npm run build`: passed.
- `git diff --check`: passed.

Evidence directory: `/home/nedcut/.t3/projects/wsp-traces/split2/`.
The paired CDP harness is adapted from round one; only its artifact paths and the moved
projection helper access changed. Both builds use the same main baseline and public
assets. `build-identity.json` verifies both HTML entries and all 85 hashed assets per
build in the shared preview directory.

## Browser lifecycle and lighting checks

Production CDP Chrome, Windows/RTX 3060 Ti, Medium, 1600×900. Both baseline and
candidate pass the same driver (`split2-flight-smoke.mjs`):

- Enter tower mode on Selene's pad; the eye stays finite and the mode remains tower.
- Move the paused orbit fixture behind Earth, using actual planet occlusion. Sun
  intensity is 0; night vision changes fill 0.12 → 1.52 and headlight 0 → 2.2 in both
  builds. The sky environment remains present.
- Force main-renderer WebGL loss/restoration. Both restore the environment and night
  lights and increment the shadow cache's rendered count on restoration (24 → 25
  before, 25 → 26 after). Warm-up completes; no page errors occur.

`C:\wsp-tools\shots\split2\{before,after}-{tower,night,restored}.png` and
`flight-smoke.json` contain the evidence. The tower view still leaves Selene partly
behind the gantry in **both** builds; this pre-existing presentation issue was not
changed. These checks do not establish pixel identity: scene time, camera easing and
imagery streaming differ between captures.

The final rebuild is byte-identical to the staged candidate in all 149 files
(`final-build-identity.json`). Both served HTML entries and 85 hashed assets per build
also match their saved builds over HTTP (`served-build-identity.json`).

## Paired browser CPU and interactions

`split2-paired-direct.mjs` completed successfully under `/tmp/wsp-gpu.lock` in one
process, in baseline/candidate/baseline/candidate order. Each sample uses a fresh
browser context, the same Medium settings and stock Selene route, then 12 seconds
of collection. The table reports the final 240-frame ring buffer, about four seconds
at the observed 60 Hz. Map is the orbit scenario; ascent uses the orbit assist and
reaches about 1.73–1.74 km altitude. F8 instrumentation is enabled in both builds.

| Pair / route | Mean CPU ms before → after | CPU p95 ms before → after | Draws before → after | GPU ms before → after |
| --- | ---: | ---: | ---: | ---: |
| 1 / map | 1.250 → 1.060 | 1.8 → 1.5 | 20 → 20 | 0.150 → 0.145 |
| 1 / ascent | 2.460 → 4.142 | 3.6 → 6.7 | 120 → 120 | 1.624 → 1.611 |
| 2 / map | 1.805 → 1.764 | 2.7 → 2.5 | 20 → 20 | 0.155 → 0.156 |
| 2 / ascent | 4.217 → 3.997 | 6.6 → 6.2 | 120 → 120 | 1.627 → 1.703 |

These data **do not establish CPU performance parity**. The first ascent pair is
68.4% slower after; the second is 5.2% faster. Baseline CPU itself rises substantially
between pairs, including unchanged simulation and render sections. Six concurrent
career simulations were observed consuming roughly 120–127% CPU each during the
later samples (`concurrent-cpu-load.txt`); shared-host CPU contention is a plausible
confounder, despite exclusive browser/GPU access. A quiet-host comparison remains
necessary to resolve small regressions. No claim of improvement is made. GPU values
are the pipeline's smoothed timer readings at capture, not fenced paired GPU means.

All eight recorded windows have zero >25 ms or >50 ms frame hitches, frame p95 of
16.7–16.8 ms and no page errors. Draw counts are unchanged. An earlier interrupted
run lost lock ownership and is excluded entirely; its files live under `interrupted/`.
The completed run's raw rows and arithmetic are in `perf-pairs.log` and
`perf-summary.json`; screenshots are under `C:\wsp-tools\shots\split2\` with
`before-pair1`, `after`, `before-pair2` and `after-pair2` prefixes.

The candidate additionally passes actual mouse/keyboard interaction checks: create a
maneuver node, drag its prograde handle, slide its time, increment prograde with the
keyboard, delete it, pin a periapsis marker, open its context menu, zoom, and retain
Earth focus. The prograde drag gives 1.213 m/s, the time slide moves 54.162 seconds,
and the keyboard increment gives 2.213 m/s. Flight exit disposes the controller and
returns to the hub without a page error. These assertions and captures are in
`after.json`, `after-node.png`, `after-pin.png`, `after-zoom.png` and `after-exit.png`.

No intentional player-visible behavior changed. Remaining evidence gaps are a
quiet-host CPU comparison, M-series/macOS, Zen/Firefox, and 120 Hz; this Windows
Chrome/RTX 3060 Ti run does not verify them.

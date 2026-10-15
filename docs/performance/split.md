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
program. No tests or assertions were changed.

Focused map checks: 27 tests across presentation, maneuver interaction and zoom passed.
- `npm run lint`: passed, including simulation layering across 77 modules.
- `npx tsc --noEmit`: passed.
- `npx vitest run --maxWorkers=2`: 214 files passed; 2,000 tests passed and one skipped
  (482.17 seconds).
- `npm run build`: passed.
- `git diff --check`: passed.

Browser results are recorded below after completion.

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

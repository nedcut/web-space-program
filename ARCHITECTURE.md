# Web Space Program — Architecture

An original, browser-based spaceflight sandbox in the spirit of KSP, set in the real solar system.
**No KSP assets, names, or text may be used.** All parts, art, and names are original.

## Stack
- TypeScript (strict), Vite, React 19 (UI overlays only — never in the per-frame render path), three.js (WebGL2), Vitest.
- PWA (offline) via vite-plugin-pwa.
- Path alias: `@/` → `src/`.

## Module layout and dependency direction

| Layer | Modules and responsibilities | Dependencies |
| --- | --- | --- |
| `util/` | Float64 vectors/quaternions, optimization, snapshot comparison, pure display formatting | No application layers |
| `sim/` | Headless deterministic physics and explicit inputs | `sim`, `util`; static body catalog exception below |
| `data/` | Bodies, resources, parts, EVA, research and encyclopedia content | `sim` types, `util`, other static data |
| `game/` | Universe/environment adapter, mutable World, rails/warp, planners, science/comms adapters, persistence and program/store | `sim`, `data`, `util`; store uses React for subscriptions |
| `render/` | three.js scenes, shaders, workers, terrain and part geometry | `sim`, `data`, `util`; legacy settings exceptions below |
| `editor/` | Assembly core, stock craft, editor session, hangar and React panels | `sim`, `data`, `util`, `render`, `game` |
| `input/`, `audio/` | Bindings/gamepad and procedural browser sound | Application settings and headless types |
| `net/`, `server/` | Shared protocol/snapshots, browser multiplayer client/UI, Node/ws authoritative rooms | `sim`, `game`, `data`, `util`; server does not use browser scenes |
| `flight/`, `tutorial/`, `scenarios/`, `ui/`, `main.tsx` | Scene orchestration, frame loop/HUD, isolated practice lessons, hub/tracking/pedia and application routing | Compose lower layers |

`src/sim` stays DOM-free and three.js-free so physics runs in Node tests and the authoritative server.
`npm run lint` enforces restricted imports/browser globals; `scripts/check-layering.mjs` resolves relative and
`@/` imports, re-exports and literal dynamic imports to verify the sim boundary. The existing
`sim/bodies/index.ts` convenience facade imports/re-exports `data/bodies.ts` to implement `createUniverse`.
This is the sole documented sim → data exception; the catalog itself imports sim types only. Core scaling
is independent of the catalog in `sim/bodies/scale.ts`.

Known direction violations: `render/core/quality.ts`, `render/parts/plume.ts` and `render/vessel/ReentryFx.ts`
read `game/store.ts` for current settings. These remain explicit debt; callers should eventually supply
settings rather than render code reading the application store. Pure formatting now lives in `util/format.ts`
with a compatibility re-export from `ui/format.ts`, and `FlagView` accepts a structural scene input rather
than importing `World`. `LaunchSite` already follows that structural-input pattern.

### Simulation modules

- `sim/bodies`: body definitions/types, scale presets and pure scaling; `sim/orbit`: ephemerides, Kepler/Lambert,
  patched conics, SOI transitions, targeting/maneuvers and prediction readouts.
- `sim/terrain`: shared seeded terrain/noise/craters and body presets; `sim/atmosphere`: atmospheric sampling.
- `sim/vessel`: assembly/topology, staging, mass/inertia, resource crossfeed/power, engines/RCS, SAS,
  aero/heating, wheels/contact, rigid integration, docking, EVA and analytic ISRU. `tweaks.ts` holds per-part player
  settings and their descriptors/validation; `actions.ts` holds part actions, action groups and the one-shot
  `ControlInput.commands` applied by the authority (World / multiplayer room). UI for both lives in `ui/inspector`
  (shared floating panels), `editor/ui/{PartInspector,ActionGroupsPanel}` and `flight/hud/PartInspector`.
- `sim/hazards`: pressure ratings/overload, equipment heat soak, dipole-like radiation dose and Sun occlusion; `game/world/hazards.ts` integrates packed exposure and roster dose.
- `sim/comms/network.ts`: range/occlusion/relay routing; `sim/science`: biomes, experiments and progression;
  `sim/resources/deposits.ts`: deterministic concentrations; `sim/crew/crew.ts`: roster/seats/control authority.

### Application and rendering modules

- `game/world.ts` remains the public World/types/physics-clock facade. `game/world/launch.ts` owns pad/runway
  placement and spawning; `crew.ts` owns roster/EVA/boarding/flags; `rails.ts` owns packing, propagation and
  body-fixed synchronization; `docking.ts` owns fleet merges/splits; `resources.ts` owns survey/concentration
  hooks; `progression.ts` and `readouts.ts` adapt science/program operations and orbital/surface readouts.
  Stable `internals.ts` contexts expose only the private operations/state these helpers need; World remains
  the sole state owner. `game/science.ts`, `comms.ts`, `flightData.ts`, `interplanetary.ts` and `autopilot.ts`
  adapt pure sim functions. Persistence/program/saveSlots own world snapshots and program save slots; saves owns the IndexedDB craft library and legacy migration. craftSharing validates offline craft imports; photoMode coordinates scene-local photo cameras and the optional depth blur pass.
- `flight/controller.ts` owns scene setup, input, fixed-step driving, rendering and disposal.
  `flight/controller/{telemetry,navball,scenarios,assist,audio}.ts` contain the respective drivers with a stable
  private context. `flight/assist.ts`, `camera.ts`, `input.ts`, `planets.ts` and `hud/` provide focused adapters.
- `data/parts.ts` preserves the public catalog API. `data/parts/` contains category arrays and shared builders;
  the facade concatenates them in the original order, including expansion and the separate `data/isru.ts`.
  IDs, generated definitions and catalog order must remain stable across refactors.
- `render/core`: pipeline, adaptive resolution, camera helpers and quality; `render/planet`: renderer,
  atmosphere/effects, cube-sphere quadtree, worker-built chunks, textures and rings. `planet/scatter/` streams
  deterministic render-only decoration. `render/site`: launch complex/aerial/textures; `render/sky`: stars and
  sun glare; `render/map`: conics/markers/gizmos; `render/vessel`: vessel meshes, flags and re-entry effects;
  `render/parts/builders`: category geometry and expedition/ISRU hardware.
- `net/protocol.ts` and `snapshots.ts` define transport, `net/client.ts` predicts/reconciles owned vessels;
  `server/{index,server,room}.ts` owns room lifetime, control ownership, launch queues and authoritative ticks.
- `tutorial/{lessons,runtime,Training,TutorialPanel}` defines isolated practice worlds, goals and mentor UI;
  `input/{bindings,gamepad}` supplies persistent physical-key maps and gamepad actions.
- `src/dev/{partsPreview,planetPreview,mapPreview}.ts` and their root HTML pages are live dev entry points.
  `knip.json` includes them, tests, workers and benchmark/browser scripts so dead-code audits retain tooling.
  `npm run check:unused` is an audit report: exported sim contracts/barrel APIs can be reported even when
  useful as public interfaces; inspect call sites before deleting them.

## Coordinates & precision
- Sim: float64 everywhere. Inertial frame = ecliptic J2000, origin at Sun centre, +Z ecliptic north. Time = seconds since J2000 ("UT").
- Body-fixed frame: +Z north pole, +X prime meridian; rotation via `bodyRotation(body, t)`.
- Render: **floating origin**. Each frame the camera's focus (active vessel or focused body) is the origin; all
  positions are converted `(simPos - origin)` in float64 and then cast to float32. Use `logarithmicDepthBuffer`
  plus multi-frustum or depth tricks for planets far away. Never put raw solar-system coordinates in a Float32Array.

## Scale (DECISIONS D-003)
Real-world data in `src/data/bodies.ts` is the source of truth. `buildUniverse(defs, scaleConfig)` derives the
playable universe. Presets: `standard` (s=0.1, default), `challenging` (0.32), `real` (1).

## Simulation model
- **Bodies**: on rails (Keplerian elements around parent). Ephemeris: `getBodyState(id, t)` composes parent chain.
- **Vessels**: two modes
  - *On rails*: Keplerian propagation in the current SOI (no thrust, outside atmosphere, not landed). Time warp up to 100000x.
  - *Physics*: rigid body integration at fixed dt = 1/50 s (substepping allowed), forces = gravity (dominant body;
    optional n-body perturbation from all bodies), thrust, aero (drag, lift, Mach effects), contact.
- **Vessel rigidity (improvement over KSP)**: a vessel is a single rigid body with mass/COM/inertia recomputed
  when resources drain or parts detach. No joint wobble, no "Kraken". Structural failure modelled by per-joint load
  checks (break if aero/inertial load exceeds joint strength) rather than spring joints.
- **Patched conics** for trajectory prediction & map view; maneuver nodes in prograde/normal/radial.
- **Determinism**: sim step is a pure function of (state, inputs, dt). Inputs are explicit structs — this is the
  foundation for multiplayer later.

## Rendering goals
- Physically-based atmospheric scattering (Rayleigh + Mie, precomputed or single-scatter in shader) per body.
- Cube-sphere quadtree LOD terrain using the shared deterministic `heightAt` from `src/sim/terrain`.
- Saturn rings with proper shadows, rings shading by sun angle; gas giant banded procedural shaders.
- HDR + ACES/AgX tonemapping + bloom; starfield; sun glare.
- Quality presets (Low/Med/High) so it runs on integrated laptop GPUs.

## Module contracts
- `src/sim/orbit/api.ts` — StateVector, Orbit, TrajectoryPatch, ManeuverNode.
- `src/sim/terrain/api.ts` — TerrainHeightFn (body-fixed unit vector → height m).
- `src/sim/atmosphere/api.ts` — AtmosphereSample.
- `src/sim/bodies/types.ts` — BodyDef/Body; `scale.ts` — scaling.
- `src/sim/vessel/types.ts` — PartDef, PartInstance, CraftDef, modules.

## Conventions
- No `any` without a comment. Prefer plain functions + data over class hierarchies in sim.
- Every sim module gets Vitest tests in `tests/` checking physics against known real values.
- Respect assigned worktree/branch scope. Commit only when the owner requests it; report cross-area changes.


## Science and program progression

- `src/sim/science/biomes.ts`: deterministic body-fixed terrain classification and six science situations. `biomeAt(body, universe.terrain(id), direction)` shares collision/render terrain; no dependency on `Universe`, the DOM or three.js.
- `src/sim/science/experiments.ts`: experiment definitions, subject keys and diminishing values. `progression.ts`: serializable mode, balances, archives, research IDs, seeded contracts and event reducer.
- `src/data/technology.ts`: 25 named nodes; every catalogue part belongs to one node. Category families are sorted by cost then ID into four tiers, with an explicit starter set. Catalogue additions can shift tiers and should be reviewed for progression balance.
- `World` owns mutable progression. `src/game/science.ts` adapts universe/vessel state to the pure science model; `World` exposes experiment, transmission, research, contract and recovery operations. Part-owned data and expedition provenance survive staging, docking and save/load. `PartState.purchaseCost` prevents salvage of unpaid scenario/EVA hardware.
- Scene boundaries pass immutable `SavedWorld` snapshots through `game.resumeWorld`; `game.mode` drives UI. `openProgram/saveProgram` handle hub research/mission mutations and autosaves. Physics and rails evaluate progression; UI never awards rewards independently. Flight, tracking recovery, and automatic pad clearance share settlement logic.

## Asynchronous transfer planning

`game/planning/transfers.ts` holds the headless transfer algorithms, re-exported from `game/autopilot.ts`
for existing synchronous callers. `PlanningWorld` is the minimal structural input shared by World and the
snapshot adapter; neither the worker nor its algorithms import the World implementation, React or three.js.
`planningSnapshot` captures the universe preset, UT, vessel ID/body/relative state/osculating orbit and nodes.
The worker rebuilds its own Universe and temporary node allocator. Typed request IDs correlate progress,
porkchop rows, results, errors and cancellations. Each async request owns a worker, and cancellation terminates
it even during synchronous refinement. Node/no-Worker callers use the same handler asynchronously in-process;
only row boundaries and pre-start work yield there. UI hooks cancel on supersession/unmount. Results are
applied explicitly with fresh World node IDs, after rejecting stale vessel/trajectory/node-list changes.
## Quick-start scenarios

`scenarios/catalog.ts` defines original mission briefings, stock-payload setup and medal budgets.
`evaluation.ts` adapts the assigned World vessel to observations and reduces objective/scoring state;
`runtime.ts` owns the isolated run and prior program snapshot, and `records.ts` owns validated browser bests.
The Scenarios library and ScenarioPanel compose briefing, live objectives, retry and debrief UI.
World’s optional `onSimulationStep` observes both physics and rails; physics reports the integrator’s
substep engine/RCS impulse-per-mass cost. This observer never changes the underlying force model.

## Optional precise gravity

`World.preciseGravity` is an optional per-save setting, off by default. `sim/orbit/nbody.ts` supplies cached all-source differential gravity in translating dominant-body frames; `adaptive.ts` implements controlled RK45. `game/world/preciseRails.ts` commits fleet-wide accepted steps under a frame budget and reduces warp instead of skipping time. `numericalPrediction.ts` incrementally produces Float64 sampled patches with impulsive nodes and distance minima; MapView draws these as polylines. `World.trajectory()` deliberately stays patched-conic for planners; `mapTrajectory()` selects the numerical path. `lagrange.ts` supplies instantaneous pair markers. Massive-body ephemerides remain Keplerian. See `docs/physics/PRECISE_GRAVITY.md` for numerical limits and verification.

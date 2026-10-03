# Web Space Program — Architecture

An original, browser-based spaceflight sandbox in the spirit of KSP, set in the real solar system.
**No KSP assets, names, or text may be used.** All parts, art, and names are original.

## Stack
- TypeScript (strict), Vite, React 19 (UI overlays only — never in the per-frame render path), three.js (WebGL2), Vitest.
- PWA (offline) via vite-plugin-pwa.
- Path alias: `@/` → `src/`.

## Layering (strict, enforced by convention)
```
src/util      pure math helpers (Vec3/Quat in float64)              — no deps
src/sim       deterministic simulation, NO DOM, NO three.js          — util only
src/data      static content: bodies, parts, resources               — sim types only
src/render    three.js rendering                                     — sim, data, util
src/editor    vehicle assembly building (VAB) logic + scene          — sim, data, render
src/flight    flight scene: camera, input, HUD wiring                — everything
src/ui        React components (menus, HUD panels)                   — everything
```
`src/sim` must run headless in Node (tests, and later a multiplayer server / Web Worker).

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
- Don't commit; the lead integrates and commits. Don't modify files outside your assigned area without saying so
  in your final report.

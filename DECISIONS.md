# Decisions Log

Decisions made autonomously while the owner was away. Each can be revisited.

- **D-001 Stack**: TypeScript + Vite + three.js (WebGL2) + React for UI overlays. WebGL2 over WebGPU for laptop/browser compatibility.
- **D-002 Original IP**: All parts, art, names original. Agency name in-game: "Web Space Program". Crew are humans ("astronauts"), not a mascot species.
- **D-003 Scale**: Real data is the source; `s` scales lengths, GM by s² (preserves surface gravity), the atmosphere profile is compressed vertically by s^0.3 (standard → Earth atmosphere ≈ 70 km, like the genre classic), rotation periods by s^0.5. Default preset `standard` s=0.1. `real` preset uses exponent 1 for everything.
- **D-004 Rigid vessels**: Vessels are single rigid bodies (no wobbly joints). Structural failure via load thresholds. Removes KSP's "Kraken" class of bugs.
- **D-005 Gravity**: Patched conics for prediction and on-rails; physics mode uses dominant-body gravity, with optional n-body perturbations later.
- **D-006 Launch site**: Cape Canaveral-ish latitude (28.5°N) on Earth, east coast. Named "Coastal Launch Complex".
- **D-007 Autopilot building blocks** (`src/game/autopilot.ts`): planners (circularize, transfer to child/parent body, course correction) add maneuver nodes; controllers (ascent, node execution, powered landing) return a `ControlInput` per frame plus an optional `coastUntil` UT so any driver (tests now, an in-game autopilot later) can rails-warp idle phases. Node burns track remaining dv from measured proper acceleration and, for prograde/retrograde burns, stop on the planned orbital energy (finite-burn losses otherwise wreck near-escape burns like TLI). Landing = predictive suicide burn + slope-aware terminal descent (diverts to ground under ~8°). `tests/world-moon.test.ts` flies the stock Selene lander Earth → Moon landing → back into Earth's SOI with no balance changes.
- **D-008 Terrain relief**: relief scales by s^0.8 (standard: 0.16×) — slightly exaggerated vs radii for drama, but lunar slopes stay landable.
- **D-009 Tracking Station warp**: tracking uses the existing active-vessel warp clamps and encounter stops through `World.tick`; fleet focus is independent of the simulation's active vessel. With no active vessel, `advanceRailsTo` packs and propagates unattended vessels using existing rails event rules. Fleet conics refresh at 2 Hz while icon positions and floating-origin transforms update every frame.

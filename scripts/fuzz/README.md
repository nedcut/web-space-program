# Headless randomized simulation guard

Replay a seed: `npx tsx scripts/fuzz/run.ts --seed 12345`.
Run a fresh 20-minute campaign: `npx tsx scripts/fuzz/run.ts --seconds 1200`.
Replay a saved shortened log: `npx tsx scripts/fuzz/run.ts --repro fuzz-repros/12345.json`.
Run the CI sample: `npx vitest run tests/fuzz.test.ts --maxWorkers=2`.

The driver reuses the benchmark Earth-data registration, stock builders, headless
CraftEditor, World, scenario placement helpers and node executor. Each seed selects
one of all three scale presets and either a catalog stock craft or an editor-built
pod/tank/engine stack. Initial conditions alternate pad and circular orbit. Actions
include held flight inputs (staging is an edge), neutral coasting, all SAS modes,
RCS translation, physics/rails warp, node creation and bounded execution, EVA,
rendezvous target spawning, active-vessel switches, and JSON save/load. Dock actions
also exercise a separately seeded, controlled World capture/undock fixture; they do
not claim that random manual steering completes a rendezvous. Headless scene
handoff is represented by save/load and vessel switching; there is no DOM scene.

Every frame checks finite vessel runtime state (including temperatures, engine
state, SAS and inertia), part state and body ephemerides; nonnegative mass; resource bounds;
unique part IDs and acyclic parent links. Additional checks cover exact save/load
poses, resources, part tree and nodes, zero-time warp continuity (1 cm), and
same-body rails energy (relative 1e-8, absolute 1e-3 J/kg). Docking checks actual
capture, successful undocking, retained part count and valid trees. Each seed runs
twice and compares a SHA-256 of UT, active vessel, nodes, serialized vessel
state, crew and flags. Successful runs report fixture and actual coverage counters. Date.now is fixed only during synchronous
replay, following the existing determinism benchmark, and restored in finally.
This hash excludes UI/recorder/cache fields.

Contracts and limits:

- The two documented telemetry NaN sentinels (altitudeAGL with no ground and
  intakeAirRatio with no running jets) are allowed. Infinity is never allowed there.
  Catalog definitions and derived caches are excluded from numeric traversal.
- Intake air is per-step flow, explicitly not stored fuel (`engines.ts`), so it
  must be nonnegative and finite but may exceed nominal storage capacity.
- Ground contact removes 80% of the deepest penetration above 5 mm per correction
  (`contact.ts`). Arbitrary craft/impacts do not promise a fixed penetration bound
  after a single frame. This guard does **not** currently assert terrain clearance;
  the existing contact tests remain responsible for the solver's recovery law.
- Energy is compared only when both endpoints remain on rails in the same body.
  Physics integration, SOI changes and thrust are not energy-conserving cases.
- Warp continuity is checked at zero elapsed time. Expected orbital motion during
  nonzero warp is covered by rails energy, not a misleading displacement limit.
- Saves rebuild caches/mass and UI history. Round-trip assertions use persistent
  physical fields rather than requiring byte-identical derived caches.
- Node execution is bounded to 20 frames per action; this tests transitions, not
  successful long mission completion. EVA/docking availability can reject actions.

Failures include seed, step, reason and the action prefix. The original JSON is
written before shrinking. Bounded deletion shrinking retains the same error
signature, tries at most 100 candidates and stops starting candidates after ten
seconds; it is best-effort, not a proof of global minimality. Initialization
failures retain an empty log and are reproduced by seed. Campaign seeds run in
separate processes with a 90-second watchdog; timeout artifacts retain the seed.
A campaign ends after its time budget plus the final bounded seed. The nightly
workflow uploads repro JSON on failure and opens no issues. Generated repros
belong outside commits.

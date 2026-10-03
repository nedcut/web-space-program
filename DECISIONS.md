# Decisions Log

Decisions made autonomously while the owner was away. Each can be revisited.

- **D-001 Stack**: TypeScript + Vite + three.js (WebGL2) + React for UI overlays. WebGL2 over WebGPU for laptop/browser compatibility.
- **D-002 Original IP**: All parts, art, names original. Agency name in-game: "Web Space Program". Crew are humans ("astronauts"), not a mascot species.
- **D-003 Scale**: Real data is the source; `s` scales lengths, GM by s² (preserves surface gravity), the atmosphere profile is compressed vertically by s^0.3 (standard → Earth atmosphere ≈ 70 km, like the genre classic), rotation periods by s^0.5. Default preset `standard` s=0.1. `real` preset uses exponent 1 for everything.
- **D-004 Rigid vessels**: Vessels are single rigid bodies (no wobbly joints). Structural failure via load thresholds. Removes KSP's "Kraken" class of bugs.
- **D-005 Gravity**: Patched conics for prediction and on-rails; physics mode uses dominant-body gravity, with optional n-body perturbations later.
- **D-006 Launch site**: Cape Canaveral-ish latitude (28.5°N) on Earth, east coast. Named "Coastal Launch Complex".

# Precise gravity

Enable **Settings → Gameplay → Precise gravity (n-body) · this save**. Old and new saves default off; the optional version-1 save field is omitted when off. Lagrange markers have an independent persisted toggle in Gameplay and Tracking Station. No global preference overrides a loaded program.

## Force model and limitations

Vessels are massless test particles. All registered positive-GM bodies, including activated asteroids, contribute in stable catalogue order. In a translating, nonrotating frame centred on body c, with vessel position r and third-body offsets d_j, acceleration is:

`a = -GM_c r / |r|³ + Σ GM_j [(d_j-r)/|d_j-r|³ - d_j/|d_j|³]`.

Physics uses the existing rigid-body integrator in this local frame. Rails and map predictions share the same acceleration function, including sibling-body perturbations (not only ancestors). A 48-epoch cache shares ephemeris states across integrator stages and vessels; activating a source invalidates it. No force threshold, softening, random selection, or wall-clock data enters the force calculation.

Massive bodies still follow the game's prescribed Kepler hierarchy. They are **not mutually integrated**. Dominant-frame changes preserve absolute position/velocity but the frame-origin acceleration model changes; prescribed body ephemerides are not a fully consistent n-body solution. Do not interpret the result as a precision mission ephemeris or expect solar-system energy/Jacobi invariants. Conservation tests use isolated two-body and circular restricted Earth–Moon systems, where the corresponding invariants apply.

## Integration and scheduling

Dormand–Prince RK45 advances its fifth-order estimate with an embedded fourth-order error estimate. Default componentwise tolerances are relative `2e-11`, absolute position `0.001 m`, absolute velocity `1e-7 m/s`. Rejected steps do not advance state or UT. Encounter limits resolve both gravitational curvature (`0.15 sqrt(r³/GM)`) and relative crossing time (`0.15 r/v`) for every source; the maximum step is one day.

Rails accepts fleet steps together, so every craft has the same UT. A frame processes at most 96 attempts, yielding after an approximately 8 ms integration budget. If the target cannot be reached, it retains the accepted state/time and reduces the selected warp level. It never jumps the remaining interval with Kepler propagation. A conservative terrain/atmosphere guard shortens nearby steps and stops the active craft about 100 m above the boundary. Background entries are removed. Bookkeeping, a single in-flight step, JS garbage collection and rendering can exceed the nominal integration budget.

At a given state/time, integration decisions are deterministic. Wall-time scheduling changes how far a frame advances, so identical frame-time traces across different machines are not promised in precise high warp. The OFF mode retains the original simulation and a bit-exact pre-change golden trace.

## Map and maneuvers

The map incrementally integrates accepted states into polylines, with about 4 ms / 128 attempts per update. It shows partial-path status while computing, and explicitly labels the endpoint if the 12,000-attempt/64-patch limit truncates the horizon. Samples use body-relative Float64 coordinates until rendering. Maneuver times split integration exactly; delta-v is applied impulsively in the instantaneous numerical orbital basis. Node placement and handles interpolate numerical states with cubic Hermite interpolation. Distance minima are detected by the sign change of radial relative velocity and refined on that interpolant; the search reports encounters within three SOI radii.

Planner algorithms, worker snapshots, autopilot node design and orbital HUD readouts remain patched-conic/osculating approximations. Executing a node with precise gravity enabled displays a warning; the maneuver panel also labels this distinction. Finite-duration real burns can require corrections. Conic approach/impact map overlays and fleet orbit curves are hidden in precise mode to avoid presenting them as numerical predictions; fleet icons remain visible. Only the active vessel gets a numerical path.

## Lagrange points

Sun–Earth, Earth–Moon, Sun–Jupiter and Saturn–Titan markers are recomputed each map frame from instantaneous pair geometry. L1–L3 solve the full dimensionless CR3BP equilibrium equation by bisection; L4/L5 form equilateral triangles in the pair's orbital plane. Marker velocity includes angular and radial pair motion. These are instantaneous circular-model reference points in an eccentric, perturbed world, not guaranteed equilibria.

Tests perturb standard-scale circular Earth–Moon L4/L5 and follow them for 50 lunar periods, tracking maximum displacement and Jacobi error. An out-of-plane L1 placement exhibits large drift over two periods without station keeping. Full-catalog, eccentric-ephemeris L4/L5 tests follow ten lunar periods and allow the physically expected solar-driven libration (measured excursions about 0.21 and 0.13 lunar separations from the moving markers).

References: [SciPy's Dormand–Prince RK45 description](https://docs.scipy.org/doc/scipy/reference/generated/scipy.integrate.RK45.html), [NASA's explanation of Lagrange-point stability](https://science.nasa.gov/resource/what-is-a-lagrange-point/).

## Reproduction and measured budget

- `npx vitest run tests/nbody.test.ts --maxWorkers=2` covers conservation, stability/instability, independent analytic-Moon/fixed-RK4 reference, per-save compatibility, exact OFF trace, physics/rails agreement, numerical nodes/minima, replication, encounter safety and bounded fleet work.
- `npx tsx scripts/benchmark-nbody.ts` requests 1,000,000× for 120 frames at 60 Hz with the entire 61-body standard catalogue. It records elapsed frame times, achieved simulated time and incremental prediction work. This deliberately re-requests the maximum every frame to stress the fallback.
- Initial container measurement (other worktree tests active): high Earth orbit achieved about 77,500× at 60 Hz, 9.15 ms median / 29.62 ms p95 per complete World tick, reducing warp in every forced-maximum frame. Solar cruise achieved about 992,000×, 0.70 ms median / 4.87 ms p95, with one startup reduction. Earth/solar prediction completed in 31/49 batches, 142/310 attempts. These are machine/load-specific measurements, not hardware rendering/FPS guarantees.
- OFF trace SHA256 `9917950158dc918bd50b4b4413c0603360605ac2cf55c9327de0ab8d22785295` was generated from unmodified `92c212039bfaf79ec06385a0920ce020558e02cb`, using `tests/helpers/nbodyTrace.ts` in a temporary archive inside this worktree. It samples all translational/attitude states across fixed physics, rails and unpacking.
- `node scripts/check-nbody-browser.mjs` runs the Gameplay toggles and the live numerical flight map against port 5211, checks 20 markers, numerical samples and WebGL errors, and writes `docs/screenshots/nbody-map.png`.

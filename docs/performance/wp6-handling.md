# WP6 handling with inertia

Branch `cx/wp6`, baseline `29a067d0`, implementation `a7fef318`.
All media and raw measurements are archived outside Git in
`/home/nedcut/.t3/projects/wsp-traces/wp6/`.

## Delivered and accepted in Vitest

- Combined gimbal travel is **25°/s**, including reversals, two-axis commands, lock return and substeps.
- Liquid rockets retain their ignition spool-up and fast running throttle response/cutoff; explicit
  shutdown/reignition starts a fresh transient. Solids gain a finite, smoothly diminishing chamber-pressure
  tail, with fuel flow falling with thrust.
- SAS retains actual moment-of-inertia and torque scheduling, with a slower rate loop and pointing-rate
  cap to accommodate hydraulic slew. Installed coasting wheels have explicit bounded calibration knobs;
  modes and electrical supply remain authoritative. RCS still requires hardware and propellant.
- Meridian's 90° coast turn improves **33.12 → 6.96 s** to within 1°, with no subsequent error above 1.2°.
  **Stock Meridian has no RCS nozzles:** enabling RCS in this acceptance test leaves the installed wheel
  responsible for the turn. No invisible thrusters were added.
- With wheels disabled, Selene / Meridian Real turn 90° on gimbal alone in **6.28 / 8.36 s**.
- A real 0.2 s FlightInput keyboard pitch tap at 40 m/s, with warm liquid engines and three seconds of
  SAS settling, peaks at **5.31 → 1.01° Kestrel / 0.79 → 0.14° Meridian / 0.50 → 0.08° Selene**,
  all below the 5° requirement after the change. Baseline measurements use the same fixture against `29a067d0`.
  Digital keys now take one second to reach full command; analog/translation/trim/precision retain their contracts.
- Crossflow breakup is **readable** (retuned after WP6). Warning creaks/camera shudder start the instant
  q ≥ 42 kPa and α ≥ ~17.5° (70% of both limits, warn-only, no damage) and re-sound every 0.5 s.
  Past both limits (q > 60 kPa, α > 25°) joints fatigue at a rate set by exposure x = q/60 kPa · sin²α/sin²25°:
  breakup takes **2.4 s / x** after the first warning, never faster than **0.8 s** (x ≥ 3). Real Newton–Euler
  loads can no longer shear the hull faster than that while in the envelope. Crossflow fatigue relaxes at
  0.04/s for 3 s after leaving the envelope (not the 2/s numerical-spike decay), so a swinging craft that
  keeps re-entering still fails, while a craft that really recovers clears. Wind tunnel, Meridian:
  30°/65 kPa fails in 1.60 s (was 1.20); 90°/250 kPa in 0.80 s (was 0.10); free-flight Mach-2 sideways at
  3 km / 250 kPa fails at 1.20 s (was 0.10), warning from t = 0. Stock gravity turns reach at most 0.5 of the
  envelope, only at ~5 kPa, far below the 42 kPa warn gate.
- Crossflow uses the existing saved/replicated joint fatigue and load readout. A warning event (on entry, then every 0.5 s)
  triggers the existing hull creak and bounded accessible camera kick, including between 20 Hz audio samples.
  Structural failures retain WP1's separation/debris feedback. Existing heating and shield/fairing protection
  remain in use; no artificial heat injection was needed to fulfill the breakup-or-overheat acceptance.
- Every standard stock SAS regression and the complete stock mission suite remain green. The assist
  hand-back test measures peak correction over its first 0.5 s: the faster wheel can already have damped
  a spin by the old single sample time.

Final full-suite run: **148 files passed; 1,518 tests passed, one skipped**, with two workers to avoid
shared-machine CPU-contention timeouts. The first default-worker run had two render-test timeouts;
both passed on isolated rerun and in the full two-worker run. No render test was weakened or timeout changed.
The final empty-solid-grain telemetry cleanup also passed the focused engine/WP6 run (20 tests).
Lint, typecheck and the production build passed.

## Physics cost

Additional steady-step work uses scalar math and topology-lifetime cached wheel totals. No new
per-step arrays, vectors or maps were added. Gimbal updates reuse their state instead of replacing an
object; solid tail-off reads the local grain without allocating flow groups. Warning events allocate only
on envelope entry. The simulation remains DOM-free, three.js-free, Float64 and deterministic.

Headless Node comparison: 15 alternating before/after pairs after three warm-up pairs, fresh stock
Meridian, 100 warm-up + exactly 1,000 measured 50 Hz World ticks per fixture. Communications disabled
on both sides. Physics/thermal/contact/SAS remain enabled. Values are median milliseconds per tick:

| Fixture | Before | After | Change |
| --- | ---: | ---: | ---: |
| Pad | 0.030331 | 0.029179 | −3.8% |
| Powered ascent | 0.141470 | 0.140898 | −0.4% |
| Vacuum orbit | 0.092851 | 0.092707 | −0.2% |

The median within-pair ascent change is +2.2%, illustrating the small shared-host noise. Treat this as
flat cost, not a claimed optimization. Node timings are not 4×-throttled Chrome frame timings.
Raw data: `node-physics.json`; archived fixture script: `node-physics-bench.ts`.

Chrome baseline was captured with `scripts/bench/cpu-steady.sh` at Medium, DPR 2, 4× CPU throttle.
Raw data: `wp6-baseline.json`. Its sim section is 1.26 ms/frame on pad, 5.97 during ascent and
variable with frame cadence. Those values differ from the owner's approximately 2.7 ms/frame and
must not be treated as a cross-machine guarantee. The paired browser measurement uses an identical
tick count to avoid different numbers of physics steps per rendered frame.

Paired Chrome fixed-tick comparison: six alternating before/after pairs, Medium at DPR 2,
4× CPU throttle, 100 warm-up + 500 measured World ticks per fixture, renderer physics paused.
All samples, including the colder first pair, are retained in `result.json`. Median milliseconds
per tick and the median percentage change calculated **within each pair**:

| Fixture | Before median | After median | Paired change |
| --- | ---: | ---: | ---: |
| Pad | 0.1528 | 0.1654 | +4.5% |
| Powered ascent | 0.6335 | 0.6569 | −0.3% |
| Vacuum orbit | 0.3807 | 0.4174 | +4.1% |

The paired ascent result is effectively flat. Coast shows a small browser increase: +0.0367 ms/tick
between aggregate medians, with substantial warm-up/order variation. Aggregate medians and paired
percentage changes answer different questions; neither justifies claiming an exact zero regression.
At the owner's approximately 2.7 ms/frame baseline this is not a direct frame-cost estimate.
The benchmark script is archived as `handling-probe.mjs`; its page-error list is empty.

The repository live-frame comparison uses two alternating runs of each production build:

```sh
STEADY_SECS=4 scripts/bench/cpu-steady.sh wp6-paired-final 4 medium 2 \
  before=http://172.24.204.38:5461 after=http://172.24.204.38:5462
```

The wrapper owns the shared GPU lock. Fixed-tick samples above complement this frame comparison,
because the number of physics substeps per frame depends on frame pacing.

Mean `__perf.sim` milliseconds per rendered frame, two runs per build, at 4× CPU throttle:

| Fixture | Before | After | Change |
| --- | ---: | ---: | ---: |
| Pad | 0.7547 | 0.7230 | −4.2% |
| Powered ascent | 2.3172 | 2.2260 | −3.9% |
| Vacuum orbit | 1.4448 | 1.4375 | −0.5% |

Frame counts per four-second window are 85–87 pad, 72–75 ascent and 93–95 orbit. Draw counts
match (172 / 273 / 109); all four page/console error lists are empty. Treat these as roughly flat
physics cost, rather than a proven speedup: the sample count is small and host load changed from
the earlier standalone baseline. Raw data and text output: `wp6-paired-final.json` and
`wp6-paired-final.log`, archived outside Git with the other evidence.

Real Chrome gravity-turn captures use the same production builds at 1× CPU throttle. Each begins
with Meridian at 450 m, records seven seconds of assisted turn, then cancels the assist and records
three seconds of SAS settling at full throttle. `before-gravity-turn.mp4` and `after-gravity-turn.mp4`
each contain 389 frames over approximately 10.35 seconds; their original variable timestamps are
preserved. After-change tilt grows gradually to approximately 6.38°, with final angular rate
0.0010 rad/s. The clips are silent screencasts; the structural-warning sound still needs a listening
review. Full-resolution final screenshots, source JPEG frames and telemetry remain in the archive.

## Feel and limits

Stock craft lean gradually as hydraulic gimbals move, heavy stacks retain visibly more inertia than
Kestrel, and coast attitude corrections no longer require a long wait. Extreme sideways dense-air
flight warns and separates. Normal autopilot ascent, staging, node execution, landing and return
missions remain covered by their existing tests.

The coast wheel calibration and crossflow buffeting envelope are gameplay balance parameters, not
claims of full real-world actuator sizing or flexible-airframe aeroelasticity. Very heavy unpowered
stacks can still exceed a ten-second turn when the wheel gain cap or insufficient fitted RCS limits
authority; the demonstrated sub-ten-second large-stack cases use actual gimbal thrust. Human
judgment of the before/after gravity-turn video remains the final artistic acceptance.

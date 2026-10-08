# WP3 — Truthful HUD, quiet guidance

> Media (screenshots, videos, raw JSON timings) are archived outside the repo at `~/.t3/projects/wsp-traces/wp3/`.

Implementation: `ade910df`. Baseline: `422423e3b003a981e176891347287168c020caac`.
Production Vite previews on ports **5401** (WP3) and **5402** (baseline), real Windows Chrome over CDP,
RTX 3060 Ti, Medium, 1600×900 CSS pixels at DPR 1 and 2. Every hardware run owns `/tmp/wsp-gpu.lock`.

## Delivered

- Automatic Surface / Orbit / nearby-vessel Target speed, manual selection and AUTO indicator. SAS and navball
  markers consume the same mode. Earth atmosphere ceiling; airless boundary = 5% of body radius; hysteresis
  on descent and rendezvous range. Overrides survive altitude changes and reset on vessel/SOI changes.
- Thrust-aware TERRAIN / SINK RATE, including attitude projection and available burn time. Recoverable braking
  clears the lamp immediately. No special exemption for the landing assist.
- Delayed, deduplicated throttle explanations; obsolete engine warnings removed; maximum two event messages.
  The duplicate stage flash is gone. Pre-ignited engines now appear in the correct Δv group.
- Body-aware orbit/ascent hints, with the gravity turn at 50–100 m/s. Side-docked guidance and lower-left
  instruments leave the central vessel/plume view clear.
- Six-key first-flight card with live key bindings and no input-blocking modal. Full controls remain on
  Shift+F1. Unimplemented IVA controls and the binding are hidden.
- Optional engineering strip: stage Δv, local maximum TWR, vertical burn countdown and ballistic impact time.
  The countdown is blank in stable orbit. Tooltips state the no-drag / upright-thrust assumptions.

## Screenshots and video

- [First-flight six-key card](verification/first-flight.png)
- [Liftoff: at most two notifications](verification/liftoff.png)
- [Gravity-turn guidance at 50.7 m/s in the captured frame](verification/gravity-turn.png)
- [150 km orbit, ORBIT AUTO and engineering strip](verification/orbit.png)
- [Nearby vessel, TARGET AUTO](verification/target.png)
- Final fixed captures: [pad](final/pad-dpr1.png), [ascent](final/ascent-dpr1.png),
  [Earth orbit](final/orbit-dpr1.png), [lunar orbit](final/moon-dpr1.png), [powered lunar approach](final/approach-dpr1.png).
  Each also has a `-dpr2.png` version.
- Launch screencasts: [before DPR 1](before/ascent-dpr1.mp4), [after DPR 1](final/ascent-dpr1.mp4),
  [before DPR 2](before/ascent-dpr2.mp4), [after DPR 2](final/ascent-dpr2.mp4).

Screencasts are CDP JPEG frames at every third submitted frame, encoded as 12-second H.264 clips. They
preserve frame order, but use uniform frame spacing rather than CDP timestamps; do not derive frame pacing
from these videos. Timing evidence comes from `__perf`. Screenshots were visually inspected by the implementation
agent; the audit's independent human/reviewer-agent video acceptance remains for the parent/owner.

## Validation

- `npm run lint`, `npm run typecheck`, `npm run build`: passed.
- `npx vitest run`: 1,423 passed, one skipped, one timeout in the existing 180-second full-burn Saturn test
  during concurrent work. The Saturn file passed on a separate rerun with the WP3 and input suites
  (41 tests, 164.9 seconds total). No timeout was relaxed and no simulation/part change was made.
- Final focused run: 60 tests passed. New cases cover Earth/Moon modes at Standard/Real scale, descent
  hysteresis, manual overrides, Target acquisition/loss, pre-ignited Δv, throttle/stage message arbitration,
  body-aware hints, and gravity/thrust/fuel-aware cautions.
- A real `landingController` run from the Suicide Burn fixture lands below 3 m/s with zero terrain cautions
  at the HUD's 10 Hz sampling cadence; a ballistic fall still warns.
- [Browser assertions](verification/checks.json): non-modal six-key card, liftoff message limit, turn at
  50.1 m/s, Shift+F1 full help, manual selection/Auto, Target acquisition/loss, and no orbital burn countdown.

## Reproduction and integration

`../../../scripts/wp3-browser.mjs` captures the scene set and launch clips; `wp3-verify.mjs` checks controls
and guidance; `wp3-paired-perf.mjs` alternates clean baseline/WP3 contexts with the optional strip off/on.
Run them with the installed Windows Node and Chrome on CDP 9333, wrapped in `flock /tmp/wsp-gpu.lock`.
The capture script accepts a label and optional preview base URL. The baseline preview is built from a
read-only archive of the baseline commit; no branch checkout/stash is needed.

For WP4: `controller.speedReference.updateWorld(world, vessel)` runs just before constructing pilot input.
`controller.speedMode` remains readable/assignable; assignment selects a manual reference. Use
`controller.speedReference.select('auto')` to restore automatic selection. Do not add a second reference
state to map/planning. `FlightScene.tsx` only adds the onboarding slot/state, leaving the WP1 loss flow alone.

Caution physics are a local constant-gravity/constant-thrust vertical estimate, without drag, future terrain,
engine spool or changing mass. The strip's ballistic impact prediction is the existing unpowered conic estimate.
Apple hardware and 120 Hz behavior were not measured on this RTX/Windows host.

## HUD cost and limits

[Raw paired samples](paired-performance.json) and [case means](performance-summary.json) contain all saved
measurements. Each completed case has two baseline/after pairs, five seconds of settling and six seconds
of `__perf` sampling, without screenshots or screencasts during those samples. The engineering strip is
sampled off, then on; these are modest shared-host samples, not a statistical performance guarantee.

- **DPR 1, pad/Earth orbit/lunar orbit:** mean HUD React **0.087 → 0.087 ms/frame** with the strip off;
  **0.084 ms/frame** with it on. Approximately 60 fps. HUD CPU per second: 5.18 → 5.15 ms (strip off).
- **DPR 2, pad/Earth orbit:** mean HUD React **0.104 → 0.113 ms/frame** with the strip off;
  **0.117 ms/frame** with it on. Frame rates vary from roughly 34 to 59 fps. HUD CPU per second:
  4.58 → 4.67 ms (strip off), consistent with the unchanged 10 Hz UI cadence.
- The largest completed case's raw HUD increase is DPR 2 Earth orbit: **0.126 → 0.159 ms/frame**, with
  frame rate also changing **39.4 → 35.3 fps**. This costs about 0.69 additional HUD CPU ms per second;
  do not treat the raw per-frame difference as a controlled 120 Hz measurement.
- The largest observed increase in a completed case's mean pipeline GPU time is **+0.39 ms** (DPR 1 lunar
  orbit, strip off), below the audit's +0.5 ms budget. The strip-on sample of that case is slightly below
  baseline, illustrating noise; there are no renderer/shader changes in this package.
- **Incomplete benchmark tail:** 31 of 36 planned samples were saved. After the first DPR 2 lunar baseline,
  the after page never reached flight readiness within 120 seconds. A tail-only retry was queued, then
  cancelled before taking the busy shared GPU. That orphan baseline is retained but excluded from the means
  above. The complete final DPR 2 lunar screenshot run did pass. No load-time regression claim is made.

[Initial capture measurements](before/results.json), [exploratory after measurements](exploratory-after.json),
and [final capture measurements](final/results.json) are also retained. The exploratory after run overlapped
heavy test execution and had a readiness timeout; it is not used for the paired comparison. Video recording
adds overhead, and final Moon approach runs are powered while the original approach capture was ballistic.
The powered DPR 2 approach capture measured 0.259 ms/frame of HUD work, so the steady-case averages above
are **not** a bound on every flight situation. All new UI computation remains at 10 Hz; only scalar speed-mode
selection runs per frame, without new frame-loop objects.

The remaining acceptance work is independent video review and direct M-series/120 Hz measurement. The
DPR 2 lunar paired benchmark tail can be retried with `wp3-paired-perf.mjs --resume` after starting both previews.

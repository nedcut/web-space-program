# WP1: weight and payoff — verification

Implementation branch: `cx/wp1`. Baseline: main `422423e3`, built from the clean WP1 worktree before implementation. All effects are original procedural art/audio.

## Delivered behavior

- Separation punch translates and rotates the view. Rated 2,000 N·s separation gives about 1.6° of initial rotation, with a 0.32 s decay. Touchdown uses the existing descent-speed detector; impacts use mass and speed. Reduce Motion / zero camera shake suppress an in-progress kick immediately.
- Four reusable pyrotechnic voices provide separation, fairing and solid-booster variants, without a UI click. Four reusable explosion voices provide a noise attack, low-frequency body and falling sine thump. Idle event voices disconnect from the output, leaving no pull through their audio graphs.
- Engine-family amplitude uses actual thrust relative to 3.3 MN, rather than installed-thrust share, and retains camera-distance / atmospheric attenuation. The pilot's own Mach crossing no longer plays a sonic boom.
- Fireball/smoke diameter grows with part mass and remaining resource mass (a bounded propellant proxy), at least three times part diameter, capped at 70 m. Six pieces per destroyed part reuse its retained template mesh geometry (not the per-part thermal copy disposed on loss), with 32 total slots (smaller parts cannot evict all large fragments), tumbling, ballistic motion and approximate ground-plane restitution. Their lifetime is 3.5–4.5 s. This is render debris, not new colliders.
- Exhaust deposits overlapping cells by travel through the rotating air frame, with a 90 s life and a bounded shared 512-slot Medium pool (384 trail slots / 128 short-event slots). Nearby engine exhaust combines into one trail to preserve both fill budget and column history. Jets retain their contrails. Vacuum plume brightness rises within the existing shaders and draw count.
- After loss, time warp returns to 1× and rendering follows the live debris centroid in the moving surface frame. A non-blocking **Flight ended** bar appears after 3.5 seconds with Revert / Recover / Report and a scene exit. Recovery is enabled only for recoverable surviving active hardware. The stale HUD is hidden during the replay. A report opens only on request; F3 obeys the same delay. Failed mission cards also wait 3.5 s. Landing/mission debriefs dock on the right; scenario completion no longer pauses the scene.

No simulation, part catalog, editor, HUD internals, hints, cues or speed-mode changes. Controller edits are confined to event routing, loss rendering and camera accessibility input. No extra full-screen passes or particles/debris draws while dormant. Particle upload ranges, debris motion and trail scratch reuse their storage.

## Reproduction

Production builds: `/tmp/wp1-before` on port 5382 and `/tmp/wp1-build` on port 5381, host `172.24.204.38`. GPU runs hold `/tmp/wsp-gpu.lock`.

```sh
AB_OUT=/tmp/wp1-ab scripts/bench/gpu-passes-ab.sh wp1-final \
  http://172.24.204.38:5382 http://172.24.204.38:5381 \
  'pad,ascent,orbit' 1 --quality medium --dpr 2 --size 1470x920 --settle 6000
```

`scripts/bench/wp1-payoff.mjs` runs on Windows Node next to `playwright-core`. It records 1600×900 CDP video frames and WebAudio MediaRecorder audio, staging/crash screenshots, event long tasks, the loss-bar delay, a 10 km smoke view, actual OfflineAudioContext engine RMS and the Suicide Burn debrief/vessel projected bounds. The raw frame timestamps allow variable-rate video encoding; screenshots are device resolution (DPR 2).

Evidence directory: `/mnt/c/wsp-tools/shots/wp1/`. A/B reports: `docs/performance/wp1/ab-wp1-final.{md,json}` (raw runs in `/mnt/c/wsp-tools/bench/perfgpu/`). Payoff measurements are `docs/performance/wp1/payoff.json`; baseline is `before-payoff.json`. Detailed logs: `/tmp/wp1-{lint,typecheck,tests-complete,build,ab-final,acceptance,firefox-compare,firefox-software}.log`.

The final A/B and payoff capture used `8cfa2540`. The subsequent `eeaf3708` changes only the debris geometry lookup from the disposed thermal copy to its retained source, with identical mesh coordinates; no dormant rendering path changes. The full final tests/build include that ownership correction. Its event behavior has not been remeasured on the GPU.

## Checks and remaining acceptance

- `npm run lint`, `npm run typecheck`, `npm run build` pass. Layering checks confirm `src/sim` remains browser/three-free.
- Final full Vitest passes **137 files / 1,427 tests / one skipped** in 198.44 s (`/tmp/wp1-tests-complete.log`). Earlier runs under host contention hit unrelated duration limits; bounded/isolated reruns cleared them. The final full run includes the retained-template ownership regression test.
- Final paired GPU, Windows Chrome / RTX 3060 Ti / 1470×920 CSS / DPR 2 / Medium / adaptive off: pad **2.430 → 2.451 ms**; ascent **2.017 → 2.054 ms**; orbit **2.063 → 2.030 ms**. Pad has identical 134 draw calls / 2,261,765 triangles on both sides; no extra dormant draw. These single pairs establish near parity in fenced GPU time. Candidate live-loop GPU timers are 2.98 / 2.86 / 2.72 ms (pad/ascent/orbit), so they do not establish the same 2.5 ms bound in ordinary playback or a 120 Hz frame-pacing / Mac claim.
- Recorded Chrome events: 32 live fragment slots; the end bar appears 3.563 s after active loss with `paused=false`, warp 1× and no automatic report. The recorded staging task is 63 ms; impact tasks are 53 / 57 ms. The earlier baseline recording has a 72 ms staging task. A Chrome staging profile is saved alongside the recordings; the sampled event window contains vessel re-batching and renderer/driver work. Without recording, staging has no long task and impact has one 54 ms task. The strict >50 ms requirement remains unmet. The extra quiet-impact profile was cancelled while still queued after more than 20 minutes of shared GPU contention; `scripts/bench/wp1-impact-profile.mjs` preserves the follow-up, including a projected visible-fragment count. No other GPU jobs were interrupted.
- Windows Firefox **DPR 2 / 1600×916 CSS / Medium**, main then candidate, completes staging with **no reported page/console error** (`/tmp/wp1-firefox-compare.log`). Average CPU/frame is **11.25 → 11.39 ms**, FX section **0.192 → 0.142 ms**. Large max CPU stalls **685 → 671 ms** occur on both builds; this does not satisfy the strict 50 ms target. An earlier run with an injected LongTask observer reported “Permission denied to access property length”; the clean staging driver reproduces no error on either build. Firefox has no GPU timer result here, so it is not used for the GPU budget claim.
- Linux Firefox 155 software smoke completes menu → sandbox → editor → launch/stage → orbit/map without page errors or unlinked-program failures. Its strict harness flags four partial-texture-upload warnings (`/tmp/wp1-firefox-software.log`); this is functional coverage, not a GPU benchmark.

Real-browser acceptance is captured: at **10,018.8 m AGL / 56 simulated seconds**, the screenshot shows a continuous column to the launch area. Actual original-engine OfflineAudioContext RMS is **0.01150 / 0.18435 = 0.0624** for 9 kN versus 3.3 MN (limit 0.35). Suicide Burn succeeds with a **1.57 m/s** touchdown; its card is x **1282–1582**, vessel conservative screen bounds x **729.5–873.2**, with **no overlap**.

Screenshots in `/mnt/c/wsp-tools/shots/wp1/`: `before-staging.png`, `after-staging.png`, `before-crash.png`, `after-crash.png`, `after-flight-ended.png`, `after-smoke-10km.png`, `after-suicide-burn-result.png`. Videos with original WebAudio tracks: `before-staging.mp4`, `after-staging.mp4`, `before-crash.mp4`, `after-crash.mp4`. Raw frame timestamps/audio and the CPU profile are retained in the same directory. Human review of the video/audio feel, verification that five fragments are visibly distinct in the video, and an actual M-series Mac remain necessary; 32 live slots alone do not prove five visible pieces, and RTX results do not establish Mac/Metal/OpenGL performance.

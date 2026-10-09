# Context recovery follow-ups — 2026-10-09

Branch `op/ctx2`; production build, CDP Chrome on :9333, Windows RTX 3060 Ti harness, Medium, Standard scale, 1600×900. Browser runs used the shared GPU lock. No simulation or terrain shader changes.

## Changes

- `src/editor/scene/thumbnails.ts`: cancellable craft requests use the shared idle queue. A context lost before draw or during readback cannot publish/cache a PNG; restoration queues another attempt. Waiting requests keep the renderer alive beyond its normal four-second teardown delay, without blocking unrelated idle jobs.
- `src/editor/ui/CraftThumbnail.tsx`: cancels pending/retry work on unmount and caches only successful images.
- `src/ui/hub/HubScene.ts`: forwards the adaptive-independent near/far switch height, matching flight. The usual hub and its 2 km photo camera already stay inside Earth's unconditional near range. This corrects the contract for distant dev cameras. Map and planet portraits are `farOnly`; map height is CSS pixels, portraits do not update adaptive quality, and crew portraits use Canvas2D. No change to those consumers.
- `tests/thumbnail-scheduling.test.ts`: pause/restore, loss during draw/readback, idle-queue independence and cancellation. Removing just the new context guards produces four failures, including accepting a blank PNG.

## Evidence

Screenshots and sequences: `C:\wsp-tools\shots\ctx2\` (WSL `/mnt/c/wsp-tools/shots/ctx2/`). Logs and check outputs: `/home/nedcut/.t3/projects/wsp-traces/ctx2/`. Driver: `scripts/bench/ctx2-check.mjs` (run beside Windows `playwright-core`).

- **Hub:** fixed camera, two forced losses/restores; both restored frames pixel-identical to before. `hub-before.png`, `hub-restored.png`, `hub-restored-twice.png`.
- **Launch pad:** site surfaces return, whole-frame mean absolute RGB difference 0.019/255. `pad-before.png`, `pad-restored.png`.
- **Part palette:** loss during the second PNG encoding; 24/24 requested images recover, zero transparent images. Reload returns all 24 from IndexedDB with zero thumbnail contexts created. `parts-lost.png`, `parts-restored.png`, `parts-cache-reload.png`; `thumbs.json`.
- **Craft dialog:** loss at the first PNG readback, held for 6.5 seconds (longer than renderer teardown timeout). Zero previews published while lost; 27/27 recover, none transparent; reopen retains all 27. `crafts-lost.png`, `crafts-restored.png`, `crafts-reopened.png`; `thumbs.json`.
- **Sea wrap:** fixed scene, camera and world clock; stopped flight animation and rendered controlled ocean `uTime` values around 100,000 s. Mean absolute RGB change over bottom 45%: wrap 0.055/255, ordinary 1/60 s step 0.054, identical time 0, random time 6.621. `sea-{wrap,ordinary,same,random}-{a,b}.png`; `sea.json`. This measures wave continuity independently of body rotation/camera movement.
- **Motion:** Moon and Earth near the pad, 16 sampled frames each, translated 0→120 m while descending 200→170 m AGL in a paused world. Ground mottling stays aligned with crater/road/vegetation features; no visible swim/crawl or repeating grid in these sequences. `{moon,earth}-motion-00.png` through `-15.png`, `-motion-return.png`; `-motion.mp4` replays the frames at 8 fps, and `-motion-contact.png` contains six ground crops. This is a controlled rendering path, not a flown landing.
- **Other rocky bodies:** Mars and Mercury at 8,000 m and 200 m AGL; near terrain retained, workers settled, no repeating regolith grid. `{mars,mercury}-{8000,200}m.png`; `terrain.json`.

All successful thumbnail, sea and terrain runs report zero browser errors. The initial driver wait incorrectly counted deliberately unrequested offscreen palette cards; the corrected run checks all 24 requested cards. An initial paused terrain fixture used zero body-relative velocity, triggering a radial-orbit readout error; the successful fixture retains tangential velocity. Neither failed fixture is used as visual evidence.

## Remaining observation and limits

Mercury has sharp cutoffs in some small crater rims/ejecta. Same-scene A/B replacing only the detail sampling block with its pre-tiling form (`10c1efe8^`) retains those exact cutoffs: `mercury-{8000,200}m-{current,previous-detail}.png`, `mercury-detail.json`. This is separate from the regolith tiling regression. The shared crater generator explicitly notes clipped ejecta near cell borders; a definitive generator/LOD diagnosis and fix remain a terrain follow-up. Shared physical terrain is unchanged here.

Motion/grid observations cover these sampled locations, Medium and Standard scale on Chrome. Other scales, quality tiers and Apple GPUs were not newly verified. High-warp sea strobing remains the separately documented design issue.

The added switch-height calculation was timed through the same planet-layer update used by the hub: 15 alternating pairs of 200 updates on a settled, paused Chrome pad scene. Median CPU time 0.0265 → 0.0275 ms/update; median paired difference +0.0010 ms. This is an isolated update benchmark, not an end-to-end frame-rate claim. No new hot-loop allocation. `lod-cost.json` / `chrome-lod-cost.log` retain samples.

## Checks

`npm run lint`, `npx tsc --noEmit`, `npx vitest run --maxWorkers=2`, and `npm run build` pass. Full suite: 179 files, 1,706 passed, one existing skipped test, 271.10 seconds. The targeted thumbnail/planet suite passes all 16 tests. Large media are outside git.

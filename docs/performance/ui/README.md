# UI interaction evidence

`before.json` is the normal production bundle at main `7bd6e4f9`, measured locally in WSL Chromium
with SwiftShader, 4× CDP CPU throttle, 1470×920 CSS viewport and DPR 2. `after.json` measures
`3f496823` under the same setup (before the later input-quiet scheduling refinement).
The probe counts capture-event → second requestAnimationFrame: an upper bound on the first paint
opportunity after the event, not the browser's official INP or a guaranteed presentation timestamp.
Cold/warm first-18 times start after the editor hook exists, excluding scene construction.
Warm is a same-context page reload, retaining IndexedDB but resetting module caches.

The part catalogue has 168 cards. Before eagerly builds/generates all of them; after requests the
viewport and scroll margin and subscribes each card to its own image. Search subsequently requests
nearby matching tanks. Eight repetitions per interaction; raw event samples and frame gaps remain
in each artifact. Hardware and software renderer captures must be compared separately.

`ui-bench.mjs LABEL BASE detail` adds a 100-part Selene/tank fixture, five seconds of continuous
held-part motion, exact snap/attach/undo checks, flight panel toggles/dragging and menu hover.
`WSP_PROFILE=1` enables React's production profiling renderer; its `actualDuration` is React render
work for a commit, not DOM commit/presentation duration. Closed-panel steady flight captures exclude
loading/mounting and include eight seconds after a five-second settling interval.
`WSP_UI_BASELINE=7bd6e4f9` overlays the ten changed original UI source files read-only from git,
keeping profiling instrumentation and all unchanged application code identical. No checkout is changed.


`final-v2.json` is the final measured palette after shared card observation, deferred filtering,
weak-map material bookkeeping and visual-only scene invalidation. It precedes the final 350 ms
input-quiet thumbnail submission refinement. Later artifacts include both handler capture time and
`event.timeStamp` → second rAF, retaining input-queue delay separately; early artifacts have only
capture timing. `final-cpu-fixed.json` profiles the 100-part/flight workload with only editor/flight
GPU draw submission suppressed; its ~59 fps is CPU isolation, not in-game performance.
See [the performance report](../../PERFORMANCE.md#ui-responsiveness--production-interaction-probes)
for the before/after tables, measurement limits and reproduction commands.

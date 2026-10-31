# Shell playtesting manual

Play the production game through its UI, one shell command at a time. Do not read
source code to discover answers, call `debug`, or use another automation channel.
Read `docs/PLAYTEST.md` for the human sessions. Report confusion as well as crashes.

## Start and stop

The owner prepares `npm ci`, `npx playwright install --with-deps chromium`, and
`npm run build`. Start never builds or installs:

```sh
npm run play -- start --session first-hour
npm run play -- look --session first-hour
npm run play -- stop --session first-hour
```

Each session owns a detached daemon, fresh Chromium context/storage, a Vite preview
on a distinct OS-assigned loopback port, and `.playtest/<name>/`. Names contain
letters, digits, `_` or `-`. Multiple sessions can coexist. Evidence directories
are never overwritten: use a new name each run. `stop` closes Chromium and Vite,
retaining logs/screenshots. If the daemon has died, retain/rename its directory
before reusing the name. `pid`, `daemon.log`, `ready`, and `control.sock` identify
it; send SIGTERM to that exact PID for emergency cleanup. A host that kills
background processes at turn end also kills sessions: stop before handoff.

Uses smoke-suite Chromium/ANGLE SwiftShader and Low graphics at 1366×768, 30 fps,
with autosave disabled and service workers blocked. First-visit help remains on.
This is functional testing, not evidence of hardware GPU performance or other browsers.
No credentials or production services are needed. Settings and program state stay local.

## Commands

Append `--session <name>` to every command (default name: `default`). Quote text.

```sh
npm run play -- click 'New Game'
npm run play -- click Sandbox
npm run play -- click Start
npm run play -- click 'Integration Hall'
npm run play -- click 'Browse stock vehicles'
npm run play -- click 'Kestrel Sounding Rocket'
npm run play -- click Launch
npm run play -- key z
npm run play -- key Space
npm run play -- key Shift --hold 5
npm run play -- look
npm run play -- key m
npm run play -- wait 0.1
npm run play -- look
```

- `look`: current scene, SI telemetry (metres, seconds, m/s, m/s Δv), visible UI
  accessibility tree, refs `[e12]` for visible controls, and a PNG path. Open the
  PNG using your image tool. Flight telemetry includes surface/orbital speeds,
  stage, resources, crew, SAS/RCS and warp; mission/goal text is in the UI tree.
- `click e12`: use a ref from the latest `look`. Refresh after UI changes.
  `click 'Text'`, `click 'text:Exact visible text'`, and `click 'testid:identifier'`
  are alternatives. Ambiguous matches fail: inspect `look` and choose a ref.
- `click 700 380`: click viewport pixels, useful for 3D parts and attachment nodes.
- `type 'My craft'`: insert into the focused field. To replace, click its ref,
  `key Control+a`, then `type`. `key Enter` commits.
- `key <key> [--hold <seconds>]`: Playwright key names, e.g. `Space`, `Shift`,
  `Escape`, `ArrowRight`, `Control+s`, `.` and `,`. Always releases the key,
  including after errors. A key without hold consumes no simulation time;
  queued actions such as staging take effect on the next `wait`/held key.
- `move x y`: hover/place the pointer. `scroll <pixels>` scrolls under it (negative
  is up). For a canvas zoom, move onto the canvas first.
- `drag x1 y1 x2 y2`: left-button pointer drag (editor camera orbit/gizmos).
  The editor uses **click to pick, click to attach**, not drag-to-attach: click a
  palette part, `move` to a glowing attachment node, `wait 0.1` to render its
  preview, then `click x y`. Use `look`/PNG to inspect the result. Same-coordinate
  drag is also a click. Use normal keyboard shortcuts for rotation, symmetry, undo.
- `wait <seconds>`: advance time, then freeze again. Maximum per call: 3600 s.
- `shot`: screenshot without changing time. `note 'expected X; saw Y'`: observation
  recorded in the replay log. New browser/console/WebGL errors print prominently
  on every command and are retained in its log record.

## Time and replay

The browser clock is installed **before navigation** and frozen between commands.
`wait` and held keys run every animation frame/timer for the requested browser
seconds, rather than skipping frames. Physics uses its normal 50 Hz fixed step;
UT is quantized and can differ by one physics step from requested seconds. Warp
still multiplies simulation time; pause/help menus still pause it. Workers finish
terrain/planning asynchronously; their clocks are not virtualized. Loading overlays
are pumped in 32 ms clock increments until ready (up to 120 s wall time), so scene
startup can consume neutral game time. This is logged; replay is approximate across
asynchronous loading, not bit-identical or portable across different builds.

`look`, `shot`, `note`, pointer commands and ordinary key presses consume no game
time. A map/editor view may need `wait 0.1` to render after a UI action. Screenshots
use Chromium compositor capture so they do not unfreeze the browser. SwiftShader
can take much longer than the requested game time; long waits should be split.

```sh
npm run play -- replay .playtest/first-hour/actions.jsonl --session repro --until 23
npm run play -- look --session repro
npm run play -- stop --session repro
```

Replay starts with fresh storage on the **current dist build**, executes recorded
commands serially, and stays frozen at the end for inspection. `--until` is an
inclusive original step number. Keep all prerequisite actions; trim only the tail.
Clicks record semantic targets so refs can be resolved in a new browser. Failed
commands are replayed too; their expected failures are printed. Stop commands in
the source log are skipped. Never edit an action into a triage command. Separate
owner-only `debug '<JavaScript expression>'` exists for investigation; any log
containing debug is rejected by replay and cannot count as player evidence.

Every action is JSONL version 1: step, command, args/options, scene/gameTime,
telemetry when flying, ok, summary, errors, wallMs. Screenshots use step numbers.
A bug report contains: build SHA; persona/session; expected versus actual; minimal
JSONL prefix; first failing step; its PNG; console/WebGL errors. Keep evidence
outside git. Preserve the original file and attach a trimmed copy. Don't fix game
bugs while playtesting. Replay cannot reproduce external files/network changes,
multiplayer authorities, clipboard/file chooser workflows, or precise cross-build
camera pixels. CLI is an observation aid, not a security boundary against cheating.

## Maintainer checks (not player commands)

```sh
node --test scripts/playtest/protocol.test.mjs
npm run build
node scripts/playtest/e2e.mjs unique-session-name
```

The manual end-to-end check uses separate CLI processes to start a Sandbox, load a
stock craft through the UI, launch/stage, hold throttle, check AGL >10 m, open/close
the map, inspect browser/GPU diagnostics and stop even on failure. It is deliberately
outside required CI. Full repository gate remains lint, typecheck, Vitest, build.
Diagnostics mirror `scripts/smoke/main.spec.mjs`; update both when changing policy.

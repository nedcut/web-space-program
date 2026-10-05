# Observatory UI polish

Visual review: 18 views at **1366×768 and 1920×1080**, before and after (72 PNGs). Every image was opened and reviewed. File names are `<view>-<width>.png` in `before/` and `after/`.

Views: menu, spaceCenter, editor, flight, map, tracking, research, missions (sandbox), missions-career, training, pedia, scenarios, flightlog (empty), report (recorded flight), settings, pause, loading, titan-low.

The before source is `45711363` (parent of `9ec0ebf3`). After captures include the main merge `9da5736b`; catalog counts and map rendering also reflect upstream small-body work. Historical report/loading captures used an archive of the baseline source inside this worktree, subsequently removed. Different live camera/animation phases are expected. These are Chromium SwiftShader visual checks, not hardware GPU or performance measurements.

## Reproduce

Run Vite on port 5200 from the checkout under review. Each runner invokes `node scripts/shot.mjs`, with `SHOT_WIDTH` and `SHOT_HEIGHT`. `SHOT_HIDE_HELP=1` suppresses the first-flight help overlay for evidence only.

```sh
node scripts/ui-polish-shots.mjs after
node scripts/ui-polish-details.mjs after
node scripts/ui-polish-titan.mjs after
node scripts/ui-polish-extras.mjs after
node scripts/ui-polish-browser.mjs
```

The first two runners support `SHOT_RESUME=1` to skip existing PNGs. Use the historical checkout for before captures. The extras runner's `before` mode expects a baseline source archive at `.ui-baseline/`, with its index entry pointing to `/.ui-baseline/src/main.tsx`.

Titan uses the same daylight northern-sea fixture, Low quality, half render scale, and no shadows/bloom/clouds for both phases. The diffuse amber sky reflection is now visible without depending on a narrow specular highlight. Report captures seed an actual 12-second simulated Meridian flight. Loading is captured during flight initialization.

## Review findings

- Shared dark navy surfaces, cyan interaction, amber mission accents, system sans/mono fonts, consistent boundaries and native focus states.
- Main-menu live art is revealed after initialization; fallback artwork no longer obscures it.
- Laptop editor palette has no horizontal overflow; research graph and details scroll independently.
- HUD readouts, navigation-ball surround, dock chips and SVG stage icons share the same visual language.
- Empty states, reports, career cards, settings and pause/loading surfaces use the shared system.
- Reduced motion disables decorative transitions/animation; tabs support arrow/Home/End keys and native switches retain keyboard semantics.

Validation: lint, TypeScript and production build pass. Full post-merge Vitest: **74 files / 875 tests passed**. See `browser-report.json` for the real-gesture browser checks. The build retains Vite's existing large-chunk advisory.

## Files touched by this pass

Excludes unrelated main-merge changes. Screenshots and browser evidence are in this directory.

- `DECISIONS.md`
- `PROGRESS.md`
- `docs/qa/README.md`
- `scripts/shot.mjs`
- `scripts/ui-polish-browser.mjs`
- `scripts/ui-polish-details.mjs`
- `scripts/ui-polish-extras.mjs`
- `scripts/ui-polish-shots.mjs`
- `scripts/ui-polish-titan.mjs`
- `src/audio/index.ts`
- `src/editor/ui/Palette.tsx`
- `src/editor/ui/StagingPanel.tsx`
- `src/editor/ui/TopBar.tsx`
- `src/editor/ui/editor.css`
- `src/editor/ui/icons.tsx`
- `src/flight/FlightScene.tsx`
- `src/flight/hud/Hud.tsx`
- `src/render/planet/materials.ts`
- `src/scenarios/Scenarios.tsx`
- `src/scenarios/scenarios.css`
- `src/tutorial/Training.tsx`
- `src/tutorial/tutorial.css`
- `src/ui/App.tsx`
- `src/ui/FlightLog.tsx`
- `src/ui/MainMenu.tsx`
- `src/ui/MenuBackdrop.tsx`
- `src/ui/Missions.tsx`
- `src/ui/Research.tsx`
- `src/ui/SettingsPanel.tsx`
- `src/ui/SpaceCenter.tsx`
- `src/ui/Spacepedia.tsx`
- `src/ui/components/Icon.tsx`
- `src/ui/components/components.css`
- `src/ui/components/index.tsx`
- `src/ui/components/screens.css`
- `src/ui/components/tokens.css`
- `src/ui/flightlog.css`
- `src/ui/pedia.css`
- `src/ui/planetPreview.ts`
- `src/ui/progression.css`
- `src/ui/theme.css`
- `src/ui/tracking/TrackingStation.tsx`
- `src/ui/tracking/tracking.css`
- `tests/audio.test.ts`

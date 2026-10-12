# UI / UX audit — menus, hub, facilities, flight shell (2026-10-12, op/uiaudit)

Owner brief: navigating menus and the Space Center feels clunky; wants "KSP but improved": fewer clicks,
clear navigation, keyboard friendly, one visual language, nothing that costs frame time.

Method: every screen walked in the CDP Chrome (RTX 3060 Ti, 1600×900, production build, `main` @ 49838520),
scripted with `C:\wsp-tools\drv\uiaudit-*.mjs` (menu, hub, editor, flight pad/orbit/dock/recover, misc,
verify). Each run logged visible controls, a Tab-order probe and an Esc probe (did Esc do anything?).
Screenshots: `~/.t3/projects/wsp-traces/uiaudit/` (numbered by flow, file names below in brackets).

## Cross-cutting findings (ranked)

1. **Esc is inconsistent.** Before UX-1 it did nothing on 12 screens/panels: New Game,
   Continue, Multiplayer, Scenarios, Training, Spacepedia, Flight Log, Fleet Tracking, Research, Mission
   Control, editor stock-craft library [21b], editor Action Groups (despite its own "Esc close panel" hint)
   [25b]. It worked in Settings, flight (pause), the flight help overlay and map context menus. Each place
   that did handle Esc had its own window listener with ad-hoc `stopPropagation`.
   In flight, Esc on the F3 results sheet closes it **and** opens the pause menu in one press [37b];
   app windows never close with Esc (five presses toggle pause instead [34c]).
2. **No way to move between facilities** without returning to the hub: Research → Missions = 2 clicks plus a
   hub load. Every facility names the way back differently: "Space Center" (Flight log, Research, Missions),
   "Back to Space Center" (Tracking), "Main menu" (Scenarios), "Back to main menu" (Training), "Back"
   (Spacepedia) — and places it differently (top-right, top bar, inside the briefing card, bottom-left).
3. **Leaving flight never lands on the hub.** Pause → "Space Center" and "Recover vessel" both open the Flight
   Log [46, 55]; the hub (and the recovery notice, which only the hub renders) is one more click away.
   Intentional (flight reports, a40c9799) but it reads as a detour; a debrief on the hub would keep the report
   without the extra screen.
4. **Keyboard reach is poor outside flight.** Opening a panel left focus on `<body>` (New Game, Continue,
   Multiplayer); main-menu Tab order did not match the layout (Multiplayer is last on screen, third in Tab
   order, via `grid-row` CSS); no arrow keys in any grid; no hub shortcuts. Focus rings themselves are fine
   (2px accent outline everywhere probed).
5. **Native browser dialogs.** `window.prompt`/`window.confirm` for hub "Save as…", flight pause "Save as…",
   editor "New craft", and Rename/Folder/Tags in the craft library. They block the page, ignore theme/UI scale
   and look broken in a game.
6. **Icon-only toolbars with no labels** (editor top bar: 20 icon buttons [20]; flight app bar: 11 [30]).
   Titles exist, but nothing on screen says what the groups are; KSP veterans scan for words.
7. **Naming drifts** for the same thing: "Scenarios · Missions" (menu) → page titled "Missions" [06] while
   career has "Mission Control" (contracts). "Flight log"/"Flight Log". The Flight Log and Mission Control
   hub tiles share one icon [10].
8. **Overlapping HUD panels.** Flight Data stacks over Science and under the MAP/AUTO buttons [35];
   the scenario briefing card occupies the app-window column [63]; the "Board · Enter" prompt sits on the
   status lamps [35]; the first-flight card stays up during EVA and in orbit [35].
9. **Dead ends / noise.** Continue is enabled with no saves and opens an empty list [03]; the craft library
   badges every stock card "Standard Scale · Current" and one card leaked a dev URL ("try
   ?scenario=rendezvous") [21]; the Training page uses a third of the screen and has no progress or
   "recommended next" [07].

Nothing found affects frame time; all fixes below are DOM-only, on interaction, never per frame.

## Per screen

| Screen [shots] | Problems | Clicks today (best) |
|---|---|---|
| Main menu [01] | Continue shown with no saves; Tab order ≠ visual; no arrow keys; version text only. | — |
| New game [02] | Esc did nothing; focus not moved into panel; inline styles instead of tokens; Start is not default (Enter does nothing). | New → Start = 2 |
| Continue / load [03, 65] | Esc did nothing; unstyled native file input; "Continue latest" only inside the list (resume = 2 clicks); save entries show raw ids (`sandbox-1791833768019`). | 2 |
| Multiplayer [04] | Esc did nothing; fine otherwise. | — |
| Settings [05*] | Esc works; good tabs. No search; long Graphics tab; Done top-right only. | — |
| Scenarios [06] | Esc did nothing; back button inside the briefing card; title "Missions" collides with Mission Control. | — |
| Training [07] | Esc did nothing; no completion/progress; back button bottom-left; wastes space. | — |
| Spacepedia [08] | Esc did nothing; good otherwise (search, tabs, previews). | — |
| Space Center hub [10, 10c] | Only VAB and pad are clickable in 3D (no hover label says which building); 4 of 6 facilities exist only as tiles; Esc does nothing; no shortcuts; Save as… is `window.prompt`; Launch Pad tile disabled until a craft is loaded in the editor even when the library has crafts. | Launch saved craft: hub → editor → load → pick → Launch = 5 |
| Flight Log [11, 46, 55] | Arrives here after every flight; back is "Space Center" top-right; empty state duplicated (left list + right card). | — |
| Fleet Tracking [12, 47, 48] | Esc did nothing; own top bar duplicates hub links; vessel list has no grouping/filter/sort, no type icons (station vs probe vs debris), no rename; "Fly" from tracking once left the camera far from the vessel with a map-only planner hint showing [49] (not reproduced yet). Terminate has a confirm (good). | Switch to a vessel: hub → tracking → Fly = 2 |
| Research Lab [13] | Back top-right; graph not keyboard navigable (buttons, but no arrows); fine visually. | — |
| Mission Control [14] | "Request recovery funding" inline in a sentence; dense but clear. | — |
| Editor [20, 23–27] | Icon-only toolbar; exit is an unlabeled icon top-right; library opened as a custom modal Esc could not close; Action Groups Esc broken (hint lies); "New craft" uses `window.confirm`; Rename/Folder/Tags use `window.prompt`; no unsaved-changes indicator; Copy share code/Export/Import float over the hangar. | Load stock craft = 2 |
| Launch → pad [29, 30] | Good: loading screen, first-flight card. Card stays during EVA [35]. | — |
| Flight HUD [30, 33*, 34, 36] | 11 unlabeled app icons; app windows stack and overlap MAP/AUTO and each other; Esc never closes app windows; F3 + Esc double action. | — |
| Pause menu [31, 38] | 9–10 equal buttons, Photo mode above Resume, destructive reverts with no confirm, no grouping; "Space Center" goes to Flight Log. | — |
| Map / maneuver [41–44] | "Maneuver planner ▸" collapsed and easy to miss; info card bottom-right repeats keyboard help; context menu fine (Esc closes it). | Add node: click orbit = 1 (good) |
| Docking / stations [50–52] | Target panel clear; "Docking mode" status is a toast-like card top-left with no port picker; no station overview (crew, ports, docked modules) anywhere; "navigating stations" is vessel switching with `[ ]` only. | — |
| EVA [35] | Crew card has good inline hints; board prompt collides with status lamps; flight hints stay. | — |
| Lessons [60–62] | Mentor card clear (Next/Skip/Restart/Lessons). Pause menu still offers Recover/Revert to editor in a lesson. | — |
| Scenario flight [63, 64] | Briefing card in the app column; "Retry"/"Scenarios" shown at start. | — |
| Recovery [55] | Lands on Flight Log; credits/science summary only appears later on the hub. | — |

## Redesign plan — work packages

UX-1 is the shared foundation (done on `op/uiaudit`, see below). The remaining packages are independent
once UX-1 is merged: each owns a disjoint set of files. "Uses" lists UX-1 APIs; nobody else edits
`src/ui/nav/*` or `src/ui/components/*` without coordinating (additions only, append-at-end).

| Package | Owns (exclusive) | Scope |
|---|---|---|
| **UX-1 Foundation + global nav** (done) | `src/ui/nav/*`, `src/ui/components/index.tsx`, `components.css` | Esc/back stack (`useEscape`, layers screen < panel < modal < capture), `SceneHeader` (back + facility switcher), `arrowNav`/`focusFirst`, `facilities(mode)` naming source, `Kbd`, `ConfirmModal`, `PromptModal`. |
| **UX-2 Front door & saves** (done: op/ux2 — Continue resumes newest save with a summary line, Enter continues; Load = program cards with vessel preview, readable names, expandable saves, confirmed deletes, drop-zone import; New Game is a form; "Challenges") | `src/ui/MainMenu.tsx`, `SaveLoadDialog.tsx`, `MenuBackdrop.tsx`, `Unsupported.tsx`, `src/net/MultiplayerPanel.tsx`, `screens.css` (menu rules) | One-click **Continue** (resume latest; "Load…" secondary; hidden/disabled with no saves); readable save names + date/mode/scale/thumbnail; styled import (drop zone); New Game: Enter starts with defaults, move inline styles to tokens; rename menu entry "Scenarios" → "Challenges" (coordinate with UX-4b title). |
| **UX-3 Space Center hub** | `src/ui/SpaceCenter.tsx`, `src/ui/hub/*`, `src/render/site/*` pick meshes only, `screens.css` (hub rules) | Hover labels on 3D buildings; make every facility pickable (tracking dish, lab, mission control); Launch Pad tile opens a quick craft picker (library + stock) → launch without the editor (5 clicks → 2); Esc on hub opens a small hub menu (Save, Load, Settings, Main menu); post-flight **debrief card** on the hub (report summary + "Open Flight Log") replacing the redirect (needs UX-7 to change `exitTo`). |
| **UX-4a Facility screens** | `FlightLog.tsx`, `flightlog.css`, `Research.tsx`, `Missions.tsx`, `progression.css` | Research graph arrow-key navigation and "Research" on Enter; Missions layout (funding action as a button row, filters: offered/active/completed); Flight Log single empty state, "Continue to Space Center" when arriving from flight. Already use `SceneHeader`. <br>**done (op/ux4):** arrows walk the tech graph (focus selects; opens on the next affordable node), Enter researches; dossier part names open their Spacepedia article; Missions toolbar = filter segment (Open/Active/Offered/Completed/Declined·failed/All) + Request offers + Emergency funding buttons with disabled reasons; Decline/Accept side by side, Abandon asks via `ConfirmModal`; Flight Log: one empty state with "Open Integration Hall", arrival banner after a flight (recovery summary, focus on "Continue to Space Center", `nav/sceneHistory.ts`). |
| **UX-4b Library screens** | `src/tutorial/Training.tsx`, `tutorial.css`, `src/scenarios/Scenarios.tsx`, `scenarios.css`, `Spacepedia.tsx`, `pedia.css` | A `MenuScreenHeader` (back left, same position everywhere, add to `src/ui/nav/` as an append-only file); Training progress (completed ✓, recommended next, estimated minutes) and a denser grid; Scenarios title/naming; Spacepedia deep links from hub/editor/flight (e.g. part → article). <br>**done (op/ux4):** `nav/MenuScreenHeader.tsx` on Training, Challenges, Spacepedia (back top-left, label names the destination); Training: n/8 progress, ✓ completed, "Recommended next" focused on entry (Enter starts), ≈minutes/steps/where, denser grid; Scenarios page titled **Challenges**, medal count, arrows switch briefing, Enter flies, briefing keeps the last challenge; Spacepedia: `openPedia(from, {kind,id})` deep links (Research parts), `/` search, Enter/↓ into results, per-tab match counts, parent body name; part inspector (editor + flight) book button opens `PediaQuickLook` over the scene. |
| **UX-5 Tracking station & vessel switching** | `src/ui/tracking/*`, `tracking.css` | Adopt `SceneHeader` (switcher) or keep the bar but with the same back control; vessel list grouped by body and type with icons (station, lander, probe, debris, flag), filter/search, sort by next event; keyboard list navigation (↑↓, Enter = Fly, F = Focus); rename vessel; check "Fly" camera framing: after Fly the vessel was a speck far from the camera and a map-only planner hint showed [49] (seen once, not yet reproduced). |
| **UX-6 Editor shell** | `src/editor/EditorScene.tsx`, `src/editor/ui/*`, `editor.css` | Labelled toolbar groups (File · Edit · Tools · Symmetry · Overlays) with shortcut tooltips; labelled exit "← Space Center"; library: search/sort, drop "Standard Scale · Current" badge noise, inline rename/folder/tags (use `PromptModal`), `ConfirmModal` for New; unsaved indicator; `/` focuses part search; move Copy/Export/Import into the File group. **done (op/ux6):** captioned groups + shared shortcut tooltip (live bindings), labelled "← Space Center" at left, Share ▾ menu in File, share code in a Modal; unsaved dot + confirm on New/Load/Import only when dirty; library on shared Modal with search (stock + saved), sort, scale filter, PromptModal rename, folder/tags dialogs, delete confirm; `/` part search; stats drop whole readouts instead of clipping. |
| **UX-7 Flight shell (pause, apps, results)** | `src/flight/FlightScene.tsx`, `src/flight/hud/{Hud,TopBar,AppLauncher,HelpOverlay,FlightDataPanel,ResourcePanel,SciencePanel,AlarmPanel,AssistPanel}.tsx`, `hud.css`, `feel.css` | Pause menu: Resume first, grouped (Flight: revert/recover · Program: save/quicksave · Options: settings/controls/photo · Leave), `ConfirmModal` on reverts, hide Recover/Revert-to-editor in lessons; app windows register `useEscape` (layer 'panel', topmost closes first); F3 results register as 'modal' (fixes double action); app column layout manager (max height, no overlap with MAP/AUTO/crew); hints hidden off-context (EVA/orbit); `exitTo('spaceCenter')` goes to the hub (with UX-3 debrief); pause "Save as…" → `PromptModal`. **Done (op/ux7):** grouped pause menu (Resume first, arrow keys, confirms on reverts, practice shows only Restart), Esc stack for pause/help/F3/report/part panels (F3 double action fixed), app windows close on Esc while engaged (toolbar/window click) and hand Esc back to pause after any flight input, CSS app-column sharing (no overlap with MAP/AUTO), instant toolbar labels + distinct alarm/engineering glyphs, first-flight card hidden in EVA/map, exit lands on the hub with a report notice (seam for UX-3 in DECISIONS). Not done: EVA board prompt on the lamps (UX-9), scenario briefing card in the app column (`src/scenarios`, UX-4b). |
| **UX-8 Map & maneuver planning** | `src/flight/map/*`, `src/flight/hud/{ManeuverPanel,TransferWindow,DepartureOptions}.tsx`, `src/ui/map/*`, `mapMenus.css` | Planner visible by default when a node exists; keyboard node nudging (prograde/normal/radial ± with modifiers) and node cycling; node editor and transfer dialogs on the Esc stack; slimmer map info card (help moved to `?`); target/focus actions consistent with Tracking (shared `ui/map`). **done (op/ux8):** planner opens with the first node (a collapse sticks until the next new plan); ↑↓ prograde, →← normal, Alt+↑↓ radial, Shift ×10, Alt+→← cycle nodes, Del deletes the selected node (`ui/map/nodeKeys.ts`); node editor and info card are `panel`, transfer chart `modal`, Δv field edit `capture` (Esc reverts the field first); readout slimmed, with gestures and keys behind `?`; selects renamed "Plan transfer to…" / "Transfer window chart…"; context actions "Focus" / "Fly" as in Tracking, plus `info: false` for Tracking (UX-5 to adopt). |
| **UX-9 Docking & stations** | `src/flight/hud/{TargetPanel,CrewPanel,CrewCards,PartInspector}.tsx`, docking-mode UI | Port picker (choose own and target port from a list, highlight in 3D), alignment readout always next to the navball in docking mode, **station overview** for docked complexes (modules, crew per module, free ports, resources) with one-click crew transfer and "control from here"; EVA board prompt placement. |
| **UX-10 Settings & accessibility** (done: op/ux2 — search across tabs, per-tab reset with confirm, inline binding clashes + per-row reset, Advanced collapsed, Done top and bottom, fixed dialog height) | `src/ui/SettingsPanel.tsx`, `AdvancedGraphics.tsx`, `graphicsLabels.ts` | Settings search; per-tab reset; binding conflicts inline; collapse Advanced graphics by default; Done also bottom; reduce-motion respects UI transitions. |

Order: UX-1 merge first. Then UX-2…UX-10 can run in parallel. Two seams to sequence: UX-3's hub
debrief needs UX-7's `exitTo` change (ship UX-7's change behind the existing redirect, UX-3 flips it), and
UX-5/UX-8 both consume `src/ui/map/*` (UX-8 owns it; UX-5 requests changes).

## UX-1 as implemented (op/uiaudit)

- `src/ui/nav/escape.ts`: one window capture listener; `useEscape(fn, active, layer)`. Empty stack → Esc
  passes through untouched, so flight pause and editor "drop part" keep their own handling. First Esc in a
  text field blurs it (search boxes keep their text). Registered users: Modal, Settings (+ rebinding capture),
  map context menus, editor Load/Import dialogs, main-menu sub-panels, Training, Scenarios, Spacepedia,
  Tracking, and every `SceneHeader` screen.
- `src/ui/nav/SceneHeader.tsx` on Flight Log, Research Lab, Mission Control: "← Space Center (Esc)" plus a
  facility switcher (mode-aware: sandbox shows 3, career 5). Research → Missions is now 1 click.
- `src/ui/nav/arrowNav.ts`: geometric arrow-key focus for main menu, hub tiles, lessons, scenario list;
  `focusFirst` lands focus on a panel's primary action (New Game → Start, so Enter starts a game).
- Hub: number keys 1–6 enter the tile (hint shown on each tile); "Save as…" uses `PromptModal`.
- Main menu: Tab order follows the layout; focus returns to the opener after Esc.
- Editor: Esc leaves Action Groups; Esc closes the craft library and import dialogs.
- Stock Wren Tender blurb no longer shows a dev URL.

Verified in CDP Chrome (`uiaudit-verify.mjs`): arrow order on the main menu, Esc back from New Game/Continue/
Training/Scenarios/Spacepedia (first Esc in its search only blurs), Settings Esc while rebinding cancels the
capture and keeps Settings open, hub key 5 → Research Lab, switcher Research → Missions → Flight Log, Esc →
hub, Tracking: Esc closes the context menu first then leaves, editor library and Action Groups close on Esc,
flight Esc still pauses/resumes. No console errors.

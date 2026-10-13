# Planner text inventory (2026-10-12, op/lesstext)

The owner said the maneuver/transfer planner "can look bloated when planning transfers… I don't wanna read all that
text. Especially with the bad line wrapping". This is every line of text the planner showed on `main` (CDP Chrome,
1600×900 and 1440×900, orbit scenario; `C:\wsp-tools\shots\lesstext\before-*`) and what became of it
(`after-*`, also 1470×956). Driver: `C:\wsp-tools\drv\lesstext.mjs`.

Verdicts: **keep**, **shorten**, **tooltip** (moved to hover/`title`, still reachable), **visual** (replaced by a
picture), **merged**, **dropped** (said twice).

## Planner panel (262 px HUD column)

| Before | Verdict | After |
|---|---|---|
| `Maneuver planner ▾ · 1 node` | shorten | `Maneuver planner ▾` + count badge |
| Empty hint: "Click your orbit to add a node. Drag its handles: green prograde/retrograde, magenta normal, cyan radial. Click the node for exact values; arrow keys nudge… (? in the map readout)." (5 lines) | shorten + visual + tooltip | "Click your orbit to add a node" + coloured axis glyphs (prograde / normal / radial); the rest in the tooltip and the map `?` |
| Node row `#1 · 420.2 m/s · T−14m 58.2s` (wrapped onto 2 lines) | keep, fix wrap | `①  420.2 m/s  T−14m 58s` on one line; full time in tooltip. `Warp` → ⏩ icon (labelled) |
| `Node @ Ap` / `Node @ Pe` / `+2 min` (each wrapped onto 2 lines) | shorten | label column `Add node` + `Ap` `Pe` `+2m` |
| `Circularize @ Ap` / `@ Pe` | shorten | `Circularize` + `Ap` `Pe` (aria-labels unchanged) |
| `Plan transfer to…` select | shorten | `Transfer` + destination select (shows the chosen body) |
| `Transfer window chart…` select | merged | chart icon in the departures header (planets only) |
| "Precise map path · planners use patched conics. Allow correction burns." | shorten + tooltip | "Precise path · plans use patched conics" |
| `Planning… phase (NN%)` + bar + Cancel | keep | phase (ellipsis) · `NN%` · × over a thin bar |
| Plan message: "Mars transfer: 3387 m/s, burn in 22m 37.1s. Encounter in 83d 16h 33m, periapsis 125.3 km. Use Warp below to reach the burn; Assist → Execute next node can fly it." (5–6 lines) | visual | plan card: title + Δv, timeline Now —22m→ Burn (3m 20s) —83d→ Mars (Pe 125 km), one primary **Warp to burn**; assist hint in its tooltip; exact times in stop tooltips |
| `Show whole transfer` (full-width button) | shorten | frame icon (labelled) in the plan card and departures header |
| — | new visual | Δv budget bar under the node list: stage segments vs need (solid) + capture estimate (hatched); red "short N m/s" when it does not fit |
| `UPCOMING WINDOWS · MARS` | shorten | `Departures · Mars` |
| "Best by departure + capture Δv. Estimates; select to verify and create a node." | tooltip | header tooltip |
| Per option, 3 mono lines that wrapped to 4–6: kind + "best Δv", `Depart <full date UTC> · wait …`, `Departure ~… · capture ~… · flight …` | visual + shorten + tooltip | 2 lines: `Window ★  in 86d 7h  1896 m/s` / departure+capture bar · `83d 18h trip` (date shown from 360 px wide). Full date, wait, split and flight in the row tooltip |
| Error lines ("No transfer window found", "did not refine…") | keep | unchanged |

## Node editor (map)

| Before | Verdict | After |
|---|---|---|
| `Node 1 of 2 · T−30m 52.7s` | shorten | `Node 1/2 · T−30m 52s`; full time + all keys in the header tooltip |
| `PROGRADE` / `NORMAL` / `RADIAL` labels | visual | marker glyph + word in the handle colour |
| `Burn 52.0s (start T−30m 26.7s)` | shorten | `52.0s start T−30m 26s` (full in tooltip) |
| Δv, After (Ap/Pe), Encounter | keep | unchanged, nowrap |
| — | new visual | Δv budget bar (earlier nodes dim, this node solid) |
| Key help line "↑↓ prograde · →← normal · Alt+↑↓ radial · Shift ×10 · Alt+→← next node" | tooltip | header tooltip (also in the map `?` popover) |

## Transfer window chart (modal)

| Before | Verdict | After |
|---|---|---|
| Departure list (same 3-line rows) | visual | same compact rows as the planner, with dates |
| "FLIGHT TIME ↑ · DEPARTURE DATE →" | visual | real axes: flight-time min/max on the left, first/last departure date below |
| `<start UTC> → <end UTC> · flight 53d 5h 3m–110d 12h 20m` | visual | merged into the axes |
| Gradient + "Blue: lower Δv · red: higher Δv · dark: no solution" | visual | gradient labelled with its m/s range, swatches for "none" and the **best** cell, which is ringed on the chart |
| Hover: one long line "Depart … · arrive … · fly … · Δv … (departure … + capture …)" | shorten | fixed-height chips Depart / Arrive / Flight / Δv (dep+cap); full dates in tooltips; hovered cell outlined |
| "Grid estimates include circular capture. Click plans a verified encounter…" + "Hover for details. Click a cell to verify and plan its transfer." | merged + tooltip | "Hover a cell for details · click to plan it"; the caveat is the chart's tooltip |

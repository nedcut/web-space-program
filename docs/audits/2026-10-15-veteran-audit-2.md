> WIP (audit2, 2026-10-15). Notes so far; the full audit replaces this file.

- Career first flight, hand-built from starting parts (Lantern I + Bloom chute + Snap Ring 1 + Silo 1 + Sirocco, thermometer), flown straight up to 104 km apex: crew lost twice. Chute armed at 24 km and stayed "armed" to the ground (≈290 m/s at 700 m). No heat shield on the craft. Shots: C:\wsp-tools\shots\audit2\career\.
- Editor top bar ΔV is truncated ("1,8") next to LAUNCH; bottom-right readout footer overlaps the key-hint bar.
- Code check of the 10-07 items: ~75/90 sub-claims fixed, ~10 partly, ~8 not fixed (career content, 1.875 m size, engine plates, procedural tanks, cloud layers, Mach effect).
- Moon (sandbox Selene): assist to 82×83 km orbit (~4 min). The planner's ★ default is a 7d16h wait that saves only 36 m/s over "Go now"; at 82 km, warp is capped at 50–100× (RAILS_CLEARANCE, src/game/timewarp.ts:27), so the Execute-node assist crawls (8 game hours took ~8 real minutes; 7 days would take ~1.5 h). With "Go now": TLI done 0.1 m/s off plan, SOI warp-to, captured into 41.8 km lunar orbit.
- First-flight capsule without a heat shield: chute never opens (maxQ 25 kPa ≈ 204 m/s at sea level; bare pod falls at 260–300 m/s). No warning in the editor (Pre-flight "ready") or in flight (stays "armed"). With a shield and SAS retrograde: splashdown at 6 m/s, +22k cr debrief.
- SINK RATE caution under a fully open chute at 8 m/s (shots career-shield-retro/22c-full.png).
- PLAYTEST.md drafted.

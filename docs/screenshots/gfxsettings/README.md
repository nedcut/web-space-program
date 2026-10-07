# Advanced graphics menu — cx/gfxsettings

Captured from the collaborative Chromium browser on port 5327, 2026-10-07.

- `settings-1024x768.png`: 1024×768 viewport; dialog bounds (122,20)–(902,748), content scrolls.
- `settings-800x768.png`: 800×768 viewport; dialog bounds (20,20)–(780,748), no clipped selects.
- `settings-800x768-lower.png`: lower controls reached by scrolling the content; header/Done remain visible.

Both viewports have no horizontal page overflow. Every advanced row exposes a title tooltip and visible
cost explanation. Selecting Ultra then changing the Retina limit to 1.5 shows Custom (based on ultra)
and stores the base preset and override in `wsp.settings.v1`.

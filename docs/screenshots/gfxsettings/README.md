# Advanced graphics menu — cx/gfxsettings

Captured from the collaborative Chromium browser on port 5327, 2026-10-07.

- `settings-1024x768.png`: 1024×768 viewport; dialog bounds (122,20)–(902,748), content scrolls.
- `settings-800x768.png`: 800×768 viewport; dialog bounds (20,20)–(780,748), no clipped selects.
- `settings-800x768-lower.png`: lower controls reached by scrolling the content; header/Done remain visible.

Both viewports have no horizontal page overflow. Every advanced row exposes a title tooltip and visible
cost explanation. Selecting Ultra then changing the Retina limit to 1.5 shows Custom (based on ultra)
and stores the base preset and override in `wsp.settings.v1`.

`ultra-pad.png` is a hardware Windows Chrome/CDP capture at 1470×920 CSS / DPR 2, produced with the
owner's `C:\wsp-tools\drv\cdp2.mjs` after 60 seconds of preparation. `ultra-pad.json` records the exact
Ultra Earth/terrain settings, RTX 3060 Ti hardware renderer, 2940×1840 buffer, ~2,030 draws and WebGL error 0.
The screenshot was visually inspected after the loading overlay finished.

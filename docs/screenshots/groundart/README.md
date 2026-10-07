# Coastal ground art — real GPU review

Original procedural art only. Captured in Windows Chrome/CDP 9333 on NVIDIA RTX 3060 Ti, 1470 × 920 CSS pixels, **DPR 2 / Medium / render scale 1 / adaptive off**. Images are 2940 × 1840. Baseline is `b6ec2204`; after is the ground-art branch (including the later main merge where applicable). These are browser captures, not generated mockups.

| View | Before | After |
|---|---|---|
| Launch pad, chase camera | [Before](groundart-before-pad.png) | [After](groundart-after-pad.png) |
| Space Center overview | [Before](groundart-before-center.png) | [After](groundart-after-center.png) |
| Coastal land, 2 km | [Before](groundart-before-land.png) | [After](groundart-after-land.png) |
| Sunset, 120 m | [Before](groundart-before-sunset.png) | [After](groundart-after-sunset.png) |
| Earth night side, 900 km | [Before](groundart-before-night.png) | [After](groundart-after-night.png) |
| Moon surface, 8 m | [Before](groundart-before-moon.png) | [After](groundart-after-moon.png) |

Additional inspected view: [night pad and lit windows](groundart-after-night-site.png) (astronomical sun elevation −16°, night switch 1, window emission 1.8, WebGL error 0).

Reproduce with Windows Node running `scripts/groundart/capture.mjs <before|after> <base-url> [comma-separated-views]`. The script contains the fixed view URLs and camera settings. Chase heading is velocity-relative, so its settling direction can vary slightly between captures. Copy the scripts beside the supplied Windows `playwright-core` harness; the page-specific CDP connection uses its WebSocket transport and closes only its own contexts. Serve development previews on port 5334; the production build only includes the main game entry, so its preview URLs do not work. Set the same settings before loading each scene. `night-site.mjs` checks astronomical night activation and captures the pad without the hub overlay.

## Review and iterations

- Replaced conical site trees with branched, irregular crowns; the coarse LOD crossfades rather than appearing suddenly. They remain deliberately low-poly in silhouette.
- Warm cladding, façade courses, window masks, roof plant and signage give the site clearer material identity. Existing trench, deflector, mast, tank, crawlerway and runway geometry is retained and enriched rather than represented as new work.
- Terrain now receives the site's solar shadows. The broad footprint makes the tower/buildings read as grounded, at the cost of softer small-object shadow edges.
- Reduced the first grass variation pass after it read as camouflage from 2 km. The final landscape remains stylized and the existing broad river channel is conspicuous; this is not a geographic Florida reconstruction.
- Regolith grain is stronger at foot scale. Settlement lights remain restrained and follow fictional coastal/temperate land masks, not actual city data.
- Kept the existing atmospheric integration and warm golden-hour illumination. No new sky pass or independent fog plane is added.

All accepted captures were visually inspected; the six-view shader sweep returned WebGL error 0. A standalone-preview comparison-sampler failure found during development was fixed with an explicit complete depth fallback before accepting the images. Temporary failed/merge-overlay captures are excluded.

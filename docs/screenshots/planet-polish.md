# Planet visual polish

All captures use Standard scale, 1280×800, ACES at exposure 1, and Medium quality unless specified. Start the isolated preview with `npx vite --port 5181 --strictPort`.

Capture with `node scripts/shot.mjs "http://localhost:5181/planet-preview.html?..." docs/screenshots/name.png 15000`. For terrain, wait for `window.__preview.ready` before the 15-second capture delay; the initial bake can take longer on a busy SwiftShader host. URL latitude values now retain sub-degree precision, which is necessary for ring-plane flythroughs.

| Capture | Query parameters after `?` |
| --- | --- |
| `saturn-before.png`, `saturn-after.png` | `body=saturn&alt=18000000&lat=24&lon=0&hour=10&dec=20&ui=0` |
| `saturn-rings-closeup-before.png` | `body=saturn&alt=4400000&lat=0.0002&lon=0&pitch=-15&head=90&hour=12&dec=20&ui=0` (original preview rounded latitude to zero; nearby ring geometry was also clipped) |
| `saturn-rings-closeup.png` | `body=saturn&alt=4400000&lat=0.0003&lon=0&pitch=-90&head=0&hour=13&dec=20&fov=100&ui=0` |
| `saturn-hexagon.png` | `body=saturn&alt=13000000&lat=80&lon=0&hour=12&dec=35&ui=0` |
| `enceladus-before.png`, `enceladus-plume.png` | `body=enceladus&alt=55000&lat=-20&lon=0&hour=16&dec=-20&ui=0&settle=1` |
| `titan-haze.png` | `body=titan&alt=750000&lat=20&lon=0&hour=15&dec=10&ui=0&settle=1` |
| `earth-night.png` | `body=earth&alt=1600000&lat=35&lon=-25&hour=19&dec=10&ui=0&settle=1` |
| `earth-aurora.png` | `body=earth&alt=1600000&lat=65&lon=-25&hour=19&dec=10&ui=0&settle=1` |
| `sun-closeup.png` | `body=sun&alt=150000000&lat=15&lon=0&ui=0` |
| `jupiter-storms.png` | `body=jupiter&alt=17000000&lat=-15&lon=70&hour=11&dec=0&ui=0` |
| `neptune-dark-spot.png` | `body=neptune&alt=7000000&lat=-10&lon=-115&hour=11&dec=0&ui=0` |
| `io-plumes.png` | `body=io&alt=420000&lat=10&lon=95&hour=14&dec=0&ui=0&settle=1` |
| `europa-lineae.png` | `body=europa&alt=350000&lat=20&lon=25&hour=10&dec=10&ui=0&settle=1` |

## Implementation notes

- Ring ice is visual scenery, with two instanced geometry LODs. A seeded 160 m body-fixed cell grid supplies a camera-local field (800 m Medium, 1280 m High), sampled from the same opacity profile as the distant rings. Only local offsets reach instance buffers. Field boundaries use an opaque dither fade. The camera near plane shrinks while inside the field. Chunks have no collision or orbital dynamics.
- Low disables resolved chunks, extra volume shells/plumes, coastal lights and aurora; gas noise uses fewer octaves. Budgets live in `src/render/core/quality.ts`.
- Enceladus/Io plumes are bounded emissive scattering approximations, not fluid simulations. Their extent is exaggerated for readability. Titan's visual atmosphere is capped at 26% of its radius at compressed scales; this leaves the physics atmosphere unchanged. The detached layer is analytic, with a subtle cool tint above the orange haze.
- Planetshine uses a Lambert-sphere phase law and source solid angle. A moon receives directional, tinted light from its parent when that parent's renderer is live in the same scene. Standalone planet previews have no parent renderer, so they do not demonstrate moon planetshine. No ring shadows on moons are implemented.
- Earth settlements follow procedural land elevation, coastal preference and population noise; they are not a geographic city database. The solar close-up uses an artistic exposure transition from distant HDR radiance to a readable photosphere.

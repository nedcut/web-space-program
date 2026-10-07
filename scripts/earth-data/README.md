# Earth geography build

Run `npm ci --prefix scripts/earth-data` then `node scripts/earth-data/build.mjs` from the repository root. Node downloads the 444 MiB ETOPO 2022 60-second ice-surface GeoTIFF into ignored `.cache/`. Delete that file to download again. The pinned GeoTIFF dependency is build-only; no game dependency is added. The decoder reads bounded strips. Output is a 4096×2048 signed little-endian metre grid (16 MiB), with source/output SHA-256 recorded in the manifest. The source includes bathymetry and Antarctic/Greenland ice surface. No optional pack is required.

The projection, pixel centres, axis conventions and limitations are specified in `public/earth/manifest.json`. Use its north-first `v` for textures; the existing cloud mask has south-first rows and handles that independently.

## Runtime integration / graphics coordination

Browser entry points await `loadEarthData()` in `game/earthLoader.ts`. Node tests install bytes using the Vitest setup file; the server does the same at startup. Other Node scripts must run with `node --import tsx --import ./scripts/earth-data/register.ts <script.ts>`. `sim/terrain/earthData.ts` has no host I/O, DOM or renderer imports. Terrain creation deliberately throws if initialization was omitted rather than returning a different planet. Workers receive the buffer before their first Earth init message. Cross-origin-isolated hosts share a 16 MiB SharedArrayBuffer; ordinary hosts retain one 16 MiB copy per worker plus the main copy. No float64 raster is allocated: interpolation promotes four int16 samples to JS numbers.

`createTerrain(earth).heightAt` now represents real terrain, so the existing `cloudLandMask(heightAt)` gets real coastlines automatically. Its south-first rows are intentionally different from the height asset's north-first rows. Imagery should align with manifest UVs. Do not infer texture orientation from three.js's default sphere UVs.

Science biome IDs are persistent human-readable strings. All seven legacy Earth IDs are retained **unchanged** as an identity migration: archives, subject-key decay, onboard measurements and accepted contracts remain valid. New `Forests`, `Rainforests`, `Tundra` IDs extend the catalog. Old records describe where science was earned on the previous geography; they are not reclassified from nonexistent coordinates. Newly collected measurements use real elevations plus approximate geographic climate regions. Original named airfields/stations retain their IDs.

# Earth geography build

Run `npm ci --prefix scripts/earth-data` then `node scripts/earth-data/build.mjs` from the repository root. Node downloads the 444 MiB ETOPO 2022 60-second ice-surface GeoTIFF into ignored `.cache/`. Delete that file to download again. The pinned GeoTIFF dependency is build-only; no game dependency is added. The decoder reads bounded strips. Output is a 4096×2048 signed little-endian metre grid (16 MiB), with source/output SHA-256 recorded in the manifest. The source includes bathymetry and Antarctic/Greenland ice surface. No optional pack is required.

The projection, pixel centres, axis conventions and limitations are specified in `public/earth/manifest.json`. Use its north-first `v` for textures; the existing cloud mask has south-first rows and handles that independently.

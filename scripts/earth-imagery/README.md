# Earth imagery build

`npm run earth:imagery` (or `npm ci --prefix scripts/earth-imagery && node scripts/earth-imagery/build.mjs`) rebuilds
`public/earth/imagery/` from public-domain sources cached in `scripts/earth-imagery/.cache/` (≈ 330 MB, git-ignored):
NASA Blue Marble Next Generation (12 monthly 21600×10800 composites), NASA Black Marble 2016 lights, the Blue Marble
cloud composite, NASA GIBS GHRSST MUR L4 sea ice (mid-month 2019) and Natural Earth coast/lake polygons. Source URLs
and SHA-256 of every input and output are written to `public/earth/imagery/manifest.json`; credits are in
`public/earth/ATTRIBUTION.md`.

Outputs (WebP): bundled `base/` (2k and 4k monthly colour, 2k/4k water masks, 4k lights and clouds; ≈ 13 MB, precached
by the PWA) and the `packs/8k/` pack (≈ 25 MB, in git, fetched on demand and kept in Cache Storage). `--ultra` also
builds `packs/16k/` (≈ 73 MB, git-ignored): host it next to the app for Ultra; without it Ultra falls back to 8k.
`--month=07` rebuilds one month (manifest untouched). A full `--ultra` build takes ~40 min on one core.

Conventions: equirectangular, rows north → south, `u = lon/2π + 0.5`, `v = 0.5 − lat/π` (the same as
`public/earth/manifest.json`). Day images are RGB only; the water fraction is a separate lossless greyscale image
(merged into the colour texture's alpha on the GPU at load). Sea ice is blended over water in the monthly colour.

Regional flight pack: `node scripts/earth-imagery/ground.mjs` builds the Gulf/Caribbean
colour and urban/night channels from NASA GIBS and Natural Earth. Sources are cached
in `.cache/ground/`; output and provenance live in `packs/gulf-v2/`. The colour is a
static composite at ~1 km, independent of the global monthly pyramid. It is fetched
on demand, not precached with the application.

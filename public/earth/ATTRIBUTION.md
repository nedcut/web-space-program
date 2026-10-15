# Earth geography attribution

NOAA National Centers for Environmental Information (2022), **ETOPO 2022 15 Arc-Second Global Relief Model**, 60 arc-second ice-surface derivative, doi: https://doi.org/10.25921/fd45-gt74.

Source: https://www.ncei.noaa.gov/products/etopo-global-relief-model
Licence: **CC0 1.0 Universal Public Domain Dedication**. NOAA waives potential copyright and related rights worldwide, as recorded at https://www.ncei.noaa.gov/access/metadata/landing-page/bin/iso?id=gov.noaa.ngdc.mgg.dem%3Aetopo_2022 . No endorsement by NOAA is implied. Download URL and hashes are in manifest.json.

Game derivative: resampled signed elevation/bathymetry; artificial launch plateau and deterministic sub-grid detail. Geographic climate classes are original approximations, not a satellite land-cover dataset. Not for navigation or surveying.

# Earth imagery attribution (`imagery/`)

Built reproducibly by `scripts/earth-imagery/build.mjs`; source URLs and SHA-256 hashes are in `imagery/manifest.json`.

- **NASA Earth Observatory / NASA Visible Earth — Blue Marble Next Generation** (Reto Stöckli, NASA Earth Observatory; MODIS data, monthly composites for 2004, "land surface, shallow water" without shaded relief). Public domain (NASA imagery). Credit: *NASA Earth Observatory*.
- **NASA Earth Observatory — Earth at Night / Black Marble 2016** (Joshua Stevens and Miguel Román, NASA Earth Observatory; Suomi NPP VIIRS day–night band), 3 km grayscale. Public domain. Credit: *NASA Earth Observatory / NASA Black Marble*.
- **NASA Visible Earth — Blue Marble cloud composite** (Terra/MODIS, 2001–2002; NASA Goddard Space Flight Center). Public domain. Credit: *NASA Visible Earth*.
- **NASA GIBS — GHRSST Level 4 MUR 0.25° sea ice concentration and SST** (JPL PO.DAAC / Group for High Resolution SST), mid-month 2019, used for monthly sea ice. NASA data, no restrictions. Credit: *NASA Global Imagery Browse Services (GIBS)*.
- **Natural Earth** 1:10m land, lakes and Antarctic ice shelves (v5.1.2), used for the water mask. Public domain.

Game derivative: resampled to an equirectangular pyramid (WebP), with a water mask, sea ice blended over water, and a luminance-only reflectance curve applied at render time. No NASA endorsement is implied. Not for navigation.

## Regional flight surface pack (`imagery/packs/gulf-v1/`)

NASA GIBS **BlueMarble_NextGeneration** (unshaded static colour composite) and
**VIIRS_Black_Marble**, 2016-01-01, public-domain NASA imagery; credit NASA Earth
Observatory and NASA Black Marble. **Natural Earth v5.1.2 1:10m urban areas**, public
domain, supplies urban footprints. Source request URLs, SHA-256 hashes, projection,
channel meanings and derivative hashes are recorded in the pack's `manifest.json`.
Rebuild with `node scripts/earth-imagery/ground.mjs` after installing that directory's
dependencies. The regional colour is static, not a monthly observation. Fine streets,
roofs and land-cover detail are original illustrative patterns, not surveyed features.
No endorsement is implied; not for navigation.

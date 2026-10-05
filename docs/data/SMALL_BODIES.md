# Small-body sources

Orbital elements: [NASA/JPL Horizons API](https://ssd-api.jpl.nasa.gov/doc/horizons.html), heliocentric ecliptic J2000, osculating at JD 2451545.0 TDB, kilometres/seconds converted to metres/seconds. Exact responses and query URLs are in `small-bodies-horizons.json`; regenerate from the repository root with `python3 docs/data/fetch-small-bodies.py`. Comet records are explicitly selected (Halley 90000030; 67P 90000700, the 2002 solution nearest J2000).

Physical parameters: [NASA/JPL SBDB API](https://ssd-api.jpl.nasa.gov/doc/sbdb.html); `small-bodies-jpl.json` retains values, uncertainties and publication references. Diameter becomes mean radius; GM converts km³/s² to m³/s²; rotation converts hours to seconds. Halley lacks a measured GM in this snapshot: 2.2×10¹⁴ kg × G is an estimate. Rotation is a fixed representative period, not a tumbling solution. Missing poles use zero axial tilt and are not claimed as measured.

Mission facts: NASA [Vesta](https://science.nasa.gov/solar-system/asteroids/4-vesta/), [Bennu](https://science.nasa.gov/solar-system/asteroids/101955-bennu/), [Eros](https://science.nasa.gov/solar-system/asteroids/433-eros/), [Psyche](https://science.nasa.gov/solar-system/asteroids/16-psyche/), [Halley](https://science.nasa.gov/solar-system/comets/1p-halley/); ESA [Rosetta](https://www.esa.int/Science_Exploration/Space_Science/Rosetta); JAXA [Hayabusa2](https://www.hayabusa2.jaxa.jp/en/).

The shapes are original procedural approximations. Hygiea remains classified as an asteroid/dwarf-planet candidate, not an officially recognized dwarf planet. All `asteroid-NNN` objects are fictional and deterministic. Hale–Bopp is not included.

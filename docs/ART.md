# Art direction: parts, liveries and presentation

This document describes how Web Space Program hardware should look. All art is procedural and original: no
external images, fonts beyond system sans-serif, or third-party game assets, names or logos.

## Look in one sentence

The style is **stylised-realistic flight hardware**: real aerospace materials and construction logic, cleaned up and
slightly idealised, with clear silhouettes, restrained colour and crisp markings. Parts should look like flight-ready
hardware that has been handled a little and flown a little. They should not look like toys or battle-worn props.

## Palette

| Role | Colour | Use |
|---|---|---|
| Thermal white | `#F2F1EC` | Primary airframe paint (tanks, fairings, nose cones) |
| Satin white | `#F3F2EE` | Composite shells, canisters, SRB casings |
| Charcoal | `#2F3237` | Interstages, adapters, separators, roll-pattern quadrants |
| Airframe grey | `#C6C9CE` | Wings, fins, aircraft skins |
| Foam orange | albedo ramp `#E0702A` to `#C25A22` | Insulated cryogenic/kerolox tanks |
| Gunmetal | `#4B5058` | Machined fittings, flanges, brackets |
| Dark metal | `#34373C` | Bulkheads and caps (semi-metallic, so it never reads pure black) |
| Bare metals | steel `#DFE2E6`, aluminium `#B9BEC6`, titanium `#9EA5AF` | Brushed structure, pressure vessels |
| MLI gold / silver | `#E6B04A` / `#D8DBE0` | Thermal blankets on probes, landers and engine mounts |
| Hazard yellow | `#E8B21C` over `#17181A` | Separation planes, ordnance and moving hardware |
| Agency blue | `#2F8FD6` on `#1A2230` | Program insignia |

Accent paint is kept to **one livery colour per part**, used on narrow bands and markings. A part must never be more
than about 10% accent colour.

## Material families

All families are shared `MeshStandardMaterial`/`MeshPhysicalMaterial` instances from `src/render/parts/materials.ts`.
Their texture sets come from `src/render/parts/texgen/recipes.ts`.

| Family | Materials | Texture set (tile) | Notes |
|---|---|---|---|
| White thermal paint | `whitePanel`, `greyPanel`, `charcoalPanel` | `panel` (1 m) | Seams every 0.5 m, circumferential weld at mid-tile, rivet rows, access panel, stringer pillowing, grime streaks below seams, paint chips that expose metal (ORM metalness). Clear coat 0.25 to 0.35. |
| Smooth paint/composite | `satinWhite`, `blackPaint`, `accent(*)` | `smooth` (1 m) | Faint orange peel and one seam. Accents use a stronger clear coat (0.6). |
| Insulating foam | `orangeFoam` | `foam` (1.5 m) | Soft lumps, spray rind and sparse pores, with UV-tan colour variation baked into the albedo. Matte, no metal. |
| Brushed/bare metal | `steel`, `aluminium`, `titanium` | `brushed` (1 m) | Circumferential grain and a weld with straw/blue temper tint. |
| Machined/anodised | `gunmetal`, `darkMetal`, `chrome`, `anodised(*)`, `redOxide` | `metal` (0.5 m) | Soft handling smudges and fine lathe rings. Anodised hardware uses livery colours. |
| MLI foil | `goldFoil`, `silverFoil` | `foil` (1 m) | Elongated crinkle facets, sharp creases and Kapton-style tape seams every 0.5 m. Physical material with `anisotropy` 0.45, so highlights streak around the part. |
| Heat-shield ablator | `ablator`, `heatTiles`, `shingle` | `ablator` (0.5 m, about 2 cm honeycomb), `tiles`, `shingle` | Charred resin with tan filler. Tiles are staggered with tone and char variation. |
| Engine hot section | `copperTubes`, `steelTubes`, `nozzleExt`, `scorched`, `soot` | `tubes`, `nozzleExt`, `scorch` | Regen tubes darken toward the throat. Extensions run from straw at the hot end through purple to blue-grey. Boat-tails and aft skirts use `scorched`, with soot streaking toward the nozzle. |
| Glass | `glass` | — | Dark tinted physical glass with a strong clear coat, set in a bevelled bezel over a dark gasket plate. |
| Composites and cells | `carbon`, `solarCells` | `carbon` (0.1 m twill), `solar` | Both use a clear coat. |
| Rubber | `tyre`, `rubber` | `tread` | Lugs repeat around the tyre and chevrons run across the tread. |
| Deck/tread plate | `deckPlate` | `treadPlate` | Ladders, walkways and girders. |

Rules:

- **Do not add new one-off materials.** Pick a family. If a variant is unavoidable, add it to `M` so it stays shared,
  because every new material breaks vessel static batching.
- Geometry UVs are in metres divided by the tile size (`lathe`, `cylinder` and `box` already do this). Keep the scale
  consistent so seams and rivets match across stacked parts. `vOffset` continues the texture between sections.
- Use normal, roughness and AO maps for detail smaller than about 2 cm. Use geometry only for silhouette and for
  details that cast visible shadows (bezels, hinges, hoses, ribs).
- Every material must look right under `scene.environment` (PMREM). Never rely on direct lights alone, and keep
  metalness below 1 for dark parts so they don't turn into black mirrors.

## Wear and grime

- Wear is subtle and physically motivated: streaks run downward (toward the engines) from seams and rivets, chips
  form only along seams, and soot sits only on engine-adjacent surfaces (`scorched`, `soot`, and the gas-generator
  exhaust).
- Decals carry a light speckle erosion, so they read as stencilled paint rather than prints.
- Brand-new and flight-worn variants are not separate materials. Keep a single, lightly used state.

## Markings and decals

Decals are drawn procedurally into one 2048×2048 Canvas atlas (`src/render/parts/decals.ts`). Every decal on every
part uses the single alpha-tested `decal` material, so decals stay in the opaque pass and merge into vessel static
batches. Builders place them with `Markings` (`builders/markings.ts`), which conforms quads to surfaces of
revolution or to planes.

| Marking | Where |
|---|---|
| Maker badge (mark + wordmark) | Long tanks, SRB casings and fairing halves, running vertically up the side (reads bottom to top). Short parts, nose cones and engine skirts use a horizontal badge. |
| Part plate (name + `CODE-serial`, livery bar) | Near the base of tanks and SRBs, on engine mount rings and on adapters. |
| Agency insignia | Upper body of tanks, SRBs, fairings and crew pods. Use one per part, on the side opposite the plate. |
| Stencils | `LOX` / `FUEL` on tanks, `NO STEP` on pod shoulders, `RESCUE` and an arrow on crew hatches, and `LIVE MOTOR` with warning triangles on SRBs. |
| Hazard | The yellow/black band material on separation planes and leg glands. Warning triangles go on pyro boxes. |

Rules: keep at least 3 cm of clearance from seams and frames; stay at about 0.3 times the part radius or smaller,
except for the vertical badge; use light ink on charcoal, scorched and dark paint (`badgeDark`, `plateDark`); and
never place decals on moving or deployable parts unless they are added to that part's animated group (as the
fairing halves are).

## Manufacturer liveries

These are defined in `src/render/parts/livery.ts`. All marks are original geometric designs.

| Maker | Code | Accent | Mark |
|---|---|---|---|
| Halvorsen Propulsion Works | HPW | burnt orange `#D9601E` | Nozzle bell with three flame chevrons in a ring |
| Kettle & Fuse Pyrotechnics | K&F | signal red `#B3261E` | Round charge with a fuse and a four-point spark |
| Tessellate Structures | TSS | teal `#1C7A78` | Isometric cube made of three rhombi |
| Greywater Aerodynamics | GWA | sky blue `#1F5AA6` | Swept delta over three wave lines |
| Northlight Crew Systems | NCS | gold `#C8962C` on navy `#1D3F78` | Four-point north star in a ring |
| Brightfield Autonomics | BFA | amber `#E0A91E` | Rising half-sun with rays over a horizon bar |
| Lumen & Volt | L&V | green `#2B8A5E` | Lightning bolt in a ring |
| Aldercrest Aeroengines | ACA | maroon `#8E2B3A` | Leaf crest between two swept wings |
| Tarmac & Tread Undercarriage Co. | T&T | yellow `#E8B622` | Tyre ring with tread blocks |
| Bedrock Process Engineering | BPE | ochre `#9A5A2C` | Mountain cut into strata bands |
| Agency (Web Space Program) | WSP | blue `#2F8FD6` | Planet disc, orbit ellipse and star |

## Texture pipeline

- Recipes are DOM-free functions that return RGBA8 albedo (sRGB), tangent-space normal and packed **ORM**
  (R = AO, G = roughness, B = metalness). three.js samples those exact channels for `aoMap`, `roughnessMap` and
  `metalnessMap`, so one texture serves all three. Material `roughness`/`metalness` scalars multiply the channels.
- A pool of up to two module workers (`texgen/worker.ts`) generates the sets and stores them in IndexedDB
  (`wsp-part-textures`, key `name@vTEX_VERSION`, with older versions pruned). Repeat visits load in milliseconds.
  **Bump `TEX_VERSION` whenever a recipe changes.**
- The main thread creates full-size `DataTexture`s right away, filled with a flat placeholder in the family's average
  colour. Arriving images are copied into those buffers, so every material and repeat clone updates in place.
  `partTexturesReady()` resolves once all requested sets have arrived (editor thumbnails wait for it).
- In headless Node (tests or the server), no textures are created and materials fall back to their flat parameters.

## Geometry, LOD and budgets

- A typical part should stay under 6k triangles. The largest engines and clusters are capped at 10k, and
  `tests/partsMesh.test.ts` enforces the budgets.
- `buildPartMesh(def, 'low')` builds a separate template at half tessellation (lathes, tubes, tori, spheres and
  rods) with no decals. The **Low** quality preset (`partDetail: 'low'`) selects it for flight.
- Bevel by profile instead of adding loops: lathe profiles insert a crease where they turn by more than 35°, and
  repeating a point creates a hard edge.

## Lighting and environments

- **Flight:** `render/core/skyEnv.ts` re-bakes a PMREM sky, ground and planetshine environment from the local
  vertical, sun direction, air density and the apparent size of the body below. On the pad this gives a blue sky
  dome, a warm low-sun horizon and a dim ground bounce. In orbit it gives black space with planetshine from below.
  It re-bakes only when the quantised inputs change, at most four times per second.
- **Hangar, preview and thumbnails:** `render/core/studioEnv.ts` provides a procedural softbox studio with
  `hangar`, `preview` and `thumbnail` variants.

## Exhaust

Plumes (`render/parts/plume.ts`) follow propellant chemistry:

- Kerolox is orange-yellow and sooty, with bright shock diamonds at sea level.
- Hydrolox is a nearly invisible pale blue-violet.
- Methalox has a blue-violet core.
- Solids are thick, bright and smoky.

Plumes are narrow and diamond-studded near sea level, then balloon into a wide, faint cone in vacuum. Length,
brightness and diamond spacing all scale with throttle.

## Screenshots

Before and after shots are in `docs/screenshots/art/`.

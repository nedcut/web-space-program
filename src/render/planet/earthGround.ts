/** Flight terrain only. Regional imagery is north-first, matching the global EarthUV contract. */
export const GLSL_EARTH_GROUND = /* glsl */ `
uniform sampler2D uEarthRegionDay;
uniform sampler2D uEarthRegionData;
uniform float uEarthRegionOn;
float earthRegionWeight(EarthUV r, float dist) {
  vec2 edge = min(r.uv, 1.0 - r.uv);
  return uEarthRegionOn * smoothstep(0.0, 0.04, min(edge.x, edge.y))
    * (1.0 - smoothstep(uPlanetRadius * 0.06, uPlanetRadius * 0.16, dist));
}
// Filter each street axis independently; unresolved roads approach their area average instead of flickering.
float earthRoads(vec2 p, vec2 footprint) {
  vec2 edge = abs(fract(p) - 0.5);
  vec2 aa = max(footprint, vec2(0.002));
  vec2 road = 1.0 - smoothstep(vec2(0.022) - aa, vec2(0.022) + aa, edge);
  road = mix(road, vec2(0.044), smoothstep(vec2(0.15), vec2(0.65), footprint));
  return max(road.x, road.y);
}
// Land-use cues follow the satellite palette. These small-scale patterns are illustrative, not surveyed.
vec3 earthGroundColour(vec3 c, float urban, float density, vec2 p, vec2 footprint, float cover, float hd, out float roads) {
  roads = 0.0;
  float detail = 1.0 - smoothstep(80.0, 300.0, max(footprint.x, footprint.y));
  float green = smoothstep(1.02, 1.45, c.g / max(c.r, 0.002));
  float forest = green * (1.0 - smoothstep(0.10, 0.24, dot(c, vec3(0.3, 0.6, 0.1))));
  float field = earthHash(floor(p / vec2(190.0, 130.0))) - 0.5;
  // Dark green gets clustered canopy; lighter cultivated land gets restrained field boundaries.
  c *= 1.0 + detail * (field * 0.18 * green * (1.0 - forest) + hd * 0.6 * forest);
  float damp = green * (1.0 - smoothstep(0.035, 0.09, c.r));
  c = mix(c, c * vec3(0.77, 0.91, 0.88), damp * smoothstep(0.40, 0.67, cover) * detail * 0.35);
  if (urban <= 0.001) return c;
  roads = earthRoads(p / 36.0, footprint / 36.0);
  vec2 parcel = p / 18.0, parcelAA = footprint / 18.0;
  float resolved = 1.0 - smoothstep(0.18, 0.65, max(parcelAA.x, parcelAA.y));
  float roof = earthHash(floor(parcel));
  vec2 box = abs(fract(parcel) - 0.5);
  vec2 mask = 1.0 - smoothstep(vec2(0.22) - parcelAA, vec2(0.22) + parcelAA, box);
  float buildings = mix(0.32, mask.x * mask.y, resolved);
  vec3 roofs = mix(vec3(0.08, 0.09, 0.095), vec3(0.19, 0.18, 0.16), mix(0.5, roof, resolved));
  // Tree-lined suburbs give way to more paved, closely built cores where Black Marble is brighter.
  vec3 fabric = mix(c * 0.88, roofs, clamp(buildings + density * 0.35, 0.0, 1.0));
  fabric = mix(fabric, vec3(0.055, 0.06, 0.064), roads * detail * 0.7);
  return mix(c, fabric, urban);
}
`;

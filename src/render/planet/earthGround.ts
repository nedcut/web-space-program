/** Flight terrain only. Regional imagery is north-first, matching the global EarthUV contract. */
export const GLSL_EARTH_GROUND = /* glsl */ `
uniform sampler2D uEarthRegionDay;
uniform sampler2D uEarthRegionData;
uniform float uEarthRegionOn;
EarthUV earthRegionUV(EarthUV e) {
  EarthUV r;
  r.uv = (e.uv - vec2(80.0 / 360.0, 55.0 / 180.0)) * vec2(9.0, 7.2);
  r.dx = e.dx * vec2(9.0, 7.2); r.dy = e.dy * vec2(9.0, 7.2);
  return r;
}
float earthRegionWeight(EarthUV r, float dist) {
  vec2 edge = min(r.uv, 1.0 - r.uv);
  return uEarthRegionOn * smoothstep(0.0, 0.04, min(edge.x, edge.y))
    * (1.0 - smoothstep(uPlanetRadius * 0.06, uPlanetRadius * 0.16, dist));
}
// Filter each street axis independently; unresolved roads approach their area average instead of flickering.
float earthRoads(vec2 p, vec2 footprint) {
  vec2 edge = abs(fract(p) - 0.5);
  vec2 aa = max(footprint, vec2(0.002));
  vec2 road = 1.0 - smoothstep(vec2(0.045) - aa, vec2(0.045) + aa, edge);
  road = mix(road, vec2(0.09), smoothstep(vec2(0.15), vec2(0.65), footprint));
  return max(road.x, road.y);
}
// Land-use cues follow the satellite palette. These small-scale patterns are illustrative, not surveyed.
vec3 earthGroundColour(vec3 c, float urban, vec2 p, vec2 footprint, float cover, float hd, out float roads) {
  roads = earthRoads(p / 72.0, footprint / 72.0);
  float detail = 1.0 - smoothstep(80.0, 300.0, max(footprint.x, footprint.y));
  float green = smoothstep(1.02, 1.45, c.g / max(c.r, 0.002));
  float forest = green * (1.0 - smoothstep(0.10, 0.24, dot(c, vec3(0.3, 0.6, 0.1))));
  float field = earthHash(floor(p / vec2(190.0, 130.0))) - 0.5;
  // Dark green gets clustered canopy; lighter cultivated land gets restrained field boundaries.
  c *= 1.0 + detail * mix(field * 0.22, hd * 0.6, forest);
  float damp = green * (1.0 - smoothstep(0.035, 0.09, c.r));
  c = mix(c, c * vec3(0.77, 0.91, 0.88), damp * smoothstep(0.40, 0.67, cover) * detail * 0.35);
  float roof = earthHash(floor(p / 72.0));
  vec3 fabric = mix(vec3(0.12, 0.135, 0.13), vec3(0.29, 0.275, 0.24), roof);
  fabric = mix(fabric, vec3(0.065, 0.071, 0.075), roads * detail);
  return mix(c, fabric, urban * 0.82);
}
`;

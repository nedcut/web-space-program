/** Flight terrain only. Regional imagery is north-first, matching the global EarthUV contract. */
export const GLSL_EARTH_GROUND = /* glsl */ `
uniform sampler2D uEarthRegionDay;
uniform sampler2D uEarthRegionData;
uniform float uEarthRegionOn;
uniform sampler2D uEarthUrbanDetail;
float earthRegionWeight(EarthUV r, float dist) {
  vec2 edge = min(r.uv, 1.0 - r.uv);
  return uEarthRegionOn * smoothstep(0.0, 0.04, min(edge.x, edge.y))
    * (1.0 - smoothstep(uPlanetRadius * 0.06, uPlanetRadius * 0.16, dist));
}
// Land-use cues follow the satellite palette. These small-scale patterns are illustrative, not surveyed.
vec3 earthGroundColour(vec3 c, float urban, float density, vec2 p, vec2 footprint, float cover, float hd, vec2 dx, vec2 dy, out float roads) {
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
  vec3 tile = textureGrad(uEarthUrbanDetail, p / 384.0, dx / 384.0, dy / 384.0).rgb;
  roads = tile.g;
  vec3 roofs = mix(vec3(0.06, 0.07, 0.075), vec3(0.19, 0.18, 0.16), tile.r);
  vec3 fabric = mix(c * 0.88, roofs, clamp(tile.b + density * 0.3, 0.0, 1.0));
  return mix(c, fabric, urban);
}
`;

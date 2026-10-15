/** Bounded Gulf projection. The polynomial error is below 1 m on Standard Earth;
 * callers use exact spherical UVs outside 7..38 degrees north and -120..-60 longitude.
 * Terrain interpolation and the imagery's ~1 km source samples are much coarser.
 */
export const GLSL_EARTH_REGION_UV = /* glsl */ `
vec2 earthRegionProjection(vec3 n) {
  float t = n.x / -n.y, t2 = t * t;
  float lon = t * (0.9999999752 + t2 * (-0.3333280025 + t2 * (0.1998113012
    + t2 * (-0.1403602874 + t2 * (0.09558523136 - t2 * 0.04222318579)))));
  float z = n.z - 0.38;
  float lat = 0.3897962116 + z * (1.081097660 + z * (0.2401199212 + z * (0.3171337799
    + z * (0.2660056389 + z * (0.3351392725 + z * (0.4833208278 + z * 0.5710138322))))));
  return vec2(lon * (0.5 / 3.14159265359) + 0.25, 0.5 - lat / 3.14159265359);
}
`;

/** Flight terrain only. Regional imagery is north-first, matching the global EarthUV contract. */
export const GLSL_EARTH_GROUND = /* glsl */ `
uniform sampler2D uEarthRegionDay;
uniform sampler2D uEarthRegionNight;
uniform float uEarthRegionOn;
uniform float uEarthRegionView;
uniform sampler2D uEarthUrbanDetail;
float earthRegionWeight(EarthUV r, float dist) {
  if (uEarthRegionView <= 0.0 || uEarthRegionOn < 0.5 || dist >= uPlanetRadius * 0.16 || dist <= 250.0) return 0.0;
  vec2 edge = min(r.uv, 1.0 - r.uv);
  return uEarthRegionView * smoothstep(250.0, 750.0, dist) * smoothstep(0.0, 0.04, min(edge.x, edge.y))
    * (1.0 - smoothstep(uPlanetRadius * 0.12, uPlanetRadius * 0.16, dist));
}
vec3 earthGroundColour(vec3 c, float density, EarthUV uv, float hd, float dist, out float roads) {
  roads = 0.0;
  // Keep the imagery's land-cover colours. Fine canopy only modulates their brightness.
  c *= 1.0 + hd * 0.4;
  if (density < 0.008) return c;
  vec2 scale = vec2(0.618, 0.4363) * (uPlanetRadius / 3072.0);
  vec2 dx = uv.dx * scale, dy = uv.dy * scale;
  float footprint = max(length(dx), length(dy)) * 2048.0;
  float detail = (1.0 - smoothstep(4.0, 12.0, footprint)) * (1.0 - smoothstep(10000.0, 16000.0, dist));
  roads = density * 0.015;
  if (detail <= 0.0) return c;
  // A conservative gradient prevents narrow local streets/roofs aliasing at grazing angles.
  vec4 tile = textureGrad(uEarthUrbanDetail, uv.uv * scale, dx * 1.5, dy * 1.5);
  float urban = density * smoothstep(0.12, 0.55, tile.a + density * 0.35);
  roads = mix(roads, tile.g * urban, detail);
  vec3 roofs = mix(c * vec3(0.55, 0.60, 0.62), vec3(dot(c, vec3(0.3, 0.6, 0.1))) * vec3(1.4, 1.3, 1.18), tile.r);
  roofs += vec3(0.025, 0.023, 0.022) * tile.r;
  return mix(c, roofs, urban * tile.b * detail);
}
`;

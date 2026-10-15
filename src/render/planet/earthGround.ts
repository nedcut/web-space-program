/** Flight terrain only. Regional imagery is north-first, matching the global EarthUV contract. */
export const GLSL_EARTH_GROUND = /* glsl */ `
uniform sampler2D uEarthRegionDay;
uniform sampler2D uEarthRegionNight;
uniform float uEarthRegionOn;
uniform sampler2D uEarthUrbanDetail;
float earthRegionWeight(EarthUV r, float dist) {
  if (uEarthRegionOn < 0.5 || dist >= uPlanetRadius * 0.16 || dist <= 250.0) return 0.0;
  vec2 edge = min(r.uv, 1.0 - r.uv);
  return smoothstep(250.0, 750.0, dist) * smoothstep(0.0, 0.04, min(edge.x, edge.y))
    * (1.0 - smoothstep(uPlanetRadius * 0.06, uPlanetRadius * 0.16, dist));
}
vec3 earthGroundColour(vec3 c, float density, EarthUV uv, float hd, out float roads) {
  roads = 0.0;
  // Keep the imagery's land-cover colours. Fine canopy only modulates their brightness.
  c *= 1.0 + hd * 0.4;
  if (density < 0.008) return c;
  vec2 scale = vec2(0.618, 0.4363) * (uPlanetRadius / 3072.0);
  vec2 dx = uv.dx * scale, dy = uv.dy * scale;
  // A conservative gradient prevents narrow local streets/roofs aliasing at grazing angles.
  vec4 tile = textureGrad(uEarthUrbanDetail, uv.uv * scale, dx * 1.5, dy * 1.5);
  float urban = density * smoothstep(0.12, 0.55, tile.a + density * 0.35);
  roads = tile.g * urban;
  vec3 roofs = mix(c * vec3(0.55, 0.60, 0.62), vec3(dot(c, vec3(0.3, 0.6, 0.1))) * vec3(1.4, 1.3, 1.18), tile.r);
  roofs += vec3(0.025, 0.023, 0.022) * tile.r;
  return mix(c, roofs, urban * tile.b);
}
`;

/**
 * Render-only crater micro-relief for airless terrain close up (below ~3 km camera distance).
 *
 * The shared terrain mesh carries the large craters, but between ~2 km and touchdown the surface had no new
 * features at any scale: 3.8 km, 1.5 km and 200 m looked alike. Three procedural scales of small craters
 * (96, 24 and 6 m cells, at most one crater each) perturb the shading normal and brighten fresh rims/ejecta.
 * Collision terrain is unchanged.
 *
 * Cells are hashed in absolute body-fixed metres (`transpose(uBodyRot) * rel`, float32: ≤ 0.13 m error at real
 * lunar scale), not in the chunk-relative detail coordinates, so the pattern is seamless across chunks and
 * does not repeat. Each crater (rim and ejecta) stays inside its own cell, so one hash per cell and scale is
 * enough. The plane is chosen per body-fixed axis with sharp triplanar weights; only planes with weight are
 * evaluated, which is one plane almost everywhere.
 *
 * Cost: ≈0.08 ms per scale at 2940×1840 on an RTX 3060 Ti at 40 m above the Moon, almost independent of the
 * per-cell maths (a texture-lookup cell, a polynomial rim and loop forms all measured the same), so the quality
 * tier sets how many scales run (`CRATER_SCALES`, from `terrain.craterScales`): none on Low/Medium.
 */
export const GLSL_CRATERS = /* glsl */ `
vec4 craterHash(vec2 p) {
  vec4 p4 = fract(vec4(p.xyxy) * vec4(0.1031, 0.1030, 0.0973, 0.1099));
  p4 += dot(p4, p4.wzxy + 33.33);
  return fract((p4.xxyz + p4.yzzw) * p4.zywx);
}
// Height gradient (metres per metre, in the plane) and albedo factor of the crater in p's cell (cell size S).
vec3 craterCell(vec2 p, float S, float seed) {
  vec2 cell = floor(p / S);
  vec4 h = craterHash(cell + seed);
  if (h.x > 0.66) return vec3(0.0, 0.0, 1.0);
  float r = mix(0.09, 0.26, h.w * h.w);
  vec2 v = p / S - cell - 0.5 - (h.yz - 0.5) * (1.0 - 3.3 * r);
  float l = length(v);
  float d = l / r;
  if (d > 1.65) return vec3(0.0, 0.0, 1.0);
  // Depth/radius 0.12–0.24 (deeper = younger): parabolic bowl, raised rim.
  float fresh = fract(h.x * 9.17 + h.w * 3.3);
  float depth = mix(0.12, 0.24, fresh);
  float rim = exp(-(d - 1.0) * (d - 1.0) * 16.0);
  float slope = (d < 1.0 ? 2.0 * d * depth : 0.0) - depth * 0.45 * 32.0 * (d - 1.0) * rim;
  vec2 g = slope * v / max(l, 1e-5);
  float bright = smoothstep(0.55, 0.95, fresh);
  float albedo = 1.0 + bright * (0.22 * rim + 0.08 * (1.0 - smoothstep(1.0, 1.65, d))) - 0.06 * (1.0 - smoothstep(0.2, 1.0, d));
  return vec3(g, albedo);
}
void craterPlane(vec2 p, vec3 fades, inout vec2 g, inout float albedo) {
  vec3 c = craterCell(p, 96.0, 0.0);
  g += c.xy * fades.x; albedo *= mix(1.0, c.z, fades.x);
  #if CRATER_SCALES > 1
  if (fades.y > 0.0) { c = craterCell(p + 11.3, 24.0, 17.0); g += c.xy * fades.y; albedo *= mix(1.0, c.z, fades.y); }
  #endif
  #if CRATER_SCALES > 2
  if (fades.z > 0.0) { c = craterCell(p + 3.7, 6.0, 41.0); g += c.xy * fades.z; albedo *= mix(1.0, c.z, fades.z); }
  #endif
}
// Body-fixed gradient (xyz) and albedo factor (w) at body-fixed position bf with sharp triplanar weights w.
vec4 craterDetail(vec3 bf, vec3 w, float dist) {
  vec3 fades = 1.0 - smoothstep(vec3(1400.0, 350.0, 90.0), vec3(3200.0, 800.0, 200.0), vec3(dist));
  vec3 g = vec3(0.0);
  float albedo = 1.0;
  if (w.x > 0.02) { vec2 gp = vec2(0.0); float a = 1.0; craterPlane(bf.yz, fades, gp, a); g += vec3(0.0, gp.x, gp.y) * w.x; albedo *= mix(1.0, a, w.x); }
  if (w.y > 0.02) { vec2 gp = vec2(0.0); float a = 1.0; craterPlane(bf.zx, fades, gp, a); g += vec3(gp.y, 0.0, gp.x) * w.y; albedo *= mix(1.0, a, w.y); }
  if (w.z > 0.02) { vec2 gp = vec2(0.0); float a = 1.0; craterPlane(bf.xy, fades, gp, a); g += vec3(gp.x, gp.y, 0.0) * w.z; albedo *= mix(1.0, a, w.z); }
  return vec4(g, albedo);
}
`;

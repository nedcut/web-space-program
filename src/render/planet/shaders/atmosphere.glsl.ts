/**
 * Physically based single scattering (Rayleigh + Mie + ozone absorption) with a precomputed
 * transmittance LUT for the light path. Shared by the sky shell, terrain, ocean, gas giants, clouds
 * and rings (aerial perspective). Positions are in render space (floating origin, metres).
 *
 * Precision note: ray–sphere tests for the CAMERA use c = |camRel|² − r² precomputed in float64 on the
 * CPU (uCamCAtm / uCamCGround) — computing that in float32 at planetary radii cancels catastrophically.
 */
export const GLSL_ATMOSPHERE = /* glsl */ `
uniform vec3 uPlanetCenter;
uniform float uPlanetRadius;
uniform float uAtmoRadius;
uniform float uHasAtmo;
uniform vec3 uCamRel;      // camera - planet centre
uniform float uCamCAtm;    // |camRel|^2 - Ra^2  (float64 on CPU)
uniform float uCamCGround; // |camRel|^2 - R^2
uniform vec3 uBetaR;
uniform vec3 uBetaMs;
uniform vec3 uBetaMe;
uniform vec3 uMieG;
uniform vec3 uBetaO;
uniform float uOzoneCenter;
uniform float uOzoneWidth;
uniform float uHr;
uniform float uHm;
uniform float uAmbient;
uniform float uMultiScatter;
uniform int uStepScale;
uniform vec3 uPlanetshineDir;
uniform vec3 uPlanetshineColor;
uniform vec3 uSunDir;      // unit, render space, from planet towards the sun
uniform vec3 uSunColor;    // HDR solar irradiance (linear RGB)
uniform sampler2D uTransLUT;
uniform float uTime;

const float ATMO_PI = 3.14159265359;

vec2 raySphereC(float b, float c) {
  float d = b * b - c;
  if (d < 0.0) return vec2(1e30, -1e30);
  float s = sqrt(d);
  return vec2(-b - s, -b + s);
}

vec3 transmittanceToTop(float r, float mu) {
  float v = sqrt(clamp((r - uPlanetRadius) / (uAtmoRadius - uPlanetRadius), 0.0, 1.0));
  float u = clamp(mu * 0.5 + 0.5, 0.0, 1.0);
  return texture(uTransLUT, vec2(u, v)).rgb;
}

/** Sunlight reaching point p (relative to planet centre): LUT transmittance (0 in planet shadow). */
vec3 sunTransmittance(vec3 rel) {
  if (uHasAtmo < 0.5) return vec3(1.0);
  float r = length(rel);
  return transmittanceToTop(r, dot(rel, uSunDir) / r);
}

float phaseRayleigh(float c) { return 3.0 / (16.0 * ATMO_PI) * (1.0 + c * c); }
vec3 phaseMie(float c) {
  vec3 g = uMieG;
  vec3 g2 = g * g;
  vec3 num = 3.0 * (1.0 - g2) * (1.0 + c * c);
  vec3 den = 8.0 * ATMO_PI * (2.0 + g2) * pow(max(1.0 + g2 - 2.0 * g * c, vec3(1e-4)), vec3(1.5));
  return num / den;
}

/**
 * Integrate in-scattered light and view transmittance along camera ray (start rel0 relative to planet,
 * direction rd) between distances t0 and t1. Energy-conserving per-segment integration
 * (Hillaire 2020): S·(1 − e^{−σt·dt})/σt, robust for optically thick steps (Titan, Venus).
 * An isotropic multiple-scattering term (uMultiScatter) approximates higher-order bounces, which
 * dominate in thick hazes and keep them bright away from the forward-scattering lobe.
 */
void integrateScattering(vec3 rel0, vec3 rd, float t0, float t1, int steps, out vec3 inscatter, out vec3 transmittance) {
  inscatter = vec3(0.0);
  transmittance = vec3(1.0);
  if (uHasAtmo < 0.5 || t1 <= t0) return;
  steps = min(steps, 64);
  float cosT = dot(rd, uSunDir);
  float pR = phaseRayleigh(cosT);
  vec3 pM = phaseMie(cosT);
  const float ISO = 1.0 / (4.0 * ATMO_PI);
  float dt = (t1 - t0) / float(steps);
  vec3 T = vec3(1.0);
  vec3 L = vec3(0.0);
  for (int i = 0; i < 64; i++) {
    if (i >= steps) break;
    float t = t0 + (float(i) + 0.5) * dt;
    vec3 p = rel0 + rd * t;
    float r = length(p);
    float h = max(r - uPlanetRadius, 0.0);
    float rhoR = exp(-h / uHr);
    float rhoM = exp(-h / uHm);
    float rhoO = max(0.0, 1.0 - abs(h - uOzoneCenter) / uOzoneWidth);
    vec3 sigmaT = uBetaR * rhoR + uBetaMe * rhoM + uBetaO * rhoO;
    float muS = dot(p, uSunDir) / r;
    vec3 ts = transmittanceToTop(r, muS);
    // Diffuse light reaching this altitude (sun slightly higher → softer terminator) for the MS term.
    vec3 tsDiffuse = transmittanceToTop(r, clamp(muS + 0.15, -1.0, 1.0)) * smoothstep(-0.35, 0.1, muS);
    vec3 S = (uBetaR * rhoR * pR + uBetaMs * rhoM * pM) * ts
           + (uBetaR * rhoR + uBetaMs * rhoM) * ISO * uMultiScatter * tsDiffuse;
    vec3 segT = exp(-sigmaT * dt);
    vec3 Sint = S * (vec3(1.0) - segT) / max(sigmaT, vec3(1e-12));
    L += T * Sint;
    T *= segT;
  }
  inscatter = uSunColor * L;
  #ifdef TITAN_HAZE
    // Deep haze still receives diffuse light after direct transmittance underflows.
    // Approximate the higher scattering orders omitted by this single-scattering marcher.
    float diffuseDay = smoothstep(-0.25, 0.2, dot(normalize(rel0), uSunDir));
    inscatter += uSunColor * vec3(0.08, 0.043, 0.013) * diffuseDay * (vec3(1.0)-T);
  #endif
  transmittance = T;
}

/** Camera-ray segment inside the atmosphere up to distance tMax; returns (tStart, tEnd). */
vec2 cameraAtmoSegment(vec3 rd, float tMax) {
  float b = dot(uCamRel, rd);
  vec2 ta = raySphereC(b, uCamCAtm);
  float t0 = max(ta.x, 0.0);
  float t1 = min(ta.y, tMax);
  return vec2(t0, t1);
}

/** Apply aerial perspective to a surface colour seen from the camera at distance dist along rd. */
vec3 applyAerialPerspective(vec3 color, vec3 rd, float dist, int steps) {
  if (uHasAtmo < 0.5) return color;
  vec2 seg = cameraAtmoSegment(rd, dist);
  if (seg.y <= seg.x) return color;
  vec3 L, T;
  integrateScattering(uCamRel, rd, seg.x, seg.y, steps, L, T);
  return color * T + L;
}

/** Approximate sky irradiance on a surface with up vector n (cheap analytic fit to the scattering). */
vec3 skyAmbient(vec3 rel, vec3 n) {
  if (uHasAtmo < 0.5) return vec3(0.0);
  vec3 up = normalize(rel);
  float muS = dot(up, uSunDir);
  float r = length(rel);
  vec3 tZen = transmittanceToTop(r, max(muS, 0.05));
  float day = smoothstep(-0.25, 0.25, muS);
  vec3 tau = (uBetaR * uHr + uBetaMs * uHm);
  vec3 scatterCol = (vec3(1.0) - exp(-tau)) * mix(vec3(1.0), tZen, 0.5);
  float hemi = 0.5 + 0.5 * dot(n, up);
  #ifdef TITAN_HAZE
    scatterCol = max(scatterCol, vec3(0.12,0.07,0.025));
  #endif
  return uSunColor * scatterCol * day * hemi * 0.35 * uAmbient;
}
`;

/** Ring shadow cast on a planet (analytic: intersect sun ray with ring plane, sample profile). */
export const GLSL_RING_SHADOW = /* glsl */ `
uniform float uHasRings;
uniform vec3 uRingNormal;
uniform float uRingInner;
uniform float uRingOuter;
uniform sampler2D uRingProfile;
float ringShadow(vec3 rel) {
  if (uHasRings < 0.5) return 1.0;
  float dn = dot(uSunDir, uRingNormal);
  if (abs(dn) < 1e-4) return 1.0;
  float t = -dot(rel, uRingNormal) / dn;
  if (t <= 0.0) return 1.0;
  vec3 hit = rel + uSunDir * t;
  float r = length(hit);
  float u = (r - uRingInner) / (uRingOuter - uRingInner);
  if (u < 0.0 || u > 1.0) return 1.0;
  float a = texture(uRingProfile, vec2(u, 0.5)).a;
  return 1.0 - a * 0.92;
}
`;

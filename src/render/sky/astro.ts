/** Astronomical helpers for the sky (frame: ecliptic J2000, +Z ecliptic north). */

const DEG = Math.PI / 180;
const OBLIQUITY = 23.4392911 * DEG;

/** Equatorial RA/Dec (degrees) → ecliptic-frame unit vector. */
export function raDecToEcliptic(raDeg: number, decDeg: number): [number, number, number] {
  const ra = raDeg * DEG, dec = decDeg * DEG;
  const xq = Math.cos(dec) * Math.cos(ra);
  const yq = Math.cos(dec) * Math.sin(ra);
  const zq = Math.sin(dec);
  const c = Math.cos(OBLIQUITY), s = Math.sin(OBLIQUITY);
  return [xq, yq * c + zq * s, -yq * s + zq * c];
}

/** Galactic north pole and centre directions in the ecliptic frame. */
export const GALACTIC_NORTH = raDecToEcliptic(192.85948, 27.12825);
export const GALACTIC_CENTER = raDecToEcliptic(266.405, -28.936);
export const LMC = raDecToEcliptic(80.89, -69.76);
export const SMC = raDecToEcliptic(13.19, -72.83);

/**
 * Blackbody colour temperature (K) → linear sRGB, normalised so max channel = 1.
 * (Fit by Tanner Helland, converted from sRGB to linear.)
 */
export function blackbodyLinear(tempK: number): [number, number, number] {
  const t = tempK / 100;
  let r: number, g: number, b: number;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    b = 255;
  }
  const lin = (v: number) => {
    const c = Math.min(255, Math.max(0, v)) / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const out: [number, number, number] = [lin(r), lin(g), lin(b)];
  const m = Math.max(out[0], out[1], out[2], 1e-6);
  return [out[0] / m, out[1] / m, out[2] / m];
}

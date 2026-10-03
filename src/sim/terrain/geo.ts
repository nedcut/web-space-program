/** Geographic helpers on the unit sphere (body-fixed frame: +Z north, +X prime meridian). */

export interface UnitVec {
  x: number;
  y: number;
  z: number;
}

const DEG = Math.PI / 180;

/** Latitude/longitude in DEGREES → body-fixed unit vector. */
export function latLonToUnit(latDeg: number, lonDeg: number): UnitVec {
  const la = latDeg * DEG;
  const lo = lonDeg * DEG;
  const c = Math.cos(la);
  return { x: c * Math.cos(lo), y: c * Math.sin(lo), z: Math.sin(la) };
}

/** Body-fixed unit vector → { lat, lon } in DEGREES. */
export function unitToLatLon(x: number, y: number, z: number): { lat: number; lon: number } {
  return { lat: Math.asin(Math.max(-1, Math.min(1, z))) / DEG, lon: Math.atan2(y, x) / DEG };
}

/** Angular distance (radians) between unit vector (x,y,z) and centre c. */
export function angleTo(x: number, y: number, z: number, c: UnitVec): number {
  const d = x * c.x + y * c.y + z * c.z;
  // atan2 form is accurate for both small and large angles.
  const cx = y * c.z - z * c.y;
  const cy = z * c.x - x * c.z;
  const cz = x * c.y - y * c.x;
  return Math.atan2(Math.sqrt(cx * cx + cy * cy + cz * cz), d);
}

/** Gaussian cap: exp(-(angle/sigma)^2), sigma in radians. Uses chord^2 ≈ angle^2 (cheap). */
export function gaussCap(x: number, y: number, z: number, c: UnitVec, sigma: number): number {
  const dx = x - c.x, dy = y - c.y, dz = z - c.z;
  return Math.exp(-(dx * dx + dy * dy + dz * dz) / (sigma * sigma));
}

/** Chord distance between unit vectors (≈ angle for small separations). */
export function chord(x: number, y: number, z: number, c: UnitVec): number {
  const dx = x - c.x, dy = y - c.y, dz = z - c.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Distance (radians) from p to the great-circle ARC a→b, plus the normalised position along it (0..1).
 * Used for canyons, lineae, mountain chains.
 */
export function arcDistance(x: number, y: number, z: number, a: UnitVec, b: UnitVec): { d: number; t: number } {
  // Plane normal of the great circle.
  let nx = a.y * b.z - a.z * b.y;
  let ny = a.z * b.x - a.x * b.z;
  let nz = a.x * b.y - a.y * b.x;
  const nl = Math.hypot(nx, ny, nz) || 1;
  nx /= nl; ny /= nl; nz /= nl;
  const off = x * nx + y * ny + z * nz; // sin(distance to full great circle)
  // Project p onto the circle plane and measure angle along the arc.
  let px = x - nx * off, py = y - ny * off, pz = z - nz * off;
  const pl = Math.hypot(px, py, pz) || 1;
  px /= pl; py /= pl; pz /= pl;
  const total = Math.acos(Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z)));
  // Signed angle from a to projected p around n.
  const cx = a.y * pz - a.z * py, cy = a.z * px - a.x * pz, cz = a.x * py - a.y * px;
  const along = Math.atan2(cx * nx + cy * ny + cz * nz, a.x * px + a.y * py + a.z * pz);
  const t = total > 0 ? along / total : 0;
  if (t >= 0 && t <= 1) return { d: Math.abs(Math.asin(Math.max(-1, Math.min(1, off)))), t };
  const da = angleTo(x, y, z, a);
  const db = angleTo(x, y, z, b);
  return da < db ? { d: da, t: Math.max(t, -10) } : { d: db, t: Math.min(t, 10) };
}

/** Precomputed great-circle arc a→b for fast repeated distance queries with early rejection. */
export class GreatArc {
  private readonly a: UnitVec;
  private readonly b: UnitVec;
  private readonly nx: number;
  private readonly ny: number;
  private readonly nz: number;
  constructor(a: UnitVec, b: UnitVec) {
    this.a = a;
    this.b = b;
    const nx = a.y * b.z - a.z * b.y, ny = a.z * b.x - a.x * b.z, nz = a.x * b.y - a.y * b.x;
    const nl = Math.hypot(nx, ny, nz) || 1;
    this.nx = nx / nl; this.ny = ny / nl; this.nz = nz / nl;
  }
  /** Distance (rad) and position t along the arc, or null if farther than maxDist from the full circle. */
  query(x: number, y: number, z: number, maxDist: number): { d: number; t: number } | null {
    const off = x * this.nx + y * this.ny + z * this.nz;
    if (Math.abs(off) > Math.sin(Math.min(maxDist, 1.5))) return null;
    return arcDistance(x, y, z, this.a, this.b);
  }
}

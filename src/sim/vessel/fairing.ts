import type { Vec3 } from '../../util/vec3';
import { qConj, qRotate, type Quat } from '../../util/quat';
import type { PartDef, PartTweaks } from './types';

/**
 * Payload fairing shells. A fairing part is a base ring (origin at its centre) carrying a two-piece shell that rises
 * along part +Y: a short flare from the ring to the shell radius, a cylinder to 58 % of the height and a tangent-ogive
 * nose. Shell size is per part instance (`PartTweaks.fairingRadius/fairingHeight`, fitted to the payload by the
 * editor) and falls back to the catalogue mesh parameters. The simulation shields wholly enclosed parts from drag and
 * heating; the render builds the same profile.
 */
export interface FairingShell {
  /** Part-frame height of the shell's base (top of the ring), m. */
  baseY: number;
  baseRadius: number;
  radius: number;
  height: number;
}

/** Shell flare height for a given ring and shell radius, m. */
export const fairingFlare = (baseRadius: number, radius: number) => Math.max(0, radius - baseRadius) * 1.8 + 0.08;
/** Fraction of the shell height that is cylindrical; the nose ogive takes the rest. */
export const FAIRING_CYLINDER = 0.58;
/** Shell mass per square metre beyond the catalogue shell, kg/m^2. */
export const FAIRING_AREAL_MASS = 4;
/** Size limits for instance shells (radius relative to the base ring). */
export const FAIRING_MAX_RADIUS_FACTOR = 2.5;
export const FAIRING_MIN_HEIGHT = 0.6;
export const FAIRING_MAX_HEIGHT = 40;
/** Share of the catalogue dry mass in the base ring, which stays on the vessel when the shell is jettisoned. */
export const FAIRING_RING_FRACTION = 0.2;
/** Shell radius (m) from which the shell splits into three panels instead of two. */
export const FAIRING_TRI_RADIUS = 1.8;

const fairingDefs = new WeakMap<PartDef, boolean>();
export function isFairingDef(def: PartDef): boolean {
  let known = fairingDefs.get(def);
  if (known === undefined) fairingDefs.set(def, known = def.shape.kind === 'cylinder' && def.modules.some(m => m.type === 'fairing'));
  return known;
}

function meshNumber(def: PartDef, key: string, fallback: number): number {
  const value = def.meshParams?.[key];
  return typeof value === 'number' ? value : fallback;
}

/** Catalogue shell (no instance settings). */
export function defaultFairingShell(def: PartDef): FairingShell | undefined {
  if (!isFairingDef(def) || def.shape.kind !== 'cylinder') return undefined;
  const r = def.shape.radiusTop;
  return { baseY: def.shape.height / 2, baseRadius: r, radius: meshNumber(def, 'shellRadius', r * 1.1), height: meshNumber(def, 'shellHeight', 4) };
}

export function fairingShell(def: PartDef, tweaks?: PartTweaks): FairingShell | undefined {
  const shell = defaultFairingShell(def);
  if (!shell) return undefined;
  const radius = tweaks?.fairingRadius, height = tweaks?.fairingHeight;
  if (radius !== undefined) shell.radius = Math.max(shell.baseRadius, Math.min(shell.baseRadius * FAIRING_MAX_RADIUS_FACTOR, radius));
  if (height !== undefined) shell.height = Math.max(FAIRING_MIN_HEIGHT, Math.min(FAIRING_MAX_HEIGHT, height));
  return shell;
}

/** Tangent ogive radius at distance x from its base (0..L). */
export function ogiveRadius(R: number, L: number, x: number): number {
  const rho = (R * R + L * L) / (2 * R);
  return Math.sqrt(Math.max(0, rho * rho - x * x)) + R - rho;
}

/** Inner shell radius at part-frame height y; 0 outside the shell. */
export function fairingRadiusAt(s: FairingShell, y: number): number {
  const t = y - s.baseY;
  if (t < 0 || t > s.height) return 0;
  const flare = fairingFlare(s.baseRadius, s.radius);
  if (t < flare) return s.baseRadius + (s.radius - s.baseRadius) * (t / flare);
  const cyl = s.height * FAIRING_CYLINDER;
  if (t <= cyl) return s.radius;
  return ogiveRadius(s.radius, s.height - cyl, t - cyl);
}

/** Approximate outer surface area of the shell (flare, cylinder and nose), m^2. */
export function fairingShellArea(s: FairingShell): number {
  const cyl = s.height * FAIRING_CYLINDER, nose = s.height - cyl;
  return 2 * Math.PI * s.radius * cyl + Math.PI * s.radius * Math.hypot(s.radius, nose) * 0.85;
}

/** Dry mass change of an instance shell relative to the catalogue shell, kg. */
export function fairingMassDelta(def: PartDef, tweaks?: PartTweaks): number {
  if (!isFairingDef(def) || (tweaks?.fairingRadius === undefined && tweaks?.fairingHeight === undefined)) return 0;
  const base = defaultFairingShell(def)!, shell = fairingShell(def, tweaks)!;
  return Math.max(-0.6 * def.dryMass, FAIRING_AREAL_MASS * (fairingShellArea(shell) - fairingShellArea(base)));
}

/** Mass of the instance shell (everything but the base ring), kg. */
export function fairingShellMass(def: PartDef, tweaks?: PartTweaks): number {
  return isFairingDef(def) ? def.dryMass * (1 - FAIRING_RING_FRACTION) + fairingMassDelta(def, tweaks) : 0;
}

/** Number of clamshell panels the shell splits into. */
export const fairingPanelCount = (radius: number) => radius >= FAIRING_TRI_RADIUS ? 3 : 2;

/** Whether a fairing part has jettisoned its shell (the ring stays; `activated` is set by staging or the action). */
export const fairingJettisoned = (p: { def: PartDef; activated: boolean }) => p.activated && isFairingDef(p.def);

/** Points that bound a part (rims of cylinders, corners of boxes) in its own frame. */
export function partHullPoints(def: PartDef): Vec3[] {
  const s = def.shape;
  if (s.kind === 'box') {
    const out: Vec3[] = [];
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) out.push({ x: x * s.size.x / 2, y: y * s.size.y / 2, z: z * s.size.z / 2 });
    return out;
  }
  const out: Vec3[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * 2 * Math.PI, c = Math.cos(a), sn = Math.sin(a);
    out.push({ x: c * s.radiusTop, y: s.height / 2, z: sn * s.radiusTop }, { x: c * s.radiusBottom, y: -s.height / 2, z: sn * s.radiusBottom });
  }
  return out;
}

interface Placed { def: PartDef; position: Vec3; rotation: Quat }
/** A point in the fairing part's frame. */
function toFairingFrame(fairing: Placed, point: Vec3): Vec3 {
  return qRotate(qConj(fairing.rotation), { x: point.x - fairing.position.x, y: point.y - fairing.position.y, z: point.z - fairing.position.z });
}

/** Whether every hull point of `part` lies inside the fairing's shell (with a small tolerance). */
export function fairingEncloses(shell: FairingShell, fairing: Placed, part: Placed, tolerance = 0.03): boolean {
  for (const local of partHullPoints(part.def)) {
    const w = qRotate(part.rotation, local);
    const p = toFairingFrame(fairing, { x: part.position.x + w.x, y: part.position.y + w.y, z: part.position.z + w.z });
    if (p.y < shell.baseY - tolerance - 0.05) return false;
    const r = fairingRadiusAt(shell, Math.min(Math.max(p.y, shell.baseY), shell.baseY + shell.height));
    if (p.y > shell.baseY + shell.height + tolerance || Math.hypot(p.x, p.z) > r + tolerance) return false;
  }
  return true;
}

/**
 * Smallest shell (radius at least the catalogue one) that encloses every payload part, or undefined when the payload
 * cannot fit within the size limits. Positions are in any common frame.
 */
export function fitFairingShell(def: PartDef, fairing: Placed, payload: Placed[], margin = 0.06): FairingShell | undefined {
  const shell = defaultFairingShell(def);
  if (!shell || !payload.length) return undefined;
  const points: Vec3[] = [];
  for (const part of payload) for (const local of partHullPoints(part.def)) {
    const w = qRotate(part.rotation, local);
    points.push(toFairingFrame(fairing, { x: part.position.x + w.x, y: part.position.y + w.y, z: part.position.z + w.z }));
  }
  let top = shell.baseY, radial = 0;
  for (const p of points) { top = Math.max(top, p.y); radial = Math.max(radial, Math.hypot(p.x, p.z)); }
  shell.radius = Math.min(shell.baseRadius * FAIRING_MAX_RADIUS_FACTOR, Math.max(shell.radius, radial + margin));
  // Hardware seated on the ring may be as wide as the ring; elsewhere keep a small clearance.
  const fits = () => points.every(p => {
    const y = Math.max(p.y, shell.baseY);
    const clearance = y - shell.baseY < fairingFlare(shell.baseRadius, shell.radius) ? -0.01 : margin / 2;
    return Math.hypot(p.x, p.z) <= fairingRadiusAt(shell, y) - clearance + 1e-9;
  });
  shell.height = Math.max(FAIRING_MIN_HEIGHT, fairingFlare(shell.baseRadius, shell.radius) / 0.5, top - shell.baseY + margin);
  for (let i = 0; i < 80 && !fits(); i++) {
    shell.height *= 1.04;
    if (shell.height > FAIRING_MAX_HEIGHT) return undefined;
  }
  if (!fits()) return undefined;
  // Round up so nearby payload edits reuse the same shell mesh.
  shell.height = Math.min(FAIRING_MAX_HEIGHT, Math.ceil(shell.height * 20) / 20);
  shell.radius = Math.min(shell.baseRadius * FAIRING_MAX_RADIUS_FACTOR, Math.ceil(shell.radius * 50) / 50);
  return shell;
}

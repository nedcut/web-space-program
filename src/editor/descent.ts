import { buildVessel } from '../sim/vessel/assembly';
import { activateStage, computeStageDeltaV } from '../sim/vessel/staging';
import { computeAeroForces, machDragMultiplier } from '../sim/vessel/aero';
import { sampleAtmosphere } from '../sim/atmosphere';
import { cross, dot, length, v3, type Vec3 } from '../util/vec3';
import type { AtmosphereDef } from '../sim/bodies/types';
import type { CraftDef, ParachuteModule, PartDef } from '../sim/vessel/types';
import type { VesselState } from '../sim/vessel/runtime';

/** Launch body air for the editor's descent check (the program's scaled home planet). */
export interface HomeAir { atmosphere: AtmosphereDef; gravity: number }

const PROBE = { pressure: 101325, density: 1.225, temperature: 288.15, speedOfSound: 340 };
const PROBE_SPEED = 100;
/** Tilt used to test which way up the descending assembly settles. */
const TILT = 0.3;
const DT = 0.05;

export interface DescentEstimate {
  /** Altitude where the parachutes begin to open (m), or null when they never do before the sea. */
  openAltitude: number | null;
  /** Speed at the sea, m/s. */
  touchdown: number;
  /** Falling speed at sea level with the parachutes still packed, m/s. */
  freeFall: number;
  /** Weakest parachute: opening load (Pa) and the sea-level speed at that load (m/s). */
  chuteQ: number;
  ratedSpeed: number;
  chuteName: string;
  chuteUids: number[];
}

/** Drag area at low Mach and whether the attitude is statically stable, flying along body ±Y (-1 = base first). */
function attitude(v: VesselState, sign: number) {
  const control = v3();
  const lead = { x: 0, y: sign, z: 0 };
  const straight = computeAeroForces(v, { air: PROBE, airVelocityBody: { x: 0, y: sign * PROBE_SPEED, z: 0 }, control });
  const cda = length(straight.forceBody) / (0.5 * PROBE.density * PROBE_SPEED * PROBE_SPEED);
  let stable = true;
  // Tilted both ways about both cross axes, the aero torque must swing the leading axis back into the flow.
  for (const [x, z] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
    const dir: Vec3 = { x: x * Math.sin(TILT), y: sign * Math.cos(TILT), z: z * Math.sin(TILT) };
    const tilted = computeAeroForces(v, { air: PROBE, airVelocityBody: { x: dir.x * PROBE_SPEED, y: dir.y * PROBE_SPEED, z: dir.z * PROBE_SPEED }, control });
    if (dot(cross(tilted.torqueBody, lead), dir) <= 0) stable = false;
  }
  return { cda, stable };
}

/** Vertical point-mass fall from `top`, entering the air at free-fall speed; the opening rules mirror `updateParachutes`. */
function fall(home: HomeAir, top: number, mass: number, body: number, chute?: { m: ParachuteModule; semi: number; full: number }) {
  const g = home.gravity, atmo = home.atmosphere;
  let h = Math.min(top, atmo.height), u = Math.sqrt(2 * g * Math.max(0, top - h)), phase = 0, progress = 0;
  let openAltitude: number | null = null;
  for (let t = 0; h > 0 && t < 3600; t += DT) {
    const air = sampleAtmosphere(atmo, h, g);
    const q = 0.5 * air.density * u * u;
    if (chute && phase === 0 && air.pressure >= chute.m.minPressure && q <= chute.m.maxQ) { phase = 1; progress = 0; openAltitude = h; }
    else if (chute && phase === 1 && h <= chute.m.deployAltitude && q <= 0.2 * chute.m.maxQ) { phase = 2; progress = 0; }
    if (phase) progress = Math.min(1, progress + DT / 3);
    const e = progress * progress * (3 - 2 * progress);
    const open = !chute ? 0 : phase === 1 ? chute.semi * e : phase === 2 ? chute.semi + (chute.full - chute.semi) * e : 0;
    const cda = body * machDragMultiplier(air.speedOfSound > 0 ? u / air.speedOfSound : 0) + open;
    u += (g - 0.5 * air.density * u * u * cda / mass) * DT;
    h -= u * DT;
  }
  return { u, openAltitude };
}

/**
 * The piece left after every stage has fired that carries the parachutes (crewed first), falling at its settled
 * attitude (base first when stable that way, as capsules fly) from the highest point the craft reaches flown straight
 * up (vacuum Δv less gravity loss, no drag; at most 1.5 atmosphere heights). Undefined when nothing carries a
 * parachute.
 */
export function descentEstimate(craft: CraftDef, catalog: Map<string, PartDef>, home: HomeAir): DescentEstimate | undefined {
  const root = buildVessel(craft, catalog);
  let climb = 0;
  for (const s of computeStageDeltaV(root, 0, home.gravity)) climb += s.dvVac - home.gravity * s.burnTime;
  const top = Math.min(1.5 * home.atmosphere.height, climb > 0 ? climb * climb / (2 * home.gravity) : 0);
  const pieces = [root];
  for (let s = root.nextStage; s >= 0; s--) for (const piece of [...pieces]) pieces.push(...activateStage(piece, s));
  const hasChute = (v: VesselState) => v.parts.some(p => !!p.chute);
  const crewed = (v: VesselState) => v.parts.some(p => p.def.modules.some(m => m.type === 'command' && m.crew > 0));
  const v = pieces.find(v => hasChute(v) && crewed(v)) ?? pieces.find(hasChute);
  if (!v) return undefined;
  const base = attitude(v, -1);
  const body = base.stable ? base.cda : attitude(v, 1).cda;
  if (!(body > 0)) return undefined;
  const chutes = v.parts.filter(p => !!p.chute).map(p => ({ p, m: p.def.modules[p.chute!.moduleIndex] as ParachuteModule }));
  const weakest = chutes.reduce((a, b) => (b.m.maxQ < a.m.maxQ ? b : a));
  const semi = chutes.reduce((s, c) => s + c.m.semiCdA, 0), full = chutes.reduce((s, c) => s + c.m.deployedCdA, 0);
  const landed = fall(home, top, v.mass, body, { m: weakest.m, semi, full });
  return {
    openAltitude: landed.openAltitude, touchdown: landed.u, freeFall: fall(home, top, v.mass, body).u, chuteQ: weakest.m.maxQ,
    ratedSpeed: Math.sqrt(2 * weakest.m.maxQ / sampleAtmosphere(home.atmosphere, 0, home.gravity).density),
    chuteName: weakest.p.def.name, chuteUids: chutes.map(c => c.p.uid),
  };
}

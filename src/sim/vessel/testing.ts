import type { Vec3 } from '../../util/vec3';
import type { Quat } from '../../util/quat';
import { qFromAxisAngle, qIdentity } from '../../util/quat';
import type { CraftDef, PartDef, PartInstance } from './types';
import type { Environment } from './env';
import { AU } from './env';

/**
 * Test/dev fixtures: mock environments (flat Earth, vacuum, ocean) and a minimal generic part set.
 * Not used by the game; keeps vessel tests independent of the content catalogue.
 */

export interface FlatEarthOptions {
  g?: number;
  rho0?: number;
  p0?: number;
  /** Scale height, m (Infinity = uniform atmosphere). */
  scaleHeight?: number;
  temperature?: number;
  speedOfSound?: number;
  /** 'ground' | 'water' | 'none' surface at z = 0. */
  surface?: 'ground' | 'water' | 'none';
  wind?: Vec3;
}

/** Flat world: +Z up, uniform gravity, exponential atmosphere, plane surface at z = 0. */
export function flatEarthEnv(o: FlatEarthOptions = {}): Environment {
  const g = o.g ?? 9.80665;
  const rho0 = o.rho0 ?? 1.225;
  const p0 = o.p0 ?? 101325;
  const H = o.scaleHeight ?? 8500;
  const T = o.temperature ?? 288.15;
  const a = o.speedOfSound ?? 340.3;
  const surface = o.surface ?? 'ground';
  const wind = o.wind ?? { x: 0, y: 0, z: 0 };
  return {
    gravity: () => ({ x: 0, y: 0, z: -g }),
    air: (pos) => {
      const f = isFinite(H) ? Math.exp(-Math.max(0, pos.z) / H) : 1;
      return { sample: { pressure: p0 * f, density: rho0 * f, temperature: T, speedOfSound: a }, windVelocity: { ...wind } };
    },
    ground: (pos) =>
      surface === 'none'
        ? null
        : { surfacePoint: { x: pos.x, y: pos.y, z: 0 }, normal: { x: 0, y: 0, z: 1 }, surfaceVelocity: { x: 0, y: 0, z: 0 }, isWater: surface === 'water' },
    sun: () => ({ dir: { x: 1, y: 0, z: 0 }, distance: AU }),
  };
}

/** Deep space: no gravity, no air, no ground. */
export function vacuumEnv(): Environment {
  return {
    gravity: () => ({ x: 0, y: 0, z: 0 }),
    air: () => ({ sample: { pressure: 0, density: 0, temperature: 3, speedOfSound: 0 }, windVelocity: { x: 0, y: 0, z: 0 } }),
    ground: () => null,
    sun: () => ({ dir: { x: 1, y: 0, z: 0 }, distance: AU }),
  };
}

/** Orientation that points the craft nose (+Y) along world +Z. */
export const NOSE_UP: Quat = qFromAxisAngle({ x: 1, y: 0, z: 0 }, Math.PI / 2);

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const stack = (h: number, size = 1) => [
  { id: 'top', position: v(0, h / 2, 0), direction: v(0, 1, 0), size },
  { id: 'bottom', position: v(0, -h / 2, 0), direction: v(0, -1, 0), size },
];
const base = (o: Partial<PartDef> & Pick<PartDef, 'id' | 'dryMass' | 'shape'>): PartDef => ({
  name: o.id,
  manufacturer: 'Test',
  description: '',
  category: 'structural',
  cost: 0,
  resources: {},
  attachNodes: [],
  surfaceAttachable: true,
  allowSurfaceAttachChildren: true,
  dragCoefficient: { axial: 0.8, side: 1.0 },
  maxTemp: 2000,
  crashTolerance: 10,
  modules: [],
  mesh: 'test',
  ...o,
});

export const TEST_PARTS: PartDef[] = [
  base({
    id: 'capsule', category: 'command', dryMass: 800, shape: { kind: 'cylinder', radiusTop: 0.3, radiusBottom: 0.625, height: 1.0 },
    attachNodes: stack(1.0), resources: { electricCharge: 100, monopropellant: 20 }, dragCoefficient: { axial: 0.7, side: 0.9 },
    crashTolerance: 14, maxTemp: 2400,
    modules: [{ type: 'command', crew: 1, sasLevel: 3, ecPerSecond: 0 }, { type: 'reactionWheel', torque: 3000, ecRate: 0.2 }],
  }),
  base({
    id: 'tank', category: 'fuelTank', dryMass: 250, shape: { kind: 'cylinder', radiusTop: 0.625, radiusBottom: 0.625, height: 2 },
    attachNodes: stack(2), resources: { liquidFuel: 710, oxidizer: 1290 }, dragCoefficient: { axial: 0.85, side: 1.0 }, crashTolerance: 7,
  }),
  base({
    id: 'tank-small', category: 'fuelTank', dryMass: 60, shape: { kind: 'cylinder', radiusTop: 0.3125, radiusBottom: 0.3125, height: 1 },
    attachNodes: stack(1, 0), resources: { liquidFuel: 100, oxidizer: 180 },
  }),
  base({
    id: 'engine', category: 'engine', dryMass: 400, shape: { kind: 'cylinder', radiusTop: 0.625, radiusBottom: 0.5, height: 1 },
    attachNodes: stack(1), crashTolerance: 7, maxTemp: 2600,
    modules: [{
      type: 'engine', maxThrustVac: 200_000, ispVac: 320, ispAsl: 280, propellants: { liquidFuel: 0.355, oxidizer: 0.645 },
      minThrottle: 0.1, throttleable: true, gimbalRange: (3 * Math.PI) / 180, thrustDirection: v(0, 1, 0), spoolTime: 0.2,
      plume: 'kerolox', ignitions: -1,
    }],
  }),
  base({
    id: 'srb', category: 'engine', dryMass: 300, shape: { kind: 'cylinder', radiusTop: 0.625, radiusBottom: 0.625, height: 3 },
    attachNodes: stack(3), resources: { solidFuel: 1000 },
    modules: [{
      type: 'engine', maxThrustVac: 250_000, ispVac: 230, ispAsl: 200, propellants: { solidFuel: 1 }, minThrottle: 1,
      throttleable: false, gimbalRange: 0, thrustDirection: v(0, 1, 0), spoolTime: 0, plume: 'solid', ignitions: 1,
    }],
  }),
  base({
    id: 'decoupler', category: 'coupling', dryMass: 50, shape: { kind: 'cylinder', radiusTop: 0.625, radiusBottom: 0.625, height: 0.2 },
    attachNodes: stack(0.2), modules: [{ type: 'decoupler', ejectionImpulse: 800, node: 'bottom' }],
  }),
  base({
    id: 'chute', category: 'utility', dryMass: 100, shape: { kind: 'cylinder', radiusTop: 0.2, radiusBottom: 0.3, height: 0.3 },
    attachNodes: stack(0.3), dragCoefficient: { axial: 0.5, side: 0.7 },
    modules: [{ type: 'parachute', deployedCdA: 300, semiCdA: 6, minPressure: 4000, deployAltitude: 1000, maxQ: 25_000 }],
  }),
  base({
    id: 'probe', category: 'command', dryMass: 500, shape: { kind: 'box', size: v(1, 1, 1) },
    attachNodes: stack(1), resources: { electricCharge: 1000 },
    modules: [{ type: 'command', crew: 0, sasLevel: 3, ecPerSecond: 0 }, { type: 'reactionWheel', torque: 500, ecRate: 0.5 }],
  }),
  base({
    id: 'lander-core', category: 'structural', dryMass: 1500, shape: { kind: 'box', size: v(1.5, 1, 1.5) }, attachNodes: stack(1, 2),
    crashTolerance: 8,
  }),
  base({
    id: 'leg', category: 'ground', dryMass: 50, shape: { kind: 'box', size: v(0.2, 1, 0.2) },
    attachNodes: [{ id: 'srf', position: v(0, 0, -0.1), direction: v(0, 0, -1), size: 0 }], crashTolerance: 12,
    modules: [{ type: 'landingLeg', spring: 40_000, damper: 4_000, travel: 0.3, footPosition: v(0, -1.0, 0.55) }],
  }),
  base({
    id: 'wing', category: 'aero', dryMass: 100, shape: { kind: 'box', size: v(0.1, 1.5, 3) }, dragCoefficient: { axial: 0.04, side: 1.2 },
    attachNodes: [{ id: 'srf', position: v(0, 0, -1.5), direction: v(0, 0, -1), size: 0 }],
    modules: [{ type: 'liftingSurface', area: 4.5, liftSlope: 2 * Math.PI * 0.85, deflection: 0, ctrlFraction: 0 }],
  }),
  base({
    id: 'heatshield', category: 'utility', dryMass: 120, shape: { kind: 'cylinder', radiusTop: 0.625, radiusBottom: 0.66, height: 0.2 },
    attachNodes: stack(0.2), resources: { ablator: 150 }, maxTemp: 3400, dragCoefficient: { axial: 1.2, side: 0.9 },
    modules: [{ type: 'heatShield', ablationRate: 0.05, maxTemp: 3400 }],
  }),
  base({ id: 'ballast', dryMass: 100, shape: { kind: 'cylinder', radiusTop: 0.5, radiusBottom: 0.5, height: 1 }, attachNodes: stack(1) }),
  // --- Aircraft fixtures ---
  base({
    id: 'fuselage', category: 'fuelTank', dryMass: 1500, shape: { kind: 'cylinder', radiusTop: 0.625, radiusBottom: 0.625, height: 4 },
    attachNodes: stack(4), resources: { liquidFuel: 1000 }, dragCoefficient: { axial: 0.3, side: 0.9 },
  }),
  base({
    id: 'jet', category: 'engine', dryMass: 1000, shape: { kind: 'cylinder', radiusTop: 0.625, radiusBottom: 0.5, height: 2 },
    attachNodes: stack(2),
    modules: [{
      type: 'engine', maxThrustVac: 50_000, ispVac: 6000, ispAsl: 6000, propellants: { liquidFuel: 1 }, minThrottle: 0,
      throttleable: true, gimbalRange: 0, thrustDirection: v(0, 1, 0), spoolTime: 1.5, plume: 'jet', ignitions: -1,
      airBreathing: { machCurve: [[0, 1], [0.8, 0.95], [1.2, 0.6], [1.6, 0]], densityExponent: 0.7, airRatio: 20 },
    }],
  }),
  base({
    id: 'intake', category: 'aero', dryMass: 50, shape: { kind: 'box', size: v(0.4, 1, 0.3) }, resources: { intakeAir: 0.2 },
    attachNodes: [{ id: 'srf', position: v(0, 0, -0.15), direction: v(0, 0, -1), size: 0 }],
    modules: [{ type: 'intake', area: 0.4 }],
  }),
  base({
    id: 'gear', category: 'ground', dryMass: 60, shape: { kind: 'box', size: v(0.3, 0.4, 0.3) }, crashTolerance: 12,
    attachNodes: [{ id: 'srf', position: v(0, 0, -0.15), direction: v(0, 0, -1), size: 0 }],
    modules: [{ type: 'wheel', radius: 0.25, spring: 100_000, damper: 14_000, travel: 0.25, wheelCenter: v(0, 0, 0.7), brakeTorque: 4000, retractable: true }],
  }),
  base({
    id: 'gear-steer', category: 'ground', dryMass: 60, shape: { kind: 'box', size: v(0.3, 0.4, 0.3) }, crashTolerance: 12,
    attachNodes: [{ id: 'srf', position: v(0, 0, -0.15), direction: v(0, 0, -1), size: 0 }],
    modules: [{ type: 'wheel', radius: 0.25, spring: 100_000, damper: 14_000, travel: 0.25, wheelCenter: v(0, 0, 0.7), brakeTorque: 1000, steerAngle: (30 * Math.PI) / 180, retractable: true }],
  }),
];

/** Rotation for parts hanging under a horizontal craft's belly (part +Z = body -Z, part +Y = body +Y). */
export const BELLY: Quat = { x: 0, y: 1, z: 0, w: 0 };

/**
 * Tricycle-gear test aircraft body (nose = body +Y, top = body +Z): a fuel fuselage with a steerable nose wheel
 * and two braked main wheels behind the COM. Optional jet + intake for propulsion tests.
 */
export function planeCraft(opts: { jet?: boolean; intake?: boolean } = {}): CraftDef {
  const belly = (x: number, y: number): Vec3 => v(x, y, -0.625 - 0.15);
  const parts: PartInstance[] = [
    { uid: 1, partId: 'fuselage', position: v(0, 0, 0), rotation: qIdentity() },
    { uid: 2, partId: 'gear-steer', position: belly(0, 1.6), rotation: BELLY, parent: 1, attachNode: 'srf', parentNode: 'srf' },
    { uid: 3, partId: 'gear', position: belly(1.0, -0.6), rotation: BELLY, parent: 1, attachNode: 'srf', parentNode: 'srf' },
    { uid: 4, partId: 'gear', position: belly(-1.0, -0.6), rotation: BELLY, parent: 1, attachNode: 'srf', parentNode: 'srf' },
  ];
  if (opts.jet) parts.push({ uid: 5, partId: 'jet', position: v(0, -3, 0), rotation: qIdentity(), parent: 1, attachNode: 'top', parentNode: 'bottom', stage: 0 });
  if (opts.intake) parts.push({ uid: 6, partId: 'intake', position: v(0, 1, 0.625 + 0.15), rotation: qIdentity(), parent: 1, attachNode: 'srf', parentNode: 'srf' });
  return { name: 'Test Plane', type: 'SPH', parts, version: 1 };
}

export const TEST_CATALOG = new Map(TEST_PARTS.map((p) => [p.id, p]));

export interface StackEntry {
  partId: string;
  stage?: number;
}

/** Vertical stack, root first (top), each next part attached below the previous one. */
export function stackCraft(entries: (string | StackEntry)[], catalog = TEST_CATALOG, name = 'Test Craft'): CraftDef {
  const parts: PartInstance[] = [];
  let y = 0;
  let prevH = 0;
  entries.forEach((e, i) => {
    const ent = typeof e === 'string' ? { partId: e } : e;
    const def = catalog.get(ent.partId)!;
    const h = def.shape.kind === 'cylinder' ? def.shape.height : def.shape.size.y;
    if (i > 0) y -= prevH / 2 + h / 2;
    parts.push({
      uid: i + 1,
      partId: ent.partId,
      position: v(0, y, 0),
      rotation: qIdentity(),
      parent: i === 0 ? undefined : i,
      attachNode: i === 0 ? undefined : 'top',
      parentNode: i === 0 ? undefined : 'bottom',
      stage: ent.stage,
    });
    prevH = h;
  });
  return { name, type: 'VAB', parts, version: 1 };
}

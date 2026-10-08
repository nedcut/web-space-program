import { validCraftLinks } from './links';
import type { Vec3 } from '../../util/vec3';
import { add, cross, length, scale, sub, v3 } from '../../util/vec3';
import type { Quat } from '../../util/quat';
import { qIdentity, qRotate } from '../../util/quat';
import type { CraftDef, DecouplerModule, PartDef, ResourceDef, ResourceId, WheelModule } from './types';
import type { PartState, VesselCache, VesselState } from './runtime';
import { m3AddInPlace, m3FromQuat, m3Inverse, m3ParallelAxis, m3RotateTensor, m3Zero } from './mat3';
import { localInertia, shapeRadius } from './shapes';
import { DEFAULT_RESOURCE_DEFS, buildFeedGroups, partMass } from './resources';
import { computeExposedAreas, fairingShielding } from './aero';

export interface BuildOptions {
  id?: string;
  resourceDefs?: Record<ResourceId, ResourceDef>;
  position?: Vec3;
  velocity?: Vec3;
  orientation?: Quat;
  angularVelocity?: Vec3;
  /** Initial part temperature, K (default 288). */
  temperature?: number;
  /** Deploy landing legs at build time (default false). */
  legsDeployed?: boolean;
  /** Wheels/landing gear down at build time (default true). Fixed gear is always down. */
  gearDeployed?: boolean;
}

/** Thermal contact conductance per m^2 of node contact area, W/(m^2 K). */
export const NODE_CONDUCTANCE = 150;
/** Conductance of a surface attachment, W/K. */
export const SURFACE_CONDUCTANCE = 10;

const emptyCache = (): VesselCache => ({
  byUid: new Map(),
  depth: new Map(),
  decoupleStage: new Map(),
  feed: new Map(),
  exposed: new Map(),
  links: [],
  boundingRadius: 0,
});

/** Build a runtime vessel from an editor craft. Parts start full unless the instance overrides resources. */
export function buildVessel(craft: CraftDef, partCatalog: Map<string, PartDef>, opts: BuildOptions = {}): VesselState {
  if (craft.parts.some(p => p.link) && !validCraftLinks(craft.parts)) throw new Error('buildVessel: invalid part link');
  const defs = opts.resourceDefs ?? DEFAULT_RESOURCE_DEFS;
  const parts: PartState[] = craft.parts.map((pi) => {
    const def = partCatalog.get(pi.partId);
    if (!def) throw new Error(`buildVessel: unknown part '${pi.partId}'`);
    if (pi.link && (!def.modules.some(m => m.type === 'strut' || m.type === 'fuelLine')
      || [pi.link.sourceUid, pi.link.targetUid].some(uid => {
        const host = craft.parts.find(p => p.uid === uid)!;
        return host.link || !partCatalog.get(host.partId)?.allowSurfaceAttachChildren;
      }))) throw new Error('buildVessel: unsupported link endpoints');
    const maxResources = { ...def.resources };
    const resources: Partial<Record<ResourceId, number>> = { ...def.resources, ...(pi.resources ?? {}) };
    let maxTemp = def.maxTemp;
    const p: PartState = {
      uid: pi.uid,
      link: pi.link ? structuredClone(pi.link) : undefined,
      ...(pi.tweaks ? { tweaks: structuredClone(pi.tweaks) } : {}),
      ...(pi.actions ? { actions: structuredClone(pi.actions) } : {}),
      partId: pi.partId,
      def,
      position: { ...pi.position },
      rotation: { ...pi.rotation },
      parent: pi.parent ?? null,
      children: [],
      attachNode: pi.attachNode,
      parentNode: pi.parentNode,
      symmetryGroup: pi.symmetryGroup,
      stage: pi.stage,
      activated: false,
      resources,
      maxResources,
      mass: 0,
      temperature: opts.temperature ?? 288,
      skinTemperature: new Array(6).fill(opts.temperature ?? 288),
      maxTemp,
    };
    def.modules.forEach((m, i) => {
      if (m.type === 'engine' && !p.engine)
        p.engine = { moduleIndex: i, ignited: false, flamedOut: false, throttle: 0, ignitionsLeft: m.ignitions, thrust: 0, massFlow: 0, isp: m.ispVac, gimbal: { a: 0, b: 0 } };
      else if (m.type === 'parachute' && !p.chute) p.chute = { moduleIndex: i, phase: 'stowed', progress: 0, cda: 0 };
      else if (m.type === 'landingLeg' && !p.leg) p.leg = { moduleIndex: i, deployed: !!opts.legsDeployed, compression: 0, inContact: false };
      else if (m.type === 'wheel' && !p.wheel) {
        const down = !m.retractable || (opts.gearDeployed ?? true);
        p.wheel = { moduleIndex: i, deployed: down, deploy: down ? 1 : 0, compression: 0, inContact: false, steer: 0, spin: 0, rollSpeed: 0 };
      }
      else if (m.type === 'bay') p.bayOpen = false;
      else if (m.type === 'heatShield') maxTemp = Math.max(maxTemp, m.maxTemp);
    });
    p.maxTemp = maxTemp;
    // Launch deploy state chosen in the editor overrides the launch-site defaults.
    const extended = pi.tweaks?.extended;
    if (extended !== undefined) {
      if (p.leg) p.leg.deployed = extended;
      if (p.wheel && (def.modules[p.wheel.moduleIndex] as WheelModule).retractable) { p.wheel.deployed = extended; p.wheel.deploy = extended ? 1 : 0; }
      if (p.bayOpen !== undefined) p.bayOpen = extended;
    }
    p.mass = partMass(p, defs);
    return p;
  });
  const roots = parts.filter((p) => p.parent === null);
  if (roots.length !== 1) throw new Error(`buildVessel: craft must have exactly one root part (found ${roots.length})`);
  const v: VesselState = {
    id: opts.id ?? craft.name,
    name: craft.name,
    rootUid: roots[0].uid,
    parts,
    position: opts.position ? { ...opts.position } : v3(),
    velocity: opts.velocity ? { ...opts.velocity } : v3(),
    orientation: opts.orientation ? { ...opts.orientation } : qIdentity(),
    angularVelocity: opts.angularVelocity ? { ...opts.angularVelocity } : v3(),
    mass: 0,
    com: v3(),
    inertia: m3Zero(),
    invInertia: m3Zero(),
    nextStage: -1,
    situation: 'flying',
    sas: { mode: 'off', hold: null, integral: v3() },
    resourceDefs: defs,
    splitCount: 0,
    destroyed: false,
    telemetry: {
      properAcceleration: v3(),
      gForce: 0,
      mach: 0,
      dynamicPressure: 0,
      staticPressure: 0,
      airDensity: 0,
      altitudeAGL: NaN,
      thrust: 0,
      intakeAirRatio: NaN,
      control: { pitch: 0, yaw: 0, roll: 0 },
    },
    cache: emptyCache(),
  };
  rebuildTopology(v);
  // `position` given by the caller is the COM position.
  recomputeMassProperties(v, false);
  return v;
}

/** The edge (childUid -> parent) that a decoupler part cuts, as a list of child uids whose parent link breaks. */
export function decouplerCutChildren(v: VesselState, d: PartState): number[] {
  const mod = d.def.modules.find((m): m is DecouplerModule => m.type === 'decoupler');
  if (!mod) return [];
  if (mod.radial || d.attachNode === mod.node) return d.parent === null ? [] : [d.uid];
  return d.children.filter((c) => v.cache.byUid.get(c)?.parentNode === mod.node);
}

/** Recompute children lists, depths, decouple stages, feed groups, exposed areas, thermal links, next stage. */
export function rebuildTopology(v: VesselState): void {
  const c = emptyCache();
  for (const p of v.parts) {
    c.byUid.set(p.uid, p);
    p.children = [];
  }
  for (const p of v.parts) {
    if (p.parent !== null) {
      const par = c.byUid.get(p.parent);
      if (par) par.children.push(p.uid);
      else p.parent = null;
    }
  }
  for (const p of v.parts) {
    p.children.sort((a, b) => a - b);
    if (p.parent === null) delete p.structuralFatigue;
  }
  for (const p of v.parts) if (p.link && (!c.byUid.has(p.link.sourceUid) || !c.byUid.has(p.link.targetUid))) {
    p.link.broken = true;
    delete p.linkFatigue;
  }
  v.cache = c;
  // Depths (BFS from root).
  const root = c.byUid.get(v.rootUid);
  if (root) {
    const q: [PartState, number][] = [[root, 0]];
    while (q.length) {
      const [p, d] = q.shift()!;
      c.depth.set(p.uid, d);
      for (const ch of p.children) q.push([c.byUid.get(ch)!, d + 1]);
    }
  }
  // Decouple stages: a part is jettisoned when the first (highest-stage) decoupler on its path to root fires.
  const cutStage = new Map<number, number>(); // child uid -> stage of decoupler cutting its parent link
  for (const p of v.parts) {
    if (!p.def.modules.some((m) => m.type === 'decoupler') || p.activated) continue;
    for (const ch of decouplerCutChildren(v, p)) cutStage.set(ch, Math.max(cutStage.get(ch) ?? -1, p.stage ?? 0));
  }
  for (const p of v.parts) {
    let s = -1;
    let cur: PartState | undefined = p;
    while (cur) {
      const cs = cutStage.get(cur.uid);
      if (cs !== undefined) s = Math.max(s, cs);
      cur = cur.parent === null ? undefined : c.byUid.get(cur.parent);
    }
    c.decoupleStage.set(p.uid, s);
  }
  for (const p of v.parts) if (p.engine) c.feed.set(p.uid, buildFeedGroups(v, p.uid));
  const shielding = fairingShielding(v);
  c.exposed = computeExposedAreas(v, shielding);
  if (shielding.shells.size) {
    c.shielded = shielding.shielded;
    c.aeroCentre = new Map([...shielding.shells].map(([uid, s]) => [uid, s.centre]));
  }
  // Thermal links.
  for (const p of v.parts) {
    if (p.parent === null) continue;
    const par = c.byUid.get(p.parent);
    if (!par) continue;
    if (p.attachNode && p.attachNode !== 'srf') {
      const na = p.def.attachNodes.find((n) => n.id === p.attachNode);
      const nb = par.def.attachNodes.find((n) => n.id === p.parentNode);
      const size = Math.min(na?.size ?? 0, nb?.size ?? 0);
      const r = [0.3125, 0.625, 1.25, 1.875, 2.5][Math.max(0, Math.min(4, size))];
      c.links.push([p.uid, par.uid, NODE_CONDUCTANCE * Math.PI * r * r]);
    } else c.links.push([p.uid, par.uid, SURFACE_CONDUCTANCE]);
  }
  let next = -1;
  for (const p of v.parts) if (p.stage !== undefined && !p.activated) next = Math.max(next, p.stage);
  v.nextStage = next;
}

/**
 * Recompute mass, COM and inertia from current part masses. If `adjustState`, the inertial COM position
 * and velocity are shifted so the vessel's parts do not move (rigid body: v_new = v + w x dr).
 */
export function recomputeMassProperties(v: VesselState, adjustState = true): void {
  let m = 0;
  let mc = v3();
  for (const p of v.parts) {
    p.mass = partMass(p, v.resourceDefs);
    m += p.mass;
    mc = add(mc, scale(p.position, p.mass));
  }
  const com = m > 0 ? scale(mc, 1 / m) : v3();
  const I = m3Zero();
  let br = 0;
  for (const p of v.parts) {
    const R = m3FromQuat(p.rotation);
    m3AddInPlace(I, m3RotateTensor(R, localInertia(p.def, p.mass)));
    const d = sub(p.position, com);
    m3AddInPlace(I, m3ParallelAxis(p.mass, d));
    br = Math.max(br, length(d) + shapeRadius(p.def) + (p.leg ? 2 : 0) + (p.wheel ? wheelReach(p) : 0));
  }
  if (adjustState) {
    const drWorld = qRotate(v.orientation, sub(com, v.com));
    v.position = add(v.position, drWorld);
    v.velocity = add(v.velocity, cross(qRotate(v.orientation, v.angularVelocity), drWorld));
  }
  v.mass = m;
  v.com = com;
  v.inertia = I;
  v.invInertia = m3Inverse(I);
  v.cache.boundingRadius = br;
}

/** Deep copy (shares PartDef references and resourceDefs). */
export function cloneVessel(v: VesselState): VesselState {
  const c: VesselState = {
    ...v,
    eva: v.eva ? { ...v.eva } : undefined,
    parts: v.parts.map((p) => ({
      ...p,
      link: p.link ? structuredClone(p.link) : undefined,
      tweaks: p.tweaks ? structuredClone(p.tweaks) : undefined,
      actions: p.actions ? structuredClone(p.actions) : undefined,
      position: { ...p.position },
      rotation: { ...p.rotation },
      children: [...p.children],
      crew: p.crew ? [...p.crew] : undefined,
      scienceData: p.scienceData?.map(d => ({ ...d })),
      visitedBodies: p.visitedBodies ? [...p.visitedBodies] : undefined,
      resources: { ...p.resources },
      maxResources: { ...p.maxResources },
      skinTemperature: [...p.skinTemperature],
      engine: p.engine ? { ...p.engine, gimbal: { ...p.engine.gimbal } } : undefined,
      chute: p.chute ? { ...p.chute } : undefined,
      leg: p.leg ? { ...p.leg } : undefined,
      wheel: p.wheel ? { ...p.wheel } : undefined,
      docked: p.docked ? { ...p.docked } : undefined,
    })),
    position: { ...v.position },
    velocity: { ...v.velocity },
    orientation: { ...v.orientation },
    angularVelocity: { ...v.angularVelocity },
    com: { ...v.com },
    inertia: [...v.inertia],
    invInertia: [...v.invInertia],
    sas: { ...v.sas, hold: v.sas.hold ? { ...v.sas.hold } : null, integral: { ...v.sas.integral } },
    telemetry: { ...v.telemetry, properAcceleration: { ...v.telemetry.properAcceleration }, control: { ...v.telemetry.control } },
    cache: emptyCache(),
  };
  rebuildTopology(c);
  c.cache.boundingRadius = v.cache.boundingRadius;
  return c;
}

function subtreeUids(v: VesselState, rootUid: number): Set<number> {
  const out = new Set<number>();
  const stack = [rootUid];
  while (stack.length) {
    const u = stack.pop()!;
    if (out.has(u)) continue;
    out.add(u);
    const p = v.cache.byUid.get(u);
    if (p) stack.push(...p.children);
  }
  return out;
}

/**
 * Split off each listed subtree (cutting its link to its parent) into a new vessel. Rigid-body velocity
 * field is preserved, so linear and angular momentum are conserved exactly. Mutates `v`.
 */
export function splitVessel(v: VesselState, subtreeRoots: number[]): VesselState[] {
  const out: VesselState[] = [];
  const oldCom = v.com;
  for (const r of subtreeRoots) {
    if (!v.cache.byUid.has(r) || r === v.rootUid) continue;
    const uids = subtreeUids(v, r);
    const moved = v.parts.filter((p) => uids.has(p.uid));
    v.parts = v.parts.filter((p) => !uids.has(p.uid));
    rebuildTopology(v);
    const rootPart = moved.find((p) => p.uid === r)!;
    rootPart.parent = null;
    v.splitCount += 1;
    const nv: VesselState = {
      ...v,
      id: `${v.id}.${v.splitCount}`,
      name: `${v.name} Debris`,
      rootUid: r,
      parts: moved,
      position: { ...v.position },
      velocity: { ...v.velocity },
      orientation: { ...v.orientation },
      angularVelocity: { ...v.angularVelocity },
      com: { ...oldCom },
      sas: { mode: 'off', hold: null, integral: v3() },
      splitCount: 0,
      destroyed: false,
      telemetry: { ...v.telemetry, properAcceleration: v3(), control: { pitch: 0, yaw: 0, roll: 0 } },
      cache: emptyCache(),
    };
    rebuildTopology(nv);
    // Place the new vessel: start from old COM reference and shift to its own COM.
    nv.position = { ...v.position };
    nv.velocity = { ...v.velocity };
    recomputeMassProperties(nv, true);
    out.push(nv);
  }
  recomputeMassProperties(v, true);
  if (v.parts.length === 0) v.destroyed = true;
  return out;
}

/**
 * Remove (destroy) a part. Its child subtrees become new vessels; if the root is destroyed, the child
 * subtree containing a command module (else the heaviest) continues as this vessel.
 */
export function removePart(v: VesselState, uid: number): VesselState[] {
  const p = v.cache.byUid.get(uid);
  if (!p) return [];
  let children = [...p.children];
  if (uid === v.rootUid) {
    if (children.length === 0) {
      v.parts = [];
      v.destroyed = true;
      rebuildTopology(v);
      return [];
    }
    const score = (c: number) => {
      const set = subtreeUids(v, c);
      let mass = 0;
      let cmd = 0;
      for (const u of set) {
        const q = v.cache.byUid.get(u)!;
        mass += q.mass;
        if (q.def.modules.some((m) => m.type === 'command' && m.controllable !== false)) cmd = 1;
      }
      return cmd * 1e12 + mass;
    };
    const keep = children.reduce((a, b) => (score(b) > score(a) ? b : a));
    const keepPart = v.cache.byUid.get(keep)!;
    keepPart.parent = null;
    v.rootUid = keep;
    children = children.filter((c) => c !== keep);
  }
  v.parts = v.parts.filter((q) => q.uid !== uid);
  // Children of the removed part are temporarily parented to nothing; split them off.
  rebuildTopology(v);
  const detached: PartState[] = [];
  for (const c of children) {
    const ch = v.cache.byUid.get(c);
    if (ch) detached.push(ch);
  }
  // Re-attach to a virtual root so splitVessel can cut them: they already have parent === null after rebuild.
  const out: VesselState[] = [];
  for (const ch of detached) {
    const uids = subtreeUidsFromParts(v, ch.uid);
    const moved = v.parts.filter((q) => uids.has(q.uid));
    v.parts = v.parts.filter((q) => !uids.has(q.uid));
    v.splitCount += 1;
    const nv: VesselState = {
      ...v,
      id: `${v.id}.${v.splitCount}`,
      name: `${v.name} Debris`,
      rootUid: ch.uid,
      parts: moved,
      position: { ...v.position },
      velocity: { ...v.velocity },
      orientation: { ...v.orientation },
      angularVelocity: { ...v.angularVelocity },
      com: { ...v.com },
      sas: { mode: 'off', hold: null, integral: v3() },
      splitCount: 0,
      destroyed: false,
      telemetry: { ...v.telemetry, properAcceleration: v3(), control: { pitch: 0, yaw: 0, roll: 0 } },
      cache: emptyCache(),
    };
    rebuildTopology(nv);
    recomputeMassProperties(nv, true);
    out.push(nv);
  }
  rebuildTopology(v);
  recomputeMassProperties(v, true);
  if (v.parts.length === 0) v.destroyed = true;
  return out;
}

function subtreeUidsFromParts(v: VesselState, rootUid: number): Set<number> {
  const childrenOf = new Map<number, number[]>();
  for (const p of v.parts) if (p.parent !== null) childrenOf.set(p.parent, [...(childrenOf.get(p.parent) ?? []), p.uid]);
  const out = new Set<number>();
  const stack = [rootUid];
  while (stack.length) {
    const u = stack.pop()!;
    if (out.has(u)) continue;
    out.add(u);
    stack.push(...(childrenOf.get(u) ?? []));
  }
  return out;
}

/** Apply an impulse J (inertial, N*s) at body-frame point `pointBody` (relative to craft origin). */
export function applyImpulse(v: VesselState, J: Vec3, pointBody: Vec3): void {
  v.velocity = add(v.velocity, scale(J, 1 / v.mass));
  const rW = qRotate(v.orientation, sub(pointBody, v.com));
  const dLW = cross(rW, J);
  // dω_body = I^-1 R^T dL
  const dLB = qRotate({ x: -v.orientation.x, y: -v.orientation.y, z: -v.orientation.z, w: v.orientation.w }, dLW);
  const I = v.invInertia;
  v.angularVelocity = {
    x: v.angularVelocity.x + I[0] * dLB.x + I[1] * dLB.y + I[2] * dLB.z,
    y: v.angularVelocity.y + I[3] * dLB.x + I[4] * dLB.y + I[5] * dLB.z,
    z: v.angularVelocity.z + I[6] * dLB.x + I[7] * dLB.y + I[8] * dLB.z,
  };
}

/** Extra reach of a wheel beyond its part shape (wheel centre offset + tyre radius), m. */
function wheelReach(p: PartState): number {
  const m = p.def.modules[p.wheel!.moduleIndex] as WheelModule;
  return length(m.wheelCenter) + m.radius;
}

/** Deploy or retract all landing legs and retractable landing gear. */
export function setGear(v: VesselState, deployed: boolean): void {
  for (const p of v.parts) {
    if (p.bayOpen !== undefined) p.bayOpen = deployed;
    if (p.leg) p.leg.deployed = deployed;
    if (p.wheel && (p.def.modules[p.wheel.moduleIndex] as WheelModule).retractable) p.wheel.deployed = deployed;
  }
}

/** Current gear state: true if any retractable gear/leg is commanded down (undefined if the vessel has none). */
export function gearState(v: VesselState): boolean | undefined {
  let any: boolean | undefined;
  for (const p of v.parts) {
    if (p.bayOpen !== undefined) any = (any ?? false) || p.bayOpen;
    if (p.leg) any = (any ?? false) || p.leg.deployed;
    if (p.wheel && (p.def.modules[p.wheel.moduleIndex] as WheelModule).retractable) any = (any ?? false) || p.wheel.deployed;
  }
  return any;
}

/** World position of a body-frame point. */
export function bodyToWorld(v: VesselState, pBody: Vec3): Vec3 {
  return add(v.position, qRotate(v.orientation, sub(pBody, v.com)));
}

export function getPart(v: VesselState, uid: number): PartState | undefined {
  return v.cache.byUid.get(uid);
}

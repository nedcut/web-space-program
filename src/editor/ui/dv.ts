import type { CraftDef, EngineModule, PartDef, PartInstance, ResourceId } from '../../sim/vessel/types';
import { RESOURCES } from '../../data/resources';
import { buildVessel } from '../../sim/vessel/assembly';
import { computeStageDeltaV } from '../../sim/vessel/staging';
import { getStageList } from '../core';
import type { Body } from '../../sim/bodies/types';
import { sampleAtmosphere } from '../../sim/atmosphere';
import { fairingMassDelta } from '../../sim/vessel/fairing';

/** Legacy/default reference conditions for callers without a universe. */
const EDITOR_G = 9.81;
const ASL_PRESSURE = 101325;
const G0 = 9.80665;

export interface StageStats {
  dvVac: number;
  dvAsl: number;
  twrVac: number;
  twrAsl: number;
  burnTime: number;
  startMass: number;
  endMass: number;
  /** Thrust-to-weight at burnout (same engines, end mass). */
  twrEndVac: number;
  twrEndAsl: number;
}

/**
 * Per-stage delta-v keyed by UI stage index (0 fires first).
 * Prefers the simulation's `computeStageDeltaV` (exact resource flow rules); falls back to a local
 * rocket-equation estimate if the sim throws on an in-progress craft.
 */
export function computeStageStats(craft: CraftDef, catalog: Map<string, PartDef>, body?: Body): Map<number, StageStats> {
  const gravity = body?.surfaceGravity ?? EDITOR_G;
  const pressure = body ? (body.atmosphere ? sampleAtmosphere(body.atmosphere, 0, gravity).pressure : 0) : ASL_PRESSURE;
  const out = stageStatsAt(craft, catalog, gravity, pressure);
  for (const s of out.values()) {
    s.twrEndVac = s.endMass > 0 ? s.twrVac * s.startMass / s.endMass : 0;
    s.twrEndAsl = s.endMass > 0 ? s.twrAsl * s.startMass / s.endMass : 0;
  }
  return out;
}

function stageStatsAt(craft: CraftDef, catalog: Map<string, PartDef>, gravity: number, pressure: number): Map<number, StageStats> {
  const out = new Map<number, StageStats>();
  if (!craft.parts.length) return out;
  const maxStage = getStageList(craft).length - 1;
  try {
    const vessel = buildVessel(craft, catalog);
    for (const r of computeStageDeltaV(vessel, pressure, gravity)) {
      if (r.stage < 0 || r.stage > maxStage) continue;
      const idx = maxStage - r.stage;
      const prev = out.get(idx);
      const s: StageStats = {
        dvVac: r.dvVac, dvAsl: r.dvAsl,
        twrVac: r.startMass > 0 ? r.thrustVac / (r.startMass * gravity) : 0,
        twrAsl: r.twrStart, burnTime: r.burnTime, startMass: r.startMass, endMass: r.endMass, twrEndVac: 0, twrEndAsl: 0,
      };
      if (prev) { prev.dvVac += s.dvVac; prev.dvAsl += s.dvAsl; prev.burnTime += s.burnTime; prev.endMass = s.endMass; }
      else out.set(idx, s);
    }
    return out;
  } catch {
    return localEstimate(craft, catalog, maxStage, gravity, pressure);
  }
}

const engineOf = (def: PartDef) => def.modules.find((m): m is EngineModule => m.type === 'engine');
const density = (id: ResourceId) => RESOURCES[id].density;

/** Simple estimate: stages fire in order; decouplers drop subtrees; engines draw from stack-connected tanks. */
export function localEstimate(craft: CraftDef, catalog: Map<string, PartDef>, maxStage: number, gravity = EDITOR_G, pressure = ASL_PRESSURE): Map<number, StageStats> {
  const out = new Map<number, StageStats>();
  const parts = new Map<number, PartInstance>(craft.parts.map((p) => [p.uid, p]));
  const def = (p: PartInstance) => catalog.get(p.partId)!;
  const res = new Map<number, Partial<Record<ResourceId, number>>>();
  for (const p of craft.parts) res.set(p.uid, { ...def(p).resources, ...(p.resources ?? {}) });
  const alive = new Set(parts.keys());
  const children = (uid: number) => craft.parts.filter((c) => c.parent === uid && alive.has(c.uid));
  const subtree = (uid: number): number[] => [uid, ...children(uid).flatMap((c) => subtree(c.uid))];
  const mass = () => {
    let m = 0;
    for (const uid of alive) {
      const p = parts.get(uid)!;
      m += def(p).dryMass + fairingMassDelta(def(p), p.tweaks);
      const r = res.get(uid)!;
      for (const k in r) m += (r[k as ResourceId] ?? 0) * density(k as ResourceId);
    }
    return m;
  };
  /** Stack-connected parts not crossing decouplers. */
  const feed = (uid: number): number[] => {
    const seen = new Set([uid]);
    const queue = [uid];
    while (queue.length) {
      const u = queue.shift()!;
      const p = parts.get(u)!;
      if (u !== uid && def(p).modules.some((m) => m.type === 'decoupler')) continue;
      const nb: number[] = [];
      if (p.parent !== undefined && p.attachNode !== 'srf') nb.push(p.parent);
      for (const c of children(u)) if (c.attachNode !== 'srf') nb.push(c.uid);
      for (const n of nb) if (alive.has(n) && !seen.has(n)) { seen.add(n); queue.push(n); }
    }
    return [...seen];
  };
  const active = new Set<number>();
  for (let stage = maxStage; stage >= 0; stage--) {
    for (const p of craft.parts) {
      if (p.stage !== stage || !alive.has(p.uid)) continue;
      const d = def(p);
      if (engineOf(d)) active.add(p.uid);
      const dec = d.modules.find((m) => m.type === 'decoupler');
      if (dec && dec.type === 'decoupler') {
        const drop = dec.radial || p.attachNode === dec.node ? subtree(p.uid)
          : children(p.uid).filter((c) => c.parentNode === dec.node).flatMap((c) => subtree(c.uid));
        // Never drop the root side.
        if (!drop.some((u) => parts.get(u)!.parent === undefined)) for (const u of drop) { alive.delete(u); active.delete(u); }
      }
    }
    const startMass = mass();
    const s: StageStats = { dvVac: 0, dvAsl: 0, twrVac: 0, twrAsl: 0, burnTime: 0, startMass, endMass: startMass, twrEndVac: 0, twrEndAsl: 0 };
    let first = true;
    for (let iter = 0; iter < 200; iter++) {
      // Engines with propellant available.
      const burning: { uid: number; e: EngineModule; mdot: number; pool: number[] }[] = [];
      for (const uid of active) {
        if (!alive.has(uid)) continue;
        const e = engineOf(def(parts.get(uid)!))!;
        const pool = feed(uid);
        const ok = Object.entries(e.propellants).every(([k, ratio]) => !ratio || density(k as ResourceId) === 0
          || pool.some((u) => (res.get(u)![k as ResourceId] ?? 0) > 1e-9));
        if (ok) burning.push({ uid, e, mdot: e.maxThrustVac * Math.max(0, Math.min(1, parts.get(uid)!.tweaks?.thrustLimit ?? 1)) / (e.ispVac * G0), pool });
      }
      if (!burning.length) break;
      let fVac = 0, fAsl = 0, mdot = 0;
      for (const b of burning) { mdot += b.mdot; fVac += b.mdot * b.e.ispVac * G0; fAsl += b.mdot * (b.e.ispVac + (b.e.ispAsl - b.e.ispVac) * Math.min(1, pressure / ASL_PRESSURE)) * G0; }
      if (first) { s.twrVac = fVac / (startMass * gravity); s.twrAsl = fAsl / (startMass * gravity); first = false; }
      // Per (part,resource) drain rates in units/s, split evenly over the pool's tanks holding it.
      const rate = new Map<string, number>();
      for (const b of burning) {
        const mix = Object.entries(b.e.propellants).filter(([k, r]) => r && density(k as ResourceId) > 0) as [ResourceId, number][];
        const mixMass = mix.reduce((a, [k, r]) => a + r * density(k), 0);
        for (const [k, r] of mix) {
          const unitsPerSec = (b.mdot * r) / mixMass;
          const holders = b.pool.filter((u) => (res.get(u)![k] ?? 0) > 1e-9);
          for (const u of holders) rate.set(`${u}|${k}`, (rate.get(`${u}|${k}`) ?? 0) + unitsPerSec / holders.length);
        }
      }
      let t = Infinity;
      for (const [key, r] of rate) {
        const [u, k] = key.split('|');
        t = Math.min(t, (res.get(+u)![k as ResourceId] ?? 0) / r);
      }
      if (!isFinite(t) || t <= 0) break;
      const m0 = mass();
      for (const [key, r] of rate) {
        const [u, k] = key.split('|');
        const pr = res.get(+u)!;
        pr[k as ResourceId] = Math.max(0, (pr[k as ResourceId] ?? 0) - r * t);
      }
      const m1 = mass();
      if (m1 < m0) {
        const lr = Math.log(m0 / m1);
        s.dvVac += (fVac / mdot) * lr;
        s.dvAsl += (fAsl / mdot) * lr;
      }
      s.burnTime += t;
    }
    s.endMass = mass();
    out.set(maxStage - stage, s);
  }
  return out;
}

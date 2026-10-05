import type { PartState, VesselState } from './runtime';
import type { ResourceId } from './types';
import { flowGroups } from './resources';
import { recomputeMassProperties } from './assembly';

const IDS: ResourceId[] = ['regolith', 'electricCharge', 'liquidFuel', 'oxidizer', 'monopropellant'];
const EPS = 1e-10;
const machineryCache = new WeakMap<VesselState['cache'], PartState[]>();
export function isruMachinery(v: VesselState): PartState[] {
  let parts = machineryCache.get(v.cache);
  if (!parts) {
    parts = v.parts.filter(p => p.def.modules.some(m => m.type === 'drill' || m.type === 'converter'));
    machineryCache.set(v.cache, parts);
  }
  return parts;
}
interface Process { part: PartState; rates: number[]; fraction: number; heat: number }

/** Refining uses a vessel-wide transfer manifold (including stack tanks). No input is vented:
 * all recoverable feedstock mass becomes product; recipes are kg fractions, rates are L/s of feed.
 * EC is massless. Fuel cells and constant generators share the same boundary solve in physics
 * and landed rails, preserving simultaneous supply/demand without large-dt battery top-ups.
 * Fuel-cell draws retain their stack feed groups; refining retains its vessel-wide manifold. */
export function advanceISRU(v: VesselState, concentration: number, dt: number): void {
  if (!(dt > 0) || v.destroyed) return;
  const machinery = isruMachinery(v);
  const sources = v.parts.filter(p => p.def.modules.some(m => m.type === 'generator' || m.type === 'fuelCell'));
  if (!machinery.length && !sources.length) return;
  // Resolve each tank separately so fuel-cell crossfeed and depletion boundaries remain visible.
  const pools = IDS.flatMap(id => v.parts.filter(p => (p.maxResources[id] ?? 0) > 0).map(part => ({ id, part })));
  const capacity = pools.map(({ id, part }) => part.maxResources[id]!);
  let remaining = dt;
  while (remaining > 1e-12) {
    let interval = remaining;
    const processes: Process[] = [];
    for (const p of machinery) {
      const deploy = p.drillDeploy ?? 0;
      if (p.def.modules.some(m => m.type === 'drill')) {
        const distance = p.drillDeployed ? 1 - deploy : deploy;
        if (distance > 1e-12) interval = Math.min(interval, distance * 2);
      }
      for (const m of p.def.modules) {
        if (m.type === 'drill' && v.situation === 'landed' && p.drillDeployed && deploy >= 1 - 1e-12 && concentration > 0) {
          processes.push({ part: p, rates: [m.rate * Math.min(1, concentration), -m.ecRate, 0, 0, 0], fraction: 1, heat: m.heat });
        } else if (m.type === 'converter' && p.converterRunning) {
          const mass = m.rate * v.resourceDefs.regolith.density;
          const mono = p.converterRecipe === 'monopropellant';
          processes.push({ part: p, rates: [-m.rate, -m.ecRate,
            mono ? 0 : mass / 3.56 / v.resourceDefs.liquidFuel.density,
            mono ? 0 : mass * 2.56 / 3.56 / v.resourceDefs.oxidizer.density,
            mono ? mass / v.resourceDefs.monopropellant.density : 0], fraction: 1, heat: m.heat });
        }
      }
    }
    const amounts = pools.map(({ id, part }) => part.resources[id] ?? 0);
    const distribute = (rates: number[], consumer?: PartState): number[] => {
      const result = pools.map(() => 0);
      IDS.forEach((id, resourceIndex) => {
        const rate = rates[resourceIndex];
        let indices = pools.flatMap((pool, i) => pool.id === id ? [i] : []);
        if (consumer && rate < 0) {
          const groups = flowGroups(v, consumer.uid, id).map(group => indices.filter(i => group.includes(pools[i].part.uid)));
          indices = groups.find(group => group.some(i => amounts[i] > EPS)) ?? groups.flat();
        }
        let weights = indices.map(i => rate > 0 ? Math.max(0, capacity[i] - amounts[i]) : amounts[i]);
        let total = weights.reduce((a, b) => a + b, 0);
        // At a boundary, incoming and outgoing flows can balance without an artificial battery buffer.
        if (total <= EPS) { weights = indices.map(i => capacity[i]); total = weights.reduce((a, b) => a + b, 0); }
        indices.forEach((i, j) => { result[i] = total > 0 ? rate * weights[j] / total : 0; });
      });
      return result;
    };
    for (const process of processes) {
      if (process.rates.some((rate, i) => rate !== 0 && !pools.some(pool => pool.id === IDS[i]))) process.fraction = 0;
      process.rates = distribute(process.rates);
    }
    for (const part of sources) for (const m of part.def.modules) {
      if ((m.type !== 'generator' && m.type !== 'fuelCell') || m.chargeRate <= 0) continue;
      if (!pools.some(pool => pool.id === 'electricCharge')) continue;
      if (m.type === 'fuelCell' && (['liquidFuel', 'oxidizer'] as const).some(id =>
        !flowGroups(v, part.uid, id).flat().some(uid => pools.some(pool => pool.id === id && pool.part.uid === uid)))) continue;
      const rates = m.type === 'generator' ? [0, m.chargeRate, 0, 0, 0] : [0, m.chargeRate, -m.fuelRate, -m.oxidizerRate, 0];
      processes.push({ part, rates: distribute(rates, part), fraction: 1, heat: 0 });
    }
    // At empty/full boundaries throttle competing processes together. Revisit dependent constraints
    // until stable (e.g. EC starvation stops a drill that was feeding an empty converter tank).
    for (let pass = 0; pass < 64; pass++) {
      let changed = false;
      for (let i = 0; i < pools.length; i++) {
        let input = 0, output = 0;
        for (const p of processes) { const r = p.rates[i] * p.fraction; if (r > 0) input += r; else output -= r; }
        const empty = amounts[i] <= EPS;
        const full = capacity[i] - amounts[i] <= EPS;
        if (empty && output > input + EPS) {
          for (const p of processes) if (p.rates[i] < 0) p.fraction *= input / output;
          changed = true;
        }
        if (full && input > output + EPS) {
          for (const p of processes) if (p.rates[i] > 0) p.fraction *= output / input;
          changed = true;
        }
      }
      if (!changed) break;
    }
    const net = pools.map((_, i) => processes.reduce((s, p) => s + p.rates[i] * p.fraction, 0));
    for (let i = 0; i < pools.length; i++) {
      if (net[i] > EPS) interval = Math.min(interval, Math.max(0, capacity[i] - amounts[i]) / net[i]);
      if (net[i] < -EPS) interval = Math.min(interval, Math.max(0, amounts[i]) / -net[i]);
    }
    if (interval <= 1e-12) break;
    for (let i = 0; i < pools.length; i++) {
      const { id, part } = pools[i];
      part.resources[id] = Math.max(0, Math.min(capacity[i], amounts[i] + net[i] * interval));
    }
    for (const p of machinery) {
      if (p.def.modules.some(m => m.type === 'drill')) {
        const d = (p.drillDeploy ?? 0) + (p.drillDeployed ? 1 : -1) * interval / 2;
        p.drillDeploy = Math.max(0, Math.min(1, d));
      }
      // Integral radiator, 8 W/K conductance; isolated core's thermal mass is dryMass * 800 J/K.
      const power = processes.filter(x => x.part === p).reduce((s, x) => s + x.heat * x.fraction, 0);
      const equilibrium = 288 + power / 8;
      p.processTemperature = equilibrium + ((p.processTemperature ?? 288) - equilibrium) * Math.exp(-interval * 8 / (p.def.dryMass * 800));
    }
    remaining -= interval;
  }
  recomputeMassProperties(v, false);
}

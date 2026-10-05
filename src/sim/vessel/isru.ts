import type { PartState, VesselState } from './runtime';
import type { ResourceId } from './types';
import { totalResource } from './resources';
import { recomputeMassProperties } from './assembly';

const IDS: ResourceId[] = ['regolith', 'electricCharge', 'liquidFuel', 'oxidizer', 'monopropellant'];
const EPS = 1e-10;
interface Process { part: PartState; rates: number[]; fraction: number; heat: number }

/** Refining uses a vessel-wide transfer manifold (including stack tanks). No input is vented:
 * all recoverable feedstock mass becomes product; recipes are kg fractions, rates are L/s of feed.
 * EC is massless. Tank/deployment boundary events make long landed-rails intervals analytical. */
export function advanceISRU(v: VesselState, concentration: number, dt: number): void {
  if (!(dt > 0) || v.destroyed) return;
  const machinery = v.parts.filter(p => p.def.modules.some(m => m.type === 'drill' || m.type === 'converter'));
  if (!machinery.length) return;
  const capacity = IDS.map(id => v.parts.reduce((s, p) => s + (p.maxResources[id] ?? 0), 0));
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
    const amounts = IDS.map(id => totalResource(v, id));
    // At empty/full boundaries throttle competing processes together. Revisit dependent constraints
    // until stable (e.g. EC starvation stops a drill that was feeding an empty converter tank).
    for (let pass = 0; pass < 64; pass++) {
      let changed = false;
      for (let i = 0; i < IDS.length; i++) {
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
    const net = IDS.map((_, i) => processes.reduce((s, p) => s + p.rates[i] * p.fraction, 0));
    for (let i = 0; i < IDS.length; i++) {
      if (net[i] > EPS) interval = Math.min(interval, Math.max(0, capacity[i] - amounts[i]) / net[i]);
      if (net[i] < -EPS) interval = Math.min(interval, Math.max(0, amounts[i]) / -net[i]);
    }
    if (interval <= 1e-12) break;
    for (let i = 0; i < IDS.length; i++) {
      const id = IDS[i], change = net[i] * interval;
      const pool = change >= 0 ? capacity[i] - amounts[i] : amounts[i];
      if (pool <= 0 || change === 0) continue;
      for (const p of v.parts) {
        const have = p.resources[id] ?? 0, cap = p.maxResources[id] ?? 0;
        const share = change >= 0 ? Math.max(0, cap - have) : have;
        if (share) p.resources[id] = Math.max(0, Math.min(cap, have + change * share / pool));
      }
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

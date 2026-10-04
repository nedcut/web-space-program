import { describe, expect, it } from 'vitest';
import { Universe } from '../src/game/universe';
import { World } from '../src/game/world';
import { PART_CATALOG } from '../src/data/parts';
import { buildRingrunner } from '../src/editor/stockCrafts';
import { DEFAULT_START_UT } from '../src/game/store';
import { ascentGuidance, executeNode, planCircularization, runAutopilot, coastUntil, type Autopilot } from '../src/game/autopilot';
import { period } from '../src/sim/orbit';
import { planInterplanetaryTransfer, planCourseCorrectionToBody } from '../src/game/interplanetary';

describe('Ringrunner Saturn mission', () => {
  it('launches from Earth, flies to Saturn and captures into a bound orbit', () => {
    const world = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT);
    const wv = world.launch(buildRingrunner()), t0 = world.ut;
    const log: string[] = [];
    const run = (ap: Autopilot, maxTime: number, phase: string) => {
      let last = world.ut, dv = 0, report = world.ut;
      const ok = runAutopilot(world, ap, { maxTime, onTick: w => {
        const dt = w.ut - last; last = w.ut;
        if (process.env.SATURN_DEBUG && ap.status !== 'coast' && w.ut - report > 100) { report = w.ut; console.log(phase, ap.status, w.ut-t0, wv.state.mass, wv.state.nextStage, w.orbitSummary(wv), wv.state.telemetry.thrust); }
        if (dt < 1 && wv.state.telemetry.thrust > 0) dv += wv.state.telemetry.thrust / wv.state.mass * dt;
      } });
      const o = world.orbitSummary(wv);
      log.push(`${phase}: T+${(world.ut - t0).toFixed(0)}s Δv=${dv.toFixed(2)}m/s mass=${wv.state.mass.toFixed(0)}kg ${wv.body} Pe=${(o.pe / 1000).toFixed(2)}km Ap=${(o.ap / 1000).toFixed(2)}km ${ap.error ?? ''}`);
      expect(ok, ap.error).toBe(true);
    };
    try {
      run(ascentGuidance(world, { targetApoapsis: 120000, minStage: 2 }), 2000, 'ascent');
      run(executeNode(world, planCircularization(world, 'apoapsis'), { minStage: 2 }), 2000, 'parking');
      expect(world.orbitSummary(wv).pe).toBeGreaterThan(world.universe.body('earth').atmosphere!.height);
      const start = performance.now();
      const transfer = planInterplanetaryTransfer(world, 'saturn', { periapsisAltitude: 1200000 });
      log.push(`Planner: ${(performance.now() - start).toFixed(0)}ms`);
      expect(transfer).not.toBeNull();
      expect(world.trajectory().some(p => p.orbit.body === 'saturn')).toBe(true);
      expect(transfer!.patches.map(p => p.orbit.body)).toEqual(['earth', 'sun', 'saturn']);
      log.push(`Transfer: wait ${(transfer!.node.time - world.ut) / 86400} days, flight ${transfer!.timeOfFlight / 86400} days, planned Δv=${transfer!.dv.toFixed(2)}m/s`);
      run(executeNode(world, transfer!.node, { minStage: 2 }), transfer!.node.time - world.ut + 2000, 'departure');
      coastUntil(world, world.ut + 2e6, { stopOnSoi: true });
      expect(wv.body).toBe('sun');
      const mcc = planCourseCorrectionToBody(world, 'saturn', { arrivalTime: transfer!.arrivalTime, periapsisAltitude: 1200000, time: world.ut + 86400, maxDv: 1000 });
      expect(mcc).not.toBeNull();
      log.push(`MCC plan ${mcc!.dv.toFixed(3)} m/s, arrival pe ${(mcc!.periapsisAltitude / 1000).toFixed(2)} km`);
      run(executeNode(world, mcc!.node, { minStage: 0, matchEnergy: false }), 2e5, 'MCC');
      // Re-target late in cruise: sub-m/s finite-burn residuals grow over a multi-year coast.
      coastUntil(world, transfer!.node.time + transfer!.timeOfFlight * 0.9, { stopOnSoi: true });
      expect(wv.body).toBe('sun');
      const trim = planCourseCorrectionToBody(world, 'saturn', { arrivalTime: transfer!.arrivalTime, periapsisAltitude: 1200000 });
      expect(trim).not.toBeNull();
      log.push(`Late MCC plan ${trim!.dv.toFixed(3)} m/s`);
      run(executeNode(world, trim!.node, { minStage: 0, matchEnergy: false }), 5000, 'late MCC');
      coastUntil(world, trim!.encounterTime - 3 * 86400, { stopOnSoi: true });
      expect(wv.body).toBe('sun');
      const finalTrim = planCourseCorrectionToBody(world, 'saturn', { arrivalTime: transfer!.arrivalTime, periapsisAltitude: 1200000 });
      expect(finalTrim).not.toBeNull();
      log.push(`Final MCC plan ${finalTrim!.dv.toFixed(3)} m/s`);
      run(executeNode(world, finalTrim!.node, { minStage: 0, matchEnergy: false }), 5000, 'final MCC');
      coastUntil(world, transfer!.arrivalTime + 86400, { stopOnSoi: true });
      expect(wv.body).toBe('saturn');
      expect(Math.abs(world.orbitSummary(wv).pe - 1200000)).toBeLessThan(200000);
      log.push(`Saturn arrival T+${(world.ut-t0).toFixed(0)}s pe=${(world.orbitSummary(wv).pe/1000).toFixed(2)}km`);
      run(executeNode(world, planCircularization(world, 'periapsis'), { minStage: 0 }), 1e7, 'capture');
      expect(world.orbitOf(wv).e).toBeLessThan(1);
      expect(world.orbitSummary(wv).pe).toBeGreaterThan(world.universe.body('saturn').atmosphere!.height);
      // Survive two complete revolutions on rails: capture must be durable, not an atmospheric ellipse.
      coastUntil(world, world.ut + 2 * period(world.orbitOf(wv)));
      expect(wv.body).toBe('saturn');
      expect(world.orbitSummary(wv).pe).toBeGreaterThan(world.universe.body('saturn').atmosphere!.height);
      expect(world.vessels.has(wv.state.id)).toBe(true);
      expect(wv.state.destroyed).toBe(false);
    } finally { console.log(log.join('\n')); }
  }, 240000);
});

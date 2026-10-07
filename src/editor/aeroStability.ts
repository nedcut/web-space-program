import { buildVessel, recomputeMassProperties } from '../sim/vessel/assembly';
import { computeAeroForces } from '../sim/vessel/aero';
import { engineModule, gimbalAuthority, maxMassFlow, propellantNeed, thrustAtPressure } from '../sim/vessel/engines';
import { availableResource, drawPropellants } from '../sim/vessel/resources';
import { computeStageDeltaV } from '../sim/vessel/staging';
import type { CraftDef, PartDef } from '../sim/vessel/types';
import { thrustLimit } from '../sim/vessel/tweaks';
import { v3 } from '../util/vec3';

/** Worst available restoring moment at 5° AoA, divided by dynamic pressure (m³).
 * Sample launch-stage fuel travel and sub/trans/supersonic flow on both lateral axes.
 * Use symmetric perturbations to remove trim torque, and reserve half the actual control
 * surface and launch-engine gimbal moment for guidance/damping. A negative result means SAS cannot readily arrest
 * the aerodynamic divergence. This is an advisory envelope, not a flight guarantee.
 */
export function aeroControlMargin(craft: CraftDef, catalog: Map<string, PartDef>): number {
  const v = buildVessel(craft, catalog);
  const engines = v.parts.filter(p => p.stage === v.nextStage && !!p.engine);
  const duration = computeStageDeltaV(v).find(s => s.stage === v.nextStage)?.burnTime ?? 0;
  let worst = Infinity;
  for (let fuelStep = 0; fuelStep <= 4; fuelStep++) {
    if (fuelStep) {
      for (const p of engines) {
        const m = engineModule(p)!;
        drawPropellants(v, p.uid, propellantNeed(m, v.resourceDefs, maxMassFlow(m) * thrustLimit(p) * duration / 5));
      }
      recomputeMassProperties(v, false);
    }
    for (const p of engines) {
      const m = engineModule(p)!;
      p.engine!.ignited = Object.entries(m.propellants).every(([id, ratio]) => !ratio || availableResource(v, p.uid, id as keyof typeof m.propellants) > 1e-9);
      p.engine!.thrust = thrustAtPressure(m, thrustLimit(p), 101325);
    }
    const gimbal = gimbalAuthority(v);
    for (const mach of [0.3, 0.8, 1.1, 1.5, 2.5]) {
      const speed = mach * 340, lateral = speed * Math.tan(5 * Math.PI / 180);
      const q = Math.min(0.5 * 1.225 * speed * speed, mach < 0.8 ? 12000 : 25000);
      const air = { density: 2 * q / (speed * speed), pressure: 101325, temperature: 288, speedOfSound: 340 };
      for (const axis of ['x', 'z'] as const) {
        const torqueAxis = axis === 'x' ? 'z' : 'x';
        const torque = (sign: number, command = 0) => {
          const velocity = v3(0, speed, 0); velocity[axis] = sign * lateral;
          const control = v3(); control[torqueAxis] = command;
          return computeAeroForces(v, { air, airVelocityBody: velocity, control }).torqueBody[torqueAxis];
        };
        const base = (torque(1) - torque(-1)) / 2;
        const divergence = axis === 'x' ? base : -base;
        const authority = Math.abs(torque(1, 1) - torque(1, -1)) / 2;
        worst = Math.min(worst, (0.5 * (authority + gimbal[torqueAxis]) - divergence) / q);
      }
    }
  }
  return worst;
}

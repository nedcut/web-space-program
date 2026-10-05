import { periapsisRadius, stateToElements } from '../../sim/orbit';
import { concentrationAt } from '../../sim/resources/deposits';
import { qConj, qRotate } from '../../util/quat';
import { cross, dot, normalize } from '../../util/vec3';
import { Universe } from '../universe';
import type { World } from '../world';
import type { WorldInternals } from './internals';
const bodyQuat = (u: Universe, id: string, t: number) => u.ephem.bodyRotation(id, t);


export function localConcentration(this: World, _internals: WorldInternals, wv = this.active): number {
  if (!wv) return 0;
  const fixed = wv.mode === 'landedRails' || wv.mode === 'prelaunch' ? wv.fixed : undefined;
  const direction = fixed?.pos ?? qRotate(qConj(bodyQuat(this.universe, wv.body, this.ut)), this.relativeState(wv).position);
  return concentrationAt(this.universe.body(wv.body), direction);
}

/** A bound orbit, above terrain/atmosphere, within 10 degrees of polar relative to the body's pole. */
export function surveyBody(this: World, _internals: WorldInternals, wv = this.active): boolean {
  if (!wv || !wv.state.parts.some(p => !p.electronicsFailed && p.def.modules.some(m => m.type === 'surveyScanner'))) return false;
  const b = this.universe.body(wv.body), s = this.relativeState(wv);
  if (!b.solidSurface || wv.state.situation !== 'flying') return false;
  const h = normalize(cross(s.position, s.velocity));
  const pole = qRotate(bodyQuat(this.universe, wv.body, this.ut), { x: 0, y: 0, z: 1 });
  const orbit = stateToElements(b.gm, b.id, s.position, s.velocity, this.ut);
  if (orbit.e >= 1 || periapsisRadius(orbit) <= b.radius + Math.max(b.atmosphere?.height ?? 0, b.surface.relief)
    || Math.abs(dot(h, pole)) > Math.sin(Math.PI / 18)) return false;
  if (!this.surveyedBodies.includes(b.id)) this.surveyedBodies.push(b.id);
  return true;
}

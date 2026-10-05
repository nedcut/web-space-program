import { add, cross, dot, length, normalize, scale, sub, type Vec3 } from '../../util/vec3';
import type { JointLoad } from './loads';
import type { VesselState } from './runtime';
import { activeLinks, linkEndpoints, linkModule } from './links';

interface Influence { force: Vec3; torque: Vec3; forceCompliance: number; torqueCompliance: number }
interface Brace { uid: number; stiffness: number; cuts: Map<number, Influence> }
type Strength = { force: number; torque: number };

/** Minimum complementary energy for a rigid tree reinforced by axial braces.
 * Small virtual attachment deflections determine load sharing only; no geometry moves.
 * A brace's unit force crosses every cut on the endpoint path, with its actual moment arm.
 * Solve (diag(1/k) + Bᵀ C B)t = Bᵀ C w, then w_joint = w - Bt.
 * C uses ratings / 1 mm (force) and ratings / 1 mrad (moment) as virtual stiffnesses.
 * Consequently perpendicular braces cannot carry axial loads and sibling braces affect both branches.
 */
export function distributeStrutLoads(v: VesselState, joints: Map<number, JointLoad>, point: (uid: number) => Vec3,
  strength: (uid: number) => Strength): void {
  const braces: Brace[] = [];
  for (const p of activeLinks(v, 'strut')) {
    const link = p.link!, spec = linkModule(p)!;
    if (spec.type !== 'strut') continue;
    const ends = linkEndpoints(link, v.cache.byUid)!;
    const span = sub(ends.b, ends.a), len = length(span);
    if (len < 1e-6) continue;
    const direction = normalize(span);
    const cuts = new Map<number, Influence>();
    // Signed unit-force wrenches about the COM cancel on the shared path to the root.
    const walk = (uid: number, endpoint: Vec3, sign: number) => {
      let host = v.cache.byUid.get(uid);
      const force = scale(direction, sign);
      while (host && host.parent !== null) {
        const prior = cuts.get(host.uid), rating = strength(host.uid);
        const torque = cross(sub(endpoint, point(host.uid)), force);
        cuts.set(host.uid, { force: prior ? add(prior.force, force) : force,
          torque: prior ? add(prior.torque, torque) : torque,
          forceCompliance: 0.001 / Math.max(1, rating.force), torqueCompliance: 0.001 / Math.max(1, rating.torque) });
        host = v.cache.byUid.get(host.parent);
      }
    };
    walk(link.sourceUid, ends.a, 1); walk(link.targetUid, ends.b, -1);
    for (const [uid, cut] of cuts) if (length(cut.force) < 1e-9 && length(cut.torque) < 1e-9) cuts.delete(uid);
    braces.push({ uid: p.uid, stiffness: spec.stiffness / len, cuts });
  }
  const readings = new Map<number, number>();
  v.cache.strutLoads = readings;
  if (!braces.length) return;
  const n = braces.length;
  const matrix = Array.from({ length: n }, () => new Float64Array(n));
  const rhs = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = braces[i];
    matrix[i][i] = 1 / Math.max(1, a.stiffness);
    for (const [uid, influence] of a.cuts) {
      const raw = joints.get(uid);
      if (!raw) continue;
      rhs[i] += dot(influence.force, raw.force) * influence.forceCompliance + dot(influence.torque, raw.torque) * influence.torqueCompliance;
      for (let j = 0; j <= i; j++) {
        const b = braces[j].cuts.get(uid);
        if (!b) continue;
        const value = dot(influence.force, b.force) * influence.forceCompliance + dot(influence.torque, b.torque) * influence.torqueCompliance;
        matrix[i][j] += value;
        if (i !== j) matrix[j][i] += value;
      }
    }
  }
  // SPD Cholesky avoids pivot ambiguity and is deterministic in catalog/UID order.
  for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) {
    let value = matrix[i][j];
    for (let k = 0; k < j; k++) value -= matrix[i][k] * matrix[j][k];
    matrix[i][j] = i === j ? Math.sqrt(Math.max(1e-30, value)) : value / matrix[j][j];
  }
  const tensions = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let value = rhs[i];
    for (let j = 0; j < i; j++) value -= matrix[i][j] * tensions[j];
    tensions[i] = value / matrix[i][i];
  }
  for (let i = n - 1; i >= 0; i--) {
    let value = tensions[i];
    for (let j = i + 1; j < n; j++) value -= matrix[j][i] * tensions[j];
    tensions[i] = value / matrix[i][i];
    readings.set(braces[i].uid, Math.abs(tensions[i]));
  }
  for (let i = 0; i < n; i++) for (const [uid, influence] of braces[i].cuts) {
    const load = joints.get(uid);
    if (!load) continue;
    load.force = sub(load.force, scale(influence.force, tensions[i]));
    load.torque = sub(load.torque, scale(influence.torque, tensions[i]));
  }
  for (const [uid, load] of joints) {
    const rating = strength(uid);
    load.fraction = Math.max(length(load.force) / rating.force, length(load.torque) / rating.torque);
  }
}

import { qRotate, type Quat } from '../../util/quat';
import type { Vec3 } from '../../util/vec3';

/**
 * Render-side interpolation between fixed physics steps.
 *
 * Physics advances in 20 ms steps while displays refresh at 60–240 Hz, so a frame can see zero, one or two
 * steps. Drawing the latest state directly makes everything that moves relative to the camera (terrain,
 * launch site, other vessels) advance unevenly — the classic fixed-step judder. World captures the state
 * immediately before each physics step; the renderer draws at `ut - PHYSICS_DT * (1 - alpha)` with every
 * vessel interpolated between its previous and current body-relative state.
 *
 * This is purely read-only with respect to the simulation: `apply` swaps in freshly allocated position and
 * orientation objects for the duration of a render and `restore` puts the original references back, so the
 * float64 state seen by the next physics step is bit-for-bit unchanged.
 *
 * Positions are interpolated for the vessel's build-frame origin (`position − R·com`), not its centre of mass:
 * when staging or draining tanks move the COM inside the vessel, the parts themselves do not move, so the
 * drawn vessel must not slide between the two steps either.
 */

export interface InterpolatedVessel {
  body: string;
  state: { id: string; position: Vec3; velocity: Vec3; orientation: Quat; com?: Vec3 };
}

const ZERO: Vec3 = { x: 0, y: 0, z: 0 };
/** World offset of the centre of mass from the build-frame origin. */
const comOffset = (s: InterpolatedVessel['state'], q: Quat = s.orientation) => (s.com ? qRotate(q, s.com) : ZERO);

interface Sample {
  position: Vec3;
  orientation: Quat;
  body: string;
}

export interface BodyStateSource {
  getBodyState(id: string, t: number): { position: Vec3; velocity: Vec3 };
}

export class RenderHistory {
  private prevUt = Number.NaN;
  private readonly prev = new Map<string, Sample>();

  /** Record the state immediately before a physics step at `ut`. */
  capture(ut: number, vessels: Iterable<InterpolatedVessel>) {
    this.prevUt = ut;
    let n = 0;
    for (const v of vessels) {
      n++;
      const s = v.state;
      let e = this.prev.get(s.id);
      if (!e) {
        e = { position: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 }, body: v.body };
        this.prev.set(s.id, e);
      }
      const c = comOffset(s);
      e.position.x = s.position.x - c.x; e.position.y = s.position.y - c.y; e.position.z = s.position.z - c.z;
      e.orientation.x = s.orientation.x; e.orientation.y = s.orientation.y; e.orientation.z = s.orientation.z; e.orientation.w = s.orientation.w;
      e.body = v.body;
    }
    // Drop vessels that no longer exist (cheap: only when the fleet shrank).
    if (this.prev.size > n) {
      const live = new Set<string>();
      for (const v of vessels) live.add(v.state.id);
      for (const id of this.prev.keys()) if (!live.has(id)) this.prev.delete(id);
    }
  }

  /** Forget history (rails warp, scene reload): the next render draws the current state. */
  invalidate() {
    this.prevUt = Number.NaN;
  }

  /** True when the last capture was exactly one step before `ut`. */
  valid(ut: number, stepDt: number) {
    return Number.isFinite(this.prevUt) && Math.abs(ut - stepDt - this.prevUt) < 1e-6;
  }

  /**
   * Interpolate every captured vessel to `prevUt + alpha * stepDt`. Returns the render time and a restore
   * callback that must run before any simulation code touches the vessels again.
   */
  apply(ut: number, stepDt: number, alpha: number, vessels: Iterable<InterpolatedVessel>, ephem: BodyStateSource): { renderUt: number; restore: () => void } {
    if (!this.valid(ut, stepDt) || !(alpha < 1)) return { renderUt: ut, restore: noop };
    const a = Math.max(0, alpha);
    const renderUt = this.prevUt + a * stepDt;
    const bodies = new Map<string, { p0: Vec3; p1: Vec3; pr: Vec3; v1: Vec3 }>();
    const bodyAt = (id: string) => {
      let b = bodies.get(id);
      if (!b) {
        const cur = ephem.getBodyState(id, ut);
        b = { p0: ephem.getBodyState(id, this.prevUt).position, p1: cur.position, pr: ephem.getBodyState(id, renderUt).position, v1: cur.velocity };
        bodies.set(id, b);
      }
      return b;
    };
    const swapped: { state: InterpolatedVessel['state']; position: Vec3; orientation: Quat }[] = [];
    for (const v of vessels) {
      const s = v.state;
      const p = this.prev.get(s.id);
      if (!p || p.body !== v.body) continue;
      const b = bodyAt(v.body);
      const r0x = p.position.x - b.p0.x, r0y = p.position.y - b.p0.y, r0z = p.position.z - b.p0.z;
      const c1 = comOffset(s);
      const r1x = s.position.x - c1.x - b.p1.x, r1y = s.position.y - c1.y - b.p1.y, r1z = s.position.z - c1.z - b.p1.z;
      // Teleports (splits, scenario setup, docking re-roots) are not interpolated.
      const rel = Math.hypot(s.velocity.x - b.v1.x, s.velocity.y - b.v1.y, s.velocity.z - b.v1.z);
      if (Math.hypot(r1x - r0x, r1y - r0y, r1z - r0z) > rel * stepDt * 2 + 5) continue;
      swapped.push({ state: s, position: s.position, orientation: s.orientation });
      const q = slerp(p.orientation, s.orientation, a);
      const c = comOffset(s, q);
      s.position = {
        x: b.pr.x + r0x + (r1x - r0x) * a + c.x,
        y: b.pr.y + r0y + (r1y - r0y) * a + c.y,
        z: b.pr.z + r0z + (r1z - r0z) * a + c.z,
      };
      s.orientation = q;
    }
    if (!swapped.length) return { renderUt, restore: noop };
    return {
      renderUt,
      restore: () => {
        for (const w of swapped) {
          w.state.position = w.position;
          w.state.orientation = w.orientation;
        }
      },
    };
  }
}

const noop = () => {};

/** Shortest-path spherical interpolation of unit quaternions. */
export function slerp(a: Quat, b: Quat, t: number): Quat {
  let bx = b.x, by = b.y, bz = b.z, bw = b.w;
  let d = a.x * bx + a.y * by + a.z * bz + a.w * bw;
  if (d < 0) { d = -d; bx = -bx; by = -by; bz = -bz; bw = -bw; }
  let k0: number, k1: number;
  if (d > 0.9995) {
    k0 = 1 - t; k1 = t;
  } else {
    const th = Math.acos(Math.min(1, d));
    const s = Math.sin(th);
    k0 = Math.sin((1 - t) * th) / s;
    k1 = Math.sin(t * th) / s;
  }
  const x = a.x * k0 + bx * k1, y = a.y * k0 + by * k1, z = a.z * k0 + bz * k1, w = a.w * k0 + bw * k1;
  const l = Math.hypot(x, y, z, w) || 1;
  return { x: x / l, y: y / l, z: z / l, w: w / l };
}

import type { Body } from '../bodies/types';
import type { Vec3 } from '../../util/vec3';
import { normalize } from '../../util/vec3';
import { Simplex3 } from '../terrain/noise';

const fields = new Map<number, Simplex3>();
/** Seamless body-fixed recoverable regolith fraction. Polar enrichment models volatile retention.
 * A continuous geological field avoids biome-border discontinuities and is independent of terrain LOD. */
export function concentrationAt(body: Body, direction: Vec3): number {
  if (!body.solidSurface || body.kind === 'star') return 0;
  const seed = body.surface.seed ^ 0x524547;
  let noise = fields.get(seed);
  if (!noise) { noise = new Simplex3(seed); fields.set(seed, noise); }
  const d = normalize(direction);
  return Math.max(0, Math.min(1, 0.35 + 0.28 * noise.noise(d.x * 3, d.y * 3, d.z * 3)
    + 0.12 * noise.noise(d.x * 11, d.y * 11, d.z * 11) + 0.15 * d.z ** 4));
}

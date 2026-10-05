import { length, normalize, sub, type Vec3 } from '../../util/vec3';

/** Artistic activity envelope; direction is geometric, independent of orbital velocity. */
export function cometActivity(position: Vec3, sun: Vec3, au: number) {
  const offset = sub(position, sun);
  const distanceAU = length(offset) / au;
  return { direction: normalize(offset), distanceAU,
    brightness: Math.min(1, 1 / Math.max(0.2, distanceAU) ** 2) * Math.max(0, Math.min(1, (5 - distanceAU) / 2)),
    jets: Math.max(0, Math.min(1, (3 - distanceAU) / 2)) };
}

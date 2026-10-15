import { earthCover } from '../terrain/earthCover';
import { earthData } from '../terrain/earthData';
import type { Body } from '../bodies/types';
import type { Terrain, RGB } from '../terrain/api';
import { coastLift, LAUNCH_SITE, latLonToUnit } from '../terrain';
import { add, cross, dot, normalize, scale, type Vec3 } from '../../util/vec3';

export type Situation = 'landed' | 'splashed' | 'flyingLow' | 'flyingHigh' | 'spaceLow' | 'spaceHigh';
export const BIOMES: Record<string, readonly string[]> = {
  ...Object.fromEntries(['vesta', 'pallas', 'hygiea', 'bennu', 'ryugu', 'itokawa', 'eros', 'psyche', 'halley', '67p'].map(id => [id, ['Surface']])),
  earth: ['Oceans', 'Shores', 'Grasslands', 'Deserts', 'Mountains', 'Ice Caps', 'Launch Complex', 'Forests', 'Rainforests', 'Tundra'],
  moon: ['Highlands', 'Lowland Maria', 'Polar Craters', 'Crater Rims'],
  mars: ['Plains', 'Highlands', 'Canyons', 'Polar Caps', 'Volcanic Rise'],
  titan: ['Hydrocarbon Seas', 'Dunes', 'Highlands'],
};
export const GENERIC_BIOMES = ['Lowlands', 'Highlands', 'Ridges', 'Polar Regions'] as const;

/** Body-fixed direction, using exactly the terrain sampled by collision and rendering. */
export function biomeAt(body: Body, terrain: Terrain, direction: Vec3): string {
  if (body.kind === 'asteroid' || body.kind === 'comet') return 'Surface';
  if (!body.solidSurface) return 'Atmospheric Bands';
  const d = normalize(direction), lat = Math.abs(Math.asin(d.z));
  if (body.id === 'earth') {
    if (Math.acos(Math.min(1, dot(d, latLonToUnit(LAUNCH_SITE.lat, LAUNCH_SITE.lon)))) * body.radius < 2500) return 'Launch Complex';
    const sample = { range: 0, coastal: false };
    const metres = earthData().sample(d.x, d.y, d.z, sample);
    const elevation = (terrain.heightAt(d.x, d.y, d.z) - coastLift(metres)) * 8800 / body.surface.relief;
    return earthCover(Math.asin(d.z) * 180 / Math.PI, Math.atan2(d.y, d.x) * 180 / Math.PI, elevation, sample.coastal);
  }
  const h = terrain.heightAt(d.x, d.y, d.z);
  const relief = Math.max(1, terrain.maxHeight - terrain.minHeight);
  const level = (h - terrain.minHeight) / relief;
  const tangent = normalize(cross(Math.abs(d.z) < 0.9 ? { x: 0, y: 0, z: 1 } : { x: 1, y: 0, z: 0 }, d));
  const eps = 0.0002;
  const a = normalize(add(d, scale(tangent, eps)));
  const b = normalize(add(d, scale(cross(d, tangent), eps)));
  const slope = Math.hypot(terrain.heightAt(a.x, a.y, a.z) - h, terrain.heightAt(b.x, b.y, b.z) - h) / (body.radius * eps);
  const color: RGB = [0, 0, 0];
  terrain.colorAt?.(d.x, d.y, d.z, h, color);
  if (body.id === 'moon') {
    if (lat > 1.15) return 'Polar Craters';
    if (slope > 0.13) return 'Crater Rims';
    return h < -body.surface.relief * 0.1 ? 'Lowland Maria' : 'Highlands';
  }
  if (body.id === 'mars') {
    if (lat > 1.15) return 'Polar Caps';
    if (h > body.surface.relief * 0.32) return 'Volcanic Rise';
    if (slope > 0.12 || level < 0.20) return 'Canyons';
    return level > 0.46 ? 'Highlands' : 'Plains';
  }
  if (body.id === 'titan') {
    if (terrain.liquid && h < terrain.liquid.level) return 'Hydrocarbon Seas';
    return level > 0.48 ? 'Highlands' : 'Dunes';
  }
  if (lat > 1.15) return 'Polar Regions';
  if (slope > 0.16) return 'Ridges';
  return level > 0.5 ? 'Highlands' : 'Lowlands';
}

export function situationAt(body: Body, altitude: number, contact: 'landed' | 'splashed' | 'flying'): Situation {
  if (body.solidSurface && contact !== 'flying') return contact;
  const atmo = body.atmosphere?.height ?? 0;
  if (altitude < atmo) return altitude < atmo * 0.25 ? 'flyingLow' : 'flyingHigh';
  return altitude < Math.max(atmo * 2, body.radius * 0.25) ? 'spaceLow' : 'spaceHigh';
}

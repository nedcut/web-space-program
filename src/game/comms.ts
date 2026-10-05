import { solveNetwork, type CommsNode, type Network } from '../sim/comms/network';
import { LAUNCH_SITE, latLonToUnit } from '../sim/terrain';
import { add, scale } from '../util/vec3';
import { qRotate } from '../util/quat';
import type { World } from './world';
import { isExtended } from '../sim/vessel/tweaks';

/** Degrees, body-fixed. Ratings are metres in the playable universe, across scale presets. */
export const GROUND_STATIONS = [
  { id: 'ground-coastal', name: 'Coastal Launch Complex', lat: LAUNCH_SITE.lat, lon: LAUNCH_SITE.lon, range: 8e12 },
  { id: 'ground-ochre', name: 'Ochre Plateau Station', lat: -25, lon: 45, range: 8e12 },
  { id: 'ground-dawn', name: 'Dawn Reach Station', lat: 12, lon: 165, range: 8e12 },
];

const stationSites = new WeakMap<World['universe'], { direction: ReturnType<typeof latLonToUnit>; altitude: number }[]>();

/** Adapter only: the graph solver has no World, ephemeris, DOM or renderer dependencies. */
export function worldNetwork(w: World): Network {
  const u = w.universe, earth = u.body('earth'), center = u.ephem.getBodyState('earth', w.ut).position;
  const rotation = u.ephem.bodyRotation('earth', w.ut);
  let sites = stationSites.get(u);
  if (!sites) {
    sites = GROUND_STATIONS.map(s => {
      const direction = latLonToUnit(s.lat, s.lon);
      return { direction, altitude: Math.max(0, u.terrain('earth').heightAt(direction.x, direction.y, direction.z)) + 30 };
    });
    stationSites.set(u, sites);
  }
  const nodes: CommsNode[] = GROUND_STATIONS.map((s, i) => {
    const { direction: d, altitude } = sites[i];
    return { ...s, position: add(center, qRotate(rotation, scale(d, earth.radius + altitude))), relay: true, ground: true };
  });
  for (const { state: v } of w.vessels.values()) {
    if (v.destroyed) continue;
    const antennas = v.parts.filter(isExtended).flatMap(p => p.def.modules.filter(m => m.type === 'antenna'));
    nodes.push({ id: v.id, name: v.name, position: { ...v.position }, range: Math.max(0, ...antennas.map(a => a.range)), relay: antennas.some(a => a.relay) });
  }
  return solveNetwork(nodes, [...u.bodies.values()].map(b => ({ radius: b.radius, position: u.ephem.getBodyState(b.id, w.ut).position })));
}

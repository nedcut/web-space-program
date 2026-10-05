import { add, dot, length, scale, sub, type Vec3 } from '../../util/vec3';

export interface CommsSettings { enabled: boolean; restrictControl: boolean }
export const defaultCommsSettings = (mode: string): CommsSettings => ({ enabled: mode !== 'sandbox', restrictControl: true });
export interface CommsNode { id: string; name: string; position: Vec3; range: number; relay: boolean; ground?: boolean }
export interface Occluder { position: Vec3; radius: number }
export interface CommsLink { a: string; b: string; strength: number; distance: number }
export interface Connection { connected: boolean; strength: number; path: string[]; delay: number }
export interface Network { nodes: CommsNode[]; links: CommsLink[]; connections: Map<string, Connection> }
export const NO_SIGNAL: Connection = { connected: false, strength: 0, path: [], delay: 0 };
export const LIGHT_SPEED = 299792458;
export const linkRange = (a: number, b: number) => Math.sqrt(Math.max(0, a)) * Math.sqrt(Math.max(0, b));

/** Segment/sphere test in a local float64 frame; surface endpoints are allowed. */
export function occluded(a: Vec3, b: Vec3, bodies: Occluder[]): boolean {
  const d = sub(b, a), dd = dot(d, d);
  if (!dd) return false;
  return bodies.some(body => {
    const relative = sub(a, body.position);
    const t = Math.max(0, Math.min(1, -dot(relative, d) / dd));
    const closest = add(relative, scale(d, t));
    return length(closest) < body.radius - 0.01;
  });
}

/** Multi-source Dijkstra: -log(strength) makes the strongest product path shortest.
 * Non-relay vessels can receive a route but can never extend it to another vessel.
 */
export function solveNetwork(nodes: CommsNode[], bodies: Occluder[]): Network {
  const links: CommsLink[] = [], neighbors = new Map<string, CommsLink[]>();
  for (const node of nodes) neighbors.set(node.id, []);
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    const a = nodes[i], b = nodes[j], distance = length(sub(a.position, b.position));
    const range = linkRange(a.range, b.range);
    if (range <= 0 || distance >= range || occluded(a.position, b.position, bodies)) continue;
    const x = 1 - distance / range;
    const link = { a: a.id, b: b.id, strength: x * x * (3 - 2 * x), distance };
    links.push(link); neighbors.get(a.id)!.push(link); neighbors.get(b.id)!.push(link);
  }
  const connections = new Map<string, Connection>();
  const costs = new Map(nodes.map(n => [n.id, n.ground ? 0 : Infinity]));
  for (const n of nodes) connections.set(n.id, n.ground ? { connected: true, strength: 1, path: [n.id], delay: 0 } : { ...NO_SIGNAL, path: [] });
  const pending = new Map(nodes.map(n => [n.id, n]));
  while (pending.size) {
    let best: CommsNode | undefined, cost = Infinity;
    for (const n of pending.values()) if (costs.get(n.id)! < cost) { best = n; cost = costs.get(n.id)!; }
    if (!best) break;
    pending.delete(best.id);
    if (!best.ground && !best.relay) continue;
    const route = connections.get(best.id)!;
    for (const edge of neighbors.get(best.id)!) {
      const id = edge.a === best.id ? edge.b : edge.a;
      const candidate = cost - Math.log(edge.strength);
      if (!pending.has(id) || candidate >= costs.get(id)!) continue;
      costs.set(id, candidate);
      connections.set(id, { connected: true, strength: Math.exp(-candidate), path: [id, ...route.path], delay: route.delay + edge.distance / LIGHT_SPEED });
    }
  }
  return { nodes, links, connections };
}

export function remoteControlAllowed(settings: CommsSettings, crewed: boolean, connected: boolean): boolean {
  return crewed || !settings.enabled || !settings.restrictControl || connected;
}

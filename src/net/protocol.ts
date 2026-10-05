import { validCraftLinks } from '../sim/vessel/links';
import { validCommands, validGroupActions } from '../sim/vessel/actions';
import { validTweaks } from '../sim/vessel/tweaks';
import type { SavedWorld } from '../game/persistence';
import type { WorldVessel } from '../game/world';
import type { ControlInput, PartState, VesselEvent, VesselState } from '../sim/vessel/runtime';
import type { CraftDef } from '../sim/vessel/types';
import type { PlantedFlag } from '../sim/crew/crew';

export const PROTOCOL_VERSION = 1;
export const WARP_RATES = [1, 2, 3, 4, 5, 10, 50, 100, 1000] as const;
export const MAX_MESSAGE_BYTES = 512_000;
export type LaunchSite = 'pad' | 'runway';
export interface Player { id: string; name: string; vesselId: string | null; warp: number }
type Envelope = { v: typeof PROTOCOL_VERSION };
export type ClientMessage = Envelope & (
  | { type: 'join'; room: string; name: string }
  | { type: 'leave' }
  | { type: 'input'; vesselId: string; seq: number; input: ControlInput }
  | { type: 'claim'; vesselId: string }
  | { type: 'release' }
  | { type: 'launch'; craft: CraftDef; site: LaunchSite }
  | { type: 'warp'; rate: number }
  | { type: 'chat'; text: string }
  | { type: 'action'; action: 'eva' | 'board' | 'flag' | 'undock'; uid?: number; astronautId?: string }
);
export type PartDelta = Pick<PartState, 'uid' | 'tweaks' | 'resources' | 'mass' | 'temperature' | 'skinTemperature' | 'activated' | 'engine' | 'chute' | 'leg' | 'wheel' | 'bayOpen' | 'drillDeployed' | 'drillDeploy' | 'converterRunning' | 'converterRecipe' | 'processTemperature' | 'dockDisarmed' | 'structuralFatigue' | 'linkFatigue' | 'link'>;
export type DynamicState = Pick<VesselState, 'position' | 'velocity' | 'orientation' | 'angularVelocity' | 'mass' | 'com' | 'inertia' | 'invInertia' | 'nextStage' | 'situation' | 'sas' | 'telemetry' | 'eva' | 'destroyed' | 'groupState'> & { parts: PartDelta[] };
export type HazardDelta = Pick<PartState, 'uid' | 'radiationDose' | 'ambientTemperature' | 'pressureExposure' | 'pressureWarned' | 'heatWarned' | 'electronicsDegraded' | 'electronicsFailed'> & { electricCharge?: number };
export type VesselDelta = { id: string; body: string; hazards?: HazardDelta[]; crewDose?: { id: string; dose: number }[] } & (
  | { mode: 'rails'; orbit: NonNullable<WorldVessel['orbit']>; precise?: WorldVessel['precise'] }
  | { mode: 'landedRails'; fixed: NonNullable<WorldVessel['fixed']>; state?: DynamicState }
  | { mode: 'physics' | 'prelaunch'; state: DynamicState; fixed?: WorldVessel['fixed'] }
);
export type NetEvent = VesselEvent | { type: 'flag'; flag: PlantedFlag } | { type: 'chat'; playerId: string; name: string; text: string } | { type: 'join' | 'leave'; playerId: string; name: string };
export interface RoomState { players: Player[]; rate: number; requestedRate: number; heldBy: string[]; queue: { playerId: string; site: LaunchSite }[] }
export type ServerMessage = Envelope & (
  | { type: 'welcome'; playerId: string; room: string }
  | { type: 'snapshot'; tick: number; world: SavedWorld; room: RoomState }
  | { type: 'delta'; tick: number; ut: number; vessels: VesselDelta[]; room: RoomState; ack: Record<string, number> }
  | { type: 'event'; tick: number; event: NetEvent }
  | { type: 'error'; message: string }
);

/** JSON reserves non-finite numbers (telemetry NaN, parabolic a=Infinity) explicitly. */
export function encode(message: ClientMessage | ServerMessage): string {
  return JSON.stringify(message, (_k, x) => typeof x === 'number' && !Number.isFinite(x) ? { $number: String(x) } : x);
}
const record = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const str = (x: unknown, max = 80): x is string => typeof x === 'string' && x.length > 0 && x.length <= max;
const num = (x: unknown, bound = 1e12): x is number => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) <= bound;
const vec = (x: unknown, quat = false) => record(x) && ['x', 'y', 'z', ...(quat ? ['w'] : [])].every(k => num(x[k])) &&
  (!quat || Math.abs(Math.hypot(x.x as number, x.y as number, x.z as number, x.w as number) - 1) < 0.01);
function parse(raw: string, max = MAX_MESSAGE_BYTES): Record<string, unknown> {
  if (raw.length > max) throw new Error('Message too large');
  const value: unknown = JSON.parse(raw, (_k, x: unknown) => {
    if (record(x) && Object.keys(x).length === 1 && ['$number'].every(k => k in x)) {
      if (x.$number === 'NaN') return NaN;
      if (x.$number === 'Infinity') return Infinity;
      if (x.$number === '-Infinity') return -Infinity;
    }
    return x;
  });
  if (!record(value) || value.v !== PROTOCOL_VERSION) throw new Error('Unsupported protocol version');
  return value;
}
function validInput(x: unknown): boolean {
  if (!record(x)) return false;
  if (!['pitch', 'yaw', 'roll', 'translateX', 'translateY', 'translateZ'].every(k => num(x[k], 1))) return false;
  if (!num(x.throttle, 1) || x.throttle < 0 || typeof x.stage !== 'boolean' || typeof x.rcs !== 'boolean') return false;
  if (!['off', 'stabilityAssist', 'prograde', 'retrograde', 'normal', 'antinormal', 'radialIn', 'radialOut', 'target', 'antiTarget', 'maneuver'].includes(String(x.sas))) return false;
  if (!['gear', 'brakes', 'evaJump', 'evaRun'].every(k => x[k] === undefined || typeof x[k] === 'boolean')) return false;
  if (x.wheelThrottle !== undefined && !num(x.wheelThrottle, 1)) return false;
  if (x.sasReference !== undefined && !['orbit', 'surface', 'target'].includes(String(x.sasReference))) return false;
  if (x.commands !== undefined && !validCommands(x.commands)) return false;
  return (x.evaHeading === undefined || vec(x.evaHeading, true)) && (x.maneuverDirection === undefined || vec(x.maneuverDirection)) &&
    (x.target === undefined || (record(x.target) && vec(x.target.position) && vec(x.target.velocity)));
}
export function validCraft(x: unknown): x is CraftDef {
  if (!record(x) || x.version !== 1 || !str(x.name) || !['VAB', 'SPH'].includes(String(x.type)) || !Array.isArray(x.parts) || !x.parts.length || x.parts.length > 200) return false;
  const ids = new Set<number>();
  for (const p of x.parts) {
    if (!record(p) || !Number.isSafeInteger(p.uid) || !num(p.uid, 1e6) || ids.has(p.uid) || !str(p.partId) || !vec(p.position) || !vec(p.rotation, true)) return false;
    if (['x', 'y', 'z'].some(k => Math.abs((p.position as Record<string, number>)[k]) > 1000)) return false;
    if (p.parent !== undefined && !Number.isSafeInteger(p.parent)) return false;
    if (p.stage !== undefined && (!num(p.stage, 100) || !Number.isInteger(p.stage))) return false;
    if (p.resources !== undefined && (!record(p.resources) || !Object.values(p.resources).every(v => num(v, 1e9) && v >= 0))) return false;
    if (p.tweaks !== undefined && !validTweaks(p.tweaks)) return false;
    if (p.actions !== undefined && !validGroupActions(p.actions)) return false;
    ids.add(p.uid);
  }
  const parts = x.parts as CraftDef['parts'];
  if (parts.filter(p => p.parent === undefined).length !== 1) return false;
  for (const part of parts) {
    const seen = new Set<number>([part.uid]);
    let parent = part.parent;
    while (parent !== undefined) {
      if (seen.has(parent) || !ids.has(parent)) return false;
      seen.add(parent);
      parent = parts.find(p => p.uid === parent)!.parent;
    }
  }
  return validCraftLinks(parts);
}
export function decodeClient(raw: string): ClientMessage {
  const m = parse(raw);
  let ok = false;
  switch (m.type) {
    case 'join': ok = str(m.name, 24) && !!m.name.trim() && typeof m.room === 'string' && /^(?:[A-Z0-9]{4,8})?$/.test(m.room); break;
    case 'leave': case 'release': ok = true; break;
    case 'claim': ok = str(m.vesselId); break;
    case 'input': ok = str(m.vesselId) && Number.isSafeInteger(m.seq) && num(m.seq) && m.seq >= 0 && validInput(m.input); break;
    case 'launch': ok = validCraft(m.craft) && ['pad', 'runway'].includes(String(m.site)); break;
    case 'warp': ok = WARP_RATES.some(r => r === m.rate); break;
    case 'chat': ok = str(m.text, 300) && !!m.text.trim(); break;
    case 'action': ok = ['eva', 'board', 'flag', 'undock'].includes(String(m.action)) && (m.uid === undefined || Number.isSafeInteger(m.uid)) && (m.astronautId === undefined || str(m.astronautId)); break;
  }
  if (!ok) throw new Error('Invalid client message');
  return m as ClientMessage;
}
export function decodeServer(raw: string): ServerMessage {
  const m = parse(raw, 16_000_000);
  let ok = false;
  switch (m.type) {
    case 'welcome': ok = str(m.playerId) && str(m.room); break;
    case 'error': ok = str(m.message, 1000); break;
    case 'event': ok = num(m.tick) && record(m.event) && str(m.event.type); break;
    case 'snapshot': ok = num(m.tick) && record(m.world) && m.world.version === 1 && Array.isArray(m.world.vessels) && record(m.room) && Array.isArray(m.room.players); break;
    case 'delta': ok = num(m.tick) && num(m.ut) && Array.isArray(m.vessels) && record(m.room) && Array.isArray(m.room.players) && record(m.ack); break;
  }
  if (!ok) throw new Error('Invalid server message');
  return m as ServerMessage;
}

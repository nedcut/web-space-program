import { BODY_DEFS } from '../../data/bodies';
import type { FlightRecord } from './recorder';
export interface Achievement { id: string; name: string; description: string; test: (r: FlightRecord, flags: string[]) => boolean }
export type AchievementState = Record<string, number>;
const feat = (id: string, name: string, description: string, test: Achievement['test']): Achievement => ({ id, name, description, test });
const event = (r: FlightRecord, kind: string) => r.events.some(e => e.kind === kind);
export const ACHIEVEMENTS: Achievement[] = [
  ...BODY_DEFS.filter(b => b.id !== 'earth' && b.id !== 'sun').map(b => feat(`soi-${b.id}`, `Hello, ${b.name}`, `Enter ${b.name}'s sphere of influence.`, r => r.bodies.includes(b.id))),
  feat('launch', 'Skyward ink', 'Launch a vessel.', r => r.launched),
  feat('orbit', 'A circle without an end', 'Reach a stable orbit above atmosphere and terrain.', r => event(r, 'orbit')),
  feat('moon-land', 'Silver doorstep', 'Land on the Moon.', r => r.landedBodies.includes('moon')),
  feat('moon-return', 'The long way home', 'Recover on Earth after landing on the Moon.', r => r.outcome === 'recovered' && r.landedBodies.includes('moon')),
  feat('rings', 'Between the bright bands', 'Pass through Saturn’s ring plane within the ring annulus.', r => event(r, 'rings')),
  feat('titan-land', 'Amber shores', 'Land or splash down on Titan.', r => r.landedBodies.includes('titan')),
  feat('dock', 'Two become one', 'Dock two vessels.', r => event(r, 'docking')),
  feat('eva', 'A door into infinity', 'Send an astronaut on EVA.', r => event(r, 'eva')),
  ...[1, 3, 5, 10].map(n => feat(`flags-${n}`, `Our shared horizon ${n}`, `Plant flags on ${n} different bodies across your flights.`, (_r, flags) => flags.length >= n)),
  feat('soft', 'Featherweight arrival', 'Land from flight below 1 m/s.', r => r.events.some(e => (e.kind === 'landing' || e.kind === 'splashdown') && e.speed !== undefined && e.speed < 1)),
  feat('hot', 'Bare metal courage', 'Survive an unshielded entry above 1,500 m/s and 1,000 K, then recover.', r => r.hotUnshielded && r.outcome === 'recovered'),
  feat('ssto', 'One piece to the sky', 'Fly a winged vessel from the surface to stable orbit without separating hardware or losing parts.', r => r.plane && r.launched && event(r, 'orbit') && !event(r, 'separation') && !event(r, 'partLoss')),
  feat('assist', 'Borrowed momentum', 'Gain over 100 m/s in an unpowered flyby, with less than 10 m/s thrust Δv.', r => event(r, 'assist')),
  feat('high', 'Above the blue', 'Reach 100 km altitude.', r => r.stats.maxAltitude >= 100000),
  feat('fast', 'Speed of a thought', 'Reach 5 km/s surface-relative speed.', r => r.stats.maxSpeed >= 5000),
  feat('g', 'Heavy afternoon', 'Experience 5 g and recover the vessel.', r => r.stats.maxG >= 5 && r.outcome === 'recovered'),
  feat('marathon', 'A million metres', 'Travel 1,000 km relative to the surface.', r => r.stats.distance >= 1e6),
  feat('tour', 'Postcards from everywhere', 'Visit five bodies in one flight.', r => r.bodies.length >= 5),
  feat('float', 'Ocean receipt', 'Splash down and recover.', r => event(r, 'splashdown') && r.outcome === 'recovered'),
  feat('repair', 'Still here', 'Recover after losing a part.', r => event(r, 'partLoss') && r.outcome === 'recovered'),
  feat('day', 'Tomorrow’s traveller', 'Keep a launched flight running for a full day.', r => r.launched && (r.end ?? r.last?.ut ?? r.start) - r.start >= 86400),
];
export function awardAchievements(state: AchievementState, r: FlightRecord, flags: string[], ut: number): Achievement[] {
  const earned = ACHIEVEMENTS.filter(a => state[a.id] === undefined && a.test(r, flags));
  for (const a of earned) state[a.id] = ut;
  return earned;
}

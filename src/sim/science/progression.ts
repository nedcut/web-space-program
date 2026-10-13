import { BIOMES, GENERIC_BIOMES } from './biomes';
import type { ArchiveEntry } from './experiments';
export type GameMode = 'sandbox' | 'science' | 'career';
export type ContractKind = 'orbit' | 'return' | 'science' | 'flyby';
export interface Contract {
  id: string; kind: ContractKind; title: string; body: string; biome?: string;
  status: 'offered' | 'active' | 'completed' | 'failed';
  advance: number; reward: number; penalty: number; reputation: number;
  landed: boolean; deadline?: number;
}
export interface Progression {
  science: number; funds: number; reputation: number; unlocked: string[];
  archive: Record<string, ArchiveEntry>; nextDataId: number;
  contracts: Contract[]; contractSeed: number; contractBatch: number; milestones: string[];
  /** Capability the current offers were drawn for (see `offerKey`); new capability replaces stale offers. */
  offerKey?: string;
}
export type ProgressEvent =
  | { type: 'orbit' | 'landed' | 'soi'; body: string; vesselId: string }
  | { type: 'science'; body: string; biome: string; vesselId: string }
  | { type: 'recovered'; body: string; vesselId: string; visited: string[] };
export function newProgression(creditsMultiplier = 1): Progression {
  return { science: 0, funds: Math.round(60000 * creditsMultiplier), reputation: 0, unlocked: ['foundation'], archive: {}, nextDataId: 1,
    contracts: [], contractSeed: 20300720, contractBatch: 0, milestones: [] };
}
export interface ContractReadiness { orbit: boolean; lunar: boolean; landing: boolean }
export const offerKey = (advanced: boolean, r: ContractReadiness) => `${+advanced}${+r.orbit}${+r.lunar}${+r.landing}`;
/** Same objective: completing one would complete the other with the same flight. */
export const sameObjective = (a: Contract, b: Contract) => a.kind === b.kind && a.body === b.body && a.biome === b.biome;
/** Offers follow demonstrated capability; no lunar surface return in a new program. */
export function generateContracts(seed: number, batch = 0, advanced = false, creditsMultiplier = 1,
  readiness: ContractReadiness = { orbit: false, lunar: false, landing: false }): Contract[] {
  let n = (seed + Math.imul(batch, 2654435761)) >>> 0;
  const random = () => { n = (Math.imul(n, 1664525) + 1013904223) >>> 0; return n / 4294967296; };
  const bodies = advanced ? ['moon', 'mars', 'titan', 'enceladus'] : readiness.lunar ? ['earth', 'moon'] : ['earth'];
  const body = bodies[Math.floor(random() * bodies.length)];
  const label = (id: string) => id[0].toUpperCase() + id.slice(1);
  const factor = body === 'earth' ? 1 : body === 'moon' ? 2 : 5;
  const scienceBody = readiness.landing || advanced ? body : 'earth';
  const scienceBiomes = BIOMES[scienceBody] ?? GENERIC_BIOMES;
  const biome = batch === 0 ? 'Launch Complex' : scienceBiomes[Math.floor(random() * scienceBiomes.length)];
  const offer = (kind: ContractKind, target: string, title: string, f: number, b?: string): Contract => {
    // Home-planet test flights and field surveys use the same small rockets on every scale: no scale bonus.
    const m = target === 'earth' && (kind === 'return' || kind === 'science') ? f : f * creditsMultiplier;
    return { id: `survey-${batch}-${kind}`, kind, title, body: target, biome: b, status: 'offered',
      advance: Math.round((kind === 'science' ? 3000 : kind === 'flyby' ? 10000 : 5000) * m),
      reward: Math.round((kind === 'science' ? 10000 : kind === 'flyby' ? 20000 : kind === 'orbit' ? 18000 : 12000) * m),
      penalty: Math.round(3000 * m), reputation: 3 * f, landed: false };
  };
  const expedition = readiness.orbit && !readiness.landing
    ? offer('flyby', 'moon', 'Enter the Moon sphere of influence', 2)
    : readiness.landing || advanced
      ? offer('return', body === 'earth' ? 'moon' : body, `Surface expedition and return · ${label(body === 'earth' ? 'moon' : body)}`, Math.max(2, factor))
      : offer('return', 'earth', 'Test flight · Earth', 1);
  return [offer('orbit', body, `Establish orbit · ${label(body)}`, factor), expedition,
    offer('science', scienceBody, `Field survey · ${label(scienceBody)} / ${biome}`, scienceBody === 'earth' ? 1 : factor, biome)];
}
/** Repeatable public recovery funding. Available regardless of contract slots or research.
 * Restores a modest flight budget; reputation is the cost, so bankruptcy never blocks play.
 */
export function requestRecoveryGrant(p: Progression, creditsMultiplier = 1): boolean {
  const floor = Math.round(8000 * creditsMultiplier);
  if (p.funds >= floor) return false;
  p.funds = floor; p.reputation -= 5;
  return true;
}
export function acceptContract(p: Progression, id: string, ut: number): boolean {
  const c = p.contracts.find(c => c.id === id);
  if (!c || c.status !== 'offered' || p.contracts.filter(c => c.status === 'active').length >= 3) return false;
  c.status = 'active'; c.deadline = ut + 20 * 365.25 * 86400; p.funds += c.advance;
  return true;
}
export function failContract(p: Progression, c: Contract): boolean {
  if (c.status !== 'active') return false;
  c.status = 'failed'; p.funds -= c.penalty; p.reputation -= c.reputation; return true;
}
export function evaluateContracts(p: Progression, event: ProgressEvent): string[] {
  const messages: string[] = [];
  for (const c of p.contracts) {
    if (c.status !== 'active') continue;
    if (c.kind === 'return' && event.type === 'landed' && event.body === c.body && !c.landed) {
      c.landed = true; messages.push(`Surface objective achieved: ${c.title}. Recover expedition hardware on Earth.`);
    }
    const done = (c.kind === 'orbit' && event.type === 'orbit' && event.body === c.body)
      || (c.kind === 'flyby' && event.type === 'soi' && event.body === c.body)
      || (c.kind === 'science' && event.type === 'science' && event.body === c.body && event.biome === c.biome)
      || (c.kind === 'return' && c.landed && event.type === 'recovered' && event.body === 'earth' && event.visited.includes(c.body));
    if (done) {
      c.status = 'completed'; p.funds += c.reward; p.reputation += c.reputation;
      messages.push(`Contract complete: ${c.title} · +${c.reward.toLocaleString()} cr`);
    }
  }
  return messages;
}

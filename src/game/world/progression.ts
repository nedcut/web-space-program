import { careerScaleMultiplier } from '../../sim/bodies/scale';
import { unlockTech as unlockTechModel } from '../../data/technology';
import { acceptContract as acceptContractModel, failContract, generateContracts, offerKey, requestRecoveryGrant as requestRecoveryGrantModel, sameObjective, type ProgressEvent } from '../../sim/science/progression';
import { instruments, progressionEvent, runExperiment as runExperimentModel, scienceContext as scienceContextModel, transmitScience as transmitScienceModel } from '../science';
import type { World, WorldVessel } from '../world';


/**
 * Fill the desk. Offers are drawn for the program's demonstrated capability: when that changes (first orbit,
 * new research…) unaccepted offers are replaced; otherwise new offers come only once the desk is clear.
 * Offers that duplicate an active commission are skipped (one flight must not complete both).
 */
export function refreshContracts(this: World): boolean {
  if (this.mode !== 'career') return false;
  const p = this.progression;
  const advanced = p.milestones.includes('first-moon') && p.unlocked.includes('propulsion-3') && p.unlocked.includes('energy-2');
  const readiness = {
    orbit: p.milestones.includes('first-orbit') && p.unlocked.includes('propulsion-0'),
    lunar: p.milestones.includes('first-moon-flyby') && p.unlocked.includes('propulsion-1'),
    landing: p.milestones.includes('first-moon-flyby') && p.unlocked.includes('structures-1') && p.unlocked.includes('propulsion-1'),
  };
  const key = offerKey(advanced, readiness);
  const offered = p.contracts.some(c => c.status === 'offered');
  if (offered && p.offerKey === key) return false;
  if (offered) p.contracts = p.contracts.filter(c => c.status !== 'offered');
  p.offerKey = key;
  const fresh = generateContracts(p.contractSeed, p.contractBatch++, advanced, careerScaleMultiplier(this.universe.preset), readiness);
  p.contracts.push(...fresh.filter(c => !p.contracts.some(a => a.status === 'active' && sameObjective(a, c))));
  return true;
}


export function requestRecoveryGrant(this: World): boolean {
  if (this.mode !== 'career') return false;
  const granted = requestRecoveryGrantModel(this.progression, careerScaleMultiplier(this.universe.preset));
  if (granted) this.message('Emergency flight funding received · −5 reputation');
  return granted;
}

export function acceptContract(this: World, id: string) { return this.mode === 'career' && acceptContractModel(this.progression, id, this.ut); }


export function abandonContract(this: World, id: string) {
  const c = this.progression.contracts.find(c => c.id === id);
  if (this.mode !== 'career' || !c) return false;
  if (c.status === 'offered') { c.status = 'failed'; return true; }
  return failContract(this.progression, c);
}


export function unlockTech(this: World, id: string) {
  const ok = this.mode !== 'sandbox' && unlockTechModel(this.progression, id);
  if (ok) this.refreshContracts();
  return ok;
}


export function scienceContext(this: World, v = this.active) { return v ? scienceContextModel(this, v) : null; }


export function scienceInstruments(this: World, v = this.active) { return v ? instruments(this, v) : []; }


export function runExperiment(this: World, uid: number, experiment: string) { return runExperimentModel(this, uid, experiment); }


export function transmitScience(this: World) { return transmitScienceModel(this); }


export function emitProgress(this: World, event: ProgressEvent) { progressionEvent(this, event); }


export function onReachedOrbit(this: World, v: WorldVessel) { this.emitProgress({ type: 'orbit', body: v.body, vesselId: v.state.id }); }


export function onLanded(this: World, v: WorldVessel) {
  for (const p of v.state.parts) { const visited = p.visitedBodies ??= []; if (!visited.includes(v.body)) visited.push(v.body); }
  this.emitProgress({ type: 'landed', body: v.body, vesselId: v.state.id });
}


export function onEnteredSoi(this: World, v: WorldVessel) { this.emitProgress({ type: 'soi', body: v.body, vesselId: v.state.id }); }


export function onScienceCollected(this: World, v: WorldVessel, biome: string) { this.emitProgress({ type: 'science', body: v.body, biome, vesselId: v.state.id }); }


export function onRecovered(this: World, v: WorldVessel) { this.emitProgress({ type: 'recovered', body: v.body, vesselId: v.state.id, visited: v.state.parts.flatMap(p => p.visitedBodies ?? []) }); }

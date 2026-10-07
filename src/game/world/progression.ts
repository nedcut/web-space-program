import { careerScaleMultiplier } from '../../sim/bodies/scale';
import { unlockTech as unlockTechModel } from '../../data/technology';
import { acceptContract as acceptContractModel, failContract, generateContracts, type ProgressEvent } from '../../sim/science/progression';
import { instruments, progressionEvent, runExperiment as runExperimentModel, scienceContext as scienceContextModel, transmitScience as transmitScienceModel } from '../science';
import type { World, WorldVessel } from '../world';


export function refreshContracts(this: World) {
  if (this.mode !== 'career' || this.progression.contracts.some(c => c.status === 'offered')) return;
  const p = this.progression;
  p.contracts.push(...generateContracts(p.contractSeed, p.contractBatch++, p.milestones.includes('first-moon') && p.unlocked.includes('propulsion-3') && p.unlocked.includes('energy-2'), careerScaleMultiplier(this.universe.preset), {
    orbit: p.milestones.includes('first-orbit') && p.unlocked.includes('propulsion-0'),
    lunar: p.milestones.includes('first-moon-flyby') && p.unlocked.includes('propulsion-1'),
    landing: p.milestones.includes('first-moon-flyby') && p.unlocked.includes('structures-1') && p.unlocked.includes('propulsion-1'),
  }));
}


export function acceptContract(this: World, id: string) { return this.mode === 'career' && acceptContractModel(this.progression, id, this.ut); }


export function abandonContract(this: World, id: string) {
  const c = this.progression.contracts.find(c => c.id === id);
  if (this.mode !== 'career' || !c) return false;
  if (c.status === 'offered') { c.status = 'failed'; return true; }
  return failContract(this.progression, c);
}


export function unlockTech(this: World, id: string) { return this.mode !== 'sandbox' && unlockTechModel(this.progression, id); }


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

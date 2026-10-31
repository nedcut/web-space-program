import { scienceBonus } from '../sim/science/facilities';
import { careerScaleMultiplier } from '../sim/bodies/scale';
import type { World, WorldVessel } from './world';
import { biomeAt, situationAt } from '../sim/science/biomes';
import { EXPERIMENTS, subjectKey, bodyMultiplier, scienceValue, experimentAvailable, type ScienceContext, type ScienceData } from '../sim/science/experiments';
import { evaluateContracts, failContract, type ProgressEvent } from '../sim/science/progression';
import { dot } from '../util/vec3';
import { latLonToUnit, LAUNCH_SITE } from '../sim/terrain';
import { isExtended } from '../sim/vessel/tweaks';

export function scienceContext(w: World, vessel: WorldVessel): ScienceContext {
  const b = w.universe.body(vessel.body);
  const s = w.universe.surfaceInfo(vessel.body, vessel.state.position, w.ut);
  return { body: b.id, biome: biomeAt(b, w.universe.terrain(b.id), s.fixedDir),
    situation: situationAt(b, s.altitude, vessel.mode === 'prelaunch' ? 'landed' : vessel.state.situation) };
}
export function instruments(w: World, v: WorldVessel) {
  const c = scienceContext(w, v);
  return v.state.parts.filter(p => !p.electronicsFailed).flatMap(p => {
    const ids = p.def.modules.flatMap(m => m.type === 'science' ? [m.experiment] : m.type === 'command' && (p.crew?.length ?? 0) > 0 ? ['crewReport'] : []);
    if (v.state.eva) ids.push('surfaceSample');
    return ids.flatMap(id => {
      const e = EXPERIMENTS.find(e => e.id === id);
      return e ? [{ uid: p.uid, experiment: id, name: e.name, part: p.def.name,
        /** Science this run would add (halved per previous run of the subject). */
        value: scienceValue(e.base, bodyMultiplier(w.universe.body(c.body)), w.progression.archive[subjectKey(e, c)]?.runs ?? 0),
        available: experimentAvailable(e, c, !!w.universe.body(c.body).atmosphere),
        recorded: v.state.parts.some(part => part.scienceData?.some(d => d.subject === subjectKey(e, c))) }] : [];
    });
  });
}
export function runExperiment(w: World, uid: number, experiment: string): ScienceData | null {
  const v = w.active;
  if (!v || !w.canControl(v.state)) return null;
  const instrument = instruments(w, v).find(i => i.uid === uid && i.experiment === experiment);
  if (!instrument?.available || instrument.recorded) { w.message('Experiment unavailable here or already stored aboard', 'warn'); return null; }
  const e = EXPERIMENTS.find(e => e.id === experiment)!;
  const context = scienceContext(w, v), subject = subjectKey(e, context);
  const p = w.progression;
  const entry = p.archive[subject] ??= { ...context, biome: e.biomes.includes(context.situation) ? context.biome : 'Global', experiment, runs: 0, science: 0 };
  const value = scienceValue(e.base, bodyMultiplier(w.universe.body(v.body)), entry.runs) * (v.state.cache.byUid.get(uid)?.electronicsDegraded ? 0.5 : 1);
  if (value < 0.01) { w.message('This subject has been fully studied', 'warn'); return null; }
  entry.runs++;
  const data: ScienceData = { ...context, id: p.nextDataId++, subject, experiment, value, credited: 0 };
  (v.state.parts.find(p => p.uid === uid)!.scienceData ??= []).push(data);
  w.onScienceCollected(v, e.biomes.includes(context.situation) ? context.biome : 'Global');
  w.message(`${e.name} stored · ${value.toFixed(1)} science on recovery`);
  return data;
}
function credit(w: World, data: ScienceData, fraction: number): number {
  const amount = Math.max(0, data.value * fraction - data.credited);
  data.credited += amount;
  // The lab's bonus pays on top of the result; the subject's archive keeps the base value.
  const gained = amount * (1 + scienceBonus(w.progression, w.mode));
  w.progression.science += gained;
  const entry = w.progression.archive[data.subject];
  if (entry) entry.science += amount;
  return gained;
}
export function transmitScience(w: World): number {
  const v = w.active;
  if (!v || !w.canControl(v.state)) return 0;
  const fraction = Math.max(0, ...v.state.parts.filter(isExtended).flatMap(p => p.def.modules.map(m => m.type === 'antenna' ? m.transmission : 0)));
  if (!fraction) { w.message(v.state.parts.some(p => p.def.modules.some(m => m.type === 'antenna')) ? 'Extend an antenna to transmit data' : 'Fit a telemetry antenna to transmit data', 'warn'); return 0; }
  if (w.commsSettings.enabled) {
    if (!w.connection(v.state).connected) { w.message('No signal — transmission unavailable', 'warn'); return 0; }
    if (!w.transmitting.includes(v.state.id)) w.transmitting.push(v.state.id);
    transmissionTimes.set(w, w.ut);
    w.message('Transmission started · rate scales with signal');
    return 0;
  }
  const total = v.state.parts.flatMap(p => p.scienceData ?? []).reduce((n, d) => n + credit(w, d, fraction), 0);
  w.message(`Transmission complete · +${total.toFixed(1)} science`);
  return total;
}
export function recoverScience(w: World, v: WorldVessel) {
  const science = v.state.parts.flatMap(p => p.scienceData ?? []).reduce((n, d) => n + credit(w, d, 1), 0);
  const info = w.universe.surfaceInfo(v.body, v.state.position, w.ut);
  const distance = Math.acos(Math.max(-1, Math.min(1, dot(info.fixedDir, latLonToUnit(LAUNCH_SITE.lat, LAUNCH_SITE.lon))))) * w.universe.body('earth').radius;
  const refundFraction = 0.2 + 0.8 * Math.exp(-distance / (w.universe.body('earth').radius * 0.3));
  const refund = w.mode === 'career' ? Math.floor(v.state.parts.reduce((sum, p) => sum + (p.purchaseCost ?? 0), 0) * refundFraction) : 0;
  w.progression.funds += refund;
  w.lastRecoveryRefund = refund;
  w.onRecovered(v);
  w.message(`Recovered · +${science.toFixed(1)} science · ${refund.toLocaleString()} cr`);
}
export function progressionEvent(w: World, event: ProgressEvent) {
  if (w.mode === 'sandbox') return;
  if (w.mode === 'career') for (const message of evaluateContracts(w.progression, event)) w.message(message, 'info', 9);
  const milestone = MILESTONES.find(m => m.event === event.type && m.body === event.body);
  if (milestone && !w.progression.milestones.includes(milestone.id)) {
    const credits = Math.round(milestone.credits * careerScaleMultiplier(w.universe.preset));
    w.progression.milestones.push(milestone.id); w.progression.science += milestone.science;
    if (w.mode === 'career') { w.progression.funds += credits; w.progression.reputation += 5; w.refreshContracts(); }
    w.message(`${milestone.label} · +${milestone.science} science${w.mode === 'career' ? ` · +${credits.toLocaleString()} cr` : ''}`, 'info', 10);
  }
}
/** First-time achievements: science, and credits scaled like orbital contracts (career). */
export const MILESTONES: readonly { id: string; event: ProgressEvent['type']; body: string; label: string; science: number; credits: number }[] = [
  { id: 'first-orbit', event: 'orbit', body: 'earth', label: 'First Earth orbit', science: 20, credits: 15000 },
  { id: 'first-moon-flyby', event: 'soi', body: 'moon', label: 'First Moon arrival', science: 35, credits: 40000 },
  { id: 'first-moon', event: 'landed', body: 'moon', label: 'First Moon landing', science: 50, credits: 30000 },
  { id: 'first-venus', event: 'soi', body: 'venus', label: 'First Venus arrival', science: 60, credits: 60000 },
  { id: 'first-mars', event: 'soi', body: 'mars', label: 'First Mars arrival', science: 60, credits: 60000 },
  { id: 'first-venus-landing', event: 'landed', body: 'venus', label: 'First Venus landing', science: 80, credits: 50000 },
  { id: 'first-mars-landing', event: 'landed', body: 'mars', label: 'First Mars landing', science: 80, credits: 50000 },
  { id: 'first-saturn', event: 'soi', body: 'saturn', label: 'First Saturn arrival', science: 150, credits: 100000 },
];
/** Experiments aboard that would add science right now (the Science app's toolbar light). */
export function scienceReady(w: World, v: WorldVessel): number {
  if (w.mode === 'sandbox' || !w.canControl(v.state)) return 0;
  return instruments(w, v).filter(i => i.available && !i.recorded && i.value >= 0.05).length;
}
/**
 * A landing only counts after a flight: staging on the pad used to complete the test flight. A staged vessel
 * resting on the pad flickers between flying and landed every step, so airborne means 3 s off the ground.
 */
const AIRBORNE_S = 3;
const offGroundSince = new WeakMap<WorldVessel, number>(), airborne = new WeakSet<WorldVessel>();
/** Called after every fixed physics step and after rails propagation. */
export function evaluateProgression(w: World) {
  if (w.mode === 'sandbox') return;
  for (const c of w.progression.contracts) if (c.status === 'active' && c.deadline !== undefined && w.ut > c.deadline && failContract(w.progression, c)) w.message(`Contract expired: ${c.title}`, 'warn', 8);
  for (const v of w.vessels.values()) {
    if (v.state.destroyed) continue;
    w.onEnteredSoi(v);
    // Only a vessel with a command part lands: spent stages splash down first and used to complete the Earth test
    // flight's surface objective while the capsule was still under its chute.
    const grounded = v.state.situation === 'landed' || v.state.situation === 'splashed';
    if (v.mode === 'prelaunch' || grounded) offGroundSince.delete(v);
    else if (!offGroundSince.has(v)) offGroundSince.set(v, w.ut);
    else if (w.ut - offGroundSince.get(v)! >= AIRBORNE_S) airborne.add(v);
    if (airborne.has(v) && grounded && v.state.parts.some(p => p.def.modules.some(m => m.type === 'command'))) {
      w.onLanded(v);
    }
    if (v.mode === 'prelaunch' || v.state.situation !== 'flying') continue;
    const orbit = w.orbitOf(v), body = w.universe.body(v.body);
    if (orbit.e < 1 && orbit.a * (1 - orbit.e) > body.radius + Math.max(body.atmosphere?.height ?? 0, w.universe.terrain(v.body).maxHeight)) w.onReachedOrbit(v);
  }
}

// One science point per simulated second at full signal; quality determines total credit,
// not speed. Interrupted transmissions retain partial credit and resume on reconnection.
const transmissionTimes = new WeakMap<World, number>();
export function advanceTransmissions(w: World) {
  const previous = transmissionTimes.get(w) ?? w.ut;
  transmissionTimes.set(w, w.ut);
  const dt = Math.max(0, w.ut - previous);
  w.transmitting = w.transmitting.filter(id => {
    const v = w.vessels.get(id);
    if (!v) return false;
    const fraction = Math.max(0, ...v.state.parts.filter(isExtended).flatMap(p => p.def.modules.map(m => m.type === 'antenna' ? m.transmission : 0)));
    if (!fraction) return true; // Antenna loss pauses the job; replacement/docking may restore it.
    const connection = w.commsSettings.enabled ? w.connection(v.state) : { strength: 1 };
    // Cap catch-up to the graph sampling window: never assume a link persisted across a rails jump.
    let budget = Math.min(dt, 0.25) * connection.strength;
    let remaining = 0;
    for (const d of v.state.parts.flatMap(p => p.scienceData ?? [])) {
      const due = Math.max(0, d.value * fraction - d.credited);
      const amount = Math.min(due, budget);
      if (d.value > 0) credit(w, d, (d.credited + amount) / d.value);
      budget -= amount; remaining += due - amount;
    }
    if (remaining <= 1e-8) { w.message(`Transmission complete · ${v.state.name}`); return false; }
    return true;
  });
}

import type { World, WorldVessel } from './world';
import { biomeAt, situationAt } from '../sim/science/biomes';
import { EXPERIMENTS, subjectKey, bodyMultiplier, scienceValue, experimentAvailable, type ScienceContext, type ScienceData } from '../sim/science/experiments';
import { evaluateContracts, failContract, type ProgressEvent } from '../sim/science/progression';
import { dot } from '../util/vec3';
import { latLonToUnit, LAUNCH_SITE } from '../sim/terrain';

export function scienceContext(w: World, vessel: WorldVessel): ScienceContext {
  const b = w.universe.body(vessel.body);
  const s = w.universe.surfaceInfo(vessel.body, vessel.state.position, w.ut);
  return { body: b.id, biome: biomeAt(b, w.universe.terrain(b.id), s.fixedDir),
    situation: situationAt(b, s.altitude, vessel.mode === 'prelaunch' ? 'landed' : vessel.state.situation) };
}
export function instruments(w: World, v: WorldVessel) {
  const c = scienceContext(w, v);
  return v.state.parts.flatMap(p => {
    const ids = p.def.modules.flatMap(m => m.type === 'science' ? [m.experiment] : m.type === 'command' && (p.crew?.length ?? 0) > 0 ? ['crewReport'] : []);
    if (v.state.eva) ids.push('surfaceSample');
    return ids.flatMap(id => {
      const e = EXPERIMENTS.find(e => e.id === id);
      return e ? [{ uid: p.uid, experiment: id, name: e.name, part: p.def.name,
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
  const value = scienceValue(e.base, bodyMultiplier(w.universe.body(v.body)), entry.runs);
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
  w.progression.science += amount;
  const entry = w.progression.archive[data.subject];
  if (entry) entry.science += amount;
  return amount;
}
export function transmitScience(w: World): number {
  const v = w.active;
  if (!v || !w.canControl(v.state)) return 0;
  const fraction = Math.max(0, ...v.state.parts.flatMap(p => p.def.modules.map(m => m.type === 'antenna' ? m.transmission : 0)));
  if (!fraction) { w.message('Fit a telemetry antenna to transmit data', 'warn'); return 0; }
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
  w.onRecovered(v);
  w.message(`Recovered · +${science.toFixed(1)} science · ${refund.toLocaleString()} cr`);
}
export function progressionEvent(w: World, event: ProgressEvent) {
  if (w.mode === 'sandbox') return;
  if (w.mode === 'career') for (const message of evaluateContracts(w.progression, event)) w.message(message, 'info', 9);
  const milestone = event.type === 'orbit' && event.body === 'earth' ? ['first-orbit', 'First Earth orbit', 20, 15000] as const
    : event.type === 'landed' && event.body === 'moon' ? ['first-moon', 'First Moon landing', 50, 30000] as const
    : event.type === 'soi' && event.body === 'saturn' ? ['first-saturn', 'First Saturn arrival', 150, 100000] as const : null;
  if (milestone && !w.progression.milestones.includes(milestone[0])) {
    w.progression.milestones.push(milestone[0]); w.progression.science += milestone[2];
    if (w.mode === 'career') { w.progression.funds += milestone[3]; w.progression.reputation += 5; }
    w.message(`${milestone[1]} · +${milestone[2]} science${w.mode === 'career' ? ` · +${milestone[3]} cr` : ''}`, 'info', 10);
  }
}
/** Called after every fixed physics step and after rails propagation. */
export function evaluateProgression(w: World) {
  if (w.mode === 'sandbox') return;
  for (const c of w.progression.contracts) if (c.status === 'active' && c.deadline !== undefined && w.ut > c.deadline && failContract(w.progression, c)) w.message(`Contract expired: ${c.title}`, 'warn', 8);
  for (const v of w.vessels.values()) {
    if (v.state.destroyed) continue;
    w.onEnteredSoi(v);
    if (v.mode !== 'prelaunch' && v.state.situation === 'landed') {
      w.onLanded(v);
    }
    if (v.mode === 'prelaunch' || v.state.situation !== 'flying') continue;
    const orbit = w.orbitOf(v), body = w.universe.body(v.body);
    if (orbit.e < 1 && orbit.a * (1 - orbit.e) > body.radius + Math.max(body.atmosphere?.height ?? 0, w.universe.terrain(v.body).maxHeight)) w.onReachedOrbit(v);
  }
}

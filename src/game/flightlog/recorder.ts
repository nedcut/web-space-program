/** Compact, DOM-free flight records. Tuple columns are SI, except time (seconds from start). */
export const SAMPLE_CAP = 1024;
export const EVENT_CAP = 256;
export const HISTORY_CAP = 40;
export const ARCHIVE_SAMPLE_CAP = 128;
export type Sample = [time: number, altitude: number, speed: number, vertical: number, horizontal: number, ap: number | null, pe: number | null, mach: number, q: number, g: number, temperature: number, mass: number, dv: number, downrange: number, body: string];
export type EventKind = 'launch' | 'stage' | 'separation' | 'soi' | 'orbit' | 'landing' | 'splashdown' | 'docking' | 'eva' | 'flag' | 'partLoss' | 'recovery' | 'loss' | 'checkpoint' | 'boarding' | 'assist' | 'rings';
export interface FlightEvent { time: number; kind: EventKind; body: string; detail?: string; speed?: number; biome?: string }
export interface Observation {
  clearance?: number;
  inertialSpeed?: number;
  /** Speed for the peak statistic (surface low down, orbital high up); defaults to `speed`. */
  displaySpeed?: number;
  ut: number; body: string; altitude: number; speed: number; vertical: number; horizontal: number;
  ap: number; pe: number; mach: number; q: number; g: number; temperature: number; mass: number; dv: number;
  thrustAcceleration: number; flying: boolean; prelaunch: boolean; stableOrbit: boolean; parts: number;
  shield: boolean; plane: boolean; biome?: string; splashed: boolean; ringPass: boolean;
}
export interface FlightRecord {
  id: string; vesselId: string; name: string; start: number; end?: number; outcome?: 'recovered' | 'lost' | 'merged' | 'boarded';
  sampleHead?: number;
  samples: Sample[]; events: FlightEvent[]; bodies: string[]; landedBodies: string[]; orbitBodies: string[];
  stats: { maxAltitude: number; maxSpeed: number; maxG: number; dvSpent: number; distance: number };
  last?: Observation; launched: boolean; stages: number; hotUnshielded: boolean; plane: boolean;
  integrationUt?: number;
  touchdownSpeed?: number;
  downrange?: number;
  encounter?: { body: string; parent: string; speed: number; dv: number };
  deltaVEstimate?: { ut: number; value: number; spent: number; topology: string };
  ringPosition?: { body: string; x: number; y: number; z: number };
}
export interface RecorderState { records: FlightRecord[]; sequence: number }
export function newRecorder(): RecorderState { return { records: [], sequence: 0 }; }
export function recordFor(state: RecorderState, vesselId: string) { return state.records.find(r => r.vesselId === vesselId && !r.outcome); }
export function startRecord(state: RecorderState, vesselId: string, name: string, ut: number): FlightRecord {
  const existing = recordFor(state, vesselId);
  if (existing) return existing;
  const record: FlightRecord = { id: `${vesselId}:${ut}:${++state.sequence}`, vesselId, name, start: ut, samples: [], events: [], bodies: [], landedBodies: [], orbitBodies: [], stats: { maxAltitude: 0, maxSpeed: 0, maxG: 0, dvSpent: 0, distance: 0 }, launched: false, stages: 0, hotUnshielded: false, plane: false };
  state.records.push(record);
  // Keep live vessels even when the completed-report budget is full.
  while (state.records.filter(r => r.outcome).length > HISTORY_CAP) state.records.splice(state.records.findIndex(r => r.outcome), 1);
  return record;
}
export function appendEvent(r: FlightRecord, ut: number, kind: EventKind, body: string, extra: Partial<FlightEvent> = {}) {
  r.events.push({ ...extra, time: Math.max(0, ut - r.start), kind, body });
  if (r.events.length > EVENT_CAP) r.events.shift();
  if (kind === 'stage') r.stages++;
}
/** Circular storage stays O(1) per append; callers request chronological order for charts. */
export function orderedSamples(r: FlightRecord): Sample[] {
  const head = r.sampleHead ?? 0;
  return head ? [...r.samples.slice(head), ...r.samples.slice(0, head)] : r.samples;
}
export function trimHistory(state: RecorderState) {
  while (state.records.filter(r => r.outcome).length > HISTORY_CAP) state.records.splice(state.records.findIndex(r => r.outcome), 1);
}
export function sampleInterval(o: Observation) { return o.prelaunch ? 5 : o.thrustAcceleration > 0 || o.q > 1 || o.altitude < 10000 ? 0.25 : o.stableOrbit ? 30 : 5; }
export function observe(r: FlightRecord, o: Observation, force = false, integrateThrust = true) {
  if (r.outcome) return;
  const p = r.last;
  const dt = p ? Math.max(0, o.ut - p.ut) : 0;
  r.stats.maxAltitude = Math.max(r.stats.maxAltitude, o.altitude);
  r.stats.maxSpeed = Math.max(r.stats.maxSpeed, o.displaySpeed ?? o.speed);
  r.stats.maxG = Math.max(r.stats.maxG, o.g);
  if (p && p.body === o.body && !o.prelaunch) r.stats.distance += (p.speed + o.speed) * 0.5 * dt;
  if (integrateThrust) r.stats.dvSpent += o.thrustAcceleration * dt;
  if (p && p.body === o.body && !o.prelaunch) r.downrange = (r.downrange ?? 0) + (p.horizontal + o.horizontal) * 0.5 * dt;
  r.plane ||= o.plane;
  r.hotUnshielded ||= !o.shield && o.temperature > 1000 && o.speed > 1500 && o.q > 100;
  if (!r.bodies.includes(o.body)) r.bodies.push(o.body);
  if (p && p.body !== o.body) {
    appendEvent(r, o.ut, 'soi', o.body, { detail: `${p.body} → ${o.body}` });
    if (r.encounter?.body === p.body && r.encounter.parent === o.body && (o.inertialSpeed ?? o.speed) > r.encounter.speed + 100 && r.stats.dvSpent - r.encounter.dv < 10) appendEvent(r, o.ut, 'assist', p.body, { detail: 'Unpowered flyby gained >100 m/s in the parent frame' });
    r.encounter = { body: o.body, parent: p.body, speed: p.inertialSpeed ?? p.speed, dv: r.stats.dvSpent };
  }
  if (!r.launched && !o.prelaunch && o.flying && (o.clearance ?? o.altitude) > 5) {
    r.launched = true; appendEvent(r, o.ut, 'launch', o.body);
  }
  if (o.stableOrbit && !r.orbitBodies.includes(o.body)) { r.orbitBodies.push(o.body); appendEvent(r, o.ut, 'orbit', o.body); }
  if (r.launched && p?.flying && !o.flying && !o.prelaunch) {
    if (!r.landedBodies.includes(o.body)) r.landedBodies.push(o.body);
    appendEvent(r, o.ut, o.splashed ? 'splashdown' : 'landing', o.body, { speed: r.touchdownSpeed ?? p.speed, biome: o.biome });
  }
  if (o.ringPass && !r.events.some(e => e.kind === 'rings')) appendEvent(r, o.ut, 'rings', o.body);
  const time = o.ut - r.start;
  const lastSample = r.samples.length ? r.samples[((r.sampleHead ?? 0) + r.samples.length - 1) % r.samples.length] : undefined;
  if (force || !lastSample || time - lastSample[0] >= sampleInterval(o) || p?.body !== o.body || p?.flying !== o.flying) {
    const finite = (n: number) => Number.isFinite(n) ? n : 0;
    const sample = [time, ...[o.altitude, o.speed, o.vertical, o.horizontal].map(finite), Number.isFinite(o.ap) ? o.ap : null, Number.isFinite(o.pe) ? o.pe : null, ...[o.mach, o.q, o.g, o.temperature, o.mass, o.dv, r.downrange ?? 0].map(finite), o.body] as Sample;
    if (r.samples.length < SAMPLE_CAP) r.samples.push(sample);
    else { const head = r.sampleHead ?? 0; r.samples[head] = sample; r.sampleHead = (head + 1) % SAMPLE_CAP; }
  }
  r.last = { ...o, ap: Number.isFinite(o.ap) ? o.ap : 0, pe: Number.isFinite(o.pe) ? o.pe : 0 };
}
export function finishRecord(r: FlightRecord, ut: number, outcome: NonNullable<FlightRecord['outcome']>) {
  if (r.outcome) return;
  appendEvent(r, ut, outcome === 'recovered' ? 'recovery' : outcome === 'lost' ? 'loss' : outcome === 'boarded' ? 'boarding' : 'docking', r.last?.body ?? r.bodies.at(-1) ?? 'earth');
  r.end = ut; r.outcome = outcome;
  const samples = orderedSamples(r);
  r.samples = samples.length <= ARCHIVE_SAMPLE_CAP ? [...samples] : Array.from({ length: ARCHIVE_SAMPLE_CAP }, (_, i) => samples[Math.round(i * (samples.length - 1) / (ARCHIVE_SAMPLE_CAP - 1))]);
  r.sampleHead = 0;
}
/** Test a sampled body-fixed segment against a ring annulus. */
export function crossesRingPlane(from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }, inner: number, outer: number) {
  if (from.z * to.z > 0 || from.z === to.z) return false;
  const t = from.z / (from.z - to.z);
  const radius = Math.hypot(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t);
  return radius >= inner && radius <= outer;
}
export function eventLabel(kind: EventKind): string {
  return ({ launch: 'Liftoff', stage: 'Stage activated', separation: 'Hardware separated', soi: 'Sphere of influence changed', orbit: 'Stable orbit achieved', landing: 'Touchdown', splashdown: 'Splashdown', docking: 'Vessels docked', eva: 'Astronaut on EVA', flag: 'Flag planted', partLoss: 'Part lost', recovery: 'Vessel recovered', loss: 'Vessel lost', checkpoint: 'Flight checkpoint', boarding: 'Astronaut boarded', assist: 'Gravity assist', rings: 'Ring plane crossed' } satisfies Record<EventKind, string>)[kind];
}
export function summaryText(r: FlightRecord) {
  return `${r.name} · ${r.outcome ?? 'In progress'}\nDuration: ${Math.round((r.end ?? r.last?.ut ?? r.start) - r.start)} s\nMaximum altitude: ${Math.round(r.stats.maxAltitude)} m · Speed: ${Math.round(r.stats.maxSpeed)} m/s · G-load: ${r.stats.maxG.toFixed(2)} g\nΔv spent: ${Math.round(r.stats.dvSpent)} m/s · Distance travelled: ${Math.round(r.stats.distance)} m\nBodies visited: ${r.bodies.join(', ')}\n${r.events.map(e => `T+${e.time.toFixed(1)} ${eventLabel(e.kind)} · ${e.body}${e.speed !== undefined ? ` · ${e.speed.toFixed(2)} m/s` : ''}${e.biome ? ` · ${e.biome}` : ''}${e.detail ? ` · ${e.detail}` : ''}`).join('\n')}`;
}

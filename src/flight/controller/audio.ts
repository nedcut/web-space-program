import type { MusicSituation } from '../../audio/situation';
import { flightRumble, thrustGain } from '../../audio/design';
import { type WorldVessel } from '../../game/world';
import { type AudioState, type EngineType } from '../../audio';
import { length } from '../../util/vec3';
import type { FlightController } from '../controller';
import type { FlightControllerInternals } from './internals';

const FUEL_RESOURCES = ['liquidFuel', 'oxidizer', 'solidFuel', 'xenon', 'monopropellant'] as const;
const WARP_RATES = [1, 5, 10, 50, 100, 1000, 10000, 100000, 1000000];

// Camera displacement is sampled against real wall time, never the accelerated simulation clock.
const cameraHistory = new WeakMap<FlightController, { distance: number; time: number; vessel: string; engines: AudioState['engines']; neighbors: { x: number; y: number; z: number; thrust: number }[]; fairings: number; mechanics: Map<number, boolean>; sample: AudioState & { situation: MusicSituation } }>();

export function updateAudio(this: FlightController, internals: FlightControllerInternals, wv: WorldVessel | null): void {
  if (!internals.audio) return;
  internals.audio.setPaused(this.paused);
  if (!wv || this.paused) {
    if (this.paused || cameraHistory.has(this)) internals.audio.silenceFlight(!this.paused);
    cameraHistory.delete(this); return;
  }
  const st = wv.state;
  const now = performance.now() / 1000;
  let history = cameraHistory.get(this);
  if (history && history.vessel === st.id && now - history.time < 0.05) return;
  if (!history || history.vessel !== st.id) {
    history = { distance: this.cam.distance, time: now, vessel: st.id, fairings: -1, mechanics: new Map(),
      sample: { engines: [], ambientPressure: 0, airspeed: 0, mach: 0, dynamicPressure: 0, rcsActive: 0,
        reentryHeat: 0, inMapView: false, timeWarp: 1, cameraDistance: 0, situation: { scene: 'flight' } },
      engines: (['kerolox', 'hydrolox', 'solid', 'methalox', 'ion', 'monoprop', 'jet', 'afterburner', 'nuclear', 'aerospike'] as EngineType[]).map(type => ({ type, thrustFraction: 0, count: 0, size: 0 })),
      neighbors: Array.from({ length: 4 }, () => ({ x: 0, y: 0, z: 0, thrust: 0 })) };
    cameraHistory.set(this, history);
  }
  for (const e of history.engines) { e.thrustFraction = 0; e.count = 0; e.size = 0; }
  let fairings = 0, mechanismChanged = false;
  let fuel = 0, capacity = 0, temperature = 0, wheelSpeed = 0;

  for (const p of st.parts) {
    temperature = Math.max(temperature, p.temperature / p.maxTemp);
    for (const t of p.skinTemperature) temperature = Math.max(temperature, t / p.maxTemp);
    for (const resource of FUEL_RESOURCES) {
      fuel += p.resources[resource] ?? 0;
      capacity += p.maxResources[resource] ?? 0;
    }
    const deployed = p.leg?.deployed ?? p.wheel?.deployed ?? p.bayOpen ?? p.drillDeployed;
    if (deployed !== undefined) {
      if (history.mechanics.has(p.uid) && history.mechanics.get(p.uid) !== deployed) mechanismChanged = true;
      history.mechanics.set(p.uid, deployed);
    }
    if (p.wheel?.inContact) wheelSpeed = Math.max(wheelSpeed, Math.abs(p.wheel.rollSpeed));
    if (p.def.modules.some(m => m.type === 'fairing')) fairings++;
    const eng = p.def.modules.find(m => m.type === 'engine');
    if (!eng || eng.type !== 'engine') continue;
    if (p.engine && p.engine.thrust > 0) {
      const type: EngineType = p.def.mesh === 'nuclearEngine' ? 'nuclear' : p.def.mesh === 'aerospike' ? 'aerospike' : eng.plume;
      const e = history.engines.find(e => e.type === type)!;
      e.thrustFraction += p.engine.thrust;
      e.count++;
      e.size! += Math.sqrt(Math.max(1, eng.maxThrustVac) / 200000);

    }
  }
  if (mechanismChanged) internals.audio.legDeploy();
  for (const uid of history.mechanics.keys()) if (!st.cache.byUid.has(uid)) history.mechanics.delete(uid);
  const tm = st.telemetry;
  const radial = now > history.time ? (this.cam.distance - history.distance) / (now - history.time) : 0;
  history.distance = this.cam.distance; history.time = now;
  for (const e of history.engines) { e.thrustFraction = thrustGain(e.thrustFraction) ** 2; e.size! /= Math.max(1, e.count); }
  if (history.fairings >= 0 && fairings < history.fairings) internals.audio.fairing();
  history.fairings = fairings;
  let stress = 0;
  for (const load of st.cache.jointLoads?.values() ?? []) stress = Math.max(stress, load.fraction);
  for (const load of st.cache.strutLoads?.values() ?? []) stress = Math.max(stress, load);
  // Four nearest audible vessels; camera-space dot products preserve floating-origin precision.
  for (const source of history.neighbors) source.thrust = 0;
  const camera = this.cam.camera;
  const matrix = camera?.matrixWorld.elements;
  if (camera && matrix) for (const other of this.world.vessels.values()) {
    if (other === wv || other.state.telemetry.thrust <= 0) continue;
    const dx = other.state.position.x - st.position.x - camera.position.x;
    const dy = other.state.position.y - st.position.y - camera.position.y;
    const dz = other.state.position.z - st.position.z - camera.position.z;
    const range2 = dx * dx + dy * dy + dz * dz;
    if (range2 > 4000000) continue;
    let slot = history.neighbors[0], farthest = -1;
    for (const source of history.neighbors) {
      if (!source.thrust) { slot = source; farthest = Infinity; break; }
      const d = source.x * source.x + source.y * source.y + source.z * source.z;
      if (d > farthest) { slot = source; farthest = d; }
    }
    if (range2 >= farthest) continue;
    slot.x = dx * matrix[0] + dy * matrix[1] + dz * matrix[2];
    slot.y = dx * matrix[4] + dy * matrix[5] + dz * matrix[6];
    slot.z = dx * matrix[8] + dy * matrix[9] + dz * matrix[10];
    slot.thrust = Math.min(1, other.state.telemetry.thrust / 200000);
  }
  const verticalSpeed = this.world.verticalSpeed(wv);
  const descending = st.situation === 'flying' && verticalSpeed < -2;
  const terrainDanger = descending && tm.altitudeAGL > 0 && tm.altitudeAGL / -verticalSpeed < 8;
  const landing = descending && tm.altitudeAGL < 2500;
  const input = this.input.state;
  const deployedDrill = st.situation === 'landed' && st.parts.some(p => p.drillDeployed && (p.drillDeploy ?? 0) >= 1);
  // Machinery may stay hot after stopping: sound follows operating prerequisites, not residual heat.
  const drilling = deployedDrill && this.world.localConcentration(wv) > 0
    && st.parts.some(p => (p.resources.electricCharge ?? 0) > 0 || p.def.modules.some(m =>
      m.type === 'generator' || (m.type === 'fuelCell' && fuel > 0)))
    && st.parts.some(p => (p.maxResources.regolith ?? 0) > (p.resources.regolith ?? 0) || p.converterRunning);
  const sample = history.sample;
  sample.vesselId = st.id;
  sample.engines = history.engines;
  sample.neighbors = history.neighbors;
  sample.structuralStress = stress;
  sample.verticalSpeed = verticalSpeed;
  sample.splashed = st.situation === 'splashed';
  sample.sas = this.sasOn; sample.rcs = this.rcsOn; sample.nodeCount = this.world.nodes.length;
  sample.completedMissions = 0;
  for (const contract of this.world.progression.contracts) if (contract.status === 'completed') sample.completedMissions++;
  sample.launchRumble = flightRumble(tm.thrust, st.mass * this.world.universe.body(wv.body).surfaceGravity, tm.altitudeAGL, tm.dynamicPressure, tm.mach);
  sample.ambientPressure = tm.staticPressure;
  sample.airspeed = length(this.world.surfaceVelocity(wv));
  sample.mach = tm.mach;
  sample.dynamicPressure = tm.dynamicPressure;
  sample.rcsActive = this.rcsOn && (input.tx || input.ty || input.tz || input.pitch || input.yaw || input.roll) ? 1 : 0;
  sample.reentryHeat = internals.reentryHeat;
  sample.inMapView = this.mapMode;
  sample.timeWarp = this.world.warp.mode === 'rails' ? WARP_RATES[this.world.warp.index] : 1;
  sample.cameraDistance = this.cam.distance;
  sample.cameraRadialVelocity = radial;
  sample.situation.bodyId = wv.body;
  sample.situation.parentId = this.world.universe.body(wv.body).parent;
  sample.situation.reentryHeat = internals.reentryHeat;
  sample.situation.landing = landing;
  sample.wheelSpeed = wheelSpeed;
  sample.chuteOpen = st.parts.some(p => p.chute?.phase === 'semi' || p.chute?.phase === 'full');
  sample.walking = st.eva?.walking;
  sample.jetting = st.eva?.jetting;
  sample.drilling = drilling;
  sample.landed = st.situation !== 'flying';
  sample.fuelFraction = capacity > 0 ? fuel / capacity : undefined;
  sample.temperatureFraction = temperature;
  sample.gForce = tm.gForce;
  sample.terrainDanger = terrainDanger;
  sample.noSignal = this.world.commsSettings.enabled && !this.world.connection(st).connected;
  internals.audio.update(sample);
}

import { type WorldVessel } from '../../game/world';
import { type EngineType } from '../../audio';
import { length } from '../../util/vec3';
import type { FlightController } from '../controller';
import type { FlightControllerInternals } from './internals';

// Camera displacement is sampled against real wall time, never the accelerated simulation clock.
const cameraHistory = new WeakMap<FlightController, { distance: number; time: number; vessel: string }>();

export function updateAudio(this: FlightController, internals: FlightControllerInternals, wv: WorldVessel | null): void {
  if (!internals.audio) return;
  if (!wv) { internals.audio.silenceFlight(); return; }
  const st = wv.state;
  let vac = 0, fuel = 0, capacity = 0, temperature = 0, wheelSpeed = 0;
  const byType = new Map<EngineType, { thrust: number; count: number; size: number }>();
  for (const p of st.parts) {
    temperature = Math.max(temperature, p.temperature / p.maxTemp);
    for (const t of p.skinTemperature) temperature = Math.max(temperature, t / p.maxTemp);
    for (const resource of ['liquidFuel', 'oxidizer', 'solidFuel', 'xenon', 'monopropellant'] as const) {
      fuel += p.resources[resource] ?? 0;
      capacity += p.maxResources[resource] ?? 0;
    }
    if (p.wheel?.inContact) wheelSpeed = Math.max(wheelSpeed, Math.abs(p.wheel.rollSpeed));
    const eng = p.def.modules.find(m => m.type === 'engine');
    if (!eng || eng.type !== 'engine') continue;
    vac += eng.maxThrustVac;
    if (p.engine && p.engine.thrust > 0) {
      const type: EngineType = p.def.mesh === 'nuclearEngine' ? 'nuclear' : p.def.mesh === 'aerospike' ? 'aerospike' : eng.plume;
      const e = byType.get(type) ?? { thrust: 0, count: 0, size: 0 };
      e.thrust += p.engine.thrust;
      e.count++;
      e.size += Math.sqrt(Math.max(1, eng.maxThrustVac) / 200000);
      byType.set(type, e);
    }
  }
  const tm = st.telemetry;
  const now = performance.now() / 1000;
  const previous = cameraHistory.get(this);
  const radial = previous && previous.vessel === st.id && now > previous.time ? (this.cam.distance - previous.distance) / (now - previous.time) : 0;
  cameraHistory.set(this, { distance: this.cam.distance, time: now, vessel: st.id });
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
  internals.audio.update({
    vesselId: st.id,
    engines: [...byType.entries()].map(([type, e]) => ({ type, thrustFraction: vac > 0 ? e.thrust / vac : 0, count: e.count, size: e.size / e.count })),
    ambientPressure: tm.staticPressure,
    airspeed: length(this.world.surfaceVelocity(wv)),
    mach: tm.mach,
    dynamicPressure: tm.dynamicPressure,
    rcsActive: this.rcsOn && (input.tx || input.ty || input.tz || input.pitch || input.yaw || input.roll) ? 1 : 0,
    reentryHeat: internals.reentryHeat,
    inMapView: this.mapMode,
    timeWarp: this.world.warp.mode === 'rails' ? [1, 5, 10, 50, 100, 1000, 10000, 100000, 1000000][this.world.warp.index] : 1,
    cameraDistance: this.cam.distance,
    cameraRadialVelocity: radial,
    situation: { scene: 'flight', bodyId: wv.body, parentId: this.world.universe.body(wv.body).parent, reentryHeat: internals.reentryHeat, landing },
    wheelSpeed,
    chuteOpen: st.parts.some(p => p.chute?.phase === 'semi' || p.chute?.phase === 'full'),
    walking: st.eva?.walking,
    jetting: st.eva?.jetting,
    drilling,
    mechanicalState: st.parts.filter(p => p.leg || p.wheel || p.bayOpen !== undefined || p.drillDeployed !== undefined)
      .map(p => `${p.uid}:${p.leg?.deployed ?? p.wheel?.deployed ?? p.bayOpen ?? p.drillDeployed}`).join(','),
    landed: st.situation !== 'flying',
    fuelFraction: capacity > 0 ? fuel / capacity : undefined,
    temperatureFraction: temperature,
    gForce: tm.gForce,
    terrainDanger,
    noSignal: this.world.commsSettings.enabled && !this.world.connection(st).connected,
  });
}

import { type WorldVessel } from '../../game/world';
import { length } from '../../util/vec3';
import type { FlightController } from '../controller';
import type { FlightControllerInternals } from './internals';


export function updateAudio(this: FlightController, internals: FlightControllerInternals, wv: WorldVessel | null): void {
  if (!internals.audio || !wv) return;
  const st = wv.state;
  let vac = 0;
  const byType = new Map<string, { thrust: number; count: number }>();
  for (const p of st.parts) {
    const eng = p.def.modules.find((m) => m.type === 'engine');
    if (!eng || eng.type !== 'engine') continue;
    vac += eng.maxThrustVac;
    if (p.engine && p.engine.thrust > 0) {
      const e = byType.get(eng.plume) ?? { thrust: 0, count: 0 };
      e.thrust += p.engine.thrust;
      e.count++;
      byType.set(eng.plume, e);
    }
  }
  const tm = st.telemetry;
  internals.audio.update({
    engines: [...byType.entries()].map(([type, e]) => ({ type: type as 'kerolox', thrustFraction: vac > 0 ? e.thrust / vac : 0, count: e.count })),
    ambientPressure: tm.staticPressure,
    airspeed: length(this.world.surfaceVelocity(wv)),
    mach: tm.mach,
    dynamicPressure: tm.dynamicPressure,
    rcsActive: this.rcsOn && (this.input.state.tx || this.input.state.ty || this.input.state.tz) ? 1 : 0,
    reentryHeat: internals.reentryHeat,
    inMapView: this.mapMode,
    timeWarp: this.world.warp.mode === 'rails' ? [1, 5, 10, 50, 100, 1000, 10000, 100000, 1000000][this.world.warp.index] : 1,
    cameraDistance: this.cam.distance,
  });
}

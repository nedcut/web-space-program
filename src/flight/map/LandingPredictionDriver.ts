import type { MapMarkerInput } from '../../render/map/MapView';
import { formatSpeed } from '../../util/format';
import type { FlightController } from '../controller';
import type { LandingPrediction, LandingRequest } from '../../game/planning/landing';
import type { PlannerEvent, PlanningSnapshot } from '../../game/planning/protocol';
import { earthDataMessage } from '../../game/earthLoader';
import { periapsisRadius } from '../../sim/orbit';
import { warpRate } from '../../game/timewarp';

const EMPTY_MARKERS: MapMarkerInput[] = [];

/** One persistent, lazy worker: no Earth-grid copy on refresh, no work in the animation loop.
 * At most one prediction runs. Sample physics at 1 Hz, request at most once / 5 s, discard obsolete results.
 */
export class LandingPredictionDriver {
  result: LandingPrediction | null = null;
  status = '';
  lastSubmitMs = 0;
  maxSubmitMs = 0;
  attitude: LandingRequest['attitude'] = 'hold';
  enabled = true;
  private worker?: Worker;
  private timer: ReturnType<typeof setInterval>;
  private id = 0;
  private markers: MapMarkerInput[] = EMPTY_MARKERS;
  private accepted?: { vessel: string; body: string; parts: number; stage: number };
  get displayResult() {
    const r = this.result, v = this.c.world.active, a = this.accepted;
    return this.enabled && r && v && a && a.vessel === v.state.id && a.body === v.body && a.parts === v.state.parts.length && a.stage === v.state.nextStage &&
      r.attitude === this.attitude && v.state.telemetry.thrust === 0 && (!r.impact || r.impact.time >= this.c.world.ut) ? r : null;
  }
  get displayMarkers() { return this.displayResult ? this.markers : EMPTY_MARKERS; }
  private pending?: { id: number; vessel: string; body: string; parts: number; stage: number; attitude: LandingRequest['attitude'] };
  private lastRequest = -Infinity;
  private sampledAttitude: LandingRequest['attitude'] = 'hold';
  private failed = false;
  constructor(private c: FlightController) {
    this.timer = setInterval(() => this.update(), 1000);
  }
  dispose() { clearInterval(this.timer); this.worker?.terminate(); this.worker = undefined; }
  private clear() {
    if (this.pending) this.worker?.postMessage({ type: 'cancel', id: this.pending.id });
    this.pending = undefined; this.result = null; this.accepted = undefined; this.markers = EMPTY_MARKERS;
  }
  private current() {
    const v = this.c.world.active, p = this.pending;
    return !!v && !!p && p.vessel === v.state.id && p.body === v.body && p.parts === v.state.parts.length && p.stage === v.state.nextStage && p.attitude === this.attitude && v.state.telemetry.thrust === 0 && this.enabled;
  }
  private update() {
    const w = this.c.world, v = w.active;
    if (this.sampledAttitude !== this.attitude) { this.clear(); this.lastRequest = -Infinity; this.sampledAttitude = this.attitude; }
    if (this.c.network || !this.enabled || !v || v.mode === 'prelaunch' || v.state.situation !== 'flying' || v.state.eva || v.state.telemetry.thrust > 0 || warpRate(w.warp) > 1) { this.clear(); this.status = ''; return; }
    if (this.result && (this.result.vesselId !== v.state.id || this.result.body !== v.body || this.result.attitude !== this.attitude || this.result.impact && this.result.impact.time < w.ut)) this.result = null;
    if (this.pending) { if (!this.current()) this.clear(); else return; }
    if (this.c.paused || this.failed || performance.now() - this.lastRequest < 5000) return;
    const body = w.universe.body(v.body);
    if (!body.solidSurface) return;
    let orbit;
    try { orbit = w.orbitOf(v); } catch { this.clear(); return; }
    // Safe orbits never start a worker or sample terrain. The ceiling includes all terrain on the body.
    const ceiling = body.radius + Math.max(body.atmosphere?.height ?? 0, body.surface?.relief ?? 0) + 1000;
    if (periapsisRadius(orbit) > ceiling) { this.clear(); this.status = ''; return; }
    if (typeof Worker === 'undefined') { this.status = 'Landing prediction unavailable in this browser'; this.failed = true; return; }
    try {
      const submitStart = performance.now();
      if (!this.worker) {
        this.worker = new Worker(new URL('../../game/planning/planner.worker.ts', import.meta.url), { type: 'module' });
        this.worker.postMessage({ type: 'earthData', ...earthDataMessage() });
        this.worker.onmessage = (e: MessageEvent<PlannerEvent>) => {
          if (e.data.id !== this.pending?.id) return;
          if (e.data.type === 'result') {
            if (this.current()) {
              this.result = e.data.result as LandingPrediction;
              this.accepted = this.pending;
              const r = this.result, impact = r.impact;
              this.markers = impact ? [{ key: 'aero-impact', body: r.body, position: r.points[r.points.length - 1], label: 'Predicted landing', color: '#ffac66', time: impact.time,
                detail: `Unpowered · drag + heating · ${r.attitude === 'hold' ? 'hold attitude' : 'surface retrograde'}\n${formatSpeed(impact.speed)} · no future staging` }] : EMPTY_MARKERS;
              this.status = this.result.outcome === 'breakup' ? 'Predicted breakup before landing' : this.result.outcome === 'horizon' ? 'Partial prediction · horizon reached' : '';
            }
            this.pending = undefined;
          } else if (e.data.type === 'error') { this.pending = undefined; this.status = e.data.message; }
        };
        this.worker.onerror = () => { this.clear(); this.status = 'Landing prediction unavailable'; this.failed = true; this.worker?.terminate(); this.worker = undefined; };
      }
      const id = ++this.id;
      this.pending = { id, vessel: v.state.id, body: v.body, parts: v.state.parts.length, stage: v.state.nextStage, attitude: this.attitude };
      const snapshot: PlanningSnapshot = { preset: w.universe.preset, activatedAsteroids: [...w.universe.activatedAsteroids], ut: w.ut, vessel: null, nodes: [] };
      const { cache, ...vessel } = v.state;
      void cache;
      const args: LandingRequest = { vessel, body: v.body, bottom: w.bottomOffset(v.state), preciseGravity: w.preciseGravity, attitude: this.attitude };
      this.worker.postMessage({ type: 'plan', id, operation: 'landing', snapshot, args });
      this.lastSubmitMs = performance.now() - submitStart;
      this.maxSubmitMs = Math.max(this.maxSubmitMs, this.lastSubmitMs);
      this.lastRequest = performance.now(); this.status = 'Predicting landing…';
    } catch { this.clear(); this.status = 'Landing prediction unavailable'; this.failed = true; }
  }
}

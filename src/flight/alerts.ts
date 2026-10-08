import { landingReadout } from './landingReadout';
/**
 * Caution & warning logic for the flight HUD: a short, prioritised list of things that need the pilot's
 * attention *now* (overheating, crushing g-load, ground rushing up, flameout, no control...). Pure and
 * DOM-free so it can be unit tested; the HUD only renders the result.
 *
 * Each alert has hysteresis: it appears as soon as its trigger is met and stays for a short hold after the
 * condition clears, so a value hovering on a threshold does not make the banner flicker.
 */

export type AlertLevel = 'warn' | 'bad';

export interface FlightAlert {
  id: string;
  level: AlertLevel;
  text: string;
}

export interface AlertInput {
  /** Pilot cannot command the vessel (no crew/probe, no signal). */
  noControl: boolean;
  eva: boolean;
  /** Flying (not landed/splashed/on the pad). */
  flying: boolean;
  /** Hottest part temperature / its limit (skin or bulk), and that part's name. */
  heatFraction: number;
  hottestPart?: string;
  gForce: number;
  /** Height above terrain / sea, m, and vertical / horizontal surface speed, m/s. */
  agl: number;
  verticalSpeed: number;
  horizontalSpeed: number;
  /** Local gravity and maximum upward acceleration from fuelled, ignited engines. */
  gravity?: number;
  brakingAcceleration?: number;
  brakingFuelSeconds?: number;
  /** Any parachute semi/fully deployed. */
  chutes: boolean;
  /** Landing gear state (null: vessel has none). */
  gear: 'up' | 'down' | 'moving' | null;
  /** Engines ignited with throttle above zero. */
  thrusting: boolean;
  /** Full-throttle burn time left in the current stage, s (NaN: unknown / no engines). */
  stageBurnTime: number;
  /** An ignited engine has run dry or lost intake air. */
  flameout: boolean;
  /** Electric charge stored / capacity (NaN: no storage). */
  power: number;
}

/** Seconds an alert lingers after its condition clears. */
const HOLD = 1.2;

/** Raw (instantaneous) alert conditions, most severe first within each topic. */
export function alertConditions(i: AlertInput): FlightAlert[] {
  const out: FlightAlert[] = [];
  if (i.noControl && !i.eva) out.push({ id: 'control', level: 'bad', text: 'NO CONTROL' });
  if (i.heatFraction >= 0.9) out.push({ id: 'heat', level: 'bad', text: `OVERHEAT${i.hottestPart ? ` · ${i.hottestPart}` : ''} ${(i.heatFraction * 100).toFixed(0)}%` });
  else if (i.heatFraction >= 0.75) out.push({ id: 'heat', level: 'warn', text: `HIGH TEMP ${(i.heatFraction * 100).toFixed(0)}%` });
  if (i.gForce >= 9) out.push({ id: 'g', level: 'bad', text: `G-LOAD ${i.gForce.toFixed(1)} g` });
  else if (i.gForce >= 6) out.push({ id: 'g', level: 'warn', text: `HIGH G ${i.gForce.toFixed(1)} g` });
  if (i.flying && Number.isFinite(i.agl) && i.verticalSpeed < -12 && i.agl > 0 && !i.eva) {
    const braking = landingReadout(i.agl, i.verticalSpeed, i.gravity ?? 0, i.brakingAcceleration ?? 0, i.brakingFuelSeconds);
    const tti = braking.impactTime;
    if (!braking.canStop && tti < 6) out.push({ id: 'terrain', level: 'bad', text: `TERRAIN · ${tti.toFixed(1)} s` });
    else if (!braking.canStop && tti < 15 && i.agl < 5000) out.push({ id: 'terrain', level: 'warn', text: `SINK RATE · ${tti.toFixed(0)} s to ground` });
  }
  if (i.flying && i.gear === 'up' && i.agl < 300 && i.verticalSpeed < -1 && i.verticalSpeed > -60 && i.horizontalSpeed < 120 && !i.chutes) {
    out.push({ id: 'gear', level: 'warn', text: 'GEAR UP' });
  }
  if (i.flameout) out.push({ id: 'fuel', level: 'bad', text: 'FLAMEOUT' });
  else if (i.thrusting && Number.isFinite(i.stageBurnTime) && i.stageBurnTime < 10) out.push({ id: 'fuel', level: 'warn', text: `STAGE FUEL · ${Math.max(0, i.stageBurnTime).toFixed(0)} s` });
  if (Number.isFinite(i.power) && i.power < 0.05 && !i.eva) out.push({ id: 'power', level: i.power <= 0.001 ? 'bad' : 'warn', text: i.power <= 0.001 ? 'NO POWER' : 'LOW POWER' });
  return out;
}

/** Applies hysteresis and ordering (warnings after cautions, stable order otherwise). */
export class AlertTracker {
  private live = new Map<string, { alert: FlightAlert; until: number }>();

  update(input: AlertInput, now: number): FlightAlert[] {
    // A recovered stopping margin / touchdown clears terrain immediately, not 1.2 seconds later.
    if (!input.flying || landingReadout(input.agl, input.verticalSpeed, input.gravity ?? 0, input.brakingAcceleration ?? 0, input.brakingFuelSeconds).canStop) this.live.delete('terrain');
    for (const a of alertConditions(input)) this.live.set(a.id, { alert: a, until: now + HOLD });
    const out: FlightAlert[] = [];
    for (const [id, e] of this.live) {
      if (e.until < now) this.live.delete(id);
      else out.push(e.alert);
    }
    return out.sort((a, b) => (a.level === b.level ? 0 : a.level === 'bad' ? -1 : 1));
  }

  clear() {
    this.live.clear();
  }
}

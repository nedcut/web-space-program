import { landingReadout } from './landingReadout';
import { PANEL_LOAD_WARN } from '../sim/vessel/deployables';
import type { PartState } from '../sim/vessel/runtime';
import type { ParachuteModule } from '../sim/vessel/types';
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
  /** The pilot silenced this warning's repeating tone; it re-arms once the alert clears. */
  silenced?: boolean;
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
  /** Descent rate the deployed canopies settle to once fully open, m/s (NaN: none deployed / no air). */
  chuteDescent?: number;
  /** Armed parachutes held shut because the airflow is above their rating, Pa (null: not waiting). */
  chuteWaiting?: { q: number; rating: number } | null;
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
  /** Normalized crossflow exposure: > 0 in the warn band, ≥ 1 inside the breakup envelope. */
  structuralStress?: number;
  /** Worst load fraction of extended arrays/antennas (air load or heat; ≥ 1 tears them off). */
  panelLoad?: number;
}

/** G-load caution and warning thresholds (the g-meter colours too). 10 g is the entry corridor's steep edge. */
export const G_WARN = 6;
export const G_BAD = 10;
/** Deployed canopies that settle below this descent rate are a normal landing, not a sink-rate hazard, m/s. */
export const CHUTE_SAFE_DESCENT = 12;

export type ChuteLamp = 'stowed' | 'armed' | 'waiting' | 'semi' | 'full' | 'cut';

export interface ChuteStatus {
  lamp: ChuteLamp;
  /** Lowest opening load among armed parachutes, Pa (0: none armed). */
  rating: number;
  /** Fully open drag area of the semi/fully deployed canopies, m². */
  openArea: number;
}

/**
 * Parachute summary for the HUD lamp and alerts, most deployed state first. An armed chute is `waiting` while there
 * is enough air to open it but the airflow is above its rating (the sim's opening rule in `updateParachutes`).
 */
export function chuteStatus(parts: readonly PartState[], dynamicPressure: number, staticPressure: number): ChuteStatus | null {
  let any = false, semi = false, full = false, armed = false, waiting = false, cut = false, rating = Infinity, openArea = 0;
  for (const p of parts) {
    const c = p.chute;
    if (!c) continue;
    any = true;
    const m = p.def.modules[c.moduleIndex] as ParachuteModule;
    if (c.phase === 'semi' || c.phase === 'full') { openArea += m.deployedCdA; if (c.phase === 'full') full = true; else semi = true; }
    else if (c.phase === 'armed') {
      armed = true;
      rating = Math.min(rating, m.maxQ);
      if (staticPressure >= (p.tweaks?.chuteMinPressure ?? m.minPressure) && dynamicPressure > m.maxQ) waiting = true;
    } else if (c.phase === 'cut') cut = true;
  }
  if (!any) return null;
  const lamp: ChuteLamp = full ? 'full' : semi ? 'semi' : waiting ? 'waiting' : armed ? 'armed' : cut ? 'cut' : 'stowed';
  return { lamp, rating: Number.isFinite(rating) ? rating : 0, openArea };
}

/** Extended arrays/antennas: caution from `PANEL_LOAD_WARN`, warning from this load fraction. */
const PANEL_LOAD_BAD = 0.9;

/** Deployed parachutes will bring the vessel down at a safe rate: the descent is not a sink-rate hazard. */
const chutesLand = (i: AlertInput) => i.chutes && (i.chuteDescent ?? Number.NaN) <= CHUTE_SAFE_DESCENT;

/** Seconds an alert lingers after its condition clears. */
const HOLD = 1.2;

/** Raw (instantaneous) alert conditions, most severe first within each topic. */
export function alertConditions(i: AlertInput): FlightAlert[] {
  const out: FlightAlert[] = [];
  if (i.noControl && !i.eva) out.push({ id: 'control', level: 'bad', text: 'NO CONTROL' });
  if (i.heatFraction >= 0.9) out.push({ id: 'heat', level: 'bad', text: `OVERHEAT${i.hottestPart ? ` · ${i.hottestPart}` : ''} ${(i.heatFraction * 100).toFixed(0)}%` });
  else if (i.heatFraction >= 0.75) out.push({ id: 'heat', level: 'warn', text: `HIGH TEMP ${(i.heatFraction * 100).toFixed(0)}%` });
  const ease = i.thrusting ? ' · THROTTLE DOWN' : '';
  if (i.gForce >= G_BAD) out.push({ id: 'g', level: 'bad', text: `G-LOAD ${i.gForce.toFixed(1)} g${ease}` });
  else if (i.gForce >= G_WARN) out.push({ id: 'g', level: 'warn', text: `HIGH G ${i.gForce.toFixed(1)} g${ease}` });
  if (i.flying && i.chuteWaiting) out.push({ id: 'chute', level: 'warn', text: `CHUTE WAITING · TOO FAST ${(i.chuteWaiting.q / 1000).toFixed(0)} / ${(i.chuteWaiting.rating / 1000).toFixed(0)} kPa` });
  if (i.flying && Number.isFinite(i.agl) && i.verticalSpeed < -12 && i.agl > 0 && !i.eva && !chutesLand(i)) {
    const braking = landingReadout(i.agl, i.verticalSpeed, i.gravity ?? 0, i.brakingAcceleration ?? 0, i.brakingFuelSeconds);
    const tti = braking.impactTime;
    if (!braking.canStop && tti < 6) out.push({ id: 'terrain', level: 'bad', text: `TERRAIN · ${tti.toFixed(1)} s` });
    else if (!braking.canStop && tti < 15 && i.agl < 5000) out.push({ id: 'terrain', level: 'warn', text: `SINK RATE · ${tti.toFixed(0)} s to ground` });
  }
  if (i.flying && i.gear === 'up' && i.agl < 300 && i.verticalSpeed < -1 && i.verticalSpeed > -60 && i.horizontalSpeed < 120 && !i.chutes) {
    out.push({ id: 'gear', level: 'warn', text: 'GEAR UP' });
  }
  const stress = i.structuralStress ?? 0;
  if (i.flying && stress >= 1) out.push({ id: 'structure', level: 'bad', text: 'STRUCTURAL · BREAKUP · REDUCE ANGLE' });
  else if (i.flying && stress > 0) out.push({ id: 'structure', level: 'warn', text: 'STRUCTURAL · SIDE LOAD' });
  const panels = i.panelLoad ?? 0;
  if (i.flying && panels >= PANEL_LOAD_WARN) out.push({ id: 'panels', level: panels >= PANEL_LOAD_BAD ? 'bad' : 'warn',
    text: `${panels >= PANEL_LOAD_BAD ? 'PANELS TEARING' : 'PANELS EXPOSED'} ${(Math.min(panels, 1) * 100).toFixed(0)}% · RETRACT` });
  if (i.flameout) out.push({ id: 'fuel', level: 'bad', text: 'FLAMEOUT' });
  else if (i.thrusting && Number.isFinite(i.stageBurnTime) && i.stageBurnTime < 10) out.push({ id: 'fuel', level: 'warn', text: `STAGE FUEL · ${Math.max(0, i.stageBurnTime).toFixed(0)} s` });
  if (Number.isFinite(i.power) && i.power < 0.05 && !i.eva) out.push({ id: 'power', level: i.power <= 0.001 ? 'bad' : 'warn', text: i.power <= 0.001 ? 'NO POWER' : 'LOW POWER' });
  return out;
}

/** Applies hysteresis and ordering (warnings after cautions, stable order otherwise). */
export class AlertTracker {
  private live = new Map<string, { alert: FlightAlert; until: number }>();
  private silenced = new Set<string>();
  /** The list from the latest `update`, which the HUD shows and the alarm tones follow. */
  current: readonly FlightAlert[] = [];

  update(input: AlertInput, now: number): FlightAlert[] {
    // A recovered stopping margin / touchdown clears terrain immediately, not 1.2 seconds later.
    // An opened (or no longer held) chute clears its caution at once, not after the hold.
    if (!input.chuteWaiting) this.live.delete('chute');
    if (!input.flying || chutesLand(input) || landingReadout(input.agl, input.verticalSpeed, input.gravity ?? 0, input.brakingAcceleration ?? 0, input.brakingFuelSeconds).canStop) this.live.delete('terrain');
    for (const a of alertConditions(input)) this.live.set(a.id, { alert: a, until: now + HOLD });
    const out: FlightAlert[] = [];
    for (const [id, e] of this.live) {
      if (e.until < now) this.live.delete(id);
      else out.push(this.silenced.has(id) ? { ...e.alert, silenced: true } : e.alert);
    }
    for (const id of this.silenced) if (!this.live.has(id)) this.silenced.delete(id);
    this.current = out.sort((a, b) => (a.level === b.level ? 0 : a.level === 'bad' ? -1 : 1));
    return out;
  }

  /** Stops a shown warning's tone from repeating until the alert clears. Cautions only beep once anyway. */
  silence(id: string) {
    if (this.live.get(id)?.alert.level !== 'bad') return;
    this.silenced.add(id);
    this.current = this.current.map(a => a.id === id ? { ...a, silenced: true } : a);
  }

  clear() {
    this.live.clear();
    this.silenced.clear();
    this.current = [];
  }
}

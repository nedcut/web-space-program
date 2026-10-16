import type { PartDef } from './types';
import type { PartState, VesselState } from './runtime';
import { autoDeploy, isExtended, retractableModule, retractablePanel } from './tweaks';

/**
 * Retractable solar arrays and antennas: deploy motion, the "extend above atmosphere" automation and aerodynamic
 * breakage. Extended hardware is fragile: above its rated dynamic pressure (or when its skin overheats) the part
 * tears off and leaves as debris through the ordinary joint-break path. Pure and allocation-free per step.
 */

/** Seconds for a full extend or retract (the render animation follows the simulated progress). */
export const PANEL_DEPLOY_TIME = 2;
/** Load rating used for retractable hardware without an explicit `maxQ`, Pa. */
export const DEFAULT_PANEL_MAX_Q = 3000;
/** While moving, hinges and booms carry this fraction of the extended rating. */
export const MOVING_LOAD_FACTOR = 0.5;
/** Extended thin structures tear when the hottest skin face reaches this fraction of the part's limit. */
export const PANEL_HEAT_FRACTION = 0.8;
/** HUD caution threshold on the load fraction. */
export const PANEL_LOAD_WARN = 0.7;
/** Automation: extend once q and static pressure are both below these (Pa)... */
export const AUTO_EXTEND_Q = 10;
export const AUTO_EXTEND_PRESSURE = 100;
/** ...and stow again when either rises above these (Pa). The gap is the hysteresis band. */
export const AUTO_STOW_Q = 100;
export const AUTO_STOW_PRESSURE = 1000;

/** Rated dynamic pressure of extended hardware, Pa (Infinity for parts that are not retractable). */
export function panelMaxQ(def: PartDef): number {
  let limit = Infinity;
  for (const m of def.modules) {
    if (retractableModule(m)) limit = Math.min(limit, (m.type === 'antenna' ? m.maxQ : undefined) ?? DEFAULT_PANEL_MAX_Q);
  }
  return limit;
}

/**
 * Load fraction of one retractable part: dynamic pressure over its rating (halved while moving) or skin heat over
 * {@link PANEL_HEAT_FRACTION} of its limit, whichever is worse. Stowed (and enclosed) hardware carries no load.
 */
export function panelLoad(p: PartState, dynamicPressure: number): number {
  const deploy = p.panelDeploy ?? (isExtended(p) ? 1 : 0);
  if (deploy <= 0 || p.panelTorn) return 0;
  const limit = panelMaxQ(p.def) * (deploy < 1 ? MOVING_LOAD_FACTOR : 1);
  let hottest = p.temperature;
  for (let i = 0; i < p.skinTemperature.length; i++) if (p.skinTemperature[i] > hottest) hottest = p.skinTemperature[i];
  return Math.max(dynamicPressure / limit, hottest / (PANEL_HEAT_FRACTION * p.maxTemp));
}

/** Retractable parts of a vessel, cached with the topology. */
export function deployableParts(v: VesselState): PartState[] {
  return v.cache.deployables ??= v.parts.filter(p => retractablePanel(p.def));
}

/** One automation decision for a part; `undefined` while the air is inside the hysteresis band. */
function autoSafe(dynamicPressure: number, staticPressure: number): boolean | undefined {
  if (dynamicPressure < AUTO_EXTEND_Q && staticPressure < AUTO_EXTEND_PRESSURE) return true;
  if (dynamicPressure > AUTO_STOW_Q || staticPressure > AUTO_STOW_PRESSURE) return false;
  return undefined;
}

/**
 * Advance automation and deploy motion over h seconds and collect tearing. Automation acts on transitions only, so a
 * manual extend or retract holds until the air next crosses a threshold. A part's first evaluation counts as a
 * transition towards extension (craft spawned in vacuum open up) but never stows (launch settings are honoured).
 * Returns the parts that tore off this substep (cause per uid), or undefined. Sets `telemetry.deployableLoad`.
 */
export function stepDeployables(v: VesselState, dynamicPressure: number, staticPressure: number, h: number): Map<number, 'airload' | 'heat'> | undefined {
  const parts = deployableParts(v);
  let worst = 0, torn: Map<number, 'airload' | 'heat'> | undefined;
  if (parts.length) {
    const safe = autoSafe(dynamicPressure, staticPressure);
    const shielded = v.cache.shielded;
    for (const p of parts) {
      if (p.panelTorn) continue;
      if (safe !== undefined && autoDeploy(p) && p.autoDeploySafe !== safe) {
        // The first evaluation only ever extends: hardware the player set out at launch stays out.
        if (p.autoDeploySafe !== undefined || safe) setExtended(p, safe);
        p.autoDeploySafe = safe;
      }
      const target = isExtended(p) ? 1 : 0;
      const deploy = p.panelDeploy ?? target;
      p.panelDeploy = deploy < target ? Math.min(target, deploy + h / PANEL_DEPLOY_TIME) : deploy > target ? Math.max(target, deploy - h / PANEL_DEPLOY_TIME) : deploy;
      if (shielded?.has(p.uid)) continue;
      const load = panelLoad(p, dynamicPressure);
      if (load >= 1 && p.parent !== null) {
        p.panelTorn = true;
        (torn ??= new Map()).set(p.uid, dynamicPressure / (panelMaxQ(p.def) * (p.panelDeploy < 1 ? MOVING_LOAD_FACTOR : 1)) >= 1 ? 'airload' : 'heat');
      } else if (load > worst) worst = load;
    }
  }
  v.telemetry.deployableLoad = worst;
  return torn;
}

/** Commanded extension; replaces the tweak object (never mutated in place) only when the value changes. */
function setExtended(p: PartState, on: boolean): void {
  if (isExtended(p) !== on) p.tweaks = { ...p.tweaks, extended: on };
}

import type { DockingPortModule, PartDef, PartTweaks, RcsAxes, WheelMode } from './types';
import type { FlightTweaks, PartState, VesselState } from './runtime';
import { defaultFairingShell, FAIRING_MAX_HEIGHT, FAIRING_MAX_RADIUS_FACTOR, FAIRING_MIN_HEIGHT } from './fairing';
import { hasShroudOption } from './shroud';

/**
 * Per-part player settings ("tweakables"). Pure, DOM-free helpers shared by the simulation, the editor and the
 * flight inspector. Every accessor returns catalogue behaviour when the tweak is absent.
 */

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
type Tweakable = { def: PartDef; tweaks?: PartTweaks };

/** Engine thrust/mass-flow multiplier 0..1. */
export const thrustLimit = (p: Tweakable): number => clamp01(p.tweaks?.thrustLimit ?? 1);
/** Gimbal range multiplier 0..1 (0 when locked). */
export const gimbalScale = (p: Tweakable): number => p.tweaks?.gimbalLock ? 0 : clamp01(p.tweaks?.gimbalLimit ?? 1);
/** Signed control-surface deflection multiplier. */
export const deflectionScale = (p: Tweakable): number => clamp01(p.tweaks?.deflectionLimit ?? 1) * (p.tweaks?.deflectionInvert ? -1 : 1);
/** Decoupler ejection multiplier 0..1. */
export const ejectionScale = (p: Tweakable): number => clamp01(p.tweaks?.ejectionScale ?? 1);
export const isDockingPort = (def: PartDef) => def.modules.some((m): m is DockingPortModule => m.type === 'dockingPort');
export const isDecouplerDef = (def: PartDef) => def.modules.some(m => m.type === 'decoupler');
/** Stack flow passes through this part (decouplers default closed, docking ports default open). */
export function crossfeedOpen(p: Tweakable): boolean {
  if (isDecouplerDef(p.def)) return p.tweaks?.crossfeed === true;
  if (isDockingPort(p.def)) return p.tweaks?.crossfeed !== false;
  return true;
}
/** Module of a retractable array (tracking solar panel) or antenna boom; fixed antennas are not. */
export const retractableModule = (m: PartDef['modules'][number]) => (m.type === 'solarPanel' && m.tracking) || (m.type === 'antenna' && !m.fixed);
/** Retractable solar arrays (tracking panels) and antennas can be stowed; fixed hardware is always "extended". */
export const retractablePanel = (def: PartDef) => def.modules.some(retractableModule);
/** Commanded extension. Retractable arrays/antennas default stowed; a torn-off part never counts as extended. */
export const isExtended = (p: Tweakable & { panelTorn?: boolean }): boolean => !retractablePanel(p.def) || (p.tweaks?.extended === true && !p.panelTorn);
/** Retractable arrays/antennas extend above the atmosphere and stow in thick air unless the player turns it off. */
export const autoDeploy = (p: Tweakable): boolean => retractablePanel(p.def) && p.tweaks?.autoDeploy !== false;
export const lightOn = (p: Tweakable): boolean => p.tweaks?.lightOn !== false;
export const rcsEnabled = (p: Tweakable): boolean => p.tweaks?.rcsEnabled !== false;
export const wheelMode = (p: Tweakable): WheelMode => p.tweaks?.wheelMode ?? 'normal';
/** RCS command mask in the integrator's torque (pitch, roll, -yaw) and translation (x, y, z) body axes. */
export function rcsMask(p: Tweakable): { rot: [number, number, number]; tr: [number, number, number] } {
  const a: RcsAxes = p.tweaks?.rcsAxes ?? {};
  const on = (x?: boolean) => (x === false ? 0 : 1);
  return { rot: [on(a.pitch), on(a.roll), on(a.yaw)], tr: [on(a.lateral), on(a.fore), on(a.vertical)] };
}

// ------------------------------------------------------------------ descriptors (UI is generic over these)

export type TweakKey = keyof PartTweaks;
export type TweakDescriptor =
  | { key: 'thrustLimit' | 'gimbalLimit' | 'ejectionScale' | 'deflectionLimit'; kind: 'percent'; label: string; flight: boolean; step: number }
  | { key: 'chuteMinPressure' | 'chuteDeployAltitude' | 'fairingHeight' | 'fairingRadius'; kind: 'number'; label: string; flight: boolean; min: number; max: number; step: number; unit: string; fallback: number }
  | { key: 'gimbalLock' | 'crossfeed' | 'extended' | 'autoDeploy' | 'rcsEnabled' | 'lightOn' | 'deflectionInvert' | 'fairingAuto' | 'shroud'; kind: 'toggle'; label: string; flight: boolean; fallback: boolean }
  | { key: 'wheelMode'; kind: 'select'; label: string; flight: boolean; options: { value: WheelMode; label: string }[] }
  | { key: 'rcsAxes'; kind: 'axes'; label: string; flight: boolean }
  | { key: 'lightColor'; kind: 'color'; label: string; flight: boolean; fallback: string };

export const LIGHT_COLORS = ['#fff4d6', '#ffffff', '#ffb35c', '#ff6b6b', '#6fe39a', '#79d7ee', '#b28dff'] as const;

/** Settings a part offers. `flight` marks those adjustable after launch. */
export function tweakDescriptors(def: PartDef): TweakDescriptor[] {
  const out: TweakDescriptor[] = [];
  for (const m of def.modules) {
    if (m.type === 'engine') {
      out.push({ key: 'thrustLimit', kind: 'percent', label: 'Thrust limiter', flight: true, step: 0.5 });
      if (m.gimbalRange > 0) {
        out.push({ key: 'gimbalLimit', kind: 'percent', label: 'Gimbal range', flight: true, step: 1 });
        out.push({ key: 'gimbalLock', kind: 'toggle', label: 'Gimbal locked', flight: true, fallback: false });
      }
      if (hasShroudOption(def)) out.push({ key: 'shroud', kind: 'toggle', label: 'Interstage skirt', flight: false, fallback: true });
    }
    if (m.type === 'decoupler') {
      out.push({ key: 'ejectionScale', kind: 'percent', label: 'Ejection force', flight: false, step: 1 });
      out.push({ key: 'crossfeed', kind: 'toggle', label: 'Fuel crossfeed', flight: true, fallback: false });
    }
    if (m.type === 'dockingPort') out.push({ key: 'crossfeed', kind: 'toggle', label: 'Fuel crossfeed', flight: true, fallback: true });
    if (m.type === 'liftingSurface' && m.deflection > 0 && m.ctrlFraction > 0) {
      out.push({ key: 'deflectionLimit', kind: 'percent', label: 'Deflection limit', flight: true, step: 1 });
      out.push({ key: 'deflectionInvert', kind: 'toggle', label: 'Invert deflection', flight: true, fallback: false });
    }
    if (m.type === 'parachute') {
      out.push({ key: 'chuteMinPressure', kind: 'number', label: 'Deploy pressure', flight: true, min: Math.min(10, m.minPressure), max: 80000, step: 10, unit: 'Pa', fallback: m.minPressure });
      out.push({ key: 'chuteDeployAltitude', kind: 'number', label: 'Full deploy height', flight: true, min: Math.min(50, m.deployAltitude), max: 5000, step: 50, unit: 'm', fallback: m.deployAltitude });
    }
    if (retractableModule(m)) {
      out.push({ key: 'extended', kind: 'toggle', label: m.type === 'antenna' ? 'Antenna extended at launch' : 'Panels extended at launch', flight: false, fallback: false });
      out.push({ key: 'autoDeploy', kind: 'toggle', label: 'Extend above atmosphere', flight: true, fallback: true });
    }
    if (m.type === 'landingLeg' || (m.type === 'wheel' && m.retractable) || m.type === 'bay')
      out.push({ key: 'extended', kind: 'toggle', label: m.type === 'bay' ? 'Doors open at launch' : 'Deployed at launch', flight: false, fallback: m.type === 'wheel' });
    if (m.type === 'rcs') {
      out.push({ key: 'rcsEnabled', kind: 'toggle', label: 'Thrusters enabled', flight: true, fallback: true });
      out.push({ key: 'rcsAxes', kind: 'axes', label: 'Axes', flight: true });
    }
    if (m.type === 'reactionWheel') out.push({ key: 'wheelMode', kind: 'select', label: 'Wheel mode', flight: true, options: [
      { value: 'normal', label: 'Pilot + SAS' }, { value: 'sasOnly', label: 'SAS only' }, { value: 'pilotOnly', label: 'Pilot only' }, { value: 'off', label: 'Off' }] });
    if (m.type === 'fairing') {
      const shell = defaultFairingShell(def);
      if (shell) {
        out.push({ key: 'fairingAuto', kind: 'toggle', label: 'Fit shell to payload', flight: false, fallback: true });
        out.push({ key: 'fairingHeight', kind: 'number', label: 'Shell height', flight: false, min: FAIRING_MIN_HEIGHT, max: FAIRING_MAX_HEIGHT, step: 0.05, unit: 'm', fallback: shell.height });
        out.push({ key: 'fairingRadius', kind: 'number', label: 'Shell radius', flight: false, min: shell.baseRadius, max: +(shell.baseRadius * FAIRING_MAX_RADIUS_FACTOR).toFixed(2), step: 0.02, unit: 'm', fallback: shell.radius });
      }
    }
    if (m.type === 'light') {
      out.push({ key: 'lightOn', kind: 'toggle', label: 'Lamp on', flight: true, fallback: true });
      out.push({ key: 'lightColor', kind: 'color', label: 'Colour', flight: true, fallback: LIGHT_COLORS[0] });
    }
  }
  return out.filter((d, i) => out.findIndex(o => o.key === d.key) === i);
}

// ------------------------------------------------------------------ validation (untrusted crafts, saves, network)

const FLIGHT_KEYS = new Set<TweakKey>(['thrustLimit', 'gimbalLimit', 'gimbalLock', 'crossfeed', 'deflectionLimit', 'deflectionInvert',
  'chuteMinPressure', 'chuteDeployAltitude', 'autoDeploy', 'rcsEnabled', 'rcsAxes', 'wheelMode', 'lightOn', 'lightColor']);
const ALL_KEYS = new Set<TweakKey>([...FLIGHT_KEYS, 'ejectionScale', 'extended', 'fairingAuto', 'fairingHeight', 'fairingRadius', 'shroud']);
const record = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const unit = (x: unknown) => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 1;
const range = (x: unknown, lo: number, hi: number) => typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi;

/** Structural validation of a tweak object. `flightOnly` rejects editor-only keys (network flight commands). */
export function validTweaks(x: unknown, flightOnly = false): x is PartTweaks {
  if (!record(x)) return false;
  for (const [k, v] of Object.entries(x)) {
    if (!(flightOnly ? FLIGHT_KEYS : ALL_KEYS).has(k as TweakKey)) return false;
    if (v === undefined) continue;
    switch (k as TweakKey) {
      case 'thrustLimit': case 'gimbalLimit': case 'ejectionScale': case 'deflectionLimit': if (!unit(v)) return false; break;
      case 'chuteMinPressure': if (!range(v, 0, 1e7)) return false; break;
      case 'chuteDeployAltitude': if (!range(v, 0, 1e5)) return false; break;
      case 'fairingHeight': case 'fairingRadius': if (!range(v, 0.05, 100)) return false; break;
      case 'wheelMode': if (!['normal', 'sasOnly', 'pilotOnly', 'off'].includes(String(v))) return false; break;
      case 'lightColor': if (typeof v !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(v)) return false; break;
      case 'rcsAxes': if (!record(v) || !Object.entries(v).every(([a, on]) => ['pitch', 'yaw', 'roll', 'lateral', 'fore', 'vertical'].includes(a) && typeof on === 'boolean')) return false; break;
      default: if (typeof v !== 'boolean') return false;
    }
  }
  return true;
}

/** Merge settings into a part (only keys this part offers). Returns true when stack flow topology changed. */
export function mergeTweaks(p: PartState, tweaks: PartTweaks): boolean {
  const offered = new Set(tweakDescriptors(p.def).map(d => d.key));
  const before = crossfeedOpen(p);
  const next: PartTweaks = { ...p.tweaks };
  for (const [k, v] of Object.entries(tweaks) as [TweakKey, unknown][]) {
    if (!offered.has(k)) continue;
    if (v === undefined) delete next[k];
    else (next as Record<string, unknown>)[k] = structuredClone(v);
  }
  p.tweaks = Object.keys(next).length ? next : undefined;
  if (p.tweaks === undefined) delete p.tweaks;
  return before !== crossfeedOpen(p);
}

/** Flight tweak command: applies to the part (and its symmetry counterparts when asked). Returns parts changed. */
export function applyFlightTweaks(v: VesselState, uid: number, tweaks: FlightTweaks, symmetric = false): { changed: PartState[]; topology: boolean } {
  const p = v.cache.byUid.get(uid);
  if (!p || !validTweaks(tweaks, true)) return { changed: [], topology: false };
  const targets = symmetric && p.symmetryGroup !== undefined ? v.parts.filter(q => q.symmetryGroup === p.symmetryGroup && q.partId === p.partId) : [p];
  let topology = false;
  for (const t of targets) topology = mergeTweaks(t, tweaks) || topology;
  return { changed: targets, topology };
}

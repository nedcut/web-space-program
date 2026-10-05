import { ACTION_GROUP_IDS, PART_ACTION_IDS, type ActionGroupId, type PartActionId, type PartDef, type PartGroupActions, type WheelModule } from './types';
import type { PartState, VesselCommand, VesselEvent, VesselState } from './runtime';
import { rebuildTopology } from './assembly';
import { engineModule, igniteEngine, isSolidMotor, shutdownEngine } from './engines';
import { fireDecoupler, jettisonFairing } from './staging';
import { applyFlightTweaks, crossfeedOpen, isDecouplerDef, isDockingPort, isExtended, lightOn, mergeTweaks, rcsEnabled, retractablePanel, validTweaks, wheelMode } from './tweaks';

/**
 * Part actions and action groups. DOM-free and deterministic: commands arrive in ControlInput.commands and are
 * applied once by the authority (single-player World or the multiplayer room). Actions that need World context
 * (science, undocking) are listed in WORLD_ACTIONS and handled by the World before the vessel step.
 */

export { ACTION_GROUP_IDS, PART_ACTION_IDS };
export const WORLD_ACTIONS: ReadonlySet<PartActionId> = new Set<PartActionId>(['science.run', 'science.transmit', 'undock']);
/** Actions with an on/off sense that an action group can direct. */
export const TOGGLE_ACTIONS: ReadonlySet<PartActionId> = new Set<PartActionId>(['engine.toggle', 'gimbal.toggle', 'deploy.toggle', 'crossfeed.toggle', 'light.toggle', 'rcs.toggle', 'wheel.toggle', 'drill.toggle', 'converter.toggle']);
export const MAX_COMMANDS = 32;
const DIRECTED_GROUPS: ReadonlySet<ActionGroupId> = new Set<ActionGroupId>(['gear', 'brakes', 'lights', 'rcs', 'sas']);

export const GROUP_LABELS: Record<ActionGroupId, string> = {
  stage: 'Stage', gear: 'Gear', brakes: 'Brakes', lights: 'Lights', rcs: 'RCS', sas: 'SAS', abort: 'Abort',
  custom1: 'Group 1', custom2: 'Group 2', custom3: 'Group 3', custom4: 'Group 4', custom5: 'Group 5',
  custom6: 'Group 6', custom7: 'Group 7', custom8: 'Group 8', custom9: 'Group 9', custom10: 'Group 10',
};

export const ACTION_LABELS: Record<PartActionId, string> = {
  'engine.activate': 'Activate engine', 'engine.shutdown': 'Shut down engine', 'engine.toggle': 'Toggle engine',
  'gimbal.toggle': 'Toggle gimbal lock', 'deploy.extend': 'Extend', 'deploy.retract': 'Retract', 'deploy.toggle': 'Toggle deploy',
  decouple: 'Decouple', 'fairing.jettison': 'Jettison fairing', 'chute.deploy': 'Arm parachute', 'chute.cut': 'Cut parachute',
  'crossfeed.toggle': 'Toggle crossfeed', 'light.toggle': 'Toggle lamp', 'rcs.toggle': 'Toggle thrusters', 'wheel.toggle': 'Toggle wheel',
  'drill.toggle': 'Toggle drill', 'converter.toggle': 'Toggle converter', 'science.run': 'Run experiment', 'science.transmit': 'Transmit data',
  undock: 'Undock',
};

const has = (def: PartDef, type: string) => def.modules.some(m => m.type === type);
/** Can this part be extended/retracted by a deploy action (legs, retractable gear, bays, solar arrays, antennas)? */
export function deployable(def: PartDef): boolean {
  return has(def, 'landingLeg') || has(def, 'bay') || retractablePanel(def)
    || def.modules.some(m => m.type === 'wheel' && (m as WheelModule).retractable);
}

/** Actions a catalogue part offers (in display order). Bindable in the editor; state decides flight enablement. */
export function partActions(def: PartDef): PartActionId[] {
  const out: PartActionId[] = [];
  const engine = def.modules.find(m => m.type === 'engine');
  if (engine && engine.type === 'engine') {
    out.push('engine.activate');
    if (!isSolidMotorDef(def)) out.push('engine.shutdown', 'engine.toggle');
    if (engine.gimbalRange > 0) out.push('gimbal.toggle');
  }
  if (deployable(def)) out.push('deploy.extend', 'deploy.retract', 'deploy.toggle');
  if (isDecouplerDef(def)) out.push('decouple', 'crossfeed.toggle');
  if (has(def, 'fairing')) out.push('fairing.jettison');
  if (has(def, 'parachute')) out.push('chute.deploy', 'chute.cut');
  if (isDockingPort(def)) out.push('undock', 'crossfeed.toggle');
  if (has(def, 'light')) out.push('light.toggle');
  if (has(def, 'rcs')) out.push('rcs.toggle');
  if (has(def, 'reactionWheel')) out.push('wheel.toggle');
  if (has(def, 'drill')) out.push('drill.toggle');
  if (has(def, 'converter')) out.push('converter.toggle');
  if (has(def, 'science') || def.modules.some(m => m.type === 'command' && m.crew > 0)) out.push('science.run');
  if (has(def, 'antenna')) out.push('science.transmit');
  return [...new Set(out)];
}
const isSolidMotorDef = (def: PartDef) => def.modules.some(m => m.type === 'engine' && (m.propellants.solidFuel ?? 0) > 0);

/** Current on/off sense of a toggle-like action on a part (undefined when not applicable). */
export function actionState(p: PartState, action: PartActionId): boolean | undefined {
  switch (action) {
    case 'engine.toggle': return p.engine ? p.engine.ignited : undefined;
    case 'gimbal.toggle': return !!p.tweaks?.gimbalLock;
    case 'deploy.toggle': case 'deploy.extend': case 'deploy.retract': return deployState(p);
    case 'crossfeed.toggle': return crossfeedOpen(p);
    case 'light.toggle': return lightOn(p);
    case 'rcs.toggle': return rcsEnabled(p);
    case 'wheel.toggle': return wheelMode(p) !== 'off';
    case 'drill.toggle': return !!p.drillDeployed;
    case 'converter.toggle': return !!p.converterRunning;
    default: return undefined;
  }
}

function deployState(p: PartState): boolean {
  if (p.leg) return p.leg.deployed;
  if (p.wheel) return p.wheel.deployed;
  if (p.bayOpen !== undefined) return p.bayOpen;
  return isExtended(p);
}

function setDeploy(p: PartState, on: boolean): void {
  if (p.leg) p.leg.deployed = on;
  if (p.wheel && (p.def.modules[p.wheel.moduleIndex] as WheelModule).retractable) p.wheel.deployed = on;
  if (p.bayOpen !== undefined) p.bayOpen = on;
  if (retractablePanel(p.def)) mergeTweaks(p, { extended: on });
}

/** Is the action meaningful right now (flight UI enablement)? World actions are checked by the World. */
export function actionAvailable(p: PartState, action: PartActionId): boolean {
  const e = p.engine && engineModule(p);
  switch (action) {
    case 'engine.activate': return !!p.engine && !p.engine.ignited && p.engine.ignitionsLeft !== 0;
    case 'engine.shutdown': return !!p.engine && p.engine.ignited && !!e && !isSolidMotor(e);
    case 'engine.toggle': return !!p.engine && !!e && !isSolidMotor(e);
    case 'chute.deploy': return p.chute?.phase === 'stowed';
    case 'chute.cut': return !!p.chute && p.chute.phase !== 'stowed' && p.chute.phase !== 'cut';
    case 'decouple': return !p.activated;
    case 'fairing.jettison': return !p.activated;
    case 'undock': return !!p.docked;
    default: return true;
  }
}

/** All (part, action) bindings of a group on a vessel. */
export function groupBindings(v: Pick<VesselState, 'parts'>, group: ActionGroupId): { uid: number; action: PartActionId }[] {
  return v.parts.flatMap(p => (p.actions?.[group] ?? []).map(action => ({ uid: p.uid, action })));
}

export function validGroupActions(x: unknown): x is PartGroupActions {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return false;
  return Object.entries(x).every(([g, list]) => (ACTION_GROUP_IDS as readonly string[]).includes(g) && Array.isArray(list)
    && list.length <= PART_ACTION_IDS.length && list.every(a => (PART_ACTION_IDS as readonly string[]).includes(a)));
}

/** Structural validation of untrusted commands (network). */
export function validCommands(x: unknown): x is VesselCommand[] {
  if (!Array.isArray(x) || x.length > MAX_COMMANDS) return false;
  return x.every(c => {
    if (!c || typeof c !== 'object') return false;
    const r = c as Record<string, unknown>;
    if (r.state !== undefined && typeof r.state !== 'boolean') return false;
    if (r.kind === 'group') return (ACTION_GROUP_IDS as readonly string[]).includes(String(r.group));
    const uid = Number.isSafeInteger(r.uid) && (r.uid as number) >= 0;
    if (r.kind === 'part') return uid && (PART_ACTION_IDS as readonly string[]).includes(String(r.action))
      && (r.experiment === undefined || (typeof r.experiment === 'string' && r.experiment.length <= 64));
    if (r.kind === 'tweak') return uid && validTweaks(r.tweaks, true) && (r.symmetric === undefined || typeof r.symmetric === 'boolean');
    return false;
  });
}

export type PartCommand = Extract<VesselCommand, { kind: 'part' }>;

/**
 * Expand group commands into directed part commands, flipping group state. The Lights group also drives every
 * lamp, so lamps work without explicit bindings. Part and tweak commands pass through unchanged.
 */
export function expandCommands(v: VesselState, cmds: readonly VesselCommand[]): VesselCommand[] {
  const out: VesselCommand[] = [];
  for (const c of cmds.slice(0, MAX_COMMANDS)) {
    if (c.kind !== 'group') { out.push(c); continue; }
    // Groups that mirror a vessel control (gear, brakes, lights, RCS, SAS) direct their toggles to the control's new
    // state. Stage, Abort and the custom groups flip each bound toggle on its own part; custom groups still record an
    // on/off state for the HUD.
    const directed = DIRECTED_GROUPS.has(c.group);
    const momentary = c.group === 'stage' || c.group === 'abort';
    const groupOn = momentary ? true : c.state ?? !(v.groupState?.[c.group] ?? false);
    const state = directed ? groupOn : c.state;
    v.groupState = { ...v.groupState, [c.group]: groupOn };
    const bound = groupBindings(v, c.group);
    if (c.group === 'lights') for (const p of v.parts) if (has(p.def, 'light') && !bound.some(b => b.uid === p.uid && b.action === 'light.toggle')) bound.push({ uid: p.uid, action: 'light.toggle' });
    for (const b of bound) out.push({ kind: 'part', uid: b.uid, action: b.action, state });
  }
  return out;
}

/** Apply one sim-level part action. Returns false when it did not apply. Pieces split off are appended to `all`/`created`. */
export function applyPartAction(v: VesselState, cmd: PartCommand, events: VesselEvent[], all: VesselState[] = [v], created: VesselState[] = []): boolean {
  const owner = all.find(x => x.cache.byUid.has(cmd.uid));
  const p = owner?.cache.byUid.get(cmd.uid);
  if (!owner || !p || WORLD_ACTIONS.has(cmd.action) || !partActions(p.def).includes(cmd.action)) return false;
  const current = actionState(p, cmd.action);
  const want = cmd.state ?? (current === undefined ? true : !current);
  switch (cmd.action) {
    case 'engine.activate': return igniteEngine(owner, p, events);
    case 'engine.shutdown': return shutdownEngine(p);
    case 'engine.toggle': return want ? igniteEngine(owner, p, events) : shutdownEngine(p);
    case 'gimbal.toggle': mergeTweaks(p, { gimbalLock: want }); return true;
    case 'deploy.extend': setDeploy(p, true); return true;
    case 'deploy.retract': setDeploy(p, false); return true;
    case 'deploy.toggle': setDeploy(p, want); return true;
    case 'decouple': if (p.activated) return false; fireDecoupler(all, p.uid, events, created); return true;
    case 'fairing.jettison': if (p.activated) return false; jettisonFairing(all, p.uid, created); return true;
    case 'chute.deploy':
      if (!p.chute || p.chute.phase !== 'stowed') return false;
      p.chute.phase = 'armed'; p.activated = true;
      events.push({ type: 'chute', vesselId: owner.id, partUid: p.uid, phase: 'armed' });
      return true;
    case 'chute.cut':
      if (!p.chute || p.chute.phase === 'stowed' || p.chute.phase === 'cut') return false;
      p.chute.phase = 'cut'; p.chute.cda = 0;
      events.push({ type: 'chute', vesselId: owner.id, partUid: p.uid, phase: 'cut' });
      return true;
    case 'crossfeed.toggle': if (mergeTweaks(p, { crossfeed: want })) rebuildTopology(owner); return true;
    case 'light.toggle': mergeTweaks(p, { lightOn: want }); return true;
    case 'rcs.toggle': mergeTweaks(p, { rcsEnabled: want }); return true;
    case 'wheel.toggle': mergeTweaks(p, { wheelMode: want ? 'normal' : 'off' }); return true;
    case 'drill.toggle': p.drillDeployed = want; return true;
    case 'converter.toggle': p.converterRunning = want; return true;
    default: return false;
  }
}

/**
 * Apply expanded sim-level commands (part actions and flight tweaks). World actions are skipped (the World handles
 * them first). Returns vessels split off by decoupling/jettison.
 */
export function applyVesselCommands(v: VesselState, cmds: readonly VesselCommand[], events: VesselEvent[]): VesselState[] {
  const all: VesselState[] = [v];
  const created: VesselState[] = [];
  for (const c of expandCommands(v, cmds)) {
    if (c.kind === 'part') applyPartAction(v, c, events, all, created);
    else if (c.kind === 'tweak') {
      const owner = all.find(x => x.cache.byUid.has(c.uid));
      if (owner && applyFlightTweaks(owner, c.uid, c.tweaks, c.symmetric).topology) rebuildTopology(owner);
    }
  }
  return created;
}

/** Fire an action group from inside the simulation (staging fires the Stage group). */
export function runActionGroup(v: VesselState, group: ActionGroupId, events: VesselEvent[], all: VesselState[] = [v], created: VesselState[] = []): void {
  if (!v.parts.some(p => p.actions?.[group]?.length)) return;
  for (const c of expandCommands(v, [{ kind: 'group', group }])) if (c.kind === 'part') applyPartAction(v, c, events, all, created);
}

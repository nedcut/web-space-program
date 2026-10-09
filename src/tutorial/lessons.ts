import type { World } from '../game/world';
import type { FlightController } from '../flight/controller';
import type { EditorSession } from '../editor/session';
import type { CraftDef } from '../sim/vessel/types';
import { PART_CATALOG } from '../data/parts';
import { buildMoonLander, buildOrbiter, buildSoundingRocket, buildSwift, buildTender } from '../editor/stockCrafts';
import { placeInCircularOrbit, placeOnSurface, spawnRendezvousTarget } from '../game/scenarios';
import { length, normalize, dot } from '../util/vec3';
import { qRotate, qConj } from '../util/quat';

export interface TutorialContext {
  world?: World;
  flight?: Pick<FlightController, 'mapMode' | 'sasOn' | 'rcsOn' | 'dockingMode'> & { input: { state: { throttle: number } } };
  editor?: Pick<EditorSession, 'currentCraft'>;
}
export interface LessonStep {
  id: string;
  text: string;
  highlight?: string;
  complete(context: TutorialContext): boolean;
  /** An explanation to acknowledge after its state condition is satisfied. */
}
export interface Lesson {
  id: string; title: string; description: string;
  scene: 'editor' | 'flight'; craft(): CraftDef | null;
  setup?(world: World): void;
  steps: LessonStep[];
}
const step = (id: string, text: string, complete: LessonStep['complete'], highlight?: string): LessonStep => ({ id, text, complete, highlight });
const modulePresent = (type: string) => (c: TutorialContext) => !!c.editor?.currentCraft().parts.some(p => PART_CATALOG.get(p.partId)?.modules.some(m => m.type === type));
const altitude = (c: TutorialContext) => c.world?.active ? length(c.world.relativeState(c.world.active).position) - c.world.universe.body(c.world.active.body).radius : -Infinity;
const radarAltitude = (c: TutorialContext) => {
  const w = c.world, v = w?.active;
  if (!w || !v) return Infinity;
  const dir = qRotate(qConj(w.universe.ephem.bodyRotation(v.body, w.ut)), normalize(w.relativeState(v).position));
  return altitude(c) - w.universe.terrain(v.body).heightAt(dir.x, dir.y, dir.z);
};
const landed = (c: TutorialContext) => !!c.world?.active && !c.world.active.state.destroyed && c.world.active.state.situation !== 'flying' && c.world.active.mode !== 'prelaunch';
export const stableOrbit = (c: TutorialContext) => {
  const w = c.world, v = w?.active;
  if (!w || !v || v.state.destroyed || v.state.situation !== 'flying') return false;
  const o = w.orbitSummary(v);
  return o.orbit.e < 1 && o.pe > (w.universe.body(v.body).atmosphere?.height ?? 0);
};
/** The lunar trainer uses only the upper lander; discarded launcher hardware never spawns. */
export function lunarTrainer(): CraftDef {
  const craft = buildMoonLander();
  const engine = craft.parts.find(p => p.partId === 'eng-doldrum')!;
  const removed = new Set<number>();
  for (const p of craft.parts) if (p.parent === engine.uid || (p.parent != null && removed.has(p.parent))) removed.add(p.uid);
  return { ...craft, name: 'Selene Training Lander', parts: craft.parts.filter(p => !removed.has(p.uid)).map(p => ({ ...p, stage: p.partId === 'chute-main' || p.partId === 'dec-1' ? 0 : 1 })) };
}
const map = step('map', 'Press {map} to open the map. The orbit line shows where you will coast without thrust.', c => !!c.flight?.mapMode, '[data-tutorial="map"]');
const node = step('node', 'Choose Circularize @ Ap in the maneuver planner. A node describes a future change in velocity; the burn readout beside the navball counts down to it, and Execute next node in the Flight assist app can fly it.', c => !!c.world?.nodes.length, '[data-tutorial="maneuver"]');
export const LESSONS: Lesson[] = [
  { id: 'building', title: 'Building your first rocket', description: 'Assemble, stage and launch a small rocket.', scene: 'editor', craft: () => null, steps: [
    step('pod', 'Welcome! I’m Flight Director Ama Okafor. Pick a command pod from the palette, then click in the building area to place it.', modulePresent('command'), '.vab-palette'),
    step('tank', 'Attach a liquid fuel tank below the pod. Hover over an open attachment node until the preview snaps into place.', c => !!c.editor?.currentCraft().parts.some(p => (PART_CATALOG.get(p.partId)?.resources?.liquidFuel ?? 0) > 0), '.vab-palette'),
    step('engine', 'Attach a liquid engine below the tank. A rocket needs thrust, fuel and a pilot working together.', modulePresent('engine'), '.vab-palette'),
    step('chute', 'Attach a parachute above the pod so your crew can return safely.', modulePresent('parachute'), '.vab-palette'),
    step('staging', 'Check the staging list: the engine must fire before the parachute. Drag their chips into separate stages if needed.', c => {
      const parts = c.editor?.currentCraft().parts ?? [];
      const engine = parts.find(p => PART_CATALOG.get(p.partId)?.modules.some(m => m.type === 'engine'));
      const chute = parts.find(p => PART_CATALOG.get(p.partId)?.modules.some(m => m.type === 'parachute'));
      return engine?.stage !== undefined && chute?.stage !== undefined && engine.stage > chute.stage;
    }, '.vab-staging'),
    step('launch', 'Click Launch. Your design will appear on the pad; you can begin First flight next.', c => !!c.world?.active, '.vab-launch'),
  ] },
  { id: 'first-flight', title: 'First flight', description: 'Lift off, climb to 10 km and return under a chute.', scene: 'flight', craft: buildSoundingRocket, steps: [
    step('throttle', 'Hold {throttleUp} to raise throttle, or press {throttleFull} for full power. Set at least half throttle before releasing the clamps.', c => (c.flight?.input.state.throttle ?? 0) >= 0.5, '[data-tutorial="throttle"]'),
    step('stage', 'Press {stage} to activate your engine and release the launch clamps.', c => !!c.world?.active && c.world.active.mode !== 'prelaunch'),
    step('sas', 'Press {toggleSas} to enable SAS stability assist. It holds your attitude while you climb.', c => !!c.flight?.sasOn, '[data-tutorial="sas"]'),
    step('climb', 'Keep the nose up and reach 10 km. Press {throttleCut} to cut thrust after the climb; coast back down.', c => altitude(c) >= 10000),
    step('chute', 'On descent, stage the parachute with {stage}. It arms first, then opens when pressure and speed are safe.', c => !!c.world?.active?.state.parts.some(p => p.chute?.phase === 'semi' || p.chute?.phase === 'full')),
    step('landing', 'Let the open chute slow the capsule all the way to the surface.', landed),
  ] },
  { id: 'orbit', title: 'Getting to orbit', description: 'Gravity turn, map, apoapsis and circularisation.', scene: 'flight', craft: buildOrbiter, steps: [
    step('turn', 'Launch with {throttleFull}, {toggleSas} and {stage}. Above 500 m, gently lean east using {yawRight}. Keep turning toward the horizon as you climb. The Flight assist app (top-right toolbar) can fly Launch to orbit for practice.', c => {
      const w = c.world, v = w?.active;
      return !!w && !!v && altitude(c) > 500 && dot(qRotate(v.state.orientation, { x: 0, y: 1, z: 0 }), normalize(w.relativeState(v).position)) < 0.98;
    }), map,
    step('apoapsis', 'Apoapsis is your highest point; periapsis is your lowest. Cut thrust when Ap clears the atmosphere. Coast toward Ap before accelerating prograde.', c => !!c.world?.active && c.world.orbitSummary(c.world.active).ap > c.world.universe.body(c.world.active.body).atmosphere!.height), node,
    step('orbit', 'Execute the circularisation burn near Ap. Finish when Pe also clears the atmosphere: now the whole orbit stays in space.', stableOrbit),
  ] },
  { id: 'moon-transfer', title: 'Maneuver nodes & going to the Moon', description: 'Plan a transfer, encounter the Moon and capture.', scene: 'flight', craft: buildMoonLander, setup: w => placeInCircularOrbit(w, w.active!, 'earth', 90000), steps: [map,
    step('transfer', 'In the maneuver planner choose Moon, then Plan transfer. Review the node time and burn; Execute next node in the Flight assist app can perform it.', c => !!c.world?.nodes.length, '[data-tutorial="maneuver"]'),
    step('encounter', 'Look for the Moon encounter on the predicted path. Execute your transfer node, then coast with time warp. The prediction should enter the Moon’s sphere of influence.', c => !!c.world?.active && (c.world.active.body === 'moon' || c.world.trajectory().some(p => p.orbit.body === 'moon' || p.nextBody === 'moon'))),
    step('arrival', 'Coast to lunar arrival. Time warp stops at encounters; check which body owns your orbit.', c => c.world?.active?.body === 'moon'),
    step('capture', 'At lunar periapsis, burn retrograde or plan Circularize @ Pe. Slow down until the lunar orbit is bound and its periapsis stays above the surface.', c => c.world?.active?.body === 'moon' && stableOrbit(c)),
  ] },
  { id: 'moon-landing', title: 'Landing on the Moon', description: 'Radar altitude, powered descent and landing legs.', scene: 'flight', craft: lunarTrainer, setup: w => placeInCircularOrbit(w, w.active!, 'moon', 20000), steps: [
    step('legs', 'Press {toggleGear} to extend the legs, then {stage} to ignite the lander engine. Begin a retrograde burn to lower periapsis toward the surface.', c => !!c.world?.active?.state.parts.some(p => p.leg?.deployed)),
    step('descent', 'The Moon has no air: a parachute cannot help. Burn retrograde to start descending. Land here in the Flight assist app can demonstrate the powered descent.', c => !!c.world?.active && c.world.verticalSpeed(c.world.active) < -5),
    step('radar', 'Below 5 km watch radar altitude: it measures terrain clearance. A last-moment braking burn needs distance ≈ speed² / (2 × net deceleration). Begin earlier to leave a margin.', c => radarAltitude(c) < 5000),
    step('burn', 'Use throttle to brake your descent, then reduce power to settle gently onto the deployed legs. Land assist calculates the braking point for this craft.', c => !!c.world?.active && c.world.active.state.telemetry.thrust > 0 && radarAltitude(c) < 5000),
    step('land', 'Keep vertical speed low near the ground. Cut the engine once the lander is safely down.', c => c.world?.active?.body === 'moon' && landed(c)),
  ] },
  { id: 'docking', title: 'Rendezvous & docking', description: 'Target, closest approach and RCS port alignment.', scene: 'flight', craft: buildTender, setup: w => { placeInCircularOrbit(w, w.active!, 'earth', 90000); spawnRendezvousTarget(w, buildTender(), 100); w.setTarget(null); }, steps: [
    step('target', 'Open the Target app (crosshair icon in the top-right toolbar), then choose Wren Tender Target in its selector. Matching orbits brings you close; matching velocity keeps you close.', c => c.world?.targetKind() === 'vessel', '[data-tutorial="target"]'),
    step('approach', 'Open the map with {map} and inspect closest approach. Our practice target starts 100 m ahead; approach slowly rather than accelerating straight at it.', c => !!c.flight?.mapMode && !!c.world?.closestApproach()),
    step('mode', 'Return from the map. Enable docking mode (the port button beside Stage, bottom-left) and RCS ({toggleRcs}). {translateForward}/{translateBack}, {translateLeft}/{translateRight} and {translateUp}/{translateDown} translate; the docking indicator shows port alignment.', c => !!c.flight?.dockingMode && !!c.flight.rcsOn, '[data-tutorial="docking"]'),
    step('dock', 'Align the ports, cancel sideways velocity and close below 0.5 m/s. The collars capture automatically when their faces meet.', c => !!c.world?.active?.state.parts.some(p => !!p.docked)),
  ] },
  { id: 'plane', title: 'Flying a plane', description: 'Runway acceleration, rotation and landing.', scene: 'flight', craft: buildSwift, steps: [
    step('runway', 'Welcome to the runway. {stage} starts the jet; {throttleFull} commands full throttle. Keep the wings level while you accelerate.', c => !!c.world?.active && length(c.world.surfaceVelocity(c.world.active)) > 30),
    step('rotate', 'At about 65 m/s, gently pull up with {pitchDown}. Climb clear of the runway before retracting gear with {toggleGear}.', c => altitude(c) > 300 && c.world?.active?.state.situation === 'flying'),
    step('return', 'Circle back, lower gear with {toggleGear} and reduce throttle. Make a shallow approach, flare just above the runway, then hold {brakes} to brake after touchdown.', c => landed(c) && !!c.world?.active && length(c.world.surfaceVelocity(c.world.active)) < 5),
  ] },
  { id: 'eva', title: 'EVA', description: 'Step outside, use a jetpack, plant a flag and board.', scene: 'flight', craft: lunarTrainer, setup: w => placeOnSurface(w, w.active!, 'moon'), steps: [
    step('eva', 'Our lander is already on the Moon. Press {eva} or the EVA button on the crew portrait (bottom-right) to step outside. {evaForward}/{evaLeft}/{evaBack}/{evaRight} walks; drag the view to choose your heading.', c => !!c.world?.active?.state.eva),
    step('jetpack', 'Press {evaJump} to jump. Switch the jetpack on with {toggleRcs}, then hold {evaUp} to lift off and {evaDown} to descend; movement keys fly level. Your finite monopropellant supply powers the jetpack; come back near the hatch.', c => !!c.world?.active?.state.eva && c.world.active.state.parts.some(p => (p.resources.monopropellant ?? 5) < 4.99)),
    step('flag', 'Settle onto the ground and press {plantFlag} to plant your expedition flag.', c => !!c.world?.flags.length),
    step('board', 'Walk back to the hatch, within 3 m and below 3 m/s relative speed. Press {board} or Board to return to the cabin.', c => !!c.world?.active && !c.world.active.state.eva && c.world.crewFor().length > 0),
  ] },
];

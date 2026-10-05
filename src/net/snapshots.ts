import { serializeWorld, deserializeWorld, type SavedWorld } from '../game/persistence';
import type { World } from '../game/world';
import type { VesselDelta } from './protocol';
import { isruMachinery } from '../sim/vessel/isru';
import { recomputeMassProperties } from '../sim/vessel';

export function vesselDeltas(world: World): VesselDelta[] {
  return [...world.vessels.values()].map(v => {
    const base = { id: v.state.id, body: v.body };
    if (v.mode === 'rails' && v.orbit) return { ...base, mode: 'rails', orbit: structuredClone(v.orbit) };
    if (v.mode === 'landedRails' && v.fixed && !isruMachinery(v.state).length) return { ...base, mode: 'landedRails', fixed: structuredClone(v.fixed) };
    const s = v.state;
    const state = structuredClone({
      position: s.position, velocity: s.velocity, orientation: s.orientation, angularVelocity: s.angularVelocity,
      mass: s.mass, com: s.com, inertia: s.inertia, invInertia: s.invInertia, nextStage: s.nextStage, situation: s.situation,
      sas: s.sas, telemetry: s.telemetry, eva: s.eva, destroyed: s.destroyed,
      parts: s.parts.map(p => ({ uid: p.uid, resources: p.resources, mass: p.mass, temperature: p.temperature,
        skinTemperature: p.skinTemperature, activated: p.activated, engine: p.engine, chute: p.chute, leg: p.leg, wheel: p.wheel,
        bayOpen: p.bayOpen, drillDeployed: p.drillDeployed, drillDeploy: p.drillDeploy, converterRunning: p.converterRunning,
        converterRecipe: p.converterRecipe, processTemperature: p.processTemperature, dockDisarmed: p.dockDisarmed, structuralFatigue: p.structuralFatigue })),
    });
    if (v.mode === 'landedRails' && v.fixed) return { ...base, mode: 'landedRails', fixed: structuredClone(v.fixed), state };
    return { ...base, mode: v.mode === 'prelaunch' ? 'prelaunch' : 'physics', fixed: structuredClone(v.fixed), state };
  });
}
export function applyDeltas(world: World, ut: number, deltas: VesselDelta[]) {
  world.ut = ut;
  const live = new Set(deltas.map(d => d.id));
  for (const id of world.vessels.keys()) if (!live.has(id)) world.vessels.delete(id);
  for (const d of deltas) {
    const v = world.vessels.get(d.id);
    if (!v) continue; // Topology always arrives in a preceding full snapshot, on the same ordered socket.
    v.mode = d.mode;
    v.body = d.body;
    v.orbit = d.mode === 'rails' ? structuredClone(d.orbit) : undefined;
    v.fixed = d.mode !== 'rails' ? structuredClone(d.fixed) : undefined;
    if ('state' in d && d.state) {
      const { parts, ...state } = structuredClone(d.state);
      Object.assign(v.state, state);
      for (const p of parts) {
        const part = v.state.cache.byUid.get(p.uid);
        if (part) Object.assign(part, p);
      }
      recomputeMassProperties(v.state, false);
    }
  }
  world.syncReplicaPacked();
}
/** Preserve the replica World identity used by the renderer. */
export function replaceWorld(world: World, saved: SavedWorld) {
  const next = deserializeWorld(saved, world.catalog, world.universe);
  world.vessels.clear();
  for (const [id, v] of next.vessels) world.vessels.set(id, v);
  world.ut = next.ut;
  world.crew = next.crew;
  world.crewSeed = next.crewSeed;
  world.flags = next.flags;
  world.mode = next.mode;
  world.progression = next.progression;
  world.commsSettings = next.commsSettings;
  world.transmitting = next.transmitting;
  world.surveyedBodies = next.surveyedBodies;
  world.activeId = next.activeId;
  world.nodes = [];
  // Navigation is local to each pilot, but discard targets removed by topology changes.
  if (!world.setTarget(world.targetId, world.targetPortUid)) world.setTarget(null);
  world.restoreAfterLoad();
}
export const topologyKey = (world: World) => JSON.stringify([...world.vessels.values()].map(v => [v.state.id, v.state.parts.map(p => [p.uid, p.parent, p.crew, p.docked])]));
export { serializeWorld };

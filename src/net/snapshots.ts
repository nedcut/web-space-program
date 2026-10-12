import { add } from '../util/vec3';
import { serializeWorld, deserializeWorld, type SavedWorld } from '../game/persistence';
import type { World } from '../game/world';
import type { VesselDelta } from './protocol';
import { isruMachinery } from '../sim/vessel/isru';
import { recomputeMassProperties, rebuildTopology } from '../sim/vessel';
import { isFairingDef } from '../sim/vessel/fairing';

export function vesselDeltas(world: World): VesselDelta[] {
  return [...world.vessels.values()].map(v => {
    const base = { id: v.state.id, body: v.body,
      crewDose: world.crew.filter(c => v.state.eva?.astronautId === c.id || v.state.parts.some(p => p.crew?.includes(c.id))).map(c => ({ id: c.id, dose: c.radiationDose ?? 0 })),
      hazards: v.state.parts.map(p => ({ uid: p.uid, electricCharge: p.resources.electricCharge,
      radiationDose: p.radiationDose, ambientTemperature: p.ambientTemperature, pressureExposure: p.pressureExposure,
      pressureWarned: p.pressureWarned, heatWarned: p.heatWarned, electronicsDegraded: p.electronicsDegraded, electronicsFailed: p.electronicsFailed })) };
    if (v.mode === 'rails' && v.orbit) return { ...base, mode: 'rails', orbit: structuredClone(v.orbit), ...(world.preciseGravity ? { precise: structuredClone(v.precise) } : {}) };
    if (v.mode === 'landedRails' && v.fixed && !isruMachinery(v.state).length) return { ...base, mode: 'landedRails', fixed: structuredClone(v.fixed) };
    const s = v.state;
    const state = structuredClone({
      position: s.position, velocity: s.velocity, orientation: s.orientation, angularVelocity: s.angularVelocity,
      mass: s.mass, com: s.com, inertia: s.inertia, invInertia: s.invInertia, nextStage: s.nextStage, situation: s.situation,
      sas: s.sas, telemetry: s.telemetry, eva: s.eva, destroyed: s.destroyed, groupState: s.groupState,
      parts: s.parts.map(p => ({ uid: p.uid, tweaks: p.tweaks, resources: p.resources, mass: p.mass, temperature: p.temperature,
        skinTemperature: p.skinTemperature, activated: p.activated, engine: p.engine, chute: p.chute, leg: p.leg, wheel: p.wheel,
        bayOpen: p.bayOpen, drillDeployed: p.drillDeployed, drillDeploy: p.drillDeploy, panelDeploy: p.panelDeploy, panelTorn: p.panelTorn, autoDeploySafe: p.autoDeploySafe, converterRunning: p.converterRunning,
        converterRecipe: p.converterRecipe, processTemperature: p.processTemperature, dockDisarmed: p.dockDisarmed, link: p.link, linkFatigue: p.linkFatigue, structuralFatigue: p.structuralFatigue })),
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
    for (const dose of d.crewDose ?? []) { const c = world.crew.find(c => c.id === dose.id); if (c) c.radiationDose = dose.dose; }
    for (const { electricCharge, ...hazard } of d.hazards ?? []) {
      const p = v.state.cache.byUid.get(hazard.uid);
      if (p) {
        Object.assign(p, hazard);
        if (electricCharge !== undefined) p.resources.electricCharge = electricCharge;
      }
    }
    v.mode = d.mode;
    v.body = d.body;
    v.orbit = d.mode === 'rails' ? structuredClone(d.orbit) : undefined;
    v.precise = d.mode === 'rails' ? structuredClone(d.precise) : undefined;
    if (v.precise) {
      const ref = world.universe.ephem.getBodyState(v.precise.frame,ut);
      v.state.position = add(ref.position,v.precise.state.position);
      v.state.velocity = add(ref.velocity,v.precise.state.velocity);
    }
    v.fixed = d.mode !== 'rails' ? structuredClone(d.fixed) : undefined;
    if ('state' in d && d.state) {
      const { parts, ...state } = structuredClone(d.state);
      Object.assign(v.state, state);
      if (state.groupState === undefined) delete v.state.groupState;
      let linksChanged = false;
      for (const p of parts) {
        const part = v.state.cache.byUid.get(p.uid);
        if (part) {
          linksChanged ||= JSON.stringify(part.link) !== JSON.stringify(p.link) || JSON.stringify(part.tweaks?.crossfeed) !== JSON.stringify(p.tweaks?.crossfeed)
            // A jettisoned fairing shell changes shielding and exposed areas.
            || (part.activated !== p.activated && isFairingDef(part.def));
          Object.assign(part, p);
          if (p.tweaks === undefined) delete part.tweaks;
          if (p.linkFatigue === undefined) delete part.linkFatigue;
          if (p.link === undefined) delete part.link;
          // JSON omits undefined fields: an absent fatigue value means the joint recovered.
          if (p.structuralFatigue === undefined) delete part.structuralFatigue;
        }
      }
      if (linksChanged) rebuildTopology(v.state);
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
  world.preciseGravity = next.preciseGravity;
  world.showLagrangePoints = next.showLagrangePoints;
  world.crew = next.crew;
  world.crewSeed = next.crewSeed;
  world.flags = next.flags;
  world.discoveries = next.discoveries;
  world.flightlog = next.flightlog;
  world.latestReportId = next.latestReportId;
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
export const topologyKey = (world: World) => JSON.stringify([...world.vessels.values()].map(v => [v.state.id, v.state.parts.map(p => [p.uid, p.parent, p.crew, p.docked, p.link]), v.state.controlUid]));
export { serializeWorld };

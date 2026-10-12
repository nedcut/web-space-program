import { buildVessel, decouplerCutChildren } from '../sim/vessel/assembly';
import { availableResource } from '../sim/vessel/resources';
import { engineModule } from '../sim/vessel/engines';
import { panelMaxQ } from '../sim/vessel/deployables';
import { aeroControlMargin } from './aeroStability';
import type { CraftDef, PartDef, ResourceId } from '../sim/vessel/types';
import type { StageStats } from './ui/dv';

export interface PreflightCheck { id: string; text: string; uids: number[] }
/** Advisory only. Uses the same fuel topology and static aerodynamic forces as flight. */
export function preflightChecks(craft: CraftDef, catalog: Map<string, PartDef>, first?: StageStats): PreflightCheck[] {
  if (!craft.parts.length) return [];
  const v = buildVessel(craft, catalog);
  const out: PreflightCheck[] = [];
  const add = (id: string, text: string, uids: number[] = []) => out.push({ id, text, uids });
  const engines = v.parts.filter(p => !!p.engine);
  if (!engines.some(p => p.stage === v.nextStage)) add('first-engine', 'First stage has no engine. Check the firing order.', engines.map(p => p.uid));
  if (craft.type === 'VAB' && first && first.twrAsl < 1) add('twr', `Launch TWR ${first.twrAsl.toFixed(2)}: below 1 cannot lift off. Add thrust or reduce mass.`, engines.map(p => p.uid));
  if (!v.parts.some(p => p.def.modules.some(m => m.type === 'command' && m.controllable !== false))) add('control', 'No control source. Add a command capsule or probe core.');
  const pods = v.parts.filter(p => p.def.modules.some(m => m.type === 'command' && m.crew > 0));
  if (pods.length && !v.parts.some(p => !!p.chute)) add('chute', 'Crew capsule has no parachute. Plan a powered landing or add one.', pods.map(p => p.uid));
  for (const p of engines) {
    const engine = engineModule(p)!;
    if (Object.entries(engine.propellants).some(([id, ratio]) => ratio && id !== 'intakeAir' && availableResource(v, p.uid, id as ResourceId) <= 1e-9)) add(`fuel-${p.uid}`, `${p.def.name}: no usable fuel path. Check tanks and crossfeed.`, [p.uid]);
  }
  for (const p of v.parts.filter(p => p.def.modules.some(m => m.type === 'decoupler'))) {
    const cut = new Set(decouplerCutChildren(v, p));
    const dropped = (uid: number): boolean => {
      const seen = new Set<number>();
      let part = v.cache.byUid.get(uid);
      while (part && !seen.has(part.uid)) {
        if (cut.has(part.uid)) return true;
        seen.add(part.uid); part = part.parent === null ? undefined : v.cache.byUid.get(part.parent);
      }
      return false;
    };
    const premature = engines.filter(e => dropped(e.uid) && p.stage !== undefined && e.stage !== undefined && p.stage >= e.stage);
    if (premature.length) add(`order-${p.uid}`, 'Separator fires before its attached engines finish their stage. Review the order.', [p.uid, ...premature.map(e => e.uid)]);
  }
  if (craft.type === 'VAB' && aeroControlMargin(craft, catalog) < -0.01) add('aero', 'Possible aero instability: insufficient restoring/control margin through launch fuel burn and Mach range. Move fins aft or mass forward.', v.parts.filter(p => p.def.modules.some(m => m.type === 'liftingSurface')).map(p => p.uid));
  const exposed = v.parts.filter(p => (p.panelDeploy ?? 0) > 0 && !v.cache.shielded?.has(p.uid));
  if (exposed.length) add('panels-out', `${exposed.length === 1 ? exposed[0].def.name : `${exposed.length} arrays/antennas`} extended at launch: airflow tears them off above ${(Math.min(...exposed.map(p => panelMaxQ(p.def))) / 1000).toFixed(1)} kPa. Stow them, or leave Extend above atmosphere on.`, exposed.map(p => p.uid));
  return out;
}

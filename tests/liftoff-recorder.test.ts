import { expect, it } from 'vitest';
import { World } from '../src/game/world';
import { Universe } from '../src/game/universe';
import { PART_CATALOG } from '../src/data/parts';
import { buildOrbiter } from '../src/editor/stockCrafts';
import { DEFAULT_START_UT } from '../src/game/store';
import { neutralInput } from '../src/sim/vessel';
it('does not award a soft landing when a tall rocket settles immediately after clamp release', () => {
  const w = new World(new Universe('standard'), PART_CATALOG, DEFAULT_START_UT);
  w.launch(buildOrbiter());
  for (let i = 0; i < 600; i++) w.tick(0.02, neutralInput({ throttle: 1, stage: i === 0, sas: 'stabilityAssist' }));
  const record = w.flightlog.records.find(r => r.vesselId === w.activeId)!;
  expect(record.launched).toBe(true);
  expect(record.events.some(e => e.kind === 'landing' || e.kind === 'splashdown')).toBe(false);
  expect(w.achievementProfile.unlocked.soft).toBeUndefined();
});

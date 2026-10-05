import { expect, it, vi } from 'vitest';
import { updateAudio } from '../src/flight/controller/audio';
import type { FlightController } from '../src/flight/controller';
import type { FlightControllerInternals } from '../src/flight/controller/internals';
import { World } from '../src/game/world';
import { Universe } from '../src/game/universe';
import { PART_CATALOG } from '../src/data/parts';
import { buildOrbiter } from '../src/editor/stockCrafts';
it('keeps continuous flight audio silent on every paused/photo frame, then resumes it', () => {
  const world = new World(new Universe('standard'), PART_CATALOG, 1000);
  const vessel = world.launch(buildOrbiter());
  const audio = { silenceFlight: vi.fn(), update: vi.fn() };
  const controller = { world, paused: true, cam: { distance: 20 }, input: { state: {} }, rcsOn: false, mapMode: false } as unknown as FlightController;
  const internals = { audio, reentryHeat: 0 } as unknown as FlightControllerInternals;
  updateAudio.call(controller, internals, vessel); updateAudio.call(controller, internals, vessel);
  expect(audio.silenceFlight).toHaveBeenCalledTimes(2); expect(audio.update).not.toHaveBeenCalled();
  controller.paused = false; updateAudio.call(controller, internals, vessel); expect(audio.update).toHaveBeenCalledTimes(1);
});

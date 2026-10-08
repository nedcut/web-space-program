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
  const audio = { setPaused: vi.fn(), silenceFlight: vi.fn(), update: vi.fn() };
  const controller = { world, paused: true, cam: { distance: 20 }, input: { state: {} }, rcsOn: false, mapMode: false } as unknown as FlightController;
  const internals = { audio, reentryHeat: 0 } as unknown as FlightControllerInternals;
  updateAudio.call(controller, internals, vessel); updateAudio.call(controller, internals, vessel);
  expect(audio.silenceFlight).toHaveBeenCalledTimes(2); expect(audio.update).not.toHaveBeenCalled();
  controller.paused = false; updateAudio.call(controller, internals, vessel); expect(audio.update).toHaveBeenCalledTimes(1);
});

it('uses absolute firing thrust without dilution from unlit installed stages', () => {
  const world=new World(new Universe('standard'),PART_CATALOG,1000), vessel=world.launch(buildOrbiter());
  const engine=vessel.state.parts.find(p=>p.engine)!;
  for(const part of vessel.state.parts)if(part.engine)part.engine.thrust=0;
  engine.engine!.thrust=9000;
  const audio={setPaused:vi.fn(),silenceFlight:vi.fn(),update:vi.fn()};
  const controller={world,paused:false,cam:{distance:20},input:{state:{}},rcsOn:false,mapMode:false} as unknown as FlightController;
  updateAudio.call(controller,{audio,reentryHeat:0} as unknown as FlightControllerInternals,vessel);
  const sample=audio.update.mock.calls[0][0];
  expect(sample.engines.reduce((sum:number,e:{thrustFraction:number})=>sum+e.thrustFraction,0)).toBeCloseTo(9000/3300000);
});
